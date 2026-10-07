import { PhotoEffectsPass } from './PhotoEffectsPass';
import { UpscalePass } from './UpscalePass';
import { FusedBloomPass, ToneMapPass } from './fusedBloom';
import { AdaptiveQuality } from './adaptiveQuality';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { classifyGpu } from '../../util/gpuTier';
import { detachRenderer, finishRenderer, noteDfgLut } from '../releaseRenderer';
import type { QualitySettings } from './quality';

export type ToneMappingId = 'aces' | 'agx' | 'neutral';

export interface RenderPipelineOptions {
  canvas?: HTMLCanvasElement;
  quality: QualitySettings;
  toneMapping?: ToneMappingId;
  exposure?: number;
}

/**
 * HDR render pipeline:
 *   scene → HalfFloat RT (optional MSAA) → bloom mips → tone map (+ bloom, sRGB) → 8-bit → SMAA/FXAA (optional)
 *   → edge-adaptive upscale to device resolution (when the internal resolution is below it)
 * Everything before the upscale runs at the internal resolution (device pixels × Retina scale × render scale ×
 * adaptive scale); the canvas keeps device resolution, so the image is reconstructed by `UpscalePass` rather than
 * stretched bilinearly by the browser. The renderer uses a logarithmic depth buffer so one camera can span 0.05 m to 10^13 m.
 * All custom ShaderMaterials must include three's logdepthbuf chunks (see render/planet/shaders).
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  private renderPass!: RenderPass;
  private bloomPass?: FusedBloomPass;
  private fxaaPass?: FXAAPass;
  private smaaPass?: SMAAPass;
  private upscalePass!: UpscalePass;
  private hdrTarget?: THREE.WebGLRenderTarget;
  /** Unmasked WebGL renderer string, when the browser exposes it. */
  readonly gpuName: string | null;
  photoEffects!: PhotoEffectsPass;
  private quality: QualitySettings;
  private adaptive = new AdaptiveQuality();
  private gpuTimer: GpuTimer | null;
  /** Smoothed GPU time per frame (ms) from timer queries; NaN when the browser does not expose them. */
  gpuMs = NaN;
  readonly stats = { calls: 0, triangles: 0, points: 0, programs: 0, textures: 0, geometries: 0 };
  // Low/adaptive resolution can round a 1px bootstrap canvas down to zero. Scene constructors
  // run PMREM baking before their first resize, so the initial default framebuffer must be valid.
  private width = 64;
  private height = 64;

  constructor(opts: RenderPipelineOptions) {
    this.quality = opts.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.info.autoReset = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = toneMappingConst(opts.toneMapping ?? 'aces');
    r.toneMappingExposure = opts.exposure ?? 1;
    r.shadowMap.enabled = opts.quality.shadowMapSize > 0;
    // three r18x replaces PCFSoftShadowMap with PCFShadowMap at the first shadow render; setting it
    // up front keeps shader keys stable, so programs compiled during warm-up are reused.
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x000000, 1);
    // Shader info-log queries force a synchronous compile wait; production builds skip them.
    r.debug.checkShaderErrors = !!import.meta.env?.DEV;
    this.gpuTimer = GpuTimer.create(r.getContext());
    this.gpuName = rendererName(r.getContext());
    // Adaptive resolution starts where this class of GPU usually lands, then converges from measurements.
    // A Retina-reduced, upscaled start already draws about half the device pixels, so mid-range GPUs start there.
    const tier = classifyGpu(this.gpuName);
    const start = resolutionPlan(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, opts.quality, 1, false, 1);
    const reduced = start.lod > start.internal * 1.2;
    this.adaptive.scale = tier === 'strong' ? 1 : tier === 'mid' ? (reduced ? 1 : 0.75) : 0.6;
    this.buildComposer();
  }

  get exposure(): number {
    return this.renderer.toneMappingExposure;
  }
  set exposure(v: number) {
    this.renderer.toneMappingExposure = v;
  }

  setToneMapping(id: ToneMappingId): void {
    this.renderer.toneMapping = toneMappingConst(id);
  }

  /** Map view is cheap to draw: render it at full device resolution so orbit lines stay crisp (Retina too). */
  private mapHiRes = false;
  setMapMode(on: boolean): void {
    if (this.mapHiRes === on) return;
    this.mapHiRes = on;
    this.setSize(this.width, this.height);
  }

  /** Current resolution plan (internal/output pixel ratios, upscaling); see `resolutionPlan`. */
  get plan(): ResolutionPlan { return (this.cachedPlan ??= this.computePlan()); }
  private cachedPlan: ResolutionPlan | null = null;
  private computePlan(): ResolutionPlan {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // Photo captures render at full device resolution (no Retina reduction, no adaptive reduction).
    const q = this.capturing ? { ...this.quality, upscale: { ...this.quality.upscale, retinaScale: 1 } } : this.quality;
    return resolutionPlan(dpr, q, this.capturing ? 1 : this.adaptive.scale, this.mapHiRes, Math.min(this.width, this.height));
  }
  private capturing = false;

  /** The scene is rendered below device resolution and reconstructed by the edge-adaptive upscale pass. */
  get upscaling(): boolean { return this.plan.upscaling; }

  /** Pixel ratio of the scene and post-processing buffers (internal resolution). */
  get pixelRatio(): number { return this.plan.internal; }

  /** Pixel ratio of the canvas (display output). */
  get outputPixelRatio(): number { return this.plan.output; }

  private buildComposer(): void {
    const q = this.quality;
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
    }
    // The HDR scene target (MSAA, depth) is used only by the scene, bloom and tone mapping. Everything after tone
    // mapping is display-referred 8-bit, so the composer's ping-pong buffers are RGBA8 without depth or MSAA
    // (half the bandwidth of half-float targets, and no multisample resolve after SMAA).
    this.hdrTarget?.dispose();
    const hdr = (this.hdrTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      samples: q.msaaSamples,
      depthBuffer: true,
    }));
    const ldr = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.UnsignedByteType, depthBuffer: false });
    const composer = new EffectComposer(this.renderer, ldr);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(new OnHdr(this.renderPass, hdr));
    this.bloomPass = undefined;
    if (q.bloom.enabled) {
      this.bloomPass = new FusedBloomPass(new THREE.Vector2(this.width, this.height), q.bloom.strength, q.bloom.radius, q.bloom.threshold);
      composer.addPass(new OnHdr(this.bloomPass, hdr));
    }
    const toneMap = new ToneMapPass();
    toneMap.bloom = this.bloomPass ?? null;
    composer.addPass(new OnHdr(toneMap, hdr));
    this.fxaaPass = undefined;
    this.smaaPass = undefined;
    if (q.aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      composer.addPass(this.fxaaPass);
    } else if (q.aa === 'smaa') {
      this.smaaPass = new SMAAPass();
      // Edges and blend weights are 8-bit quantities in the reference implementation.
      for (const t of [(this.smaaPass as unknown as SmaaTargets)._edgesRT, (this.smaaPass as unknown as SmaaTargets)._weightsRT]) t.texture.type = THREE.UnsignedByteType;
      composer.addPass(this.smaaPass);
    }
    this.photoEffects = new PhotoEffectsPass();
    composer.addPass(this.photoEffects);
    this.upscalePass = new UpscalePass();
    this.upscalePass.sharpness = q.upscale.sharpness;
    composer.addPass(this.upscalePass);
    this.composer = composer;
    this.setSize(this.width, this.height);
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0;
    this.buildComposer();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const plan = (this.cachedPlan = this.computePlan()), pr = plan.internal;
    this.upscalePass.enabled = plan.upscaling;
    this.renderer.setPixelRatio(plan.output);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.hdrTarget?.setSize(Math.round(this.width * pr), Math.round(this.height * pr));
    this.fxaaPass?.setSize(this.width * pr, this.height * pr);
    this.smaaPass?.setSize(this.width * pr, this.height * pr);
  }

  /**
   * Viewport height for terrain LOD selection. The screen-space error tolerance grows with √(pixel ratio): DPR 1
   * is unchanged, while Retina keeps device-resolution shading without ~1.9× the terrain chunks (draw calls and
   * per-vertex aerial perspective) — the geometric error stays under 2.5 CSS px on Medium.
   */
  get lodViewportHeight(): number {
    // Terrain detail follows the device resolution the upscaler reconstructs, not the reduced internal one.
    const pr = this.plan.lod;
    return (this.height * pr) / Math.sqrt(Math.max(1, pr));
  }

  /** Main-thread time from updateAdaptive (frame start) to the end of the last render submission. */
  cpuMs = NaN;
  private frameStart = NaN;

  updateAdaptive(frameMs: number, enabled: boolean, frameRateCap = 0): void {
    this.adaptive.frameRateCap = frameRateCap;
    const gpu = this.gpuTimer?.poll();
    if (gpu !== undefined) this.gpuMs = Number.isFinite(this.gpuMs) ? this.gpuMs * 0.9 + gpu * 0.1 : gpu;
    if (this.adaptive.update(frameMs, enabled, gpu, this.cpuMs)) this.setSize(this.width, this.height);
    this.frameStart = performance.now();
  }

  /** Internal 3D resolution as a fraction of the canvas resolution (per axis); 1 when not upscaling. */
  get effectiveRenderScale(): number { const p = this.plan; return p.internal / p.output; }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.photoEffects.scene = scene; this.photoEffects.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.renderer.info.reset();
    this.gpuTimer?.begin();
    this.composer.render();
    this.gpuTimer?.end();
    this.captureStats();
    if (Number.isFinite(this.frameStart)) this.cpuMs = performance.now() - this.frameStart;
  }

  /** Direct (non-composited) render used by the map view. */
  renderMap(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.info.reset();
    this.renderer.setRenderTarget(null);
    this.gpuTimer?.begin();
    this.renderer.render(scene, camera);
    this.gpuTimer?.end();
    this.captureStats();
  }

  private captureStats(): void {
    const info = this.renderer.info;
    const s = this.stats;
    s.calls = info.render.calls; s.triangles = info.render.triangles; s.points = info.render.points;
    s.programs = info.programs?.length ?? 0; s.textures = info.memory.textures; s.geometries = info.memory.geometries;
  }

  /** Render and copy synchronously, before the browser discards the drawing buffer. */
  capture(scene: THREE.Scene, camera: THREE.PerspectiveCamera, scale: 1 | 2): HTMLCanvasElement {
    const width = this.width, height = this.height;
    try {
      this.capturing = true;
      this.setSize(width * scale, height * scale);
      this.render(scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = this.renderer.domElement.width; canvas.height = this.renderer.domElement.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('PNG capture is unavailable.');
      context.drawImage(this.renderer.domElement, 0, 0); return canvas;
    } finally { this.capturing = false; this.setSize(width, height); }
  }

  /**
   * Detach this renderer from shared materials/geometries/textures reachable from `roots` (see releaseRenderer).
   * Call before the owner disposes its scene contents; `dispose()` then finishes the teardown.
   */
  detach(...roots: THREE.Object3D[]): void {
    for (const root of roots) {
      noteDfgLut(this.renderer, root);
      detachRenderer(root);
    }
  }

  /** Full teardown: passes, render targets, renderer, shared DFG LUT and the WebGL context (freed immediately). */
  dispose(): void {
    this.gpuTimer?.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.hdrTarget?.dispose();
    finishRenderer(this.renderer);
  }
}

export interface ResolutionPlan {
  /** Pixel ratio of the scene / post-processing buffers. */
  internal: number;
  /** Pixel ratio of the canvas. Above `internal` only while upscaling. */
  output: number;
  upscaling: boolean;
  /** Pixel ratio terrain LOD is selected for (the reconstructed resolution, before the Retina reduction). */
  lod: number;
}

/**
 * Resolution policy. The preset's device ratio is min(devicePixelRatio, maxPixelRatio). With the edge upscaler,
 * displays of ≥ 1.5× render internally at `retinaScale` of it, and any internal ratio below the device ratio
 * (Retina scale, render scale, adaptive) is upscaled into a device-resolution canvas. Without it (or when
 * supersampling) the canvas itself takes the internal ratio and the browser scales it. The map draws directly at
 * up to 2× device resolution.
 */
export function resolutionPlan(dpr: number, q: Pick<QualitySettings, 'maxPixelRatio' | 'renderScale' | 'upscale'>, adaptiveScale: number, map: boolean, minCssSide: number): ResolutionPlan {
  if (map) { const pr = Math.min(dpr, 2); return { internal: pr, output: pr, upscaling: false, lod: pr }; }
  const device = Math.min(dpr, q.maxPixelRatio);
  const edge = q.upscale.mode === 'edge';
  const retina = edge && device >= 1.5 ? q.upscale.retinaScale : 1;
  const scale = retina * q.renderScale * adaptiveScale;
  const internal = Math.max(1 / Math.max(1, minCssSide), device * scale);
  const upscaling = edge && scale < 0.98;
  return { internal, output: upscaling ? device : internal, upscaling, lod: internal / retina };
}

interface SmaaTargets { _edgesRT: THREE.WebGLRenderTarget; _weightsRT: THREE.WebGLRenderTarget }

/**
 * Runs a composer pass against the pipeline's HDR scene target instead of the composer's (8-bit) read buffer:
 * the scene renders into it, bloom composites into it, and tone mapping reads it and writes the 8-bit chain.
 */
class OnHdr extends Pass {
  constructor(readonly inner: Pass, private hdr: THREE.WebGLRenderTarget) {
    super();
    this.needsSwap = inner.needsSwap;
    this.clear = inner.clear;
  }
  setSize(width: number, height: number): void { this.inner.setSize(width, height); }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, _readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    if (!this.inner.enabled && !this.needsSwap) return; // e.g. bloom toggled off at runtime
    this.inner.renderToScreen = this.renderToScreen;
    this.inner.render(renderer, writeBuffer, this.hdr, deltaTime, maskActive);
  }
  dispose(): void { this.inner.dispose(); }
}

function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null;
  } catch {
    return null;
  }
}

function toneMappingConst(id: ToneMappingId): THREE.ToneMapping {
  switch (id) {
    case 'agx':
      return THREE.AgXToneMapping;
    case 'neutral':
      return THREE.NeutralToneMapping;
    default:
      return THREE.ACESFilmicToneMapping;
  }
}

interface TimerQueryExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** Non-blocking GPU frame timing via EXT_disjoint_timer_query_webgl2 (results arrive a few frames late). */
class GpuTimer {
  private pending: WebGLQuery[] = [];
  private free: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  private constructor(private gl: WebGL2RenderingContext, private ext: TimerQueryExt) {}

  static create(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.active || this.pending.length >= 4) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Latest completed measurement in ms, or undefined when none completed since the last poll. */
  poll(): number | undefined {
    const gl = this.gl;
    let result: number | undefined;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.free.push(q);
      if (!disjoint) result = ns / 1e6;
    }
    return result;
  }

  dispose(): void {
    for (const q of [...this.pending, ...this.free]) this.gl.deleteQuery(q);
    if (this.active) this.gl.deleteQuery(this.active);
    this.pending = []; this.free = []; this.active = null;
  }
}

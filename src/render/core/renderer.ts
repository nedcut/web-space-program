import { PhotoEffectsPass } from './PhotoEffectsPass';
import { AdaptiveQuality } from './adaptiveQuality';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
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
 *   scene → HalfFloat RT (optional MSAA) → UnrealBloom → OutputPass (tonemap + sRGB) → FXAA (optional)
 * The renderer uses a logarithmic depth buffer so one camera can span 0.05 m to 10^13 m.
 * All custom ShaderMaterials must include three's logdepthbuf chunks (see render/planet/shaders).
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  private renderPass!: RenderPass;
  private bloomPass?: UnrealBloomPass;
  private fxaaPass?: FXAAPass;
  private smaaPass?: SMAAPass;
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
    const tier = classifyGpu(this.gpuName);
    this.adaptive.scale = tier === 'strong' ? 1 : tier === 'mid' ? 0.75 : 0.6;
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

  get pixelRatio(): number {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    if (this.mapHiRes) return Math.min(dpr, 2);
    return Math.max(1 / Math.min(this.width, this.height), Math.min(dpr, this.quality.maxPixelRatio) * this.quality.renderScale * this.adaptive.scale);
  }

  private buildComposer(): void {
    const q = this.quality;
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose();
      this.composer.dispose();
    }
    const rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      samples: q.msaaSamples,
      depthBuffer: true,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    this.bloomPass = undefined;
    if (q.bloom.enabled) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), q.bloom.strength, q.bloom.radius, q.bloom.threshold);
      composer.addPass(this.bloomPass);
    }
    composer.addPass(new OutputPass());
    this.fxaaPass = undefined;
    this.smaaPass = undefined;
    if (q.aa === 'fxaa') {
      this.fxaaPass = new FXAAPass();
      composer.addPass(this.fxaaPass);
    } else if (q.aa === 'smaa') {
      this.smaaPass = new SMAAPass();
      composer.addPass(this.smaaPass);
    }
    this.photoEffects = new PhotoEffectsPass();
    composer.addPass(this.photoEffects);
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
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.fxaaPass?.setSize(this.width * pr, this.height * pr);
    this.smaaPass?.setSize(this.width * pr, this.height * pr);
  }

  /**
   * Viewport height for terrain LOD selection. The screen-space error tolerance grows with √(pixel ratio): DPR 1
   * is unchanged, while Retina keeps device-resolution shading without ~1.9× the terrain chunks (draw calls and
   * per-vertex aerial perspective) — the geometric error stays under 2.5 CSS px on Medium.
   */
  get lodViewportHeight(): number {
    const pr = this.pixelRatio;
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

  get effectiveRenderScale(): number { return this.quality.renderScale * this.adaptive.scale; }

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
      this.setSize(width * scale, height * scale);
      this.render(scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = this.renderer.domElement.width; canvas.height = this.renderer.domElement.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('PNG capture is unavailable.');
      context.drawImage(this.renderer.domElement, 0, 0); return canvas;
    } finally { this.setSize(width, height); }
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
    finishRenderer(this.renderer);
  }
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

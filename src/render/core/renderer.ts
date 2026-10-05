import { PhotoEffectsPass } from './PhotoEffectsPass';
import { AdaptiveQuality } from './adaptiveQuality';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
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
  photoEffects!: PhotoEffectsPass;
  private quality: QualitySettings;
  private adaptive = new AdaptiveQuality();
  readonly stats = { calls: 0, triangles: 0, points: 0 };
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
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 1);
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

  get pixelRatio(): number {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
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
    if (q.fxaa) {
      this.fxaaPass = new FXAAPass();
      composer.addPass(this.fxaaPass);
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
  }

  /** Viewport height in device pixels (used for screen-space LOD error). */
  get drawingBufferHeight(): number {
    return this.height * this.pixelRatio;
  }

  updateAdaptive(frameMs: number, enabled: boolean): void {
    if (this.adaptive.update(frameMs, enabled)) this.setSize(this.width, this.height);
  }

  get effectiveRenderScale(): number { return this.quality.renderScale * this.adaptive.scale; }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.photoEffects.scene = scene; this.photoEffects.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.renderer.info.reset();
    this.composer.render();
    Object.assign(this.stats, { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, points: this.renderer.info.render.points });
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

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
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

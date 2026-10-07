import { game, updateSettings } from '../../game/store';
import { classifyGpu, presetForTier } from '../../util/gpuTier';
/**
 * Render quality presets. `low` targets integrated laptop GPUs at 60 fps; `high` a discrete GPU.
 * Every renderer subsystem reads its knobs from here — never hard-code quality-dependent numbers.
 */
export type QualityId = 'low' | 'medium' | 'high';

export interface QualitySettings {
  id: QualityId;
  /** Upper bound on devicePixelRatio used for the canvas. */
  maxPixelRatio: number;
  /** Render scale applied on top of pixel ratio (dynamic resolution hook). */
  renderScale: number;
  /** MSAA samples on the HDR render target (WebGL2). 0 = off. */
  msaaSamples: number;
  /** Post-process anti-aliasing after tone mapping (SMAA: better edges, FXAA: cheapest). */
  aa: 'none' | 'fxaa' | 'smaa';
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
  /** Shadow map size for vessel/part shadows (0 = shadows off). */
  shadowMapSize: number;
  terrain: {
    /** Quads per chunk edge (vertices = res + 1). */
    chunkResolution: number;
    /** Max allowed screen-space geometric error, pixels. Lower = more detail. */
    maxScreenError: number;
    /** Target finest vertex spacing near the camera, meters. Sets the quadtree max depth. */
    minVertexSpacing: number;
    /** Main-thread time budget for uploading/building chunks per frame, ms. */
    buildBudgetMs: number;
    /** Max worker threads for chunk generation (0 = main thread only). */
    workers: number;
    /** Max concurrent in-flight chunk jobs. */
    maxInFlight: number;
    /** Max cached chunk meshes per planet before LRU eviction. */
    cacheSize: number;
    /** Triplanar close-up detail texturing. */
    detail: boolean;
  };
  scatter: { radius: number; maxAltitude: number; vegetation: boolean; cellsPerFrame: number; budgetMs: number };
  atmosphere: {
    /** Ray-march steps for sky pixels. */
    viewSteps: number;
    /** Ray-march steps for aerial perspective on terrain/ocean. */
    aerialSteps: number;
  };
  /** Equirect baked texture width for far-away planets (height = width / 2). */
  bakedTextureWidth: number;
  /** Segments for far spheres / gas giants. */
  sphereSegments: number;
  ringSegments: number;
  stars: { count: number; milkyWay: boolean };
  clouds: boolean;
  /** Fraction of launch-site scrub/pine instances drawn. */
  siteVegetation: number;
  planetDetails: {
    /** Local ring-grid radius in cells (0 disables resolved chunks). */
    ringCells: number;
    ringChunksPerCell: number;
    /** Bounded-volume sample counts (0 disables extra shells/plumes). */
    volumeSteps: number;
    plumeSteps: number;
    gasOctaves: number;
    surfaceEmission: boolean;
  };
  /** User toggle: atmospheric scattering (sky shells / aerial perspective). */
  atmosphereScattering?: boolean;
  /** Part mesh LOD: 'low' halves tessellation and drops decals (see render/parts). */
  partDetail: 'high' | 'low';
}

export const QUALITY_PRESETS: Record<QualityId, QualitySettings> = {
  low: {
    id: 'low',
    partDetail: 'low',
    scatter: { radius: 0, maxAltitude: 0, vegetation: false, cellsPerFrame: 0, budgetMs: 0 },
    maxPixelRatio: 1,
    renderScale: 0.5,
    msaaSamples: 0,
    aa: 'fxaa',
    bloom: { enabled: false, strength: 0.3, radius: 0.4, threshold: 3.0 },
    shadowMapSize: 0,
    terrain: { chunkResolution: 24, maxScreenError: 6, minVertexSpacing: 6, buildBudgetMs: 3, workers: 2, maxInFlight: 6, cacheSize: 400, detail: false },
    atmosphere: { viewSteps: 8, aerialSteps: 3 },
    bakedTextureWidth: 512,
    sphereSegments: 64,
    ringSegments: 128,
    stars: { count: 4000, milkyWay: true },
    clouds: false,
    siteVegetation: 0.35,
    planetDetails: { ringCells: 0, ringChunksPerCell: 0, volumeSteps: 0, plumeSteps: 0, gasOctaves: 2, surfaceEmission: false },
  },
  medium: {
    id: 'medium',
    partDetail: 'high',
    scatter: { radius: 256, maxAltitude: 3000, vegetation: false, cellsPerFrame: 3, budgetMs: 1.5 },
    // Full device resolution (Retina too); adaptive resolution trades pixels for frame time when the
    // GPU is the bottleneck, down to half the device ratio. The DOM HUD stays crisp regardless.
    maxPixelRatio: 2,
    renderScale: 1,
    msaaSamples: 0,
    aa: 'smaa',
    bloom: { enabled: true, strength: 0.35, radius: 0.45, threshold: 2.5 },
    shadowMapSize: 1024,
    terrain: { chunkResolution: 32, maxScreenError: 3.5, minVertexSpacing: 3, buildBudgetMs: 4, workers: 3, maxInFlight: 10, cacheSize: 700, detail: true },
    atmosphere: { viewSteps: 16, aerialSteps: 6 },
    bakedTextureWidth: 1024,
    sphereSegments: 96,
    ringSegments: 256,
    stars: { count: 9000, milkyWay: true },
    clouds: true,
    siteVegetation: 1,
    planetDetails: { ringCells: 5, ringChunksPerCell: 32, volumeSteps: 20, plumeSteps: 32, gasOctaves: 4, surfaceEmission: true },
  },
  high: {
    id: 'high',
    partDetail: 'high',
    scatter: { radius: 1024, maxAltitude: 3000, vegetation: true, cellsPerFrame: 4, budgetMs: 2 },
    maxPixelRatio: 2,
    renderScale: 1,
    msaaSamples: 4,
    aa: 'smaa',
    bloom: { enabled: true, strength: 0.4, radius: 0.5, threshold: 2.2 },
    shadowMapSize: 2048,
    terrain: { chunkResolution: 32, maxScreenError: 2, minVertexSpacing: 1.5, buildBudgetMs: 6, workers: 4, maxInFlight: 16, cacheSize: 1200, detail: true },
    atmosphere: { viewSteps: 24, aerialSteps: 8 },
    bakedTextureWidth: 2048,
    sphereSegments: 128,
    ringSegments: 512,
    stars: { count: 16000, milkyWay: true },
    clouds: true,
    siteVegetation: 1,
    planetDetails: { ringCells: 8, ringChunksPerCell: 32, volumeSteps: 32, plumeSteps: 48, gasOctaves: 5, surfaceEmission: true },
  },
};

/** Settings toggles that mirror a preset (used when the user picks a preset or on auto-configuration). */
export function presetSettings(id: QualityId) {
  const p = QUALITY_PRESETS[id];
  return { quality: id, shadows: p.shadowMapSize > 0, bloom: p.bloom.enabled, clouds: p.clouds, scatter: true, renderScale: p.renderScale };
}

/** Bumped when automatic graphics configuration should run again for existing players. */
export const GRAPHICS_PROFILE = 1;

/** WebGL renderer string (unmasked when the browser allows it), for diagnostics and GPU tiering. */
export function detectGpuRenderer(): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * First run (or a new graphics profile): pick Low for weak GPUs, Medium otherwise, and enable
 * adaptive resolution. Returns a short notice when settings changed, otherwise null.
 */
export function autoConfigureGraphics(renderer = detectGpuRenderer()): string | null {
  const s = game.get().settings;
  if (s.graphicsProfile >= GRAPHICS_PROFILE) return null;
  // No WebGL 2 right now (acceleration off, blocklisted driver): nothing to tune, and retry next launch.
  if (renderer === null) return null;
  const tier = classifyGpu(renderer);
  const quality = presetForTier(tier);
  updateSettings({ ...presetSettings(quality), adaptiveQuality: true, graphicsProfile: GRAPHICS_PROFILE });
  return `Graphics tuned for this device: ${quality === 'low' ? 'Low' : 'Medium'} quality with adaptive resolution. Change it any time in Settings → Graphics.`;
}

export function getQuality(id: QualityId): QualitySettings {
  const p = QUALITY_PRESETS[id];
  const s = game.get().settings;
  return { ...p, shadowMapSize: s.shadows ? (p.shadowMapSize || 512) : 0,
    bloom: { ...p.bloom, enabled: s.bloom }, clouds: s.clouds, atmosphereScattering: s.scatter, renderScale: s.renderScale };
}

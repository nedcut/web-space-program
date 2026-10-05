import { game } from '../../game/store';
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
  /** Post AA when MSAA is off. */
  fxaa: boolean;
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
  /** User toggle: atmospheric scattering (sky shells / aerial perspective). */
  atmosphereScattering?: boolean;
}

export const QUALITY_PRESETS: Record<QualityId, QualitySettings> = {
  low: {
    id: 'low',
    scatter: { radius: 0, maxAltitude: 0, vegetation: false, cellsPerFrame: 0, budgetMs: 0 },
    maxPixelRatio: 1,
    renderScale: 0.5,
    msaaSamples: 0,
    fxaa: true,
    bloom: { enabled: false, strength: 0.3, radius: 0.4, threshold: 3.0 },
    shadowMapSize: 0,
    terrain: { chunkResolution: 24, maxScreenError: 6, minVertexSpacing: 6, buildBudgetMs: 3, workers: 2, maxInFlight: 6, cacheSize: 400, detail: false },
    atmosphere: { viewSteps: 10, aerialSteps: 4 },
    bakedTextureWidth: 512,
    sphereSegments: 64,
    ringSegments: 128,
    stars: { count: 4000, milkyWay: true },
    clouds: false,
  },
  medium: {
    id: 'medium',
    scatter: { radius: 256, maxAltitude: 3000, vegetation: false, cellsPerFrame: 3, budgetMs: 1.5 },
    maxPixelRatio: 1.5,
    renderScale: 1,
    msaaSamples: 0,
    fxaa: true,
    bloom: { enabled: true, strength: 0.35, radius: 0.45, threshold: 2.5 },
    shadowMapSize: 1024,
    terrain: { chunkResolution: 32, maxScreenError: 3.5, minVertexSpacing: 3, buildBudgetMs: 4, workers: 3, maxInFlight: 10, cacheSize: 700, detail: true },
    atmosphere: { viewSteps: 16, aerialSteps: 6 },
    bakedTextureWidth: 1024,
    sphereSegments: 96,
    ringSegments: 256,
    stars: { count: 9000, milkyWay: true },
    clouds: true,
  },
  high: {
    id: 'high',
    scatter: { radius: 1024, maxAltitude: 3000, vegetation: true, cellsPerFrame: 4, budgetMs: 2 },
    maxPixelRatio: 2,
    renderScale: 1,
    msaaSamples: 4,
    fxaa: false,
    bloom: { enabled: true, strength: 0.4, radius: 0.5, threshold: 2.2 },
    shadowMapSize: 2048,
    terrain: { chunkResolution: 32, maxScreenError: 2, minVertexSpacing: 1.5, buildBudgetMs: 6, workers: 4, maxInFlight: 16, cacheSize: 1200, detail: true },
    atmosphere: { viewSteps: 24, aerialSteps: 8 },
    bakedTextureWidth: 2048,
    sphereSegments: 128,
    ringSegments: 512,
    stars: { count: 16000, milkyWay: true },
    clouds: true,
  },
};

export function getQuality(id: QualityId): QualitySettings {
  const p = QUALITY_PRESETS[id];
  const s = game.get().settings;
  return { ...p, shadowMapSize: s.shadows ? (p.shadowMapSize || 512) : 0,
    bloom: { ...p.bloom, enabled: s.bloom }, clouds: s.clouds, atmosphereScattering: s.scatter, renderScale: s.renderScale };
}

/** Heuristic default: pick low on likely-integrated GPUs / small devices. */
export function detectDefaultQuality(gl?: WebGL2RenderingContext | null): QualityId {
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
      if (/intel|uhd|iris|mali|adreno|powervr|apple m1/i.test(name)) return 'medium';
      if (/nvidia|geforce|rtx|radeon rx|apple m[2-9]/i.test(name)) return 'high';
    }
  } catch {
    /* ignore */
  }
  return 'medium';
}

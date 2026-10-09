import * as THREE from 'three';
import { registerColorBatch } from '../core/colorBatch';
import { decalMaterial, disposeDecals } from './decals';
import { disposeTextures, repeated, texSet, type TexSet } from './textures';

/**
 * Shared PBR material library for parts (see docs/ART.md for the families and palette).
 * Materials are created lazily and cached by key, so every part instance shares the same material
 * objects and procedural textures — and identical materials let VesselView merge static geometry.
 * Do not mutate returned materials; clone first if you need per-instance changes.
 *
 * Texture sets come from texgen/recipes.ts with a packed ORM map (R = AO, G = roughness,
 * B = metalness): `roughness`/`metalness` scalars below multiply those channels.
 */

const cache = new Map<string, THREE.Material>();

function get<M extends THREE.Material>(key: string, make: () => M): M {
  let m = cache.get(key) as M | undefined;
  if (!m) {
    m = make();
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

export function disposeMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  disposeTextures();
  disposeDecals();
}

/** Drop undefined entries (textures are absent when running headless). */
function defined<T extends object>(p: T): T {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as T;
}

/** Material maps from a texture set (optionally repeated n times per tile). */
function maps(t: TexSet, n = 1, normal = 1) {
  return {
    map: repeated(t.map, n),
    normalMap: repeated(t.normalMap, n),
    normalScale: t.normalMap ? new THREE.Vector2(normal, normal) : undefined,
    roughnessMap: repeated(t.ormMap, n),
    metalnessMap: repeated(t.ormMap, n),
    aoMap: repeated(t.ormMap, n),
  };
}
// Every part material reads the baked per-vertex AO / grime colour (see ao.ts); one shared program variant.
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(defined({ vertexColors: true, ...p }));
const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(defined({ vertexColors: true, ...p }));

/** Livery accent paints (one per manufacturer family; see livery.ts / docs/ART.md). */
export const ACCENTS = {
  red: 0xa3241f,
  blue: 0x1f4f8f,
  teal: 0x1c7a78,
  orange: 0xd9601e,
  yellow: 0xe0b021,
  green: 0x2b8a5e,
  navy: 0x1d3f78,
  maroon: 0x8e2b3a,
} as const;
export type Accent = keyof typeof ACCENTS;

/** Clear-coated paint over a texture set. */
const paint = (key: string, set: string, color: number, o: { normal?: number; rough?: number; cc?: number; ccRough?: number; tile?: number } = {}) => {
  const t = texSet(set);
  return get(key, () =>
    phys({ color, ...maps(t, o.tile ?? 1, o.normal ?? 0.8), roughness: o.rough ?? 1, metalness: t.ormMap ? 1 : 0.05, clearcoat: o.cc ?? 0.35, clearcoatRoughness: o.ccRough ?? 0.22 }),
  );
};
/** Bare metal over a texture set. */
const metal = (key: string, set: string, color: number, rough: number, o: { normal?: number; env?: number; tile?: number; metal?: number } = {}) => {
  const t = texSet(set);
  return get(key, () => std({ color, ...maps(t, o.tile ?? 1, o.normal ?? 0.5), roughness: rough, metalness: o.metal ?? 1, envMapIntensity: o.env }));
};

/** Same factory for the coloured and white material guarantees all non-colour settings stay identical. */
function colorFamily<M extends THREE.MeshStandardMaterial>(family: string, key: string, make: (color: number) => M, color: number): M {
  const neutral = get(`${family}#white`, () => make(0xffffff));
  const source = get(key, () => make(color));
  registerColorBatch(source, neutral);
  return source;
}

function foil(key: string, color: number): THREE.MeshPhysicalMaterial {
  const t = texSet('foil');
  return colorFamily('foil', key, c => phys({ color: c, ...maps(t, 1, 0.85), roughness: 1, metalness: 1, anisotropy: 0.45 }), color);
}

export const M = {
  // --- white thermal paint family -------------------------------------------------------------
  /** Gloss-white painted aluminium with panel lines, rivets, welds and light grime. */
  whitePanel: () => paint('whitePanel', 'panel', 0xf4f3ee, { normal: 1, cc: 0.18, ccRough: 0.32, tile: 0.5 }),
  /** Charcoal painted panels (interstages, adapters, skirts). */
  charcoalPanel: () => paint('charcoalPanel', 'panel', 0x2f3237, { normal: 1, cc: 0.12, ccRough: 0.3, tile: 0.5 }),
  /** Light-grey airframe panels (wings, fins). */
  greyPanel: () => paint('greyPanel', 'panel', 0xc6c9ce, { normal: 1, cc: 0.15, tile: 0.5 }),
  /** Smooth satin-white composite/paint. */
  satinWhite: () => paint('satinWhite', 'smooth', 0xf3f2ee, { normal: 0.5, cc: 0.45, ccRough: 0.18 }),
  blackPaint: () => paint('blackPaint', 'smooth', 0x18191c, { normal: 0.4, cc: 0.3, ccRough: 0.3 }),
  /** Livery accent paints. */
  accent: (which: Accent) => {
    const t = texSet('smooth');
    return colorFamily('accent', 'accent-' + which, color => phys({ color, ...maps(t, 1, 0.4), roughness: 1.1, metalness: t.ormMap ? 1 : 0.05, clearcoat: 0.6, clearcoatRoughness: 0.12 }), ACCENTS[which]);
  },

  // --- insulation -------------------------------------------------------------------------------
  /** Spray-on orange foam (albedo carries the colour). */
  orangeFoam: () => {
    const t = texSet('foam');
    return get('orangeFoam', () => std({ color: 0xffffff, ...maps(t, 1, 1), roughness: 1, metalness: 0 }));
  },
  /** Gold multi-layer insulation foil (anisotropic crinkle). */
  goldFoil: () => foil('goldFoil', 0xe7bb62),
  silverFoil: () => foil('silverFoil', 0xe0e2e5),
  /** Quilted beta-cloth blanket. */
  quilt: () => {
    const t = texSet('quilt');
    return get('quilt', () => std({ color: 0xeceae4, ...maps(t, 1, 1), roughness: 1, metalness: 0 }));
  },

  // --- metals -----------------------------------------------------------------------------------
  steel: () => metal('steel', 'brushed', 0xdfe2e6, 1, { env: 1, normal: 0.22 }),
  aluminium: () => metal('aluminium', 'brushed', 0xb9bec6, 1.5, { normal: 0.3 }),
  titanium: () => metal('titanium', 'brushed', 0x9ea5af, 1.35, { normal: 0.4 }),
  gunmetal: () => metal('gunmetal', 'metal', 0x737983, 1.2, { normal: 0.4 }),
  darkMetal: () => metal('darkMetal', 'metal', 0x34373c, 1.4, { normal: 0.4, metal: 0.45 }),
  chrome: () => metal('chrome', 'metal', 0xeef0f3, 0.3, { normal: 0.15 }),
  /** Coloured anodised aluminium (docking hardware, fittings). */
  anodised: (which: Accent) => {
    const t = texSet('metal');
    return colorFamily('anodised', 'anodised-' + which, color => std({ color, ...maps(t, 1, 0.3), roughness: 1.1, metalness: 1 }), ACCENTS[which]);
  },
  redOxide: () => metal('redOxide', 'metal', 0x8c3a22, 1.6, { normal: 0.3 }),
  /** Heat-stained, sooty engine-bay metal. */
  scorched: () => metal('scorched', 'scorch', 0xffffff, 1, { normal: 0.6 }),
  /** Anti-slip tread plate (ladders, decks). */
  deckPlate: () => metal('deckPlate', 'treadPlate', 0x9aa0a8, 1, { normal: 0.8, tile: 1 }),

  // --- engines ----------------------------------------------------------------------------------
  copperTubes: () => {
    const t = texSet('tubes');
    return get('copperTubes', () => std({ color: 0xffffff, ...maps(t, 1, 1), roughness: 1, metalness: 1 }));
  },
  steelTubes: () => {
    const t = texSet('tubes');
    return get('steelTubes', () => std({ color: 0xb8bcc6, normalMap: t.normalMap, aoMap: t.ormMap, roughnessMap: t.ormMap, roughness: 1, metalness: 1 }));
  },
  nozzleExt: () => {
    const t = texSet('nozzleExt');
    return get('nozzleExt', () => std({ color: 0xffffff, ...maps(t, 1, 0.6), roughness: 1, metalness: 1 }));
  },
  bellInterior: () => get('bellInterior', () => std({ color: 0x1b1714, roughness: 0.75, metalness: 0.5, side: THREE.BackSide })),
  innerLining: () => get('innerLining', () => std({ color: 0x55585e, roughness: 0.9, metalness: 0.1, side: THREE.BackSide })),
  soot: () => {
    const t = texSet('scorch');
    return get('soot', () => std({ color: 0x3a3634, ...maps(t, 1, 0.5), roughness: 1.4, metalness: 0.4 }));
  },
  thermalGlow: () => get('thermalGlow', () => std({ color: 0x48231b, emissive: 0xff4b12, emissiveIntensity: 0.7, roughness: 0.6 })),

  // --- thermal protection -----------------------------------------------------------------------
  shingle: () => metal('shingle', 'shingle', 0x2a2c30, 1, { normal: 1 }),
  heatTiles: () => {
    const t = texSet('tiles');
    return get('heatTiles', () => std({ color: 0xffffff, ...maps(t, 1, 1), roughness: 1, metalness: 0 }));
  },
  ablator: () => {
    const t = texSet('ablator');
    return get('ablator', () => std({ color: 0xffffff, ...maps(t, 1, 0.3), roughness: 1, metalness: 0 }));
  },

  // --- glass, composites, cells -------------------------------------------------------------------
  glass: () =>
    get('glass', () => phys({ color: 0x0b1622, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.2, ior: 1.46 })),
  solarCells: () => {
    const t = texSet('solar');
    return get('solarCells', () => phys({ color: 0xffffff, ...maps(t, 1, 1), roughness: 1, metalness: 1, clearcoat: 0.8, clearcoatRoughness: 0.06 }));
  },
  carbon: () => {
    const t = texSet('carbon');
    return get('carbon', () => phys({ color: 0xffffff, ...maps(t, 1, 0.5), roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.08 }));
  },
  hazard: () => {
    const t = texSet('hazard');
    return get('hazard', () => std({ color: 0xffffff, map: t.map, roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: t.ormMap ? 1 : 0.1 }));
  },
  rubber: () => get('rubber', () => std({ color: 0x151515, roughness: 0.9, metalness: 0 })),
  /** Treaded tyre rubber. */
  tyre: () => {
    const t = texSet('tread');
    return get('tyre', () => std({ color: 0x1c1c1d, ...maps(t, 1, 1), roughness: 1, metalness: 0 }));
  },
  louvre: () => {
    const t = texSet('louvre');
    return get('louvre', () => std({ color: 0xe8eaee, ...maps(t, 1, 1), roughness: 1, metalness: 1 }));
  },
  canopy: (scheme: 'orange' | 'red' | 'white') => {
    const t = texSet(`canopy-${scheme}`);
    return get('canopy-' + scheme, () => std({ color: 0xffffff, map: t.map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  },
  lamp: () => get('lamp', () => std({ color: 0xfff6dd, emissive: 0xfff1cf, emissiveIntensity: 2.5, roughness: 0.2 })),
  ionGrid: () => {
    const t = texSet('ionGrid');
    return get('ionGrid', () => std({ color: 0xffffff, map: t.map, emissive: 0xffffff, emissiveMap: t.emissiveMap, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.8 }));
  },
  statusLed: (which: 'green' | 'teal' | 'red') => {
    const c = { green: 0x38ff6a, teal: 0x3ff4e0, red: 0xff3a2a }[which];
    return get('led-' + which, () => std({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3 }));
  },
  cable: () => get('cable', () => std({ color: 0x1e1f22, roughness: 0.7, metalness: 0.1 })),
  line: () => get('chuteLine', () => new THREE.LineBasicMaterial({ color: 0xd8d4c8, transparent: true, opacity: 0.8 })),
  /** Shared decal atlas material (see decals.ts). */
  decal: () => decalMaterial(),
};

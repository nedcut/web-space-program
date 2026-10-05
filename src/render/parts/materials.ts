import * as THREE from 'three';
import * as T from './textures';

/**
 * Shared PBR material library for parts. Materials are created lazily and cached by key, so
 * every part instance shares the same material objects (and their procedural textures).
 * Do not mutate returned materials; clone first if you need per-instance changes.
 */

const cache = new Map<string, THREE.Material>();
const texClones = new Map<string, THREE.Texture>();

/** Shared-image clone of a texture with a different repeat (cheap; same GPU source). */
function rep(t: THREE.Texture | undefined, n: number, key: string): THREE.Texture | undefined {
  if (!t) return undefined;
  const k = `${key}@${n}`;
  let c = texClones.get(k);
  if (!c) {
    c = t.clone();
    c.repeat.set(n, n);
    c.needsUpdate = true;
    texClones.set(k, c);
  }
  return c;
}

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
  for (const t of texClones.values()) t.dispose();
  texClones.clear();
  T.disposeTextures();
}

/** Drop undefined entries (textures are absent when running headless). */
function defined<T extends object>(p: T): T {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as T;
}
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(defined(p));
const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(defined(p));

export const M = {
  /** Gloss-white painted aluminium with stringers and welds. */
  whitePanel: () => {
    const t = T.panelTex();
    return get('whitePanel', () => std({ color: 0xf1f0ec, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.05 }));
  },
  /** Charcoal painted panels (interstages, adapters). */
  charcoalPanel: () => {
    const t = T.panelTex();
    return get('charcoalPanel', () => std({ color: 0x2c2f34, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: t.roughnessMap, roughness: 1.1, metalness: 0.15 }));
  },
  /** Light-grey airframe panels (wings, fins). */
  greyPanel: () => {
    const t = T.panelTex();
    return get('greyPanel', () => std({ color: 0xc9ccd0, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.1 }));
  },
  orangeFoam: () => {
    const t = T.foamTex();
    return get('orangeFoam', () => std({ color: 0xd8742c, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0 }));
  },
  steel: () => {
    const t = T.brushedTex();
    return get('steel', () => std({ color: 0xdfe2e6, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.92, envMapIntensity: 1.4 }));
  },
  aluminium: () => {
    const t = T.brushedTex();
    return get('aluminium', () => std({ color: 0xb7bcc4, roughnessMap: t.roughnessMap, roughness: 1.4, metalness: 1 }));
  },
  darkMetal: () => get('darkMetal', () => std({ color: 0x33363b, roughness: 0.45, metalness: 0.85 })),
  gunmetal: () => {
    const t = T.brushedTex();
    return get('gunmetal', () => std({ color: 0x4a4e55, roughnessMap: t.roughnessMap, roughness: 1.6, metalness: 0.9 }));
  },
  blackPaint: () => get('blackPaint', () => std({ color: 0x17181a, roughness: 0.55, metalness: 0.1 })),
  satinWhite: () => {
    const t = T.smoothTex();
    return get('satinWhite', () => std({ color: 0xf3f2ee, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.02 }));
  },
  copperTubes: () => {
    const t = T.tubeTex();
    return get('copperTubes', () => std({ color: 0xffffff, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: t.roughnessMap, roughness: 1, metalness: 1 }));
  },
  steelTubes: () => {
    const t = T.tubeTex();
    return get('steelTubes', () => std({ color: 0xb8bcc6, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 1 }));
  },
  nozzleExt: () => {
    const t = T.nozzleExtTex();
    return get('nozzleExt', () => std({ color: 0xffffff, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: t.roughnessMap, roughness: 1, metalness: 1 }));
  },
  bellInterior: () =>
    get('bellInterior', () => std({ color: 0x1b1714, roughness: 0.75, metalness: 0.5, side: THREE.BackSide })),
  innerLining: () => get('innerLining', () => std({ color: 0x55585e, roughness: 0.9, metalness: 0.1, side: THREE.BackSide })),
  soot: () => get('soot', () => std({ color: 0x0d0c0b, roughness: 0.95, metalness: 0.2 })),
  goldFoil: () => {
    const t = T.foilTex();
    return get('goldFoil', () => std({ color: 0xe8b450, map: rep(t.map, 2, 'foilM'), normalMap: rep(t.normalMap, 2, 'foilN'), normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: rep(t.roughnessMap, 2, 'foilR'), roughness: 1, metalness: 1 }));
  },
  silverFoil: () => {
    const t = T.foilTex();
    return get('silverFoil', () => std({ color: 0xdadde2, map: rep(t.map, 2, 'foilM'), normalMap: rep(t.normalMap, 2, 'foilN'), normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: rep(t.roughnessMap, 2, 'foilR'), roughness: 1, metalness: 1 }));
  },
  quilt: () => {
    const t = T.quiltTex();
    return get('quilt', () => std({ color: 0xeceae4, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.05 }));
  },
  shingle: () => {
    const t = T.shingleTex();
    return get('shingle', () => std({ color: 0x2a2c30, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.6 }));
  },
  heatTiles: () => {
    const t = T.tileTex();
    return get('heatTiles', () => std({ color: 0xffffff, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: t.roughnessMap, roughness: 1, metalness: 0 }));
  },
  ablator: () => get('ablator', () => std({ color: 0x3b2a20, roughness: 0.9, metalness: 0 })),
  thermalGlow: () => get('thermalGlow', () => std({ color: 0x48231b, emissive: 0xff4b12, emissiveIntensity: 0.7, roughness: 0.6 })),
  glass: () =>
    get('glass', () => phys({ color: 0x0b1622, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, emissive: 0x0a1a24, emissiveIntensity: 0.4 })),
  solarCells: () => {
    const t = T.solarTex();
    return get('solarCells', () => phys({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.08 }));
  },
  hazard: () => {
    const t = T.hazardTex();
    return get('hazard', () => std({ color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0.1 }));
  },
  carbon: () => {
    const t = T.carbonTex();
    return get('carbon', () => phys({ color: 0xffffff, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.4, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }));
  },
  rubber: () => get('rubber', () => std({ color: 0x141414, roughness: 0.92, metalness: 0 })),
  chrome: () => get('chrome', () => std({ color: 0xeef0f3, roughness: 0.1, metalness: 1 })),
  titanium: () => {
    const t = T.brushedTex();
    return get('titanium', () => std({ color: 0x9fa6b0, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughnessMap: t.roughnessMap, roughness: 1.3, metalness: 1 }));
  },
  redOxide: () => get('redOxide', () => std({ color: 0x8c3a22, roughness: 0.6, metalness: 0.35 })),
  louvre: () => {
    const t = T.louvreTex();
    return get('louvre', () => std({ color: 0xe8eaee, map: t.map, normalMap: t.normalMap, roughness: 0.35, metalness: 0.7 }));
  },
  canopy: (scheme: 'orange' | 'red' | 'white') => {
    const t = T.canopyTex(scheme);
    return get('canopy-' + scheme, () => std({ color: 0xffffff, map: t.map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  },
  lamp: () => get('lamp', () => std({ color: 0xfff6dd, emissive: 0xfff1cf, emissiveIntensity: 2.5, roughness: 0.2 })),
  ionGrid: () => {
    const t = T.ionGridTex();
    return get('ionGrid', () => std({ color: 0xffffff, map: t.map, emissive: 0xffffff, emissiveMap: t.emissiveMap, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.8 }));
  },
  /** Accent paints, one per manufacturer livery. */
  accent: (which: 'red' | 'blue' | 'teal' | 'orange' | 'yellow' | 'green') => {
    const colors = { red: 0xa3241f, blue: 0x1f4f8f, teal: 0x1c7a78, orange: 0xd9601e, yellow: 0xe0b021, green: 0x2b8a3e } as const;
    return get('accent-' + which, () => std({ color: colors[which], roughness: 0.4, metalness: 0.1 }));
  },
  statusLed: (which: 'green' | 'teal' | 'red') => {
    const c = { green: 0x38ff6a, teal: 0x3ff4e0, red: 0xff3a2a }[which];
    return get('led-' + which, () => std({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3 }));
  },
  cable: () => get('cable', () => std({ color: 0x1e1f22, roughness: 0.7, metalness: 0.1 })),
  line: () => get('chuteLine', () => new THREE.LineBasicMaterial({ color: 0xd8d4c8, transparent: true, opacity: 0.8 })),
};

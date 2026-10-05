import * as THREE from 'three';
import { RECIPES, type Channel, type TexData } from './texgen/recipes';

/**
 * Procedural part texture library (main thread).
 *
 * `texSet(key)` returns DataTextures immediately, filled with a flat placeholder of the final size.
 * The real images are produced off the main thread by a small worker pool (see texgen/worker.ts),
 * which first consults an IndexedDB cache keyed by recipe + TEX_VERSION, so after the first visit
 * textures appear almost instantly and cost no CPU. When images arrive they are copied into the
 * existing texture buffers, so every material/clone sharing them updates in place.
 *
 * Headless (Node tests / server) returns empty sets; materials then use their flat parameters.
 */

export interface TexSet {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  /** Packed R = AO, G = roughness, B = metalness. */
  ormMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

const SLOT: Record<Channel, keyof TexSet> = { albedo: 'map', normal: 'normalMap', orm: 'ormMap', emissive: 'emissiveMap' };

const sets = new Map<string, TexSet>();
/** Every texture object (including repeat clones) sharing each recipe's image buffers. */
const users = new Map<string, THREE.Texture[]>();
const pending = new Set<string>();
let waiters: (() => void)[] = [];

const headless = () => typeof window === 'undefined' || typeof document === 'undefined';

function placeholder(key: string, ch: Channel, n: number): Uint8Array {
  const r = RECIPES[key];
  const d = new Uint8Array(n * n * 4);
  let px: [number, number, number];
  if (ch === 'normal') px = [128, 128, 255];
  else if (ch === 'orm') px = [255, 128, Math.round((r.metal ?? 0) * 255)];
  else if (ch === 'emissive') px = [0, 0, 0];
  else px = (r.avg ?? [0.92, 0.92, 0.92]).map((c) => Math.round(c * 255)) as [number, number, number];
  for (let i = 0; i < n * n; i++) {
    d[i * 4] = px[0];
    d[i * 4 + 1] = px[1];
    d[i * 4 + 2] = px[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}

function makeTexture(data: Uint8Array, n: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function apply(key: string, size: number, buffers: Partial<Record<Channel, ArrayBuffer>>) {
  const set = sets.get(key);
  if (!set) return;
  for (const [ch, buf] of Object.entries(buffers) as [Channel, ArrayBuffer][]) {
    const t = set[SLOT[ch]] as THREE.DataTexture | undefined;
    if (!t || t.image.width !== size) continue;
    (t.image.data as Uint8Array).set(new Uint8Array(buf));
  }
  for (const t of users.get(key) ?? []) t.needsUpdate = true;
}

function done(key: string) {
  pending.delete(key);
  if (pending.size === 0) {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  }
}

// ---------------------------------------------------------------------------------------------
// Worker pool with a main-thread fallback

let pool: Worker[] | null = null;
let rr = 0;
let fallback = false;

function workers(): Worker[] | null {
  if (fallback) return null;
  if (pool) return pool;
  try {
    const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency ?? 2) - 1));
    pool = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texgen/worker.ts', import.meta.url), { type: 'module', name: `part-textures-${i}` });
      w.onmessage = (e: MessageEvent<{ key: string; size?: number; buffers?: Partial<Record<Channel, ArrayBuffer>>; error?: string }>) => {
        const { key, size, buffers, error } = e.data;
        if (error || !buffers || !size) {
          console.warn(`[parts] texture ${key} failed in worker: ${error}`);
          generateHere(key);
          return;
        }
        apply(key, size, buffers);
        done(key);
      };
      w.onerror = (ev) => {
        ev.preventDefault();
        console.warn('[parts] texture worker unavailable; generating on the main thread');
        fallback = true;
        for (const k of pending) generateHere(k);
      };
      pool.push(w);
    }
    return pool;
  } catch {
    fallback = true;
    return null;
  }
}

/** Main-thread generation, one recipe per idle slice. */
function generateHere(key: string) {
  setTimeout(() => {
    void import('./texgen/recipes').then(({ generate }) => {
      const data: TexData = generate(key);
      const buffers: Partial<Record<Channel, ArrayBuffer>> = {};
      for (const [ch, img] of Object.entries(data)) buffers[ch as Channel] = img.data.buffer as ArrayBuffer;
      apply(key, RECIPES[key].size, buffers);
      done(key);
    });
  }, 0);
}

function request(key: string) {
  pending.add(key);
  const pool = workers();
  if (!pool) return generateHere(key);
  pool[rr++ % pool.length].postMessage({ key });
}

// ---------------------------------------------------------------------------------------------

/** Texture set for a recipe (see texgen/recipes.ts). Cached; never dispose the returned textures. */
export function texSet(key: keyof typeof RECIPES & string): TexSet {
  if (headless()) return {};
  let s = sets.get(key);
  if (s) return s;
  const r = RECIPES[key];
  s = {};
  const list: THREE.Texture[] = [];
  for (const ch of r.channels) {
    const t = makeTexture(placeholder(key, ch, r.size), r.size, ch === 'albedo' || ch === 'emissive');
    t.name = `${key}.${ch}`;
    s[SLOT[ch]] = t;
    list.push(t);
  }
  sets.set(key, s);
  users.set(key, list);
  request(key);
  return s;
}

const clones = new Map<string, THREE.Texture>();

/** A clone of a set texture with a different repeat (shares the same image and updates with it). */
export function repeated(t: THREE.Texture | undefined, n: number): THREE.Texture | undefined {
  if (!t || n === 1) return t;
  const k = `${t.name}@${n}`;
  let c = clones.get(k);
  if (!c) {
    c = t.clone();
    c.repeat.set(n, n);
    c.needsUpdate = true;
    clones.set(k, c);
    const key = t.name.split('.')[0];
    users.get(key)?.push(c);
  }
  return c;
}

/** Resolves once every texture requested so far has its final image (e.g. before thumbnails). */
export function partTexturesReady(): Promise<void> {
  if (pending.size === 0) return Promise.resolve();
  return new Promise((r) => waiters.push(r));
}

export function disposeTextures() {
  for (const set of sets.values()) for (const t of Object.values(set)) (t as THREE.Texture | undefined)?.dispose();
  for (const t of clones.values()) t.dispose();
  sets.clear();
  clones.clear();
  users.clear();
}

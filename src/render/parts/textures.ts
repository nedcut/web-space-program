import * as THREE from 'three';
import { hashString, persistTextures, takeCachedTextures } from '../core/textureCache';

/**
 * Procedural, tileable canvas textures for part materials. Everything is generated at runtime from
 * height fields (converted to tangent-space normal maps) plus albedo/roughness channels.
 * Each texture represents a 1 m x 1 m tile unless stated otherwise; geometry UVs are in metres.
 */

export interface TexSet {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

// ---------------------------------------------------------------------------------------------
// Noise (periodic so textures tile)
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = (() => {
  const r = mulberry32(1337);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

const hash2 = (x: number, y: number, s = 0) => PERM[(PERM[(x + s * 31) & 255] + y) & 255] / 255;
const smooth = (t: number) => t * t * (3 - 2 * t);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Periodic value noise in [0,1]; period (px, py) lattice cells. */
function vnoise(x: number, y: number, px: number, py: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(mod(x0, px), mod(y0, py), seed);
  const b = hash2(mod(x0 + 1, px), mod(y0, py), seed);
  const c = hash2(mod(x0, px), mod(y0 + 1, py), seed);
  const d = hash2(mod(x0 + 1, px), mod(y0 + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fBm; u,v in [0,1). */
function fbm(u: number, v: number, freq: number, oct: number, seed = 0, freqY = freq): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = freq;
  let fy = freqY;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u * fx, v * fy, fx, fy, seed + i * 7);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------------------------
// Canvas plumbing
// ---------------------------------------------------------------------------------------------

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texFromCanvas(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Field of per-pixel values in [0,1] (or arbitrary for heights). */
class Field {
  data: Float32Array;
  constructor(public w: number, public h: number) {
    this.data = new Float32Array(w * h);
  }
  fill(fn: (u: number, v: number, x: number, y: number) => number) {
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
    return this;
  }
  at(x: number, y: number) {
    return this.data[mod(y, this.h) * this.w + mod(x, this.w)];
  }
}

function grayTexture(f: Field, srgb = false): THREE.CanvasTexture {
  const c = canvas(f.w, f.h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(f.w, f.h);
  for (let i = 0; i < f.data.length; i++) {
    const g = Math.max(0, Math.min(255, Math.round(f.data[i] * 255)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return texFromCanvas(c, srgb);
}

function rgbTexture(w: number, h: number, fn: (u: number, v: number, x: number, y: number) => [number, number, number]): THREE.CanvasTexture {
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
      const i = (y * w + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      img.data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      img.data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return texFromCanvas(c, true);
}

/** Height field -> tangent-space normal map (OpenGL convention, accounting for canvas flipY). */
function normalTexture(hf: Field, strength: number): THREE.CanvasTexture {
  const { w, h } = hf;
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (hf.at(x + 1, y) - hf.at(x - 1, y)) * strength;
      const dy = (hf.at(x, y + 1) - hf.at(x, y - 1)) * strength;
      // canvas y grows downward = -v, so dh/dv = -dy.
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return texFromCanvas(c, false);
}

// Distance helpers (periodic, in UV units)
/** 1 at the line, falling to 0 at `w` (in uv). */
const ridge = (d: number, w: number) => Math.max(0, 1 - d / w);
const sstep = (e0: number, e1: number, x: number) => smooth(Math.max(0, Math.min(1, (x - e0) / (e1 - e0))));

const cache = new Map<string, TexSet>();
/** Content hash of the shared generator code; each texture set adds a hash of its own generator. */
let sourceHash = '';
const generatorHash = () => (sourceHash ||= hashString([
  mulberry32, vnoise, fbm, grayTexture, rgbTexture, normalTexture, texFromCanvas, Field, ridge, sstep, smooth, mod, hash2,
].map(String).join('\n') + PERM.join(',')));

function cached(key: string, make: () => TexSet): TexSet {
  // Headless (Node tests): no canvas, so materials fall back to flat parameters.
  if (typeof document === 'undefined') return {};
  let t = cache.get(key);
  if (!t) {
    // Warm loads reuse the PNGs stored in IndexedDB by an earlier session (see render/core/textureCache).
    const id = `parts:${key}:${generatorHash()}:${hashString(String(make))}`;
    const stored = takeCachedTextures(id);
    if (stored) {
      t = {};
      for (const e of stored) t[e.slot as keyof TexSet] = texFromCanvas(e.canvas, e.srgb);
    } else {
      t = make();
      persistTextures(`parts:${key}`, id, (Object.entries(t) as [string, THREE.Texture | undefined][])
        .filter((e): e is [string, THREE.Texture] => !!e[1] && e[1].image instanceof HTMLCanvasElement)
        .map(([slot, tex]) => ({ slot, srgb: tex.colorSpace === THREE.SRGBColorSpace, canvas: tex.image as HTMLCanvasElement })));
    }
    cache.set(key, t);
  }
  return t;
}

export function disposeTextures() {
  for (const set of cache.values()) for (const t of Object.values(set)) (t as THREE.Texture | undefined)?.dispose();
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Texture library
// ---------------------------------------------------------------------------------------------

/**
 * Painted aluminium tank skin: 4 stringers per metre, a circumferential weld every metre with
 * rivet rows alongside, faint access-panel insets and vertical grime streaks.
 */
export function panelTex(): TexSet {
  return cached('panel', () => {
    const N = 512;
    const height = new Field(N, N).fill((u, v) => {
      let hgt = 0;
      // stringers (raised ribs)
      const su = (u * 4) % 1;
      hgt += 0.35 * ridge(Math.min(su, 1 - su), 0.025);
      // weld seam groove + bead at v = 0.5
      const dv = Math.abs(v - 0.5);
      hgt -= 0.6 * ridge(dv, 0.006);
      hgt += 0.25 * ridge(Math.abs(dv - 0.012), 0.004);
      // rivet rows at v = 0.5 +- 0.03
      for (const rv of [0.47, 0.53]) {
        const ru = (u * 64) % 1;
        const d = Math.hypot((ru - 0.5) / 64, v - rv);
        hgt += 0.5 * smooth(Math.max(0, 1 - d / 0.0035));
      }
      // access panel inset on one stringer bay
      const inPanel = u > 0.29 && u < 0.46 && v > 0.12 && v < 0.3;
      const edge = Math.min(Math.abs(u - 0.29), Math.abs(u - 0.46), Math.abs(v - 0.12), Math.abs(v - 0.3));
      if (inPanel || edge < 0.003) hgt -= 0.2 * ridge(edge, 0.003);
      hgt += 0.04 * fbm(u, v, 16, 3, 3);
      return hgt;
    });
    const albedo = new Field(N, N).fill((u, v) => {
      const streak = fbm(u, v, 24, 3, 11, 2) * 0.08;
      const blot = fbm(u, v, 6, 4, 5) * 0.05;
      const seam = 0.12 * ridge(Math.abs(v - 0.5), 0.008);
      return 0.97 - streak - blot - seam;
    });
    const rough = new Field(N, N).fill((u, v) => 0.42 + 0.18 * fbm(u, v, 12, 4, 21) + 0.2 * ridge(Math.abs(v - 0.5), 0.01));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 9), roughnessMap: grayTexture(rough) };
  });
}

/** Spray-on foam insulation: popcorn bumps, blotchy tone, matte. Tile 1 m. */
export function foamTex(): TexSet {
  return cached('foam', () => {
    const N = 512;
    const height = new Field(N, N).fill((u, v) => {
      const big = fbm(u, v, 8, 3, 41);
      const pop = fbm(u, v, 48, 3, 43);
      // gentle horizontal spray bands
      const band = 0.15 * Math.sin((v * 12 + fbm(u, v, 4, 2, 44) * 2) * Math.PI * 2);
      return big * 0.8 + pop * 0.6 + band * 0.2;
    });
    const albedo = new Field(N, N).fill((u, v) => {
      const b = fbm(u, v, 5, 4, 51);
      const spots = fbm(u, v, 40, 2, 53);
      return 0.78 + b * 0.25 - Math.max(0, spots - 0.7) * 0.6;
    });
    const rough = new Field(N, N).fill((u, v) => 0.78 + 0.18 * fbm(u, v, 20, 3, 61));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 6), roughnessMap: grayTexture(rough) };
  });
}

/** Brushed stainless with circumferential grain and a weld seam per metre. */
export function brushedTex(): TexSet {
  return cached('brushed', () => {
    const N = 512;
    const height = new Field(N, N).fill((u, v) => {
      const grain = vnoise(u * 4, v * 300, 4, 300, 71) * 0.08;
      const seam = 0.5 * ridge(Math.abs(v - 0.5), 0.004) - 0.3 * ridge(Math.abs(v - 0.5), 0.01);
      const dent = fbm(u, v, 3, 3, 75) * 0.25;
      return grain + seam + dent;
    });
    const rough = new Field(N, N).fill((u, v) => {
      const g = vnoise(u * 3, v * 200, 3, 200, 72);
      return 0.2 + g * 0.06 + fbm(u, v, 6, 3, 73) * 0.08 + 0.2 * ridge(Math.abs(v - 0.5), 0.01);
    });
    const albedo = new Field(N, N).fill((u, v) => {
      const heat = ridge(Math.abs(v - 0.5), 0.03);
      return 0.92 - 0.08 * fbm(u, v, 8, 3, 77) - 0.25 * heat;
    });
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 2.5), roughnessMap: grayTexture(rough) };
  });
}

/** Crumpled multi-layer insulation foil: Voronoi facets with random slopes. */
export function foilTex(): TexSet {
  return cached('foil', () => {
    const N = 512;
    const rnd = mulberry32(99);
    const seeds: { x: number; y: number; gx: number; gy: number; a: number }[] = [];
    for (let i = 0; i < 140; i++) seeds.push({ x: rnd(), y: rnd(), gx: (rnd() - 0.5) * 2, gy: (rnd() - 0.5) * 2, a: rnd() });
    const nearest = (u: number, v: number) => {
      let best = 1e9;
      let second = 1e9;
      let bi = 0;
      for (let i = 0; i < seeds.length; i++) {
        let dx = Math.abs(u - seeds[i].x);
        let dy = Math.abs(v - seeds[i].y);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const d = dx * dx + dy * dy;
        if (d < best) {
          second = best;
          best = d;
          bi = i;
        } else if (d < second) second = d;
      }
      return { i: bi, edge: Math.sqrt(second) - Math.sqrt(best) };
    };
    const albedoF = new Field(N, N);
    const height = new Field(N, N).fill((u, v, x, y) => {
      const { i, edge } = nearest(u, v);
      const s = seeds[i];
      let dx = u - s.x;
      let dy = v - s.y;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      if (dy > 0.5) dy -= 1;
      if (dy < -0.5) dy += 1;
      albedoF.data[y * N + x] = 0.78 + s.a * 0.22 - ridge(edge, 0.004) * 0.25;
      return (dx * s.gx + dy * s.gy) * 3 + 0.02 * fbm(u, v, 40, 2, 101);
    });
    const rough = new Field(N, N).fill((u, v) => 0.18 + 0.2 * fbm(u, v, 10, 3, 103));
    return { map: grayTexture(albedoF, true), normalMap: normalTexture(height, 14), roughnessMap: grayTexture(rough) };
  });
}

/** Quilted thermal blanket: stitched pillows, 5 x 5 per metre. */
export function quiltTex(): TexSet {
  return cached('quilt', () => {
    const N = 512;
    const K = 5;
    const height = new Field(N, N).fill((u, v) => {
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      const pillow = Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), 0.35);
      const wr = fbm(u, v, 30, 3, 111) * 0.25;
      return pillow + wr;
    });
    const albedo = new Field(N, N).fill((u, v) => {
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      const seam = Math.max(ridge(Math.min(fu, 1 - fu), 0.03), ridge(Math.min(fv, 1 - fv), 0.03));
      return 0.95 - seam * 0.22 - fbm(u, v, 8, 3, 113) * 0.06;
    });
    const rough = new Field(N, N).fill((u, v) => 0.62 + 0.2 * fbm(u, v, 14, 3, 115));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 3.5), roughnessMap: grayTexture(rough) };
  });
}

/** Ablative heat-shield tiles (staggered squares, char variation). Tile = 0.5 m, 8 x 8 tiles. */
export function tileTex(): TexSet {
  return cached('tiles', () => {
    const N = 512;
    const K = 8;
    const tileId = (u: number, v: number) => {
      const row = Math.floor(v * K);
      const uo = u * K + (row % 2) * 0.5;
      return { row, col: Math.floor(uo), fu: uo % 1, fv: (v * K) % 1 };
    };
    const height = new Field(N, N).fill((u, v) => {
      const t = tileId(u, v);
      const gap = Math.min(t.fu, 1 - t.fu, t.fv, 1 - t.fv);
      const bevel = sstep(0.0, 0.06, gap);
      return bevel * (0.8 + 0.2 * hash2(t.col & 255, t.row & 255, 3)) + 0.12 * fbm(u, v, 32, 3, 121);
    });
    const map = rgbTexture(N, N, (u, v) => {
      const t = tileId(u, v);
      const gap = Math.min(t.fu, 1 - t.fu, t.fv, 1 - t.fv);
      const tone = 0.7 + 0.3 * hash2(t.col & 255, t.row & 255, 7);
      const char = fbm(u, v, 6, 4, 125);
      const g = gap < 0.03 ? 0.25 : 1;
      const base = 0.17 * tone * g * (0.75 + 0.5 * char);
      return [base * 1.25, base * 1.0, base * 0.85];
    });
    const rough = new Field(N, N).fill((u, v) => 0.82 + 0.15 * fbm(u, v, 16, 3, 127));
    return { map, normalMap: normalTexture(height, 5), roughnessMap: grayTexture(rough) };
  });
}

/** Regenerative-cooling tubes for engine bells: 8 tubes across one tile (u), axial along v. */
export function tubeTex(): TexSet {
  return cached('tubes', () => {
    const W = 256;
    const H = 256;
    const T = 8;
    const height = new Field(W, H).fill((u, v) => {
      const f = (u * T) % 1;
      const x = f * 2 - 1;
      return Math.sqrt(Math.max(0, 1 - x * x)) * 0.8 + 0.06 * fbm(u, v, 8, 2, 131);
    });
    const map = rgbTexture(W, H, (u, v) => {
      const f = (u * T) % 1;
      const crease = ridge(Math.min(f, 1 - f), 0.12);
      const n = fbm(u, v, 6, 4, 133);
      const k = 0.85 + 0.25 * n - crease * 0.35;
      return [0.86 * k, 0.6 * k, 0.45 * k];
    });
    const rough = new Field(W, H).fill((u, v) => 0.3 + 0.25 * fbm(u, v, 10, 3, 135) + 0.2 * ridge(Math.min((u * T) % 1, 1 - ((u * T) % 1)), 0.1));
    return { map, normalMap: normalTexture(height, 6), roughnessMap: grayTexture(rough) };
  });
}

/** Heat-tinted radiative nozzle extension (blue/straw/purple temper colours along v). */
export function nozzleExtTex(): TexSet {
  return cached('nozzleExt', () => {
    const W = 256;
    const H = 256;
    const map = rgbTexture(W, H, (u, v) => {
      const n = fbm(u, v, 4, 3, 141) * 0.15;
      const t = v + n;
      // straw near the top (hot), then purple, then blue-grey
      const c1 = [0.62, 0.5, 0.32];
      const c2 = [0.36, 0.28, 0.42];
      const c3 = [0.3, 0.34, 0.42];
      const a = sstep(0.55, 0.95, t);
      const b = sstep(0.2, 0.55, t);
      const mix = (p: number[], q: number[], k: number) => p.map((x, i) => x + (q[i] - x) * k);
      return mix(c3, mix(c2, c1, a), b) as [number, number, number];
    });
    const height = new Field(W, H).fill((u, v) => 0.6 * ridge(Math.abs(((v * 4) % 1) - 0.5), 0.02) + 0.05 * fbm(u, v, 20, 2, 143));
    const rough = new Field(W, H).fill((u, v) => 0.28 + 0.12 * fbm(u, v, 8, 3, 145));
    return { map, normalMap: normalTexture(height, 4), roughnessMap: grayTexture(rough) };
  });
}

/** Monocrystalline solar cells, 4 x 4 cells per tile (0.5 m), chamfered corners and busbars. */
export function solarTex(): TexSet {
  return cached('solar', () => {
    const N = 512;
    const K = 4;
    const map = rgbTexture(N, N, (u, v) => {
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      const gap = Math.min(fu, 1 - fu, fv, 1 - fv);
      const corner = Math.min(fu, 1 - fu) + Math.min(fv, 1 - fv) < 0.12;
      if (gap < 0.018 || corner) return [0.82, 0.84, 0.86];
      const bus = Math.abs(fu - 0.33) < 0.006 || Math.abs(fu - 0.66) < 0.006;
      if (bus) return [0.75, 0.76, 0.78];
      const finger = ((fv * 40) % 1) < 0.06;
      const n = fbm(u, v, 20, 2, 151) * 0.04;
      if (finger) return [0.16, 0.2, 0.32];
      return [0.04 + n, 0.07 + n, 0.2 + n * 2];
    });
    const rough = new Field(N, N).fill((u, v) => {
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      const gap = Math.min(fu, 1 - fu, fv, 1 - fv);
      return gap < 0.018 ? 0.5 : 0.15;
    });
    const height = new Field(N, N).fill((u, v) => {
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      return sstep(0, 0.03, Math.min(fu, 1 - fu, fv, 1 - fv));
    });
    return { map, normalMap: normalTexture(height, 2), roughnessMap: grayTexture(rough) };
  });
}

/** Vertical corrugated shingles for the single-seat capsule (dark). Tile 0.5 m. */
export function shingleTex(): TexSet {
  return cached('shingle', () => {
    const N = 512;
    const height = new Field(N, N).fill((u, v) => {
      const rib = Math.abs(Math.sin(u * Math.PI * 10)) ** 0.6;
      const step = (v * 4) % 1; // sawtooth shingle overlap
      return rib * 0.35 + step * 0.9 + 0.04 * fbm(u, v, 30, 2, 161);
    });
    const albedo = new Field(N, N).fill((u, v) => 0.85 + 0.15 * fbm(u, v, 10, 3, 163) - 0.25 * ridge(((v * 4) % 1), 0.04));
    const rough = new Field(N, N).fill((u, v) => 0.35 + 0.25 * fbm(u, v, 12, 3, 165));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 3), roughnessMap: grayTexture(rough) };
  });
}

/** Yellow/black diagonal hazard stripes with worn edges. Tile 0.25 m along u. */
export function hazardTex(): TexSet {
  return cached('hazard', () => {
    const N = 256;
    const map = rgbTexture(N, N, (u, v) => {
      const s = ((u + v) * 4) % 1;
      const wear = fbm(u, v, 16, 3, 171);
      const yellow = s < 0.5;
      const k = 0.85 + 0.15 * wear;
      if (wear > 0.72) return [0.45, 0.45, 0.45];
      return yellow ? [0.95 * k, 0.72 * k, 0.08 * k] : [0.05, 0.05, 0.05];
    });
    const rough = new Field(N, N).fill((u, v) => 0.55 + 0.25 * fbm(u, v, 16, 3, 172));
    return { map, roughnessMap: grayTexture(rough) };
  });
}

/** 2x2 twill carbon weave. Tile 0.1 m (use tile 0.1 in UVs). */
export function carbonTex(): TexSet {
  return cached('carbon', () => {
    const N = 256;
    const K = 16;
    const height = new Field(N, N).fill((u, v) => {
      const cu = Math.floor(u * K);
      const cv = Math.floor(v * K);
      const over = ((cu + cv) >> 1) % 2 === 0;
      const fu = (u * K) % 1;
      const fv = (v * K) % 1;
      return over ? Math.sin(Math.PI * fu) * 0.6 : Math.sin(Math.PI * fv) * 0.6;
    });
    const albedo = new Field(N, N).fill((u, v) => {
      const cu = Math.floor(u * K);
      const cv = Math.floor(v * K);
      const over = ((cu + cv) >> 1) % 2 === 0;
      return over ? 0.16 : 0.1;
    });
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 2) };
  });
}

/** Parachute gores. 12 gores around u; two-colour scheme with reinforcing tapes. */
export function canopyTex(scheme: 'orange' | 'red' | 'white'): TexSet {
  return cached('canopy-' + scheme, () => {
    const colors: Record<string, [number[], number[]]> = {
      orange: [[0.95, 0.42, 0.08], [0.94, 0.93, 0.9]],
      red: [[0.75, 0.1, 0.08], [0.94, 0.93, 0.9]],
      white: [[0.94, 0.93, 0.9], [0.7, 0.72, 0.75]],
    };
    const [a, b] = colors[scheme];
    const map = rgbTexture(256, 256, (u, v) => {
      const g = Math.floor(u * 12) % 2 === 0 ? a : b;
      const fu = (u * 12) % 1;
      const tape = Math.min(fu, 1 - fu) < 0.03 || ((v * 6) % 1) < 0.03;
      const k = tape ? 0.8 : 1;
      return [g[0] * k, g[1] * k, g[2] * k];
    });
    return { map };
  });
}

/** Ion grid perforation (hex holes) as emissive + albedo. Tile = grid diameter. */
export function ionGridTex(): TexSet {
  return cached('ionGrid', () => {
    const N = 256;
    const K = 18;
    const holeMask = (u: number, v: number) => {
      const y = v * K;
      const row = Math.floor(y);
      const x = u * K + (row % 2) * 0.5;
      const d = Math.hypot((x % 1) - 0.5, (y % 1) - 0.5);
      return d < 0.32 ? 1 : 0;
    };
    const map = rgbTexture(N, N, (u, v) => (holeMask(u, v) ? [0.02, 0.02, 0.03] : [0.35, 0.36, 0.38]));
    const emissiveMap = rgbTexture(N, N, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5);
      const fall = Math.max(0, 1 - r * 2);
      return holeMask(u, v) ? [0.4 * fall, 0.75 * fall, 1.0 * fall] : [0, 0, 0];
    });
    return { map, emissiveMap };
  });
}

/** Smooth composite / painted skin with very subtle orange-peel and a single seam. */
export function smoothTex(): TexSet {
  return cached('smooth', () => {
    const N = 256;
    const height = new Field(N, N).fill((u, v) => fbm(u, v, 24, 3, 181) * 0.3 - 0.6 * ridge(Math.abs(v - 0.5), 0.005));
    const albedo = new Field(N, N).fill((u, v) => 0.96 - 0.05 * fbm(u, v, 6, 3, 183));
    const rough = new Field(N, N).fill((u, v) => 0.35 + 0.15 * fbm(u, v, 10, 3, 185));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 3), roughnessMap: grayTexture(rough) };
  });
}

/** Radiator / louvre panel: fine horizontal slats. Tile 0.25 m. */
export function louvreTex(): TexSet {
  return cached('louvre', () => {
    const N = 256;
    const height = new Field(N, N).fill((u, v) => ((v * 16) % 1) * 0.8);
    const albedo = new Field(N, N).fill((u, v) => 0.9 - 0.3 * ridge(((v * 16) % 1), 0.08));
    return { map: grayTexture(albedo, true), normalMap: normalTexture(height, 2.5) };
  });
}

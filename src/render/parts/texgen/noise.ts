/**
 * DOM-free, deterministic noise and image-field helpers for procedural part textures.
 * Runs in a Web Worker (or the main thread as a fallback). Everything is periodic on [0,1)² so
 * textures tile seamlessly. Image rows run bottom-up: row 0 is v = 0 (DataTexture, flipY = false).
 */

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

export const hash2 = (x: number, y: number, s = 0) => PERM[(PERM[(x + s * 31) & 255] + y) & 255] / 255;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (x: number) => x - Math.floor(x);

/** Periodic value noise in [0,1]; period (px, py) lattice cells. */
export function vnoise(x: number, y: number, px: number, py: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const xa = mod(x0, px);
  const xb = mod(x0 + 1, px);
  const ya = mod(y0, py);
  const yb = mod(y0 + 1, py);
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fBm in [0,1]; u,v in [0,1). freq must be an integer for tiling. */
export function fbm(u: number, v: number, freq: number, oct: number, seed = 0, freqY = freq): number {
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

/** Ridged fBm (sharp creases), [0,1]. */
export function ridged(u: number, v: number, freq: number, oct: number, seed = 0, freqY = freq): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = freq;
  let fy = freqY;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(u * fx, v * fy, fx, fy, seed + i * 13) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/** 1 at the line, falling to 0 at `w` (in uv). */
export const ridge = (d: number, w: number) => Math.max(0, 1 - d / w);
export const sstep = (e0: number, e1: number, x: number) => smooth(clamp01((x - e0) / (e1 - e0)));
/** Distance to the nearest multiple of 1/n (periodic grid lines), in uv. */
export const gridDist = (x: number, n: number) => {
  const f = fract(x * n);
  return Math.min(f, 1 - f) / n;
};

/** Field of per-pixel scalar values. */
export class Field {
  data: Float32Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.data = new Float32Array(w * h);
  }
  fill(fn: (u: number, v: number, x: number, y: number) => number) {
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) data[y * w + x] = fn((x + 0.5) / w, v, x, y);
    }
    return this;
  }
  at(x: number, y: number) {
    return this.data[mod(y, this.h) * this.w + mod(x, this.w)];
  }
}

/** RGBA8 image buffer. */
export interface Img {
  w: number;
  h: number;
  data: Uint8Array;
}

const b8 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255));

/** Gray (r=g=b) image from a field. */
export function grayImg(f: Field): Img {
  const data = new Uint8Array(f.w * f.h * 4);
  for (let i = 0; i < f.data.length; i++) {
    const g = b8(f.data[i]);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g;
    data[i * 4 + 3] = 255;
  }
  return { w: f.w, h: f.h, data };
}

/** RGB(A) image from a per-pixel callback writing into `out` ([r,g,b] or [r,g,b,a], 0..1). */
export function rgbImg(w: number, h: number, fn: (u: number, v: number, out: number[], x: number, y: number) => void): Img {
  const data = new Uint8Array(w * h * 4);
  const out = [0, 0, 0, 1];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      out[3] = 1;
      fn((x + 0.5) / w, v, out, x, y);
      const i = (y * w + x) * 4;
      data[i] = b8(out[0]);
      data[i + 1] = b8(out[1]);
      data[i + 2] = b8(out[2]);
      data[i + 3] = b8(out[3]);
    }
  }
  return { w, h, data };
}

/** Pack AO, roughness and metalness fields into one ORM image (R = AO, G = roughness, B = metalness). */
export function ormImg(ao: Field | number, rough: Field | number, metal: Field | number, w: number, h: number): Img {
  const data = new Uint8Array(w * h * 4);
  const val = (f: Field | number, i: number) => (typeof f === 'number' ? f : f.data[i]);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = b8(val(ao, i));
    data[i * 4 + 1] = b8(val(rough, i));
    data[i * 4 + 2] = b8(val(metal, i));
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}

/**
 * Height field -> tangent-space normal map (OpenGL convention, +Y = +v since rows run bottom-up).
 * `strength` scales slopes in "height units per texel".
 */
export function normalImg(hf: Field, strength: number): Img {
  const { w, h } = hf;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (hf.at(x + 1, y) - hf.at(x - 1, y)) * strength;
      const dy = (hf.at(x, y + 1) - hf.at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  return { w, h, data };
}

/**
 * Cavity/ambient-occlusion estimate from a height field: compares each texel against a blurred
 * neighbourhood (grooves darken, ridges stay lit). Returns values in [floor, 1].
 */
export function cavityAO(hf: Field, radius: number, strength: number, floor = 0.35): Field {
  const { w, h } = hf;
  // separable box blur, periodic
  const tmp = new Float32Array(w * h);
  const blur = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius));
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += hf.at(i, y);
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s * k;
      s += hf.at(x + r + 1, y) - hf.at(x - r, y);
    }
  }
  const at = (x: number, y: number) => tmp[mod(y, h) * w + mod(x, w)];
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += at(x, i);
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = s * k;
      s += at(x, y + r + 1) - at(x, y - r);
    }
  }
  const out = new Field(w, h);
  for (let i = 0; i < w * h; i++) out.data[i] = Math.max(floor, Math.min(1, 1 + (hf.data[i] - blur[i]) * strength));
  return out;
}

/** Periodic Worley/Voronoi over jittered grid cells: nearest distance, edge distance and cell id. */
export function voronoi(u: number, v: number, cells: number, seed: number, sx = 1, sy = 1) {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = mod(cx + i, cells);
      const gy = mod(cy + j, cells);
      const px = cx + i + hash2(gx, gy, seed);
      const py = cy + j + hash2(gx, gy, seed + 17);
      const dx = (px - x) * sx;
      const dy = (py - y) * sy;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = gx * 131 + gy;
      } else if (d < d2) d2 = d;
    }
  return { d1: Math.sqrt(d1), edge: Math.sqrt(d2) - Math.sqrt(d1), id };
}

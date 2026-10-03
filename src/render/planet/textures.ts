import * as THREE from 'three';
import { mulberry32 } from '../../sim/terrain/noise';

/**
 * Tileable detail texture (256²): R = height (fbm), G/B = d(height)/du, d(height)/dv (packed 0.5-centred),
 * A = second decorrelated noise. Periodic, so sampling at worldPos/scale with scales dividing 1024 m is
 * seamless across the per-chunk 1024 m-aligned detail offsets.
 */
let detailTex: THREE.DataTexture | null = null;
export function getDetailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const N = 256;
  const h = periodicFbm(N, 7, 0.55, 1337, 4);
  const h2 = periodicFbm(N, 6, 0.5, 4242, 8);
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const dx = (h[j * N + ((i + 1) % N)] - h[j * N + ((i - 1 + N) % N)]) * 0.5 * N;
      const dy = (h[((j + 1) % N) * N + i] - h[((j - 1 + N) % N) * N + i]) * 0.5 * N;
      data[k * 4] = Math.round(h[k] * 255);
      data[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + dx / 64)) * 255);
      data[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + dy / 64)) * 255);
      data[k * 4 + 3] = Math.round(h2[k] * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  detailTex = tex;
  return tex;
}

/** Periodic value-noise fbm on an N×N torus, normalised to [0,1]. */
function periodicFbm(N: number, octaves: number, gain: number, seed: number, baseFreq: number): Float32Array {
  const out = new Float32Array(N * N);
  const rnd = mulberry32(seed);
  let amp = 1;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(freq * freq);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let j = 0; j < N; j++) {
      const fy = (j / N) * freq;
      const y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let i = 0; i < N; i++) {
        const fx = (i / N) * freq;
        const x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % freq, y1 = (y0 + 1) % freq;
        const a = lat[y0 * freq + x0], b = lat[y0 * freq + x1], c = lat[y1 * freq + x0], d = lat[y1 * freq + x1];
        out[j * N + i] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    amp *= gain;
    freq = Math.min(freq * 2, N);
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

interface RingBand {
  /** km (real scale) */
  r0: number;
  r1: number;
  opacity: number;
  color: [number, number, number];
  /** opacity ramp: opacity at r0 multiplied by `rampFrom`, linearly to 1 at r1 */
  rampFrom?: number;
}

const SATURN_BANDS: RingBand[] = [
  { r0: 66900, r1: 74490, opacity: 0.03, color: [0.42, 0.38, 0.34] }, // D
  { r0: 74490, r1: 91980, opacity: 0.12, color: [0.42, 0.37, 0.32], rampFrom: 0.6 }, // C
  { r0: 91980, r1: 117580, opacity: 0.93, color: [0.86, 0.76, 0.6], rampFrom: 0.55 }, // B
  { r0: 117580, r1: 122170, opacity: 0.07, color: [0.4, 0.37, 0.33] }, // Cassini division
  { r0: 122170, r1: 136775, opacity: 0.6, color: [0.78, 0.71, 0.6], rampFrom: 1.15 }, // A
  { r0: 136775, r1: 139900, opacity: 0.0, color: [0.5, 0.5, 0.5] },
  { r0: 139900, r1: 140200, opacity: 0.45, color: [0.75, 0.7, 0.62] }, // F
];
const SATURN_GAPS: [number, number][] = [
  [87400, 87650], // Maxwell
  [133423, 133745], // Encke
  [136485, 136527], // Keeler
  [119000, 119200], // Huygens-ish ringlet gap inside Cassini
];

const URANUS_RINGS: { r: number; w: number; o: number }[] = [
  { r: 41837, w: 30, o: 0.5 }, { r: 42234, w: 30, o: 0.5 }, { r: 42571, w: 30, o: 0.55 },
  { r: 44718, w: 40, o: 0.6 }, { r: 45661, w: 40, o: 0.6 }, { r: 47176, w: 30, o: 0.35 },
  { r: 47627, w: 30, o: 0.55 }, { r: 48300, w: 40, o: 0.6 }, { r: 51100, w: 90, o: 0.9 },
];

/**
 * Radial ring profile texture (2048×1, RGBA): RGB = linear albedo, A = opacity (normal incidence).
 * u ∈ [0,1] maps innerRadius..outerRadius of the RingDef. Profiles are authored in real km and mapped
 * proportionally, so they stay correct at any universe scale.
 */
export function buildRingProfile(profile: string | undefined, innerKmReal: number, outerKmReal: number, opacityScale: number): THREE.DataTexture {
  const W = 2048;
  const data = new Uint8Array(W * 4);
  const rnd = mulberry32(777);
  // Fine ringlet noise: sum of random sinusoids in radius.
  const waves = Array.from({ length: 24 }, () => ({ f: 20 + rnd() * 900, p: rnd() * Math.PI * 2, a: 0.3 + rnd() * 0.7 }));
  const ringlets = (u: number) => {
    let s = 0, n = 0;
    for (const w of waves) { s += w.a * Math.sin(u * w.f + w.p); n += w.a; }
    return s / n;
  };
  for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W;
    const r = innerKmReal + u * (outerKmReal - innerKmReal);
    let col: [number, number, number] = [0.5, 0.5, 0.5];
    let op = 0;
    if (profile === 'saturn') {
      for (const b of SATURN_BANDS) {
        if (r >= b.r0 && r < b.r1) {
          const t = (r - b.r0) / (b.r1 - b.r0);
          op = b.opacity * (b.rampFrom !== undefined ? b.rampFrom + (1 - b.rampFrom) * t : 1);
          col = b.color;
        }
      }
      for (const [g0, g1] of SATURN_GAPS) if (r >= g0 && r <= g1) op *= 0.05;
      op *= 0.82 + 0.36 * ringlets(u);
      const shade = 0.92 + 0.16 * ringlets(u * 1.7 + 3);
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
      op *= opacityScale / 0.85;
    } else if (profile === 'uranus') {
      const kmPerTexel = (outerKmReal - innerKmReal) / W;
      for (const ring of URANUS_RINGS) {
        const w = Math.max(ring.w, kmPerTexel * 1.5);
        const d = Math.abs(r - ring.r) / w;
        if (d < 1.5) op = Math.max(op, ring.o * Math.exp(-d * d * 2) * (ring.w / w));
      }
      col = [0.22, 0.22, 0.24];
      op *= opacityScale / 0.18;
    } else {
      // Jupiter-like faint dusty rings: halo + main ring + gossamer.
      const main = r > 122500 && r < 129000 ? 1 : 0;
      const halo = r > 92000 && r < 122500 ? 0.25 * ((r - 92000) / 30500) : 0;
      const gossamer = r > 129000 ? 0.12 * Math.max(0, 1 - (r - 129000) / 97000) : 0;
      op = (main + halo + gossamer) * opacityScale * 4;
      col = [0.55, 0.42, 0.32];
    }
    data[i * 4] = Math.round(Math.min(1, col[0]) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, col[1]) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, col[2]) * 255);
    data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, op)) * 255);
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

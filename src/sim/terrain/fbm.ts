import type { Simplex3 } from './noise';

/**
 * Fractal noise helpers on top of Simplex3. All return values are normalised to roughly [-1, 1]
 * (fbm) or [0, 1] (ridged) so callers can scale by relief with a known bound.
 */

/** Per-octave coordinate offsets to decorrelate octaves (avoid artifacts at the origin). */
const OFF = [0, 17.13, -31.7, 47.9, -63.1, 79.3, -91.7, 103.9, -117.2, 131.5, -149.1, 163.7, -179.3, 191.1, -207.7, 223.9, -239.3, 257.1, -271.7, 283.9];

/** Fractional Brownian motion. Normalised by the sum of amplitudes → |result| <= ~1. */
export function fbm(n: Simplex3, x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const off = OFF[o % OFF.length];
    sum += amp * n.noise(x * f + off, y * f - off, z * f + off * 0.5);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave). Sharp crests, eroded-looking valleys. Returns [0, 1].
 * Detail is weighted by the previous octave's signal, so ridges get detail and valleys stay smooth.
 */
export function ridged(n: Simplex3, x: number, y: number, z: number, octaves: number, lacunarity = 2.1, gain = 0.5, offset = 1, sharpness = 2): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    const off = OFF[(o + 3) % OFF.length];
    let s = offset - Math.abs(n.noise(x * f + off, y * f + off * 0.7, z * f - off));
    s = s * s;
    s *= weight;
    weight = Math.min(1, Math.max(0, s * sharpness));
    sum += s * amp;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return Math.min(1, sum / norm);
}

/** Billowy noise (|noise| fbm) in [0, 1]. Good for dunes / puffy hills. */
export function billow(n: Simplex3, x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const off = OFF[(o + 7) % OFF.length];
    sum += amp * Math.abs(n.noise(x * f - off, y * f + off, z * f + off * 0.3));
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Number of octaves needed to go from base frequency f0 (on the unit sphere) down to `minWavelength` meters. */
export function octavesFor(radius: number, f0: number, minWavelength: number, lacunarity = 2, maxOctaves = 18): number {
  const ratio = radius / (f0 * Math.max(minWavelength, 1e-3));
  const o = Math.ceil(Math.log(Math.max(ratio, 1)) / Math.log(lacunarity));
  return Math.max(1, Math.min(maxOctaves, o));
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Polynomial smooth minimum. */
export const smin = (a: number, b: number, k: number): number => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
};
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

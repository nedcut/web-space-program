import type { BodyDef } from '../../bodies/types';
import type { RGB } from '../api';
import { Simplex3 } from '../noise';

export interface PresetContext {
  body: BodyDef;
  /** Datum radius, meters (scaled). */
  radius: number;
  /** Max relief, meters (scaled). */
  relief: number;
  seed: number;
  /** Seeded noise generator #k (cached). */
  noise(k: number): Simplex3;
  /** Palette colour i from surface.colors, else fallback. */
  pal(i: number, fallback: RGB): RGB;
  /** Smallest wavelength (meters) of procedural detail. */
  minWavelength: number;
}

export interface PresetResult {
  height(x: number, y: number, z: number): number;
  /** Conservative bounds in meters. */
  maxHeight: number;
  minHeight: number;
  colorAt?(x: number, y: number, z: number, h: number, out: RGB): RGB;
}

export function makeContext(body: BodyDef, minWavelength = 6): PresetContext {
  const seed = (body.surface?.seed ?? 1) | 0;
  const cache = new Map<number, Simplex3>();
  const colors = body.surface?.colors ?? [];
  return {
    body,
    radius: body.radius,
    relief: Math.max(0, body.surface?.relief ?? 0),
    seed,
    minWavelength,
    noise(k: number) {
      let n = cache.get(k);
      if (!n) {
        n = new Simplex3((seed * 1013 + k * 7919 + 12345) | 0);
        cache.set(k, n);
      }
      return n;
    },
    pal(i, fallback) {
      const c = colors[i];
      return c ? [c[0], c[1], c[2]] : fallback;
    },
  };
}

export function setRGB(out: RGB, r: number, g: number, b: number): RGB {
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

export function mixRGB(out: RGB, a: RGB, b: RGB, t: number): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** out = mix(out, c, t) in place. */
export function blendRGB(out: RGB, c: RGB, t: number): RGB {
  if (t <= 0) return out;
  if (t >= 1) return setRGB(out, c[0], c[1], c[2]);
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
  return out;
}

export function scaleRGB(out: RGB, s: number): RGB {
  out[0] *= s;
  out[1] *= s;
  out[2] *= s;
  return out;
}

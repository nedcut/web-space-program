/**
 * Equirectangular bake of a body's albedo + height for the far-away LOD sphere. Pure TS (worker-safe).
 * Layout: u = (lon + π) / 2π, v = (lat + π/2) / π (row 0 = south pole), RGB = sRGB-encoded albedo,
 * A = normalised height (0 = minHeight, 255 = maxHeight).
 */
import type { Terrain, RGB } from '../../sim/terrain/api';

export interface BakeResult {
  width: number;
  height: number;
  data: Uint8Array;
  minHeight: number;
  maxHeight: number;
  ms: number;
}

function linearToSrgb(c: number): number {
  c = c < 0 ? 0 : c > 1 ? 1 : c;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Bake rows [row0, row1) into `data` (allows incremental/time-sliced baking on the main thread). */
export function bakeRows(terrain: Terrain, width: number, height: number, data: Uint8Array, row0: number, row1: number, lo: number, hi: number): void {
  const col: RGB = [0, 0, 0];
  const inv = hi > lo ? 1 / (hi - lo) : 0;
  for (let j = row0; j < row1; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2 - Math.PI;
      const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
      const h = terrain.heightAt(x, y, z);
      if (terrain.colorAt) terrain.colorAt(x, y, z, h, col);
      else { col[0] = col[1] = col[2] = 0.5; }
      const k = (j * width + i) * 4;
      data[k] = Math.round(linearToSrgb(col[0]) * 255);
      data[k + 1] = Math.round(linearToSrgb(col[1]) * 255);
      data[k + 2] = Math.round(linearToSrgb(col[2]) * 255);
      data[k + 3] = Math.round(Math.min(1, Math.max(0, (h - lo) * inv)) * 255);
    }
  }
}

export function bakeEquirect(terrain: Terrain, width: number): BakeResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const height = Math.max(1, width >> 1);
  const data = new Uint8Array(width * height * 4);
  const lo = terrain.minHeight;
  const hi = Math.max(terrain.maxHeight, lo + 1);
  bakeRows(terrain, width, height, data, 0, height, lo, hi);
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return { width, height, data, minHeight: lo, maxHeight: hi, ms: t1 - t0 };
}

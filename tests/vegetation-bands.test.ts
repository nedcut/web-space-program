import { describe, expect, it } from 'vitest';
import { packBand } from '../src/render/site/vegetationBands';

// Levels as used by the launch site: detailed < 400, mid 300–1600, coarse 1200–10000 (m), widened by the 20 m step.
const LEVELS = [[0, 400], [300, 1600], [1200, 10000]];
const STEP = 20;

describe('vegetation LOD bands', () => {
  const n = 2000;
  const xyz = new Float32Array(n * 3), matrices = new Float32Array(n * 16), colors = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 185 + rnd() * 2600;
    xyz.set([Math.cos(a) * r, rnd() * 5, Math.sin(a) * r], i * 3);
    matrices[i * 16 + 12] = xyz[i * 3]; matrices[i * 16 + 13] = i; matrices[i * 16 + 14] = xyz[i * 3 + 2];
    colors[i * 3] = i;
  }
  const pack = (cam: { x: number; y: number; z: number }) => LEVELS.map(([lo, hi]) => {
    const m = new Float32Array(n * 16), c = new Float32Array(n * 3);
    const k = packBand(xyz, matrices, colors, cam, Math.max(0, lo - STEP), hi + STEP, m, c);
    return new Set(Array.from({ length: k }, (_, j) => c[j * 3]));
  });

  it('every instance within the fade distance is drawn by a level covering its distance, including after a stale move', () => {
    for (const cam of [{ x: 0, y: 2, z: 0 }, { x: 900, y: 50, z: -400 }, { x: -2500, y: 3000, z: 100 }]) {
      const bands = pack(cam);
      // The partition may be up to STEP metres stale: test from a camera moved by just under STEP.
      const moved = { x: cam.x + STEP * 0.99, y: cam.y, z: cam.z };
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(xyz[i * 3] - moved.x, xyz[i * 3 + 1] - moved.y, xyz[i * 3 + 2] - moved.z);
        LEVELS.forEach(([lo, hi], level) => { if (d >= lo && d < hi) expect(bands[level].has(i)).toBe(true); });
      }
    }
  });

  it('packs matrices and colours densely and in order', () => {
    const m = new Float32Array(n * 16), c = new Float32Array(n * 3);
    const k = packBand(xyz, matrices, colors, { x: 0, y: 0, z: 0 }, 0, 400, m, c);
    expect(k).toBeGreaterThan(0);
    for (let j = 0; j < k; j++) expect(m[j * 16 + 13]).toBe(c[j * 3]);
    for (let j = 1; j < k; j++) expect(c[j * 3]).toBeGreaterThan(c[(j - 1) * 3]);
  });
});

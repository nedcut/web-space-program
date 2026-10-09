import { describe, it, expect } from 'vitest';
import { CraterField, craterProfile, makeCraterOctaves, type CraterOctave } from '../src/sim/terrain/craters';
import { hash3, hashNext } from '../src/sim/terrain/noise';
import { clamp } from '../src/sim/terrain/fbm';

const R = 2439700;
const OCTAVES = makeCraterOctaves({
  largestCell: 0.32, smallestCell: 30 / R, largestDepth: 3000, bodyRadius: R,
  ratio: 0.45, density: 0.68, depthExponent: 0.8, freshness: 0.15,
}).slice(0, 15);

/** Reference: every cell within ±2 of the query (more than any crater can reach), no culling. */
function reference(octaves: CraterOctave[], seed: number, x: number, y: number, z: number): { h: number; e: number } {
  const maxR = 0.32;
  let total = 0, ejecta = 0;
  for (let o = 0; o < octaves.length; o++) {
    const oct = octaves[o], c = oct.cell, s = seed + o * 7919;
    const ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    let octH = 0, octE = 0;
    for (let cx = ix - 2; cx <= ix + 2; cx++) for (let cy = iy - 2; cy <= iy + 2; cy++) for (let cz = iz - 2; cz <= iz + 2; cz++) {
      const h = hash3(cx, cy, cz, s);
      if ((h & 255) * (1 / 256) > oct.density) continue;
      const px = (cx + ((h >>> 8) & 255) * (1 / 256) + 1 / 512) * c;
      const py = (cy + ((h >>> 16) & 255) * (1 / 256) + 1 / 512) * c;
      const pz = (cz + (h >>> 24) * (1 / 256) + 1 / 512) * c;
      const pl = Math.sqrt(px * px + py * py + pz * pz);
      if (Math.abs(pl - 1) > c * 0.5) continue;
      const dx = x - px / pl, dy = y - py / pl, dz = z - pz / pl;
      const d2 = dx * dx + dy * dy + dz * dz;
      const h2 = hashNext(h);
      const rs = (h2 & 65535) * (1 / 65536);
      const radius = c * maxR * (0.35 + 0.65 * rs * rs);
      if (d2 > radius * radius * 2.56) continue;
      const r = Math.sqrt(d2) / radius;
      const fresh = (h2 >>> 16) * (1 / 65536) < oct.freshness;
      const size = radius / (c * maxR);
      octH += craterProfile(r, oct.complex, fresh) * size;
      if (fresh) {
        const e = r < 0.8 ? 0.15 : r < 1.05 ? 0.15 + 0.85 * (r - 0.8) / 0.25 : Math.max(0, 1 - (r - 1.05) / 0.55);
        octE = Math.max(octE, e * e * (0.4 + 0.6 * size));
      }
    }
    total += clamp(octH, -1, 0.35) * oct.depth;
    ejecta = Math.max(ejecta, octE);
  }
  return { h: total, e: ejecta };
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('crater search', () => {
  it('finds craters whose projected centre left their host cell (no clipped rims)', () => {
    const f = new CraterField({ seed: 7, octaves: OCTAVES });
    const rnd = rng(1);
    let differ = 0;
    for (let i = 0; i < 20000; i++) {
      let x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = rnd() * 2 - 1;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const h = f.height(x, y, z);
      const ref = reference(OCTAVES, 7, x, y, z);
      if (h !== ref.h || f.ejecta !== ref.e) differ++;
    }
    // Before the fix ~0.3 % of surface points lost part of a crater (cut-off rims on Mercury).
    expect(differ).toBe(0);
  }, 60000);

  it('cached cell windows give bit-identical results to fresh queries, in any order', () => {
    const walk = new CraterField({ seed: 11, octaves: OCTAVES });
    const rnd = rng(5);
    let x = 0.3, y = -0.5, z = 0.81;
    for (let i = 0; i < 4000; i++) {
      if (i % 400 === 0) { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; }
      const step = i % 3 === 0 ? 3e-4 : 2e-6;
      x += (rnd() - 0.5) * step; y += (rnd() - 0.5) * step; z += (rnd() - 0.5) * step;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const h = walk.height(x, y, z);
      const again = walk.height(x, y, z); // repeated point (colour after height)
      const fresh = new CraterField({ seed: 11, octaves: OCTAVES });
      expect(h).toBe(fresh.height(x, y, z));
      expect(again).toBe(h);
      expect(walk.ejecta).toBe(fresh.ejecta);
      expect(walk.inside).toBe(fresh.inside);
      expect(walk.ejectaAt(1e-5)).toBe(fresh.ejectaAt(1e-5));
    }
  }, 60000);
});

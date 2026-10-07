import { describe, expect, it } from 'vitest';
import { earthData } from '../src/sim/terrain/earthData';
import { latLonToUnit } from '../src/sim/terrain';
import { CraterField, makeCraterOctaves } from '../src/sim/terrain/craters';
import { bandPass } from '../src/sim/terrain/fbm';

describe('terrain colour band-limiting', () => {
  it('fades the Earth shore weight smoothly instead of switching per ETOPO cell', () => {
    // A transect across the Bahamas banks, ~0.1 grid cell per step.
    const out = { range: 0, coastal: false, shore: 0 };
    let steps = 0, maxJump = 0, prevShore = -1, prevCoastal: boolean | null = null, coastalFlips = 0;
    for (let lon = -79.5; lon <= -76.5; lon += 0.009) {
      const p = latLonToUnit(25.0, lon);
      earthData().sample(p.x, p.y, p.z, out);
      if (prevShore >= 0) maxJump = Math.max(maxJump, Math.abs(out.shore - prevShore));
      if (prevCoastal !== null && prevCoastal !== out.coastal) coastalFlips++;
      prevShore = out.shore; prevCoastal = out.coastal; steps++;
    }
    expect(steps).toBeGreaterThan(300);
    expect(coastalFlips).toBeGreaterThan(2); // the per-cell flag does step along this line
    expect(maxJump).toBeLessThan(0.15);       // the interpolated weight does not
  });

  it('keeps crater ejecta only where the samples can resolve the rim', () => {
    const field = new CraterField({ seed: 7, octaves: makeCraterOctaves({ largestCell: 0.3, smallestCell: 1e-4, largestDepth: 1000, bodyRadius: 1.7e5, ratio: 0.45, freshness: 1 }) });
    let full = 0, coarse = 0, fine = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const a = i * 2.399963, z = 1 - 2 * (i + 0.5) / 4000, r = Math.sqrt(1 - z * z);
      field.height(r * Math.cos(a), r * Math.sin(a), z);
      expect(field.ejectaAt()).toBe(field.ejecta);
      full += field.ejecta;
      coarse += field.ejectaAt(1e-2);
      fine += field.ejectaAt(1e-6);
      n++;
    }
    expect(fine / n).toBeCloseTo(full / n, 6);
    expect(coarse).toBeLessThan(full * 0.5);
  });

  it('weights noise octaves by samples per wavelength', () => {
    expect(bandPass(900)).toBe(1);
    expect(bandPass(900, 1 / (900 * 2))).toBe(0);
    expect(bandPass(900, 1 / (900 * 10))).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { cloudLandMask } from '../src/render/planet/cloudCoasts';

describe('cloud geography', () => {
  it('samples unit directions with the same longitude and latitude convention as the bake', () => {
    const mask = cloudLandMask((x, y, z) => {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
      return y > 0 && z > 0 ? 1 : -1;
    }, 16, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
      expect(mask[y * 16 + x]).toBe(y >= 4 && x >= 8 ? 255 : 0);
    }
  });

  it('wraps a continent across the antimeridian without creating a polar seam', () => {
    const mask = cloudLandMask((x) => -x, 32, 16);
    for (let y = 0; y < 16; y++) {
      expect(mask[y * 32]).toBe(255);
      expect(mask[y * 32 + 31]).toBe(255);
      expect(mask[y * 32 + 16]).toBe(0);
    }
  });
});

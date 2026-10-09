import { describe, expect, it } from 'vitest';
import { surfaceBounce } from '../src/render/core/skyEnv';
import { BODY_DEFS } from '../src/data/bodies';

const moon = BODY_DEFS.find(b => b.id === 'moon')!;
const R = 1_737_400;
const base = { albedo: moon.surface!.colors[1], altitude: 0, radius: R, daylight: 1, sunColor: [1, 1, 1] as const, airless: true };

describe('surfaceBounce', () => {
  it('lights a landed vessel from sunlit regolith at a comparable level to the terrain it sits on', () => {
    const [r, g, b] = surfaceBounce(base);
    // Mid lunar albedo (~0.19) × 3.2/π × 1.3 regolith gain ≈ 0.25; far above the old darkest-palette ground (~0.05).
    expect(g).toBeGreaterThan(0.2);
    expect(g).toBeLessThan(0.35);
    expect(r).toBeGreaterThan(b);
  });

  it('fades out with altitude relative to the body radius', () => {
    const at = (h: number) => surfaceBounce({ ...base, altitude: h })[1];
    expect(at(0.002 * R)).toBeCloseTo(at(0), 10);
    expect(at(0.01 * R)).toBeLessThan(at(0));
    expect(at(0.01 * R)).toBeGreaterThan(0);
    expect(at(0.031 * R)).toBe(0);
    expect(at(0.5 * R)).toBe(0);
  });

  it('follows the sun visibility and colour, and is weaker on Lambertian (atmospheric) ground', () => {
    expect(surfaceBounce({ ...base, daylight: 0 })).toEqual([0, 0, 0]);
    expect(surfaceBounce({ ...base, daylight: 0.5 })[1]).toBeCloseTo(surfaceBounce(base)[1] / 2, 10);
    const red = surfaceBounce({ ...base, sunColor: [1, 0.5, 0.25] });
    expect(red[2] / red[0]).toBeCloseTo((base.albedo[2] * 0.25) / base.albedo[0], 10);
    expect(surfaceBounce({ ...base, airless: false })[1]).toBeLessThan(surfaceBounce(base)[1]);
  });

  it('writes into a caller-owned tuple without allocating', () => {
    const out: [number, number, number] = [9, 9, 9];
    expect(surfaceBounce(base, out)).toBe(out);
    expect(out[1]).toBeGreaterThan(0);
  });
});

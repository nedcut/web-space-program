import { describe, expect, it } from 'vitest';
import { solveLambert, propagateUniversal } from '../src/sim/orbit';
import { v3, length, sub, cross } from '../src/util/vec3';

describe('universal-variable Lambert', () => {
  it('matches the published Vallado example (km, seconds)', () => {
    // https://docs.poliastro.space/en/stable/autoapi/poliastro/core/iod/index.html
    const a = v3(5000, 10000, 2100), b = v3(-14600, 2500, 7000);
    const s = solveLambert(398600.4418, a, b, 3600);
    expect(length(sub(s.departureVelocity, v3(-5.99249503, 1.92536671, 3.24563805)))).toBeLessThan(1e-7);
    expect(length(sub(s.arrivalVelocity, v3(-3.31245851, -4.19661901, -0.38528906)))).toBeLessThan(1e-7);
    expect(length(sub(propagateUniversal(398600.4418, { position: a, velocity: s.departureVelocity }, 3600).position, b))).toBeLessThan(1e-5);
  });
  it('recovers an almost antipodal Earth–Mars Hohmann transfer in SI units', () => {
    const mu = 1.32712440018e20, r = 149597870700, ra = r * 1.524;
    const speed = Math.sqrt(mu * (2 / r - 2 / (r + ra)));
    const tof = Math.PI * Math.sqrt(((r + ra) / 2) ** 3 / mu) * 0.999;
    const start = { position: v3(r, 0, 0), velocity: v3(0, speed, 0) };
    const end = propagateUniversal(mu, start, tof);
    const s = solveLambert(mu, start.position, end.position, tof);
    expect(length(sub(s.departureVelocity, start.velocity))).toBeLessThan(0.01);
    expect(length(sub(s.arrivalVelocity, end.velocity))).toBeLessThan(0.01);
  });
  it.each([0.1, 1, 4, 9])('propagates short/long-way and hyperbolic solutions, tof=%s', tof => {
    for (const sign of [-1, 1]) {
      const a = v3(1, 0, 0), b = v3(0.2, sign * 1.3, 0.2);
      const s = solveLambert(1, a, b, tof);
      expect(cross(a, s.departureVelocity).z).toBeGreaterThan(0);
      const end = propagateUniversal(1, { position: a, velocity: s.departureVelocity }, tof);
      expect(length(sub(end.position, b))).toBeLessThan(1e-7);
    }
  });
  it('rejects invalid times and ambiguous collinear geometry', () => {
    expect(() => solveLambert(1, v3(1, 0, 0), v3(-1, 0, 0), 3)).toThrow(/Collinear/);
    expect(() => solveLambert(1, v3(), v3(0, 1, 0), 3)).toThrow();
    expect(() => solveLambert(1, v3(1, 0, 0), v3(0, 1, 0), -1)).toThrow();
  });
});

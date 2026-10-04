import { describe, expect, it } from 'vitest';
import { period, propagate, stateToElements, trajectoryClosestApproach } from '../src/sim/orbit';
import type { Orbit, TrajectoryPatch } from '../src/sim/orbit';
import { v3 } from '../src/util/vec3';

const MU = 3.986e14 * 0.01; // standard-scale Earth (GM scaled by s^2)

function circular(r: number, phase: number): Orbit {
  const v = Math.sqrt(MU / r);
  return stateToElements(MU, 'earth', v3(r * Math.cos(phase), r * Math.sin(phase), 0), v3(-v * Math.sin(phase), v * Math.cos(phase), 0), 0);
}

describe('closest approach markers', () => {
  it('two coplanar circular orbits: distance |r2 - r1| when the phase gap closes', () => {
    const r1 = 700e3, r2 = 720e3;
    const phase0 = 0.4; // target leads by 0.4 rad
    const A = circular(r1, 0);
    const B = circular(r2, phase0);
    const n1 = Math.sqrt(MU / r1 ** 3), n2 = Math.sqrt(MU / r2 ** 3);
    // The lower orbit is faster: it catches up after phase0 / (n1 - n2), which is several periods away, so
    // within one revolution the closest point is at the end of the window. Search a long patch instead.
    const tCatch = phase0 / (n1 - n2);
    const patch: TrajectoryPatch = { orbit: A, startTime: 0, endTime: tCatch * 1.5, endReason: 'horizon' };
    const ca = trajectoryClosestApproach([patch], (_b, t) => propagate(B, t), 0, Infinity)!;
    expect(ca.body).toBe('earth');
    expect(ca.distance).toBeCloseTo(r2 - r1, -1); // within ~10 m
    expect(Math.abs(ca.time - tCatch)).toBeLessThan(period(A) * 0.002);
    // Markers: both positions lie on their own circles, radially aligned.
    expect(Math.hypot(ca.positionA.x, ca.positionA.y)).toBeCloseTo(r1, -1);
    expect(Math.hypot(ca.positionB.x, ca.positionB.y)).toBeCloseTo(r2, -1);
    const cross = ca.positionA.x * ca.positionB.y - ca.positionA.y * ca.positionB.x;
    expect(Math.abs(cross) / (r1 * r2)).toBeLessThan(1e-3);
    // Relative speed at closest approach = difference of circular speeds.
    expect(ca.relativeSpeed).toBeCloseTo(Math.sqrt(MU / r1) - Math.sqrt(MU / r2), 1);
  });

  it('same orbit, target 100 m ahead: closest approach is now, at 100 m', () => {
    const r = 700e3;
    const A = circular(r, 0);
    const B = circular(r, 100 / r);
    const patch: TrajectoryPatch = { orbit: A, startTime: 0, endTime: period(A) * 1.02, endReason: 'horizon' };
    const ca = trajectoryClosestApproach([patch], (_b, t) => propagate(B, t), 0)!;
    expect(ca.distance).toBeCloseTo(100, 0);
    // Same speed, velocity direction rotated by 100/r rad.
    expect(ca.relativeSpeed).toBeCloseTo((Math.sqrt(MU / r) * 100) / r, 3);
  });

  it('one revolution window by default', () => {
    const A = circular(700e3, 0);
    const B = circular(720e3, 0.4);
    const patch: TrajectoryPatch = { orbit: A, startTime: 0, endTime: 1e9, endReason: 'horizon' };
    const ca = trajectoryClosestApproach([patch], (_b, t) => propagate(B, t), 0)!;
    expect(ca.time).toBeLessThanOrEqual(period(A) * 1.02 + 1e-6);
  });
});

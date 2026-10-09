import { describe, expect, it } from 'vitest';
import { stageBurnTime, NODE_STAGE_PAUSE } from '../src/sim/vessel/burnTime';
import type { StageDeltaV } from '../src/sim/vessel/staging';
import { G0 } from '../src/sim/vessel/env';

const stage = (stage: number, dv: number, thrust: number, startMass: number, isp: number): StageDeltaV => ({
  stage, dv, thrust, startMass, isp, dvVac: dv, dvAsl: dv, thrustVac: thrust, thrustAsl: thrust,
  minThrustVac: 0, endMass: startMass * Math.exp(-dv / (isp * G0)), burnTime: 0, twrStart: 0, twrEnd: 0,
});
// Independent rocket equation: propellant / mass flow.
const seconds = (dv: number, thrust: number, mass: number, isp: number) => mass * (1 - Math.exp(-dv / (isp * G0))) / (thrust / (isp * G0));
const stages = [stage(0, 1000, 12000, 1000, 340), stage(2, 300, 90000, 6000, 280), stage(1, 0, 0, 5000, 0)];

describe('pure staged maneuver duration', () => {
  it('uses each stage mass, thrust and Isp in firing order, including an unpowered separator pause', () => {
    const before = structuredClone(stages);
    expect(stageBurnTime(stages, 2, 500, NODE_STAGE_PAUSE)).toBeCloseTo(
      seconds(300, 90000, 6000, 280) + 2 * NODE_STAGE_PAUSE + seconds(200, 12000, 1000, 340), 9);
    expect(stages).toEqual(before);
  });
  it('counts initial ignition only when the current stage is unlit, and does not separate after reaching Δv', () => {
    const t = seconds(300, 90000, 6000, 280);
    expect(stageBurnTime(stages, 2, 300, 1, true)).toBeCloseTo(t, 9);
    expect(stageBurnTime(stages, 2, 300, 1, false)).toBeCloseTo(t + 1, 9);
    expect(stageBurnTime(stages, 2, 0, 1, false)).toBe(0);
  });
  it('centres on half the Δv rather than half the elapsed time across a thrust/mass change', () => {
    const lead = stageBurnTime(stages, 2, 250, 1);
    expect(lead).toBeCloseTo(seconds(250, 90000, 6000, 280), 9);
    expect(Math.abs(lead - stageBurnTime(stages, 2, 500, 1) / 2)).toBeGreaterThan(1);
  });
  it('returns Infinity when the allowed firing sequence cannot deliver the requested Δv', () => {
    expect(stageBurnTime(stages, 0, 1100)).toBe(Infinity);
    expect(stageBurnTime(stages, 2, 1400)).toBe(Infinity);
    expect(stageBurnTime([], 2, 1)).toBe(Infinity);
  });
});

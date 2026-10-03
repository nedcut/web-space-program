import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/util/vec3';
import { add, cross, length, scale, sub } from '../src/util/vec3';
import {
  activateNextStage, angularMomentum, buildVessel, computeStageDeltaV, getStages, G0,
} from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel';
import { TEST_CATALOG, stackCraft, NOSE_UP } from '../src/sim/vessel/testing';

const twoStage = () =>
  stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }, { partId: 'decoupler', stage: 1 }, 'tank', { partId: 'engine', stage: 2 }]);

function momentum(vs: VesselState[]): Vec3 {
  return vs.reduce((acc, v) => add(acc, scale(v.velocity, v.mass)), { x: 0, y: 0, z: 0 });
}
function angMomOrigin(vs: VesselState[]): Vec3 {
  return vs.reduce((acc, v) => add(acc, add(cross(v.position, scale(v.velocity, v.mass)), angularMomentum(v))), { x: 0, y: 0, z: 0 });
}

describe('staging', () => {
  it('lists stages highest first and ignites engines', () => {
    const v = buildVessel(twoStage(), TEST_CATALOG);
    expect(getStages(v)).toEqual([2, 1, 0]);
    activateNextStage(v);
    expect(v.parts.filter((p) => p.engine?.ignited).length).toBe(1);
    expect(v.nextStage).toBe(1);
  });

  it('decoupling conserves linear and angular momentum and separates the stages', () => {
    const v = buildVessel(twoStage(), TEST_CATALOG, {
      orientation: NOSE_UP,
      position: { x: 1000, y: -2000, z: 30000 },
      velocity: { x: 120, y: 40, z: 1500 },
      angularVelocity: { x: 0.05, y: 0.2, z: -0.03 },
    });
    activateNextStage(v); // ignite booster (no time passes)
    const before = [v];
    const p0 = momentum(before);
    const L0 = angMomOrigin(before);
    const m0 = v.mass;
    const res = activateNextStage(v); // decouple
    expect(res.newVessels).toHaveLength(1);
    const all = [v, ...res.newVessels];
    expect(v.mass + res.newVessels[0].mass).toBeCloseTo(m0, 6);
    const p1 = momentum(all);
    const L1 = angMomOrigin(all);
    expect(length(sub(p1, p0)) / length(p0)).toBeLessThan(1e-10);
    expect(length(sub(L1, L0)) / length(L0)).toBeLessThan(1e-9);
    // Upper stage keeps the root (capsule); lower stage pushed away along -nose (world -Z).
    expect(v.parts.some((p) => p.partId === 'capsule')).toBe(true);
    const rel = sub(res.newVessels[0].velocity, v.velocity);
    const sep = sub(res.newVessels[0].position, v.position);
    expect(rel.z).toBeLessThan(0);
    expect(rel.z * sep.z).toBeGreaterThan(0); // moving apart
  });

  it('computes per-stage delta-v, burn time and TWR', () => {
    const v = buildVessel(twoStage(), TEST_CATALOG);
    const dv = computeStageDeltaV(v, 101325, G0);
    const burning = dv.filter((s) => s.dvVac > 0);
    expect(burning.map((s) => s.stage)).toEqual([2, 0]);
    const mdot = 200_000 / (320 * G0);
    const prop = 710 * 0.81 + 1290 * 1.14;
    for (const s of burning) {
      expect(s.burnTime).toBeCloseTo(prop / mdot, 3);
      expect(s.dvAsl).toBeLessThan(s.dvVac);
      expect(s.dv).toBeCloseTo(s.dvAsl, 6);
      expect(s.startMass - s.endMass).toBeCloseTo(prop, 3);
      expect(s.twrStart).toBeCloseTo((200_000 * 280) / 320 / (s.startMass * G0), 6);
      expect(s.dvVac).toBeCloseTo(320 * G0 * Math.log(s.startMass / s.endMass), 3);
    }
    // vessel itself untouched
    expect(v.parts.every((p) => !p.activated)).toBe(true);
  });
});

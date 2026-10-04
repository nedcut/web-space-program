import { describe, expect, it } from 'vitest';
import { length } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { bodyToWorld, buildVessel, neutralInput, stepVessel, wheelContactPoint } from '../src/sim/vessel';
import type { ControlInput, VesselState, WheelModule } from '../src/sim/vessel';
import { TEST_CATALOG, flatEarthEnv, planeCraft } from '../src/sim/vessel/testing';

/** Put the plane on z = 0 with its lowest tyre `clearance` m above the ground. */
function placeOnWheels(v: VesselState, clearance = 0) {
  let minZ = Infinity;
  for (const p of v.parts) if (p.wheel) {
    const g = wheelContactPoint(v, p);
    minZ = Math.min(minZ, bodyToWorld(v, g.center).z - g.module.radius);
  }
  v.position.z += clearance - minZ;
}

function run(v: VesselState, seconds: number, input: Partial<ControlInput> = {}, t0 = 0): number {
  const env = flatEarthEnv();
  let t = t0;
  for (let i = 0; i < seconds * 50; i++, t += 0.02) stepVessel(v, neutralInput(input), env, t);
  return t;
}

const heading = (v: VesselState) => {
  const f = qRotate(v.orientation, { x: 0, y: 1, z: 0 });
  return Math.atan2(f.x, f.y);
};

function settledPlane(): { v: VesselState; t: number } {
  const v = buildVessel(planeCraft(), TEST_CATALOG);
  placeOnWheels(v, 0.02);
  const t = run(v, 4, { brakes: true });
  return { v, t };
}

describe('wheels & landing gear', () => {
  it('suspension settles to its static compression without jitter', () => {
    const { v, t } = settledPlane();
    let zMin = Infinity, zMax = -Infinity, vMax = 0, wMax = 0;
    const env = flatEarthEnv();
    let tt = t;
    for (let i = 0; i < 50 * 2; i++, tt += 0.02) {
      stepVessel(v, neutralInput(), env, tt);
      zMin = Math.min(zMin, v.position.z);
      zMax = Math.max(zMax, v.position.z);
      vMax = Math.max(vMax, length(v.velocity));
      wMax = Math.max(wMax, length(v.angularVelocity));
    }
    expect(v.situation).toBe('landed');
    expect(zMax - zMin).toBeLessThan(1e-4);
    expect(vMax).toBeLessThan(1e-3);
    expect(wMax).toBeLessThan(1e-3);
    // Load shared by three wheels: total spring force carries the weight.
    let springForce = 0;
    for (const p of v.parts) if (p.wheel) {
      expect(p.wheel.inContact).toBe(true);
      const m = p.def.modules[p.wheel.moduleIndex] as WheelModule;
      expect(p.wheel.compression).toBeGreaterThan(0.01);
      expect(p.wheel.compression).toBeLessThan(m.travel);
      springForce += m.spring * p.wheel.compression;
    }
    expect(springForce / (v.mass * 9.80665)).toBeCloseTo(1, 2);
    // The fuselage hull never touches the ground.
    expect(v.position.z).toBeGreaterThan(0.625 + 0.3);
  });

  it('rolls straight with low rolling resistance', () => {
    const { v, t } = settledPlane();
    v.velocity = { x: 0, y: 20, z: 0 };
    const h0 = heading(v);
    run(v, 5, {}, t);
    expect(Math.abs(v.velocity.x)).toBeLessThan(0.02);
    expect(Math.abs(heading(v) - h0)).toBeLessThan(0.2 * (Math.PI / 180));
    // Rolling resistance (~0.15 m/s^2) + a little air drag: loses well under 2 m/s in 5 s.
    expect(v.velocity.y).toBeGreaterThan(18.5);
    expect(v.velocity.y).toBeLessThan(19.95);
    expect(v.situation).toBe('landed');
  });

  it('brakes stop it and hold it', () => {
    const { v, t } = settledPlane();
    v.velocity = { x: 0, y: 25, z: 0 };
    const y0 = v.position.y;
    const t1 = run(v, 8, { brakes: true }, t);
    expect(length(v.velocity)).toBeLessThan(0.01);
    const stopDist = v.position.y - y0;
    // Two braked mains: decel limited by brake torque / tyre grip -> stops within ~100 m.
    expect(stopDist).toBeGreaterThan(20);
    expect(stopDist).toBeLessThan(120);
    const y1 = v.position.y;
    run(v, 2, { brakes: true }, t1);
    expect(Math.abs(v.position.y - y1)).toBeLessThan(1e-3);
  });

  it('steering turns it toward the yaw input', () => {
    const { v, t } = settledPlane();
    v.velocity = { x: 0, y: 4, z: 0 };
    const h0 = heading(v);
    run(v, 4, { yaw: 0.4 }, t);
    const dh = heading(v) - h0;
    // yaw > 0 = nose toward +X (right); heading measured from +Y toward +X.
    expect(dh).toBeGreaterThan(20 * (Math.PI / 180));
    expect(v.velocity.x).toBeGreaterThan(1);
    // Tyres grip: the velocity follows the nose (little side-slip).
    const f = qRotate(v.orientation, { x: 0, y: 1, z: 0 });
    const sp = length(v.velocity);
    expect((f.x * v.velocity.x + f.y * v.velocity.y) / sp).toBeGreaterThan(0.98);
    expect(v.situation).toBe('landed');
  });

  it('retracting the gear drops the plane on its belly; fixed state follows G', () => {
    const { v, t } = settledPlane();
    run(v, 4, { gear: false }, t);
    for (const p of v.parts) if (p.wheel) {
      expect(p.wheel.deployed).toBe(false);
      expect(p.wheel.deploy).toBe(0);
      expect(p.wheel.inContact).toBe(false);
    }
    expect(v.position.z).toBeLessThan(1.0);
  });
});

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/util/vec3';
import { dot, length, normalize, sub } from '../src/util/vec3';
import { qIdentity, qRotate } from '../src/util/quat';
import { angularMomentum, buildVessel, neutralInput, rotationalEnergy, stepVessel, attitudeError } from '../src/sim/vessel';
import type { CraftDef, PartDef } from '../src/sim/vessel';
import { TEST_CATALOG, vacuumEnv } from '../src/sim/vessel/testing';

const brick: PartDef = { ...TEST_CATALOG.get('ballast')!, id: 'brick', dryMass: 1000, shape: { kind: 'box', size: { x: 1, y: 2, z: 3 } } };
const cat = new Map([...TEST_CATALOG, ['brick', brick]]);
const brickCraft: CraftDef = { name: 'brick', type: 'VAB', version: 1, parts: [{ uid: 1, partId: 'brick', position: { x: 0, y: 0, z: 0 }, rotation: qIdentity() }] };
const env = vacuumEnv();

function spin(w: Vec3, seconds: number, cb?: (t: number, v: ReturnType<typeof buildVessel>) => void) {
  const v = buildVessel(brickCraft, cat, { angularVelocity: w });
  let t = 0;
  for (let i = 0; i < seconds * 50; i++, t += 0.02) {
    stepVessel(v, neutralInput(), env, t, 0.02, { disableHeating: true });
    cb?.(t, v);
  }
  return v;
}

describe('rigid-body rotation', () => {
  it('torque-free tumbling conserves angular momentum and energy', () => {
    const v0 = buildVessel(brickCraft, cat, { angularVelocity: { x: 0.4, y: 1.1, z: -0.3 } });
    const L0 = angularMomentum(v0);
    const E0 = rotationalEnergy(v0);
    const v = spin({ x: 0.4, y: 1.1, z: -0.3 }, 120);
    expect(length(sub(angularMomentum(v), L0)) / length(L0)).toBeLessThan(1e-9);
    expect(Math.abs(rotationalEnergy(v) - E0) / E0).toBeLessThan(1e-5);
  });

  it('rotation about the max/min principal axes is stable; intermediate axis flips (Dzhanibekov)', () => {
    // brick 1x2x3: Ixx = m(4+9)/12 (max), Iyy = m(1+9)/12 (mid), Izz = m(1+4)/12 (min)
    const eps = 1e-3;
    const maxAxis = spin({ x: 2, y: eps, z: eps }, 60);
    expect(Math.abs(normalize(maxAxis.angularVelocity).x)).toBeGreaterThan(0.999);
    const minAxis = spin({ x: eps, y: eps, z: 2 }, 60);
    expect(Math.abs(normalize(minAxis.angularVelocity).z)).toBeGreaterThan(0.999);
    let minY = 1;
    spin({ x: eps, y: 2, z: eps }, 60, (_t, v) => { minY = Math.min(minY, normalize(v.angularVelocity).y); });
    expect(minY).toBeLessThan(-0.9); // flipped over
  });
});

describe('SAS', () => {
  const probeCraft: CraftDef = { name: 'probe', type: 'VAB', version: 1, parts: [{ uid: 1, partId: 'probe', position: { x: 0, y: 0, z: 0 }, rotation: qIdentity() }] };

  it('stability assist recovers the held attitude after a disturbance, without oscillation', () => {
    for (const scaleMass of [1, 40]) {
      const big: PartDef = { ...TEST_CATALOG.get('probe')!, id: 'p', dryMass: 500 * scaleMass };
      const v = buildVessel({ ...probeCraft, parts: [{ ...probeCraft.parts[0], partId: 'p' }] }, new Map([['p', big]]));
      const hold = { ...v.orientation };
      let t = 0;
      const input = neutralInput({ sas: 'stabilityAssist' });
      for (let i = 0; i < 25; i++, t += 0.02) stepVessel(v, input, env, t);
      v.angularVelocity = { x: 0.3, y: -0.2, z: 0.25 };
      let peakLate = 0;
      let lastErr = Infinity;
      let sign = 0;
      let reversals = 0;
      for (let i = 0; i < 50 * 40; i++, t += 0.02) {
        stepVessel(v, input, env, t);
        const err = length(attitudeError(v.orientation, hold));
        if (i > 50 * 2) {
          const s = Math.sign(err - lastErr);
          if (s !== 0 && sign !== 0 && s !== sign && err > 1e-3) reversals++;
          if (s !== 0) sign = s;
        }
        lastErr = err;
        if (i > 50 * 35) peakLate = Math.max(peakLate, err);
      }
      const deg = 180 / Math.PI;
      expect(peakLate * deg).toBeLessThan(0.05);
      expect(length(v.angularVelocity)).toBeLessThan(1e-3);
      expect(reversals).toBeLessThanOrEqual(2);
    }
  });

  it('prograde mode points the nose along the velocity vector', () => {
    const v = buildVessel(probeCraft, TEST_CATALOG, { velocity: { x: 300, y: -100, z: 50 } });
    let t = 0;
    for (let i = 0; i < 50 * 20; i++, t += 0.02) stepVessel(v, neutralInput({ sas: 'prograde' }), env, t);
    const nose = qRotate(v.orientation, { x: 0, y: 1, z: 0 });
    const ang = Math.acos(Math.min(1, dot(nose, normalize(v.velocity))));
    expect(ang * (180 / Math.PI)).toBeLessThan(0.1);
    expect(length(v.angularVelocity)).toBeLessThan(1e-3);
  });

  it('reaction wheels stop working without electric charge', () => {
    const craft: CraftDef = { ...probeCraft, parts: [{ ...probeCraft.parts[0], resources: { electricCharge: 0 } }] };
    const v = buildVessel(craft, TEST_CATALOG, { angularVelocity: { x: 0.2, y: 0, z: 0 } });
    for (let i = 0; i < 100; i++) stepVessel(v, neutralInput({ sas: 'stabilityAssist' }), env, i * 0.02);
    expect(v.angularVelocity.x).toBeCloseTo(0.2, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { dot, length, normalize } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { activateNextStage, attitudeError, buildVessel, neutralInput, stepVessel } from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel';
import { TEST_CATALOG, flatEarthEnv, stackCraft, vacuumEnv, NOSE_UP } from '../src/sim/vessel/testing';

describe('SAS with gimbal authority only', () => {
  it('a wheel-less launcher holds attitude under thrust after a kick', () => {
    const env = vacuumEnv();
    const v = buildVessel(stackCraft(['ballast', 'tank', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    activateNextStage(v);
    const input = neutralInput({ throttle: 1, sas: 'stabilityAssist' });
    let t = 0;
    for (let i = 0; i < 25; i++, t += 0.02) stepVessel(v, input, env, t);
    const hold = { ...v.sas.hold! };
    v.angularVelocity = { x: 0.1, y: 0, z: -0.08 };
    for (let i = 0; i < 50 * 20; i++, t += 0.02) stepVessel(v, input, env, t);
    expect(length(attitudeError(v.orientation, hold)) * (180 / Math.PI)).toBeLessThan(0.1);
    expect(Math.hypot(v.angularVelocity.x, v.angularVelocity.z)).toBeLessThan(1e-3);
  });

  it('pilot pitch input rotates the nose toward +Z (body top)', () => {
    const env = vacuumEnv();
    const v = buildVessel(stackCraft(['probe']), TEST_CATALOG);
    for (let i = 0; i < 20; i++) stepVessel(v, neutralInput({ pitch: 1 }), env, i * 0.02);
    expect(v.angularVelocity.x).toBeGreaterThan(0); // +X rotation: nose (+Y) toward +Z
    const v2 = buildVessel(stackCraft(['probe']), TEST_CATALOG);
    for (let i = 0; i < 20; i++) stepVessel(v2, neutralInput({ yaw: 1 }), env, i * 0.02);
    expect(v2.angularVelocity.z).toBeLessThan(0); // nose toward +X
  });
});

describe('determinism', () => {
  it('identical inputs give bit-identical states', () => {
    const run = (): VesselState => {
      const env = flatEarthEnv();
      const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 2 } });
      activateNextStage(v);
      for (let i = 0; i < 500; i++) stepVessel(v, neutralInput({ throttle: 1, pitch: i > 100 && i < 150 ? 0.3 : 0, sas: i > 200 ? 'prograde' : 'off' }), env, i * 0.02);
      return v;
    };
    const a = run(), b = run();
    expect(a.position).toEqual(b.position);
    expect(a.orientation).toEqual(b.orientation);
    expect(a.parts.map((p) => p.resources)).toEqual(b.parts.map((p) => p.resources));
    // and it flew: gravity turn towards prograde under thrust
    const nose = qRotate(a.orientation, { x: 0, y: 1, z: 0 });
    expect(dot(nose, normalize(a.velocity))).toBeGreaterThan(0.999);
  });
});

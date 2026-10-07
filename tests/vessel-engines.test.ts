import { describe, expect, it } from 'vitest';
import { length, sub } from '../src/util/vec3';
import {
  G0, buildVessel, computeStageDeltaV, ispAtPressure, neutralInput, spoolThrottle, stepVessel, thrustAtPressure,
  shutdownEngine, activateNextStage, maxMassFlow, spoolDownTime, ROCKET_THROTTLE_TIME, targetThrottle,
} from '../src/sim/vessel';
import type { EngineModule } from '../src/sim/vessel';
import { TEST_CATALOG, stackCraft, vacuumEnv, flatEarthEnv, NOSE_UP } from '../src/sim/vessel/testing';

const engineDef = TEST_CATALOG.get('engine')!.modules[0] as EngineModule;

describe('engine performance', () => {
  it('Isp interpolates with pressure and floors at 0.1 s', () => {
    expect(ispAtPressure(engineDef, 0)).toBeCloseTo(320, 9);
    expect(ispAtPressure(engineDef, 101325)).toBeCloseTo(280, 9);
    expect(ispAtPressure(engineDef, 50662.5)).toBeCloseTo(300, 9);
    expect(ispAtPressure(engineDef, 101325 * 5)).toBeCloseTo(120, 9);
    expect(ispAtPressure(engineDef, 101325 * 9.2e3)).toBeCloseTo(0.1, 9); // Venus-like: clamp at 10 atm -> floor
  });

  it('sea-level thrust is lower than vacuum thrust (fixed mass flow)', () => {
    const vac = thrustAtPressure(engineDef, 0);
    const asl = thrustAtPressure(engineDef, 101325);
    expect(vac).toBeCloseTo(200_000, 6);
    expect(asl).toBeLessThan(vac);
    expect(asl / vac).toBeCloseTo(280 / 320, 9);
    expect(maxMassFlow(engineDef)).toBeCloseTo(200_000 / (320 * G0), 9);
  });

  it('throttle spools with a first-order lag', () => {
    let th = 0;
    for (let i = 0; i < 10; i++) th = spoolThrottle(th, 1, 0.2, 0.02);
    expect(th).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('liquid engines cut thrust within 0.1 s; only the start-up after ignition follows the spool time', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    const env = vacuumEnv();
    const eng = v.parts.find((p) => p.engine)!;
    let t = 0;
    stepVessel(v, neutralInput({ stage: true, throttle: 1 }), env, t);
    for (let i = 0; i < 9; i++) stepVessel(v, neutralInput({ throttle: 1 }), env, (t += 0.02));
    // Start-up still follows the turbopump spool time (0.2 s here): ~63 % after one time constant.
    expect(eng.engine!.throttle).toBeGreaterThan(0.55);
    expect(eng.engine!.throttle).toBeLessThan(0.75);
    for (let i = 0; i < 100; i++) stepVessel(v, neutralInput({ throttle: 1 }), env, (t += 0.02));
    expect(eng.engine!.thrust).toBeGreaterThan(190_000);
    // Throttling down is fast too (valve response), not a turbopump spool.
    for (let i = 0; i < 5; i++) stepVessel(v, neutralInput({ throttle: 0.5 }), env, (t += 0.02));
    expect(eng.engine!.throttle).toBeCloseTo(targetThrottle(engineDef, 0.5), 2);
    for (let i = 0; i < 100; i++) stepVessel(v, neutralInput({ throttle: 1 }), env, (t += 0.02));
    let steps = 0;
    while (eng.engine!.thrust > 0 && steps < 500) { stepVessel(v, neutralInput({ throttle: 0 }), env, (t += 0.02)); steps++; }
    expect(steps * 0.02).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(eng.engine!.ignited).toBe(true); // a cut is not a shutdown: it can be throttled up again
    // A running engine throttles back up quickly too (the start-up transient happens once per ignition).
    for (let i = 0; i < 5; i++) stepVessel(v, neutralInput({ throttle: 1 }), env, (t += 0.02));
    expect(eng.engine!.throttle).toBeGreaterThan(0.99);
    expect(spoolDownTime(engineDef)).toBe(ROCKET_THROTTLE_TIME);
  });

  it('solid motors ignore throttle and cannot be shut down', () => {
    const v = buildVessel(stackCraft(['probe', { partId: 'srb', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    const env = vacuumEnv();
    stepVessel(v, neutralInput({ stage: true, throttle: 0 }), env, 0);
    const srb = v.parts.find((p) => p.partId === 'srb')!;
    expect(srb.engine!.thrust).toBeGreaterThan(240_000);
    expect(shutdownEngine(srb)).toBe(false);
    expect(srb.engine!.ignitionsLeft).toBe(0);
  });
});

describe('rocket equation', () => {
  it('vacuum burn matches Isp*g0*ln(m0/m1) within 0.5%', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    const env = vacuumEnv();
    const m0 = v.mass;
    const v0 = { ...v.velocity };
    const readout = computeStageDeltaV(v, 0);
    let t = 0;
    stepVessel(v, neutralInput({ stage: true, throttle: 1 }), env, t);
    const eng = v.parts.find((p) => p.engine)!;
    for (let i = 0; i < 10000 && !eng.engine!.flamedOut; i++) {
      t += 0.02;
      stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    }
    expect(eng.engine!.flamedOut).toBe(true);
    const m1 = v.mass;
    const expected = 320 * G0 * Math.log(m0 / m1);
    const dv = length(sub(v.velocity, v0));
    expect(Math.abs(dv - expected) / expected).toBeLessThan(0.005);
    // stage readout agrees
    expect(readout).toHaveLength(1);
    expect(Math.abs(readout[0].dvVac - expected) / expected).toBeLessThan(0.001);
    expect(readout[0].dvAsl).toBeLessThan(readout[0].dvVac);
    // no spurious rotation from a centred engine
    expect(length(v.angularVelocity)).toBeLessThan(1e-9);
  });

  it('sea-level launch: thrust reported matches ASL rating, rocket climbs', () => {
    const env = flatEarthEnv();
    const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP, position: { x: 0, y: 0, z: 5 } });
    activateNextStage(v);
    let t = 0;
    for (let i = 0; i < 100; i++, t += 0.02) stepVessel(v, neutralInput({ throttle: 1 }), env, t);
    const eng = v.parts.find((p) => p.engine)!;
    expect(eng.engine!.thrust / 200_000).toBeCloseTo(ispAtPressure(engineDef, env.air(v.position, t).sample.pressure) / 320, 2);
    expect(v.velocity.z).toBeGreaterThan(5);
  });
});

import { describe, expect, it } from 'vitest';
import {
  G0, INTAKE_STATIC_SPEED, JET_MIN_AIR_FRACTION, activateNextStage, buildVessel, curveAt, jetThrust, jetThrustFactor, neutralInput, stepVessel,
} from '../src/sim/vessel';
import type { EngineModule, VesselEvent, VesselState } from '../src/sim/vessel';
import { TEST_CATALOG, flatEarthEnv, planeCraft } from '../src/sim/vessel/testing';
import { PART_CATALOG } from '../src/data/parts';

const fixtureJet = TEST_CATALOG.get('jet')!.modules[0] as EngineModule;
const engineOf = (id: string) => PART_CATALOG.get(id)!.modules.find((m): m is EngineModule => m.type === 'engine')!;

function jetVessel(opts: { intake: boolean; z: number; speed: number; ground?: boolean }) {
  const v = buildVessel(planeCraft({ jet: true, intake: opts.intake }), TEST_CATALOG, {
    position: { x: 0, y: 0, z: opts.z },
    velocity: { x: 0, y: opts.speed, z: 0 },
    gearDeployed: false,
  });
  activateNextStage(v);
  const jet = v.parts.find((p) => p.partId === 'jet')!;
  return { v, jet };
}

function fly(v: VesselState, seconds: number, throttle = 1, ground = false): VesselEvent[] {
  const env = flatEarthEnv({ surface: ground ? 'ground' : 'none' });
  const events: VesselEvent[] = [];
  let t = 0;
  for (let i = 0; i < seconds * 50; i++, t += 0.02) {
    // Hold the airspeed constant so only the engine response is measured.
    const sp = v.velocity.y;
    events.push(...stepVessel(v, neutralInput({ throttle }), env, t, 0.02, { disableHeating: true }).events);
    if (!ground) v.velocity = { x: 0, y: sp, z: 0 };
  }
  return events;
}

describe('air-breathing engines', () => {
  it('curve lookup interpolates and clamps', () => {
    const c: [number, number][] = [[0, 1], [1, 2], [2, 0]];
    expect(curveAt(c, -1)).toBe(1);
    expect(curveAt(c, 0.5)).toBeCloseTo(1.5, 12);
    expect(curveAt(c, 1.5)).toBeCloseTo(1, 12);
    expect(curveAt(c, 5)).toBe(0);
  });

  it('turbofan: strong subsonic, gone by ~Mach 1.6', () => {
    const fan = engineOf('jet-kittiwake');
    expect(fan.airBreathing).toBeDefined();
    const T = (M: number) => jetThrust(fan, M, 1.225) / fan.maxThrustVac;
    expect(T(0)).toBeCloseTo(1, 6);
    expect(T(0.5)).toBeGreaterThan(0.85);
    expect(T(0.85)).toBeGreaterThan(0.85);
    expect(T(1.2)).toBeLessThan(T(0.85));
    expect(T(1.4)).toBeLessThan(0.5);
    expect(T(1.7)).toBe(0);
    // Fuel-only Isp in the thousands of seconds.
    expect(fan.ispVac).toBeGreaterThan(3000);
    expect(fan.propellants).toEqual({ liquidFuel: 1 });
    expect(fan.spoolTime).toBeGreaterThan(1);
  });

  it('afterburning turbojet: peaks around Mach 2.2-2.6, dies by Mach 3.5', () => {
    const jet = engineOf('jet-shrike');
    const T = (M: number) => jetThrust(jet, M, 1.225) / jet.maxThrustVac;
    let peakM = 0, peak = 0;
    for (let M = 0; M <= 4; M += 0.05) if (T(M) > peak) { peak = T(M); peakM = M; }
    expect(peakM).toBeGreaterThan(2.0);
    expect(peakM).toBeLessThan(2.7);
    expect(peak).toBeGreaterThan(1.5);
    expect(T(1.6)).toBeGreaterThan(T(0.5));
    expect(T(3.0)).toBeLessThan(peak);
    expect(T(3.55)).toBe(0);
    expect(jet.ispVac).toBeGreaterThan(1500);
    // Better than the turbofan above Mach 1.2, worse fuel economy.
    const fan = engineOf('jet-kittiwake');
    expect(jetThrustFactor(jet.airBreathing!, 1.3, 1.225)).toBeGreaterThan(jetThrustFactor(fan.airBreathing!, 1.3, 1.225));
    expect(jet.ispVac).toBeLessThan(fan.ispVac);
  });

  it('flames out without intake air, runs with an intake', () => {
    const starved = jetVessel({ intake: false, z: 1000, speed: 100 });
    const ev = fly(starved.v, 3);
    expect(starved.jet.engine!.flamedOut).toBe(true);
    expect(starved.jet.engine!.thrust).toBe(0);
    expect(ev.some((e) => e.type === 'flameout')).toBe(true);
    // The engine stays lit (relights when air returns) and burns no fuel while starved.
    expect(starved.jet.engine!.ignited).toBe(true);
    expect(starved.v.parts[0].resources.liquidFuel).toBe(1000);

    const fed = jetVessel({ intake: true, z: 1000, speed: 100 });
    fly(fed.v, 8);
    expect(fed.jet.engine!.flamedOut).toBe(false);
    const expected = jetThrust(fixtureJet, 100 / 340.3, 1.225 * Math.exp(-1000 / 8500));
    expect(fed.jet.engine!.thrust / expected).toBeGreaterThan(0.95);
    expect(fed.jet.engine!.thrust / expected).toBeLessThan(1.0001);
    // Fuel flow = thrust / (Isp g0), liquid fuel only.
    expect(fed.jet.engine!.massFlow).toBeCloseTo(fed.jet.engine!.thrust / (fixtureJet.ispVac * G0), 9);
    expect(fed.v.telemetry.intakeAirRatio).toBe(1);
  });

  it('spools up over several seconds', () => {
    const { v, jet } = jetVessel({ intake: true, z: 1000, speed: 100 });
    fly(v, 1);
    const t1 = jet.engine!.thrust;
    fly(v, 9);
    const t10 = jet.engine!.thrust;
    expect(t1 / t10).toBeLessThan(0.6);
    expect(t1 / t10).toBeGreaterThan(0.2);
  });

  it('spools down gradually when the throttle is cut (turbine inertia; rockets cut at once)', () => {
    const { v, jet } = jetVessel({ intake: true, z: 1000, speed: 100 });
    fly(v, 10);
    const full = jet.engine!.thrust;
    fly(v, 0.5, 0);
    expect(jet.engine!.thrust / full).toBeGreaterThan(0.5);
    fly(v, 10, 0);
    expect(jet.engine!.thrust).toBe(0);
  });

  it('loses thrust with altitude and flames out in near-vacuum', () => {
    const low = jetVessel({ intake: true, z: 0, speed: 200 });
    low.jet.engine!.throttle = 1;
    fly(low.v, 0.5);
    const high = jetVessel({ intake: true, z: 10_000, speed: 200 });
    high.jet.engine!.throttle = 1;
    fly(high.v, 0.5);
    const ratio = high.jet.engine!.thrust / low.jet.engine!.thrust;
    expect(ratio).toBeCloseTo(Math.pow(Math.exp(-10_000 / 8500), 0.7), 2);

    const edge = jetVessel({ intake: true, z: 120_000, speed: 200 });
    edge.jet.engine!.throttle = 1;
    fly(edge.v, 0.5);
    expect(edge.jet.engine!.flamedOut).toBe(true);
    expect(edge.v.telemetry.intakeAirRatio).toBeLessThan(JET_MIN_AIR_FRACTION);
  });

  it('intake production scales with density, airspeed and area (static minimum when parked)', () => {
    const { v } = jetVessel({ intake: true, z: 0, speed: 0 });
    fly(v, 0.02, 0);
    const intake = v.parts.find((p) => p.partId === 'intake')!;
    // One step of static suction (no consumption at zero throttle); air does not accumulate beyond that.
    const staticRate = 1.225 * 0.4 * INTAKE_STATIC_SPEED;
    expect(intake.resources.intakeAir!).toBeCloseTo(staticRate * 0.02, 2);
    fly(v, 0.2, 0);
    expect(intake.resources.intakeAir!).toBeLessThan(staticRate * 0.02 * 1.05);
  });
});

import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { FlightInput } from '../src/flight/input';
import { game } from '../src/game/store';
import { activateNextStage, attitudeError, buildVessel, neutralInput, recomputeMassProperties, stepVessel } from '../src/sim/vessel';
import { engineModule, GIMBAL_SLEW_RATE, igniteEngine, maxMassFlow, stepEngines } from '../src/sim/vessel/engines';
import { aerodynamicStress, aeroFatigueRate, AERO_BREAKUP_FASTEST, AERO_BREAKUP_SLOWEST, AERO_WARN_INTERVAL } from '../src/sim/vessel/structure';
import { flatEarthEnv, NOSE_UP, stackCraft, TEST_CATALOG, vacuumEnv } from '../src/sim/vessel/testing';
import { qFromAxisAngle, qRotate } from '../src/util/quat';
import { dot, length, v3 } from '../src/util/vec3';
import { structuralStressPunch } from '../src/render/fx/eventDesign';

const DT = .02;
const degrees = (r: number) => r * 180 / Math.PI;

describe('WP6 handling with inertia', () => {
  it('limits combined gimbal slew to 25°/s through full-command reversals and different substeps', () => {
    for (const dt of [.02, .005]) {
      const v = buildVessel(buildOrbiter(), PART_CATALOG);
      activateNextStage(v);
      const p = v.parts.find(p => p.engine?.ignited)!;
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        if (i === 100) p.tweaks = { ...p.tweaks, gimbalLock: true };
        const a = p.engine!.gimbal.a, b = p.engine!.gimbal.b;
        stepEngines(v, 1, v3(i < 40 ? 1 : -1, 0, i < 80 ? 1 : -1), 0, dt, []);
        const rate = Math.hypot(p.engine!.gimbal.a - a, p.engine!.gimbal.b - b) / dt;
        peak = Math.max(peak, rate);
        expect(rate).toBeLessThanOrEqual(GIMBAL_SLEW_RATE + 1e-10);
        expect(degrees(rate)).toBeLessThanOrEqual(30);
      }
      expect(degrees(peak)).toBeCloseTo(25, 8);
    }
  });

  it('retains liquid ignition spool-up and repeats it after shutdown/reignition', () => {
    const v = buildVessel(stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG);
    activateNextStage(v);
    const p = v.parts.find(p => p.engine)!;
    stepEngines(v, 1, v3(), 0, DT, []);
    expect(p.engine!.throttle).toBeGreaterThan(0);
    expect(p.engine!.throttle).toBeLessThan(.15);
    for (let i = 0; i < 100; i++) stepEngines(v, 1, v3(), 0, DT, []);
    expect(p.engine!.spooledUp).toBe(true);
    p.engine!.ignited = false;
    stepEngines(v, 1, v3(), 0, DT, []);
    expect(igniteEngine(v, p)).toBe(true);
    stepEngines(v, 1, v3(), 0, DT, []);
    expect(p.engine!.throttle).toBeLessThan(.15);
  });

  it('solid tail-off decreases thrust smoothly, consumes its fuel and terminates in finite time', () => {
    const v = buildVessel(stackCraft(['probe', { partId: 'srb', stage: 0 }]), TEST_CATALOG);
    activateNextStage(v);
    const p = v.parts.find(p => p.engine)!;
    const m = engineModule(p)!;
    p.resources.solidFuel = maxMassFlow(m) / v.resourceDefs.solidFuel.density;
    let previous = Infinity, sawTail = false;
    for (let i = 0; i < 300 && p.engine!.ignited; i++) {
      stepEngines(v, 0, v3(), 0, DT, []);
      if (p.engine!.ignited) {
        expect(p.engine!.thrust).toBeLessThanOrEqual(previous);
        if (p.engine!.thrust < .5 * m.maxThrustVac) sawTail = true;
        previous = p.engine!.thrust;
      }
    }
    expect(sawTail).toBe(true);
    expect(p.engine!.flamedOut).toBe(true);
    expect(p.engine!.thrust).toBe(0);
    expect(p.resources.solidFuel).toBe(0);
  });

  for (const id of ['stock-kestrel', 'stock-meridian', 'stock-selene']) {
    it(`${id}: a real 0.2 s keyboard pitch tap at 40 m/s stays within 5° including settling`, () => {
      const target = Object.assign(new EventTarget(), { document: { hasFocus: () => true, activeElement: null }, navigator: {} });
      const input = new FlightInput(target as unknown as Window);
      const settings = game.get().settings;
      const key = (type: string) => target.dispatchEvent(Object.assign(new Event(type), {
        code: 'KeyS', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false,
      }));
      try {
        game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0, invertPitch: false } });
        const v = buildVessel(STOCK_CRAFTS.find(s => s.id === id)!.build(), PART_CATALOG, { orientation: NOSE_UP, position: v3(0, 0, 1000), velocity: v3(0, 0, 40) });
        activateNextStage(v);
        // Warm the engine while clamped; this tap exercises full powered authority, not ignition lag.
        for (let i = 0; i < 300; i++) stepEngines(v, 1, v3(), 101325, DT, []);
        recomputeMassProperties(v);
        const start = { ...v.orientation };
        const env = flatEarthEnv({ g: 0, scaleHeight: Infinity, surface: 'none' });
        key('keydown');
        let peak = 0;
        for (let i = 0; i < 150; i++) {
          if (i === 10) key('keyup');
          input.update(DT);
          stepVessel(v, neutralInput({ pitch: input.state.pitch, throttle: 1, sas: 'stabilityAssist' }), env, i * DT);
          peak = Math.max(peak, degrees(length(attitudeError(start, v.orientation))));
        }
        console.log(`${id} tap peak ${peak.toFixed(2)}°`);
        expect(peak).toBeGreaterThan(.01);
        expect(peak).toBeLessThanOrEqual(5);
        expect(v.destroyed).toBe(false);
      } finally { input.dispose(); game.set({ settings }); }
    });
  }

  it('Meridian coast slews 90° and settles within 10 s with RCS enabled', () => {
    const v = buildVessel(buildOrbiter(), PART_CATALOG);
    const target = v3(0, 0, 1);
    const env = vacuumEnv();
    let reached = -1;
    let maxAfter = 0;
    for (let i = 0; i < 50 * 15; i++) {
      stepVessel(v, neutralInput({ rcs: true, sas: 'maneuver', maneuverDirection: target }), env, i * DT);
      const error = degrees(Math.acos(Math.min(1, dot(qRotate(v.orientation, v3(0, 1, 0)), target))));
      if (reached < 0 && error < 1) reached = (i + 1) * DT;
      if (reached >= 0) maxAfter = Math.max(maxAfter, error);
    }
    console.log(`Meridian coast 90° reaches 1° in ${reached.toFixed(2)} s`);
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThanOrEqual(10);
    expect(maxAfter).toBeLessThan(1.2);
    expect(length(v.angularVelocity)).toBeLessThan(.005);
  });

  for (const id of ['stock-selene', 'stock-meridian-real']) {
    it(`${id}: a large stack turns 90° in <10 s on gimbal alone`, () => {
      const v = buildVessel(STOCK_CRAFTS.find(s => s.id === id)!.build(), PART_CATALOG);
      for (const p of v.parts) p.tweaks = { ...p.tweaks, wheelMode: 'off' };
      activateNextStage(v);
      const target = v3(0, 0, 1), env = vacuumEnv();
      let reached = -1;
      for (let i = 0; i < 500; i++) {
        const result = stepVessel(v, neutralInput({ throttle: 1, sas: 'maneuver', maneuverDirection: target }), env, i * DT);
        expect(result.events.some(e => e.type === 'structuralFailure')).toBe(false);
        const error = degrees(Math.acos(Math.min(1, dot(qRotate(v.orientation, v3(0, 1, 0)), target))));
        if (error < 1) { reached = (i + 1) * DT; break; }
      }
      console.log(`${id} gimbal 90° reaches 1° in ${reached.toFixed(2)} s`);
      expect(reached).toBeGreaterThan(0);
      expect(reached).toBeLessThan(10);
    });
  }

  for (const [angle, q, speed] of [[30, 65_000, 400], [90, 250_000, 680]]) {
    it(`Meridian at ${angle}° AoA / ${q / 1000} kPa warns at least 0.7 s before breakup, within 3 s`, () => {
      const radians = angle * Math.PI / 180;
      const v = buildVessel(buildOrbiter(), PART_CATALOG, { orientation: NOSE_UP, position: v3(0, 0, 3000),
        velocity: v3(speed * Math.sin(radians), 0, speed * Math.cos(radians)) });
      const env = flatEarthEnv({ g: 0, rho0: 2 * q / speed ** 2, scaleHeight: Infinity, surface: 'none' });
      let warned = -1, failed = -1, warnings = 0;
      for (let i = 0; i < 150; i++) {
        // Threshold case is sustained wind-tunnel exposure; the Mach-2 sideways case flies freely.
        if (angle === 30) {
          v.orientation = NOSE_UP; v.angularVelocity = v3();
          v.velocity = v3(speed * Math.sin(radians), 0, speed * Math.cos(radians));
        }
        const result = stepVessel(v, neutralInput(), env, i * DT);
        for (const event of result.events) if (event.type === 'structuralWarning') {
          if (warned < 0) warned = i * DT;
          warnings++;
          expect(structuralStressPunch(event.loadFraction)).toBeGreaterThan(0);
          expect(structuralStressPunch(event.loadFraction)).toBeLessThanOrEqual(.25);
        }
        if (result.events.some(e => e.type === 'structuralFailure' || e.type === 'partDestroyed' && e.reason === 'overheat')) { failed = (i + 1) * DT; break; }
      }
      console.log(`AoA ${angle}°: warned ${warned.toFixed(2)} s, failed ${failed.toFixed(2)} s`);
      expect(warned).toBeGreaterThanOrEqual(0);
      expect(failed).toBeGreaterThanOrEqual(warned + .7);
      expect(failed).toBeLessThan(3);
      // The warning re-sounds while the hull stays in the envelope instead of firing once.
      expect(warnings).toBeGreaterThanOrEqual(Math.floor((failed - warned) / AERO_WARN_INTERVAL));
    });
  }

  it('breakup time falls from 2.4 s at the envelope edge to 0.8 s at extreme exposure', () => {
    expect(.08 / aeroFatigueRate(1)).toBeCloseTo(AERO_BREAKUP_SLOWEST / 1, 10);
    expect(.08 / aeroFatigueRate(3)).toBeCloseTo(AERO_BREAKUP_FASTEST, 10);
    expect(.08 / aeroFatigueRate(30)).toBeCloseTo(AERO_BREAKUP_FASTEST, 10);
  });

  it('only warns in the warn band, and never fails the hull', () => {
    // 70–100% of both limits: audible creaks, but no breakup however long it is held.
    const q = 50_000, speed = 400, radians = 22 * Math.PI / 180;
    const velocity = v3(speed * Math.sin(radians), 0, speed * Math.cos(radians));
    expect(aerodynamicStress(q, velocity)).toBeGreaterThan(.4);
    expect(aerodynamicStress(q, velocity)).toBeLessThan(1);
    const v = buildVessel(buildOrbiter(), PART_CATALOG, { orientation: NOSE_UP, position: v3(0, 0, 3000), velocity });
    const env = flatEarthEnv({ g: 0, rho0: 2 * q / speed ** 2, scaleHeight: Infinity, surface: 'none' });
    let warnings = 0;
    for (let i = 0; i < 400; i++) {
      v.orientation = NOSE_UP; v.angularVelocity = v3(); v.velocity = velocity;
      const result = stepVessel(v, neutralInput(), env, i * DT);
      warnings += result.events.filter(e => e.type === 'structuralWarning').length;
      expect(result.events.some(e => e.type === 'structuralFailure')).toBe(false);
    }
    expect(warnings).toBeGreaterThan(5);
    expect(v.parts.every(p => !p.structuralFatigue)).toBe(true);
  });

  it('recovers from a brief excursion: fatigue relaxes slowly and the warning clears', () => {
    const q = 90_000, speed = 400, radians = 45 * Math.PI / 180;
    const sideways = v3(speed * Math.sin(radians), 0, speed * Math.cos(radians));
    const v = buildVessel(buildOrbiter(), PART_CATALOG, { orientation: NOSE_UP, position: v3(0, 0, 3000), velocity: sideways });
    const env = flatEarthEnv({ g: 0, rho0: 2 * q / speed ** 2, scaleHeight: Infinity, surface: 'none' });
    const fatigue = () => Math.max(0, ...v.parts.map(p => p.structuralFatigue ?? 0));
    for (let i = 0; i < 25; i++) {
      v.orientation = NOSE_UP; v.angularVelocity = v3(); v.velocity = sideways;
      const result = stepVessel(v, neutralInput(), env, i * DT);
      expect(result.events.some(e => e.type === 'structuralFailure')).toBe(false);
    }
    const peak = fatigue();
    expect(peak).toBeGreaterThan(.02);
    expect(peak).toBeLessThan(.08);
    // The pilot noses over: still creaking for a moment, then clean.
    for (let i = 25; i < 250; i++) {
      v.orientation = NOSE_UP; v.angularVelocity = v3(); v.velocity = v3(0, 0, speed);
      const result = stepVessel(v, neutralInput(), env, i * DT);
      expect(result.events.some(e => e.type === 'structuralFailure')).toBe(false);
      if (i === 30) expect(fatigue()).toBeGreaterThan(peak * .8);
    }
    expect(fatigue()).toBe(0);
  });

  it('keeps aligned and shield-first airflow outside the crossflow envelope', () => {
    expect(aerodynamicStress(300_000, v3(0, 680, 0))).toBe(0);
    expect(aerodynamicStress(300_000, v3(0, -680, 0))).toBe(0);
    expect(aerodynamicStress(41_999, v3(680, 0, 0))).toBe(0);
    expect(aerodynamicStress(59_999, v3(680, 0, 0))).toBeLessThan(1);
    expect(aerodynamicStress(65_000, v3(400, 0, 0))).toBeGreaterThan(1);
    // A stock gravity turn peaks near 0.5 × the envelope at 5 kPa; the band begins well above that.
    expect(aerodynamicStress(10_000, v3(400, 0, 0))).toBe(0);
  });

  it('never creates coasting authority on a wheel-less vessel', () => {
    const v = buildVessel(stackCraft(['ballast', 'tank']), TEST_CATALOG);
    for (let i = 0; i < 500; i++) stepVessel(v, neutralInput({ rcs: true, sas: 'maneuver', maneuverDirection: v3(0, 0, 1) }), vacuumEnv(), i * DT);
    expect(v.orientation).toEqual(qFromAxisAngle(v3(1, 0, 0), 0));
  });
});

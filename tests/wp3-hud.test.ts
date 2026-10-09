import { describe, expect, it } from 'vitest';
import { SpeedModeTracker, orbitSpeedAltitude } from '../src/flight/speedMode';
import { Universe } from '../src/game/universe';
import { ThrottleCueTracker, flightMessages } from '../src/flight/cues';
import { hintFor } from '../src/flight/hints';
import { landingReadout } from '../src/flight/landingReadout';
import { AlertTracker, alertConditions, type AlertInput } from '../src/flight/alerts';
import { SCENARIOS, setupScenario } from '../src/scenarios/catalog';
import { cachedStageDeltaV } from '../src/game/stageDeltaVCache';
import { dvBasis, hudStages, totalVacuumDv } from '../src/flight/controller/stages';
import { ascentGuidance, landingController, runAutopilot, localFrame, noseDirection } from '../src/game/autopilot';
import { dot, v3 } from '../src/util/vec3';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonLander, buildOrbiter } from '../src/editor/stockCrafts';
import { buildVessel, neutralInput, stepVessel } from '../src/sim/vessel';
import { flatEarthEnv, NOSE_UP } from '../src/sim/vessel/testing';
import { World } from '../src/game/world';
import { DEFAULT_START_UT } from '../src/game/store';
import { requireIntactFlight } from './helpers/structural';

const calm: AlertInput = { noControl: false, eva: false, flying: true, heatFraction: 0, gForce: 1, agl: 100,
  verticalSpeed: -20, horizontalSpeed: 0, chutes: false, gear: 'down', thrusting: true, stageBurnTime: 100,
  flameout: false, power: 1, gravity: 1.62, brakingAcceleration: 5, brakingFuelSeconds: 100 };

describe('automatic speed reference', () => {
  for (const scale of ['standard', 'real'] as const) for (const body of ['earth', 'moon']) {
    it(`${scale} ${body}: ascent, orbit, descending hysteresis and touchdown`, () => {
      const b = new Universe(scale).body(body), threshold = orbitSpeedAltitude(b.radius, b.atmosphere?.height ?? 0);
      const tracker = new SpeedModeTracker();
      const at = (alt: number, landed = false) => tracker.update('craft', body, alt, threshold, landed, false);
      expect(at(0, true)).toBe('surface');
      expect(at(threshold - 1)).toBe('surface');
      expect(at(threshold)).toBe('orbit');
      expect(at(threshold * 0.98)).toBe('orbit');
      expect(at(threshold * 0.94)).toBe('surface');
      expect(at(threshold * 2, true)).toBe('surface');
      expect(threshold).toBe(body === 'earth' ? b.atmosphere!.height : b.radius * 0.05);
    });
  }
  it('preserves manual selection until Auto, a vessel switch or an SOI change', () => {
    const t = new SpeedModeTracker();
    t.update('a', 'earth', 0, 70000, true, false);
    t.select('surface');
    expect(t.update('a', 'earth', 150000, 70000, false, false)).toBe('surface');
    t.select('auto');
    expect(t.update('a', 'earth', 150000, 70000, false, false)).toBe('orbit');
    t.select('surface');
    expect(t.update('a', 'moon', 20000, 8687, false, false)).toBe('orbit');
    t.select('orbit');
    expect(t.update('b', 'earth', 0, 70000, true, false)).toBe('surface');
  });
  it('uses Target only for a nearby vessel, with range hysteresis and loss fallback', () => {
    const t = new SpeedModeTracker();
    const at = (distance = Infinity, target = true) => t.update('a', 'earth', 150000, 70000, false, target, distance);
    expect(at()).toBe('orbit'); // celestial targets never imply rendezvous
    expect(at(1900)).toBe('target');
    expect(at(2400)).toBe('target');
    expect(at(2600)).toBe('orbit');
    t.select('surface'); expect(at(100)).toBe('surface');
    t.select('target'); expect(at(100, false)).toBe('orbit');
    expect(t.selection).toBe('auto');
  });
});

describe('thrust-aware cautions', () => {
  it('is quiet at the audit braking-burn state but warns for ballistic / insufficient / inverted thrust', () => {
    expect(alertConditions(calm).filter(a => a.id === 'terrain')).toEqual([]);
    for (const brakingAcceleration of [0, 1, 2]) expect(alertConditions({ ...calm, brakingAcceleration }).some(a => a.id === 'terrain')).toBe(true);
    expect(alertConditions({ ...calm, brakingFuelSeconds: 0.5 }).some(a => a.id === 'terrain')).toBe(true);
    expect(landingReadout(100, -20, 1.62, 0).ballisticTime).toBeLessThan(5);
  });
  it('clears a stale terrain warning as soon as braking can stop the descent', () => {
    const tracker = new AlertTracker();
    expect(tracker.update({ ...calm, brakingAcceleration: 0 }, 0).some(a => a.id === 'terrain')).toBe(true);
    expect(tracker.update(calm, 0.1).some(a => a.id === 'terrain')).toBe(false);
  });
  it('never warns TERRAIN during a real land-assist descent touching down below 3 m/s', () => {
    const { world } = setupScenario(SCENARIOS.find(s => s.id === 'suicide-burn')!);
    const assist = landingController(world);
    const tracker = new AlertTracker();
    let samples = 0, terrainAlerts = 0;
    const landed = runAutopilot(world, assist, { maxTime: 300, onTick: w => {
      if (++samples % 5) return; // Same 10 Hz policy cadence as the HUD.
      const v = w.active!, st = v.state, b = w.universe.body(v.body), info = w.universe.surfaceInfo(v.body, st.position, w.ut);
      const stage = cachedStageDeltaV(st, st.telemetry.staticPressure, b.surfaceGravity).find(s => s.stage === st.nextStage + 1);
      const frame = localFrame(w, v);
      const input = { ...calm, flying: st.situation === 'flying', agl: info.heightAboveTerrain, verticalSpeed: w.verticalSpeed(v),
        gravity: b.gm / info.r ** 2, brakingAcceleration: (stage?.thrust ?? 0) / st.mass * Math.max(0, dot(noseDirection(st), frame.up)), brakingFuelSeconds: stage?.burnTime ?? 0 };
      terrainAlerts += tracker.update(input, w.ut).filter(a => a.id === 'terrain').length;
    } });
    expect(landed).toBe(true);
    expect(samples).toBeGreaterThan(100);
    expect(assist.touchdown!.speed).toBeLessThan(3);
    expect(terrainAlerts).toBe(0);
  }, 30000);
});

describe('structural caution', () => {
  const ids = (input: AlertInput) => alertConditions(input).filter(a => a.id === 'structure');
  it('lights as a caution in the warn band, escalates inside the breakup envelope, and is quiet otherwise', () => {
    expect(ids(calm)).toEqual([]);
    expect(ids({ ...calm, structuralStress: 0 })).toEqual([]);
    expect(ids({ ...calm, structuralStress: 0.6 }).map(a => a.level)).toEqual(['warn']);
    expect(ids({ ...calm, structuralStress: 0.99 }).map(a => a.level)).toEqual(['warn']);
    expect(ids({ ...calm, structuralStress: 1 }).map(a => a.level)).toEqual(['bad']);
    expect(ids({ ...calm, structuralStress: 3, flying: false })).toEqual([]);
  });
  it('shows one entry, escalates immediately, and clears after the hold once out of the band', () => {
    const tracker = new AlertTracker();
    const at = (structuralStress: number, t: number) => tracker.update({ ...calm, structuralStress }, t).filter(a => a.id === 'structure');
    expect(at(0, 0)).toEqual([]);
    expect(at(0.7, 0.1).map(a => a.level)).toEqual(['warn']);
    expect(at(1.5, 0.2).map(a => a.level)).toEqual(['bad']);
    expect(at(0, 0.3)).toHaveLength(1); // holds briefly, no flicker
    expect(at(0, 2)).toEqual([]);
  });
  it('is fed by the crossflow telemetry: populated in the band, zero in aligned flight', () => {
    const q = 50_000, speed = 400, radians = 22 * Math.PI / 180;
    const v = buildVessel(buildOrbiter(), PART_CATALOG, { orientation: NOSE_UP, position: v3(0, 0, 3000), velocity: v3(0, 0, speed) });
    const env = flatEarthEnv({ g: 0, rho0: 2 * q / speed ** 2, scaleHeight: Infinity, surface: 'none' });
    stepVessel(v, neutralInput(), env, 0);
    expect(v.telemetry.crossflowStress).toBe(0);
    v.orientation = NOSE_UP; v.angularVelocity = v3(); v.velocity = v3(speed * Math.sin(radians), 0, speed * Math.cos(radians));
    stepVessel(v, neutralInput(), env, 0.02);
    expect(v.telemetry.crossflowStress).toBeGreaterThan(0.4);
    expect(v.telemetry.crossflowStress).toBeLessThan(1);
    expect(alertConditions({ ...calm, structuralStress: v.telemetry.crossflowStress }).some(a => a.id === 'structure')).toBe(true);
  });
  it('never fires, and telemetry stays 0, during a normal stock ascent', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    requireIntactFlight(w); w.launch(buildMoonLander());
    const tracker = new AlertTracker();
    let samples = 0, fired = 0, peak = 0;
    expect(runAutopilot(w, ascentGuidance(w, { targetApoapsis: 90000, minStage: 4 }), { maxTime: 900, onTick: ww => {
      const st = ww.active!.state;
      peak = Math.max(peak, st.telemetry.crossflowStress);
      if (++samples % 5) return;
      fired += tracker.update({ ...calm, structuralStress: st.telemetry.crossflowStress }, ww.ut).filter(a => a.id === 'structure').length;
    } })).toBe(true);
    expect(samples).toBeGreaterThan(1000);
    expect(peak).toBe(0);
    expect(fired).toBe(0);
  }, 120000);
});

it('shows nonzero Δv for pre-ignited engines, even without activated flags or stage numbers', () => {
  const { world } = setupScenario(SCENARIOS.find(s => s.id === 'suicide-burn')!);
  const st = world.active!.state;
  const dvs = cachedStageDeltaV(st, 0, world.universe.body('moon').surfaceGravity);
  const active = st.parts.find(p => p.engine?.ignited)!;
  expect(active.activated).toBe(false);
  for (const stage of [active.stage, undefined]) {
    active.stage = stage;
    const display = hudStages(st, dvs);
    expect(display.find(s => s.index === st.nextStage + 1)!.deltaV).toBeGreaterThan(100);
    expect(display.reduce((s, x) => s + x.deltaV, 0)).toBeCloseTo(dvs.reduce((s, x) => s + x.dv, 0));
  }
});

it('labels the flight Δv basis and keeps the vacuum total beside the sea-level one', () => {
  expect(dvBasis(0, 101325)).toBe('vac');
  expect(dvBasis(101325, 101325)).toBe('asl');
  expect(dvBasis(60000, 101325)).toBe('atm');
  expect(dvBasis(0.5, 101325)).toBe('vac');
  expect(dvBasis(101325, 0)).toBe('vac');
  const v = buildVessel(buildOrbiter(), PART_CATALOG);
  const g = 9.81;
  const asl = hudStages(v, cachedStageDeltaV(v, 101325, g));
  const total = asl.reduce((s, x) => s + x.deltaV, 0);
  const vac = totalVacuumDv(asl, cachedStageDeltaV(v, 0, g));
  expect(total).toBeGreaterThan(0);
  expect(vac).toBeGreaterThan(total); // the pad total is lower than vacuum; the HUD shows both, labelled
  // Reading both bases every tick must not thrash the cache.
  expect(cachedStageDeltaV(v, 101325, g)).toBe(cachedStageDeltaV(v, 101325, g));
  const vacRead = cachedStageDeltaV(v, 0, g);
  cachedStageDeltaV(v, 101325, g);
  expect(cachedStageDeltaV(v, 0, g)).toBe(vacRead);
});

it('debounces unstaged throttle and removes obsolete messages on ignition/staging', () => {
  const t = new ThrottleCueTracker(), reason = 'Engines not staged — activate the engine stage first';
  expect(t.update(reason, 0, false)).toBeNull();
  expect(t.update(reason, 0.5, true)).toBeNull();
  expect(t.update(null, 0.6, false)).toBeNull();
  expect(t.update(reason, 2, false)).toBeNull();
  expect(t.update(reason, 3, false)).toBe(reason);
  expect(t.update(reason, 4, false)).toBeNull();
  const messages = [reason, 'Stage 4 activated', 'Liftoff!', 'Liftoff!'].map((text, id) => ({ id, text, level: 'info' as const }));
  expect(flightMessages(messages, null, true).map(m => m.text)).toEqual(['Liftoff!', 'Stage 4 activated']);
});

it('offers the turn at 50–100 m/s, never late, descending or on the Moon', () => {
  const i = { enabled: true, flying: true, altitude: 400, surfaceSpeed: 75, apoapsis: 600, periapsis: -100, timeToAp: 30, atmosphereHeight: 70000, throttle: 1, hasThrust: true };
  expect(hintFor(i, new Set())?.id).toBe('turn');
  for (const surfaceSpeed of [49, 101, 252]) expect(hintFor({ ...i, surfaceSpeed }, new Set())).toBeNull();
  expect(hintFor({ ...i, verticalSpeed: -75 }, new Set())).toBeNull();
  expect(hintFor({ ...i, bodyId: 'moon', atmosphereHeight: 0 }, new Set())).toBeNull();
  const orbit = hintFor({ ...i, bodyId: 'moon', bodyName: 'Moon', atmosphereHeight: 0, periapsis: 20000 }, new Set());
  expect(orbit?.text).toContain('around Moon');
  expect(orbit?.text).not.toMatch(/Earth|short hop/);
  expect(hintFor({ ...i, boundOrbit: false, periapsis: 90000 }, new Set())?.id).not.toBe('orbit');
});

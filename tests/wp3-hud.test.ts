import { describe, expect, it } from 'vitest';
import { SpeedModeTracker, orbitSpeedAltitude } from '../src/flight/speedMode';
import { Universe } from '../src/game/universe';
import { ThrottleCueTracker, flightMessages } from '../src/flight/cues';
import { hintFor } from '../src/flight/hints';
import { landingReadout } from '../src/flight/landingReadout';
import { AlertTracker, alertConditions, type AlertInput } from '../src/flight/alerts';
import { SCENARIOS, setupScenario } from '../src/scenarios/catalog';
import { cachedStageDeltaV } from '../src/game/stageDeltaVCache';
import { hudStages } from '../src/flight/controller/stages';
import { landingController, runAutopilot, localFrame, noseDirection } from '../src/game/autopilot';
import { dot } from '../src/util/vec3';

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

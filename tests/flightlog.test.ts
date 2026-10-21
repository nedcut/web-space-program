import { isBurstEvent } from '../src/render/fx/FlightFx';
import type { VesselEvent } from '../src/sim/vessel/runtime';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { crossesRingPlane, appendEvent, ARCHIVE_SAMPLE_CAP, HISTORY_CAP, trimHistory, EVENT_CAP, finishRecord, newRecorder, observe, SAMPLE_CAP, orderedSamples, sampleInterval, parentReport, eventDetail, startRecord, summaryText, type Observation } from '../src/game/flightlog/recorder';
import { ACHIEVEMENTS, awardAchievements } from '../src/game/flightlog/achievements';
import { loadAchievements, saveAchievements } from '../src/game/flightlog/storage';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { neutralInput } from '../src/sim/vessel';
import { add, scale } from '../src/util/vec3';
const observation = (ut: number, patch: Partial<Observation> = {}): Observation => ({ ut, body: 'earth', altitude: 100, speed: 10, vertical: 8, horizontal: 6, ap: 1000, pe: -1000, mach: 0.1, q: 100, g: 1, temperature: 300, mass: 1000, dv: 500, thrustAcceleration: 2, flying: true, prelaunch: false, stableOrbit: false, parts: 10, shield: false, plane: false, splashed: false, ringPass: false, ...patch });
afterEach(() => vi.unstubAllGlobals());
describe('flight recorder', () => {
  it('adapts cadence and keeps chronological capped tuples and events', () => {
    const r = startRecord(newRecorder(), 'v', 'Test', 0);
    observe(r, observation(0)); observe(r, observation(0.1));
    expect(r.samples).toHaveLength(1);
    for (let i = 1; i < SAMPLE_CAP + 20; i++) observe(r, observation(i));
    expect(r.samples.length).toBeLessThanOrEqual(SAMPLE_CAP);
    expect(orderedSamples(r)[0][0]).toBe(0);
    expect(orderedSamples(r).at(-1)![0]).toBe(SAMPLE_CAP + 19);
    for (let i = 0; i < EVENT_CAP + 10; i++) appendEvent(r, i, 'stage', 'earth');
    expect(r.events).toHaveLength(EVENT_CAP);
    expect(r.stats.maxSpeed).toBe(10);
    expect(r.stats.dvSpent).toBeCloseTo(2 * (SAMPLE_CAP + 19));
    expect(sampleInterval(observation(0, { q: 0, thrustAcceleration: 0, altitude: 1e5, stableOrbit: true }))).toBe(30);
    expect(sampleInterval(observation(0, { prelaunch: true }))).toBe(5);
  });
  it('compacts finished reports and bounds the archive without evicting live flights', () => {
    const state = newRecorder();
    const live = startRecord(state, 'live', 'Live', 0);
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      const r = startRecord(state, `v${i}`, 'Archive', 0);
      for (let j = 0; j < 300; j++) observe(r, observation(j));
      finishRecord(r, 300, 'recovered'); trimHistory(state);
      expect(r.samples).toHaveLength(ARCHIVE_SAMPLE_CAP);
      expect(r.samples[0][0]).toBe(0); expect(r.samples.at(-1)![0]).toBe(299);
    }
    expect(state.records.filter(r => r.outcome)).toHaveLength(HISTORY_CAP);
    expect(state.records).toContain(live);
  });
  it('detects flight, stable orbit, transitions, and touchdown exactly once', () => {
    const r = startRecord(newRecorder(), 'v', 'Voyager', 0);
    observe(r, observation(0, { flying: false, prelaunch: true }));
    observe(r, observation(1));
    observe(r, observation(2, { stableOrbit: true }));
    observe(r, observation(3, { stableOrbit: true }));
    observe(r, observation(4, { body: 'moon', speed: 0.5 }));
    observe(r, observation(5, { body: 'moon', flying: false, biome: 'Highlands' }));
    observe(r, observation(6, { body: 'moon', flying: false }));
    finishRecord(r, 7, 'recovered'); finishRecord(r, 8, 'recovered');
    expect(r.events.map(e => e.kind)).toEqual(['launch', 'orbit', 'soi', 'landing', 'recovery']);
    expect(r.events.find(e => e.kind === 'landing')).toMatchObject({ speed: 0.5, biome: 'Highlands' });
    expect(summaryText(r)).toContain('Bodies visited: Earth, Moon');
    expect(summaryText(r)).toContain('0.50 m/s');
  });
  it('preserves a long flight start, burn, sampled peaks, events and final endpoint within both budgets', () => {
    const r = startRecord(newRecorder(), 'long', 'Kestrel', 1000);
    observe(r, observation(1000, { flying: false, prelaunch: true }));
    for (let i = 1; i <= 20000; i++) {
      if (i === 120) appendEvent(r, 1000 + i / 4, 'stage', 'earth');
      observe(r, observation(1000 + i / 4, {
        altitude: i === 200 ? 314800 : 100, speed: i === 150 ? 2500 : 10,
        g: i === 18000 ? 24.17 : 1, flying: i < 19000,
      }));
      expect(r.samples.length).toBeLessThanOrEqual(SAMPLE_CAP);
    }
    finishRecord(r, 6100, 'recovered');
    expect(r.samples.length).toBeLessThanOrEqual(ARCHIVE_SAMPLE_CAP);
    expect(r.samples[0][0]).toBe(0);
    expect(r.samples.at(-1)![0]).toBe(5000);
    for (const time of [0.25, 30, 50, 37.5, 4500, 4750]) expect(r.samples.some(s => s[0] === time)).toBe(true);
    expect(r.samples.map(s => s[0])).toEqual([...r.samples.map(s => s[0])].sort((a, b) => a - b));
    expect(summaryText(r)).toContain('Record elapsed (includes pad and recovery time): 5100 s');
    expect(summaryText(r)).toContain('Elapsed 0.3 s Liftoff');
    expect(summaryText(r)).not.toContain('T+');
  });
  it('keeps an activated asteroid identifiable in timeline and shared summary copy', () => {
    const r = startRecord(newRecorder(), 'asteroid-lander', 'Prospector', 1000);
    observe(r, observation(1000, { body: 'asteroid-208' }));
    appendEvent(r, 1001, 'soi', 'asteroid-208');
    finishRecord(r, 1002, 'recovered');
    expect(summaryText(r)).toContain('Bodies visited: asteroid-208');
    expect(summaryText(r)).toContain('Entered asteroid-208 sphere of influence');
    expect(summaryText(r)).not.toContain('Unknown body');
  });
  it('reads legacy circular buffers and sanitizes old timeline diagnostics without mutating them', () => {
    const r = startRecord(newRecorder(), 'legacy', 'Kestrel', 1000);
    for (let i = 0; i < 10; i++) observe(r, observation(1000 + i));
    const original = [...r.samples];
    r.samples = [...original.slice(4), ...original.slice(0, 4)]; r.sampleHead = 6;
    delete r.launchId; delete r.launchName;
    appendEvent(r, 1010, 'separation', 'earth', { detail: 'Detached part 4 → vmvh963f5.1' });
    expect(orderedSamples(r)).toEqual(original);
    expect(summaryText(r)).toContain('Hardware separated · Earth');
    expect(summaryText(r)).not.toContain('vmvh963f5.1');
    expect(r.events.at(-1)!.detail).toContain('vmvh963f5.1');
    expect(eventDetail({ time: 1, kind: 'soi', body: 'moon', detail: 'earth → moon' })).toContain('Moon');
    const debris = { ...r, id: 'fragment', name: 'Kestrel Debris' };
    expect(parentReport(debris, [r, debris])).toBe(r);
    finishRecord(r, 1020, 'recovered');
    expect(r.samples).toEqual(original);
    expect(r.sampleHead).toBe(0);
  });
  it('detects ring-plane crossings and requires a return to the encounter parent for an assist', () => {
    expect(crossesRingPlane({ x: 15, y: 0, z: -4 }, { x: 15, y: 0, z: 4 }, 10, 20)).toBe(true);
    expect(crossesRingPlane({ x: 5, y: 0, z: -4 }, { x: 5, y: 0, z: 4 }, 10, 20)).toBe(false);
    const r = startRecord(newRecorder(), 'flyby', 'Flyby', 0);
    observe(r, observation(0, { body: 'sun', inertialSpeed: 1000, thrustAcceleration: 0 }));
    observe(r, observation(1, { body: 'earth', inertialSpeed: 500, thrustAcceleration: 0 }));
    observe(r, observation(2, { body: 'moon', inertialSpeed: 1500, thrustAcceleration: 0 }));
    expect(r.events.some(e => e.kind === 'assist')).toBe(false);
    const assist = startRecord(newRecorder(), 'assist', 'Assist', 0);
    observe(assist, observation(0, { body: 'sun', inertialSpeed: 1000, thrustAcceleration: 0 }));
    observe(assist, observation(1, { body: 'earth', inertialSpeed: 500, thrustAcceleration: 0 }));
    observe(assist, observation(2, { body: 'sun', inertialSpeed: 1200, thrustAcceleration: 0 }));
    expect(assist.events.some(e => e.kind === 'assist')).toBe(true);
  });
  it('continues sampling prelaunch and unattended vessels outside the physics bubble', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const pad = w.launch(buildOrbiter());
    for (let i = 0; i < 260; i++) w.tick(0.02, neutralInput());
    expect(w.flightlog.records[0].samples.length).toBeGreaterThan(1);
    const other = w.spawnVessel(buildOrbiter(), { position: add(pad.state.position, { x: 1e7, y: 0, z: 0 }), velocity: pad.state.velocity, orientation: pad.state.orientation });
    w.tick(0.02, neutralInput());
    expect(w.flightlog.records.some(r => r.vesselId === other.state.id)).toBe(true);
  });
  it('roundtrips live and archived records, without mutating snapshots', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    w.launch(buildOrbiter());
    w.tick(0.02, neutralInput({ stage: true, throttle: 1 }));
    const saved = serializeWorld(w), loaded = deserializeWorld(JSON.parse(JSON.stringify(saved)), PART_CATALOG);
    expect(loaded.flightlog).toEqual(w.flightlog);
    loaded.logFlightEvent(loaded.active!, 'flag');
    expect(saved.flightlog!.records[0].events.some(e => e.kind === 'flag')).toBe(false);
    const legacy = { ...saved }; delete legacy.flightlog;
    expect(deserializeWorld(legacy, PART_CATALOG).flightlog.records).toHaveLength(0);
    const recovered = new World(new Universe('standard'), PART_CATALOG, 1000);
    recovered.launch(buildOrbiter()); expect(recovered.recoverActive()).toBe(true);
    expect(deserializeWorld(serializeWorld(recovered), PART_CATALOG).flightlog.records[0].outcome).toBe('recovered');
  });
  it('records structural breakups as part losses while fragments inherit their history', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const vessel = w.launch(buildOrbiter());
    const effects: VesselEvent[] = [];
    w.onEvent = e => { if (isBurstEvent(e)) effects.push(e); };
    for (const part of vessel.state.parts) part.def = { ...part.def, breakingForce: 1, breakingTorque: 1 };
    for (let i = 0; i < 50; i++) w.tick(0.02, neutralInput({ stage: i === 0, throttle: 1 }));
    expect(w.flightlog.records.some(r => r.events.some(e => e.kind === 'partLoss' && e.detail?.includes('Attachment')))).toBe(true);
    expect(w.flightlog.records.length).toBeGreaterThan(1);
    const root = w.flightlog.records[0];
    for (const fragment of w.flightlog.records.slice(1)) {
      expect(fragment.launchId).toBe(root.id);
      expect(parentReport(fragment, w.flightlog.records)).toBe(root);
    }
    const reloaded = deserializeWorld(serializeWorld(w), PART_CATALOG);
    expect(reloaded.flightlog).toEqual(w.flightlog);
    expect(effects.some(e => e.type === 'structuralFailure')).toBe(true);
  });
  it('does not integrate stale engine telemetry while packed during time warp', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const v = w.launch(buildOrbiter());
    v.state.telemetry.thrust = v.state.mass * 2;
    v.mode = 'landedRails';
    w.recordFlight(v, w.ut + 10000, true);
    expect(w.flightlog.records[0].stats.dvSpent).toBe(0);
    expect(w.flightlog.records[0].last!.thrustAcceleration).toBe(0);
  });
  it('peak speed uses orbital speed high up, not the surface frame of a rotating body', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const v = w.launch(buildOrbiter());
    const earth = w.universe.body('earth'), bs = w.universe.ephem.getBodyState('earth', w.ut), radius = earth.radius + 30_000_000;
    v.mode = 'physics'; v.state.situation = 'flying';
    // A slow high coast (a lunar return's apoapsis): its surface-frame speed is dominated by Earth's rotation.
    v.state.position = add(bs.position, { x: radius, y: 0, z: 0 });
    v.state.velocity = add(bs.velocity, { x: 0, y: 100, z: 0 });
    w.recordFlight(v, w.ut + 1, true);
    expect(w.flightlog.records[0].stats.maxSpeed).toBeCloseTo(100, 0);
  });
  it('observes actual World states for orbit, SOI and recovery', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 1000);
    const v = w.launch(buildOrbiter());
    const earth = w.universe.body('earth'), bs = w.universe.ephem.getBodyState('earth', w.ut), radius = earth.radius + earth.atmosphere!.height + 10000;
    v.mode = 'physics'; v.state.situation = 'flying';
    v.state.position = add(bs.position, { x: radius, y: 0, z: 0 });
    v.state.velocity = add(bs.velocity, { x: 0, y: Math.sqrt(earth.gm / radius), z: 0 });
    w.recordFlight(v, w.ut + 1, true);
    const moon = w.universe.body('moon'), ms = w.universe.ephem.getBodyState('moon', w.ut);
    v.body = 'moon'; v.state.position = add(ms.position, { x: moon.radius + 1000, y: 0, z: 0 });
    v.state.velocity = add(ms.velocity, scale({ x: 1, y: 0, z: 0 }, 0.4));
    w.recordFlight(v, w.ut + 2, true); v.state.situation = 'landed'; w.recordFlight(v, w.ut + 3, true);
    expect(w.flightlog.records[0].events.map(e => e.kind)).toContain('orbit');
    expect(w.flightlog.records[0].landedBodies).toContain('moon');
    expect(w.achievementProfile.unlocked['moon-land']).toBeDefined();
    v.body = 'earth'; v.state.position = add(bs.position, { x: earth.radius + 10, y: 0, z: 0 });
    expect(w.recoverActive()).toBe(true);
    expect(w.achievementProfile.unlocked['moon-return']).toBeDefined();
  });
});
describe('achievements', () => {
  it('awards firsts and skill feats once, with flags aggregated across flights', () => {
    const r = startRecord(newRecorder(), 'v', 'Wing', 0);
    observe(r, observation(0, { plane: true, temperature: 1100, q: 101, speed: 1600, stableOrbit: true, ringPass: true }));
    appendEvent(r, 1, 'docking', 'earth'); appendEvent(r, 2, 'eva', 'earth');
    observe(r, observation(3, { body: 'titan', speed: 0.5 }));
    observe(r, observation(4, { body: 'titan', flying: false, splashed: true }));
    finishRecord(r, 5, 'recovered');
    const state = {}, ids = awardAchievements(state, r, ['earth', 'moon', 'titan'], 5).map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining(['launch', 'orbit', 'soi-titan', 'titan-land', 'rings', 'ssto', 'soft', 'dock', 'eva', 'hot', 'flags-3']));
    expect(awardAchievements(state, r, ['earth', 'moon', 'titan'], 6)).toEqual([]);
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it('persists a profile independently of world saves and tolerates corrupt storage', () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v) });
    const profile = { unlocked: { orbit: 1000 }, flags: ['earth', 'moon'] };
    saveAchievements(profile); expect(loadAchievements()).toEqual(profile);
    saveAchievements({ unlocked: { dock: 2000 }, flags: ['titan'] });
    expect(loadAchievements()).toEqual({ unlocked: { orbit: 1000, dock: 2000 }, flags: ['earth', 'moon', 'titan'] });
    memory.set('wsp.achievements.v1', '{broken'); expect(loadAchievements()).toEqual({ unlocked: {}, flags: [] });
  });
});

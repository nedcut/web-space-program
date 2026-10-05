import { describe, expect, it } from 'vitest';
import { SCENARIOS, setupScenario } from '../src/scenarios/catalog';
import { evaluateMission, initialMission, observeWorld, scoreMission, type Observation, type MissionState } from '../src/scenarios/evaluation';
import { readBests, saveBest, RECORD_KEY } from '../src/scenarios/records';
import { neutralInput } from '../src/sim/vessel';
import { length, v3 } from '../src/util/vec3';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { PART_CATALOG } from '../src/data/parts';
import { game } from '../src/game/store';
import { attachScenarioWorld, endScenario, getScenarioRun, startScenario } from '../src/scenarios/runtime';

const observation = (patch: Partial<Observation> = {}): Observation => ({ ut: 100, alive: true, body: 'moon', landed: false, speed: 2, verticalSpeed: -20, altitude: 1000, agl: 1000, fixed: v3(1000, 0, 0), bound: true, periapsis: 200, atmosphereTop: 0, fullChute: false, intact: true, dockedStation: false, precision: 50, ...patch });
const scenario = (id: string) => SCENARIOS.find(s => s.id === id)!;
function reduce(id: string, sequence: Partial<Observation>[], dv = 0) {
  let state = initialMission(0);
  sequence.forEach((o, i) => { state = evaluateMission(scenario(id).id, state, observation({ ut: 100 + i, ...o }), 1, dv); });
  return state;
}
describe('mission catalog and World setup', () => {
  it.each(SCENARIOS)('$title sets up a finite free flight and roundtrips through the flight snapshot', s => {
    const setup = setupScenario(s), w = setup.world, v = w.active!;
    expect(v).toBeTruthy(); expect(v.mode).toBe('physics'); expect(v.state.situation).toBe('flying');
    expect(Number.isFinite(w.ut)).toBe(true);
    for (const vector of [v.state.position, v.state.velocity]) for (const value of Object.values(vector)) expect(Number.isFinite(value)).toBe(true);
    expect(length(v.state.position)).toBeGreaterThan(0);
    expect(w.universe.dominantBody(v.state.position, w.ut)).toBe(v.body);
    expect(v.state.parts.length).toBeGreaterThan(0); expect(v.state.mass).toBeGreaterThan(0);
    expect(w.mode).toBe('sandbox'); expect(w.commsSettings.enabled).toBe(false);
    const restored = deserializeWorld(serializeWorld(w), PART_CATALOG);
    expect(restored.active!.state.position).toEqual(v.state.position);
    const before = observeWorld(setup, v.state.parts.length);
    expect(before.alive).toBe(true);
    expect(evaluateMission(s.id, initialMission(w.ut), before, 0).status).toBe('flying');
    let steps = 0; w.onSimulationStep = (dt, dv) => { steps++; expect(dt).toBeGreaterThan(0); expect(dv).toBeGreaterThanOrEqual(0); };
    w.tick(0.02, neutralInput()); expect(steps).toBe(1);
  });
  it('captures into a terrain-clearing Mars orbit under shield-first drag alone', () => {
    const setup = setupScenario(scenario('mars-aerobrake')), w = setup.world, count = w.active!.state.parts.length;
    let state = initialMission(w.ut); state.previous = observeWorld(setup, count);
    expect(w.orbitSummary(w.active!).orbit.e).toBeGreaterThan(1);
    w.onSimulationStep = (dt, dv) => { state = evaluateMission('mars-aerobrake', state, observeWorld(setup, count), dt, dv); };
    for (let i = 0; i < 4000 && state.status === 'flying'; i++) w.tick(0.25, neutralInput({ sas: 'retrograde', sasReference: 'surface' }));
    expect(state.status).toBe('success'); expect(state.dv).toBe(0); expect(state.previous!.bound).toBe(true); expect(state.previous!.periapsis).toBeGreaterThan(0);
  }, 30000);
  it('keeps objectives attached to the mission vessel when fleet focus changes', () => {
    const setup = setupScenario(scenario('rendezvous'));
    setup.world.switchTo(setup.stationId!);
    const view = observeWorld(setup, setup.craft.parts.length);
    expect(view.dockedStation).toBe(false);
    expect(view.intact).toBe(true);
    setup.world.vessels.delete(setup.vesselId!);
    expect(observeWorld(setup, setup.craft.parts.length).alive).toBe(false);
  });
  it('has all ten independent mission IDs and keeps landing targets body fixed', () => {
    expect(new Set(SCENARIOS.map(s => s.id)).size).toBe(10);
    for (const id of ['moon-landing', 'titan-descent']) {
      const setup = setupScenario(scenario(id));
      expect(length(setup.target!)).toBeCloseTo(1);
      expect(observeWorld(setup, setup.world.active!.state.parts.length).precision).toBeLessThan(0.1);
    }
  });
  it.each(['ring-skimmer', 'plume-dive'])('%s coasts through its actual World corridor intact', id => {
    const setup = setupScenario(scenario(id)), w = setup.world, count = w.active!.state.parts.length;
    let state = initialMission(w.ut); state.previous = observeWorld(setup, count);
    w.onSimulationStep = (dt, dv) => { state = evaluateMission(scenario(id).id, state, observeWorld(setup, count), dt, dv); };
    for (let i = 0; i < 1600 && state.status === 'flying'; i++) w.tick(0.25, neutralInput());
    expect(state.status).toBe('success'); expect(state.dv).toBe(0);
    if (id === 'plume-dive') expect(state.scienceBonus).toBe(true);
  }, 30000);
});
describe('objectives on synthetic observations', () => {
  it('requires a gap crossing followed by safe exit; interpolates crossing radius', () => {
    const states = [{ body: 'saturn', fixed: v3(11987500, 0, 200) }, { body: 'saturn', fixed: v3(11987500, 0, -200) }, { body: 'saturn', fixed: v3(11987500, 0, -6000) }];
    expect(reduce('ring-skimmer', states.slice(0, 2)).status).toBe('flying');
    expect(reduce('ring-skimmer', states).status).toBe('success');
    expect(reduce('ring-skimmer', states).precision).toBe(0);
    expect(reduce('ring-skimmer', states.map(s => ({ ...s, fixed: { ...s.fixed, x: 13000000 } }))).status).toBe('failed');
    expect(reduce('ring-skimmer', [{ intact: false }]).status).toBe('failed');
  });
  it('requires Titan entry, a full chute and a soft accurate landing', () => {
    const states = [{ body: 'titan', atmosphereTop: 10000, fullChute: true }, { body: 'titan', landed: true }];
    expect(reduce('titan-descent', states).status).toBe('success');
    expect(reduce('titan-descent', states.map(s => ({ ...s, fullChute: false }))).status).toBe('failed');
    expect(reduce('titan-descent', [states[0], { ...states[1], precision: 5001 }]).status).toBe('failed');
  });
  it('requires the south polar plume and an outward exit, with a deeper science bonus', () => {
    const sample = { body: 'enceladus', fixed: v3(0, 0, -1000), agl: 4000 };
    expect(reduce('plume-dive', [sample]).scienceBonus).toBe(true);
    expect(reduce('plume-dive', [sample, { body: 'enceladus', agl: 16000, verticalSpeed: 20 }]).status).toBe('success');
    expect(reduce('plume-dive', [{ ...sample, fixed: v3(0, 0, 1000) }, { body: 'enceladus', agl: 16000, verticalSpeed: 20 }]).status).toBe('flying');
    expect(reduce('plume-dive', [{ ...sample, agl: 6000 }]).scienceBonus).toBe(false);
  });
  it('counts distinct moon SOIs rather than repeated visits', () => {
    expect(reduce('grand-tour', ['titan', 'rhea', 'dione', 'tethys', 'enceladus'].map(body => ({ body }))).status).toBe('success');
    expect(reduce('grand-tour', Array.from({ length: 5 }, () => ({ body: 'titan' }))).status).toBe('flying');
  });
  it('uses pre-contact velocity and rejects a hard or imprecise lunar touchdown', () => {
    const states = [{ speed: 4 }, { landed: true, speed: 0, precision: 100 }];
    expect(reduce('moon-landing', states).landingSpeed).toBe(4);
    expect(reduce('moon-landing', states).status).toBe('success');
    expect(reduce('moon-landing', [{ speed: 6 }, states[1]]).status).toBe('failed');
    expect(reduce('moon-landing', [states[0], { ...states[1], precision: 2001 }]).status).toBe('failed');
  });
  it('requires atmosphere-only Mars capture and a terrain-clearing bound orbit', () => {
    const states = [{ body: 'mars', atmosphereTop: 5000 }, { body: 'mars', atmosphereTop: 5000, altitude: 6000 }];
    expect(reduce('mars-aerobrake', states).status).toBe('success');
    expect(reduce('mars-aerobrake', states, 1).status).toBe('failed');
    expect(reduce('mars-aerobrake', [states[0], { ...states[1], bound: false }]).status).toBe('flying');
    expect(reduce('mars-aerobrake', [states[0], { ...states[1], periapsis: -1 }]).status).toBe('flying');
  });
  it('requires a completed station docking', () => {
    expect(reduce('rendezvous', [{ dockedStation: false }]).status).toBe('flying');
    expect(reduce('rendezvous', [{ dockedStation: true }]).status).toBe('success');
  });
  it('rejects hovering and accepts a falling soft touchdown', () => {
    expect(reduce('suicide-burn', [{}, { landed: true }]).status).toBe('success');
    expect(reduce('suicide-burn', [{ verticalSpeed: 0 }, { verticalSpeed: 0 }, { verticalSpeed: 0 }]).status).toBe('failed');
  });
  it('requires Earth atmospheric entry, full chute and safe lunar-return landing', () => {
    const states = [{ body: 'earth', atmosphereTop: 5000, fullChute: true }, { body: 'earth', landed: true }];
    expect(reduce('moon-return', states).status).toBe('success');
    expect(reduce('moon-return', states.map(s => ({ ...s, body: 'moon' }))).status).toBe('failed');
  });
  it('requires Jupiter flyby and exit before Saturn arrival, including a rails skip', () => {
    expect(reduce('jupiter-assist', [{ body: 'saturn' }]).status).toBe('flying');
    expect(reduce('jupiter-assist', [{ body: 'jupiter' }, { body: 'sun' }, { body: 'saturn' }]).status).toBe('success');
  });
  it.each(SCENARIOS)('$id never awards success after vessel loss', s => {
    const state = evaluateMission(s.id, initialMission(0), observation({ alive: false, dockedStation: true, landed: true }), 1);
    expect(state.status).toBe('failed'); expect(scoreMission(s, state).score).toBe(0);
  });
});
describe('deterministic scores and browser records', () => {
  const completed = (patch: Partial<MissionState> = {}): MissionState => ({ ...initialMission(0), status: 'success', elapsed: 10, dv: 0, landingSpeed: 1, precision: 0, ...patch });
  it.each(SCENARIOS)('$id has stable medal boundaries and deterministic scores', s => {
    const state = completed(); expect(scoreMission(s, state)).toEqual(scoreMission(s, { ...state })); expect(scoreMission(s, state).medal).toBe('gold');
    const silver = completed({ dv: s.gold.dv + 0.001, elapsed: 10 });
    expect(scoreMission(s, silver).medal).toBe(s.silver.dv > s.gold.dv ? 'silver' : 'bronze');
    expect(scoreMission(s, completed({ dv: s.silver.dv + 1 })).medal).toBe('bronze');
    expect(scoreMission(s, completed({ status: 'failed' })).medal).toBe('none');
  });
  it('rewards the plume science bonus and penalizes fuel/time/precision', () => {
    const s = scenario('plume-dive'); expect(scoreMission(s, completed({ scienceBonus: true })).score - scoreMission(s, completed()).score).toBe(5000);
    expect(scoreMission(scenario('moon-landing'), completed({ dv: 10, elapsed: 100, precision: 50 })).score).toBeLessThan(scoreMission(scenario('moon-landing'), completed()).score);
  });
  it('keeps only improved bests, validates corruption and tolerates unavailable storage', () => {
    const data = new Map<string, string>(); const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const best = scoreMission(scenario('ring-skimmer'), completed());
    expect(saveBest('ring-skimmer', best, storage)).toBe(true); expect(saveBest('ring-skimmer', best, storage)).toBe(false);
    expect(readBests(storage)['ring-skimmer']).toEqual(best);
    expect(saveBest('ring-skimmer', { ...best, score: best.score + 1 }, storage)).toBe(true);
    data.set(RECORD_KEY, '{oops'); expect(readBests(storage)).toEqual({});
    data.set(RECORD_KEY, JSON.stringify({ 'ring-skimmer': { ...best, dv: 'bad' } })); expect(readBests(storage)).toEqual({});
    expect(saveBest('ring-skimmer', best, { getItem: () => null, setItem: () => { throw new Error('blocked'); } })).toBe(false);
  });
});
describe('isolated flight runtime and physics scoring', () => {
  it('starts, retries and exits without replacing the saved program or craft', () => {
    const before = game.get();
    try {
      startScenario('grand-tour'); expect(getScenarioRun()!.state.visited).toContain('titan');
      startScenario('ring-skimmer'); const first = getScenarioRun()!;
      expect(game.get().scenarioActive).toBe(true); expect(game.get().trainingActive).toBe(false);
      startScenario('ring-skimmer'); expect(getScenarioRun()!.epoch).toBeGreaterThan(first.epoch);
      expect(getScenarioRun()!.state.dv).toBe(0); expect(getScenarioRun()!.setup.world.ut).toBe(first.setup.world.ut);
      const run = getScenarioRun()!; const detach = attachScenarioWorld(run.setup.world, () => {});
      run.setup.world.tick(0.02, neutralInput()); expect(getScenarioRun()!.state.elapsed).toBeGreaterThan(0);
      detach(); expect(run.setup.world.onSimulationStep).toBeNull();
      endScenario(); expect(game.get()).toEqual({ ...before, scene: 'scenarios' }); expect(getScenarioRun()).toBeNull();
    } finally { endScenario(); game.set(before); }
  });
  it('charges actual engine and RCS impulse, with zero cost for coast', () => {
    const { world: w } = setupScenario(scenario('rendezvous')); let cost = 0;
    w.onSimulationStep = (_dt, dv) => { cost += dv; };
    w.tick(0.02, neutralInput()); expect(cost).toBe(0);
    w.tick(0.02, neutralInput({ rcs: true, translateY: 1 })); expect(cost).toBeGreaterThan(0);
    const rcsCost = cost;
    w.stageActive(); w.tick(0.1, neutralInput({ throttle: 1 })); expect(cost).toBeGreaterThan(rcsCost);
  });
  it('has a safe inbound Jupiter hyperbola and reaches Saturn on unpowered rails', () => {
    const setup = setupScenario(scenario('jupiter-assist')), w = setup.world, v = w.active!;
    expect(w.verticalSpeed(v)).toBeLessThan(0); const o = w.orbitSummary(v);
    expect(o.orbit.e).toBeGreaterThan(1); expect(o.pe).toBeGreaterThan(w.universe.body('jupiter').radius);
    expect(w.trajectory().some(p => p.nextBody === 'saturn')).toBe(true);
    const count = v.state.parts.length;
    let state = initialMission(w.ut); state.previous = observeWorld(setup, count);
    w.onSimulationStep = (dt, dv) => { state = evaluateMission('jupiter-assist', state, observeWorld(setup, count), dt, dv); };
    for (let i = 0; i < 12 && state.status === 'flying'; i++) w.advanceRailsTo(w.ut + 3e7);
    expect(state.status).toBe('success'); expect(state.dv).toBe(0);

  });
});

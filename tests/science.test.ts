import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG, PART_DEFS } from '../src/data/parts';
import { TECH_NODES, partUnlocked, launchCost } from '../src/data/technology';
import { biomeAt, BIOMES, situationAt } from '../src/sim/science/biomes';
import { EXPERIMENTS, bodyMultiplier, scienceValue, subjectKey } from '../src/sim/science/experiments';
import { generateContracts, newProgression } from '../src/sim/science/progression';
import { latLonToUnit, LAUNCH_SITE } from '../src/sim/terrain';
import { DEFAULT_START_UT, game } from '../src/game/store';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { EditorSession } from '../src/editor/session';
import { neutralInput, cloneVessel, splitVessel } from '../src/sim/vessel';
import type { CraftDef } from '../src/sim/vessel/types';
import { qIdentity } from '../src/util/quat';
import { add, scale, v3 } from '../src/util/vec3';

const craft = (antenna = true): CraftDef => ({ name: 'Field laboratory', type: 'VAB', version: 1, parts: [
  { uid: 1, partId: 'pod-lantern-1', position: v3(), rotation: qIdentity() },
  { uid: 2, partId: 'sensor-thermal', position: v3(0, 0, 0.7), rotation: qIdentity(), parent: 1, attachNode: 'srf' },
  ...(antenna ? [{ uid: 3, partId: 'antenna-thread', position: v3(0, 0, -0.7), rotation: qIdentity(), parent: 1, attachNode: 'srf' }] : []),
] });
const world = (mode: 'science' | 'career' | 'sandbox' = 'career') => new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT, mode);

describe('biomes and situations', () => {
  it('covers every authored biome with deterministic terrain samples', () => {
    const a = new Universe('standard'), b = new Universe('standard');
    for (const id of ['earth', 'moon', 'mars', 'titan']) {
      const found = new Set<string>();
      for (let lat = -89; lat <= 89; lat += 3) for (let lon = -180; lon < 180; lon += 3) {
        const dir = latLonToUnit(lat, lon);
        const biome = biomeAt(a.body(id), a.terrain(id), dir);
        expect(biomeAt(b.body(id), b.terrain(id), dir)).toBe(biome);
        found.add(biome);
      }
      if (id === 'earth') found.add(biomeAt(a.body(id), a.terrain(id), latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon)));
      expect([...found].sort(), `${id} biome coverage`).toEqual([...BIOMES[id]].sort());
    }
  });
  it('classifies all bodies and scales atmospheric/space thresholds with the universe', () => {
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(preset);
      for (const b of u.bodies.values()) expect(biomeAt(b, u.terrain(b.id), latLonToUnit(30, 50))).toBeTruthy();
      const b = u.body('earth'), h = b.atmosphere!.height;
      expect(situationAt(b, 0, 'landed')).toBe('landed');
      expect(situationAt(b, 0, 'splashed')).toBe('splashed');
      expect(situationAt(b, h * 0.1, 'flying')).toBe('flyingLow');
      expect(situationAt(b, h * 0.9, 'flying')).toBe('flyingHigh');
      expect(situationAt(b, h + 1, 'flying')).toBe('spaceLow');
      expect(situationAt(b, b.radius * 2, 'flying')).toBe('spaceHigh');
      expect(situationAt(u.body('moon'), 10, 'flying')).toBe('spaceLow');
    }
  });
});

describe('science lifecycle', () => {
  it('uses body multipliers, finite diminishing returns and experiment-specific subjects', () => {
    expect(scienceValue(8, 3, 0)).toBe(24);
    expect(scienceValue(8, 3, 1)).toBe(12);
    expect(scienceValue(8, 3, 2)).toBe(6);
    expect(bodyMultiplier({ id: 'titan', parent: 'saturn' })).toBe(9);
    const e = EXPERIMENTS.find(e => e.id === 'temperature')!;
    const c = { body: 'earth', biome: 'Shores', situation: 'spaceLow' as const };
    expect(subjectKey(e, c)).toBe(subjectKey(e, { ...c, biome: 'Grasslands' }));
    expect(subjectKey(e, { ...c, situation: 'landed' })).not.toBe(subjectKey(e, { ...c, situation: 'landed', biome: 'Grasslands' }));
  });
  it('stores data, prevents duplicate runs/transmit credit, recovers the remaining value and diminishes later runs', () => {
    const w = world('science'); w.commsSettings.enabled = false; w.launch(craft());
    expect(w.scienceContext()?.biome).toBe('Launch Complex');
    const d = w.runExperiment(2, 'temperature')!;
    expect(d.value).toBe(8);
    expect(w.progression.science).toBe(0);
    expect(w.runExperiment(2, 'temperature')).toBeNull();
    expect(w.runExperiment(2, 'seismic')).toBeNull();
    expect(w.transmitScience()).toBeCloseTo(3.2);
    expect(w.transmitScience()).toBe(0);
    const clone = cloneVessel(w.active!.state);
    clone.parts[1].scienceData![0].credited = 0;
    expect(d.credited).toBeCloseTo(3.2);
    expect(w.recoverActive()).toBe(true);
    expect(w.progression.science).toBeCloseTo(8);
    w.launch(craft());
    expect(w.runExperiment(2, 'temperature')?.value).toBe(4);
  });
  it('keeps data on detached instruments and transfers EVA samples into the boarded pod', () => {
    const w = world('science'); const ship = w.launch(craft());
    const data = w.runExperiment(2, 'temperature')!;
    const [detached] = splitVessel(ship.state, [2]);
    expect(ship.state.parts.flatMap(p => p.scienceData ?? [])).toHaveLength(0);
    expect(detached.parts[0].scienceData?.[0].id).toBe(data.id);
    const eva = w.goEva()!;
    eva.state.situation = 'landed';
    const sample = w.runExperiment(eva.state.parts[0].uid, 'surfaceSample')!;
    expect(sample.value).toBe(30);
    eva.state.parts[0].visitedBodies = ['moon'];
    expect(w.boardEva()).toBe(true);
    expect(ship.state.parts[0].scienceData?.[0]).toEqual(sample);
    expect(ship.state.parts[0].visitedBodies).toContain('moon');
    expect(w.recoverVessel(ship.state.id)).toBe(true);
    expect(w.progression.science).toBe(30);
  });
  it('requires an antenna, valid situation, and an occupied command pod', () => {
    const w = world(); w.launch(craft(false));
    expect(w.runExperiment(1, 'crewReport')).not.toBeNull();
    expect(w.transmitScience()).toBe(0);
    w.active!.state.parts[0].crew = [];
    expect(w.scienceInstruments().some(i => i.experiment === 'crewReport')).toBe(false);
    expect(w.runExperiment(1, 'surfaceSample')).toBeNull();
  });
});

describe('technology and funding gates', () => {
  it('assigns every part exactly once to 25 nonempty nodes with valid prerequisites', () => {
    expect(TECH_NODES).toHaveLength(25);
    const ids = TECH_NODES.flatMap(n => n.parts);
    expect(ids.length).toBe(PART_DEFS.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of TECH_NODES) { expect(n.parts.length, n.name).toBeGreaterThan(0); for (const id of n.requires) expect(TECH_NODES.some(t => t.id === id)).toBe(true); }
  });
  it('requires science/prerequisites and gates both editor picking and loaded craft launches', () => {
    const w = world('science');
    const node = TECH_NODES.find(n => n.id === 'discovery-0')!, locked = node.parts[0];
    expect(partUnlocked(locked, w.mode, w.progression)).toBe(false);
    expect(w.unlockTech(node.id)).toBe(false);
    w.progression.science = 100;
    expect(w.unlockTech('discovery-2')).toBe(false);
    const old = game.get();
    const session = new EditorSession();
    try {
      game.set({ mode: w.mode, resumeWorld: serializeWorld(w) });
      session.pickNew(locked); expect(session.getHeld()).toBeNull();
      expect(w.unlockTech(node.id)).toBe(true);
      expect(w.progression.science).toBe(90);
      expect(w.unlockTech(node.id)).toBe(false);
      game.set({ resumeWorld: serializeWorld(w) });
      session.pickNew(locked); expect(session.getHeld()).not.toBeNull();
      const lockedCraft = craft(); lockedCraft.parts[1].partId = TECH_NODES.find(n => n.id === 'discovery-3')!.parts[0];
      expect(() => w.launch(lockedCraft)).toThrow('Research required');
    } finally { session.dispose(); game.set(old); }
  });
  it('charges exactly once, refuses insufficient funds, refunds by distance and keeps sandbox free', () => {
    const w = world(); const cost = launchCost(craft(), PART_CATALOG);
    w.launch(craft()); expect(w.progression.funds).toBe(60000 - cost);
    w.recoverActive(); expect(w.progression.funds).toBeGreaterThanOrEqual(59999);
    w.progression.funds = 0; expect(() => w.launch(craft())).toThrow('Insufficient funds'); expect(w.vessels.size).toBe(0);
    const distant = world(); const v = distant.launch(craft());
    const earth = distant.universe.body('earth');
    v.state.situation = 'landed'; v.mode = 'physics';
    v.state.position = add(distant.universe.ephem.getBodyState('earth', distant.ut).position, distant.universe.ephem.fromBodyFixed('earth', scale(latLonToUnit(-LAUNCH_SITE.lat, LAUNCH_SITE.lon + 180), earth.radius), distant.ut));
    distant.recoverActive(); expect(distant.progression.funds).toBeCloseTo(60000 - cost + Math.floor(cost * 0.2), -1);
    const sandbox = world('sandbox'); sandbox.launch(buildOrbiter()); expect(sandbox.progression.funds).toBe(60000);
  });
});

describe('contracts, events and persistence', () => {
  it('generates reproducible offers, pays advances once and applies abandonment penalties', () => {
    expect(generateContracts(123, 3)).toEqual(generateContracts(123, 3));
    expect(generateContracts(123, 3)).not.toEqual(generateContracts(456, 3));
    const w = world(); const c = w.progression.contracts[0];
    expect(w.acceptContract(c.id)).toBe(true); expect(w.acceptContract(c.id)).toBe(false);
    expect(w.progression.funds).toBe(60000 + c.advance);
    expect(w.abandonContract(c.id)).toBe(true); expect(w.abandonContract(c.id)).toBe(false);
    expect(w.progression.funds).toBe(60000 + c.advance - c.penalty);
  });
  it('detects orbit through physics ticks, awards a contract and milestone only once', () => {
    const w = world(); const c = w.progression.contracts.find(c => c.kind === 'orbit')!;
    w.acceptContract(c.id); const v = w.launch(craft());
    placeInCircularOrbit(w, v, 'earth', 85000);
    w.tick(0.02, neutralInput());
    expect(c.status).toBe('completed'); expect(w.progression.milestones).toContain('first-orbit');
    const funds = w.progression.funds; w.tick(0.02, neutralInput()); expect(w.progression.funds).toBe(funds);
  });
  it('evaluates surveys and requires returned expedition hardware, not an unrelated Earth vessel', () => {
    const w = world(); const survey = w.progression.contracts.find(c => c.kind === 'science')!;
    w.acceptContract(survey.id); w.launch(craft()); w.runExperiment(2, 'temperature'); expect(survey.status).toBe('completed');
    const c = w.progression.contracts.find(c => c.kind === 'return')!; w.acceptContract(c.id);
    w.emitProgress({ type: 'landed', body: c.body, vesselId: 'expedition' }); expect(c.landed).toBe(true);
    w.recoverActive(); expect(c.status).toBe('active');
    const v = w.launch(craft()); v.state.parts[0].visitedBodies = [c.body];
    w.recoverActive(); expect(c.status).toBe('completed');
  });
  it('handles rails milestones and contract deadlines without an active vessel', () => {
    const w = world(); const v = w.launch(craft());
    placeInCircularOrbit(w, v, 'saturn', 2e6); w.advanceRailsTo(w.ut + 1);
    expect(w.progression.milestones).toContain('first-saturn');
    const c = w.progression.contracts[0]; w.acceptContract(c.id); c.deadline = w.ut + 1;
    w.vessels.clear(); w.activeId = null; w.advanceRailsTo(w.ut + 2); expect(c.status).toBe('failed');
  });
  it('round-trips finances, tech, archive, pending data, contracts and milestones; migrates old saves to sandbox', () => {
    const w = world(); w.commsSettings.enabled = false; w.launch(craft()); w.runExperiment(2, 'temperature'); w.transmitScience();
    w.acceptContract(w.progression.contracts[0].id); w.progression.science += 20; w.unlockTech('energy-0');
    w.progression.milestones.push('first-moon');
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    const restored = deserializeWorld(save, PART_CATALOG);
    expect(restored.mode).toBe('career'); expect(restored.progression).toEqual(w.progression);
    expect(restored.active!.state.parts[1].scienceData).toEqual(w.active!.state.parts[1].scienceData);
    const before = restored.progression.science; restored.recoverActive(); expect(restored.progression.science - before).toBeCloseTo(4.8);
    expect(w.active).not.toBeNull();
    delete save.mode; delete save.progression;
    const legacy = deserializeWorld(save, PART_CATALOG); expect(legacy.mode).toBe('sandbox'); expect(legacy.progression).toEqual(newProgression());
  });
});

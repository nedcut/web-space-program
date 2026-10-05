import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG, PART_DEFS } from '../src/data/parts';
import { TECH_NODES } from '../src/data/technology';
import { STOCK_CRAFTS, buildTender, buildOrbiter } from '../src/editor/stockCrafts';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { game, applyCommsSettings, DEFAULT_START_UT } from '../src/game/store';
import { cloneVessel, freePorts, mergeVessels, undock, neutralInput, buildVessel } from '../src/sim/vessel';
import { stackCraft } from '../src/sim/vessel/testing';
import { vesselDeltas, applyDeltas, replaceWorld } from '../src/net/snapshots';
import { advanceISRU } from '../src/sim/vessel/isru';
import { placeInCircularOrbit } from '../src/game/scenarios';

const universe = new Universe('standard');
const makeWorld = () => new World(universe, PART_CATALOG, DEFAULT_START_UT);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const original = game.get();
afterEach(() => game.set(original));

function expedition() {
  const modules = ['bay', 'fuelCell', 'generator', 'drill', 'converter', 'antenna', 'science'] as const;
  const ids = modules.map(type => PART_DEFS.find(p => p.modules.some(m => m.type === type))!.id);
  const craft = stackCraft([PART_DEFS.find(p => p.modules.some(m => m.type === 'dockingPort' && m.size === 1))!.id, 'pod-lantern-1', ...ids, 'regolith-silo', 'tank-1-short'], PART_CATALOG);
  return craft;
}

describe('cross-feature save and vessel integration', () => {
  it('roundtrips all world extensions together, owns its nodes, and allocates fresh node IDs', () => {
    const world = makeWorld();
    world.launch(expedition());
    world.commsSettings = { enabled: true, restrictControl: false };
    world.surveyedBodies = ['moon', 'titan'];
    world.discoveries = ['titan-sounding-stones'];
    world.logFlightEvent(world.active!, 'checkpoint', 'Combined save QA');
    world.latestReportId = world.flightlog.records[0].id;
    world.active!.state.parts[1].structuralFatigue = 0.04;
    world.transmitting = [world.activeId!];
    world.progression.science = 57;
    world.flags.push({ id: 'qa-flag', body: 'moon', position: { x: 180000, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, astronautId: world.crew[0].id, plantedAt: world.ut });
    world.setTarget('moon');
    const instrument = world.scienceInstruments().find(i => i.available)!;
    const data = world.runExperiment(instrument.uid, instrument.experiment)!;
    expect(data).not.toBeNull(); data.credited = data.value * 0.2;
    world.active!.state.parts[0].visitedBodies = ['moon'];
    const node = world.addNode(world.ut + 100);
    node.prograde = 42;
    const parts = world.active!.state.parts;
    parts.find(p => p.bayOpen !== undefined)!.bayOpen = true;
    Object.assign(parts.find(p => p.def.modules.some(m => m.type === 'drill'))!, { drillDeployed: true, drillDeploy: 0.6, processTemperature: 345 });
    Object.assign(parts.find(p => p.def.modules.some(m => m.type === 'converter'))!, { converterRunning: true, converterRecipe: 'monopropellant', processTemperature: 390 });
    const saved = json(serializeWorld(world));
    const restored = deserializeWorld(saved, PART_CATALOG, universe);
    expect(json(serializeWorld(restored))).toEqual(saved);
    expect(restored.active!.state.cache.boundingRadius).toBeCloseTo(world.active!.state.cache.boundingRadius, 12);
    restored.nodes[0].prograde = 99;
    expect(saved.nodes[0].prograde).toBe(42);
    expect(restored.addNode(world.ut + 200).id).toBeGreaterThan(node.id);
    expect(new Set(restored.nodes.map(n => n.id)).size).toBe(restored.nodes.length);
  });

  it('migrates pre-extension saves with crew, comms and resource defaults', () => {
    const world = makeWorld(); world.launch(buildOrbiter());
    const saved = serializeWorld(world);
    for (const key of ['mode', 'progression', 'crew', 'crewSeed', 'flags', 'commsSettings', 'transmitting', 'surveyedBodies', 'targetId', 'targetPortUid', 'discoveries', 'flightlog', 'latestReportId'] as const) delete saved[key];
    for (const v of saved.vessels) for (const p of v.state.parts) delete p.crew;
    const restored = deserializeWorld(json(saved), PART_CATALOG, universe);
    expect(restored.canControl()).toBe(true);
    expect(restored.crew.length).toBeGreaterThan(0);
    expect(restored.commsSettings.enabled).toBe(false);
    expect(restored.surveyedBodies).toEqual([]);
    expect(restored.flags).toEqual([]);
    expect(restored.discoveries).toEqual([]);
    expect(restored.flightlog.records).toEqual([]);
    expect(restored.latestReportId).toBeNull();
    restored.recordFlight(restored.active!, restored.ut, true);
    expect(restored.flightlog.records).toHaveLength(1);
    expect(restored.active!.state.cache.boundingRadius).toBeGreaterThan(0);
  });

  it('preserves expansion modules, machinery, crew and mass across clone, docking and undocking', () => {
    const world = makeWorld(); const a = world.launch(buildTender()).state;
    const b = buildVessel(expedition(), PART_CATALOG, { id: 'expedition' });
    world.assignCrew(b);
    const drill = b.parts.find(p => p.def.modules.some(m => m.type === 'drill'))!;
    Object.assign(drill, { drillDeployed: true, drillDeploy: 0.8, processTemperature: 350 });
    b.parts.find(p => p.bayOpen !== undefined)!.bayOpen = true;
    const mass = a.mass + b.mass;
    mergeVessels(a, b, freePorts(a)[0].part.uid, freePorts(b)[0].part.uid);
    expect(a.mass).toBeCloseTo(mass, 8);
    const port = a.parts.find(p => p.docked)!;
    const copy = cloneVessel(a);
    expect(copy.cache.boundingRadius).toBe(a.cache.boundingRadius);
    copy.parts.find(p => p.docked)!.docked!.vesselName = 'changed only in clone';
    expect(port.docked!.vesselName).not.toBe('changed only in clone');
    const separated = undock(a, port.uid)!;
    expect(a.mass + separated.mass).toBeCloseTo(mass, 8);
    expect(separated.parts.find(p => p.partId === drill.partId)).toMatchObject({ drillDeployed: true, drillDeploy: 0.8, processTemperature: 350 });
    expect(separated.parts.some(p => p.bayOpen)).toBe(true);
    expect(separated.parts.flatMap(p => p.crew ?? []).length).toBeGreaterThan(0);
  });

  it('operates cargo doors and gear while still clamped to the launch pad', () => {
    const world = makeWorld(); const vessel = world.launch(expedition());
    const bay = vessel.state.parts.find(p => p.bayOpen !== undefined)!;
    world.tick(0.02, neutralInput({ gear: true }));
    expect(vessel.mode).toBe('prelaunch'); expect(bay.bayOpen).toBe(true);
    world.tick(0.02, neutralInput({ gear: false }));
    expect(bay.bayOpen).toBe(false);
  });

  it('launches every stock craft and keeps every catalogue part in exactly one technology node', () => {
    expect(new Set(PART_DEFS.map(p => p.id)).size).toBe(PART_DEFS.length);
    for (const part of PART_DEFS) expect(TECH_NODES.filter(n => n.parts.includes(part.id))).toHaveLength(1);
    for (const stock of STOCK_CRAFTS) {
      const world = makeWorld();
      const vessel = world.launch(stock.build());
      expect(world.canControl(vessel.state), stock.name).toBe(true);
      expect(vessel.state.mass, stock.name).toBeGreaterThan(0);
      expect(vessel.state.cache.boundingRadius, stock.name).toBeGreaterThan(0);
    }
  });
});

describe('communications and multiplayer integration', () => {
  it('does not apply local difficulty overrides to server replicas or tutorial practice', () => {
    game.set({ settings: { ...original.settings, commsEnabled: true, commsRestrictControl: true } });
    for (const patch of [{ multiplayer: { url: 'ws://localhost', room: '', name: 'Pilot' }, trainingActive: false }, { multiplayer: null, trainingActive: true }]) {
      game.set(patch);
      const world = makeWorld(); applyCommsSettings(world);
      expect(world.commsSettings.enabled).toBe(false);
    }
    game.set({ multiplayer: null, trainingActive: false });
    const world = makeWorld(); applyCommsSettings(world);
    expect(world.commsSettings.enabled).toBe(true);
  });

  it('blocks launch-clamp release for disconnected probes during authoritative multiplayer stepping', () => {
    const world = makeWorld();
    const v = world.launch(stackCraft(['probe-pebble', 'tank-1-short', 'eng-sirocco'], PART_CATALOG));
    world.commsSettings.enabled = true;
    expect(world.canControl()).toBe(false);
    world.tickMultiplayer(new Map([[v.state.id, neutralInput({ stage: true, throttle: 1 })]]));
    expect(v.mode).toBe('prelaunch');
    expect(v.state.parts.find(p => p.engine)!.engine!.ignited).toBe(false);
  });

  it('replicates cargo doors, docking rearm, machinery and landed-rails resource production', () => {
    const world = makeWorld(); const vessel = world.launch(expedition());
    const replica = deserializeWorld(serializeWorld(world), PART_CATALOG, universe);
    for (const mode of ['physics', 'landedRails'] as const) {
      vessel.mode = mode;
      vessel.state.situation = 'landed';
      vessel.state.parts.find(p => p.bayOpen !== undefined)!.bayOpen = true;
      vessel.state.parts.find(p => p.def.modules.some(m => m.type === 'dockingPort'))!.dockDisarmed = true;
      Object.assign(vessel.state.parts.find(p => p.def.modules.some(m => m.type === 'drill'))!, { drillDeployed: true, drillDeploy: 1 });
      vessel.state.parts.find(p => p.partId === 'regolith-silo')!.resources.regolith = 0;
      advanceISRU(vessel.state, 0.7, 4);
      applyDeltas(replica, world.ut, vesselDeltas(world));
      expect(replica.active!.state.parts).toEqual(vessel.state.parts);
      expect(replica.active!.state.cache.boundingRadius).toBe(vessel.state.cache.boundingRadius);
      expect(replica.active!.mode).toBe(mode);
    }
  });

  it('replaces saved world extensions without retaining stale comms or navigation caches', () => {
    const world = makeWorld(); const v = world.launch(buildTender());
    placeInCircularOrbit(world, v, 'earth', 90000);
    const replica = deserializeWorld(serializeWorld(world), PART_CATALOG, universe);
    const oldNetwork = replica.comms;
    replica.setTarget('moon');
    world.surveyedBodies = ['moon'];
    world.commsSettings.enabled = true;
    world.transmitting = [v.state.id];
    world.discoveries = ['qa-landmark'];
    world.logFlightEvent(v, 'partLoss', 'Structural failure');
    world.latestReportId = world.flightlog.records[0].id;
    const saved = serializeWorld(world);
    replaceWorld(replica, saved);
    expect(replica.flightlog).toEqual(world.flightlog);
    expect(replica.latestReportId).toBe(world.latestReportId);
    expect(replica.discoveries).toEqual(world.discoveries);
    replica.flightlog.records[0].events.length = 0;
    expect(saved.flightlog!.records[0].events.length).toBeGreaterThan(0);
    replaceWorld(replica, serializeWorld(world));
    expect(replica.surveyedBodies).toEqual(['moon']);
    expect(replica.transmitting).toEqual([v.state.id]);
    expect(replica.commsSettings).toEqual(world.commsSettings);
    expect(replica.comms).not.toBe(oldNetwork);
    expect(replica.targetId).toBe('moon');
    const target = world.spawnVessel(buildTender(), { position: v.state.position, velocity: v.state.velocity, orientation: v.state.orientation });
    replaceWorld(replica, serializeWorld(world));
    replica.setTarget(target.state.id);
    world.vessels.delete(target.state.id);
    replaceWorld(replica, serializeWorld(world));
    expect(replica.targetId).toBeNull();
  });
});

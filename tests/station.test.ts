import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildTender } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { spawnTestOutpost } from '../src/flight/stationFixture';
import { crewIds } from '../src/sim/crew/crew';
import { controlFrom, controlPartUid, dockedPorts, freePorts, neutralInput, portInfo, stationModules, transferCrew, validCommands } from '../src/sim/vessel';
import type { VesselState } from '../src/sim/vessel/runtime';
import { qRotate } from '../src/util/quat';
import { add, dot, length, sub } from '../src/util/vec3';

function setup() {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const wv = w.launch(buildTender());
  placeInCircularOrbit(w, wv, 'earth', 150_000);
  const outpost = spawnTestOutpost(w, 60)!;
  return { w, wv, outpost };
}

/** Inertial position of every part, keyed by uid. */
const partPoses = (v: VesselState) => new Map(v.parts.map(p => [p.uid, add(v.position, qRotate(v.orientation, sub(p.position, v.com)))]));

describe('docked outpost fixture and station modules', () => {
  it('builds three docked modules with crew, ports and resources', () => {
    const { w, outpost } = setup();
    expect(w.vessels.size).toBe(2);
    const mods = stationModules(outpost.state);
    expect(mods.map(m => m.name)).toEqual(['Bellweather Outpost', 'Lantern Ferry', 'Wren Tender']);
    expect(mods.reduce((n, m) => n + m.partUids.length, 0)).toBe(outpost.state.parts.length);
    const core = mods[0];
    expect(core.cabins.find(c => c.seats === 4)?.crew).toHaveLength(2);
    expect(mods[1].cabins[0].crew).toHaveLength(1);
    // Every module lists its collars: the joints show their partner, the ferry's far collar is free.
    const free = mods.flatMap(m => m.ports.filter(p => p.partner === null));
    expect(free).toHaveLength(1);
    expect(mods[1].ports.some(p => p.partner === null)).toBe(true);
    expect(dockedPorts(outpost.state)).toHaveLength(2);
    expect(core.resources.some(r => r.id === 'electricCharge' && r.max > 0)).toBe(true);
    expect(w.targetId).toBe(outpost.state.id);
    expect(w.targetPortUid).toBe(free[0].uid);
  });

  it('transfers crew to a free seat and refuses a full one', () => {
    const { outpost } = setup();
    const v = outpost.state;
    const [core, ferry] = stationModules(v);
    const pilot = ferry.cabins[0].crew[0];
    const cabin = core.cabins.find(c => c.seats === 4)!;
    const mass = v.mass;
    expect(transferCrew(v, pilot, cabin.uid)).toBe(true);
    expect(v.cache.byUid.get(cabin.uid)!.crew).toContain(pilot);
    expect(v.cache.byUid.get(ferry.cabins[0].uid)!.crew).toEqual([]);
    expect(v.mass).toBeCloseTo(mass, 6);
    // Fill the cabin, then a fourth... fifth move must fail.
    const back = v.cache.byUid.get(cabin.uid)!.crew![0];
    expect(transferCrew(v, back, ferry.cabins[0].uid)).toBe(true);
    expect(transferCrew(v, cabin.crew[0], ferry.cabins[0].uid)).toBe(false);
    expect(transferCrew(v, 'nobody', cabin.uid)).toBe(false);
  });

  it('control from here rebases the frame without moving anything', () => {
    const { outpost } = setup();
    const v = outpost.state;
    v.angularVelocity = { x: 0.01, y: -0.02, z: 0.005 };
    const before = partPoses(v);
    const omegaWorld = qRotate(v.orientation, v.angularVelocity);
    const pos = { ...v.position };
    const port = freePorts(v)[0];
    const portDir = port.dir;
    expect(controlFrom(v, port.part.uid)).toBe(true);
    expect(controlPartUid(v)).toBe(port.part.uid);
    for (const [uid, p] of partPoses(v)) expect(length(sub(p, before.get(uid)!))).toBeLessThan(1e-6);
    expect(length(sub(qRotate(v.orientation, v.angularVelocity), omegaWorld))).toBeLessThan(1e-12);
    expect(length(sub(v.position, pos))).toBeLessThan(1e-6);
    // The nose (+Y) now looks out of the chosen collar.
    expect(dot(qRotate(v.orientation, { x: 0, y: 1, z: 0 }), portDir)).toBeGreaterThan(1 - 1e-9);
    expect(length(sub(portInfo(v, port.part)!.dir, portDir))).toBeLessThan(1e-9);
    // Cabins without flight control are not control points.
    const cabin = v.parts.find(p => p.partId === 'cabin-wayfarer')!;
    expect(controlFrom(v, cabin.uid)).toBe(false);
  });

  it('applies control and crew commands through the World and survives save/load', () => {
    const { w, outpost } = setup();
    w.switchTo(outpost.state.id);
    const v = outpost.state;
    const [core, ferry] = stationModules(v);
    const pod = ferry.controls.find(c => c.kind === 'command')!;
    const pilot = ferry.cabins[0].crew[0];
    const cabin = core.cabins.find(c => c.seats === 4)!;
    const commands = [{ kind: 'control', uid: pod.uid }, { kind: 'crew', uid: cabin.uid, astronautId: pilot }] as const;
    expect(validCommands(commands)).toBe(true);
    expect(validCommands([{ kind: 'crew', uid: 1 }])).toBe(false);
    w.tick(0.02, neutralInput({ commands: [...commands] }));
    expect(controlPartUid(v)).toBe(pod.uid);
    expect(v.cache.byUid.get(cabin.uid)!.crew).toContain(pilot);
    expect(crewIds(v)).toHaveLength(3);
    const w2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), PART_CATALOG, w.universe);
    const v2 = w2.vessels.get(v.id)!.state;
    expect(controlPartUid(v2)).toBe(pod.uid);
    expect(v2.cache.byUid.get(cabin.uid)!.crew).toContain(pilot);
    expect(stationModules(v2).map(m => m.name)).toEqual(stationModules(v).map(m => m.name));
  });

  it('undocking a controlled-from module leaves the station without a stale control part', () => {
    const { w, outpost } = setup();
    w.switchTo(outpost.state.id);
    const v = outpost.state;
    const ferry = stationModules(v)[1];
    const pod = ferry.controls.find(c => c.kind === 'command')!;
    controlFrom(v, pod.uid);
    const joint = ferry.ports.find(p => p.partner !== null)!;
    expect(w.undockActive(joint.uid)).not.toBeNull();
    expect(controlPartUid(w.active!.state)).toBeNull();
    const freed = [...w.vessels.values()].find(x => x.state.name === 'Lantern Ferry')!;
    expect(controlPartUid(freed.state)).toBe(pod.uid);
  });
});

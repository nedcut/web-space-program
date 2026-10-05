import { describe, expect, it } from 'vitest';
import {
  activateNextStage, availableResource, buildVessel, computeStageDeltaV, G0, neutralInput, stepEngines, stepVessel,
  tweakDescriptors, validCommands, partActions, groupBindings,
} from '../src/sim/vessel';
import type { CraftDef, PartTweaks, VesselCommand, VesselState } from '../src/sim/vessel';
import { NOSE_UP, TEST_CATALOG, stackCraft, vacuumEnv } from '../src/sim/vessel/testing';
import { computeStageStats } from '../src/editor/ui/dv';
import { deserializeCraft, serializeCraft } from '../src/editor/core';
import { decodeCraft, encodeCraft, validateCraft } from '../src/game/craftSharing';
import { Room } from '../server/room';
import { decodeClient, encode, decodeServer, type ClientMessage } from '../src/net/protocol';
import { Replica } from '../src/net/client';
import { buildSoundingRocket, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { PART_CATALOG } from '../src/data/parts';

const engineUid = (v: VesselState) => v.parts.find(p => p.engine)!.uid;
const withTweaks = (craft: CraftDef, partId: string, tweaks: PartTweaks): CraftDef =>
  ({ ...craft, parts: craft.parts.map(p => p.partId === partId ? { ...p, tweaks } : p) });
const step = (v: VesselState, commands?: VesselCommand[], throttle = 1) =>
  stepVessel(v, neutralInput({ throttle, commands }), vacuumEnv(), 0, 1 / 50);

describe('tweakables affect the simulation', () => {
  const rocket = () => stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }]);

  it('a 50% thrust limiter halves thrust and the staging readout, keeping delta-v', () => {
    const full = buildVessel(rocket(), TEST_CATALOG, { orientation: NOSE_UP });
    const half = buildVessel(withTweaks(rocket(), 'engine', { thrustLimit: 0.5 }), TEST_CATALOG, { orientation: NOSE_UP });
    for (const v of [full, half]) { activateNextStage(v); for (const p of v.parts) if (p.engine) p.engine.throttle = 1; }
    const a = stepEngines(full, 1, { x: 0, y: 0, z: 0 }, 0, 1 / 50, []);
    const b = stepEngines(half, 1, { x: 0, y: 0, z: 0 }, 0, 1 / 50, []);
    expect(b.thrust / a.thrust).toBeCloseTo(0.5, 9);

    const dvFull = computeStageDeltaV(buildVessel(rocket(), TEST_CATALOG), 0, G0).find(s => s.dvVac > 0)!;
    const dvHalf = computeStageDeltaV(buildVessel(withTweaks(rocket(), 'engine', { thrustLimit: 0.5 }), TEST_CATALOG), 0, G0).find(s => s.dvVac > 0)!;
    expect(dvHalf.thrustVac / dvFull.thrustVac).toBeCloseTo(0.5, 9);
    expect(dvHalf.dvVac).toBeCloseTo(dvFull.dvVac, 6);
    expect(dvHalf.burnTime / dvFull.burnTime).toBeCloseTo(2, 6);

    // The editor readout uses the same model: TWR halves, delta-v stays.
    const statsFull = [...computeStageStats(rocket(), TEST_CATALOG).values()].find(s => s.dvVac > 0)!;
    const statsHalf = [...computeStageStats(withTweaks(rocket(), 'engine', { thrustLimit: 0.5 }), TEST_CATALOG).values()].find(s => s.dvVac > 0)!;
    expect(statsHalf.twrVac / statsFull.twrVac).toBeCloseTo(0.5, 9);
    expect(statsHalf.dvVac).toBeCloseTo(statsFull.dvVac, 6);
  });

  it('the limiter can be changed in flight through a command', () => {
    const v = buildVessel(rocket(), TEST_CATALOG, { orientation: NOSE_UP });
    activateNextStage(v);
    for (let i = 0; i < 50; i++) step(v);
    const before = v.telemetry.thrust;
    step(v, [{ kind: 'tweak', uid: engineUid(v), tweaks: { thrustLimit: 0.25 } }]);
    expect(v.telemetry.thrust / before).toBeCloseTo(0.25, 3);
    expect(v.cache.byUid.get(engineUid(v))!.tweaks?.thrustLimit).toBe(0.25);
  });

  it('emptying a tank (ballast) changes mass by the propellant mass', () => {
    const full = buildVessel(rocket(), TEST_CATALOG);
    const craft = rocket();
    craft.parts[1].resources = { liquidFuel: 0, oxidizer: 0 };
    const empty = buildVessel(craft, TEST_CATALOG);
    expect(full.mass - empty.mass).toBeCloseTo(710 * 0.81 + 1290 * 1.14, 6);
    expect(computeStageDeltaV(empty, 0, G0).some(s => s.dvVac > 0)).toBe(false);
  });

  it('decoupler crossfeed opens stack flow to the far side, in flight too', () => {
    const craft = stackCraft(['capsule', 'tank', { partId: 'decoupler', stage: 1 }, 'tank', { partId: 'engine', stage: 2 }]);
    const closed = buildVessel(craft, TEST_CATALOG);
    const open = buildVessel(withTweaks(craft, 'decoupler', { crossfeed: true }), TEST_CATALOG);
    expect(availableResource(open, engineUid(open), 'liquidFuel')).toBeCloseTo(2 * availableResource(closed, engineUid(closed), 'liquidFuel'), 9);
    // Outer (jettisoned first) tank drains first through the open decoupler.
    activateNextStage(open);
    for (let i = 0; i < 100; i++) step(open);
    expect(open.parts[3].resources.liquidFuel!).toBeLessThan(710);
    expect(open.parts[1].resources.liquidFuel).toBe(710);
    // Flight toggle closes it again.
    const decouplerUid = closed.parts.find(p => p.partId === 'decoupler')!.uid;
    step(closed, [{ kind: 'part', uid: decouplerUid, action: 'crossfeed.toggle' }], 0);
    expect(availableResource(closed, engineUid(closed), 'liquidFuel')).toBeCloseTo(1420, 9);
  });

  it('gimbal lock, deflection, chute and RCS settings are exposed only where they apply', () => {
    const keys = (id: string) => tweakDescriptors(TEST_CATALOG.get(id)!).map(d => d.key);
    expect(keys('engine')).toEqual(['thrustLimit', 'gimbalLimit', 'gimbalLock']);
    expect(keys('srb')).toEqual(['thrustLimit']);
    expect(keys('decoupler')).toEqual(['ejectionScale', 'crossfeed']);
    expect(keys('chute')).toEqual(['chuteMinPressure', 'chuteDeployAltitude']);
    expect(keys('tank')).toEqual([]);
  });

  it('decoupler ejection force scales the separation impulse', () => {
    const craft = stackCraft(['capsule', 'tank', { partId: 'decoupler', stage: 0 }, 'tank']);
    const speed = (scale?: number) => {
      const v = buildVessel(scale === undefined ? craft : withTweaks(craft, 'decoupler', { ejectionScale: scale }), TEST_CATALOG);
      const [debris] = activateNextStage(v).newVessels;
      return Math.hypot(debris.velocity.x - v.velocity.x, debris.velocity.y - v.velocity.y, debris.velocity.z - v.velocity.z);
    };
    expect(speed(0.5) / speed()).toBeCloseTo(0.5, 9);
    expect(speed(0)).toBeLessThan(1e-12);
  });
});

describe('part actions and action groups', () => {
  it('custom groups toggle bound actions with a shared on/off state', () => {
    const craft = stackCraft(['capsule', 'tank', 'engine']);
    craft.parts[2].actions = { custom1: ['engine.toggle'] };
    const v = buildVessel(craft, TEST_CATALOG, { orientation: NOSE_UP });
    expect(groupBindings(v, 'custom1')).toEqual([{ uid: 3, action: 'engine.toggle' }]);
    step(v, [{ kind: 'group', group: 'custom1' }]);
    expect(v.parts[2].engine!.ignited).toBe(true);
    expect(v.groupState?.custom1).toBe(true);
    step(v, [{ kind: 'group', group: 'custom1' }]);
    expect(v.parts[2].engine!.ignited).toBe(false);
    expect(v.groupState?.custom1).toBe(false);
  });

  it('abort fires its group once: decouple the capsule and arm its parachute', () => {
    const craft = stackCraft(['chute', 'capsule', { partId: 'decoupler', stage: 1 }, 'tank', { partId: 'engine', stage: 2 }]);
    craft.parts[2].actions = { abort: ['decouple'] };
    craft.parts[0].actions = { abort: ['chute.deploy'] };
    const v = buildVessel(craft, TEST_CATALOG, { orientation: NOSE_UP });
    const res = step(v, [{ kind: 'group', group: 'abort' }], 0);
    expect(res.newVessels).toHaveLength(1);
    expect(v.parts.find(p => p.partId === 'chute')!.chute!.phase).not.toBe('stowed');
    expect(res.events.some(e => e.type === 'decouple')).toBe(true);
  });

  it('the Stage group fires with each staging event', () => {
    const craft = stackCraft(['capsule', 'tank', { partId: 'engine', stage: 0 }, 'chute']);
    craft.parts[3].actions = { stage: ['chute.deploy'] };
    const v = buildVessel(craft, TEST_CATALOG);
    activateNextStage(v);
    expect(v.parts[3].chute!.phase).toBe('armed');
  });

  it('per-part actions: shutdown, cut parachute, toggle deploy', () => {
    const v = buildVessel(stackCraft(['chute', 'capsule', 'tank', { partId: 'engine', stage: 0 }]), TEST_CATALOG, { orientation: NOSE_UP });
    activateNextStage(v);
    step(v, [{ kind: 'part', uid: 4, action: 'engine.shutdown' }, { kind: 'part', uid: 1, action: 'chute.deploy' }]);
    expect(v.parts[3].engine!.ignited).toBe(false);
    expect(v.parts[0].chute!.phase).toBe('armed');
    step(v, [{ kind: 'part', uid: 1, action: 'chute.cut' }]);
    expect(v.parts[0].chute!.phase).toBe('cut');
    expect(partActions(TEST_CATALOG.get('leg')!)).toContain('deploy.toggle');
  });

  it('flight commands are validated structurally (editor-only settings and unknown actions are refused)', () => {
    expect(validCommands([{ kind: 'group', group: 'custom10' }, { kind: 'part', uid: 3, action: 'decouple' }, { kind: 'tweak', uid: 1, tweaks: { thrustLimit: 0.5 } }])).toBe(true);
    for (const bad of [
      [{ kind: 'group', group: 'custom11' }], [{ kind: 'part', uid: -1, action: 'decouple' }], [{ kind: 'part', uid: 1, action: 'explode' }],
      [{ kind: 'tweak', uid: 1, tweaks: { ejectionScale: 0.5 } }], [{ kind: 'tweak', uid: 1, tweaks: { thrustLimit: 2 } }],
      [{ kind: 'tweak', uid: 1, tweaks: { lightColor: 'red' } }], Array(33).fill({ kind: 'group', group: 'abort' }),
    ]) expect(validCommands(bad)).toBe(false);
  });
});

describe('stock abort wiring', () => {
  it('Kestrel aborts on the pad: engines stop, the capsule separates and its parachute arms', () => {
    const craft = STOCK_CRAFTS.find(s => s.id === 'stock-kestrel')!.build();
    expect(craft.parts.some(p => p.actions?.abort?.includes('decouple'))).toBe(true);
    const world = new World(new Universe('standard'), PART_CATALOG, 0);
    const wv = world.launch(craft);
    world.tick(0.05, neutralInput({ stage: true }));
    world.tick(0.05, neutralInput({ commands: [{ kind: 'group', group: 'abort' }] }));
    expect(world.vessels.size).toBe(2);
    const capsule = world.vessels.get(wv.state.id)!.state;
    expect(capsule.parts.find(p => p.chute)!.chute!.phase).not.toBe('stowed');
    const booster = [...world.vessels.values()].find(v => v !== wv)!.state;
    expect(booster.parts.filter(p => p.engine).every(p => !p.engine!.ignited)).toBe(true);
  });
});

describe('serialization', () => {
  const craft = (): CraftDef => {
    const c = buildSoundingRocket();
    const engine = c.parts.find(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'engine'))!;
    engine.tweaks = { thrustLimit: 0.6 };
    engine.actions = { custom2: ['engine.toggle'], abort: ['engine.shutdown'] };
    return c;
  };

  it('craft JSON and share codes round-trip settings and action groups', async () => {
    const c = craft();
    expect(deserializeCraft(serializeCraft(c), PART_CATALOG)).toEqual(c);
    for (const compress of [true, false]) {
      const decoded = await decodeCraft(await encodeCraft(c, compress));
      expect(validateCraft(decoded, PART_CATALOG).craft).toEqual(c);
    }
    const bad = craft();
    bad.parts[0].tweaks = { thrustLimit: 7 };
    expect(() => deserializeCraft(JSON.stringify(bad))).toThrow();
    expect(validateCraft(bad, PART_CATALOG).craft).toBeNull();
    bad.parts[0].tweaks = undefined;
    (bad.parts[0] as unknown as { actions: unknown }).actions = { custom1: ['launchConfetti'] };
    expect(validateCraft(bad, PART_CATALOG).craft).toBeNull();
  });

  it('world saves keep part settings and group state', () => {
    const room = new Room('SAVE01');
    const wv = room.world.launch(craft());
    wv.state.groupState = { custom2: true };
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(room.world))), PART_CATALOG);
    const v = back.vessels.get(wv.state.id)!.state;
    expect(v.parts.find(p => p.tweaks)?.tweaks).toEqual({ thrustLimit: 0.6 });
    expect(v.parts.find(p => p.actions)?.actions?.custom2).toEqual(['engine.toggle']);
    expect(v.groupState).toEqual({ custom2: true });
  });
});

describe('multiplayer command path', () => {
  it('rejects invalid commands at the protocol boundary and applies valid ones authoritatively', () => {
    const room = new Room('ACT001');
    const replica = new Replica();
    const id = room.join('Pilot', raw => replica.receive(decodeServer(raw)));
    const send = (m: ClientMessage) => room.receive(id, encode(m));
    const c = buildSoundingRocket();
    for (const p of c.parts) if (PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'engine')) p.actions = { custom1: ['engine.activate'] };
    const wv = room.world.launch(c, 'pad', true);
    send({ v: 1, type: 'claim', vesselId: wv.state.id });
    const engine = wv.state.parts.find(p => p.engine)!;
    const input = (commands: unknown) => encode({ v: 1, type: 'input', vesselId: wv.state.id, seq: 1, input: { ...neutralInput(), commands } as never });
    expect(() => decodeClient(input([{ kind: 'tweak', uid: engine.uid, tweaks: { ejectionScale: 0.1 } }]))).toThrow();
    expect(() => decodeClient(input([{ kind: 'part', uid: engine.uid, action: 'selfDestruct' }]))).toThrow();

    send({ v: 1, type: 'input', vesselId: wv.state.id, seq: 1, input: neutralInput({ commands: [{ kind: 'tweak', uid: engine.uid, tweaks: { thrustLimit: 0.4 } }] }) });
    send({ v: 1, type: 'input', vesselId: wv.state.id, seq: 2, input: neutralInput({ commands: [{ kind: 'group', group: 'custom1' }] }) });
    room.tick();
    expect(engine.tweaks?.thrustLimit).toBe(0.4);
    expect(engine.engine!.ignited).toBe(true);
    // One-shot: a following tick does not re-run the group (state stays on, nothing toggles back).
    room.tick();
    expect(room.world.vessels.get(wv.state.id)!.state.groupState?.custom1).toBe(true);
    // Replica receives the authoritative settings.
    for (let i = 0; i < 5; i++) room.tick();
    expect(replica.world.vessels.get(wv.state.id)!.state.parts.find(p => p.uid === engine.uid)!.tweaks?.thrustLimit).toBe(0.4);
  });

  it('a pilot cannot command a vessel it does not control', () => {
    const room = new Room('ACT002');
    const id = room.join('Pilot', () => {});
    const wv = room.world.launch(buildSoundingRocket(), 'pad', true);
    const engine = wv.state.parts.find(p => p.engine)!;
    room.receive(id, encode({ v: 1, type: 'input', vesselId: wv.state.id, seq: 1, input: neutralInput({ commands: [{ kind: 'part', uid: engine.uid, action: 'engine.activate' }] }) }));
    room.tick();
    expect(engine.engine!.ignited).toBe(false);
  });
});

describe('editor settings and bindings', () => {
  it('apply across symmetry, validate offered keys and coalesce slider undo steps', async () => {
    const { CraftEditor } = await import('../src/editor/core');
    const ed = new CraftEditor(TEST_CATALOG, stackCraft(['capsule', 'tank', 'engine']));
    ed.setSymmetry({ mode: 'radial', count: 3 });
    const leg = ed.surfaceAttach('leg', 2, { x: 0.625, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const legs = ed.craft.parts.filter(p => p.partId === 'leg');
    expect(legs).toHaveLength(3);
    ed.setPartTweaks(leg.uid, { extended: true });
    expect(ed.craft.parts.filter(p => p.tweaks?.extended).length).toBe(3);
    expect(() => ed.setPartTweaks(leg.uid, { thrustLimit: 0.5 })).toThrow();
    ed.setPartActions(leg.uid, 'gear', ['deploy.toggle', 'decouple']);
    expect(ed.craft.parts.filter(p => p.partId === 'leg').every(p => JSON.stringify(p.actions) === '{"gear":["deploy.toggle"]}')).toBe(true);
    const undoBefore = (ed as unknown as { past: unknown[] }).past.length;
    for (const f of [0.9, 0.7, 0.5]) ed.setPartResources(2, { liquidFuel: 710 * f });
    expect((ed as unknown as { past: unknown[] }).past.length).toBe(undoBefore + 1);
    expect(ed.craft.parts[1].resources).toEqual({ liquidFuel: 355 });
    ed.undo();
    expect(ed.craft.parts[1].resources).toBeUndefined();
    ed.clearGroup('gear');
    expect(ed.craft.parts.some(p => p.actions)).toBe(false);
  });
});

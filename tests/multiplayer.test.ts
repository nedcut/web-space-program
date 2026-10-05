import { describe, expect, it } from 'vitest';
import { Room } from '../server/room';
import { encode, decodeClient, decodeServer, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { Replica } from '../src/net/client';
import { vesselDeltas } from '../src/net/snapshots';
import { neutralInput, freePorts, dockedPorts } from '../src/sim/vessel';
import { buildTender, buildSoundingRocket, buildSwift } from '../src/editor/stockCrafts';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../src/game/scenarios';
import { add, sub, length, normalize, scale } from '../src/util/vec3';

function peer(room: Room, name: string) {
  const messages: ServerMessage[] = [];
  const replica = new Replica();
  const id = room.join(name, raw => { const m = decodeServer(raw); messages.push(m); replica.receive(m); });
  return { id, replica, messages, send: (m: ClientMessage) => room.receive(id, encode(m)) };
}
function orbitalRoom(distance = 10_000) {
  const room = new Room('ABC123');
  const a = room.world.launch(buildTender());
  placeInCircularOrbit(room.world, a, 'earth', 90_000);
  const b = spawnRendezvousTarget(room.world, buildTender(), distance)!;
  const alice = peer(room, 'Alice'), bob = peer(room, 'Bob');
  alice.send({ v: 1, type: 'claim', vesselId: a.state.id });
  bob.send({ v: 1, type: 'claim', vesselId: b.state.id });
  return { room, a, b, alice, bob };
}

describe('multiplayer JSON protocol v1', () => {
  it('roundtrips commands, full worlds and non-finite telemetry losslessly', () => {
    const commands: ClientMessage[] = [
      { v: 1, type: 'join', room: '', name: 'Pilot' }, { v: 1, type: 'leave' },
      { v: 1, type: 'input', vesselId: 'v1', seq: 7, input: neutralInput({ throttle: 0.5, stage: true }) },
      { v: 1, type: 'launch', craft: buildSwift(), site: 'runway' },
      { v: 1, type: 'claim', vesselId: 'v1' }, { v: 1, type: 'release' },
      { v: 1, type: 'warp', rate: 100 }, { v: 1, type: 'chat', text: 'Ready!' },
      { v: 1, type: 'action', action: 'undock', uid: 1 },
    ];
    for (const m of commands) expect(decodeClient(encode(m))).toEqual(m);
    const { alice } = orbitalRoom();
    const snapshot = alice.messages.find(m => m.type === 'snapshot')!;
    expect(decodeServer(encode(snapshot))).toEqual(snapshot);
    expect(() => decodeServer('{"v":1,"type":"delta"}')).toThrow();
  });
  it('rejects malformed, oversized, unsupported and invalid control/craft messages', () => {
    const invalid = ['bad json', JSON.stringify({ v: 2, type: 'leave' }), JSON.stringify({ v: 1, type: 'warp', rate: 999 }), ' '.repeat(512001),
      encode({ v: 1, type: 'input', vesselId: 'v1', seq: 1, input: neutralInput({ throttle: NaN }) }),
      encode({ v: 1, type: 'input', vesselId: 'v1', seq: 1, input: neutralInput({ pitch: 2 }) })];
    for (const raw of invalid) expect(() => decodeClient(raw)).toThrow();
    const craft = buildTender();
    craft.parts[0].parent = craft.parts[0].uid;
    expect(() => decodeClient(encode({ v: 1, type: 'launch', craft, site: 'pad' }))).toThrow();
  });
});

describe('authoritative room with two in-process clients', () => {
  it('ticks distant controlled vessels together, applies both inputs and sends consistent 10 Hz snapshots', () => {
    const { room, a, b, alice, bob } = orbitalRoom();
    const ut = room.world.ut;
    const massA = a.state.mass, massB = b.state.mass;
    for (let i = 0; i < 50; i++) {
      alice.send({ v: 1, type: 'input', vesselId: a.state.id, seq: i, input: neutralInput({ throttle: 1, stage: i === 0, sas: 'stabilityAssist' }) });
      bob.send({ v: 1, type: 'input', vesselId: b.state.id, seq: i, input: neutralInput({ throttle: 0.5, stage: i === 0, sas: 'stabilityAssist' }) });
      room.tick();
    }
    expect(room.world.ut - ut).toBeCloseTo(1, 4);
    expect(a.mode).toBe('physics'); expect(b.mode).toBe('physics');
    expect(a.state.mass).toBeLessThan(massA); expect(b.state.mass).toBeLessThan(massB);
    expect(a.state.telemetry.thrust).toBeGreaterThan(b.state.telemetry.thrust);
    const da = alice.messages.filter(m => m.type === 'delta').at(-1)!;
    expect(da).toEqual(bob.messages.filter(m => m.type === 'delta').at(-1));
    expect(alice.messages.filter(m => m.type === 'delta')).toHaveLength(10);
    for (const c of [alice, bob]) for (const v of [a, b]) {
      expect(c.replica.world.vessels.get(v.state.id)!.state.position).toEqual(v.state.position);
    }
  });
  it('enforces exclusive ownership, sequence ordering, one-shot staging and release on leave', () => {
    const { room, a, alice, bob } = orbitalRoom();
    bob.send({ v: 1, type: 'claim', vesselId: a.state.id });
    expect(bob.messages.at(-1)?.type).toBe('error');
    bob.send({ v: 1, type: 'input', vesselId: a.state.id, seq: 9, input: neutralInput({ stage: true }) });
    expect(bob.messages.at(-1)?.type).toBe('error');
    alice.send({ v: 1, type: 'input', vesselId: a.state.id, seq: 2, input: neutralInput({ stage: true }) });
    alice.send({ v: 1, type: 'input', vesselId: a.state.id, seq: 3, input: neutralInput() });
    alice.send({ v: 1, type: 'input', vesselId: a.state.id, seq: 1, input: neutralInput({ throttle: 1 }) });
    room.tick();
    const stage = a.state.nextStage;
    for (let i = 0; i < 5; i++) room.tick();
    expect(a.state.nextStage).toBe(stage);
    expect(a.state.telemetry.thrust).toBe(0);
    room.leave(alice.id);
    bob.send({ v: 1, type: 'claim', vesselId: a.state.id });
    expect(room.owner(a.state.id)?.id).toBe(bob.id);
  });
  it('cuts stale flight inputs after 500 ms', () => {
    const { room, a, alice } = orbitalRoom();
    alice.send({ v: 1, type: 'input', vesselId: a.state.id, seq: 0, input: neutralInput({ throttle: 1, stage: true }) });
    room.tick(); expect(a.state.telemetry.thrust).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) room.tick();
    expect(a.state.telemetry.thrust).toBeLessThan(1);
  });
  it('uses the minimum warp request, recalculates on leave, and protects all vessels from unsafe rails warp', () => {
    const { room, a, b, alice, bob } = orbitalRoom();
    alice.send({ v: 1, type: 'warp', rate: 100 });
    bob.send({ v: 1, type: 'warp', rate: 5 });
    let ut = room.world.ut;
    room.tick();
    expect(room.rate).toBe(5);
    expect(room.world.ut - ut).toBeCloseTo(0.1, 5);
    expect(room.state().heldBy).toEqual([bob.id]);
    expect(vesselDeltas(room.world).every(v => v.mode === 'rails' && !('state' in v))).toBe(true);
    room.leave(bob.id);
    ut = room.world.ut; room.tick();
    expect(room.rate).toBe(100); expect(room.world.ut - ut).toBeCloseTo(2, 5);
    // Physics safety checks apply to the second (non-active) vessel too.
    room.world.switchTo(b.state.id);
    room.world.activeId = a.state.id;
    b.state.telemetry.thrust = 100;
    room.tick(); expect(room.rate).toBe(1);
    expect(room.world.vessels.has(a.state.id)).toBe(true);
  });
  it('queues occupied pads without recovering another player and launches both sites independently', () => {
    const room = new Room('ABC123'), alice = peer(room, 'Alice'), bob = peer(room, 'Bob');
    alice.send({ v: 1, type: 'launch', craft: buildSoundingRocket(), site: 'pad' });
    const first = room.world.vessels.get(room.players.get(alice.id)!.vesselId!)!;
    bob.send({ v: 1, type: 'launch', craft: buildSoundingRocket(), site: 'pad' });
    expect(room.queue).toHaveLength(1); expect(room.world.vessels.size).toBe(1);
    room.tick(); expect(room.world.vessels.has(first.state.id)).toBe(true);
    placeInCircularOrbit(room.world, first, 'earth', 90_000);
    room.tick(); expect(room.queue).toHaveLength(0); expect(room.world.vessels.size).toBe(2);
    expect(room.players.get(alice.id)!.vesselId).not.toBe(room.players.get(bob.id)!.vesselId);
    bob.send({ v: 1, type: 'launch', craft: buildSwift(), site: 'runway' });
    expect(room.world.vessels.size).toBe(3);
  });
  it('broadcasts chat and rejects invalid launch hardware without corrupting the room', () => {
    const room = new Room('ABC123'), alice = peer(room, 'Alice'), bob = peer(room, 'Bob');
    alice.send({ v: 1, type: 'chat', text: 'Go for launch' });
    expect(alice.messages.at(-1)).toEqual(bob.messages.at(-1));
    const craft = buildSoundingRocket(); craft.parts[0].partId = 'missing-part';
    alice.send({ v: 1, type: 'launch', craft, site: 'pad' });
    expect(alice.messages.at(-1)?.type).toBe('error'); expect(room.world.vessels.size).toBe(0);
  });
  it('shares docking topology, preserves one controller and supports authoritative undocking', () => {
    const { room, a, b, alice, bob } = orbitalRoom(10);
    const pa = freePorts(a.state)[0], pb = freePorts(b.state)[0];
    const nose = normalize(pa.dir);
    b.state.position = add(b.state.position, sub(add(pa.pos, scale(nose, 0.8)), pb.pos));
    a.state.velocity = add(a.state.velocity, scale(nose, 0.2));
    for (let i = 0; i < 1000 && room.world.vessels.size > 1; i++) room.tick();
    expect(room.world.vessels.size).toBe(1);
    expect(room.players.get(bob.id)?.vesselId).toBeNull();
    expect(room.owner(a.state.id)?.id).toBe(alice.id);
    expect(alice.replica.world.active!.state.parts.length).toBe(a.state.parts.length);
    alice.send({ v: 1, type: 'action', action: 'undock', uid: dockedPorts(a.state)[0].uid });
    expect(room.world.vessels.size).toBe(2);
    expect(bob.replica.world.vessels.size).toBe(2);
  });
});

describe('replica reconciliation', () => {
  it('bounds error on a powered trajectory with 60 ms snapshot latency and smooths a correction', () => {
    const room = new Room('ABC123');
    const vessel = room.world.launch(buildTender());
    placeInCircularOrbit(room.world, vessel, 'earth', 90_000);
    const client = new Replica();
    let clock = 0, delayed = false;
    const pending: { at: number; message: ServerMessage }[] = [];
    const id = room.join('Alice', raw => {
      const message = decodeServer(raw);
      if (delayed) pending.push({ at: clock + 3, message }); else client.receive(message);
    });
    room.receive(id, encode({ v: 1, type: 'claim', vesselId: vessel.state.id }));
    delayed = true;
    let worst = 0;
    for (clock = 0; clock < 500; clock++) {
      const input = neutralInput({ throttle: clock < 300 ? 0.6 : 0.2, sas: 'stabilityAssist', stage: clock === 0 });
      room.receive(id, encode({ v: 1, type: 'input', seq: clock, vesselId: vessel.state.id, input }));
      room.tick();
      while (pending[0]?.at <= clock) client.receive(pending.shift()!.message);
      client.advance(0.02, input);
      if (clock > 20) worst = Math.max(worst, length(sub(client.world.active!.state.position, vessel.state.position)));
    }
    expect(worst).toBeLessThan(2);
    client.world.active!.state.position.x += 10;
    const previous = client.pose(vessel.state.id)!.position;
    room.fullSnapshot();
    client.receive(pending.at(-1)!.message);
    expect(length(sub(client.world.active!.state.position, vessel.state.position))).toBeLessThan(0.01);
    expect(length(sub(client.pose(vessel.state.id)!.position, previous))).toBeLessThan(0.1);
    for (let i = 0; i < 30; i++) client.advance(0.02, neutralInput());
    const offset = length(sub(client.pose(vessel.state.id)!.position, client.world.active!.state.position));
    expect(offset).toBeLessThan(0.02);
  });
  it('interpolates remote vessels between frames without stepping their physics', () => {
    const { room, a, bob } = orbitalRoom();
    for (let i = 0; i < 10; i++) room.tick();
    const authoritative = structuredClone(bob.replica.world.vessels.get(a.state.id)!.state.position);
    const before = bob.replica.pose(a.state.id)!.position;
    bob.replica.advance(0.05, neutralInput());
    const after = bob.replica.pose(a.state.id)!.position;
    expect(length(sub(before, after))).toBeGreaterThan(1);
    expect(bob.replica.world.vessels.get(a.state.id)!.state.position).toEqual(authoritative);
  });
});

import { World, PHYSICS_DT } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { neutralInput, buildVessel } from '../src/sim/vessel';
import { RESOURCES } from '../src/data/resources';
import type { ControlInput } from '../src/sim/vessel/runtime';
import type { CraftDef } from '../src/sim/vessel/types';
import { add, sub, length, scale } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { latLonToUnit, LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../src/sim/terrain';
import { decodeClient, encode, type ClientMessage, type LaunchSite, type NetEvent, type Player, type RoomState, type ServerMessage } from '../src/net/protocol';
import { serializeWorld, topologyKey, vesselDeltas } from '../src/net/snapshots';

type Peer = Player & { send: (raw: string) => void; seq: number; input: ControlInput; inputTick: number };
const START_UT = (Date.UTC(2030, 6, 20, 12) - Date.UTC(2000, 0, 1, 12)) / 1000;
/** No socket or timer dependency: production and in-process tests run exactly the same room. */
export class Room {
  readonly world: World;
  readonly players = new Map<string, Peer>();
  readonly queue: { playerId: string; site: LaunchSite; craft: CraftDef }[] = [];
  tickNumber = 0;
  rate = 1;
  private nextPlayer = 1;
  private topology = '';
  private dirty = false;
  private removedEvents = new Set<string>();
  constructor(readonly code: string, world = new World(new Universe('standard'), PART_CATALOG, START_UT)) {
    this.world = world;
    world.onEvent = event => {
      this.event(event);
      if (event.type === 'vesselDestroyed') this.removedEvents.add(event.vesselId);
      if (event.type === 'docked') this.removedEvents.add(event.otherId);
      // Merged vessel keeps its existing controller; absorbed controller becomes spectator.
      if (event.type === 'docked') {
        const owner = [...this.players.values()].find(p => p.vesselId === event.otherId);
        if (owner && !this.owner(event.vesselId)) owner.vesselId = event.vesselId;
      }
    };
  }
  join(name: string, send: Peer['send']): string {
    if (this.players.size >= 4) throw new Error('Room is full (4 players)');
    const id = `p${this.nextPlayer++}`;
    this.players.set(id, { id, name: name.trim(), send, vesselId: null, warp: 1, seq: -1, input: neutralInput(), inputTick: this.tickNumber });
    send(encode({ v: 1, type: 'welcome', playerId: id, room: this.code }));
    this.event({ type: 'join', playerId: id, name });
    this.fullSnapshot();
    return id;
  }
  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.release(p);
    this.players.delete(id);
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].playerId === id) this.queue.splice(i, 1);
    this.event({ type: 'leave', playerId: id, name: p.name });
    this.fullSnapshot();
  }
  owner(id: string) { return [...this.players.values()].find(p => p.vesselId === id); }
  private release(p: Peer) {
    p.vesselId = null;
    p.input = neutralInput();
    p.warp = 1;
  }
  receive(id: string, raw: string) {
    const p = this.players.get(id);
    if (!p) return;
    try { this.handle(p, decodeClient(raw)); }
    catch (e) { p.send(encode({ v: 1, type: 'error', message: (e as Error).message.slice(0, 1000) })); }
  }
  private handle(p: Peer, m: ClientMessage) {
    switch (m.type) {
      case 'join': throw new Error('Already joined');
      case 'leave': this.leave(p.id); return;
      case 'claim': {
        const v = this.world.vessels.get(m.vesselId);
        if (!v || v.state.destroyed || !this.world.canControl(v.state)) throw new Error('Vessel has no flight control');
        if (this.owner(m.vesselId) && this.owner(m.vesselId) !== p) throw new Error('Vessel already controlled');
        this.release(p);
        p.vesselId = m.vesselId;
        this.fullSnapshot();
        return;
      }
      case 'release': this.release(p); this.fullSnapshot(); return;
      case 'input':
        if (p.vesselId !== m.vesselId) throw new Error('You do not control this vessel');
        if (m.seq <= p.seq) return;
        p.seq = m.seq;
        // Preserve one-shot commands when several packets arrive before the next fixed step.
        p.input = { ...m.input, stage: p.input.stage || m.input.stage, evaJump: p.input.evaJump || m.input.evaJump, gear: m.input.gear ?? p.input.gear };
        p.inputTick = this.tickNumber;
        return;
      case 'warp': p.warp = m.rate; return;
      case 'chat': this.event({ type: 'chat', playerId: p.id, name: p.name, text: m.text.trim() }); return;
      case 'launch':
        if (this.queue.some(q => q.playerId === p.id)) throw new Error('You already have a queued launch');
        if (this.world.vessels.size >= 32) throw new Error('Prototype fleet limit reached (32 vessels)');
        const assembled = buildVessel(m.craft, this.world.catalog, { id: 'validate', resourceDefs: RESOURCES });
        for (const part of assembled.parts) for (const [resource, amount] of Object.entries(part.resources)) {
          const capacity = part.maxResources[resource as keyof typeof part.maxResources] ?? 0;
          if (amount > capacity) throw new Error('Craft resources exceed part capacity');
        }
        this.queue.push({ playerId: p.id, craft: structuredClone(m.craft), site: m.site });
        this.processQueue();
        this.fullSnapshot();
        return;
      case 'action': {
        if (!p.vesselId) throw new Error('Claim a vessel first');
        const focus = this.world.activeId;
        this.world.activeId = p.vesselId;
        try {
          if (m.action === 'eva') this.world.goEva(m.astronautId);
          if (m.action === 'board') {
            const target = this.world.boardingTarget();
            if (target && this.owner(target.vessel.state.id) && this.owner(target.vessel.state.id) !== p) throw new Error('Release destination vessel before boarding');
            this.world.boardEva();
          }
          if (m.action === 'undock') this.world.undockActive(m.uid);
          if (m.action === 'flag') {
            const before = this.world.flags.length;
            this.world.plantFlag();
            if (this.world.flags.length > before) this.event({ type: 'flag', flag: this.world.flags.at(-1)! });
          }
          if (this.world.activeId && !this.owner(this.world.activeId)) p.vesselId = this.world.activeId;
          if (p.vesselId && !this.world.vessels.has(p.vesselId)) p.vesselId = this.world.activeId;
          p.input = neutralInput();
          p.warp = 1;
        } finally { this.world.activeId = focus && this.world.vessels.has(focus) ? focus : null; }
        this.fullSnapshot();
      }
    }
  }
  /** Occupancy uses body-fixed site positions, so it stays correct as Earth rotates. */
  siteOccupied(site: LaunchSite) {
    const u = this.world.universe, b = u.body('earth');
    const along = RUNWAY.length / 2 - RUNWAY.spawnInset;
    const dir = site === 'pad' ? latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon) : siteLocalToUnit(RUNWAY.x - RUNWAY.dirX * along, RUNWAY.z - RUNWAY.dirZ * along, b.radius);
    const height = Math.max(0, u.terrain('earth').heightAt(dir.x, dir.y, dir.z));
    const spot = add(u.ephem.getBodyState('earth', this.world.ut).position, qRotate(u.ephem.bodyRotation('earth', this.world.ut), scale(dir, b.radius + height)));
    return [...this.world.vessels.values()].some(v => length(sub(v.state.position, spot)) < 200 + v.state.cache.boundingRadius);
  }
  private processQueue() {
    for (const site of ['pad', 'runway'] as const) {
      const index = this.queue.findIndex(q => q.site === site);
      if (index < 0 || this.siteOccupied(site)) continue;
      const q = this.queue.splice(index, 1)[0], p = this.players.get(q.playerId);
      if (!p) continue;
      const focus = this.world.activeId;
      const v = this.world.launch(q.craft, site, true);
      this.release(p);
      p.vesselId = v.state.id;
      this.world.activeId = focus && this.world.vessels.has(focus) ? focus : v.state.id;
      this.dirty = true;
    }
  }
  state(): RoomState {
    const players = [...this.players.values()].map(({ id, name, vesselId, warp }) => ({ id, name, vesselId, warp }));
    const requestedRate = players.length ? Math.min(...players.map(p => p.warp)) : 1;
    return { players, rate: this.rate, requestedRate, heldBy: players.filter(p => p.warp === requestedRate).map(p => p.id), queue: this.queue.map(({ playerId, site }) => ({ playerId, site })) };
  }
  tick() {
    if (!this.players.size) return; // Empty rooms freeze; reconnecting starts at the same UT.
    this.removedEvents.clear();
    const previousIds = [...this.world.vessels.keys()];
    const inputs = new Map<string, ControlInput>();
    for (const p of this.players.values()) if (p.vesselId) {
      if (this.tickNumber - p.inputTick > 25) p.input = neutralInput(); // 500 ms dead-man control.
      inputs.set(p.vesselId, p.input);
    }
    this.rate = this.world.tickMultiplayer(inputs, this.state().requestedRate);
    this.tickNumber++;
    for (const id of previousIds) if (!this.world.vessels.has(id) && !this.removedEvents.has(id)) this.event({ type: 'vesselDestroyed', vesselId: id });
    // An encounter stop must require fresh consent, otherwise a standing vote immediately
    // re-enters rails at the same event boundary and stalls the shared clock.
    if (this.rate === 1 && this.state().requestedRate > 4 && this.world.warp.index === 0)
      for (const p of this.players.values()) p.warp = 1;
    for (const p of this.players.values()) {
      p.input = { ...p.input, stage: false, evaJump: false, gear: undefined };
      if (p.vesselId && !this.world.vessels.has(p.vesselId)) this.release(p);
    }
    this.processQueue();
    const key = topologyKey(this.world);
    if (key !== this.topology || this.dirty) this.fullSnapshot();
    else if (this.tickNumber % 5 === 0) this.broadcast({ v: 1, type: 'delta', tick: this.tickNumber, ut: this.world.ut, vessels: vesselDeltas(this.world), room: this.state(), ack: Object.fromEntries([...this.players.values()].map(p => [p.id, p.seq])) });
  }
  fullSnapshot() {
    this.topology = topologyKey(this.world);
    this.dirty = false;
    this.broadcast({ v: 1, type: 'snapshot', tick: this.tickNumber, world: serializeWorld(this.world), room: this.state() });
  }
  private event(event: NetEvent) { this.broadcast({ v: 1, type: 'event', tick: this.tickNumber, event }); }
  private broadcast(m: ServerMessage) {
    const raw = encode(m);
    for (const p of this.players.values()) p.send(raw);
  }
}
export { PHYSICS_DT };

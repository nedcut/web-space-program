import { World, PHYSICS_DT } from '../game/world';
import { RAILS_WARP } from '../game/timewarp';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { neutralInput, type ControlInput } from '../sim/vessel';
import { add, sub, scale, length, v3, type Vec3 } from '../util/vec3';
import { qNormalize, type Quat } from '../util/quat';
import { applyDeltas, replaceWorld } from './snapshots';
import { decodeServer, encode, WARP_RATES, type ClientMessage, type RoomState, type ServerMessage } from './protocol';

export interface MultiplayerConfig { url: string; room: string; name: string }
export interface Pose { position: Vec3; velocity: Vec3; orientation: Quat; body: string }
interface Frame { tick: number; ut: number; poses: Map<string, Pose> }
export const blendQuat = (a: Quat, b: Quat, t: number): Quat => {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return qNormalize({ x: a.x * (1 - t) + b.x * t * sign, y: a.y * (1 - t) + b.y * t * sign, z: a.z * (1 - t) + b.z * t * sign, w: a.w * (1 - t) + b.w * t * sign });
};
const lerp = (a: Vec3, b: Vec3, t: number) => add(a, scale(sub(b, a), t));

/** Transport-free replica, also exercised by latency/reconciliation tests. */
export class Replica {
  readonly world = new World(new Universe('standard'), PART_CATALOG, 0);
  playerId = '';
  roomCode = '';
  room: RoomState = { players: [], rate: 1, requestedRate: 1, heldBy: [], queue: [] };
  tick = 0;
  serverTick = 0;
  ready = false;
  private acc = 0;
  private sinceSnapshot = 0;
  private frames: Frame[] = [];
  private history: { tick: number; input: ControlInput }[] = [];
  private offset = v3();
  private oldOrientation: Quat | null = null;
  private smoothing = 1;
  get ownId() { return this.room.players.find(p => p.id === this.playerId)?.vesselId ?? null; }
  receive(m: ServerMessage) {
    if (m.type === 'welcome') { this.playerId = m.playerId; this.roomCode = m.room; return; }
    if (m.type !== 'snapshot' && m.type !== 'delta') return;
    if (this.ready && m.tick < this.serverTick) return;
    const oldId = this.ownId, oldPose = oldId ? this.pose(oldId) : null, oldUt = this.world.ut;
    const previousRate = this.room.rate;
    if (m.type === 'snapshot') replaceWorld(this.world, m.world);
    else applyDeltas(this.world, m.ut, m.vessels);
    this.room = m.room;
    this.world.warp = this.room.rate <= 4 && this.room.rate > 1
      ? { mode: 'physics', index: this.room.rate - 1 }
      : { mode: 'rails', index: Math.max(0, RAILS_WARP.findIndex(r => r === this.room.rate)) };
    this.serverTick = m.tick;
    this.sinceSnapshot = 0;
    this.frames.push({ tick: m.tick, ut: this.world.ut, poses: new Map([...this.world.vessels].map(([id, v]) => [id, structuredClone({ position: v.state.position, velocity: v.state.velocity, orientation: v.state.orientation, body: v.body })])) });
    this.frames = this.frames.filter((f, i, a) => i === a.length - 1 || f.tick !== m.tick).slice(-4);
    const ownId = this.ownId;
    this.world.activeId = ownId ?? (this.world.activeId && this.world.vessels.has(this.world.activeId) ? this.world.activeId : this.world.vessels.keys().next().value ?? null);
    const replay = ownId === oldId && this.room.rate === 1 && previousRate === 1 ? this.history.filter(h => h.tick > m.tick && h.tick <= m.tick + 15) : [];
    this.tick = m.tick;
    for (const h of replay) { if (ownId) this.world.predictVessel(ownId, h.input); this.tick = h.tick; }
    this.history = replay;
    if (!replay.length) this.acc = 0;
    this.offset = v3();
    const corrected = ownId ? this.world.vessels.get(ownId)?.state : null;
    if (oldPose && corrected && oldId === ownId && this.room.rate === 1) {
      // Compare poses at the same UT, avoiding a solar-frame jump from normal ephemeris motion.
      const oldNow = add(oldPose.position, scale(oldPose.velocity, this.world.ut - oldUt));
      const error = sub(oldNow, corrected.position);
      if (length(error) < 200) this.offset = error; // Teleports/topology catastrophes snap.
      this.oldOrientation = oldPose.orientation;
      this.smoothing = 0;
    }
    this.ready = true;
  }
  advance(dt: number, input: ControlInput) {
    if (!this.ready) return;
    dt = Math.min(dt, 0.1);
    this.sinceSnapshot += dt;
    this.offset = scale(this.offset, Math.exp(-dt * 12));
    this.smoothing = 1 - (1 - this.smoothing) * Math.exp(-dt * 12);
    const id = this.ownId;
    if (!id || this.room.rate !== 1) return;
    this.acc += dt;
    while (this.acc + 1e-9 >= PHYSICS_DT && this.tick < this.serverTick + 15) {
      this.tick++;
      const c = { ...input, stage: false, evaJump: input.evaJump && this.history.at(-1)?.input.evaJump !== true };
      this.history.push({ tick: this.tick, input: structuredClone(c) });
      this.world.predictVessel(id, c);
      this.acc -= PHYSICS_DT;
    }
    this.acc = Math.min(this.acc, PHYSICS_DT);
  }
  /** Remote interpolation is 100 ms behind, compensated for the common body's solar motion. */
  pose(id: string): Pose | null {
    const v = this.world.vessels.get(id);
    if (!v) return null;
    const s = v.state;
    if (id === this.ownId) return { position: add(s.position, this.offset), velocity: s.velocity, orientation: this.oldOrientation ? blendQuat(this.oldOrientation, s.orientation, this.smoothing) : s.orientation, body: v.body };
    const target = this.serverTick + Math.min(this.sinceSnapshot, 0.1) / PHYSICS_DT - 5;
    const before = [...this.frames].reverse().find(f => f.tick <= target) ?? this.frames[0];
    const after = this.frames.find(f => f.tick >= target) ?? this.frames.at(-1);
    const a = before?.poses.get(id), b = after?.poses.get(id);
    if (!a || !b || a.body !== b.body) return { position: s.position, velocity: s.velocity, orientation: s.orientation, body: v.body };
    const t = before === after ? 1 : Math.min(1, Math.max(0, (target - before!.tick) / (after!.tick - before!.tick)));
    const ut = before!.ut + (after!.ut - before!.ut) * t;
    const u = this.world.universe;
    const transport = sub(u.ephem.getBodyState(v.body, this.world.ut).position, u.ephem.getBodyState(v.body, ut).position);
    return { position: add(lerp(a.position, b.position, t), transport), velocity: lerp(a.velocity, b.velocity, t), orientation: blendQuat(a.orientation, b.orientation, t), body: v.body };
  }
}

export class MultiplayerClient extends Replica {
  status = 'Connecting…';
  connected = false;
  error = '';
  chat: { name: string; text: string }[] = [];
  private socket: WebSocket;
  private seq = 0;
  private sendTime = 0;
  private lastMessage = performance.now();
  private listeners = new Set<() => void>();
  private closed = false;
  constructor(config: MultiplayerConfig) {
    super();
    const url = new URL(config.url);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Use a ws:// or wss:// server URL');
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.send({ v: 1, type: 'join', room: config.room.trim().toUpperCase(), name: config.name.trim() });
    this.socket.onmessage = e => {
      try {
        const m = decodeServer(String(e.data));
        this.lastMessage = performance.now();
        this.receive(m);
        if (m.type === 'snapshot') { this.connected = true; this.status = 'Connected'; }
        if (m.type === 'error') this.error = m.message;
        if (m.type === 'event') {
          const ev = m.event;
          if (ev.type === 'chat') this.chat = [...this.chat.slice(-49), { name: ev.name, text: ev.text }];
          else if (ev.type === 'join' || ev.type === 'leave') this.chat = [...this.chat.slice(-49), { name: 'Flight control', text: `${ev.name} ${ev.type === 'join' ? 'joined' : 'left'}` }];
          else if ('vesselId' in ev) this.world.onEvent?.(ev);
        }
        this.notify();
      } catch (e) { this.error = `Protocol error: ${(e as Error).message}`; this.close(); }
    };
    this.socket.onerror = () => { this.error = 'Cannot reach server. Check its URL and that npm run server is running.'; this.notify(); };
    this.socket.onclose = () => { this.connected = false; this.status = this.closed ? 'Disconnected' : 'Connection lost — return to menu to rejoin'; this.notify(); };
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { this.listeners.forEach(fn => fn()); }
  send(m: ClientMessage) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encode(m)); }
  update(dt: number, input: ControlInput) {
    if (!this.connected) return;
    if (performance.now() - this.lastMessage > 5000) { this.error = 'Server stopped responding'; this.close(); return; }
    this.sendTime += dt;
    if (this.ownId && (this.sendTime >= 1 / 30 || input.stage || input.evaJump || input.gear !== undefined)) {
      this.send({ v: 1, type: 'input', seq: this.seq++, vesselId: this.ownId, input });
      this.sendTime = 0;
    }
    this.advance(dt, input);
  }
  changeWarp(delta: number) {
    const current = this.room.players.find(p => p.id === this.playerId)?.warp ?? 1;
    const index = WARP_RATES.findIndex(r => r === current);
    this.send({ v: 1, type: 'warp', rate: WARP_RATES[Math.max(0, Math.min(WARP_RATES.length - 1, index + delta))] });
  }
  action(action: 'eva' | 'board' | 'flag' | 'undock', extra: { uid?: number; astronautId?: string } = {}) { this.send({ v: 1, type: 'action', action, ...extra }); }
  close() {
    this.closed = true;
    this.connected = false;
    if (this.socket.readyState === WebSocket.OPEN) this.send({ v: 1, type: 'leave' });
    this.socket.close();
    this.notify();
  }
}

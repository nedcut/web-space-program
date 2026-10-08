import type { ManeuverNode, TrajectoryPatch } from '../sim/orbit/api';
import type { World } from './world';

export interface MissionAlarm {
  id: string;
  vesselId: string;
  label: string;
  time: number;
  kind: 'custom' | 'node' | 'soi';
  /** Automatic alarm identity; edits move the existing alarm rather than duplicate it. */
  source?: string;
  fired?: boolean;
  disabled?: boolean;
}

/** Fleet-wide clock. Prediction is supplied by existing caches, never calculated by the clock. */
export class AlarmClock {
  alarms: MissionAlarm[] = [];
  held = false;
  holdReason: 'node' | 'other' | null = null;
  private nodeCount = -1;
  private nodeOwner: string | null = null;
  private serial = 0;
  private deadline = Infinity;
  private nodeRecords = new Map<ManeuverNode, { vessel: string; time: number }>();
  private soiRecords = new Map<string, { body: string; time: number }>();
  private reschedule() {
    this.deadline = Infinity;
    for (const a of this.alarms) if (!a.fired && !a.disabled && a.time < this.deadline) this.deadline = a.time;
  }
  toggle(id: string) {
    const a = this.alarms.find(a => a.id === id);
    if (a) a.disabled = !a.disabled;
    this.reschedule();
  }
  add(vesselId: string, label: string, time: number): MissionAlarm {
    if (!Number.isFinite(time)) throw new Error('Alarm time must be finite');
    if (this.alarms.length >= 200) throw new Error('Remove an alarm before adding another (200 maximum)');
    const alarm: MissionAlarm = { id: `custom:${++this.serial}:${time}`, vesselId, label: label.trim() || 'Reminder', time, kind: 'custom' };
    this.alarms.push(alarm);
    this.reschedule();
    return alarm;
  }
  remove(id: string) { this.alarms = this.alarms.filter(a => a.id !== id); this.reschedule(); }
  acknowledge() { this.held = false; this.holdReason = null; }
  restore(alarms: MissionAlarm[]) {
    this.alarms = structuredClone(alarms).filter(a => typeof a.id === 'string' && typeof a.vesselId === 'string' && Number.isFinite(a.time)).slice(0, 200);
    this.serial = this.alarms.length;
    this.nodeCount = -1; this.nodeOwner = null;
    this.nodeRecords.clear(); this.soiRecords.clear(); this.reschedule();
  }
  private automatic(vesselId: string, kind: 'node' | 'soi', source: string, label: string, time: number, now: number) {
    let a = this.alarms.find(a => a.vesselId === vesselId && a.kind === kind && a.source === source);
    if (a) {
      // Fired alarms stay fired unless a node/event was deliberately moved into the future.
      if (a.fired && time > now + 1 && Math.abs(a.time - time) > 1) a.fired = false;
      a.time = time; a.label = label;
    } else if (time > now && this.alarms.length < 200) {
      a = { id: `${kind}:${vesselId}:${source}`, vesselId, kind, source, label, time };
      this.alarms.push(a);
    }
    this.reschedule();
  }
  sync(world: World, fleet = false) {
    const v = world.active;
    if (v) {
      for (let i = 0; i < world.nodes.length; i++) {
        const n = world.nodes[i];
        const record = this.nodeRecords.get(n);
        if (!record || record.vessel !== v.state.id || record.time !== n.time) {
          this.automatic(v.state.id, 'node', String(n.id), 'Maneuver · prepare burn', n.time - 30, world.ut);
          this.nodeRecords.set(n, { vessel: v.state.id, time: n.time });
        }
      }
      if (this.nodeCount !== world.nodes.length || this.nodeOwner !== v.state.id) {
        this.nodeCount = world.nodes.length; this.nodeOwner = v.state.id;
        for (const [n, record] of this.nodeRecords) if (record.vessel === v.state.id && !world.nodes.includes(n)) this.nodeRecords.delete(n);
        // Drop deleted nodes only for their owner; switching vessels preserves the fleet's alarms.
        for (let i = this.alarms.length - 1; i >= 0; i--) {
          const a = this.alarms[i];
          if (a.kind === 'node' && a.vesselId === v.state.id && !a.fired && !world.nodes.some(n => n.id === Number(a.source))) { this.alarms.splice(i, 1); this.reschedule(); }
        }
      }
    }
    if (!fleet) return;
    for (const vessel of world.vessels.values()) {
      const ev = vessel.railsEvent;
      const record = this.soiRecords.get(vessel.state.id);
      if (ev && (ev.reason === 'soiEnter' || ev.reason === 'soiExit') && (!record || record.time !== ev.time || record.body !== ev.nextBody)) {
        this.soi(world, vessel.state.id, ev.nextBody!, ev.time);
        this.soiRecords.set(vessel.state.id, { body: ev.nextBody!, time: ev.time });
      }
    }
  }
  soi(world: World, vesselId: string, body: string, time: number) {
    this.automatic(vesselId, 'soi', body, `SOI → ${world.universe.body(body).name}`, time, world.ut);
  }
  predicted(world: World, vesselId: string, patches: TrajectoryPatch[]) {
    for (let i = this.alarms.length - 1; i >= 0; i--) {
      const a = this.alarms[i];
      if (a.kind === 'soi' && !a.fired && a.vesselId === vesselId && !patches.some(p => p.nextBody === a.source && (p.endReason === 'soiEnter' || p.endReason === 'soiExit'))) { this.alarms.splice(i, 1); this.reschedule(); }
    }
    // Only the next crossing into each body: farther recurrences are recalculated after arrival.
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      if (p.nextBody && (p.endReason === 'soiEnter' || p.endReason === 'soiExit')) this.soi(world, vesselId, p.nextBody, p.endTime);
    }
  }
  next(_now: number): number { return this.deadline; }
  fire(world: World) {
    if (world.ut + 1e-6 < this.deadline) return;
    for (const a of this.alarms) if (!a.fired && !a.disabled && a.time <= world.ut + 1e-6) {
      a.fired = true; this.held = true;
      if (a.kind !== 'node') this.holdReason = 'other';
      else if (!this.holdReason) this.holdReason = 'node';
      world.warp = { mode: 'rails', index: 0 };
      world.message(`Alarm · ${world.vessels.get(a.vesselId)?.state.name ?? a.vesselId} · ${a.label}`, 'warn', 10);
    }
    this.reschedule();
  }
}

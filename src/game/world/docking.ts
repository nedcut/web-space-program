import { dockedPorts, stepDocking, undock } from '../../sim/vessel';
import type { VesselState } from '../../sim/vessel/runtime';
import type { World } from '../world';
import type { WorldInternals } from './internals';
const PHYSICS_DT = 1 / 50;

// ---------- Docking ----------

/** Docking: capture field + merges between physics vessels (run after every physics step). */
export function stepDockingAll(this: World, internals: WorldInternals): void {
  const phys: VesselState[] = [];
  for (const wv of this.vessels.values()) if (wv.mode === 'physics' && !wv.state.destroyed) phys.push(wv.state);
  if (phys.length < 2) return;
  const events = stepDocking(phys, PHYSICS_DT, (a, b) => (a.id === this.activeId ? a : b.id === this.activeId ? b : a.mass >= b.mass ? a : b));
  for (const e of events) {
    const removed = this.vessels.get(e.removed.id);
    if (removed) { this.logFlightEvent(removed, 'docking', e.keep.id); const r = this.flightlog.records.find(r => r.vesselId === e.removed.id && !r.outcome); if (r) { r.end = this.ut; r.outcome = 'merged';
      const keepRecord = this.flightlog.records.find(k => k.vesselId === e.keep.id && !k.outcome);
      if (keepRecord) { keepRecord.bodies = [...new Set([...keepRecord.bodies, ...r.bodies])]; keepRecord.landedBodies = [...new Set([...keepRecord.landedBodies, ...r.landedBodies])]; } } }
    this.vessels.delete(e.removed.id);
    if (this.activeId === e.removed.id) this.activeId = e.keep.id;
    if (this.targetId === e.removed.id || this.targetId === e.keep.id) this.setTarget(null);
    internals.trajectoryCache = null;
    const keepWv = this.vessels.get(e.keep.id);
    if (keepWv) keepWv.body = this.universe.dominantBody(e.keep.position, this.ut);
    if (e.keep.id === this.activeId) this.message(`Docked with ${e.removedName}`);
    internals.handleEvent({ type: 'docked', vesselId: e.keep.id, otherId: e.removed.id });
  }
}

/** Undock the active vessel at `portUid` (default: the first docked joint). Returns the new vessel id. */
export function undockActive(this: World, internals: WorldInternals, portUid?: number): string | null {
  const wv = this.active;
  if (!wv || !this.canControl(wv.state)) return null;
  if (wv.mode !== 'physics') internals.unpack(wv);
  if (wv.mode !== 'physics') return null;
  const uid = portUid ?? dockedPorts(wv.state)[0]?.uid;
  if (uid === undefined) return null;
  const nv = undock(wv.state, uid);
  if (!nv) return null;
  if (this.vessels.has(nv.id)) nv.id = `${wv.state.id}.${++wv.state.splitCount}`;
  this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
  this.inheritFlight(wv, this.vessels.get(nv.id)!);
  this.logFlightEvent(wv, 'separation', `Undocked ${nv.name}`);
  internals.trajectoryCache = null;
  this.message(`Undocked ${nv.name}`);
  internals.handleEvent({ type: 'undocked', vesselId: wv.state.id, newVesselId: nv.id });
  return nv.id;
}

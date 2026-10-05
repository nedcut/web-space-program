import { period, predictTrajectory, propagate, stateToElements } from '../../sim/orbit';
import { advanceISRU, isruMachinery } from '../../sim/vessel/isru';
import { qConj, qMul, qNormalize, qRotate } from '../../util/quat';
import { add, sub, v3 } from '../../util/vec3';
import { advanceTransmissions, evaluateProgression } from '../science';
import { Universe } from '../universe';
import type { World, WorldVessel } from '../world';
import type { WorldInternals } from './internals';
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);

/** Update a body-fixed vessel's inertial state from its fixed coordinates. */
export function syncFixed(this: World, _internals: WorldInternals, wv: WorldVessel, t: number): void {
  const u = this.universe;
  const bs = u.ephem.getBodyState(wv.body, t);
  const q = bodyQuat(u, wv.body, t);
  const rel = qRotate(q, wv.fixed!.pos);
  wv.state.position = add(bs.position, rel);
  wv.state.velocity = add(bs.velocity, u.ephem.surfaceVelocity(wv.body, rel, t));
  wv.state.orientation = qNormalize(qMul(q, wv.fixed!.orient));
  // Co-rotate with the body: inertial spin axis expressed in vessel body frame.
  const b = u.body(wv.body);
  const spin = qRotate(q, v3(0, 0, b.rotationRate));
  wv.state.angularVelocity = qRotate(qConj(wv.state.orientation), spin);
}

/** Capture a landed vessel's body-fixed coordinates (for rails warp while landed). */
export function captureFixed(this: World, _internals: WorldInternals, wv: WorldVessel, t: number): void {
  const u = this.universe;
  const bs = u.ephem.getBodyState(wv.body, t);
  const q = bodyQuat(u, wv.body, t);
  const qi = qConj(q);
  wv.fixed = { pos: qRotate(qi, sub(wv.state.position, bs.position)), orient: qNormalize(qMul(qi, wv.state.orientation)) };
}

/** Put a vessel on rails at the current time. */
export function pack(this: World, internals: WorldInternals, wv: WorldVessel): void {
  if (wv.mode === 'rails' || wv.mode === 'landedRails' || wv.mode === 'prelaunch') return;
  if (wv.state.situation !== 'flying') {
    internals.captureFixed(wv, this.ut);
    wv.mode = 'landedRails';
    return;
  }
  const rs = this.relativeState(wv);
  wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
  wv.mode = 'rails';
  wv.state.angularVelocity = v3();
  internals.predictRailsEvent(wv);
}


export function predictRailsEvent(this: World, _internals: WorldInternals, wv: WorldVessel): void {
  const o = wv.orbit!;
  const T = period(o);
  const horizon = Math.min(isFinite(T) ? T * 3 : 3e8, 3e9);
  try {
    const patches = predictTrajectory({
      ephem: this.universe.ephem,
      bodies: this.universe.bodies,
      initialBody: wv.body,
      state: propagate(o, this.ut),
      t0: this.ut,
      horizon,
      maxPatches: 1,
      stopAtAtmosphere: true,
      // Stop warping before the highest terrain, not the datum sphere (mountains/crater rims rise km above it).
      impactAltitude: (b) => (b.solidSurface ? Math.max(0, this.universe.terrain(b.id).maxHeight) : 0),
    });
    const p = patches[0];
    // A 'horizon' event is kept too: when it is reached the prediction is extended (see advanceRails), so
    // encounters further out than one horizon are not missed during long warps.
    wv.railsEvent = p ? { time: p.endTime, reason: p.endReason, nextBody: p.nextBody } : undefined;
  } catch {
    wv.railsEvent = undefined;
  }
}

/** Take a vessel off rails (back to physics). */
export function unpack(this: World, internals: WorldInternals, wv: WorldVessel): void {
  if (wv.mode === 'rails' && wv.orbit) {
    const s = propagate(wv.orbit, this.ut);
    const bs = this.universe.ephem.getBodyState(wv.body, this.ut);
    wv.state.position = add(bs.position, s.position);
    wv.state.velocity = add(bs.velocity, s.velocity);
  } else if (wv.mode === 'landedRails') {
    internals.syncFixed(wv, this.ut);
  } else return;
  wv.mode = 'physics';
  wv.orbit = undefined;
  wv.railsEvent = undefined;
}

/** Advance an unattended world, packing vessels first and processing the normal rails events.
   * Tracking uses this when there is no active vessel (including completely empty worlds).
   */
export function advanceRailsTo(this: World, internals: WorldInternals, ut: number): void {
  if (!Number.isFinite(ut) || ut < this.ut) return;
  for (const wv of this.vessels.values()) internals.pack(wv);
  internals.advanceRails(ut);
}

/**
   * Advance all on-rails vessels to `target`, processing rails events in time order. The active vessel goes
   * first and may shorten the frame: at its SOI change (so the next frame re-clamps the warp rate for the new
   * body — at high warp one frame could otherwise also carry it through periapsis or into the surface) and
   * just before atmosphere entry / impact (warp is cancelled). Everything else then advances to that time.
   */
export function advanceRails(this: World, internals: WorldInternals, target: number): void {
  const startUt = this.ut;
  const act = this.active;
  const order = [...this.vessels.values()].sort((a, b) => (a === act ? -1 : b === act ? 1 : 0));
  for (const wv of order) {
    if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') continue;
    const isActive = wv === act;
    let guard = 0;
    while (wv.mode === 'rails' && wv.railsEvent && wv.railsEvent.time <= target && guard++ < 32) {
      const ev = wv.railsEvent;
      const s = propagate(wv.orbit!, ev.time);
      if (ev.reason === 'soiEnter' || ev.reason === 'soiExit') {
        const oldB = this.universe.ephem.getBodyState(wv.body, ev.time);
        const newB = this.universe.ephem.getBodyState(ev.nextBody!, ev.time);
        const pos = sub(add(oldB.position, s.position), newB.position);
        const vel = sub(add(oldB.velocity, s.velocity), newB.velocity);
        wv.body = ev.nextBody!;
        this.onEnteredSoi(wv);
        wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, pos, vel, ev.time);
        if (isActive) {
          this.message(`Entered ${this.universe.body(wv.body).name}'s sphere of influence`);
          target = ev.time;
        }
        const saveUt = this.ut;
        this.ut = ev.time;
        internals.predictRailsEvent(wv);
        this.ut = saveUt;
      } else if (ev.reason === 'horizon' || ev.reason === 'maneuver') {
        // End of the predicted window without an event: predict the next window.
        const saveUt = this.ut;
        this.ut = ev.time;
        internals.predictRailsEvent(wv);
        this.ut = saveUt;
        if (wv.railsEvent && wv.railsEvent.time <= ev.time) wv.railsEvent = undefined;
      } else if (isActive) {
        // Never warp into the atmosphere or the ground: stop just short of it and drop to physics.
        target = Math.max(this.ut, Math.min(target, ev.time - 1));
        this.warp = { mode: 'rails', index: 0 };
        this.message('Time warp stopped: approaching ' + (ev.reason === 'atmosphere' ? 'atmosphere' : 'surface'), 'warn');
        break;
      } else {
        // Non-active vessels entering atmosphere or impacting on rails are lost.
        this.vessels.delete(wv.state.id);
        wv.railsEvent = undefined;
        break;
      }
    }
  }
  for (const wv of this.vessels.values()) {
    if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') advanceISRU(wv.state, isruMachinery(wv.state).length ? this.localConcentration(wv) : 0, target - this.ut);
  }
  this.ut = target;
  for (const wv of this.vessels.values()) internals.syncPacked(wv, this.ut);
  advanceTransmissions(this);
  evaluateProgression(this);
  this.onSimulationStep?.(this.ut - startUt, 0);
}

/** Update the inertial state of a packed (rails / body-fixed) vessel to time t. */
export function syncPacked(this: World, internals: WorldInternals, wv: WorldVessel, t: number): void {
  if (wv.mode === 'rails' && wv.orbit) {
    const s = propagate(wv.orbit, t);
    const bs = this.universe.ephem.getBodyState(wv.body, t);
    wv.state.position = add(bs.position, s.position);
    wv.state.velocity = add(bs.velocity, s.velocity);
  } else if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') {
    internals.syncFixed(wv, t);
  }
}

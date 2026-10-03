import type { CraftDef, PartDef } from '../sim/vessel/types';
import type { ControlInput, VesselState, VesselEvent } from '../sim/vessel/runtime';
import { buildVessel, stepVessel, activateNextStage, neutralInput, recomputeMassProperties } from '../sim/vessel';
import type { Orbit, ManeuverNode, TrajectoryPatch, StateVector } from '../sim/orbit/api';
import { stateToElements, propagate, predictTrajectory, periapsisRadius, apoapsisRadius, timeToPeriapsis, timeToApoapsis, period, maneuverToInertialDv } from '../sim/orbit';
import { latLonToUnit, LAUNCH_SITE } from '../sim/terrain';
import { add, sub, length, scale, normalize, cross, dot, v3, type Vec3 } from '../util/vec3';
import { qMul, qConj, qRotate, qNormalize, type Quat } from '../util/quat';
import { Universe } from './universe';
import { type WarpState, warpRate, stepWarp, clampWarp, type WarpContext } from './timewarp';
import { RESOURCES } from '../data/resources';

export const PHYSICS_DT = 1 / 50;
/** Distance from the active vessel inside which other vessels are simulated with full physics. */
const PHYSICS_RANGE = 5000;
/** Max physics steps per frame before we drop simulated time (prevents spiral of death on slow machines). */
const MAX_STEPS_PER_FRAME = 12;

export type VesselMode = 'physics' | 'rails' | 'prelaunch' | 'landedRails';

export interface WorldVessel {
  state: VesselState;
  mode: VesselMode;
  /** Dominant (reference) body id. */
  body: string;
  /** On rails: conic relative to `body`. */
  orbit?: Orbit;
  /** Next rails event (SOI change/impact/atmosphere) predicted when packed. */
  railsEvent?: { time: number; reason: TrajectoryPatch['endReason']; nextBody?: string };
  /** Landed/prelaunch: position + attitude fixed in the body's rotating frame. */
  fixed?: { pos: Vec3; orient: Quat };
}

export interface WorldMessage {
  id: number;
  text: string;
  level: 'info' | 'warn' | 'bad';
  expires: number;
}

/** Quaternion that maps body-fixed → inertial for the given body at time t. */
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);

export class World {
  readonly universe: Universe;
  readonly vessels = new Map<string, WorldVessel>();
  activeId: string | null = null;
  ut: number;
  warp: WarpState = { mode: 'rails', index: 0 };
  nodes: ManeuverNode[] = [];
  messages: WorldMessage[] = [];
  /** Real-time accumulator for fixed physics steps. */
  private acc = 0;
  private msgId = 0;
  private nodeId = 1;
  private trajectoryCache: { time: number; key: string; patches: TrajectoryPatch[] } | null = null;
  readonly catalog: Map<string, PartDef>;
  /** Event listeners (audio, camera shake, UI). */
  onEvent: ((e: VesselEvent) => void) | null = null;

  constructor(universe: Universe, catalog: Map<string, PartDef>, ut: number) {
    this.universe = universe;
    this.catalog = catalog;
    this.ut = ut;
  }

  get active(): WorldVessel | null {
    return this.activeId ? (this.vessels.get(this.activeId) ?? null) : null;
  }

  message(text: string, level: WorldMessage['level'] = 'info', seconds = 4) {
    this.messages.push({ id: ++this.msgId, text, level, expires: performance.now() + seconds * 1000 });
  }

  /** Lowest point of the vessel along its own -Y axis, measured from the COM (positive number). */
  bottomOffset(v: VesselState): number {
    let minY = Infinity;
    for (const p of v.parts) {
      const s = p.def.shape;
      const ext = s.kind === 'cylinder' ? s.height / 2 : s.size.y / 2;
      // Account for rotated parts conservatively using the rotated local Y extent.
      const upInPart = qRotate(qConj(p.rotation), v3(0, 1, 0));
      const radial = s.kind === 'cylinder' ? Math.max(s.radiusTop, s.radiusBottom) : Math.max(s.size.x, s.size.z) / 2;
      const extY = Math.abs(upInPart.y) * ext + Math.sqrt(Math.max(0, 1 - upInPart.y * upInPart.y)) * radial;
      minY = Math.min(minY, p.position.y - extY);
      for (const m of p.def.modules) {
        if (m.type === 'landingLeg') {
          const foot = add(p.position, qRotate(p.rotation, m.footPosition));
          minY = Math.min(minY, foot.y);
        }
      }
    }
    return v.com.y - minY;
  }

  /** Spawn a craft on the launch pad (held by launch clamps until the first stage fires). */
  launch(craft: CraftDef): WorldVessel {
    const u = this.universe;
    const bodyId = 'earth';
    const body = u.body(bodyId);
    const dir = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
    const terrainH = Math.max(0, u.terrain(bodyId).heightAt(dir.x, dir.y, dir.z));
    // Body-fixed basis at the pad: +Y up, +X east, +Z = X × Y (south).
    const up = v3(dir.x, dir.y, dir.z);
    const east = normalize(cross(v3(0, 0, 1), up));
    const zAxis = cross(east, up);
    const orientFixed = quatFromBasis(east, up, zAxis);

    const state = buildVessel(craft, this.catalog, { id: `v${Date.now().toString(36)}`, resourceDefs: RESOURCES, legsDeployed: false });
    state.name = craft.name;
    const bottom = this.bottomOffset(state);
    const posFixed = scale(up, body.radius + terrainH + bottom + 0.05);
    const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: posFixed, orient: orientFixed } };
    this.syncFixed(wv, this.ut);
    this.vessels.set(state.id, wv);
    this.activeId = state.id;
    this.nodes = [];
    this.warp = { mode: 'rails', index: 0 };
    return wv;
  }

  /** Update a body-fixed vessel's inertial state from its fixed coordinates. */
  private syncFixed(wv: WorldVessel, t: number) {
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
  private captureFixed(wv: WorldVessel, t: number) {
    const u = this.universe;
    const bs = u.ephem.getBodyState(wv.body, t);
    const q = bodyQuat(u, wv.body, t);
    const qi = qConj(q);
    wv.fixed = { pos: qRotate(qi, sub(wv.state.position, bs.position)), orient: qNormalize(qMul(qi, wv.state.orientation)) };
  }

  relativeState(wv: WorldVessel, t = this.ut): StateVector {
    const bs = this.universe.ephem.getBodyState(wv.body, t);
    return { position: sub(wv.state.position, bs.position), velocity: sub(wv.state.velocity, bs.velocity) };
  }

  orbitOf(wv: WorldVessel): Orbit {
    if (wv.mode === 'rails' && wv.orbit) return wv.orbit;
    const rs = this.relativeState(wv);
    return stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
  }

  /** Put a vessel on rails at the current time. */
  private pack(wv: WorldVessel) {
    if (wv.mode === 'rails' || wv.mode === 'landedRails' || wv.mode === 'prelaunch') return;
    if (wv.state.situation !== 'flying') {
      this.captureFixed(wv, this.ut);
      wv.mode = 'landedRails';
      return;
    }
    const rs = this.relativeState(wv);
    wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
    wv.mode = 'rails';
    wv.state.angularVelocity = v3();
    this.predictRailsEvent(wv);
  }

  /** Make another vessel active (switching the floating origin / controls to it). */
  switchTo(id: string): boolean {
    const wv = this.vessels.get(id);
    if (!wv || id === this.activeId) return false;
    this.activeId = id;
    this.nodes = [];
    this.trajectoryCache = null;
    if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
    return true;
  }

  /** Cycle to the next vessel within physics range of the active one (debris, decoupled stages). */
  focusNextNearby(): string | null {
    const act = this.active;
    if (!act) return null;
    const ids = [...this.vessels.values()]
      .filter((v) => v === act || length(sub(v.state.position, act.state.position)) < PHYSICS_RANGE)
      .map((v) => v.state.id)
      .sort();
    if (ids.length < 2) return null;
    const next = ids[(ids.indexOf(act.state.id) + 1) % ids.length];
    this.switchTo(next);
    return next;
  }

  /** Recover the active vessel if it's at rest on Earth (returns true when removed). */
  recoverActive(): boolean {
    const wv = this.active;
    if (!wv || wv.body !== 'earth' || wv.state.situation === 'flying') return false;
    this.vessels.delete(wv.state.id);
    this.activeId = null;
    return true;
  }

  /** After deserialization: recompute derived rails data and resync body-fixed vessels to the current time. */
  restoreAfterLoad() {
    for (const wv of this.vessels.values()) {
      if (wv.mode === 'rails' && wv.orbit) this.predictRailsEvent(wv);
      if ((wv.mode === 'landedRails' || wv.mode === 'prelaunch') && wv.fixed) this.syncFixed(wv, this.ut);
    }
    this.trajectoryCache = null;
  }

  private predictRailsEvent(wv: WorldVessel) {
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
  private unpack(wv: WorldVessel) {
    if (wv.mode === 'rails' && wv.orbit) {
      const s = propagate(wv.orbit, this.ut);
      const bs = this.universe.ephem.getBodyState(wv.body, this.ut);
      wv.state.position = add(bs.position, s.position);
      wv.state.velocity = add(bs.velocity, s.velocity);
    } else if (wv.mode === 'landedRails') {
      this.syncFixed(wv, this.ut);
    } else return;
    wv.mode = 'physics';
    wv.orbit = undefined;
    wv.railsEvent = undefined;
  }

  warpContext(): WarpContext {
    const wv = this.active;
    if (!wv) return { thrusting: false, inAtmosphere: false, landed: true, altitude: 1e9, bodyRadius: 1, atmosphereHeight: 0 };
    const b = this.universe.body(wv.body);
    const alt = length(this.relativeState(wv).position) - b.radius;
    const thrusting = wv.state.telemetry.thrust > 0;
    return {
      thrusting,
      inAtmosphere: !!b.atmosphere && alt < b.atmosphere.height,
      landed: wv.state.situation !== 'flying' || wv.mode === 'prelaunch',
      altitude: alt,
      bodyRadius: b.radius,
      atmosphereHeight: b.atmosphere?.height ?? 0,
    };
  }

  changeWarp(delta: number) {
    const next = stepWarp(this.warp, delta, this.warpContext());
    if (next.mode === 'rails' && next.index > 0 && this.warp.index === 0 && this.warp.mode === 'rails') {
      // Entering rails warp: refuse if the vessel is spinning fast or accelerating (would lose state).
    }
    this.warp = next;
  }

  /** Advance the simulation by `realDt` seconds of wall time with the given control input for the active vessel. */
  tick(realDt: number, input: ControlInput) {
    realDt = Math.min(realDt, 0.25);
    const now = performance.now();
    this.messages = this.messages.filter((m) => m.expires > now);
    this.warp = clampWarp(this.warp, this.warpContext());
    const rate = warpRate(this.warp);

    if (this.warp.mode === 'rails' && rate > 1) {
      for (const wv of this.vessels.values()) this.pack(wv);
      let target = this.ut + realDt * rate;
      // Stop warp at the next maneuver node (minus a margin). Active-vessel events (SOI change, atmosphere,
      // impact) are handled in advanceRails.
      const nextNode = this.nodes.filter((n) => n.time > this.ut).sort((a, b) => a.time - b.time)[0];
      if (nextNode && target > nextNode.time - 30 && this.ut < nextNode.time - 30) {
        target = nextNode.time - 30;
        this.warp = { mode: 'rails', index: 0 };
      }
      this.advanceRails(target);
      return;
    }

    // Physics.
    for (const wv of this.vessels.values()) if (wv === this.active && (wv.mode === 'rails' || wv.mode === 'landedRails')) this.unpack(wv);
    this.acc += realDt * rate;
    let steps = 0;
    let stageEdge = input.stage;
    while (this.acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME * rate) {
      this.physicsStep({ ...input, stage: stageEdge });
      stageEdge = false;
      this.acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME * rate) this.acc = 0;
  }

  /** Advance an unattended world, packing vessels first and processing the normal rails events.
   * Tracking uses this when there is no active vessel (including completely empty worlds).
   */
  advanceRailsTo(ut: number) {
    if (!Number.isFinite(ut) || ut < this.ut) return;
    for (const wv of this.vessels.values()) this.pack(wv);
    this.advanceRails(ut);
  }

  /**
   * Advance all on-rails vessels to `target`, processing rails events in time order. The active vessel goes
   * first and may shorten the frame: at its SOI change (so the next frame re-clamps the warp rate for the new
   * body — at high warp one frame could otherwise also carry it through periapsis or into the surface) and
   * just before atmosphere entry / impact (warp is cancelled). Everything else then advances to that time.
   */
  private advanceRails(target: number) {
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
          wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, pos, vel, ev.time);
          if (isActive) {
            this.message(`Entered ${this.universe.body(wv.body).name}'s sphere of influence`);
            target = ev.time;
          }
          const saveUt = this.ut;
          this.ut = ev.time;
          this.predictRailsEvent(wv);
          this.ut = saveUt;
        } else if (ev.reason === 'horizon' || ev.reason === 'maneuver') {
          // End of the predicted window without an event: predict the next window.
          const saveUt = this.ut;
          this.ut = ev.time;
          this.predictRailsEvent(wv);
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
    this.ut = target;
    for (const wv of this.vessels.values()) this.syncPacked(wv, this.ut);
  }

  /** Update the inertial state of a packed (rails / body-fixed) vessel to time t. */
  private syncPacked(wv: WorldVessel, t: number) {
    if (wv.mode === 'rails' && wv.orbit) {
      const s = propagate(wv.orbit, t);
      const bs = this.universe.ephem.getBodyState(wv.body, t);
      wv.state.position = add(bs.position, s.position);
      wv.state.velocity = add(bs.velocity, s.velocity);
    } else if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') {
      this.syncFixed(wv, t);
    }
  }

  private physicsStep(input: ControlInput) {
    const t = this.ut;
    const active = this.active;
    for (const wv of [...this.vessels.values()]) {
      if (wv.state.destroyed) continue;
      const isActive = wv === active;
      if (!isActive && active) {
        // Packed vessels' states are only refreshed on rails frames; bring them to `t` before the range check
        // (otherwise the check uses a stale heliocentric position, kilometres off after a few seconds).
        // States are expressed at the end of the step, like physics-stepped vessels.
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.syncPacked(wv, t + PHYSICS_DT);
        const d = length(sub(wv.state.position, active.state.position));
        if (d > PHYSICS_RANGE) {
          // Out of the physics bubble: pack (debris in atmosphere is removed).
          const b = this.universe.body(wv.body);
          const alt = length(this.relativeState(wv).position) - b.radius;
          if (b.atmosphere && alt < b.atmosphere.height && wv.state.situation === 'flying') this.vessels.delete(wv.state.id);
          else this.pack(wv);
          continue;
        }
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
      }
      if (wv.mode === 'prelaunch') {
        if (isActive && input.stage) {
          this.syncFixed(wv, t);
          wv.mode = 'physics';
          wv.fixed = undefined;
          this.message('Liftoff!');
        } else {
          // States are expressed at the end of the step (t + dt), like physics-stepped vessels.
          this.syncFixed(wv, t + PHYSICS_DT);
          continue;
        }
      }
      if (wv.mode !== 'physics') continue;
      // Update dominant body (SOI transitions in physics).
      wv.body = this.universe.dominantBody(wv.state.position, t);
      const env = this.universe.createEnvironment(() => wv.body);
      const ctrl = isActive ? input : neutralInput({ sas: 'off' });
      const res = stepVessel(wv.state, ctrl, env, t, PHYSICS_DT);
      for (const nv of res.newVessels) {
        recomputeMassProperties(nv, false);
        this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
      }
      for (const e of res.events) this.handleEvent(e);
      if (wv.state.destroyed) {
        if (isActive) this.message(`${wv.state.name} was destroyed`, 'bad', 8);
        this.vessels.delete(wv.state.id);
      }
    }
    this.ut = t + PHYSICS_DT;
    this.applyPassedNodes();
  }

  private handleEvent(e: VesselEvent) {
    this.onEvent?.(e);
    if (e.vesselId !== this.activeId) return;
    if (e.type === 'flameout') this.message('Flameout!', 'warn', 2);
    if (e.type === 'partDestroyed') {
      const why = e.reason === 'overheat' ? 'overheated and exploded' : 'was destroyed on impact';
      this.message(`A part ${why}`, 'bad', 4);
    }
  }

  /** Stage the active vessel immediately (used when clicking the stage button while warping etc.). */
  stageActive() {
    const wv = this.active;
    if (!wv) return;
    if (wv.mode === 'prelaunch') {
      wv.mode = 'physics';
      wv.fixed = undefined;
      this.message('Liftoff!');
    }
    if (wv.mode !== 'physics') this.unpack(wv);
    const res = activateNextStage(wv.state);
    for (const nv of res.newVessels) this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
    for (const e of res.events) this.handleEvent(e);
  }

  // ---------- Maneuver nodes ----------
  addNode(time: number): ManeuverNode {
    const n: ManeuverNode = { id: this.nodeId++, time, prograde: 0, normal: 0, radial: 0 };
    this.nodes.push(n);
    this.trajectoryCache = null;
    return n;
  }

  removeNode(id: number) {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.trajectoryCache = null;
  }

  private applyPassedNodes() {
    // Nodes are not auto-executed; they are removed once their time has passed by more than the burn window.
    this.nodes = this.nodes.filter((n) => n.time > this.ut - 600);
  }

  /** Patched-conic prediction for the active vessel (cached ~0.25 s of game time / when nodes change). */
  trajectory(): TrajectoryPatch[] {
    const wv = this.active;
    if (!wv || wv.mode === 'prelaunch') return [];
    const key = this.nodes.map((n) => `${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}`).join(',') + wv.body;
    const thrusting = wv.state.telemetry.thrust > 0;
    const maxAge = thrusting ? 0.2 : 2;
    if (this.trajectoryCache && this.trajectoryCache.key === key && Math.abs(this.ut - this.trajectoryCache.time) < maxAge * Math.max(1, warpRate(this.warp))) {
      return this.trajectoryCache.patches;
    }
    const rs = this.relativeState(wv);
    const o = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
    // Horizon: one revolution of the orbit that results after the last node (not the current orbit: a
    // trans-lunar injection from a ~30 min parking orbit leads to a multi-day transfer that must be shown).
    const upcoming = this.nodes.filter((n) => n.time >= this.ut).sort((a, b) => a.time - b.time);
    let after = o;
    for (const n of upcoming) {
      const s = propagate(after, n.time);
      after = stateToElements(after.mu, after.body, s.position, add(s.velocity, maneuverToInertialDv(s, n)), n.time);
    }
    const lastNode = upcoming.length ? upcoming[upcoming.length - 1].time - this.ut : 0;
    const Tafter = period(after);
    const horizon = Math.min(3e9, lastNode + (isFinite(Tafter) ? Tafter * 1.02 : 3e7));
    let patches: TrajectoryPatch[] = [];
    try {
      patches = predictTrajectory({
        ephem: this.universe.ephem,
        bodies: this.universe.bodies,
        initialBody: wv.body,
        state: rs,
        t0: this.ut,
        horizon,
        maxPatches: 6,
        maneuvers: this.nodes,
      });
    } catch {
      patches = [];
    }
    this.trajectoryCache = { time: this.ut, key, patches };
    return patches;
  }

  /** Orbit summary for HUD. */
  orbitSummary(wv: WorldVessel) {
    const b = this.universe.body(wv.body);
    const o = this.orbitOf(wv);
    return {
      orbit: o,
      ap: apoapsisRadius(o) - b.radius,
      pe: periapsisRadius(o) - b.radius,
      timeToAp: timeToApoapsis(o, this.ut),
      timeToPe: timeToPeriapsis(o, this.ut),
    };
  }

  /** Dot helper used by HUD (vertical speed). */
  verticalSpeed(wv: WorldVessel): number {
    const rs = this.relativeState(wv);
    return dot(rs.velocity, normalize(rs.position));
  }

  surfaceVelocity(wv: WorldVessel): Vec3 {
    const rs = this.relativeState(wv);
    return sub(rs.velocity, this.universe.ephem.surfaceVelocity(wv.body, rs.position, this.ut));
  }
}

/** Quaternion from orthonormal basis columns (x, y, z are images of the unit axes). */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return qNormalize(q);
}

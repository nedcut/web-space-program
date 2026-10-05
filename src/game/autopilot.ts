/**
 * Autopilot building blocks.
 *
 * Everything here operates on a `World` and its active vessel through the same public API the flight
 * scene uses (`world.tick(realDt, input)`, `world.warp`, `world.nodes`), so the controllers can later be
 * wired to an in-game "autopilot" button unchanged.
 *
 * Two kinds of pieces:
 *  - Planners (pure functions of the world state): `planCircularization`, `planTransferToBody`,
 *    `planCourseCorrection`. They return/add maneuver nodes; they never advance time.
 *  - Controllers (`Autopilot`): small state machines. Each frame `update(world)` returns the
 *    `ControlInput` to fly with, and optionally `coastUntil` — a UT before which the controller has nothing
 *    to do, so the driver may use rails time warp. `runAutopilot` is a reference driver used by tests.
 *
 * Steering always goes through SAS 'maneuver' mode with an explicit inertial direction.
 */
export { nelderMead } from '../util/nelderMead';
export { planTransferToBody, planCourseCorrection } from './planning/transfers';
export type { TransferPlan, TransferOptions } from './planning/transfers';
import type { World, WorldVessel } from './world';
import { PHYSICS_DT } from './world';
import { RAILS_WARP } from './timewarp';
import type { ControlInput, VesselState } from '../sim/vessel/runtime';
import type { EngineModule } from '../sim/vessel/types';
import { neutralInput, G0 } from '../sim/vessel';
import type { ManeuverNode, Orbit } from '../sim/orbit/api';
import {
  propagate,
  period,
  periapsisRadius,
  apoapsisRadius,
  timeToApoapsis,
  timeToPeriapsis,
  maneuverToInertialDv,
  inertialDvToManeuver,
  burnTimeEstimate,
} from '../sim/orbit';
import { add, sub, scale, length, normalize, dot, cross, v3, type Vec3 } from '../util/vec3';
import { qRotate } from '../util/quat';

// ---------------------------------------------------------------------------------------------------
// Common types & helpers
// ---------------------------------------------------------------------------------------------------

export interface AutopilotStep {
  input: ControlInput;
  /** Nothing to do before this UT: the driver may time-warp (on rails) up to it. */
  coastUntil?: number;
}

export interface Autopilot {
  readonly name: string;
  /** Short human-readable phase description (for HUD / logs). */
  status: string;
  done: boolean;
  /** Set when the controller gives up (e.g. out of fuel); `done` stays false. */
  error?: string;
  update(world: World): AutopilotStep;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const NOSE = v3(0, 1, 0);

/** Vessel nose direction (inertial unit vector). */
export const noseDirection = (v: VesselState): Vec3 => qRotate(v.orientation, NOSE);

/** Angle (rad) between two directions. */
const angleBetween = (a: Vec3, b: Vec3) => Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));

/** Thrust available from currently ignited (not flamed-out) engines, vacuum rating. */
export interface Propulsion {
  /** N */
  thrust: number;
  /** kg/s at full throttle */
  massFlow: number;
  /** effective vacuum Isp, s */
  isp: number;
  /** Highest minimum-throttle among the running engines (0..1). */
  minThrottle: number;
  /** Largest spool time constant among the running engines, s. */
  spoolTime: number;
}

export function propulsion(v: VesselState): Propulsion {
  let thrust = 0, massFlow = 0, minThrottle = 0, spoolTime = 0;
  for (const p of v.parts) {
    if (!p.engine || !p.engine.ignited || p.engine.flamedOut) continue;
    const m = p.def.modules[p.engine.moduleIndex] as EngineModule;
    thrust += m.maxThrustVac;
    massFlow += m.maxThrustVac / (m.ispVac * G0);
    minThrottle = Math.max(minThrottle, m.throttleable ? m.minThrottle : 1);
    spoolTime = Math.max(spoolTime, m.spoolTime);
  }
  return { thrust, massFlow, isp: massFlow > 0 ? thrust / (massFlow * G0) : 0, minThrottle, spoolTime };
}

/**
 * Convert a desired fraction of full thrust into the throttle command, accounting for the engines'
 * minimum throttle (command c maps to min + (1 - min)·c). Fractions below the minimum give the minimum.
 */
export function throttleForFraction(fraction: number, minThrottle: number): number {
  if (fraction <= 0) return 0;
  if (minThrottle >= 1) return 1;
  return clamp((fraction - minThrottle) / (1 - minThrottle), 1e-3, 1);
}

/** Local frame of the active vessel relative to its reference body. */
export function localFrame(world: World, wv: WorldVessel) {
  const u = world.universe;
  const body = u.body(wv.body);
  const rs = world.relativeState(wv);
  const r = length(rs.position);
  const up = scale(rs.position, 1 / r);
  const pole = qRotate(u.ephem.bodyRotation(wv.body, world.ut), v3(0, 0, 1));
  let east = cross(pole, up);
  east = length(east) > 1e-9 ? normalize(east) : normalize(cross(v3(1, 0, 0), up));
  const surfVel = sub(rs.velocity, u.ephem.surfaceVelocity(wv.body, rs.position, world.ut));
  return { body, rs, r, up, east, altitude: r - body.radius, surfVel, g: body.gm / (r * r) };
}

/** Height of the vessel's lowest point above the terrain directly below (radar altitude). */
export function radarAltitude(world: World, wv: WorldVessel): number {
  const info = world.universe.surfaceInfo(wv.body, wv.state.position, world.ut);
  return info.heightAboveTerrain - world.bottomOffset(wv.state);
}

/**
 * Stages automatically when the engines starve while thrust is commanded (burnout → decouple →
 * ignite next). Never fires stages numbered below `minStage` (e.g. keep the crew pod attached).
 */
export class AutoStager {
  private starved = 0;
  private cooldown = 0;
  constructor(public minStage = 0) {}
  update(v: VesselState, throttle: number, dt: number): boolean {
    this.cooldown -= dt;
    this.starved = throttle > 0 && v.telemetry.thrust < 1 ? this.starved + dt : 0;
    if (this.starved > 0.5 && this.cooldown <= 0 && v.nextStage >= this.minStage) {
      this.cooldown = 1;
      this.starved = 0;
      return true;
    }
    return false;
  }
}

const steer = (dir: Vec3, throttle: number, extra: Partial<ControlInput> = {}): ControlInput =>
  neutralInput({ sas: 'maneuver', maneuverDirection: dir, throttle, ...extra });

// ---------------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------------

export interface RunOptions {
  /** Max simulated seconds before giving up. */
  maxTime: number;
  /** Wall-clock step for physics ticks (default one physics step). */
  dt?: number;
  /** Allow rails time warp while the controller coasts (default true). */
  warp?: boolean;
  /** Called after every tick. */
  onTick?: (world: World) => void;
}

/**
 * Advance the world toward `until` with the largest rails warp that cannot overshoot it in one frame.
 * Returns false (did nothing) when the remaining time is too short to be worth warping.
 */
export function warpToward(world: World, until: number, input: ControlInput): boolean {
  const remaining = until - world.ut;
  const FRAME = 0.25;
  let idx = 0;
  for (let i = 1; i < RAILS_WARP.length; i++) if (RAILS_WARP[i] * FRAME <= remaining) idx = i;
  if (idx === 0) return false;
  world.warp = { mode: 'rails', index: idx };
  world.tick(Math.min(FRAME, remaining / RAILS_WARP[idx]), input);
  return true;
}

/** Reference driver: run a controller to completion (or failure / timeout). Returns true when done. */
export function runAutopilot(world: World, ap: Autopilot, opts: RunOptions): boolean {
  const dt = opts.dt ?? PHYSICS_DT;
  const tEnd = world.ut + opts.maxTime;
  while (!ap.done && !ap.error && world.ut < tEnd) {
    const wv = world.active;
    if (!wv || wv.state.destroyed) {
      ap.error = 'active vessel lost';
      break;
    }
    const step = ap.update(world);
    if (ap.done || ap.error) break;
    const warped = opts.warp !== false && step.coastUntil !== undefined && warpToward(world, step.coastUntil, step.input);
    if (!warped) {
      world.warp = { mode: 'rails', index: 0 };
      world.tick(dt, step.input);
    }
    opts.onTick?.(world);
  }
  if (!ap.done && !ap.error) ap.error = `timeout in phase "${ap.status}"`;
  return ap.done;
}

/** Rails-warp (coasting, engines off) until `t`, or until the active vessel changes SOI if `stopOnSoi`. */
export function coastUntil(world: World, t: number, opts: { stopOnSoi?: boolean } = {}): void {
  const wv = world.active!;
  const body0 = wv.body;
  const input = neutralInput({ sas: 'stabilityAssist' });
  let guard = 0;
  while (world.ut < t - 1e-6 && guard++ < 1_000_000) {
    if (opts.stopOnSoi && wv.body !== body0) return;
    if (!warpToward(world, t, input)) {
      world.warp = { mode: 'rails', index: 0 };
      world.tick(Math.min(PHYSICS_DT, t - world.ut), input);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Ascent
// ---------------------------------------------------------------------------------------------------

export interface AscentOptions {
  /** Target apoapsis altitude above the datum, m. */
  targetApoapsis: number;
  /** Altitude (above the launch point) where the pitch program starts, m. */
  turnStart?: number;
  /** Altitude (above the launch point) where the vessel is pitched fully horizontal, m. */
  turnEnd?: number;
  /** Shape exponent of the pitch program (smaller = earlier pitch-over). */
  turnExponent?: number;
  /** Do not auto-stage below this stage number. */
  minStage?: number;
}

/**
 * Gravity-turn ascent to a target apoapsis. Fires the first stage from the pad, steers a pitch program due
 * east, auto-stages, cuts the engines at the target apoapsis, keeps it topped up through the atmosphere and
 * finishes once out of the atmosphere (circularize afterwards with `planCircularization` + `executeNode`).
 * Works from the ground of airless bodies too (no staging needed when an engine is already lit).
 */
export function ascentGuidance(world: World, opts: AscentOptions): Autopilot {
  const stager = new AutoStager(opts.minStage ?? 0);
  let started = false;
  let launchAlt = 0;
  let lastUt = world.ut;
  const ap: Autopilot = {
    name: 'ascent',
    status: 'liftoff',
    done: false,
    update(w) {
      const wv = w.active!;
      const f = localFrame(w, wv);
      const atmo = f.body.atmosphere?.height ?? 0;
      const dt = Math.max(0, w.ut - lastUt);
      lastUt = w.ut;
      if (!started) {
        started = true;
        launchAlt = f.altitude;
        const needStage = wv.mode === 'prelaunch' || propulsion(wv.state).thrust === 0;
        return { input: neutralInput({ sas: 'stabilityAssist', throttle: 1, stage: needStage, gear: atmo > 0 ? undefined : false }) };
      }
      const turnStart = opts.turnStart ?? (atmo > 0 ? 500 : 150);
      const turnEnd = opts.turnEnd ?? (atmo > 0 ? atmo * 0.85 : opts.targetApoapsis * 0.35);
      const exponent = opts.turnExponent ?? (atmo > 0 ? 0.55 : 0.5);
      const o = w.orbitOf(wv);
      const apAlt = apoapsisRadius(o) - f.body.radius;
      let throttle = 1;
      let dir = f.up;
      if (ap.status === 'liftoff' || ap.status === 'ascent') {
        ap.status = 'ascent';
        const x = clamp((f.altitude - launchAlt - turnStart) / Math.max(1, turnEnd - turnStart), 0, 1);
        const pitch = (Math.PI / 2) * Math.pow(x, exponent);
        dir = normalize(add(scale(f.up, Math.cos(pitch)), scale(f.east, Math.sin(pitch))));
        // Near the target, throttle back so the apoapsis is hit accurately.
        const prop = propulsion(wv.state);
        const aMax = prop.thrust / wv.state.mass;
        if (atmo === 0 && aMax > 0) {
          const dvLeft = Math.max(0, opts.targetApoapsis - apAlt) * f.g / Math.max(1, length(f.rs.velocity));
          throttle = throttleForFraction(clamp(dvLeft / (aMax * 2) + 0.05, 0, 1), prop.minThrottle);
        }
        // Larger worlds need a sustained insertion burn: a ballistic hop followed by a
        // multi-km/s burn at apoapsis falls back into the atmosphere with low-TWR upper stages.
        const insertion = w.universe.preset !== 'standard';
        const insertionStart = atmo > 0 ? atmo * 0.15 : Math.min(1000, opts.targetApoapsis * 0.05);
        if (insertion && aMax > 0 && f.altitude - launchAlt > insertionStart) {
          const vr = dot(f.rs.velocity, f.up);
          const vt = length(sub(f.rs.velocity, scale(f.up, vr)));
          const radius = length(f.rs.position);
          const circular = Math.sqrt(f.body.gm / radius);
          const desiredClimb = clamp((opts.targetApoapsis - f.altitude) / 100, -100, 350);
          const radialAcc = f.g - vt * vt / radius + (desiredClimb - vr) / 20;
          const horizontalAcc = Math.max(0, (0.99 * circular - vt) / 25);
          const vertical = clamp(radialAcc, -0.5 * aMax, 0.95 * aMax);
          const horizontal = Math.min(horizontalAcc, Math.sqrt(Math.max(0, aMax * aMax - radialAcc * radialAcc)));
          const desiredAcc = add(scale(f.up, vertical), scale(f.east, horizontal));
          dir = normalize(desiredAcc);
          throttle = throttleForFraction(clamp(length(desiredAcc) / Math.max(0.1, aMax), 0, 1), prop.minThrottle);
          if (vt > 0.97 * circular && apAlt >= opts.targetApoapsis) ap.status = 'coast';
        } else if (!insertion && apAlt >= opts.targetApoapsis) ap.status = 'coast';
      }
      if (ap.status === 'coast') {
        dir = normalize(f.rs.velocity);
        throttle = 0;
        // Re-boost while drag eats the apoapsis.
        if (f.altitude < atmo && apAlt < opts.targetApoapsis - 200) throttle = throttleForFraction(0.2, propulsion(wv.state).minThrottle);
        if (f.altitude >= atmo) ap.done = true;
      }
      const stage = stager.update(wv.state, throttle, dt);
      return { input: steer(dir, throttle, { stage }) };
    },
  };
  return ap;
}

// ---------------------------------------------------------------------------------------------------
// Maneuver nodes
// ---------------------------------------------------------------------------------------------------

/** Add a node to the world from an inertial (body-relative) delta-v applied at time `t` on `orbit`. */
export function addNodeFromInertialDv(world: World, orbit: Orbit, t: number, dv: Vec3): ManeuverNode {
  const s = propagate(orbit, t);
  const c = inertialDvToManeuver(s, dv);
  const node = world.addNode(t);
  node.prograde = c.prograde;
  node.normal = c.normal;
  node.radial = c.radial;
  return node;
}

/** Plan a node at the next apoapsis/periapsis that makes the orbit circular at that radius. */
export function planCircularization(world: World, at: 'apoapsis' | 'periapsis'): ManeuverNode {
  const wv = world.active!;
  const o = world.orbitOf(wv);
  const dtTo = at === 'apoapsis' ? timeToApoapsis(o, world.ut) : timeToPeriapsis(o, world.ut);
  if (!isFinite(dtTo)) throw new Error(`No ${at} ahead on the current orbit`);
  const t = world.ut + dtTo;
  const s = propagate(o, t);
  const r = length(s.position);
  const h = normalize(cross(s.position, s.velocity));
  const horiz = normalize(cross(h, s.position));
  const vCirc = scale(horiz, Math.sqrt(o.mu / r));
  return addNodeFromInertialDv(world, o, t, sub(vCirc, s.velocity));
}

/** Lowers/raises the periapsis by burning at the next apoapsis (prograde/retrograde only). */
export function planPeriapsisChange(world: World, periapsisAltitude: number): ManeuverNode {
  const wv = world.active!;
  const o = world.orbitOf(wv);
  const R = world.universe.body(wv.body).radius;
  const t = world.ut + timeToApoapsis(o, world.ut);
  const s = propagate(o, t);
  const ra = length(s.position);
  const rp = R + periapsisAltitude;
  const vNew = Math.sqrt(o.mu * (2 / ra - 2 / (ra + rp)));
  const node = world.addNode(t);
  node.prograde = vNew - length(s.velocity);
  return node;
}

export interface ExecuteNodeOptions {
  /** Do not auto-stage below this stage number. */
  minStage?: number;
  /** Seconds before burn start to stop warping and point the vessel. */
  alignLead?: number;
  /** Final-phase time constant: throttle ramps down once the remaining dv is below aMax·tail. */
  tail?: number;
  /** Remove the node from the world when finished (default true). */
  removeNode?: boolean;
  /**
   * For mostly prograde/retrograde burns, end the burn when the planned orbital energy (semi-major axis) is
   * reached instead of when the vector dv is used up. Finite burns in a fixed direction lose a little
   * efficiency, and for near-escape burns (e.g. trans-lunar injection) a 1% dv shortfall moves the apoapsis by
   * thousands of km; matching energy keeps the transfer timing right. Default true.
   */
  matchEnergy?: boolean;
}

/**
 * Fly a maneuver node: coast (warpable) until `alignLead` before the burn, point along the burn vector,
 * then burn centered on the node time. The remaining delta-v is tracked by integrating the vessel's measured
 * proper acceleration, so the burn ends on the planned dv regardless of thrust, staging or mass changes; the
 * throttle tapers over the last second and engine spool-down is anticipated.
 */
export function executeNode(world: World, node: ManeuverNode, opts: ExecuteNodeOptions = {}): Autopilot & { dvUsed(): number; remaining(): number } {
  const stager = new AutoStager(opts.minStage ?? 0);
  const alignLead = opts.alignLead ?? 40;
  const tail = opts.tail ?? 1.5;
  let initialised = false;
  let aimed = false;
  let dvRem = v3();
  let dvDir = v3();
  let burnStart = node.time;
  let lastUt = world.ut;
  let used = 0;
  let targetEnergy = NaN;
  let dv0 = 0;
  let steerDir = v3(0, 1, 0);
  let stalled = 0;
  let starved = 0;
  /** Burn vector from the vessel's *current* orbit (it may have drifted since planning). */
  const aim = (w: World) => {
    const wv = w.active!;
    const o = w.orbitOf(wv);
    const sNode = propagate(o, node.time);
    dvRem = maneuverToInertialDv(sNode, node);
    const vAfter = add(sNode.velocity, dvRem);
    targetEnergy = dot(vAfter, vAfter) / 2 - o.mu / length(sNode.position);
    dvDir = length(dvRem) > 0 ? normalize(dvRem) : noseDirection(wv.state);
    steerDir = dvDir;
    dv0 = length(dvRem);
    const p = propulsion(wv.state);
    const dv = length(dvRem);
    const bt = p.thrust > 0 ? burnTimeEstimate(dv, p.thrust, wv.state.mass, p.isp) : 0;
    burnStart = node.time - bt / 2;
  };
  const finish = (w: World) => {
    ap.done = true;
    ap.status = 'done';
    if (opts.removeNode !== false) w.removeNode(node.id);
  };
  const ap: Autopilot & { dvUsed: () => number; remaining: () => number } = {
    name: 'node',
    status: 'coast',
    done: false,
    dvUsed: () => used,
    remaining: () => length(dvRem),
    update(w) {
      const wv = w.active!;
      const v = wv.state;
      if (!initialised) {
        initialised = true;
        aim(w);
        lastUt = w.ut;
        if (length(dvRem) < 0.05) {
          finish(w);
          return { input: neutralInput({ sas: 'stabilityAssist' }) };
        }
      }
      const dt = Math.max(0, w.ut - lastUt);
      lastUt = w.ut;
      if ((ap.status === 'burn' || ap.status === 'cutoff') && dt > 0 && wv.mode === 'physics') {
        // Thrust-induced acceleration since the last update (gravity excluded).
        const a = v.telemetry.properAcceleration;
        dvRem = sub(dvRem, scale(a, dt));
        used += length(a) * dt;
      }
      // Steer along the remaining dv vector; once it is nearly used up its direction is just noise, so keep
      // the last good direction (the energy criterion may still ask for a few m/s of finite-burn losses).
      if (length(dvRem) > Math.max(0.5, 0.03 * dv0)) steerDir = normalize(dvRem);
      const dirRem = steerDir;
      if (ap.status === 'coast' || ap.status === 'align') {
        if (w.ut < burnStart - alignLead) {
          ap.status = 'coast';
          return { input: steer(dvDir, 0), coastUntil: burnStart - alignLead };
        }
        if (!aimed) {
          aimed = true;
          aim(w);
        }
        ap.status = 'align';
        if (w.ut < burnStart) return { input: steer(dvDir, 0) };
        ap.status = 'burn';
      }
      if (ap.status === 'cutoff') {
        // Wait for the engines to spool down so the resulting orbit is final.
        if (v.telemetry.thrust <= 0) finish(w);
        return { input: steer(dirRem, 0) };
      }
      // Burn.
      let along = dot(dvRem, dvDir);
      if (opts.matchEnergy !== false) {
        const rs = w.relativeState(wv);
        const mu = w.universe.body(wv.body).gm;
        const vAlong = dot(rs.velocity, dvDir);
        if (Math.abs(vAlong) > 0.7 * length(rs.velocity) && isFinite(targetEnergy)) {
          const energy = dot(rs.velocity, rs.velocity) / 2 - mu / length(rs.position);
          along = (targetEnergy - energy) / vAlong;
        }
      }
      const p = propulsion(v);
      const aMax = p.thrust / v.mass;
      // Stop instead of integrating empty burns forever when the allowed stages are exhausted.
      starved = aMax === 0 && v.nextStage < (opts.minStage ?? 0) ? starved + dt : 0;
      if (starved > 2) ap.error = 'no propulsion remains in the allowed stages';
      // Delta-v still to come from spool-down after a cut.
      let spoolTail = 0;
      for (const part of v.parts) {
        if (!part.engine?.ignited) continue;
        const m = part.def.modules[part.engine.moduleIndex] as EngineModule;
        spoolTail += (part.engine.thrust * m.spoolTime) / v.mass;
      }
      if (along <= Math.max(0.02, spoolTail)) {
        ap.status = 'cutoff';
        return { input: steer(dirRem, 0) };
      }
      const err = angleBetween(noseDirection(v), dirRem);
      let fraction = aMax > 0 ? clamp(along / (aMax * tail), 0, 1) : 1;
      if (err > (15 * Math.PI) / 180) fraction = 0;
      else if (err > (4 * Math.PI) / 180) fraction *= 0.25;
      stalled = fraction === 0 ? stalled + dt : 0;
      if (stalled > 120) ap.error = 'unable to point along the burn vector';
      const throttle = throttleForFraction(fraction, p.minThrottle || 0);
      const stage = stager.update(v, fraction > 0 ? 1 : 0, dt);
      return { input: steer(dirRem, aMax > 0 ? throttle : 1, { stage }) };
    },
  };
  return ap;
}

// ---------------------------------------------------------------------------------------------------
// Powered landing
// ---------------------------------------------------------------------------------------------------

export interface BrakingPrediction {
  /** Height of the vessel bottom above terrain where the surface-relative speed reaches ~0 (negative = crash). */
  stopHeight: number;
  /** Seconds until stop. */
  time: number;
  impact: boolean;
}

/**
 * Predict a constant-throttle, surface-retrograde braking burn starting now (point-mass, central gravity,
 * body rotation, falling mass). Used by the landing controller to time and throttle its suicide burn.
 */
export function predictBraking(world: World, wv: WorldVessel, fraction: number, maxTime = 900): BrakingPrediction {
  const u = world.universe;
  const body = u.body(wv.body);
  const terrain = u.terrain(wv.body);
  const prop = propulsion(wv.state);
  const bottom = world.bottomOffset(wv.state);
  const rs = world.relativeState(wv);
  let r = rs.position;
  let v = rs.velocity;
  let m = wv.state.mass;
  const F = prop.thrust * fraction;
  const mdot = prop.massFlow * fraction;
  const ceiling = body.radius + terrain.maxHeight + bottom;
  const heightAt = (pos: Vec3, t: number) => {
    const f = normalize(u.ephem.toBodyFixed(wv.body, pos, t));
    const h = terrain.heightAt(f.x, f.y, f.z);
    return length(pos) - body.radius - Math.max(h, terrain.ocean ? (terrain.liquid?.level ?? 0) : -Infinity) - bottom;
  };
  let t = 0;
  let lastCheck = -Infinity;
  while (t < maxTime) {
    const vs = sub(v, u.ephem.surfaceVelocity(wv.body, r, world.ut));
    const speed = length(vs);
    const rr = length(r);
    const aT = F / Math.max(1, m);
    if (speed < 0.5 || (aT > 0 && dot(vs, r) / rr > 0 && speed < 5)) break;
    const dt = clamp(speed / Math.max(aT, 0.5) / 40, 0.02, 1);
    const g = scale(r, -body.gm / (rr * rr * rr));
    const a = add(g, scale(vs, -aT / speed));
    v = add(v, scale(a, dt));
    r = add(r, scale(v, dt));
    m = Math.max(1, m - mdot * dt);
    t += dt;
    if (length(r) < ceiling && t - lastCheck > 0.5) {
      lastCheck = t;
      const h = heightAt(r, world.ut + t);
      if (h < 0) return { stopHeight: -length(sub(v, u.ephem.surfaceVelocity(wv.body, r, world.ut))) - 1, time: t, impact: true };
    }
  }
  return { stopHeight: heightAt(r, world.ut + t), time: t, impact: false };
}

/** Tangent basis at a body-fixed unit direction. */
function tangentBasis(u: Vec3): [Vec3, Vec3] {
  const t1 = normalize(Math.abs(u.z) < 0.9 ? cross(v3(0, 0, 1), u) : cross(v3(1, 0, 0), u));
  return [t1, cross(u, t1)];
}

/** Offset a body-fixed unit direction by (x, y) metres along its tangent basis on a sphere of radius R. */
function offsetDir(u: Vec3, t: [Vec3, Vec3], x: number, y: number, R: number): Vec3 {
  return normalize(add(u, add(scale(t[0], x / R), scale(t[1], y / R))));
}

/**
 * Worst terrain slope (rad) over a lander-sized footprint around a body-fixed unit direction: height gradients
 * at two baselines, at the centre and four points `footprint` metres out.
 */
export function terrainSlope(world: World, bodyId: string, dirFixed: Vec3, footprint = 2): number {
  const body = world.universe.body(bodyId);
  const terrain = world.universe.terrain(bodyId);
  const R = body.radius;
  const h = (d: Vec3) => terrain.heightAt(d.x, d.y, d.z);
  const t = tangentBasis(dirFixed);
  let worst = 0;
  for (const [cx, cy] of [[0, 0], [footprint, 0], [-footprint, 0], [0, footprint], [0, -footprint]]) {
    const c = offsetDir(dirFixed, t, cx, cy, R);
    const tc = tangentBasis(c);
    for (const d of [1.5, 4]) {
      const gx = (h(offsetDir(c, tc, d, 0, R)) - h(offsetDir(c, tc, -d, 0, R))) / (2 * d);
      const gy = (h(offsetDir(c, tc, 0, d, R)) - h(offsetDir(c, tc, 0, -d, R))) / (2 * d);
      worst = Math.max(worst, Math.atan(Math.hypot(gx, gy)));
    }
  }
  return worst;
}

/**
 * Nearest spot (body-fixed unit direction) within `radius` metres whose footprint slope is below `maxSlope`,
 * searched on a polar grid outward from `dirFixed`. Returns null if none qualifies.
 */
export function findLandingSite(world: World, bodyId: string, dirFixed: Vec3, maxSlope: number, radius = 400, step = 20): Vec3 | null {
  if (terrainSlope(world, bodyId, dirFixed) <= maxSlope) return dirFixed;
  const R = world.universe.body(bodyId).radius;
  const t = tangentBasis(dirFixed);
  for (let r = step; r <= radius; r += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
    let best: { d: Vec3; slope: number } | null = null;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const d = offsetDir(dirFixed, t, r * Math.cos(a), r * Math.sin(a), R);
      const slope = terrainSlope(world, bodyId, d);
      if (slope <= maxSlope && (!best || slope < best.slope)) best = { d, slope };
    }
    if (best) return best.d;
  }
  return null;
}

export interface LandingOptions {
  /** Periapsis altitude for the deorbit burn (default -4% of the body radius: a steep-ish descent). */
  deorbitPeriapsis?: number;
  /** Height above terrain at which braking aims to stop, m (default 60, raised for large craft). */
  stopHeight?: number;
  /** Final touchdown speed, m/s (default 1.5). */
  touchdownSpeed?: number;
  /** Do not auto-stage below this stage number. */
  minStage?: number;
  /** Steepest acceptable ground slope at touchdown, rad (default 8°); steeper spots trigger a short divert. */
  maxSlope?: number;
  /** How far the terminal phase may divert to find acceptable ground, m (default 400). */
  divertRadius?: number;
}

/**
 * Powered landing on an airless body from orbit:
 *  1. deorbit — burn retrograde until the periapsis is below the surface;
 *  2. coast — (warpable) until the braking burn is near, then predict the stop point each frame;
 *  3. brake — "suicide burn": throttle chosen by bisection so the predicted stop point (surface-retrograde
 *     constant-throttle burn) sits `stopHeight` above the terrain under it;
 *  4. terminal — pick the nearest spot with a gentle enough slope (divert if needed), then a velocity-tracking
 *     descent: fly over the site, sink at a rate proportional to radar altitude down to `touchdownSpeed`;
 *  5. landed — engine off once the legs carry the vessel and it has settled.
 * `touchdownSpeed()` reports the surface-relative speed at first ground contact.
 */
/** Throttle fraction the braking burn is planned at (the rest is margin). */
const PLANNING_THROTTLE = 0.75;

export function landingController(world: World, opts: LandingOptions = {}): Autopilot & { touchdown: { speed: number; time: number } | null } {
  const stager = new AutoStager(opts.minStage ?? 0);
  // Tall craft need clearance to rotate upright after cancelling orbital velocity.
  const craftRadius = world.active?.state.cache.boundingRadius ?? 0;
  const stopTarget = opts.stopHeight ?? (craftRadius > 8 ? 30 * craftRadius : 60);
  const vTouch = opts.touchdownSpeed ?? 1.5;
  let lastUt = world.ut;
  let gateTime = -Infinity;
  let nextCoastSolve = -Infinity;
  let settled = 0;
  let lastSolve = -Infinity;
  let brakeFraction = 1;
  let lastFlyingSpeed = 0;
  let site: Vec3 | null = null;
  const maxSlope = opts.maxSlope ?? (8 * Math.PI) / 180;
  const ap: Autopilot & { touchdown: { speed: number; time: number } | null } = {
    name: 'landing',
    status: 'deorbit',
    done: false,
    touchdown: null,
    update(w) {
      const wv = w.active!;
      const v = wv.state;
      const dt = Math.max(0, w.ut - lastUt);
      lastUt = w.ut;
      const f = localFrame(w, wv);
      const body = f.body;
      const terrain = w.universe.terrain(wv.body);
      const o = w.orbitOf(wv);
      const prop = propulsion(v);
      const aMax = prop.thrust / v.mass;
      const gearDown = f.altitude < terrain.maxHeight + 8000;
      const input = (dir: Vec3, throttle: number) => {
        const stage = stager.update(v, throttle, dt);
        return { input: steer(dir, throttle, { stage, gear: gearDown ? true : undefined }) };
      };

      if (ap.status === 'deorbit') {
        const peTarget = opts.deorbitPeriapsis ?? -0.04 * body.radius;
        const pe = periapsisRadius(o) - body.radius;
        const retro = scale(normalize(f.rs.velocity), -1);
        if (pe > peTarget) {
          const err = angleBetween(noseDirection(v), retro);
          const frac = err < 0.05 ? clamp((pe - peTarget) / 2000, 0.05, 1) : 0;
          return input(retro, throttleForFraction(frac, prop.minThrottle));
        }
        ap.status = 'coast';
        // Gate: when the descending trajectory crosses this radius, start predicting the braking burn.
        const gateR = body.radius + terrain.maxHeight + Math.max(8000, 0.06 * body.radius);
        gateTime = w.ut;
        if (length(f.rs.position) > gateR) {
          for (let t = w.ut; t < w.ut + (isFinite(period(o)) ? period(o) : 1e5); t += 5) {
            if (length(propagate(o, t).position) <= gateR) { gateTime = t; break; }
          }
        }
      }
      if (ap.status === 'coast') {
        const retro = scale(normalize(f.surfVel), -1);
        if (w.ut < gateTime - 30) return { ...input(retro, 0), coastUntil: gateTime - 30 };
        // Start braking when a burn at the planning throttle would only just stop in time; the remaining
        // throttle range is the margin for terrain surprises.
        // Re-solving a minutes-long burn at 50 Hz dominates full-size Moon missions.
        // Sample at 2 Hz, with a full sample interval of vertical clearance as margin.
        if (w.ut < nextCoastSolve) return input(retro, 0);
        nextCoastSolve = w.ut + 0.5;
        const pred = predictBraking(w, wv, PLANNING_THROTTLE);
        if (!pred.impact && pred.stopHeight > stopTarget + Math.max(0.1 * length(f.surfVel), 0.6 * Math.abs(dot(f.surfVel, f.up)))) return input(retro, 0);
        ap.status = 'brake';
      }
      if (ap.status === 'brake') {
        const retro = scale(normalize(f.surfVel), -1);
        const radar = radarAltitude(w, wv);
        const speed = length(f.surfVel);
        if (speed < 15 || radar < 80) ap.status = 'terminal';
        else {
          if (w.ut - lastSolve >= 0.1) {
            lastSolve = w.ut;
            // Lowest throttle whose predicted stop point is at least stopTarget above the terrain.
            let lo = 0.05, hi = 1;
            if (predictBraking(w, wv, hi).stopHeight < stopTarget) lo = hi;
            else
              for (let k = 0; k < 8; k++) {
                const mid = (lo + hi) / 2;
                if (predictBraking(w, wv, mid).stopHeight >= stopTarget) hi = mid;
                else lo = mid;
              }
            brakeFraction = Math.max(lo, hi);
          }
          const err = angleBetween(noseDirection(v), retro);
          return input(retro, err < 0.3 ? throttleForFraction(brakeFraction, prop.minThrottle) : 0);
        }
      }
      if (ap.status === 'terminal') {
        if (v.situation !== 'flying') {
          if (!ap.touchdown) ap.touchdown = { speed: lastFlyingSpeed, time: w.ut };
          ap.status = 'landed';
        } else {
          lastFlyingSpeed = length(f.surfVel);
          const u = w.universe;
          const info = u.surfaceInfo(wv.body, v.position, w.ut);
          if (!site) site = findLandingSite(w, wv.body, info.fixedDir, maxSlope, opts.divertRadius ?? 400) ?? info.fixedDir;
          // Horizontal offset to the chosen site (inertial, tangent plane).
          const siteH = terrain.heightAt(site.x, site.y, site.z);
          const sitePos = u.ephem.fromBodyFixed(wv.body, scale(site, body.radius + siteH), w.ut);
          const toSite = sub(sitePos, f.rs.position);
          const eHor = sub(toSite, scale(f.up, dot(toSite, f.up)));
          const dist = length(eHor);
          const radar = radarAltitude(w, wv);
          const vVert = dot(f.surfVel, f.up);
          const vHor = sub(f.surfVel, scale(f.up, vVert));
          const hSpeed = length(vHor);
          // Velocity tracking: fly over the site, sink at a rate proportional to radar altitude; while still
          // translating (or sliding sideways) near the ground, hold ~30 m.
          // A tall stack rotates more slowly; avoid chasing the site faster than attitude can follow.
          const response = craftRadius > 8 ? 3 : 1;
          const vHorDes = dist > 0.5 ? scale(normalize(eHor), Math.min(0.25 * dist, 8) / response) : v3();
          let vDes = -clamp(0.2 * radar, vTouch, 25);
          if (dist > 4) vDes = clamp(0.5 * (30 - radar), -10, 3);
          else if (hSpeed > 1 && radar < 40) vDes = Math.max(vDes, -vTouch * Math.max(0, 1 - (hSpeed - 1) / 3));
          const aUp = clamp(f.g + (2.0 / response) * (vDes - vVert), 0, 0.95 * aMax);
          // Horizontal braking gets whatever thrust is left, within a tilt limit (tighter near the ground).
          const tilt = ((radar < 10 ? 15 : 45) * Math.PI) / 180;
          const horCap = Math.min(Math.sqrt(Math.max(0, (0.95 * aMax) ** 2 - aUp * aUp)), Math.max(aUp, 0.5 * f.g) * Math.tan(tilt));
          let aHor = scale(sub(vHorDes, vHor), 1 / response);
          if (length(aHor) > horCap) aHor = scale(normalize(aHor), horCap);
          const aDes = add(scale(f.up, aUp), aHor);
          // Thrust only along the part of the desired acceleration the nose actually points at (SAS lags).
          const frac = aMax > 0 ? Math.max(0, dot(aDes, noseDirection(v))) / aMax : 0;
          // Point within the tilt cone even when no vertical thrust is wanted right now, so the engine is
          // never facing sideways when it is needed again.
          const dir = normalize(add(scale(f.up, Math.max(aUp, 0.5 * f.g)), aHor));
          // A high-thrust engine's minimum setting can exceed lunar hover thrust.
          // Pulse that minimum rather than commanding it continuously and climbing away.
          const demand = clamp(frac, 0, 1);
          const pulse = demand > 0 && demand < prop.minThrottle;
          const on = !pulse || (w.ut % 0.25) < 0.25 * demand / prop.minThrottle;
          return input(dir, on ? throttleForFraction(demand, prop.minThrottle) : 0);
        }
      }
      if (ap.status === 'landed') {
        settled = length(f.surfVel) < 0.3 && v.situation !== 'flying' ? settled + dt : 0;
        if (settled > 3) {
          ap.done = true;
          ap.status = 'done';
        }
        return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0, gear: true }) };
      }
      return { input: neutralInput({ sas: 'stabilityAssist' }) };
    },
  };
  return ap;
}

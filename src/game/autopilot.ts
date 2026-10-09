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
import type { ControlInput, VesselCommand, VesselState } from '../sim/vessel/runtime';
import type { EngineModule } from '../sim/vessel/types';
import { neutralInput, G0, spoolDownTime } from '../sim/vessel';
import { SPOOL_CUTOFF } from '../sim/vessel/engines';
import { applyVesselCommands } from '../sim/vessel/actions';
import type { ManeuverNode, Orbit } from '../sim/orbit/api';
import {
  propagate,
  period,
  periapsisRadius,
  apoapsisRadius,
  timeToApoapsis,
  timeToPeriapsis,
  stateAfterManeuver,
  inertialDvToManeuver,
  solveLambertAround,
  stateToElements,
} from '../sim/orbit';
import { add, sub, scale, length, normalize, dot, cross, v3, type Vec3 } from '../util/vec3';
import { qRotate } from '../util/quat';
import { thrustLimit } from '../sim/vessel/tweaks';
import { stageBurnTime, NODE_STAGE_PAUSE as STAGE_PAUSE } from '../sim/vessel/burnTime';
export { stageBurnTime } from '../sim/vessel/burnTime';
import { cachedStageDeltaV } from './stageDeltaVCache';
import { formatDuration } from '../util/format';

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
  /**
   * Commands that undo temporary vessel settings the program made (e.g. a thrust limiter for a fine trim). The
   * driver sends them however the program ends: done, failed or overridden by the pilot.
   */
  release?(): VesselCommand[];
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
    const limit = thrustLimit(p);
    thrust += m.maxThrustVac * limit;
    massFlow += m.maxThrustVac * limit / (m.ispVac * G0);
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
    if (ap.done || ap.error) {
      // Undo temporary settings (thrust limiters) the program made, as the flight scene's driver does.
      const restore = [...(step.input.commands ?? []), ...(ap.error ? ap.release?.() ?? [] : [])];
      if (restore.length) applyVesselCommands(wv.state, restore, []);
      break;
    }
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
  /** Seconds before burn start to stop warping and re-aim (the craft is already pointed before warping). */
  alignLead?: number;
  /** Final-phase time constant: throttle ramps down once the remaining dv is below aMax·tail. */
  tail?: number;
  /** Remove the node from the world when finished (default true). */
  removeNode?: boolean;
  /**
   * For mostly prograde/retrograde burns without closed-loop guidance, end the burn when the planned orbital energy
   * (semi-major axis) is reached instead of when the vector dv is used up. Finite burns in a fixed direction lose a little
   * efficiency, and for near-escape burns (e.g. trans-lunar injection) a 1% dv shortfall moves the apoapsis by
   * thousands of km; matching energy keeps the transfer timing right. Default true.
   */
  matchEnergy?: boolean;
}

/** Farthest transfer angle the guidance aim point may sit at: clear of the singular 180° Lambert arc. */
const GUIDE_MAX_ANGLE = (175 * Math.PI) / 180;

/**
 * Aim point for closed-loop burn guidance: the farthest point of the planned post-burn orbit up to `until` (the
 * planned patch's end, e.g. an encounter), ~175° after the node, ~90% of the SOI radius or ~half a period. A far
 * point fixes what the plan is for (where the transfer goes, and when); a point a quarter turn ahead let a long or
 * late burn swing the line of apsides by degrees, hundreds of km at the Moon. Null when no usable point exists.
 */
function guidanceTarget(o: Orbit, node: number, soi: number, until = Infinity): { time: number; position: Vec3; normal: Vec3 } | null {
  const s0 = propagate(o, node);
  const normal = cross(s0.position, s0.velocity);
  if (!(length(normal) > 0)) return null;
  const T = period(o);
  const span = Number.isFinite(T) ? 0.45 * T : 4 * length(s0.position) / Math.max(1, length(s0.velocity)) * 20;
  let best: { time: number; position: Vec3; normal: Vec3 } | null = null;
  for (let k = 1; k <= 240; k++) {
    const t = node + (span * k) / 240;
    if (t > until) break;
    const r = propagate(o, t).position;
    if (length(r) > 0.9 * soi) break;
    const angle = angleBetween(s0.position, r);
    if (angle < (20 * Math.PI) / 180) continue;
    best = { time: t, position: r, normal };
    if (angle >= GUIDE_MAX_ANGLE) break;
  }
  return best;
}

/**
 * Δv the engines still deliver if cut now: the same discrete spool-down the engine model runs each physics step
 * (exponential decay with `spoolDownTime`, thrust at the decayed throttle, falling mass, cut below SPOOL_CUTOFF). `step` is the gain of
 * burning one more step at the current throttle, so the cut can stay on the short (trimmable) side.
 */
export function spoolDownDv(v: VesselState): { tail: number; step: number } {
  let tail = 0;
  let step = 0;
  let mass = v.mass;
  const engines: { u: number; decay: number; full: number; mdot: number }[] = [];
  for (const p of v.parts) {
    const st = p.engine;
    if (!st?.ignited || !(st.throttle > 0) || !(st.thrust > 0)) continue;
    const m = p.def.modules[st.moduleIndex] as EngineModule;
    const full = st.thrust / st.throttle;
    // Cuts decay with the engine's spool-down time (rockets: a fraction of a second; jets: their spool time).
    const down = spoolDownTime(m);
    engines.push({ u: st.throttle, decay: down > 0 ? Math.exp(-PHYSICS_DT / down) : 0, full, mdot: full / (Math.max(1, st.isp) * G0) });
    step += (st.thrust * PHYSICS_DT) / v.mass;
  }
  for (let k = 0; k < 2000 && engines.some(e => e.u > 0); k++) {
    let f = 0;
    for (const e of engines) {
      e.u *= e.decay;
      if (e.u < SPOOL_CUTOFF) e.u = 0;
      f += e.u * e.full;
      mass -= e.u * e.mdot * PHYSICS_DT;
    }
    tail += (f * PHYSICS_DT) / Math.max(1, mass);
  }
  return { tail, step };
}

/** Pointing error that allows staging and throttle, rad. */
const BURN_CONE = (15 * Math.PI) / 180;

/** Vacuum stage readout limited to the stages the program may use, from the one burning now (or firing next). */
function usableStages(v: VesselState, minStage: number) {
  const lit = v.parts.some(p => p.engine?.ignited && !p.engine.flamedOut);
  const burning = lit ? v.nextStage + 1 : v.nextStage;
  const stages = cachedStageDeltaV(v, 0, G0).filter(s => s.stage >= minStage && s.stage <= burning);
  return { stages, burning, lit, dv: stages.reduce((a, s) => a + (s.dv > 0 ? s.dv : 0), 0) };
}

/** Why the next stage may not be fired automatically (null when it may). */
function stageBlocker(v: VesselState, minStage: number): string | null {
  if (v.nextStage < 0 || v.nextStage < minStage) return 'no propulsion remains in the allowed stages';
  if (!usableStages(v, minStage).stages.some(s => s.stage <= v.nextStage && s.dv > 0)) return 'no propulsion remains in the allowed stages (no engine with fuel)';
  if (v.parts.some(p => p.stage === v.nextStage && !p.activated && p.chute)) return 'the next stage holds parachutes, stage manually';
  return null;
}

/** Countdown text: "42 s", "2:14", "1:05:09", then days. */
const fmtS = (s: number) => {
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return `${Math.max(0, s).toFixed(0)} s`;
  if (s >= 86400) return formatDuration(s);
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * Fly a maneuver node the way a careful pilot does:
 *  1. turn to the burn vector at 1× (rails warp keeps an inertial attitude), then warp until `alignLead` before
 *     the burn and re-aim;
 *  2. start the burn so half of the Δv is delivered before the node. The burn time comes from the per-stage Δv
 *     readout, so mass loss and the stages still to fire (with a pause for each) are accounted for;
 *  3. stage automatically whenever nothing can thrust (an unstaged craft, a burnt-out stage), never firing a
 *     stage below `minStage` or one holding parachutes;
 *  4. track the remaining Δv by integrating measured proper acceleration (or, for prograde/retrograde burns, stop on
 *     the planned orbital energy), taper the throttle, anticipate spool-down and wait for the engines to stop.
 * `status` says what it is doing for the HUD; `residual()` is the final miss against the planned post-burn velocity.
 */
export function executeNode(world: World, node: ManeuverNode, opts: ExecuteNodeOptions = {}): Autopilot & { dvUsed(): number; remaining(): number; residual(): number } {
  if (world.preciseGravity) world.message('Precise gravity prediction differs from patched-conic planning. This node may need a correction burn.', 'warn', 10);
  // The program flies this node: no "node in 30 s" alarm (it would stop the program's own warp and linger as ✓).
  const owner = world.active?.state.id;
  if (owner) world.alarmClock.quietNode(owner, node);
  const minStage = opts.minStage ?? 0;
  const alignLead = opts.alignLead ?? 20;
  const tail = opts.tail ?? 1.5;
  type Phase = 'init' | 'turn' | 'coast' | 'align' | 'burn' | 'cutoff' | 'done';
  let phase: Phase = 'init';
  let dvRem = v3();
  let dvDir = v3();
  let target = v3();
  let burnStart = node.time;
  let burnTime = 0;
  let lastUt = world.ut;
  let used = 0;
  let targetEnergy = NaN;
  let dv0 = 0;
  let steerDir = v3(0, 1, 0);
  let stalled = 0;
  let turning = 0;
  let stageCooldown = 0;
  let trims = 0;
  /** Thrust limiters changed for the fine trim, with the player's values to restore. */
  const limiters = new Map<number, number | undefined>();
  let residual = NaN;
  /** Closed-loop guidance: the burn steers to put the craft on the planned orbit's aim point (Lambert). */
  let guide: ReturnType<typeof guidanceTarget> = null;
  /** Burn vector and timing from the vessel's *current* orbit (it may have drifted since planning). */
  const aim = (w: World) => {
    const wv = w.active!;
    const o = w.orbitOf(wv);
    const sNode = propagate(o, node.time);
    // A burn already under way (restarted executor, reload) aims at the node's frozen plan, not at the live orbit plus
    // the whole node again.
    const plan = stateAfterManeuver(sNode, o.body, node);
    target = plan.velocity;
    dvRem = sub(target, sNode.velocity);
    targetEnergy = dot(target, target) / 2 - o.mu / length(plan.position);
    dvDir = length(dvRem) > 0 ? normalize(dvRem) : noseDirection(wv.state);
    steerDir = dvDir;
    dv0 = length(dvRem);
    guide = null;
    // The planned patch ends at an SOI change, impact or the next node: aim no farther.
    const patch = w.trajectory().find(p => Math.abs(p.startTime - node.time) < 1e-3 && p.orbit.body === o.body);
    const until = patch && patch.endReason !== 'horizon' ? patch.endTime : Infinity;
    try {
      guide = guidanceTarget(stateToElements(o.mu, o.body, plan.position, target, node.time), node.time, w.universe.body(o.body).soi, until);
    } catch { /* degenerate planned orbit: open-loop burn */ }
    const { stages, burning, lit, dv } = usableStages(wv.state, minStage);
    const deliverable = Math.min(dv0, dv);
    burnTime = stageBurnTime(stages, burning, deliverable, STAGE_PAUSE, lit);
    const half = stageBurnTime(stages, burning, deliverable / 2, STAGE_PAUSE, lit);
    burnStart = node.time - (Number.isFinite(half) ? half : 0);
    if (dv < dv0 - 0.5) w.message(`Node needs ${dv0.toFixed(0)} m/s; the usable stages hold ${dv.toFixed(0)} m/s`, 'warn', 8);
  };
  /** Velocity change still needed to reach the planned aim point on time from here (null: no usable guidance). */
  const guidedRemaining = (w: World): Vec3 | null => {
    if (!guide || guide.time - w.ut <= 1) return null;
    try {
      const rs = w.relativeState(w.active!);
      const need = solveLambertAround(w.universe.body(w.active!.body).gm, rs.position, guide.position, guide.time - w.ut, guide.normal).departureVelocity;
      return sub(need, rs.velocity);
    } catch { return null; }
  };
  const finish = (w: World) => {
    // Guided burns are judged against the trajectory they flew to (a finite burn cannot equal the impulsive velocity
    // at the node time); unguided ones against the planned post-burn velocity.
    const miss = guidedRemaining(w);
    residual = miss ? length(miss) : length(sub(target, propagate(w.orbitOf(w.active!), node.time).velocity));
    phase = 'done';
    ap.done = true;
    ap.status = `Done · ${residual.toFixed(1)} m/s off the plan`;
    if (opts.removeNode !== false) w.removeNode(node.id);
  };
  const ap: Autopilot & { dvUsed: () => number; remaining: () => number; residual: () => number } = {
    name: 'node',
    status: 'Preparing the burn',
    done: false,
    dvUsed: () => used,
    remaining: () => length(dvRem),
    residual: () => residual,
    release() {
      const commands: VesselCommand[] = [...limiters].map(([uid, prev]) => ({ kind: 'tweak', uid, tweaks: { thrustLimit: prev }, symmetric: false }));
      limiters.clear();
      // Cancelled or failed with the node still planned: the pilot gets its reminder back.
      if (owner && !ap.done) world.alarmClock.unquietNode(owner, node);
      return commands;
    },
    update(w) {
      const wv = w.active!;
      const v = wv.state;
      const dt = Math.max(0, w.ut - lastUt);
      lastUt = w.ut;
      if (phase === 'init') {
        aim(w);
        if (length(dvRem) < 0.05) {
          finish(w);
          return { input: neutralInput({ sas: 'stabilityAssist' }) };
        }
        phase = w.ut < burnStart - alignLead ? 'turn' : 'align';
      }
      let guided = false;
      if ((phase === 'burn' || phase === 'cutoff') && dt > 0 && wv.mode === 'physics') {
        // Thrust-induced acceleration since the last update (gravity excluded).
        const a = v.telemetry.properAcceleration;
        dvRem = sub(dvRem, scale(a, dt));
        used += length(a) * dt;
      }
      if (phase === 'burn' || phase === 'cutoff') {
        // The velocity that reaches the planned aim point on time from here, minus the current velocity: this
        // absorbs finite-burn losses, burn timing (a late start after a reload) and steering errors that open-loop
        // Δv tracking leaves behind. Else fall back to the integrated estimate this frame.
        const rem = guidedRemaining(w);
        if (rem && length(rem) < 2 * dv0 + 10) { dvRem = rem; guided = true; }
      }
      // Steer along the remaining dv vector; once it is nearly used up its direction is just noise, so keep
      // the last good direction (the energy criterion may still ask for a few m/s of finite-burn losses).
      if (length(dvRem) > Math.max(0.5, 0.03 * dv0)) steerDir = normalize(dvRem);
      const burning = phase === 'burn' || phase === 'cutoff';
      const err = angleBetween(noseDirection(v), burning ? steerDir : dvDir);
      const deg = (err * 180) / Math.PI;
      if (phase === 'turn') {
        // Point first, then warp: rails warp keeps the attitude, so the craft reaches the burn already aligned
        // however slowly it turns.
        turning += dt;
        const settled = err < (2 * Math.PI) / 180 && length(v.angularVelocity) < 0.01;
        if (settled || turning > 300 || w.ut >= burnStart - alignLead) phase = 'coast';
        else {
          ap.status = `Turning to the burn · ${deg.toFixed(0)}° to go · burn in ${fmtS(burnStart - w.ut)}`;
          return { input: steer(dvDir, 0) };
        }
      }
      if (phase === 'coast') {
        if (w.ut < burnStart - alignLead) {
          ap.status = `Waiting for the burn · starts in ${fmtS(burnStart - w.ut)} · ${fmtS(burnTime)} burn`;
          return { input: steer(dvDir, 0), coastUntil: burnStart - alignLead };
        }
        phase = 'align';
        aim(w);
      }
      if (phase === 'align') {
        if (w.ut < burnStart) {
          ap.status = `Burn soon · starts in ${fmtS(burnStart - w.ut)} · ${fmtS(burnTime)} burn · ${deg.toFixed(0)}° off`;
          return { input: steer(dvDir, 0) };
        }
        phase = 'burn';
      }
      // Remaining Δv along the burn. Guided burns steer and cut on the aim point: reaching it on time fixes the
      // transfer's energy and orientation together (TLI: 0.1 m/s moves the lunar periapsis by tens of km). Without
      // guidance, mostly along-track burns cut on the planned orbital energy.
      let along = dot(dvRem, guided ? steerDir : dvDir);
      if (opts.matchEnergy !== false && !guided) {
        const rs = w.relativeState(wv);
        const mu = w.universe.body(wv.body).gm;
        const vAlong = dot(rs.velocity, dvDir);
        if (Math.abs(vAlong) > 0.7 * length(rs.velocity) && isFinite(targetEnergy)) {
          const energy = dot(rs.velocity, rs.velocity) / 2 - mu / length(rs.position);
          // Exact for a straight-line Δv: E' − E = vAlong·Δv + Δv²/2 (linearising overshoots ~0.2 m/s on a TLI).
          const disc = vAlong * vAlong + 2 * (targetEnergy - energy);
          along = disc >= 0 ? -vAlong + Math.sign(vAlong) * Math.sqrt(disc) : (targetEnergy - energy) / vAlong;
        }
      }
      if (phase === 'cutoff') {
        // Wait for the engines to spool down so the resulting orbit is final.
        ap.status = 'Engine cutoff';
        if (v.telemetry.thrust > 0) return { input: steer(steerDir, 0) };
        // One physics step at minimum throttle is the finest pulse a big engine gives (≈0.3 m/s on a heavy booster;
        // on a TLI that is tens of km at the Moon). Trim through the engines' thrust limiters, restored afterwards.
        const prop = propulsion(v);
        const pulse = (prop.minThrottle || 0.01) * prop.thrust * PHYSICS_DT / v.mass;
        if (along > Math.max(0.005, 2e-6 * dv0) && trims < 6 && prop.thrust > 0) {
          trims++;
          phase = 'burn';
          if (along < pulse * 4) {
            const limit = clamp((along / 8 / pulse) * Math.min(1, ...v.parts.filter(q => q.engine?.ignited).map(q => thrustLimit(q))), 0.005, 1);
            const commands: VesselCommand[] = [];
            for (const q of v.parts) {
              if (!q.engine?.ignited) continue;
              if (!limiters.has(q.uid)) limiters.set(q.uid, q.tweaks?.thrustLimit);
              commands.push({ kind: 'tweak', uid: q.uid, tweaks: { thrustLimit: limit }, symmetric: false });
            }
            ap.status = `Fine trim · ${along.toFixed(2)} m/s · thrust limited to ${(limit * 100).toFixed(1)}%`;
            return { input: steer(steerDir, 0, { commands }) };
          }
        } else {
          finish(w);
          return { input: steer(steerDir, 0, { commands: ap.release!() }) };
        }
      }
      // Burn.
      const { tail: spoolTail, step: stepGain } = spoolDownDv(v);
      // Cut a step early rather than late: a short cut can be trimmed, an overshoot cannot.
      if (along <= Math.max(0.01, spoolTail + stepGain)) {
        phase = 'cutoff';
        ap.status = 'Engine cutoff';
        return { input: steer(steerDir, 0) };
      }
      const p = propulsion(v);
      const aMax = p.thrust / v.mass;
      stageCooldown -= dt;
      if (aMax === 0) {
        // Nothing can thrust: an unstaged craft or a burnt-out stage. Stage (once pointed) until an engine lights.
        const blocker = stageBlocker(v, minStage);
        if (blocker) {
          ap.error = blocker;
          return { input: steer(steerDir, 0) };
        }
        ap.status = `Staging · no thrust in the active stage · ${length(dvRem).toFixed(0)} m/s left`;
        let stage = false;
        if (err < BURN_CONE && stageCooldown <= 0) {
          stage = true;
          stageCooldown = 0.6;
          w.message('Assist: staging, no thrust in the active stage', 'info', 2.5);
        }
        return { input: steer(steerDir, 1, { stage }) };
      }
      let fraction = clamp(along / (aMax * tail), 0, 1);
      if (err > BURN_CONE) fraction = 0;
      else if (err > (4 * Math.PI) / 180) fraction *= 0.25;
      stalled = fraction === 0 ? stalled + dt : 0;
      if (stalled > 120) ap.error = 'unable to point along the burn vector';
      ap.status = fraction === 0 ? `Burn paused · turning (${deg.toFixed(0)}° off)` : trims ? `Fine trim · ${Math.max(0, along).toFixed(2)} m/s left` : `Burning · ${Math.max(0, along).toFixed(1)} m/s left`;
      return { input: steer(steerDir, throttleForFraction(fraction, p.minThrottle || 0)) };
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
  const rs = world.relativeState(wv);
  return predictBrakingFrom(world, wv, rs.position, rs.velocity, world.ut, fraction, propulsion(wv.state), maxTime);
}

/** `predictBraking` for a burn starting at `t0` from the body-relative state (r0, v0), e.g. a later point of the coast. */
function predictBrakingFrom(world: World, wv: WorldVessel, r0: Vec3, v0: Vec3, t0: number, fraction: number, prop: Propulsion, maxTime = 900): BrakingPrediction {
  const u = world.universe;
  const body = u.body(wv.body);
  const terrain = u.terrain(wv.body);
  const bottom = world.bottomOffset(wv.state);
  let r = r0;
  let v = v0;
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
    const vs = sub(v, u.ephem.surfaceVelocity(wv.body, r, t0));
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
      const h = heightAt(r, t0 + t);
      if (h < 0) return { stopHeight: -length(sub(v, u.ephem.surfaceVelocity(wv.body, r, t0))) - 1, time: t, impact: true };
    }
  }
  return { stopHeight: heightAt(r, t0 + t), time: t, impact: false };
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

/** Throttle fraction the braking burn is planned at (the rest is margin). */
const PLANNING_THROTTLE = 0.75;
/** A stage hovers outright when its lowest thrust is at most this fraction of its landing weight. */
const HOVER_MARGIN = 0.95;
/**
 * Above that, the terminal phase pulses the minimum setting (engine spool smooths the pulses into an average). That
 * holds a hover down to a 25% duty; a minimum heavier than this many landing weights can only fall or climb.
 */
const PULSE_FLOOR = 4;
/** Braking needs a thrust-to-weight of at least this at the start of the landing stage. */
const MIN_LANDING_TWR = 1.3;
/** Seconds before the solved braking start at which warp ends (the last stretch is sampled at 2 Hz at 1×). */
const BRAKE_LEAD = 15;

export interface LandingStagePlan {
  /** Stage whose engines fly the landing: the one burning now, or one to stage down to before the deorbit burn. */
  stage: number;
  /** Δv the landing is expected to need from here, m/s. */
  dvNeeded: number;
  /** Set when no allowed stage can land here (the program refuses to start). */
  error?: string;
  /** Set when the landing can be flown but looks marginal. */
  warning?: string;
}

/**
 * Pick the stage to land on before anything is burned. A landing ends in a hover: the stage's engines at minimum
 * throttle should weigh less than the craft at touchdown, or at most `PULSE_FLOOR` times as much so the terminal phase
 * can pulse them (a booster at 55% minimum on the Moon outweighs it ~8 times over and can only fall or climb). It must
 * out-thrust gravity enough to brake, and it should hold the landing Δv.
 * Picks the first stage in firing order that qualifies, so a full stack drops its booster and transfer stage in
 * orbit rather than flying a landing it cannot finish.
 */
export function planLandingStage(world: World, wv: WorldVessel, minStage = 0): LandingStagePlan {
  const f = localFrame(world, wv);
  const g = f.body.gm / (f.body.radius * f.body.radius);
  const height = Math.max(0, f.altitude);
  // Kill the surface-relative velocity and the fall from here, with gravity losses on top.
  const dvNeeded = 1.15 * Math.sqrt(length(f.surfVel) ** 2 + 2 * g * height) + 30;
  const { stages, burning } = usableStages(wv.state, minStage);
  const candidates = stages.filter(s => s.dv > 0 && s.thrustVac > 0).sort((a, b) => b.stage - a.stage);
  const plan = (stage: number, warning?: string): LandingStagePlan => ({ stage, dvNeeded, warning });
  if (!candidates.length) return { stage: burning, dvNeeded, error: 'no engine with fuel in the allowed stages' };
  const fits = candidates.map(s => {
    const landMass = Math.max(s.endMass, s.startMass * Math.exp(-Math.min(dvNeeded, s.dv) / (Math.max(1, s.isp) * G0)));
    return { s, floor: s.minThrustVac / (landMass * g), twr: s.thrustVac / (s.startMass * g) };
  });
  // Prefer a stage that hovers outright; else one whose minimum can be pulsed down to a hover.
  const hovering = fits.filter(c => c.floor <= HOVER_MARGIN && c.twr >= MIN_LANDING_TWR);
  const able = hovering.length ? hovering : fits.filter(c => c.floor <= PULSE_FLOOR && c.twr >= MIN_LANDING_TWR);
  const best = able.find(c => c.s.dv >= dvNeeded) ?? able[0];
  if (best) {
    // Stages fired to get there (nextStage down to the landing stage) must not open parachutes.
    const blocked = wv.state.parts.some(p => p.stage !== undefined && p.stage >= best.s.stage && p.stage <= wv.state.nextStage && !p.activated && p.chute);
    if (blocked) return { stage: best.s.stage, dvNeeded, error: 'the stages to drop before landing hold parachutes; stage manually' };
    return plan(best.s.stage, best.s.dv < dvNeeded ? `Landing needs ~${dvNeeded.toFixed(0)} m/s; the landing stage holds ${best.s.dv.toFixed(0)} m/s` : undefined);
  }
  const first = fits[0];
  if (fits.every(c => c.floor > PULSE_FLOOR))
    return { stage: first.s.stage, dvNeeded, error: `the engines cannot throttle low enough to land here (minimum thrust ${first.floor.toFixed(1)}× the landing weight) and no allowed stage below can` };
  return { stage: first.s.stage, dvNeeded, error: `too little thrust to brake for a landing here (thrust-to-weight ${Math.max(...fits.map(c => c.twr)).toFixed(2)})` };
}

/** Conic time when the coast first reaches radius `rStop` (searched over one period from `t0`), or null. */
function timeToRadius(o: Orbit, t0: number, rStop: number): number | null {
  const T = period(o);
  const span = Number.isFinite(T) ? T : 1e5;
  const step = Math.max(1, span / 400);
  let prev = t0;
  for (let t = t0; t <= t0 + span; t += step) {
    if (length(propagate(o, t).position) <= rStop) {
      // Refine within the last step.
      let lo = prev, hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (length(propagate(o, mid).position) <= rStop) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = t;
  }
  return null;
}

/**
 * Powered landing on an airless body from orbit:
 *  0. stage — if the stage burning now cannot hover here (see `planLandingStage`), stage down to one that can while
 *     still in orbit; refuse (error) when none can;
 *  1. deorbit — burn retrograde until the periapsis is below the surface;
 *  2. coast — warpable: the braking start is solved once along the coasting conic (the same constant-throttle braking
 *     prediction, from future points of the coast), warp ends `BRAKE_LEAD` s before it, then the stop point is
 *     predicted at 2 Hz;
 *  3. brake — "suicide burn": throttle chosen by bisection (never below the engines' minimum) so the predicted stop
 *     point (surface-retrograde constant-throttle burn) sits `stopHeight` above the terrain under it;
 *  4. terminal — pick the nearest spot with a gentle enough slope (divert if needed), then a velocity-tracking
 *     descent: fly over the site, sink at a rate proportional to radar altitude down to `touchdownSpeed`;
 *  5. landed — engine off once the legs carry the vessel and it has settled. Contact that costs parts (or the
 *     vessel) is a crash: `error` says so instead of reporting a landing.
 * `touchdown` reports the surface-relative speed at first ground contact.
 */
export function landingController(world: World, opts: LandingOptions = {}): Autopilot & { touchdown: { speed: number; time: number } | null } {
  const minStage = opts.minStage ?? 0;
  const stager = new AutoStager(minStage);
  const owner = world.active?.state.id;
  // Tall craft need clearance to rotate upright after cancelling orbital velocity.
  let craftRadius = world.active?.state.cache.boundingRadius ?? 0;
  let stopTarget = opts.stopHeight ?? (craftRadius > 8 ? 30 * craftRadius : 60);
  const vTouch = opts.touchdownSpeed ?? 1.5;
  type Phase = 'plan' | 'stage' | 'deorbit' | 'coast' | 'brake' | 'terminal' | 'landed' | 'done' | 'failed';
  let phase: Phase = 'plan';
  let landingStage = -1;
  let lastUt = world.ut;
  let stageCooldown = 0;
  let separation = 0;
  let brakeAt = NaN;
  let coastTo = NaN;
  let nextCoastSolve = -Infinity;
  let nextResolve = -Infinity;
  let settled = 0;
  let lastSolve = -Infinity;
  let brakeFraction = 1;
  let lastFlyingSpeed = 0;
  let partsAtContact = 0;
  let site: Vec3 | null = null;
  const maxSlope = opts.maxSlope ?? (8 * Math.PI) / 180;
  const fail = (why: string, status: string) => {
    phase = 'failed';
    ap.error = why;
    ap.status = status;
    return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0 }) };
  };
  /** Throttle fraction the coast plans its braking start at (above any minimum throttle, with margin). */
  const planningFraction = (minThrottle: number) => Math.max(PLANNING_THROTTLE, minThrottle + 0.5 * (1 - minThrottle));
  /** Clearance the 2 Hz braking trigger keeps above the stop target for a coast state. */
  const triggerHeight = (surfVel: Vec3, up: Vec3) => stopTarget + Math.max(0.1 * length(surfVel), 0.6 * Math.abs(dot(surfVel, up)));
  /** Latest time along the coasting conic at which the braking burn may start (now if it is already due). */
  const solveBrakeStart = (w: World, wv: WorldVessel): number => {
    const u = w.universe;
    const body = u.body(wv.body);
    const o = w.orbitOf(wv);
    const prop = propulsion(wv.state);
    const frac = planningFraction(prop.minThrottle);
    const early = (t: number) => {
      const s = propagate(o, t);
      const pred = predictBrakingFrom(w, wv, s.position, s.velocity, t, frac, prop);
      const surfVel = sub(s.velocity, u.ephem.surfaceVelocity(wv.body, s.position, t));
      return !pred.impact && pred.stopHeight > triggerHeight(surfVel, normalize(s.position));
    };
    if (!early(w.ut)) return w.ut;
    const ceiling = body.radius + u.terrain(wv.body).maxHeight + w.bottomOffset(wv.state);
    const reach = timeToRadius(o, w.ut, ceiling);
    // Not below the highest terrain within a period (or still early there): re-solve at 1× when that time comes.
    if (reach === null || early(reach)) return reach ?? w.ut + (Number.isFinite(period(o)) ? period(o) : 600);
    let lo = w.ut, hi = reach;
    for (let k = 0; k < 16 && hi - lo > 0.25; k++) {
      const mid = (lo + hi) / 2;
      if (early(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const ap: Autopilot & { touchdown: { speed: number; time: number } | null } = {
    name: 'landing',
    status: 'planning the descent',
    done: false,
    touchdown: null,
    update(w) {
      const wv = w.active;
      if (phase === 'failed' || phase === 'done') return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0 }) };
      if (!wv || wv.state.id !== owner || wv.state.destroyed) {
        const speed = ap.touchdown?.speed ?? lastFlyingSpeed;
        return fail(`crashed: vessel lost on impact at ${speed.toFixed(1)} m/s`, `crashed · ${speed.toFixed(1)} m/s`);
      }
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

      if (phase === 'plan') {
        if (v.situation !== 'flying') phase = 'terminal';
        else {
          const plan = planLandingStage(w, wv, minStage);
          if (plan.error) return fail(plan.error, 'cannot land with this craft');
          if (plan.warning) w.message(plan.warning, 'warn', 8);
          landingStage = plan.stage;
          phase = v.nextStage >= landingStage ? 'stage' : 'deorbit';
          if (phase === 'stage' && propulsion(v).thrust > 0) w.message('Assist: staging to the landing stage (the current engines cannot throttle low enough to hover)', 'info', 6);
        }
      }
      if (phase === 'stage') {
        // Fire stages (engines idle) until the landing stage's engines are lit, then let the dropped hardware drift
        // clear before the deorbit burn points the engine at it.
        stageCooldown -= dt;
        if (v.nextStage >= landingStage) {
          ap.status = `staging to the landing stage · stage ${v.nextStage}`;
          const fire = stageCooldown <= 0;
          if (fire) stageCooldown = 1;
          return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0, stage: fire }) };
        }
        separation += dt;
        if (separation < 4) {
          ap.status = 'staging to the landing stage · separating';
          return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0 }) };
        }
        craftRadius = v.cache.boundingRadius;
        if (opts.stopHeight === undefined) stopTarget = craftRadius > 8 ? 30 * craftRadius : 60;
        phase = 'deorbit';
      }
      if (phase === 'deorbit') {
        const peTarget = opts.deorbitPeriapsis ?? -0.04 * body.radius;
        const pe = periapsisRadius(o) - body.radius;
        const retro = scale(normalize(f.rs.velocity), -1);
        if (pe > peTarget) {
          const err = angleBetween(noseDirection(v), retro);
          const frac = err < 0.05 ? clamp((pe - peTarget) / 2000, 0.05, 1) : 0;
          ap.status = frac > 0
            ? `deorbit burn · periapsis ${(pe / 1000).toFixed(1)} km → ${(peTarget / 1000).toFixed(1)} km`
            : `deorbit · turning retrograde · ${((err * 180) / Math.PI).toFixed(0)}° to go`;
          return input(retro, throttleForFraction(frac, prop.minThrottle));
        }
        phase = 'coast';
        brakeAt = solveBrakeStart(w, wv);
        coastTo = brakeAt - BRAKE_LEAD;
      }
      if (phase === 'coast') {
        const retro = scale(normalize(f.surfVel), -1);
        if (w.ut < coastTo) {
          ap.status = `coast · braking burn in ${fmtS(brakeAt - w.ut)}`;
          return { ...input(retro, 0), coastUntil: coastTo };
        }
        if (w.ut >= nextResolve && brakeAt - w.ut < -BRAKE_LEAD) {
          // Past the solved start and still early (the conic had not reached the terrain yet): solve again.
          nextResolve = w.ut + 10;
          brakeAt = solveBrakeStart(w, wv);
          coastTo = brakeAt - BRAKE_LEAD;
          if (w.ut < coastTo) return { ...input(retro, 0), coastUntil: coastTo };
        }
        ap.status = `coast · braking burn in ${fmtS(Math.max(0, brakeAt - w.ut))}`;
        // Start braking when a burn at the planning throttle would only just stop in time; the remaining
        // throttle range is the margin for terrain surprises.
        // Re-solving a minutes-long burn at 50 Hz dominates full-size Moon missions.
        // Sample at 2 Hz, with a full sample interval of vertical clearance as margin.
        if (w.ut < nextCoastSolve) return input(retro, 0);
        nextCoastSolve = w.ut + 0.5;
        const pred = predictBraking(w, wv, planningFraction(prop.minThrottle));
        if (!pred.impact && pred.stopHeight > triggerHeight(f.surfVel, f.up)) return input(retro, 0);
        phase = 'brake';
      }
      if (phase === 'brake') {
        const retro = scale(normalize(f.surfVel), -1);
        const radar = radarAltitude(w, wv);
        const speed = length(f.surfVel);
        if (speed < 15 || radar < 80) phase = 'terminal';
        else {
          if (w.ut - lastSolve >= 0.1) {
            lastSolve = w.ut;
            // Lowest throttle whose predicted stop point is at least stopTarget above the terrain. The engines cannot
            // run below their minimum, so the search starts there (a stop above the target then just comes early).
            let lo = Math.max(0.05, prop.minThrottle), hi = 1;
            if (predictBraking(w, wv, hi).stopHeight < stopTarget) lo = hi;
            else
              for (let k = 0; k < 8; k++) {
                const mid = (lo + hi) / 2;
                if (predictBraking(w, wv, mid).stopHeight >= stopTarget) hi = mid;
                else lo = mid;
              }
            brakeFraction = Math.max(lo, hi);
          }
          ap.status = `braking · ${speed.toFixed(0)} m/s · ${radar >= 1000 ? `${(radar / 1000).toFixed(1)} km` : `${radar.toFixed(0)} m`} up`;
          const err = angleBetween(noseDirection(v), retro);
          return input(retro, err < 0.3 ? throttleForFraction(brakeFraction, prop.minThrottle) : 0);
        }
      }
      if (phase === 'terminal') {
        if (v.situation !== 'flying') {
          if (!ap.touchdown) ap.touchdown = { speed: lastFlyingSpeed, time: w.ut };
          phase = 'landed';
        } else {
          lastFlyingSpeed = length(f.surfVel);
          partsAtContact = v.parts.length;
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
          ap.status = `final descent · ${radar.toFixed(0)} m · ${Math.abs(vVert).toFixed(1)} m/s down`;
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
          const demand = clamp(frac, 0, 1);
          // A high-thrust engine's minimum setting can exceed hover thrust (see PULSE_FLOOR).
          // Pulse that minimum rather than commanding it continuously and climbing away.
          const pulse = demand > 0 && demand < prop.minThrottle;
          const on = !pulse || (w.ut % 0.25) < 0.25 * demand / prop.minThrottle;
          return input(dir, on ? throttleForFraction(demand, prop.minThrottle) : 0);
        }
      }
      if (phase === 'landed') {
        // Parts lost at or after contact (a leg, the engine, the whole stack) make it a crash, not a landing.
        const lost = partsAtContact - v.parts.length;
        const speed = ap.touchdown?.speed ?? lastFlyingSpeed;
        if (lost > 0) return fail(`crashed: hit the ground at ${speed.toFixed(1)} m/s and lost ${lost} part${lost === 1 ? '' : 's'}`, `crashed · ${speed.toFixed(1)} m/s · ${lost} part${lost === 1 ? '' : 's'} lost`);
        ap.status = `touchdown · ${speed.toFixed(1)} m/s · settling`;
        settled = length(f.surfVel) < 0.3 && v.situation !== 'flying' ? settled + dt : 0;
        if (settled > 3) {
          if (dot(noseDirection(v), f.up) < 0.5) return fail(`landed at ${speed.toFixed(1)} m/s but tipped over`, 'tipped over');
          phase = 'done';
          ap.done = true;
          ap.status = `landed · touchdown ${speed.toFixed(1)} m/s`;
        }
        return { input: neutralInput({ sas: 'stabilityAssist', throttle: 0, gear: true }) };
      }
      return { input: neutralInput({ sas: 'stabilityAssist' }) };
    },
  };
  return ap;
}

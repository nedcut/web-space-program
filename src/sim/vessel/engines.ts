import type { PartLoad } from './loads';
import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, normalize, scale, sub, v3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import type { AirBreathingSpec, EngineModule, IntakeModule, RcsModule, ReactionWheelModule, ResourceDef, ResourceId } from './types';
import type { PartState, VesselEvent, VesselState } from './runtime';
import { ATM, G0 } from './env';
import { availableResource, drawPropellants, drawResource, totalResource } from './resources';
import { gimbalScale, rcsEnabled, rcsMask, thrustLimit, wheelMode } from './tweaks';

/**
 * Engines (main propulsion), RCS and reaction wheels.
 *
 * Engine model: mass flow is fixed by the vacuum rating (mdot = Fvac / (Isp_vac g0)), and Isp falls with
 * ambient pressure, so thrust drops at sea level like a real fixed-geometry nozzle:
 *   Isp(p) = lerp(Isp_vac, Isp_asl, p/1atm), p/1atm clamped to [0,10], floored at 0.1 s.
 */

export const MIN_ISP = 0.1;
/** Sea-level reference density for jet thrust lapse, kg/m^3. */
export const RHO0 = 1.225;
/** Equivalent inflow speed an intake gets from compressor suction when standing still, m/s. */
export const INTAKE_STATIC_SPEED = 60;
/** Jets flame out when the intake air supply drops below this fraction of demand (relight above it). */
export const JET_MIN_AIR_FRACTION = 0.15;
/** Throttle fraction below which a spooling-down engine is considered shut off. */
export const SPOOL_CUTOFF = 0.01;
/**
 * Time constant (s) of a running liquid rocket's throttle response (valves, not turbopump inertia): a cut ends
 * combustion in a fraction of a second (real tail-off is ~0.1 s; with SPOOL_CUTOFF a full-throttle cut ends in
 * 0.1 s) and throttle changes follow almost at once. Only the start-up transient after ignition follows the
 * engine's `spoolTime`. Jets keep their turbine spool time both ways.
 */
export const ROCKET_THROTTLE_TIME = 0.02;
/** Hydraulic actuator speed, rad/s. Limit the combined two-axis motion, including reversals. */
export const GIMBAL_SLEW_RATE = 25 * Math.PI / 180;
/** Final chamber-pressure decay: full flow until this many seconds of solid propellant remain. */
export const SOLID_TAIL_TIME = 1;
/** Gameplay wheel calibration in coast: capped gain, never authority without installed wheels/EC. */
export const COAST_WHEEL_ACCELERATION = 0.16;
export const COAST_WHEEL_MAX_GAIN = 32;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function ispAtPressure(m: { ispVac: number; ispAsl: number }, pressure: number): number {
  const r = clamp(pressure / ATM, 0, 10);
  return Math.max(MIN_ISP, m.ispVac + (m.ispAsl - m.ispVac) * r);
}

/** Mass flow at full throttle, kg/s. */
export const maxMassFlow = (m: EngineModule): number => m.maxThrustVac / (m.ispVac * G0);

/** Thrust at ambient pressure and throttle (fraction of max mass flow), N. */
export const thrustAtPressure = (m: EngineModule, pressure: number, throttle = 1): number =>
  maxMassFlow(m) * throttle * ispAtPressure(m, pressure) * G0;

/** Solid rocket: cannot be throttled or shut down once lit. */
export const isSolidMotor = (m: EngineModule): boolean => (m.propellants.solidFuel ?? 0) > 0;

export const engineModule = (p: PartState): EngineModule | undefined =>
  p.engine ? (p.def.modules[p.engine.moduleIndex] as EngineModule) : undefined;

/** Piecewise-linear lookup of a [x, y] curve (clamped to the end values). */
export function curveAt(curve: [number, number][], x: number): number {
  if (curve.length === 0) return 0;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return curve[curve.length - 1][1];
}

/** Jet thrust multiplier (fraction of static sea-level thrust) at a Mach number and air density. */
export function jetThrustFactor(spec: AirBreathingSpec, mach: number, density: number): number {
  if (density <= 0) return 0;
  return Math.max(0, curveAt(spec.machCurve, Math.max(0, mach))) * Math.pow(density / RHO0, spec.densityExponent);
}

/** Thrust of an air-breathing engine with unlimited intake air, N. */
export const jetThrust = (m: EngineModule, mach: number, density: number, throttle = 1): number =>
  m.airBreathing ? m.maxThrustVac * throttle * jetThrustFactor(m.airBreathing, mach, density) : 0;

/** Intake air production rate of one intake (kg/s); `cosFacing` = cosine between airflow and the intake axis. */
export function intakeRate(mod: IntakeModule, density: number, speed: number, cosFacing: number): number {
  if (density <= 0) return 0;
  return density * mod.area * (speed * (0.5 + 0.5 * Math.max(0, cosFacing)) + INTAKE_STATIC_SPEED);
}

/**
 * Intakes fill the 'intakeAir' resource for this step (intake axis = part +Y). Air is not storable: each step an
 * intake holds exactly what it captured during that step (its nominal capacity only marks it as an air source).
 */
export function produceIntakeAir(v: VesselState, airVelocityBody: Vec3, density: number, dt: number): void {
  for (const p of v.parts) {
    for (const mod of p.def.modules) {
      if (mod.type !== 'intake') continue;
      const vb = add(airVelocityBody, cross(v.angularVelocity, sub(p.position, v.com)));
      const sp = length(vb);
      const facing = qRotate(p.rotation, { x: 0, y: 1, z: 0 });
      const cosF = sp > 1e-6 ? dot(vb, facing) / sp : 0;
      // Leftovers are vented: the intake only ever holds what it captured during this step.
      p.resources.intakeAir = intakeRate(mod, density, sp, cosF) * dt;
    }
  }
}

/** Commanded throttle -> engine target throttle (fraction of max mass flow). */
export function targetThrottle(m: EngineModule, cmd: number): number {
  if (isSolidMotor(m)) return 1;
  if (cmd <= 0) return 0;
  if (!m.throttleable) return 1;
  return m.minThrottle + (1 - m.minThrottle) * clamp(cmd, 0, 1);
}

/**
 * Time constant used when the engine's flow is decreasing: jets spool down on their turbine inertia, liquid rockets
 * shut off almost at once (ROCKET_THROTTLE_TIME). Solid motors cannot be throttled.
 */
export function spoolDownTime(m: EngineModule): number {
  if (isSolidMotor(m)) return 0;
  return m.airBreathing ? m.spoolTime : Math.min(m.spoolTime, ROCKET_THROTTLE_TIME);
}

/** Time constant toward `target` for an ignited engine in state `st` (start-up transient, then fast for rockets). */
export function throttleTimeConstant(m: EngineModule, st: { throttle: number; spooledUp?: boolean }, target: number): number {
  if (isSolidMotor(m)) return 0;
  if (target < st.throttle) return spoolDownTime(m);
  return m.airBreathing || !st.spooledUp ? m.spoolTime : Math.min(m.spoolTime, ROCKET_THROTTLE_TIME);
}

/** First-order lag toward target with time constant spoolTime. */
export function spoolThrottle(current: number, target: number, spoolTime: number, dt: number): number {
  if (spoolTime <= 0) return target;
  return target + (current - target) * Math.exp(-dt / spoolTime);
}

/** Propellant units needed for `massKg` of propellant, respecting the volumetric mixture ratio. */
export function propellantNeed(m: { propellants: Partial<Record<ResourceId, number>> }, defs: Record<ResourceId, ResourceDef>, massKg: number): Partial<Record<ResourceId, number>> {
  let kgPerMixUnit = 0;
  for (const k in m.propellants) kgPerMixUnit += (m.propellants[k as ResourceId] ?? 0) * defs[k as ResourceId].density;
  const need: Partial<Record<ResourceId, number>> = {};
  if (kgPerMixUnit <= 0) return need;
  const mixUnits = massKg / kgPerMixUnit;
  for (const k in m.propellants) need[k as ResourceId] = (m.propellants[k as ResourceId] ?? 0) * mixUnits;
  return need;
}

/** Ignite an engine (consumes an ignition). Returns false if no ignitions remain or no propellant. */
export function igniteEngine(v: VesselState, p: PartState, events?: VesselEvent[]): boolean {
  const st = p.engine;
  const m = engineModule(p);
  if (!st || !m || st.ignited) return !!st?.ignited;
  if (st.ignitionsLeft === 0) return false;
  for (const k in m.propellants) if (availableResource(v, p.uid, k as ResourceId) <= 0) return false;
  if (st.ignitionsLeft > 0) st.ignitionsLeft -= 1;
  st.ignited = true;
  st.spooledUp = undefined;
  st.flamedOut = false;
  events?.push({ type: 'engineIgnited', vesselId: v.id, partUid: p.uid });
  return true;
}

/** Shut down an engine. Solid motors cannot be shut down. */
export function shutdownEngine(p: PartState): boolean {
  const m = engineModule(p);
  if (!p.engine || !m || isSolidMotor(m)) return false;
  p.engine.ignited = false;
  p.engine.throttle = 0;
  p.engine.thrust = 0;
  p.engine.massFlow = 0;
  p.engine.spooledUp = undefined;
  return true;
}

function perpBasis(d: Vec3): [Vec3, Vec3] {
  const helper = Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const a = normalize(cross(helper, d));
  const b = cross(d, a);
  return [a, b];
}

/**
 * Gimbal deflection for a torque command c (body). Uses the gradient of torque.c w.r.t. the two
 * deflection angles, normalised by the lever arm, so torque is ~linear in the command.
 */
export function gimbalDirection(v: VesselState, p: PartState, m: EngineModule, control: Vec3, dt?: number): { dir: Vec3; a: number; b: number } {
  const d = normalize(qRotate(p.rotation, m.thrustDirection));
  const range = m.gimbalRange * gimbalScale(p);
  if (range <= 0 && !(dt !== undefined && p.engine && (p.engine.gimbal.a || p.engine.gimbal.b))) return { dir: d, a: 0, b: 0 };
  const r = sub(p.position, v.com);
  const L = length(r);
  if (L < 1e-3 && !(dt !== undefined && p.engine && (p.engine.gimbal.a || p.engine.gimbal.b))) return { dir: d, a: 0, b: 0 };
  const [ea, eb] = perpBasis(d);
  let da = L >= 1e-3 ? (range * dot(cross(r, ea), control)) / L : 0;
  let db = L >= 1e-3 ? (range * dot(cross(r, eb), control)) / L : 0;
  const mag = Math.hypot(da, db);
  if (mag > range) {
    da *= range / mag;
    db *= range / mag;
  }
  if (dt !== undefined && p.engine) {
    const g = p.engine.gimbal;
    const deltaA = da - g.a, deltaB = db - g.b;
    const travel = Math.hypot(deltaA, deltaB);
    const fraction = travel > 0 ? Math.min(1, GIMBAL_SLEW_RATE * dt / travel) : 1;
    da = g.a + deltaA * fraction;
    db = g.b + deltaB * fraction;
  }
  const dir = normalize(add(d, add(scale(ea, Math.tan(da)), scale(eb, Math.tan(db)))));
  return { dir, a: da, b: db };
}

export interface ActuatorOutput {
  /** Sum of nozzle thrust magnitudes, including opposing rotational jets. */
  thrust?: number;
  forceBody: Vec3;
  torqueBody: Vec3;
}

/** Ambient air state seen by the engines (air-breathing engines need it). */
export interface EngineAir {
  density: number;
  mach: number;
}

/**
 * Advance all engines by dt: spool throttle, draw propellant (mixture respected), compute thrust and
 * gimballed thrust direction. Rockets flame out (and shut down) when any propellant cannot be fully supplied.
 * Air-breathing engines follow Mach/density thrust curves, share the vessel's intake air and flame out while
 * the air supply is below JET_MIN_AIR_FRACTION of demand (relighting automatically when air returns).
 */
export function stepEngines(
  v: VesselState,
  throttleCmd: number,
  control: Vec3,
  pressure: number,
  dt: number,
  events: VesselEvent[],
  air: EngineAir = { density: 0, mach: 0 },
  loads?: PartLoad[],
): ActuatorOutput & { thrust: number; airRatio: number } {
  let force = v3();
  let torque = v3();
  let total = 0;
  // Pass 1: spool throttles; jet fuel flows and the shared intake air demand.
  const jetFlow = new Map<number, number>();
  let airNeed = 0;
  for (const p of v.parts) {
    const st = p.engine;
    const m = engineModule(p);
    if (!st || !m) continue;
    if (!st.ignited) {
      st.throttle = 0;
      st.spooledUp = undefined;
      st.thrust = 0;
      st.massFlow = 0;
      continue;
    }
    const target = targetThrottle(m, throttleCmd);
    st.throttle = spoolThrottle(st.throttle, target, throttleTimeConstant(m, st, target), dt);
    if (isSolidMotor(m)) {
      // Solid fuel has local ('none') crossfeed; read the grain directly, without new flow-group arrays.
      const fuel = (p.resources.solidFuel ?? 0) * v.resourceDefs.solidFuel.density;
      const fullFlow = maxMassFlow(m) * thrustLimit(p);
      // sqrt(fuel) gives a finite pressure tail (about two seconds), with no last-step thrust spike.
      const tail = fullFlow > 0 ? fuel / (fullFlow * SOLID_TAIL_TIME) : 1;
      st.throttle = Math.min(1, Math.sqrt(tail));
      if (fuel <= 0) {
        st.ignited = false; st.flamedOut = true;
        st.thrust = 0; st.massFlow = 0;
        events.push({ type: 'flameout', vesselId: v.id, partUid: p.uid });
      }
    }
    // The start-up transient ends once the engine first reaches a commanded (non-zero) setting.
    if (!st.spooledUp && target > 0 && st.throttle >= target - SPOOL_CUTOFF) st.spooledUp = true;
    // A commanded cut ends once the flow has decayed below the cutoff; otherwise the exponential lag never
    // reaches zero (thrust and propellant drain lingering for tens of seconds, blocking rails warp).
    if (target === 0 && st.throttle < SPOOL_CUTOFF) st.throttle = 0;
    if (m.airBreathing) {
      const mdot = jetThrust(m, air.mach, air.density, st.throttle) * thrustLimit(p) / (m.ispVac * G0);
      jetFlow.set(p.uid, mdot);
      airNeed += mdot * m.airBreathing.airRatio * dt;
    }
  }
  let airFrac = 1;
  if (airNeed > 0) {
    const src = v.parts.find((p) => (p.maxResources.intakeAir ?? 0) > 0);
    const avail = src ? availableResource(v, src.uid, 'intakeAir') : 0;
    airFrac = Math.min(1, avail / airNeed);
    if (src && airFrac >= JET_MIN_AIR_FRACTION) drawResource(v, src.uid, 'intakeAir', airNeed * airFrac);
  }
  // Pass 2: propellant draw and thrust.
  for (const p of v.parts) {
    const st = p.engine;
    const m = engineModule(p);
    if (!st || !m || !st.ignited) continue;
    let mdot: number;
    let isp: number;
    if (m.airBreathing) {
      isp = m.ispVac;
      const starved = (jetFlow.get(p.uid) ?? 0) > 0 && airFrac < JET_MIN_AIR_FRACTION;
      if (starved !== st.flamedOut) {
        st.flamedOut = starved;
        if (starved) events.push({ type: 'flameout', vesselId: v.id, partUid: p.uid });
      }
      mdot = starved ? 0 : (jetFlow.get(p.uid) ?? 0) * airFrac;
    } else {
      isp = ispAtPressure(m, pressure);
      mdot = maxMassFlow(m) * st.throttle * thrustLimit(p);
    }
    st.isp = isp;
    if (mdot <= 1e-12) {
      st.thrust = 0;
      st.massFlow = 0;
      continue;
    }
    const f = drawPropellants(v, p.uid, propellantNeed(m, v.resourceDefs, mdot * dt));
    if (f < 1) {
      st.ignited = false;
      st.flamedOut = true;
      events.push({ type: 'flameout', vesselId: v.id, partUid: p.uid });
    }
    st.massFlow = mdot * f;
    // Average thrust over the step (partial supply on the final step scales thrust).
    const thrust = st.massFlow * st.isp * G0;
    st.thrust = f < 1 ? 0 : thrust;
    const g = gimbalDirection(v, p, m, control, dt);
    st.gimbal.a = g.a; st.gimbal.b = g.b;
    const F = scale(g.dir, thrust);
    loads?.push({ partUid: p.uid, point: p.position, force: F });
    force = add(force, F);
    torque = add(torque, cross(sub(p.position, v.com), F));
    total += thrust;
  }
  return { forceBody: force, torqueBody: torque, thrust: total, airRatio: airNeed > 0 ? airFrac : NaN };
}

/** Gimbal torque per unit command on each axis (N*m), for SAS gain scheduling. */
export function gimbalAuthority(v: VesselState): Vec3 {
  const out = v3();
  for (const p of v.parts) {
    const st = p.engine;
    const m = engineModule(p);
    const range = m ? m.gimbalRange * gimbalScale(p) : 0;
    if (!st || !m || !st.ignited || range <= 0 || st.thrust <= 0) continue;
    const d = normalize(qRotate(p.rotation, m.thrustDirection));
    const r = sub(p.position, v.com);
    const L = length(r);
    if (L < 1e-3) continue;
    const [ea, eb] = perpBasis(d);
    const ja = cross(r, ea), jb = cross(r, eb);
    const k = (st.thrust * range) / L;
    out.x += k * (ja.x * ja.x + jb.x * jb.x);
    out.y += k * (ja.y * ja.y + jb.y * jb.y);
    out.z += k * (ja.z * ja.z + jb.z * jb.z);
  }
  return out;
}

interface NozzleEval {
  partUid: number;
  r: Vec3;
  fdir: Vec3;
  act: number;
  thrustVac: number;
  ispVac: number;
  ispAsl: number;
  /** Rotation-axis enable mask (torque command axes). */
  rot: [number, number, number];
}

function evalRcs(v: VesselState, controlIn: Vec3, translateIn: Vec3): NozzleEval[] {
  const out: NozzleEval[] = [];
  for (const p of v.parts) {
    if (!rcsEnabled(p)) continue;
    const mask = rcsMask(p);
    const control = { x: controlIn.x * mask.rot[0], y: controlIn.y * mask.rot[1], z: controlIn.z * mask.rot[2] };
    const translate = { x: translateIn.x * mask.tr[0], y: translateIn.y * mask.tr[1], z: translateIn.z * mask.tr[2] };
    for (const mod of p.def.modules) {
      if (mod.type !== 'rcs') continue;
      const m = mod as RcsModule;
      for (const nz of m.nozzles) {
        const pos = add(p.position, qRotate(p.rotation, nz.position));
        const fdir = scale(normalize(qRotate(p.rotation, nz.direction)), -1);
        const r = sub(pos, v.com);
        const tq = cross(r, fdir);
        const tl = length(tq);
        const aT = Math.max(0, dot(fdir, translate));
        const aR = tl > 1e-6 ? Math.max(0, dot(scale(tq, 1 / tl), control)) : 0;
        const act = Math.min(1, aT + aR);
        out.push({ partUid: p.uid, r, fdir, act, thrustVac: m.thrustPerNozzle, ispVac: m.ispVac, ispAsl: m.ispAsl, rot: mask.rot });
      }
    }
  }
  return out;
}

/** Fire RCS for rotation (control) and translation commands; draws monopropellant ('all' flow). */
export function stepRcs(v: VesselState, enabled: boolean, control: Vec3, translate: Vec3, pressure: number, dt: number, loads?: PartLoad[]): ActuatorOutput {
  let total = 0;
  let force = v3();
  let torque = v3();
  if (!enabled) return { forceBody: force, torqueBody: torque };
  const nozzles = evalRcs(v, control, translate).filter((n) => n.act > 1e-6);
  if (nozzles.length === 0) return { forceBody: force, torqueBody: torque };
  const dens = v.resourceDefs.monopropellant.density;
  let units = 0;
  for (const n of nozzles) units += ((n.thrustVac * n.act) / (n.ispVac * G0)) * dt / (dens > 0 ? dens : 1);
  const src = v.parts.find((p) => (p.maxResources.monopropellant ?? 0) > 0);
  if (!src) return { forceBody: force, torqueBody: torque };
  const got = drawResource(v, src.uid, 'monopropellant', units);
  const f = units > 0 ? got / units : 0;
  for (const n of nozzles) {
    const thrust = n.thrustVac * n.act * f * (ispAtPressure(n, pressure) / n.ispVac);
    total += thrust;
    const F = scale(n.fdir, thrust);
    force = add(force, F);
    torque = add(torque, cross(n.r, F));
    loads?.push({ partUid: n.partUid, point: add(n.r, v.com), force: F });
  }
  return { forceBody: force, torqueBody: torque, thrust: total };
}

/** RCS torque per unit rotation command on each axis (N*m). */
export function rcsAuthority(v: VesselState): Vec3 {
  const out = v3();
  if (totalResource(v, 'monopropellant') <= 0) return out;
  for (const n of evalRcs(v, v3(), v3())) {
    const tq = cross(n.r, n.fdir);
    const tl = length(tq);
    if (tl < 1e-6) continue;
    const u = scale(tq, 1 / tl);
    out.x += n.rot[0] * n.thrustVac * Math.max(0, u.x) * tq.x;
    out.y += n.rot[1] * n.thrustVac * Math.max(0, u.y) * tq.y;
    out.z += n.rot[2] * n.thrustVac * Math.max(0, u.z) * tq.z;
  }
  return out;
}

/** Command seen by one reaction wheel for its mode; `split` separates pilot and SAS contributions. */
function wheelCommand(p: PartState, control: Vec3, split?: { pilot: Vec3; sas: Vec3 }): Vec3 {
  const mode = wheelMode(p);
  const raw = mode === 'off' ? v3() : mode === 'normal' || !split ? control : mode === 'sasOnly' ? split.sas : split.pilot;
  return { x: clamp(raw.x, -1, 1), y: clamp(raw.y, -1, 1), z: clamp(raw.z, -1, 1) };
}

const installedWheelTorque = new WeakMap<VesselState['cache'], number>();
function wheelTorque(v: VesselState): number {
  let total = installedWheelTorque.get(v.cache);
  if (total === undefined) {
    total = 0;
    for (const p of v.parts) for (const m of p.def.modules) if (m.type === 'reactionWheel') total += m.torque;
    installedWheelTorque.set(v.cache, total);
  }
  return total;
}
function wheelGain(v: VesselState, inertia: number, total: number): number {
  return v.telemetry.thrust > 1 || total <= 0 ? 1
    : Math.max(1, Math.min(COAST_WHEEL_MAX_GAIN, COAST_WHEEL_ACCELERATION * inertia / total));
}

/** Reaction wheel torque (body) for a command; draws EC. Per-part modes (tweaks) choose pilot and/or SAS input. */
export function stepReactionWheels(v: VesselState, control: Vec3, dt: number, loads?: PartLoad[], split?: { pilot: Vec3; sas: Vec3 }): ActuatorOutput {
  const zero = { forceBody: v3(), torqueBody: v3() };
  let torque = v3();
  let need = 0;
  const applied: { p: PartState; t: Vec3 }[] = [];
  const total = wheelTorque(v);
  for (const p of v.parts)
    for (const m of p.def.modules)
      if (m.type === 'reactionWheel') {
        const c = wheelCommand(p, control, split);
        const usage = Math.max(Math.abs(c.x), Math.abs(c.y), Math.abs(c.z));
        if (usage <= 0) continue;
        const t = { x: c.x * m.torque * wheelGain(v, v.inertia[0], total),
          y: c.y * m.torque * wheelGain(v, v.inertia[4], total), z: c.z * m.torque * wheelGain(v, v.inertia[8], total) };
        torque = add(torque, t);
        need += (m as ReactionWheelModule).ecRate * usage * dt;
        applied.push({ p, t });
      }
  if (!applied.length) return zero;
  let f = 1;
  if (need > 0) {
    const src = v.parts.find((p) => (p.maxResources.electricCharge ?? 0) > 0);
    f = src ? drawResource(v, src.uid, 'electricCharge', need) / need : 0;
  }
  if (loads) for (const a of applied) loads.push({ partUid: a.p.uid, point: a.p.position, force: v3(), torque: scale(a.t, f) });
  return { forceBody: v3(), torqueBody: scale(torque, f) };
}

/** Reaction wheel torque per unit command on each axis (N*m). Zero without electric charge. */
export function wheelAuthority(v: VesselState): Vec3 {
  let t = 0;
  let ec = 0;
  for (const p of v.parts) for (const m of p.def.modules) if (m.type === 'reactionWheel') {
    // SAS gain scheduling: wheels that ignore SAS contribute no authority.
    if (wheelMode(p) === 'off' || wheelMode(p) === 'pilotOnly') continue;
    t += (m as ReactionWheelModule).torque;
    ec += (m as ReactionWheelModule).ecRate;
  }
  if (ec > 0 && totalResource(v, 'electricCharge') <= 0) t = 0;
  const total = wheelTorque(v);
  return { x: t * wheelGain(v, v.inertia[0], total), y: t * wheelGain(v, v.inertia[4], total), z: t * wheelGain(v, v.inertia[8], total) };
}

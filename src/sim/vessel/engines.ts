import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, normalize, scale, sub, v3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import type { EngineModule, RcsModule, ReactionWheelModule, ResourceDef, ResourceId } from './types';
import type { PartState, VesselEvent, VesselState } from './runtime';
import { ATM, G0 } from './env';
import { availableResource, drawPropellants, drawResource, totalResource } from './resources';

/**
 * Engines (main propulsion), RCS and reaction wheels.
 *
 * Engine model: mass flow is fixed by the vacuum rating (mdot = Fvac / (Isp_vac g0)), and Isp falls with
 * ambient pressure, so thrust drops at sea level like a real fixed-geometry nozzle:
 *   Isp(p) = lerp(Isp_vac, Isp_asl, p/1atm), p/1atm clamped to [0,10], floored at 0.1 s.
 */

export const MIN_ISP = 0.1;

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

/** Commanded throttle -> engine target throttle (fraction of max mass flow). */
export function targetThrottle(m: EngineModule, cmd: number): number {
  if (isSolidMotor(m)) return 1;
  if (cmd <= 0) return 0;
  if (!m.throttleable) return 1;
  return m.minThrottle + (1 - m.minThrottle) * clamp(cmd, 0, 1);
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
export function gimbalDirection(v: VesselState, p: PartState, m: EngineModule, control: Vec3): { dir: Vec3; a: number; b: number } {
  const d = normalize(qRotate(p.rotation, m.thrustDirection));
  if (m.gimbalRange <= 0) return { dir: d, a: 0, b: 0 };
  const r = sub(p.position, v.com);
  const L = length(r);
  if (L < 1e-3) return { dir: d, a: 0, b: 0 };
  const [ea, eb] = perpBasis(d);
  let da = (m.gimbalRange * dot(cross(r, ea), control)) / L;
  let db = (m.gimbalRange * dot(cross(r, eb), control)) / L;
  const mag = Math.hypot(da, db);
  if (mag > m.gimbalRange) {
    da *= m.gimbalRange / mag;
    db *= m.gimbalRange / mag;
  }
  const dir = normalize(add(d, add(scale(ea, Math.tan(da)), scale(eb, Math.tan(db)))));
  return { dir, a: da, b: db };
}

export interface ActuatorOutput {
  forceBody: Vec3;
  torqueBody: Vec3;
}

/**
 * Advance all engines by dt: spool throttle, draw propellant (mixture respected), compute thrust and
 * gimballed thrust direction. Engines flame out when any propellant cannot be fully supplied.
 */
export function stepEngines(
  v: VesselState,
  throttleCmd: number,
  control: Vec3,
  pressure: number,
  dt: number,
  events: VesselEvent[],
): ActuatorOutput & { thrust: number } {
  let force = v3();
  let torque = v3();
  let total = 0;
  for (const p of v.parts) {
    const st = p.engine;
    const m = engineModule(p);
    if (!st || !m) continue;
    if (!st.ignited) {
      st.throttle = 0;
      st.thrust = 0;
      st.massFlow = 0;
      continue;
    }
    st.throttle = spoolThrottle(st.throttle, targetThrottle(m, throttleCmd), isSolidMotor(m) ? 0 : m.spoolTime, dt);
    const mdot = maxMassFlow(m) * st.throttle;
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
    st.isp = ispAtPressure(m, pressure);
    st.massFlow = mdot * f;
    // Average thrust over the step (partial supply on the final step scales thrust).
    const thrust = st.massFlow * st.isp * G0;
    st.thrust = f < 1 ? 0 : thrust;
    const g = gimbalDirection(v, p, m, control);
    st.gimbal = { a: g.a, b: g.b };
    const F = scale(g.dir, thrust);
    force = add(force, F);
    torque = add(torque, cross(sub(p.position, v.com), F));
    total += thrust;
  }
  return { forceBody: force, torqueBody: torque, thrust: total };
}

/** Gimbal torque per unit command on each axis (N*m), for SAS gain scheduling. */
export function gimbalAuthority(v: VesselState): Vec3 {
  const out = v3();
  for (const p of v.parts) {
    const st = p.engine;
    const m = engineModule(p);
    if (!st || !m || !st.ignited || m.gimbalRange <= 0 || st.thrust <= 0) continue;
    const d = normalize(qRotate(p.rotation, m.thrustDirection));
    const r = sub(p.position, v.com);
    const L = length(r);
    if (L < 1e-3) continue;
    const [ea, eb] = perpBasis(d);
    const ja = cross(r, ea), jb = cross(r, eb);
    const k = (st.thrust * m.gimbalRange) / L;
    out.x += k * (ja.x * ja.x + jb.x * jb.x);
    out.y += k * (ja.y * ja.y + jb.y * jb.y);
    out.z += k * (ja.z * ja.z + jb.z * jb.z);
  }
  return out;
}

interface NozzleEval {
  r: Vec3;
  fdir: Vec3;
  act: number;
  thrustVac: number;
  ispVac: number;
  ispAsl: number;
}

function evalRcs(v: VesselState, control: Vec3, translate: Vec3): NozzleEval[] {
  const out: NozzleEval[] = [];
  for (const p of v.parts) {
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
        out.push({ r, fdir, act, thrustVac: m.thrustPerNozzle, ispVac: m.ispVac, ispAsl: m.ispAsl });
      }
    }
  }
  return out;
}

/** Fire RCS for rotation (control) and translation commands; draws monopropellant ('all' flow). */
export function stepRcs(v: VesselState, enabled: boolean, control: Vec3, translate: Vec3, pressure: number, dt: number): ActuatorOutput {
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
    const F = scale(n.fdir, thrust);
    force = add(force, F);
    torque = add(torque, cross(n.r, F));
  }
  return { forceBody: force, torqueBody: torque };
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
    out.x += n.thrustVac * Math.max(0, u.x) * tq.x;
    out.y += n.thrustVac * Math.max(0, u.y) * tq.y;
    out.z += n.thrustVac * Math.max(0, u.z) * tq.z;
  }
  return out;
}

/** Reaction wheel torque (body) for a command; draws EC. */
export function stepReactionWheels(v: VesselState, control: Vec3, dt: number): ActuatorOutput {
  let maxTorque = 0;
  let ecRate = 0;
  for (const p of v.parts)
    for (const m of p.def.modules)
      if (m.type === 'reactionWheel') {
        maxTorque += (m as ReactionWheelModule).torque;
        ecRate += (m as ReactionWheelModule).ecRate;
      }
  const zero = { forceBody: v3(), torqueBody: v3() };
  if (maxTorque <= 0) return zero;
  const c = { x: clamp(control.x, -1, 1), y: clamp(control.y, -1, 1), z: clamp(control.z, -1, 1) };
  const usage = Math.max(Math.abs(c.x), Math.abs(c.y), Math.abs(c.z));
  if (usage <= 0) return zero;
  const need = ecRate * usage * dt;
  let f = 1;
  if (need > 0) {
    const src = v.parts.find((p) => (p.maxResources.electricCharge ?? 0) > 0);
    f = src ? drawResource(v, src.uid, 'electricCharge', need) / need : 0;
  }
  return { forceBody: v3(), torqueBody: scale(c, maxTorque * f) };
}

/** Reaction wheel torque per unit command on each axis (N*m). Zero without electric charge. */
export function wheelAuthority(v: VesselState): Vec3 {
  let t = 0;
  let ec = 0;
  for (const p of v.parts) for (const m of p.def.modules) if (m.type === 'reactionWheel') {
    t += (m as ReactionWheelModule).torque;
    ec += (m as ReactionWheelModule).ecRate;
  }
  if (ec > 0 && totalResource(v, 'electricCharge') <= 0) t = 0;
  return { x: t, y: t, z: t };
}

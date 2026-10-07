import type { Vec3 } from '../../util/vec3';
import { cross, dot, length, normalize, scale, sub, v3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { qConj, qMul, qRotate } from '../../util/quat';
import type { ControlInput, SasMode, VesselState } from './runtime';
import type { Environment } from './env';
import { m3MulVec } from './mat3';

/**
 * SAS: cascaded attitude controller.
 *   attitude error theta (body axis-angle) -> desired rate (P with a sqrt "braking" limit derived from
 *   the actual available angular acceleration, so it never overshoots) -> rate loop (P + small I) ->
 *   desired angular acceleration -> torque via the full inertia tensor incl. gyroscopic feed-forward ->
 *   normalised per-axis command using the vessel's real control authority.
 * Gains are expressed as time constants tied to the step size and authority, so the same tuning works for
 * a 100 kg probe and a 500 t launcher without oscillating.
 */

export const SAS_MAX_RATE = 1.0;
export const SAS_INTEGRAL_TIME = 1.5;

const NOSE: Vec3 = { x: 0, y: 1, z: 0 };

export function pilotActive(input: ControlInput): boolean {
  return Math.abs(input.pitch) + Math.abs(input.yaw) + Math.abs(input.roll) > 1e-3;
}

/** Target pointing direction (inertial unit vector) for directional SAS modes, or null. */
export function sasTargetDirection(v: VesselState, mode: SasMode, input: ControlInput, env: Environment, t: number): Vec3 | null {
  const ref = env.referenceBody?.(v.position, t);
  const r = ref ? sub(v.position, ref.position) : scale(env.gravity(v.position, t), -1);
  let vel: Vec3;
  const refMode = input.sasReference ?? 'orbit';
  if (refMode === 'surface') vel = sub(v.velocity, env.air(v.position, t).windVelocity);
  else if (refMode === 'target' && input.target) vel = sub(v.velocity, input.target.velocity);
  else vel = ref ? sub(v.velocity, ref.velocity) : v.velocity;
  const hvec = cross(r, vel);
  const nz = (a: Vec3) => (length(a) > 1e-12 ? normalize(a) : null);
  switch (mode) {
    case 'prograde': return nz(vel);
    case 'retrograde': return nz(scale(vel, -1));
    case 'normal': return nz(hvec);
    case 'antinormal': return nz(scale(hvec, -1));
    case 'radialOut': return nz(cross(vel, hvec)) ?? nz(r);
    case 'radialIn': { const d = nz(cross(vel, hvec)) ?? nz(r); return d ? scale(d, -1) : null; }
    case 'target': return input.target ? nz(sub(input.target.position, v.position)) : null;
    case 'antiTarget': return input.target ? nz(sub(v.position, input.target.position)) : null;
    case 'maneuver': return input.maneuverDirection ? nz(input.maneuverDirection) : null;
    default: return null;
  }
}

/** Body-frame rotation vector taking orientation `q` to `target`. */
export function attitudeError(q: Quat, target: Quat): Vec3 {
  let e = qMul(qConj(q), target);
  if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
  const s = Math.hypot(e.x, e.y, e.z);
  if (s < 1e-12) return v3();
  const angle = 2 * Math.atan2(s, e.w);
  return scale({ x: e.x, y: e.y, z: e.z }, angle / s);
}

/** Body-frame rotation vector taking the nose (+Y) onto `dirBody` (roll left free). */
export function pointingError(dirBody: Vec3): Vec3 {
  const c = cross(NOSE, dirBody);
  const s = length(c);
  const cosA = dot(NOSE, dirBody);
  if (s < 1e-9) return cosA > 0 ? v3() : { x: Math.PI, y: 0, z: 0 };
  return scale(c, Math.atan2(s, cosA) / s);
}

/**
 * Compute the SAS torque command c = (pitch, roll, -yaw) in body axes, each in [-1, 1].
 * `authority` = available torque per unit command for each body axis (N*m). Mutates v.sas.
 */
export function computeSas(v: VesselState, input: ControlInput, env: Environment, t: number, authority: Vec3, h: number): Vec3 {
  const sas = v.sas;
  if (input.sas !== sas.mode) {
    sas.mode = input.sas;
    sas.hold = null;
    sas.integral = v3();
  }
  if (sas.mode === 'off') return v3();
  const w = v.angularVelocity;
  let theta = v3();
  let freeRoll = false;
  if (sas.mode === 'stabilityAssist') {
    if (pilotActive(input)) {
      sas.hold = null;
      sas.integral = v3();
      return v3();
    }
    if (!sas.hold && length(w) < 0.02) sas.hold = { ...v.orientation };
    if (sas.hold) theta = attitudeError(v.orientation, sas.hold);
  } else {
    const d = sasTargetDirection(v, sas.mode, input, env, t);
    if (d) theta = pointingError(qRotate(qConj(v.orientation), d));
    freeRoll = true;
  }
  const I = v.inertia;
  const Idiag = [I[0], I[4], I[8]];
  const auth = [authority.x, authority.y, authority.z];
  const th = [theta.x, theta.y, theta.z];
  const om = [w.x, w.y, w.z];
  const integ = [sas.integral.x, sas.integral.y, sas.integral.z];
  const tauR = Math.max(0.1, 5 * h);
  const tauP = 3.5 * tauR;
  const alphaDes = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (auth[i] <= 0 || Idiag[i] <= 0) continue;
    const aMax = auth[i] / Idiag[i];
    let wDes = th[i] / tauP;
    const brake = Math.sqrt(aMax * Math.abs(th[i]));
    wDes = Math.max(-brake, Math.min(brake, wDes));
    wDes = Math.max(-SAS_MAX_RATE, Math.min(SAS_MAX_RATE, wDes));
    if (freeRoll && i === 1) wDes = 0;
    const err = (wDes - om[i]) / tauR;
    alphaDes[i] = err + integ[i];
    if (Math.abs(alphaDes[i]) < aMax) integ[i] = Math.max(-0.2 * aMax, Math.min(0.2 * aMax, integ[i] + (err * h) / SAS_INTEGRAL_TIME));
  }
  const a = { x: alphaDes[0], y: alphaDes[1], z: alphaDes[2] };
  const Iw = m3MulVec(I, w);
  const tau = m3MulVec(I, a);
  const gyro = cross(w, Iw);
  const tq = [tau.x + gyro.x, tau.y + gyro.y, tau.z + gyro.z];
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = auth[i] > 0 ? Math.max(-1, Math.min(1, tq[i] / auth[i])) : 0;
  // The pilot wins on every axis they steer: directional holds yield there and resume on release (roll stays free
  // while pointing is held). Summed with a saturated hold command the pilot's input would cancel out completely.
  const pilot = [input.pitch, input.roll, -input.yaw];
  for (let i = 0; i < 3; i++) if (Math.abs(pilot[i]) > 1e-3) { c[i] = 0; integ[i] = 0; }
  sas.integral = { x: integ[0], y: integ[1], z: integ[2] };
  return { x: c[0], y: c[1], z: c[2] };
}

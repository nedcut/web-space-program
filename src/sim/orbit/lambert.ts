import { cross, dot, length, scale, sub, type Vec3 } from '../../util/vec3';
import { stumpff } from './kepler';

export interface LambertSolution { departureVelocity: Vec3; arrivalVelocity: Vec3 }

/** Universal-variable Lambert, prograde about +Z, zero complete revolutions (transfer angle < 2π).
 * Brackets the monotonic time-of-flight branch before bisection; lengths/GM/time use consistent units.
 * Collinear endpoints have no unique transfer plane and are rejected explicitly.
 * Reference: https://docs.poliastro.space/en/stable/autoapi/poliastro/core/iod/index.html
 */
export function solveLambert(mu: number, r1: Vec3, r2: Vec3, tof: number): LambertSolution {
  if (![mu, tof, r1.x, r1.y, r1.z, r2.x, r2.y, r2.z].every(Number.isFinite) || mu <= 0 || tof <= 0)
    throw new RangeError('Lambert requires finite states, positive GM and time of flight');
  // Nondimensionalize so tolerances also work at solar-system scales.
  const unit = length(r1), speed = Math.sqrt(mu / unit), clock = unit / speed;
  const p = scale(r1, 1 / unit), q = scale(r2, 1 / unit), R = length(q);
  if (!(unit > 0 && R > 0)) throw new RangeError('Lambert requires nonzero radii');
  const cosine = Math.max(-1, Math.min(1, dot(p, q) / R));
  const sine = length(cross(p, q)) / R;
  if (sine < 1e-10) throw new RangeError('Collinear Lambert endpoints: transfer plane is ambiguous');
  const A = (cross(p, q).z < 0 ? -1 : 1) * sine * Math.sqrt(R / (1 - cosine));
  const target = tof / clock;
  const evaluate = (z: number) => {
    const { C, S } = stumpff(z);
    const y = 1 + R + A * (z * S - 1) / Math.sqrt(C);
    return { y, time: y < 0 ? 0 : (y / C) ** 1.5 * S + A * Math.sqrt(y) };
  };
  let lo = -4, hi = 4 * Math.PI ** 2 - 1e-7;
  while (evaluate(lo).time > target && lo > -1e5) lo *= 2;
  if (!(evaluate(lo).time <= target)) throw new RangeError('Unable to bracket Lambert flight time');
  let z = 0;
  for (let k = 0; k < 100; k++) {
    z = (lo + hi) / 2;
    const ev = evaluate(z);
    if (Math.abs(ev.time - target) < 2e-12 * target) break;
    if (ev.time < target) lo = z; else hi = z;
  }
  const { y } = evaluate(z), f = 1 - y, g = A * Math.sqrt(y), gd = 1 - y / R;
  const departureVelocity = scale(sub(q, scale(p, f)), speed / g);
  const arrivalVelocity = scale(sub(scale(q, gd), p), speed / g);
  if (![...Object.values(departureVelocity), ...Object.values(arrivalVelocity)].every(Number.isFinite))
    throw new RangeError('Lambert failed to converge');
  return { departureVelocity, arrivalVelocity };
}

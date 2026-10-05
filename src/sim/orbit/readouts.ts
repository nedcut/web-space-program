import type { Orbit, StateVector } from './api';
import { propagate, period, timeToPeriapsis, semiLatusRectum, elementsToState, timeToTrueAnomaly } from './kepler';
import { cross, dot, length, normalize, type Vec3 } from '../../util/vec3';

export interface ImpactEstimate { time: number; position: Vec3; velocity: Vec3; speed: number }
/** Unpowered, drag-free prediction in one SOI. Clearance must sample terrain at the prediction UT.
 * Bounded sampling followed by a root solve; returns null beyond the supplied horizon. */
export function ballisticImpact(orbit: Orbit, now: number, clearance: (position: Vec3, time: number) => number,
  surfaceVelocity: (position: Vec3, time: number) => Vec3 = () => ({ x: 0, y: 0, z: 0 }), horizon = Math.min(period(orbit), 86400)): ImpactEstimate | null {
  if (!Number.isFinite(horizon)) horizon = 86400;
  if (horizon <= 0) return null;
  const initial = propagate(orbit, now);
  if (clearance(initial.position, now) <= 0) return result(initial, now);
  let lo = now;
  // Quadratic spacing resolves near-surface falls while covering a full orbit.
  const samples = Array.from({ length: 512 }, (_, i) => now + horizon * ((i + 1) / 512) ** 2);
  const pe = semiLatusRectum(orbit) > 0 ? timeToPeriapsis(orbit, now) : Infinity;
  if (pe > 0 && pe < horizon) samples.push(now + pe);
  samples.sort((a, b) => a - b);
  for (const hi of samples) {
    if (clearance(propagate(orbit, hi).position, hi) <= 0) {
      let a = lo, b = hi;
      for (let k = 0; k < 35; k++) {
        const m = (a + b) / 2;
        if (clearance(propagate(orbit, m).position, m) > 0) a = m; else b = m;
      }
      return result(propagate(orbit, b), b);
    }
    lo = hi;
  }
  return null;
  function result(s: StateVector, t: number): ImpactEstimate {
    const v = surfaceVelocity(s.position, t);
    return { time: t, position: s.position, velocity: s.velocity,
      speed: Math.hypot(s.velocity.x - v.x, s.velocity.y - v.y, s.velocity.z - v.z) };
  }
}

/** Constant mass/thrust and local gravity, vertical descent. Countdown includes gravity during coast. */
export function suicideBurn(altitude: number, verticalSpeed: number, gravity: number, acceleration: number) {
  if (verticalSpeed >= 0 || acceleration <= gravity || gravity <= 0 || altitude < 0) return null;
  const speed = -verticalSpeed, net = acceleration - gravity;
  const startAltitude = speed * speed / (2 * net);
  const coastDistance = Math.max(0, (altitude - startAltitude) * net / acceleration);
  const countdown = 2 * coastDistance / (Math.sqrt(speed * speed + 2 * gravity * coastDistance) + speed);
  return { startAltitude, countdown, burnTime: (speed + gravity * countdown) / net, overdue: altitude < startAltitude };
}

export function phaseAngle(position: Vec3, target: Vec3, normal: Vec3): number | null {
  const n = normalize(normal);
  const project = (v: Vec3) => normalize({ x: v.x - n.x * dot(v, n), y: v.y - n.y * dot(v, n), z: v.z - n.z * dot(v, n) });
  const a = project(position), b = project(target);
  if (length(n) === 0 || length(a) === 0 || length(b) === 0) return null;
  return Math.atan2(dot(n, cross(a, b)), dot(a, b));
}
export interface PlaneCrossing { kind: 'AN' | 'DN'; time: number; position: Vec3 }
/** Next ascending/descending crossings of a fixed target orbit plane, same central body. */
export function targetPlaneNodes(orbit: Orbit, targetNormal: Vec3, now: number, horizon = Number.isFinite(period(orbit)) ? period(orbit) : 86400): PlaneCrossing[] {
  if (!Number.isFinite(horizon) || horizon <= 0) return [];
  const n = normalize(targetNormal), s = propagate(orbit, now);
  const own = normalize(cross(s.position, s.velocity));
  if (length(n) === 0 || length(cross(own, n)) < 1e-7) return [];
  // Solve the two plane intersections in true anomaly, so eccentric orbits and
  // crossings exactly on sampling boundaries are handled without a time scan.
  const basis = elementsToState({ ...orbit, a: 1, e: 0, p: 1, m0: 0, epoch: 0, stateAtEpoch: undefined }, 0);
  const nu = Math.atan2(-dot(n, basis.position), dot(n, normalize(basis.velocity)));
  const out: PlaneCrossing[] = [];
  for (const anomaly of [nu, nu + Math.PI]) {
    if (1 + orbit.e * Math.cos(anomaly) <= 0) continue; // beyond an unbound asymptote
    const dt = timeToTrueAnomaly(orbit, anomaly, now + 1e-4) + 1e-4;
    if (!Number.isFinite(dt) || dt > horizon + 1e-5) continue;
    const time = now + dt, state = propagate(orbit, time);
    out.push({ kind: dot(state.velocity, n) > 0 ? 'AN' : 'DN', time, position: state.position });
  }
  return out.sort((a, b) => a.time - b.time);
}

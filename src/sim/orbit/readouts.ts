import type { Orbit, StateVector } from './api';
import { propagate, period } from './kepler';
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
  for (let i = 1; i <= 512; i++) {
    const hi = now + horizon * (i / 512) ** 2;
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
export function targetPlaneNodes(orbit: Orbit, targetNormal: Vec3, now: number, horizon = period(orbit)): PlaneCrossing[] {
  if (!Number.isFinite(horizon) || horizon <= 0) return [];
  const n = normalize(targetNormal), s = propagate(orbit, now);
  const own = normalize(cross(s.position, s.velocity));
  if (length(n) === 0 || length(cross(own, n)) < 1e-7) return [];
  const out: PlaneCrossing[] = [];
  let lo = now + 1e-4, z = dot(propagate(orbit, lo).position, n);
  for (let i = 1; i <= 128; i++) {
    const hi = now + horizon * i / 128, next = dot(propagate(orbit, hi).position, n);
    if (z * next < 0) {
      let a = lo, b = hi;
      for (let k = 0; k < 40; k++) {
        const mid = (a + b) / 2;
        if (dot(propagate(orbit, mid).position, n) * z > 0) a = mid; else b = mid;
      }
      const time = (a + b) / 2, state = propagate(orbit, time);
      out.push({ kind: dot(state.velocity, n) > 0 ? 'AN' : 'DN', time, position: state.position });
    }
    lo = hi; z = next;
  }
  return out;
}

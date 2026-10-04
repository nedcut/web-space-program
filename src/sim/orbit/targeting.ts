import type { StateVector, TrajectoryPatch } from './api';
import { closestApproach } from './patched';
import { period, propagate } from './kepler';
import { distance, length, sub } from '../../util/vec3';

/** Closest approach between a patched-conic trajectory and a target, for map markers and HUD readouts. */
export interface TrajectoryApproach {
  /** UT of closest approach. */
  time: number;
  /** Separation at closest approach, m. */
  distance: number;
  /** Relative speed at closest approach, m/s. */
  relativeSpeed: number;
  /** Body whose frame `positionA`/`positionB` are expressed in (the patch's parent body). */
  body: string;
  /** Vessel and target positions at `time`, relative to `body`. */
  positionA: StateVector['position'];
  positionB: StateVector['position'];
}

/**
 * Closest approach between `patches` (from now, `t0`) and a target whose state relative to any body at any
 * time is given by `target(bodyId, t)`. Each patch is searched over its own window (closed orbits: at most
 * `maxRevolutions` of the patch's period); the overall minimum is returned.
 */
export function trajectoryClosestApproach(
  patches: TrajectoryPatch[],
  target: (body: string, t: number) => StateVector,
  t0: number,
  maxRevolutions = 1.02,
): TrajectoryApproach | null {
  let best: TrajectoryApproach | null = null;
  for (const p of patches) {
    const start = Math.max(t0, p.startTime);
    let end = p.endTime;
    const T = period(p.orbit);
    if (Number.isFinite(T)) end = Math.min(end, start + T * maxRevolutions);
    if (!(end > start)) continue;
    const fn = (t: number) => target(p.orbit.body, t);
    let time: number;
    if (Number.isFinite(T)) time = closestApproach(p.orbit, fn, start, end).time;
    else {
      // Hyperbolic patch: closestApproach samples relative to the period, so sample uniformly here.
      const sep = (t: number) => distance(propagate(p.orbit, t).position, fn(t).position);
      const n = 512;
      time = start;
      let bd = sep(start);
      for (let k = 1; k <= n; k++) {
        const t = start + ((end - start) * k) / n;
        const d = sep(t);
        if (d < bd) (bd = d), (time = t);
      }
      let lo = Math.max(start, time - (end - start) / n), hi = Math.min(end, time + (end - start) / n);
      for (let k = 0; k < 60; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (sep(m1) < sep(m2)) hi = m2;
        else lo = m1;
      }
      time = (lo + hi) / 2;
    }
    const a = propagate(p.orbit, time);
    const b = fn(time);
    const d = distance(a.position, b.position);
    if (!best || d < best.distance)
      best = { time, distance: d, relativeSpeed: length(sub(a.velocity, b.velocity)), body: p.orbit.body, positionA: a.position, positionB: b.position };
  }
  return best;
}

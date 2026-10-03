import type { Body } from '../bodies/types';
import type { ManeuverNode, Orbit, StateVector, TrajectoryPatch } from './api';
import type { Ephemeris } from './ephemeris';
import { period, propagate, stateToElements } from './kepler';
import { maneuverToInertialDv } from './maneuver';
import { add, distance, dot, length, sub } from '../../util/vec3';

export interface TrajectoryPredictionOptions {
  ephem: Ephemeris;
  bodies: Map<string, Body>;
  initialBody: string;
  /** Relative to initialBody, in ecliptic axes. */
  state: StateVector;
  t0: number;
  maneuvers?: ManeuverNode[];
  /** Duration in seconds from t0. */
  horizon: number;
  maxPatches?: number;
  /** End the prediction at atmosphere entry (default false: continue to impact, ignoring drag). */
  stopAtAtmosphere?: boolean;
  /**
   * Altitude above the datum radius at which 'impact' is reported (default 0). Pass the terrain's maximum
   * height to get a conservative surface-clearance event over mountainous bodies.
   */
  impactAltitude?: (body: Body) => number;
}
interface Boundary {
  reason: TrajectoryPatch['endReason'];
  nextBody?: string;
  sample: (t: number) => { value: number; rate: number; speed: number; scale: number };
}
function minimize(fn: (t: number) => number, lo: number, hi: number, tolerance = 0.01): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = hi - ratio * (hi - lo), b = lo + ratio * (hi - lo), fa = fn(a), fb = fn(b);
  for (let k = 0; k < 100 && hi - lo > tolerance; k++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = hi - ratio * (hi - lo); fa = fn(a); }
    else { lo = a; a = b; fa = fb; b = lo + ratio * (hi - lo); fb = fn(b); }
  }
  return (lo + hi) / 2;
}
function crossing(boundary: Boundary, lo: number, hi: number): number {
  for (let k = 0; k < 80 && hi - lo > 0.05; k++) {
    const mid = (lo + hi) / 2;
    if (boundary.sample(mid).value > 0) lo = mid; else hi = mid;
  }
  return hi;
}

/** Patched two-body prediction; instantaneous burns, spherical SOIs and surfaces.
 * Impact/atmosphere terminate prediction. Returned last patch may stop early at maxPatches.
 */
export function predictTrajectory(options: TrajectoryPredictionOptions): TrajectoryPatch[] {
  const { ephem, bodies, t0, horizon } = options;
  if (!Number.isFinite(t0) || !Number.isFinite(horizon) || horizon < 0) throw new RangeError('Invalid prediction interval');
  const maxPatches = options.maxPatches ?? 16;
  if (!Number.isInteger(maxPatches) || maxPatches < 1) throw new RangeError('maxPatches must be a positive integer');
  const end = t0 + horizon, patches: TrajectoryPatch[] = [];
  const nodes = (options.maneuvers ?? []).filter(n => n.time >= t0 && n.time <= end).slice().sort((a, b) => a.time - b.time);
  let nodeIndex = 0, time = t0, bodyId = options.initialBody, state = options.state;
  while (time < end && patches.length < maxPatches) {
    const body = bodies.get(bodyId);
    if (!body) throw new RangeError(`Unknown body: ${bodyId}`);
    // Nodes at the initial instant or coincident with a boundary apply in the new local frame.
    while (nodeIndex < nodes.length && nodes[nodeIndex].time <= time) {
      state = { position: state.position, velocity: add(state.velocity, maneuverToInertialDv(state, nodes[nodeIndex++])) };
    }
    const orbit = stateToElements(body.gm, bodyId, state.position, state.velocity, time);
    const limit = Math.min(end, nodes[nodeIndex]?.time ?? Infinity);
    let cachedT = NaN, cachedState = state;
    const at = (t: number): StateVector => { if (t !== cachedT) { cachedT = t; cachedState = propagate(orbit, t); } return cachedState; };
    const boundaries: Boundary[] = [];
    function central(radius: number, direction: number, reason: Boundary['reason'], nextBody?: string): void {
      boundaries.push({ reason, nextBody, sample: t => {
        const s = at(t), r = length(s.position);
        return { value: direction * (r - radius), rate: direction * dot(s.position, s.velocity) / r, speed: length(s.velocity), scale: radius };
      } });
    }
    central(body.radius + (options.impactAltitude?.(body) ?? 0), 1, 'impact');
    if (body.atmosphere && options.stopAtAtmosphere) central(body.radius + body.atmosphere.height, 1, 'atmosphere');
    if (body.parent && Number.isFinite(body.soi)) central(body.soi, -1, 'soiExit', body.parent);
    for (const childId of body.children) {
      const child = bodies.get(childId);
      if (!child || !Number.isFinite(child.soi)) continue;
      boundaries.push({ reason: 'soiEnter', nextBody: childId, sample: t => {
        const s = at(t), c = ephem.getRelativeState(childId, t), r = sub(s.position, c.position), v = sub(s.velocity, c.velocity), R = length(r);
        return { value: R - child.soi, rate: R > 0 ? dot(r, v) / R : 0, speed: length(v), scale: child.soi };
      } });
    }
    let cursor = time, event: Boundary | undefined, eventTime = limit;
    for (const b of boundaries) {
      const sample = b.sample(cursor);
      if (sample.value < 0 || (sample.value === 0 && sample.rate < 0)) { event = b; eventTime = cursor; break; }
    }
    let steps = 0;
    while (!event && cursor < limit) {
      if (++steps > 500000) throw new RangeError('Prediction step budget exceeded; shorten horizon');
      const s = at(cursor), r = length(s.position);
      let dt = Math.min(3600, limit - cursor, 0.1 * Math.sqrt(r ** 3 / body.gm), 0.1 * r / Math.max(1, length(s.velocity)));
      const samples = boundaries.map(b => b.sample(cursor));
      for (const sample of samples) dt = Math.min(dt, 0.3 * Math.max(Math.abs(sample.value), sample.scale * 0.05) / Math.max(1, sample.speed));
      dt = Math.min(limit - cursor, Math.max(0.1, dt));
      const next = cursor + dt;
      for (let k = 0; k < boundaries.length; k++) {
        const b = boundaries[k], left = samples[k], right = b.sample(next);
        let bracketEnd: number | undefined;
        if (right.value <= 0) bracketEnd = next;
        // A complete grazing encounter may fit inside a step. Locate its minimum.
        else if (left.rate < 0 && right.rate > 0) {
          const minimum = minimize(t => b.sample(t).value, cursor, next);
          if (b.sample(minimum).value <= 0) bracketEnd = minimum;
        }
        if (bracketEnd !== undefined) {
          const hit = crossing(b, cursor, bracketEnd);
          if (!event || hit < eventTime) { event = b; eventTime = hit; }
        }
      }
      cursor = next;
    }
    const reason = event?.reason ?? (limit < end || (nodes[nodeIndex]?.time === end) ? 'maneuver' : 'horizon');
    patches.push({ orbit, startTime: time, endTime: eventTime, endReason: reason, ...(event?.nextBody ? { nextBody: event.nextBody } : {}) });
    if (reason === 'impact' || reason === 'atmosphere' || reason === 'horizon') break;
    state = at(eventTime); time = eventTime;
    if (event?.nextBody) {
      const old = ephem.getBodyState(bodyId, time), next = ephem.getBodyState(event.nextBody, time);
      state = { position: sub(add(old.position, state.position), next.position), velocity: sub(add(old.velocity, state.velocity), next.velocity) };
      bodyId = event.nextBody;
    }
  }
  return patches;
}

export interface ClosestApproach { time: number; distance: number; stateA: StateVector; stateB: StateVector }
/** Sample all local minima, then refine. Both trajectories MUST share origin and axes.
 * Arbitrary callbacks need a window short enough to resolve their fastest motion.
 */
export function closestApproach(orbitA: Orbit, orbitB: (t: number) => StateVector, t0: number, t1: number): ClosestApproach {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw new RangeError('Invalid targeting interval');
  const separation = (t: number): number => distance(propagate(orbitA, t).position, orbitB(t).position);
  const count = Math.min(16384, Math.max(128, Math.ceil((t1 - t0) / period(orbitA) * 128)));
  let bestTime = t0, bestDistance = separation(t0);
  const consider = (t: number): void => { const d = separation(t); if (d < bestDistance) { bestTime = t; bestDistance = d; } };
  let previous = bestDistance, current = separation(t0 + (t1 - t0) / count);
  for (let k = 1; k < count; k++) {
    const nextTime = t0 + (t1 - t0) * (k + 1) / count, next = separation(nextTime);
    if (current <= previous && current <= next) consider(minimize(separation, t0 + (t1 - t0) * (k - 1) / count, nextTime));
    previous = current; current = next;
  }
  consider(t1);
  return { time: bestTime, distance: bestDistance, stateA: propagate(orbitA, bestTime), stateB: orbitB(bestTime) };
}

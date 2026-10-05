import type { Body } from '../bodies/types';
import type { StateVector } from './api';
import type { Ephemeris } from './ephemeris';
import { add, addScaled, length, scale, sub, v3, type Vec3 } from '../../util/vec3';
export type AccelerationFn = (position: Vec3, t: number) => Vec3;
/** Absolute heliocentric acceleration (no indirect/non-inertial correction). */
export function gravityAccel(positionHelio: Vec3, t: number, bodies: Map<string, Body>, ephem: Ephemeris, mode: 'dominant' | 'nbody', dominantId: string): Vec3 {
  let acceleration = v3();
  if (mode === 'dominant' && !bodies.has(dominantId)) throw new RangeError(`Unknown body: ${dominantId}`);
  for (const b of bodies.values()) {
    if (mode === 'dominant' && b.id !== dominantId) continue;
    const delta = sub(ephem.getBodyState(b.id, t).position, positionHelio), r = length(delta);
    if (r === 0) throw new RangeError(`Gravity singularity at ${b.id}`);
    acceleration = addScaled(acceleration, delta, b.gm / r ** 3);
  }
  return acceleration;
}
/** Classical fourth-order Runge–Kutta; caller chooses dt/substeps for the desired accuracy. */
export function integrateState(state: StateVector, t: number, dt: number, accelFn: AccelerationFn): StateVector {
  const p = state.position, v = state.velocity;
  const a1 = accelFn(p, t);
  const v2 = addScaled(v, a1, dt / 2), a2 = accelFn(addScaled(p, v, dt / 2), t + dt / 2);
  const v3s = addScaled(v, a2, dt / 2), a3 = accelFn(addScaled(p, v2, dt / 2), t + dt / 2);
  const v4 = addScaled(v, a3, dt), a4 = accelFn(addScaled(p, v3s, dt), t + dt);
  return { position: addScaled(p, add(add(v, scale(add(v2, v3s), 2)), v4), dt / 6),
    velocity: addScaled(v, add(add(a1, scale(add(a2, a3), 2)), a4), dt / 6) };
}

/** Cached prescribed-body restricted n-body model. Stable catalogue order, all positive-GM sources.
 * Each integration frame receives direct central gravity plus every third body's tidal term.
 * Bodies retain their Kepler ephemerides; this is not a self-consistent massive-body integration.
 */
export function createGravityModel(bodies: Map<string, Body>, ephem: Ephemeris) {
  const cache = new Map<number, Map<string, StateVector>>();
  let count = bodies.size;
  function states(t: number) {
    if (count !== bodies.size) { cache.clear(); count = bodies.size; }
    let result = cache.get(t);
    if (!result) {
      result = new Map([...bodies.keys()].map(id => [id, ephem.getBodyState(id,t)]));
      if (cache.size >= 48) cache.delete(cache.keys().next().value!);
      cache.set(t,result);
    }
    return result;
  }
  function acceleration(frame: string, position: Vec3, t: number): Vec3 {
    const all = states(t), origin = all.get(frame)!.position;
    let acc = v3();
    for (const b of bodies.values()) {
      if (b.gm <= 0) continue;
      const d = b.id === frame ? scale(position,-1) : sub(all.get(b.id)!.position,origin);
      const delta = b.id === frame ? d : sub(d,position), r = length(delta);
      if (r === 0) throw new RangeError(`Gravity singularity at ${b.id}`);
      acc = addScaled(acc,delta,b.gm/r**3);
      if (b.id !== frame) acc = addScaled(acc,d,-b.gm/length(d)**3);
    }
    return acc;
  }
  function stepLimit(frame: string, state: StateVector, t: number) {
    const all = states(t), origin = all.get(frame)!;
    let limit = 86400;
    for (const b of bodies.values()) {
      if (b.gm <= 0) continue;
      const bs = all.get(b.id)!;
      const delta = sub(sub(bs.position,origin.position),state.position), r = length(delta);
      const speed = length(sub(sub(bs.velocity,origin.velocity),state.velocity));
      // Resolve both gravitational curvature and high-speed flybys before a close encounter.
      limit = Math.min(limit,.15*Math.sqrt(r**3/b.gm),.15*r/Math.max(speed,1e-9));
    }
    return limit;
  }
  return { states, acceleration, stepLimit };
}

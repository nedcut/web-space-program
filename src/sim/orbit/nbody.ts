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

import type { Orbit } from '../../sim/orbit/api';

/** Bound the entry frame to the local orbit; an escaping path has no finite apoapsis. */
export function orbitFrameDistance(radius: number, currentRadius: number, orbit?: Orbit): number {
  const ap = orbit && orbit.e < 1 ? orbit.a * (1 + orbit.e) : currentRadius;
  return 2.8 * Math.max(radius * 1.2, currentRadius, Math.min(ap, Math.max(currentRadius * 3, radius * 4)));
}

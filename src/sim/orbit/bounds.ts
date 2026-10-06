import type { Body } from '../bodies/types';

/** Bounds on a body centre's distance from the root (the Sun, at the inertial origin), metres. */
export interface DistanceRange { min: number; max: number }

const cache = new WeakMap<Map<string, Body>, { size: number; ranges: Map<string, DistanceRange> }>();

/**
 * Heliocentric distance range of every body from its Keplerian elements: [a(1−e), a(1+e)] for bodies orbiting
 * the root, widened by each moon's apoapsis down the parent chain; unbounded (hyperbolic) orbits give [0, ∞).
 * Lets callers rule out bodies (SOI containment, Sun occlusion, radiation belts) from the vessel's distance to
 * the Sun alone, without evaluating their ephemerides. Rebuilt when bodies are added (activated asteroids).
 */
export function heliocentricRanges(bodies: Map<string, Body>): Map<string, DistanceRange> {
  const hit = cache.get(bodies);
  if (hit && hit.size === bodies.size) return hit.ranges;
  const ranges = new Map<string, DistanceRange>();
  const rangeOf = (b: Body, depth = 0): DistanceRange => {
    const known = ranges.get(b.id);
    if (known) return known;
    let r: DistanceRange = { min: 0, max: Infinity };
    const parent = b.parent ? bodies.get(b.parent) : undefined;
    if (!b.parent) r = { min: 0, max: 0 };
    else if (parent && depth < 16) {
      const p = rangeOf(parent, depth + 1);
      const o = b.orbit;
      if (!o) r = p;
      else if (o.e >= 0 && o.e < 1 && o.a > 0 && Number.isFinite(o.a)) {
        const peri = o.a * (1 - o.e), apo = o.a * (1 + o.e);
        r = p.max === 0 ? { min: peri, max: apo } : { min: Math.max(0, p.min - apo), max: p.max + apo };
      }
    }
    ranges.set(b.id, r);
    return r;
  };
  for (const b of bodies.values()) rangeOf(b);
  cache.set(bodies, { size: bodies.size, ranges });
  return ranges;
}

/**
 * False only when a body with this range is certainly farther than `reach` from a point at distance `r` from the
 * Sun — or, with `segment`, from every point of the segment between that point and the Sun (all of whose points
 * lie within `r`). Triangle inequality, with a relative margin far above floating-point error.
 */
export function mayBeWithin(range: DistanceRange, r: number, reach: number, segment = false): boolean {
  const slack = reach + 1 + 1e-9 * (r + (Number.isFinite(range.max) ? range.max : 0));
  return range.min - r <= slack && (segment || r - range.max <= slack);
}

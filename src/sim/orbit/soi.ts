import type { Body } from '../bodies/types';
import type { Ephemeris } from './ephemeris';
import { distance, length, type Vec3 } from '../../util/vec3';
import { heliocentricRanges, mayBeWithin } from './bounds';
/** Deepest containing SOI; ties prefer the smallest sphere. Returns the body id. */
export function findDominantBody(ephem: Ephemeris, bodies: Map<string, Body>, positionHelio: Vec3, t: number): string {
  let best: Body | undefined, depth = -1;
  const ranges = heliocentricRanges(bodies), r = length(positionHelio);
  for (const b of bodies.values()) {
    // Bodies whose SOI cannot reach this heliocentric distance are skipped without evaluating their state.
    if (!mayBeWithin(ranges.get(b.id)!, r, b.soi)) continue;
    if (distance(positionHelio, ephem.getBodyState(b.id, t).position) > b.soi) continue;
    let d = 0, p = b.parent;
    const seen = new Set([b.id]);
    while (p) { if (seen.has(p)) throw new RangeError('Cyclic body hierarchy'); seen.add(p); d++; p = bodies.get(p)?.parent; }
    if (d > depth || (d === depth && b.soi < (best?.soi ?? Infinity))) { best = b; depth = d; }
  }
  if (!best) throw new RangeError('No containing body SOI');
  return best.id;
}

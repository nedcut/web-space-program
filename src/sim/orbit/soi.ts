import type { Body } from '../bodies/types';
import type { Ephemeris } from './ephemeris';
import { distance, type Vec3 } from '../../util/vec3';
/** Deepest containing SOI; ties prefer the smallest sphere. Returns the body id. */
export function findDominantBody(ephem: Ephemeris, bodies: Map<string, Body>, positionHelio: Vec3, t: number): string {
  let best: Body | undefined, depth = -1;
  for (const b of bodies.values()) {
    if (distance(positionHelio, ephem.getBodyState(b.id, t).position) > b.soi) continue;
    let d = 0, p = b.parent;
    const seen = new Set([b.id]);
    while (p) { if (seen.has(p)) throw new RangeError('Cyclic body hierarchy'); seen.add(p); d++; p = bodies.get(p)?.parent; }
    if (d > depth || (d === depth && b.soi < (best?.soi ?? Infinity))) { best = b; depth = d; }
  }
  if (!best) throw new RangeError('No containing body SOI');
  return best.id;
}

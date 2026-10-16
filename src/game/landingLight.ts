import { periapsisRadius, period, propagate, semiLatusRectum, stateToElements, timeToTrueAnomaly } from '../sim/orbit';
import { dot, length, normalize, scale, sub, type Vec3 } from '../util/vec3';
import { DEORBIT_PERIAPSIS } from './autopilot';
import type { Universe } from './universe';
import type { World, WorldVessel } from './world';

/** Sun at least this high (rad) at the predicted touchdown reads as daylight. */
export const DAYLIGHT_ELEVATION = (8 * Math.PI) / 180;
/**
 * A wait aims this high: the braking burn lands a few degrees of arc short of the coast's surface crossing, back
 * toward the night it came from (measured: predicted 9.4°, landed at 5.7°), and the descent itself should be lit.
 */
const WAIT_ELEVATION = (15 * Math.PI) / 180;
/** Deorbit start times tried per orbit when looking for a lit touchdown. */
const SAMPLES = 96;

/** Sun elevation above the local horizon (rad) at `rel` (body-relative, inertial axes) on `bodyId` at `t`. */
export function sunElevation(u: Universe, bodyId: string, rel: Vec3, t: number): number {
  const site = u.ephem.getBodyState(bodyId, t).position;
  const sun = u.ephem.getBodyState(u.sunId, t).position;
  const toSun = normalize(sub(sun, { x: site.x + rel.x, y: site.y + rel.y, z: site.z + rel.z }));
  return Math.asin(Math.max(-1, Math.min(1, dot(normalize(rel), toSun))));
}

/**
 * Where the Land assist's deorbit (retrograde until the periapsis is `DEORBIT_PERIAPSIS` radii below the datum)
 * started at `t0` meets the datum: the coast's surface crossing. The braking burn lands a little short of it.
 * Null when the vessel is not on a closed orbit.
 */
export function landHereTouchdown(world: World, wv: WorldVessel, t0 = world.ut): { time: number; position: Vec3 } | null {
  const body = world.universe.body(wv.body);
  const o = world.orbitOf(wv);
  if (!(o.e < 1)) return null;
  const s = propagate(o, t0);
  const target = body.radius * (1 + DEORBIT_PERIAPSIS);
  let after = stateToElements(body.gm, body.id, s.position, s.velocity, t0);
  if (periapsisRadius(after) > target) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (periapsisRadius(stateToElements(body.gm, body.id, s.position, scale(s.velocity, mid), t0)) > target) hi = mid;
      else lo = mid;
    }
    after = stateToElements(body.gm, body.id, s.position, scale(s.velocity, lo), t0);
  }
  if (length(s.position) <= body.radius) return { time: t0, position: s.position };
  const c = (semiLatusRectum(after) / body.radius - 1) / after.e;
  if (!(Math.abs(c) <= 1)) return null;
  // Inbound crossing (true anomaly in (π, 2π)).
  const time = t0 + timeToTrueAnomaly(after, -Math.acos(c), t0);
  return { time, position: propagate(after, time).position };
}

export interface LandingLight {
  /** Sun elevation at the predicted touchdown, rad. */
  elevation: number;
  /** Seconds to wait before starting the descent so it touches down well inside daylight; null if no start in the next orbit does. */
  daylightWait: number | null;
}

/** Day or night at a Land-here touchdown started now; the shortest wait (within one orbit) for a lit one. */
export function landingLight(world: World, wv: WorldVessel): LandingLight | null {
  const u = world.universe;
  const now = landHereTouchdown(world, wv);
  if (!now) return null;
  const elevation = sunElevation(u, wv.body, now.position, now.time);
  if (elevation >= DAYLIGHT_ELEVATION) return { elevation, daylightWait: 0 };
  const T = period(world.orbitOf(wv));
  for (let i = 1; i <= SAMPLES; i++) {
    const t0 = world.ut + (i * T) / SAMPLES;
    const td = landHereTouchdown(world, wv, t0);
    if (td && sunElevation(u, wv.body, td.position, td.time) >= WAIT_ELEVATION) return { elevation, daylightWait: t0 - world.ut };
  }
  return { elevation, daylightWait: null };
}

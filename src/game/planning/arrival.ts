import { sampleAtmosphere } from '../../sim/atmosphere';
import { length } from '../../util/vec3';
import type { PlanningWorld } from './context';

/**
 * Dynamic pressure at the vacuum periapsis that captures a capsule in one pass. Capsules trim heat-shield first
 * (less drag than the old tumbling entry): 25 kPa captures on every scale at 3.7 / 4.9 / 7.8 g (Standard /
 * Challenging / Real); 15 kPa skipped out on Real.
 */
export const ENTRY_DYNAMIC_PRESSURE = 25000;

/**
 * Default periapsis altitude when planning a transfer from `centralId` to `targetId`. Returning from a moon to an
 * atmospheric parent aims for a one-pass entry: the altitude where the arrival speed gives ENTRY_DYNAMIC_PRESSURE
 * (half the atmosphere height skips out on every scale). Arrivals from interplanetary space (a course correction
 * planned in solar orbit) keep the departure planner's safe periapsis, clear of the air: Entry trim aims into it on
 * purpose. Other arrivals keep half the atmosphere height, or 30 km.
 */
export function arrivalPeriapsisAltitude(world: PlanningWorld, centralId: string, targetId: string, t: number): number {
  const u = world.universe;
  const central = u.body(centralId), target = u.body(targetId), atmo = target.atmosphere;
  if (central.kind === 'star') return Math.max(target.radius * 0.1, (atmo?.height ?? 0) * 2, 30000);
  if (!atmo) return 30000;
  if (central.parent !== targetId) return atmo.height * 0.5;
  // Arrival speed at periapsis from a fall starting at the moon's distance.
  const ra = length(u.ephem.getRelativeState(centralId, t).position);
  const q = (h: number) => {
    const rp = target.radius + h;
    return 0.5 * sampleAtmosphere(atmo, h).density * target.gm * (2 / rp - 2 / (rp + ra));
  };
  let lo = atmo.height * 0.1, hi = atmo.height * 0.5;
  if (q(hi) >= ENTRY_DYNAMIC_PRESSURE) return hi;
  if (q(lo) <= ENTRY_DYNAMIC_PRESSURE) return lo;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (q(mid) > ENTRY_DYNAMIC_PRESSURE) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

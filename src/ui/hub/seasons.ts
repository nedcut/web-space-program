import { createUniverse, type ScalePresetId } from '../../sim/bodies';
import { createEphemeris } from '../../sim/orbit';
import { nextLaunchSeason } from '../../sim/orbit/season';
import type { Seasons } from './nextGoal';

const universes = new Map<ScalePresetId, { bodies: ReturnType<typeof createUniverse>; ephem: ReturnType<typeof createEphemeris> }>();

/** Days from `ut` to the next Earth → Venus and Earth → Mars launch seasons on this scale (hub guidance). */
export function launchSeasons(scale: ScalePresetId, ut: number): Seasons {
  let u = universes.get(scale);
  if (!u) { const bodies = createUniverse(scale); u = { bodies, ephem: createEphemeris(bodies) }; universes.set(scale, u); }
  const out: Seasons = {};
  for (const planet of ['venus', 'mars'] as const) {
    const s = nextLaunchSeason(u.bodies, u.ephem, 'earth', planet, ut);
    if (s) out[planet] = s.wait / 86400;
  }
  return out;
}

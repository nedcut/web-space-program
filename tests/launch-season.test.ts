import { describe, expect, it } from 'vitest';
import { createUniverse } from '../src/sim/bodies';
import { createEphemeris } from '../src/sim/orbit';
import { nextLaunchSeason } from '../src/sim/orbit/season';
import { DEFAULT_START_UT } from '../src/game/store';

const DAY = 86400;
const season = (preset: 'standard' | 'challenging' | 'real', to: string, ut = DEFAULT_START_UT + 30 * DAY) => {
  const bodies = createUniverse(preset);
  return nextLaunchSeason(bodies, createEphemeris(bodies), 'earth', to, ut);
};

describe('launch season estimate (hub guidance)', () => {
  it('lands near the map planner\'s departure window', () => {
    // The planner, from a parking orbit on day 30, found Mars 63–66 d (Standard) and Venus 282 d (Real) ahead.
    expect(season('standard', 'mars')!.wait / DAY).toBeGreaterThan(45);
    expect(season('standard', 'mars')!.wait / DAY).toBeLessThan(75);
    expect(season('real', 'venus')!.wait / DAY).toBeGreaterThan(260);
    expect(season('real', 'venus')!.wait / DAY).toBeLessThan(305);
  });

  it('comes round once per synodic period and refuses non-planet pairs', () => {
    const first = season('standard', 'venus')!;
    const next = season('standard', 'venus', first.departure + 30 * DAY)!;
    expect(next.departure - first.departure).toBeGreaterThan(first.synodic * 0.8);
    expect(next.departure - first.departure).toBeLessThan(first.synodic * 1.2);
    const bodies = createUniverse('standard');
    expect(nextLaunchSeason(bodies, createEphemeris(bodies), 'earth', 'moon', DEFAULT_START_UT)).toBeNull();
  });
});

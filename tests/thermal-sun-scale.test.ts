import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { Universe } from '../src/game/universe';
import { AU, buildVessel, stepThermal } from '../src/sim/vessel';
import { stackCraft } from '../src/sim/vessel/testing';
import { DEFAULT_START_UT } from '../src/game/store';

/**
 * Standard-scale universes compress lengths by s = 0.1, so solar irradiance from the compressed
 * Sun distance is 100x real. Solar panels keep that balance, but skin heating must use the real
 * distance: a sunlit white fairing glowed pink-hot (about 1,100 K) in a 1-AU-equivalent sky.
 */
describe('thermal sunlight under scaled universes', () => {
  it('reports an unscaled thermal distance of about 1 AU at Earth for every preset', () => {
    for (const preset of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(preset);
      const earth = u.ephem.getBodyState('earth', DEFAULT_START_UT).position;
      const sun = u.createEnvironment(() => 'earth').sun(earth, DEFAULT_START_UT);
      expect(sun.thermalDistance! / AU).toBeGreaterThan(0.95);
      expect(sun.thermalDistance! / AU).toBeLessThan(1.05);
    }
  });

  it('keeps a sunlit fairing near radiative equilibrium for real irradiance, not 1,000 K', () => {
    const v = buildVessel(stackCraft(['pod-lantern-1', 'fairing-1', 'dec-1', 'tank-1-long'], PART_CATALOG), PART_CATALOG);
    const u = new Universe('standard');
    const earth = u.ephem.getBodyState('earth', DEFAULT_START_UT).position;
    const sun = u.createEnvironment(() => 'earth').sun(earth, DEFAULT_START_UT);
    const ctx = { air: { pressure: 0, density: 0, temperature: 3, speedOfSound: 0 }, airVelocityBody: { x: 0, y: 0, z: 0 }, sunDirBody: { x: -1, y: 0, z: 0 }, sunDistance: sun.thermalDistance! };
    for (let i = 0; i < 2000; i++) stepThermal(v, ctx, 0.5);
    for (const p of v.parts) expect(Math.max(...p.skinTemperature)).toBeLessThan(450);
  });
});

import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildRingrunner } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { planTransferToBody } from '../src/game/autopilot';
import { periapsisRadius, propagate, stateToElements } from '../src/sim/orbit';
import { latLonToUnit, LAUNCH_SITE } from '../src/sim/terrain';
import { neutralInput } from '../src/sim/vessel';
import { add, cross, length, normalize, scale, sub, v3 } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

/** A circular parking orbit as a due-east launch from the pad leaves it (28.5° to the equator), on rails. */
function parkingOrbit(preset: 'standard' | 'real', ut: number, alt: number) {
  const world = new World(new Universe(preset), PART_CATALOG, ut);
  requireIntactFlight(world);
  const vessel = world.launch(buildRingrunner()), b = world.universe.body('earth'), e = world.universe.ephem;
  const r = b.radius + alt, bs = e.getBodyState('earth', world.ut);
  const up = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon), east = normalize(cross(v3(0, 0, 1), up));
  const pos = e.fromBodyFixed('earth', scale(up, r), world.ut), vel = scale(e.fromBodyFixed('earth', east, world.ut), Math.sqrt(b.gm / r));
  vessel.state.position = add(bs.position, pos); vessel.state.velocity = add(bs.velocity, vel);
  vessel.state.situation = 'flying'; vessel.mode = 'rails'; vessel.fixed = undefined;
  vessel.orbit = stateToElements(b.gm, b.id, pos, vel, world.ut);
  return { world, vessel };
}

/** Moon periapsis altitude shown by the map's patched-conic prediction (undefined without an encounter). */
function moonPe(world: World): number | undefined {
  const patches = world.trajectory();
  const i = patches.findIndex(p => p.nextBody === 'moon' && p.endReason === 'soiEnter');
  return i >= 0 && patches[i + 1] ? periapsisRadius(patches[i + 1].orbit) - world.universe.body('moon').radius : undefined;
}

/** Coast `seconds` of real time at 1× (the active vessel is unpacked into rigid-body physics). */
function coast(world: World, seconds: number) {
  for (let k = 0; k < seconds * 50; k++) world.tick(0.02, neutralInput());
}

describe('LEO → Moon transfer', () => {
  it('keeps an unpacked vessel on its patched conic (dominant-body physics frame)', () => {
    for (const preset of ['standard', 'real'] as const) {
      const { world, vessel } = parkingOrbit(preset, DEFAULT_START_UT, 250000);
      const orbit = vessel.orbit!;
      coast(world, 20);
      expect(vessel.mode).toBe('physics');
      const now = world.relativeState(vessel), kepler = propagate(orbit, world.ut);
      // Heliocentric integration with only Earth's gravity drifted 0.115 m/s here (Earth's solar acceleration).
      expect(length(sub(now.velocity, kepler.velocity))).toBeLessThan(0.002);
      expect(length(sub(now.position, kepler.position))).toBeLessThan(1);
    }
  }, 60000);

  it.each([
    ['standard', 100000, 6, 2],
    ['real', 200000, 3, 3],
  ] as const)('plans a stable Moon encounter from a pad-inclined %s parking orbit', (preset, alt, cases, maxDrift) => {
    const lunar = new Universe(preset).body('moon').orbitalPeriod!;
    for (let k = 0; k < cases; k++) {
      const { world } = parkingOrbit(preset, DEFAULT_START_UT + k * lunar / cases, alt);
      const plan = planTransferToBody(world, 'moon');
      expect(plan, `case ${k}`).not.toBeNull();
      expect(Math.abs(plan!.periapsisAltitude - 30000)).toBeLessThan(5000);
      // The first window, not the best of a whole lunar month: at most about half a lunar period away.
      expect(plan!.node.time - world.ut).toBeLessThan(lunar * 0.55);
      // The map shows the same encounter the planner promised…
      const pe0 = moonPe(world);
      expect(pe0, `case ${k}`).toBeDefined();
      expect(Math.abs(pe0! - plan!.periapsisAltitude)).toBeLessThan(1000);
      // …and it holds still while the player coasts at 1× (it used to wander by hundreds of km every 2 s).
      if (k === 0) {
        coast(world, 20);
        const pe1 = moonPe(world);
        expect(pe1).toBeDefined();
        expect(Math.abs(pe1! - pe0!)).toBeLessThan(maxDrift * 1000);
        // Warping to the burn and coasting the last minute at 1× still leaves the same encounter.
        world.advanceRailsTo(plan!.node.time - 60);
        coast(world, 20);
        const pe2 = moonPe(world);
        expect(pe2).toBeDefined();
        expect(Math.abs(pe2! - pe0!)).toBeLessThan(2 * maxDrift * 1000);
      }
    }
  }, 300000);
});

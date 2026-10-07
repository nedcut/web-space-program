import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { PHYSICS_DT, World } from '../src/game/world';
import { apoapsisRadius } from '../src/sim/orbit/kepler';
import { neutralInput } from '../src/sim/vessel';

/**
 * Cutting the throttle must feel immediate: thrust ends within ~0.1 s and the orbit readouts (HUD Ap/Pe and the
 * map path) stop changing right after it. Previously liquid engines decayed with their spool-up time constant
 * (thrust lingered ~4.6 s for the 1.0 s lifter) and the map path kept its pre-cut prediction for up to 2 s.
 */
function burnInOrbit(id: string) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  world.commsSettings.enabled = false;
  const wv = world.launch(STOCK_CRAFTS.find(s => s.id === id)!.build());
  placeInCircularOrbit(world, wv, 'earth', 250_000);
  world.tick(PHYSICS_DT, neutralInput({ throttle: 1, stage: true }));
  // Burn prograde for 3 s, querying the map path every frame as the flight map does.
  for (let i = 0; i < 150; i++) {
    world.tick(PHYSICS_DT, neutralInput({ throttle: 1, sas: 'prograde' }));
    world.trajectory();
  }
  expect(wv.state.telemetry.thrust).toBeGreaterThan(0);
  return { world, wv };
}

describe('throttle cut', () => {
  for (const id of ['stock-firstlight', 'stock-meridian']) {
    it(`${id}: thrust ends within 0.1 s and Ap stops changing`, () => {
      const { world, wv } = burnInOrbit(id);
      let tZero = Infinity;
      const ap: number[] = [];
      for (let i = 1; i <= 150; i++) {
        world.tick(PHYSICS_DT, neutralInput({ throttle: 0, sas: 'prograde' }));
        if (tZero === Infinity && wv.state.telemetry.thrust <= 0) tZero = i * PHYSICS_DT;
        ap.push(world.orbitSummary(wv).ap);
      }
      expect(tZero).toBeLessThanOrEqual(0.1 + 1e-9);
      // Ap 0.2 s after the cut is final (vacuum: only round-off changes it afterwards).
      expect(Math.abs(ap[149] - ap[9])).toBeLessThan(1);
    }, 60000);
  }

  it('the map path is refreshed as soon as the engines stop', () => {
    const { world, wv } = burnInOrbit('stock-meridian');
    const pathAp = () => apoapsisRadius(world.trajectory()[0].orbit) - world.universe.body(wv.body).radius;
    for (let i = 1; i <= 10; i++) {
      world.tick(PHYSICS_DT, neutralInput({ throttle: 0, sas: 'prograde' }));
      world.trajectory();
    }
    expect(wv.state.telemetry.thrust).toBe(0);
    expect(Math.abs(pathAp() - world.orbitSummary(wv).ap)).toBeLessThan(1);
  }, 60000);
});

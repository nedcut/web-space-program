import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { PHYSICS_DT, World } from '../src/game/world';
import { apoapsisRadius, periapsisRadius } from '../src/sim/orbit/kepler';
import { neutralInput } from '../src/sim/vessel';
import { add, scale } from '../src/util/vec3';

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

  it('map path during a lunar capture burn: live current conic, no branch flicker, full path right after the cut', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    world.commsSettings.enabled = false;
    const wv = world.launch(STOCK_CRAFTS.find(s => s.id === 'stock-meridian')!.build());
    placeInCircularOrbit(world, wv, 'moon', 30_000);
    // Hyperbolic lunar flyby whose escape leads back into Earth orbit and re-encounters the Moon (the chaotic case).
    const moon = world.universe.ephem.getBodyState('moon', world.ut);
    const vhat = scale(moon.velocity, 1 / Math.hypot(moon.velocity.x, moon.velocity.y, moon.velocity.z));
    const rhat = scale(moon.position, 1 / Math.hypot(moon.position.x, moon.position.y, moon.position.z));
    wv.state.position = add(moon.position, add(scale(vhat, 2.5e6), scale(rhat, 6e5)));
    wv.state.velocity = add(moon.velocity, scale(vhat, -330));
    world.tick(PHYSICS_DT, neutralInput({ throttle: 0, stage: true }));
    const shapes = new Set<string>();
    let maxErr = 0;
    for (let f = 0; f < 60 * 8; f++) {
      world.tick(1 / 60, neutralInput({ throttle: 1, sas: 'retrograde' }));
      const path = world.mapTrajectory();
      if (f < 60) continue; // engines spooling up
      expect(wv.state.telemetry.thrust).toBeGreaterThan(0);
      maxErr = Math.max(maxErr, Math.abs(periapsisRadius(path[0].orbit) - periapsisRadius(world.orbitOf(wv))));
      expect(path.length).toBeLessThanOrEqual(2);
      shapes.add(path.map(p => `${p.orbit.body}:${p.endReason}`).join('>'));
    }
    expect(maxErr).toBeLessThan(1);
    expect(shapes.size).toBe(1);
    for (let f = 0; f < 12; f++) world.tick(1 / 60, neutralInput({ throttle: 0, sas: 'retrograde' }));
    expect(wv.state.telemetry.thrust).toBe(0);
    const path = world.mapTrajectory();
    expect(path.length).toBeGreaterThan(2);
    expect(Math.abs(periapsisRadius(path[0].orbit) - periapsisRadius(world.orbitOf(wv)))).toBeLessThan(1);
  }, 60000);
});

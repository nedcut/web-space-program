import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { HOLD_DOWN_MAX, PHYSICS_DT, World, type WorldVessel } from '../src/game/world';
import { bodyToWorld, neutralInput } from '../src/sim/vessel';
import { qConj, qRotate } from '../src/util/quat';
import { dot, length, normalize, sub, v3, type Vec3 } from '../src/util/vec3';

/**
 * Handling on the ground: the pad hold-down, rest jitter and liftoff of the stock rockets, measured through the
 * World exactly as the flight scene drives it (50 Hz steps).
 */
const craft = (id: string) => STOCK_CRAFTS.find(s => s.id === id)!.build();

function mkWorld() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  world.commsSettings.enabled = false;
  return world;
}

/** A point in the body's rotating frame. */
function bodyFixed(world: World, wv: WorldVessel, p: Vec3): Vec3 {
  const bs = world.universe.ephem.getBodyState(wv.body, world.ut);
  return qRotate(qConj(world.universe.ephem.bodyRotation(wv.body, world.ut)), sub(p, bs.position));
}
/** The vessel's root part position in the body-fixed frame (moves only if the structure moves). */
const rootFixed = (world: World, wv: WorldVessel) => bodyFixed(world, wv, bodyToWorld(wv.state, wv.state.parts[0].position));

describe('hold-down clamps', () => {
  for (const id of ['stock-kestrel', 'stock-meridian', 'stock-selene']) {
    it(`${id}: pinned while the engines spool, then lifts off without sagging`, () => {
      const world = mkWorld();
      const wv = world.launch(craft(id));
      const up = normalize(rootFixed(world, wv));
      const r0 = rootFixed(world, wv);
      world.tick(PHYSICS_DT, neutralInput({ throttle: 1, sas: 'stabilityAssist', stage: true }));
      let held = 0, minRise = Infinity, maxDrift = 0;
      for (let i = 0; i < 50 * 6; i++) {
        world.tick(PHYSICS_DT, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
        const d = sub(rootFixed(world, wv), r0);
        if (wv.holdDown) { held++; maxDrift = Math.max(maxDrift, length(d)); }
        else minRise = Math.min(minRise, dot(d, up));
      }
      expect(wv.mode).toBe('physics');
      // Held for at most HOLD_DOWN_MAX; the structure does not move while held (COM shifts are followed).
      expect(held * PHYSICS_DT).toBeLessThanOrEqual(HOLD_DOWN_MAX);
      expect(maxDrift).toBeLessThan(1e-3);
      // Never sinks into the pad after release (> 2 cm would read as a hop/sag), and climbs.
      expect(minRise).toBeGreaterThan(-0.02);
      expect(dot(sub(rootFixed(world, wv), r0), up)).toBeGreaterThan(5);
    }, 60000);
  }

  it('releases straight away when staged with the throttle closed', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-meridian'));
    world.tick(PHYSICS_DT, neutralInput({ throttle: 0, stage: true }));
    world.tick(PHYSICS_DT, neutralInput({ throttle: 0 }));
    expect(wv.holdDown).toBeUndefined();
    expect(wv.mode).toBe('physics');
  });
});

describe('rest on the pad', () => {
  for (const id of ['stock-kestrel', 'stock-meridian', 'stock-selene', 'stock-ringrunner']) {
    it(`${id}: no jitter before staging`, () => {
      const world = mkWorld();
      const wv = world.launch(craft(id));
      const r0 = rootFixed(world, wv);
      let maxMove = 0, maxW = 0;
      for (let i = 0; i < 50 * 5; i++) {
        world.tick(PHYSICS_DT, neutralInput({ sas: 'stabilityAssist' }));
        maxMove = Math.max(maxMove, length(sub(rootFixed(world, wv), r0)));
        // Relative to the co-rotating pad.
        const spin = qRotate(qConj(wv.state.orientation), qRotate(world.universe.ephem.bodyRotation(wv.body, world.ut), v3(0, 0, world.universe.body(wv.body).rotationRate)));
        maxW = Math.max(maxW, length(sub(wv.state.angularVelocity, spin)));
      }
      expect(maxMove).toBeLessThan(1e-4);
      expect(maxW).toBeLessThan(1e-6);
    }, 60000);
  }
});

import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { stepWarp, warpRefusal, type WarpContext, type WarpState } from '../src/game/timewarp';
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

describe('runway spawn', () => {
  for (const id of ['stock-swift', 'stock-daybreak']) {
    it(`${id}: starts at rest on compressed gear (no drop onto the wheels, no rocking)`, () => {
      const world = mkWorld();
      const wv = world.launch(craft(id), 'runway');
      const c0 = bodyFixed(world, wv, wv.state.position);
      const up = normalize(c0);
      let maxVz = 0, minH = 0;
      for (let i = 0; i < 50 * 3; i++) {
        world.tick(PHYSICS_DT, neutralInput({ brakes: true }));
        maxVz = Math.max(maxVz, Math.abs(dot(world.surfaceVelocity(wv), up)));
        minH = Math.min(minH, dot(sub(bodyFixed(world, wv, wv.state.position), c0), up));
      }
      // Previously 0.8–1.1 m/s and a 15–30 cm drop as the gear took the weight.
      expect(maxVz).toBeLessThan(0.05);
      expect(minH).toBeGreaterThan(-0.01);
      // No wheel bottomed out on its stops.
      for (const p of wv.state.parts) if (p.wheel) expect(p.wheel.inContact).toBe(true);
    }, 60000);
  }
});

describe('time warp refusals', () => {
  const ctx = (o: Partial<WarpContext> = {}): WarpContext => ({ thrusting: false, inAtmosphere: false, landed: false, altitude: 200_000, bodyRadius: 637_100, atmosphereHeight: 70_000, ...o });
  const up = (w: WarpState, c: WarpContext) => warpRefusal(w, stepWarp(w, 1, c), c)?.text ?? null;

  it('stays quiet when warp goes up as asked', () => {
    expect(up({ mode: 'rails', index: 0 }, ctx())).toBeNull();
    expect(up({ mode: 'rails', index: 3 }, ctx())).toBeNull();
  });
  it('explains physics warp and its limit while thrusting or in the atmosphere', () => {
    expect(up({ mode: 'rails', index: 0 }, ctx({ thrusting: true }))).toMatch(/Physics warp 2×: engines are firing/);
    expect(up({ mode: 'physics', index: 3 }, ctx({ inAtmosphere: true, altitude: 20_000 }))).toMatch(/maximum \(in the atmosphere\)/);
  });
  it('names the altitude the next rails rate needs', () => {
    // 200 km over a 70 km atmosphere allows 10k× (index 6, 63.7 km clearance); 100k× needs 318.6 km clearance.
    const w = { mode: 'rails' as const, index: 6 };
    expect(stepWarp(w, 1, ctx()).index).toBe(6);
    expect(up(w, ctx())).toBe('Cannot warp to 100k× below 389 km altitude');
  });
  it('World.changeWarp posts the reason once, however often the key is pressed', () => {
    const world = mkWorld();
    world.launch(craft('stock-meridian'));
    world.tick(PHYSICS_DT, neutralInput({ throttle: 1, stage: true }));
    for (let i = 0; i < 5; i++) world.changeWarp(1);
    expect(world.warp.mode).toBe('physics');
    expect(world.messages.filter(m => /warp/i.test(m.text)).map(m => m.text)).toEqual(['Physics warp 2×: engines are firing', 'Physics warp is at its 4× maximum (engines are firing)']);
  });
});

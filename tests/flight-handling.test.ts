import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { stepWarp, warpRefusal, type WarpContext, type WarpState } from '../src/game/timewarp';
import { HOLD_DOWN_MAX, PHYSICS_DT, World, type WorldVessel } from '../src/game/world';
import { bodyToWorld, neutralInput } from '../src/sim/vessel';
import { qConj, qRotate } from '../src/util/quat';
import { hullPoints } from '../src/sim/vessel/shapes';
import { add, dot, length, normalize, sub, v3, type Vec3 } from '../src/util/vec3';

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

describe('stage separation clearance', () => {
  const hull = (v: WorldVessel['state']) => v.parts.flatMap(p => hullPoints(p.def).map(hp => bodyToWorld(v, add(p.position, qRotate(p.rotation, hp)))));
  const gap = (a: WorldVessel['state'], b: WorldVessel['state']) => {
    const ha = hull(a), hb = hull(b);
    let m = Infinity;
    for (const x of ha) for (const y of hb) m = Math.min(m, length(sub(x, y)));
    return m;
  };
  for (const id of ['stock-kestrel', 'stock-meridian', 'stock-homeward']) {
    it(`${id}: spent stages drift clear after a flameout staging in a gravity turn`, () => {
      const world = mkWorld();
      const wv = world.launch(craft(id));
      let stage = true, kicked = false, since = 0, checked = 0;
      const debris: { v: WorldVessel; t0: number; gaps: number[] }[] = [];
      for (let i = 0; i < 50 * 200 && checked < 2; i++) {
        const up = normalize(world.relativeState(wv).position);
        const nose = qRotate(wv.state.orientation, v3(0, 1, 0));
        const turning = !kicked && length(world.surfaceVelocity(wv)) > 50;
        if (turning && dot(nose, up) < Math.cos(6 * Math.PI / 180)) kicked = true;
        if (i > 100 && wv.state.telemetry.thrust <= 0 && since > 50 && wv.state.nextStage >= 0) stage = true;
        const before = new Set(world.vessels.keys());
        world.tick(PHYSICS_DT, neutralInput({ throttle: 1, sas: kicked ? 'prograde' : 'stabilityAssist', sasReference: 'surface', yaw: turning && !kicked ? 0.25 : 0, stage }));
        since = stage ? 0 : since + 1;
        stage = false;
        for (const [k, v] of world.vessels) if (!before.has(k) && v !== wv && v.state.parts.length > 1) debris.push({ v, t0: i, gaps: [] });
        for (const d of debris) if (world.vessels.has(d.v.state.id) && [10, 50, 150].includes(i - d.t0)) { d.gaps.push(gap(wv.state, d.v.state)); if (d.gaps.length === 3) checked++; }
        expect(wv.state.destroyed).toBe(false);
      }
      expect(checked).toBeGreaterThan(0);
      for (const d of debris.filter(x => x.gaps.length === 3)) {
        // Measured: 0.15–0.7 m after 0.2 s, 0.3–3 m after 1 s, 5–16 m after 3 s; never closing back in.
        expect(d.gaps[1]).toBeGreaterThan(d.gaps[0]);
        expect(d.gaps[2]).toBeGreaterThan(Math.max(3, d.gaps[1]));
      }
    }, 120000);
  }
});

import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { placeInCircularOrbit, placeOnSurface } from '../src/game/scenarios';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { PHYSICS_DT, World, type WorldVessel } from '../src/game/world';
import { vesselModeProblems } from '../src/game/world/vesselMode';
import { bodyToWorld, neutralInput, type ControlInput } from '../src/sim/vessel';
import { isSolidMotor } from '../src/sim/vessel/engines';
import { qConj, qRotate } from '../src/util/quat';
import { length, sub, v3 } from '../src/util/vec3';

/**
 * Pad hold-down is explicit, saved vessel state: an engine lit from the pad is a static fire (the clamps hold
 * until the player stages), staging is a launch hold, and both survive save/load unchanged.
 */
const universe = new Universe('standard');
const craft = (id: string) => STOCK_CRAFTS.find(s => s.id === id)!.build();
function mkWorld() {
  const world = new World(universe, PART_CATALOG, DEFAULT_START_UT);
  world.commsSettings.enabled = false;
  return world;
}
const reload = (world: World) => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))), PART_CATALOG, universe);
/** Root part in the body-fixed frame: moves only if the structure moves. */
function rootFixed(world: World, wv: WorldVessel) {
  const bs = world.universe.ephem.getBodyState(wv.body, world.ut);
  return qRotate(qConj(world.universe.ephem.bodyRotation(wv.body, world.ut)), sub(bodyToWorld(wv.state, wv.state.parts[0].position), bs.position));
}
/** The launch stage's liquid engine (the lowest engine that can be shut down). */
function padEngine(wv: WorldVessel) {
  return wv.state.parts.filter(p => p.engine && !isSolidMotor(p.def.modules[p.engine.moduleIndex] as never)).sort((a, b) => a.position.y - b.position.y)[0];
}
function run(world: World, seconds: number, input: Partial<ControlInput> = {}) {
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) {
    world.tick(PHYSICS_DT, neutralInput({ throttle: 1, ...input }));
    for (const v of world.vessels.values()) expect(vesselModeProblems(v), v.state.id).toEqual([]);
  }
}

describe('pad engine test (static fire)', () => {
  it('runs the engine pinned to the pad, never releases on its own, and loads the same way', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-meridian'));
    const engine = padEngine(wv);
    const fuel = () => wv.state.parts.reduce((s, p) => s + (p.resources.liquidFuel ?? 0), 0);
    const r0 = rootFixed(world, wv), fuel0 = fuel();
    world.tick(PHYSICS_DT, neutralInput({ throttle: 1, commands: [{ kind: 'part', uid: engine.uid, action: 'engine.activate' }] }));
    expect(engine.engine!.ignited).toBe(true);
    run(world, 5);
    expect(wv.mode).toBe('prelaunch');
    expect(wv.holdDown?.launch).toBe(false);
    // The engine really runs: thrust and propellant use, while the structure stays put.
    expect(engine.engine!.thrust).toBeGreaterThan(0);
    expect(fuel()).toBeLessThan(fuel0);
    expect(length(sub(rootFixed(world, wv), r0))).toBeLessThan(1e-3);

    // After save/load it is still a static fire, not a launch.
    const loaded = reload(world);
    const lv = loaded.active!;
    expect(lv.holdDown).toEqual(wv.holdDown);
    run(loaded, 5);
    expect(lv.mode).toBe('prelaunch');
    expect(lv.holdDown?.launch).toBe(false);

    // Staging turns the static fire into a launch (already at full thrust: liftoff at once).
    loaded.tick(PHYSICS_DT, neutralInput({ throttle: 1, stage: true }));
    expect(lv.mode).toBe('physics');
    run(loaded, 4);
    expect(lv.state.situation).toBe('flying');
  }, 60000);

  it('goes back to a plain pad vessel when the engine is shut down', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-meridian'));
    const engine = padEngine(wv);
    world.tick(PHYSICS_DT, neutralInput({ commands: [{ kind: 'part', uid: engine.uid, action: 'engine.activate' }] }));
    run(world, 1);
    world.tick(PHYSICS_DT, neutralInput({ commands: [{ kind: 'part', uid: engine.uid, action: 'engine.shutdown' }] }));
    run(world, 0.1);
    expect(wv.mode).toBe('prelaunch');
    expect(wv.holdDown).toBeUndefined();
  });

  it('applies a pad command once while held (a toggle does not undo itself)', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-meridian'));
    const engine = padEngine(wv);
    world.tick(PHYSICS_DT, neutralInput({ commands: [{ kind: 'part', uid: engine.uid, action: 'engine.toggle' }] }));
    run(world, 0.5);
    expect(engine.engine!.ignited).toBe(true);
    world.tick(PHYSICS_DT, neutralInput({ commands: [{ kind: 'part', uid: engine.uid, action: 'engine.toggle' }] }));
    expect(engine.engine!.ignited).toBe(false);
  });

  it('treats an old save with a lit engine on the pad as a static fire', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-meridian'));
    padEngine(wv).engine!.ignited = true;
    const saved = JSON.parse(JSON.stringify(serializeWorld(world)));
    for (const v of saved.vessels) delete v.holdDown;
    const loaded = deserializeWorld(saved, PART_CATALOG, universe);
    expect(loaded.active!.holdDown?.launch).toBe(false);
    run(loaded, 5);
    expect(loaded.active!.mode).toBe('prelaunch');
  }, 30000);
});

describe('launch hold save/load', () => {
  it('keeps the clamp timer: a loaded copy releases on the same step as the live vessel', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-kestrel'));
    world.tick(PHYSICS_DT, neutralInput({ throttle: 1, stage: true }));
    run(world, 0.2);
    expect(wv.holdDown?.launch).toBe(true);
    const loaded = reload(world);
    const lv = loaded.active!;
    expect(lv.holdDown).toEqual(wv.holdDown);
    for (let i = 0; i < 50 * 4; i++) {
      world.tick(PHYSICS_DT, neutralInput({ throttle: 1 }));
      loaded.tick(PHYSICS_DT, neutralInput({ throttle: 1 }));
      expect(lv.mode, `step ${i}`).toBe(wv.mode);
      expect(lv.holdDown?.time, `step ${i}`).toBe(wv.holdDown?.time);
    }
    expect(wv.mode).toBe('physics');
  }, 30000);
});

describe('vessel mode transitions', () => {
  it('scenario placement releases a held vessel', () => {
    for (const place of [
      (w: World, v: WorldVessel) => placeInCircularOrbit(w, v, 'earth', 200000),
      (w: World, v: WorldVessel) => placeOnSurface(w, v, 'moon', v3(1, 0, 0)),
    ]) {
      const world = mkWorld();
      const wv = world.launch(craft('stock-kestrel'));
      world.tick(PHYSICS_DT, neutralInput({ throttle: 1, stage: true }));
      expect(wv.holdDown).toBeDefined();
      place(world, wv);
      expect(wv.mode).toBe('physics');
      expect(vesselModeProblems(wv)).toEqual([]);
    }
  });

  it('reports broken mode invariants', () => {
    const world = mkWorld();
    const wv = world.launch(craft('stock-kestrel'));
    expect(vesselModeProblems(wv)).toEqual([]);
    expect(vesselModeProblems({ ...wv, mode: 'physics' })).not.toEqual([]);
    expect(vesselModeProblems({ ...wv, fixed: undefined })).not.toEqual([]);
    expect(vesselModeProblems({ ...wv, mode: 'rails', fixed: undefined })).not.toEqual([]);
  });
});

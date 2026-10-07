import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { PHYSICS_DT, World } from '../src/game/world';
import { slerp } from '../src/game/world/renderInterpolation';
import { neutralInput } from '../src/sim/vessel';

const climbInput = (stage = false) => neutralInput({ throttle: 1, sas: 'stabilityAssist', stage, pitch: 0.1 });

function launched() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const wv = world.launch(buildOrbiter());
  world.tick(PHYSICS_DT, climbInput(true));
  for (let i = 0; i < 250; i++) world.tick(PHYSICS_DT, climbInput());
  return { world, wv };
}

/** Render-frame positions of the vessel relative to Earth's centre (what makes the ground appear to move). */
function framePath(world: World, hz: number | ((i: number) => number), frames: number, interpolate: boolean) {
  const out: { x: number; y: number; z: number }[] = [];
  const wv = world.active!;
  for (let i = 0; i < frames; i++) {
    world.tick(typeof hz === 'number' ? 1 / hz : hz(i), climbInput());
    let t = world.ut;
    let restore = () => {};
    if (interpolate) ({ renderUt: t, restore } = world.renderHistory.apply(world.ut, PHYSICS_DT, world.renderAlpha, world.vessels.values(), world.universe.ephem));
    const earth = world.universe.ephem.getBodyState(wv.body, t).position;
    out.push({ x: wv.state.position.x - earth.x, y: wv.state.position.y - earth.y, z: wv.state.position.z - earth.z });
    restore();
  }
  return out;
}

/** Largest frame-to-frame change in displacement, relative to the mean per-frame displacement. */
function judder(path: { x: number; y: number; z: number }[]) {
  const d: number[] = [];
  for (let i = 1; i < path.length; i++) d.push(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  let worst = 0;
  for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
  return worst / mean;
}

describe('render interpolation between fixed physics steps', () => {
  it('does not change the simulation (bit-identical state with and without render interpolation)', () => {
    const a = launched();
    const b = launched();
    for (let i = 0; i < 400; i++) {
      const dt = [1 / 144, 1 / 60, 1 / 75, 1 / 30][i % 4];
      a.world.tick(dt, climbInput());
      b.world.tick(dt, climbInput());
      const { restore } = b.world.renderHistory.apply(b.world.ut, PHYSICS_DT, b.world.renderAlpha, b.world.vessels.values(), b.world.universe.ephem);
      restore();
    }
    expect(b.world.ut).toBe(a.world.ut);
    expect(b.wv.state.position).toEqual(a.wv.state.position);
    expect(b.wv.state.velocity).toEqual(a.wv.state.velocity);
    expect(b.wv.state.orientation).toEqual(a.wv.state.orientation);
    expect(b.wv.state.angularVelocity).toEqual(a.wv.state.angularVelocity);
  }, 60000);

  for (const hz of [60, 120, 144]) {
    it(`advances evenly at ${hz} Hz (judder ratio)`, () => {
      const raw = judder(framePath(launched().world, hz, hz * 2, false));
      const smooth = judder(framePath(launched().world, hz, hz * 2, true));
      console.log(`${hz} Hz judder: raw ${raw.toFixed(3)} -> interpolated ${smooth.toFixed(4)}`);
      // Raw state jumps 0 or 1 whole step per frame; interpolated motion only varies with acceleration.
      expect(raw).toBeGreaterThan(0.9);
      expect(smooth).toBeLessThan(0.02);
    }, 60000);
  }

  it('stays smooth with uneven frame times and in physics warp', () => {
    // Seeded frame times between 6 and 22 ms (a browser with hitches); judge apparent speed = displacement / dt.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const dts = Array.from({ length: 240 }, () => 0.006 + rnd() * 0.016);
    const speedJudder = (path: { x: number; y: number; z: number }[], dt: (i: number) => number) => {
      const v: number[] = [];
      for (let i = 1; i < path.length; i++) v.push(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z) / dt(i));
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i]))) / mean;
    };
    const uneven = speedJudder(framePath(launched().world, i => dts[i], dts.length, true), i => dts[i]);
    const w = launched().world;
    w.warp = { mode: 'physics', index: 3 };
    const warped = judder(framePath(w, 60, 120, true));
    console.log(`uneven frame times: speed judder ${uneven.toFixed(4)}; 4× physics warp at 60 Hz: judder ${warped.toFixed(4)}`);
    expect(uneven).toBeLessThan(0.03);
    expect(warped).toBeLessThan(0.02);
  }, 60000);

  it('renders at most one step behind and never in the future', () => {
    const { world } = launched();
    for (let i = 0; i < 100; i++) {
      world.tick(1 / 144, climbInput());
      const { renderUt, restore } = world.renderHistory.apply(world.ut, PHYSICS_DT, world.renderAlpha, world.vessels.values(), world.universe.ephem);
      restore();
      expect(renderUt).toBeLessThanOrEqual(world.ut + 1e-9);
      expect(renderUt).toBeGreaterThanOrEqual(world.ut - PHYSICS_DT - 1e-9);
    }
  }, 60000);

  it('slerp takes the short path and stays normalised', () => {
    const a = { x: 0, y: 0, z: 0, w: 1 };
    const b = { x: 0, y: 0, z: -Math.sin(0.2), w: -Math.cos(0.2) };
    const m = slerp(a, b, 0.5);
    expect(Math.hypot(m.x, m.y, m.z, m.w)).toBeCloseTo(1, 12);
    expect(Math.abs(m.z)).toBeCloseTo(Math.sin(0.1), 9);
  });
});

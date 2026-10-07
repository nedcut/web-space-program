import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { placeInCircularOrbit } from '../src/game/scenarios';
import type { Autopilot } from '../src/game/autopilot';
import { assistFrame, createAssist, type AssistId } from '../src/flight/assist';
import { neutralInput } from '../src/sim/vessel';
import type { ControlInput } from '../src/sim/vessel/runtime';
import { add, length, normalize, scale, v3 } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

/** The flight scene's assist loop (`assistFrame`), frame by frame; `pilot` supplies the pilot's input per frame. */
function drive(world: World, assist: Autopilot, seconds: number, pilot: () => Partial<ControlInput> = () => ({})) {
  const dt = 1 / 60;
  const state = { warped: false };
  const end = world.ut + seconds;
  while (world.ut < end) {
    const frame = assistFrame(world, assist, neutralInput({ sas: 'stabilityAssist', ...pilot() }), dt, state);
    world.tick(dt, frame.input);
    if (frame.ended) return frame.ended;
  }
  return undefined;
}

function hold(world: World, seconds: number, input: Partial<ControlInput>) {
  for (let t = 0; t < seconds; t += 1 / 60) world.tick(1 / 60, neutralInput(input));
}

/** What the pilot gets back: pitch input turns the craft (gimbal deflects under thrust) and SAS damps a spin. */
function probe(world: World) {
  const v = world.active!.state;
  // Hands off for a moment first: the craft must already be flyable (not packed on rails) without any input.
  hold(world, 0.5, { sas: 'stabilityAssist' });
  const handback = { mode: world.active!.mode, warp: world.warp.index };
  const w0 = length(v.angularVelocity);
  let maxGimbal = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    world.tick(1 / 60, neutralInput({ sas: 'off', pitch: 1, throttle: 1 }));
    for (const p of v.parts) if (p.engine?.ignited) maxGimbal = Math.max(maxGimbal, Math.hypot(p.engine.gimbal?.a ?? 0, p.engine.gimbal?.b ?? 0));
  }
  const thrust = v.telemetry.thrust;
  const turn = length(v.angularVelocity) - w0;
  hold(world, 0.2, { sas: 'off', throttle: 0 });
  v.angularVelocity = v3(0.05, 0, 0.05);
  const spin0 = length(v.angularVelocity);
  hold(world, 4, { sas: 'stabilityAssist' });
  return { ...handback, thrust, turn, maxGimbal, spin0, spin1: length(v.angularVelocity) };
}

function selene(orbit: boolean) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  if (orbit) placeInCircularOrbit(world, wv, 'earth', Math.max(90000, world.universe.body('earth').atmosphere!.height + 80000));
  return world;
}

function expectControl(r: ReturnType<typeof probe>, label: string) {
  console.log(label, JSON.stringify(r));
  expect(r.mode, label).toBe('physics');
  expect(r.warp, label).toBe(0);
  expect(r.thrust, label).toBeGreaterThan(0);
  expect(r.maxGimbal, label).toBeGreaterThan(1e-3);
  expect(r.turn, label).toBeGreaterThan(0.005);
  expect(r.spin1, label).toBeLessThan(r.spin0 * 0.5);
}

function stagedInOrbit() {
  const world = selene(true);
  // Stage the booster so the craft has a gimballed engine (the scenario leaves it unstaged).
  world.tick(1 / 60, neutralInput({ stage: true }));
  hold(world, 0.5, { sas: 'off' });
  return world;
}

describe('assist hands control back', () => {
  it.each<[AssistId, 'complete' | 'cancel']>([['circAp', 'complete'], ['circAp', 'cancel'], ['node', 'complete'], ['node', 'cancel']])('%s → %s', (id, how) => {
    const world = stagedInOrbit();
    if (id === 'node') world.addNode(world.ut + 300).prograde = 40;
    else { world.nodes = []; placeEllipse(world); }
    const ap = createAssist(id, world);
    let burning = false;
    const ended = drive(world, ap, 20000, () => {
      burning ||= world.active!.state.telemetry.thrust > 0;
      return how === 'cancel' && burning ? { pitch: 0.5 } : {};
    });
    expect(ended?.reason, ap.error).toBe(how === 'cancel' ? 'pilot' : 'done');
    expectControl(probe(world), `${id} ${how}`);
  }, 120000);

  it('releases a "warp to node" that was still running when the program started', () => {
    const world = stagedInOrbit();
    const node = world.addNode(world.ut + 400);
    node.prograde = 30;
    world.advanceRailsTo(node.time - 25);
    // The player's warp-to was still at 10× when they pressed Execute next node (inside the align window).
    world.warp = { mode: 'rails', index: 2 };
    const ap = createAssist('node', world);
    const ended = drive(world, ap, 2000);
    expect(ended?.reason, ap.error).toBe('done');
    expectControl(probe(world), 'node after warp-to');
  }, 120000);

  it('drops rails warp when the pilot throttles up or steers (a packed craft ignores both)', () => {
    for (const input of [{ throttle: 1 }, { pitch: 1 }]) {
      const world = stagedInOrbit();
      world.warp = { mode: 'rails', index: 2 };
      hold(world, 0.3, { sas: 'off' });
      expect(world.active!.mode).toBe('rails');
      hold(world, 0.3, { sas: 'off', ...input });
      expect(world.warp.index, JSON.stringify(input)).toBe(0);
      expect(world.active!.mode).toBe('physics');
    }
  }, 60000);

  it('lets the pilot steer against a directional SAS hold, including a maneuver hold whose node is gone', () => {
    for (const sas of ['prograde', 'maneuver'] as const) {
      const world = stagedInOrbit();
      const v = world.active!.state;
      hold(world, 1, { sas, throttle: 1 });
      const w0 = length(v.angularVelocity);
      hold(world, 1, { sas, throttle: 1, pitch: 1 });
      expect(length(v.angularVelocity) - w0, sas).toBeGreaterThan(0.005);
    }
  }, 60000);

  it('after launch to orbit (staging mid-program)', () => {
    const world = selene(false);
    const ap = createAssist('orbit', world);
    const ended = drive(world, ap, 3000);
    expect(ended?.reason, ap.error).toBe('done');
    expectControl(probe(world), 'orbit complete');
  }, 300000);
});

/** Raise the apoapsis so "circularize at Ap" has a real burn to fly. */
function placeEllipse(world: World) {
  const wv = world.active!;
  const rs = world.relativeState(wv);
  wv.state.velocity = add(wv.state.velocity, scale(normalize(rs.velocity), 60));
}

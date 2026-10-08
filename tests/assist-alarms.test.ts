import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { neutralInput } from '../src/sim/vessel';
import type { ControlInput } from '../src/sim/vessel/runtime';
import { DEFAULT_START_UT } from '../src/game/store';
import type { Autopilot } from '../src/game/autopilot';
import { assistFrame, createAssist } from '../src/flight/assist';
import { add, normalize, scale } from '../src/util/vec3';

function orbitWorld() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const v = world.launch(buildOrbiter());
  placeInCircularOrbit(world, v, 'earth', 200000);
  // Light the engine (throttle 0) so programs can burn.
  world.tick(1 / 60, neutralInput({ stage: true }));
  for (let i = 0; i < 30; i++) world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
  return { world, v };
}

const nodeAlarms = (world: World) => world.alarmClock.alarms.filter(a => a.kind === 'node');

function drive(world: World, assist: Autopilot, frames: number, each?: () => void, pilot: () => Partial<ControlInput> = () => ({})) {
  const state = { warped: false };
  for (let i = 0; i < frames; i++) {
    const frame = assistFrame(world, assist, neutralInput({ sas: 'stabilityAssist', ...pilot() }), 1 / 60, state);
    world.tick(1 / 60, frame.input);
    each?.();
    if (frame.ended) return frame.ended;
  }
  return undefined;
}

describe('assist and node alarms', () => {
  it('a node an assist plans and flies raises no alarm and leaves none behind', () => {
    const { world, v } = orbitWorld();
    // Slightly eccentric, so there is a real circularisation burn at apoapsis.
    v.state.velocity = add(v.state.velocity, scale(normalize(world.relativeState(v).velocity), 25));
    const assist = createAssist('circAp', world);
    let seen = 0;
    const ended = drive(world, assist, 60 * 600, () => { seen += nodeAlarms(world).length; });
    expect(ended?.reason, assist.error).toBe('done');
    expect(seen).toBe(0);
    expect(world.alarmClock.alarms).toEqual([]);
    expect(world.alarmClock.held).toBe(false);
  }, 60_000);

  it('a consumed node clears its fired alarm, and replanning keeps one alarm per node', () => {
    const { world } = orbitWorld();
    const node = world.addNode(world.ut + 32);
    while (!world.alarmClock.held) world.tick(0.25, neutralInput({ sas: 'stabilityAssist' }));
    expect(nodeAlarms(world)[0].fired).toBe(true);
    world.alarmClock.acknowledge();
    world.removeNode(node.id); // consumed by the burn
    world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    expect(world.alarmClock.alarms).toEqual([]);
    // Planners replace the list wholesale (same count): the old node's alarm must not linger beside the new one.
    world.addNode(world.ut + 600);
    world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    world.nodes = [];
    const next = world.addNode(world.ut + 900);
    world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    expect(nodeAlarms(world).map(a => a.source)).toEqual([String(next.id)]);
  });

  it('cancelling the node assist gives the planned node its alarm back', () => {
    const { world } = orbitWorld();
    const node = world.addNode(world.ut + 600);
    node.prograde = 10;
    world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    expect(nodeAlarms(world)).toHaveLength(1);
    const assist = createAssist('node', world);
    let frames = 0;
    const ended = drive(world, assist, 600, () => { if (frames++ === 2) expect(nodeAlarms(world)).toHaveLength(0); }, () => (frames > 5 ? { pitch: 1 } : {}));
    expect(ended?.reason).toBe('pilot');
    world.tick(1 / 60, neutralInput({ sas: 'stabilityAssist' }));
    expect(nodeAlarms(world).map(a => a.source)).toEqual([String(node.id)]);
  });

  it('an unacknowledged node-alarm hold from an earlier node does not pin later assist coasts at 1×', () => {
    const { world } = orbitWorld();
    const old = world.addNode(world.ut + 31);
    while (!world.alarmClock.held) world.tick(0.25, neutralInput({ sas: 'stabilityAssist' }));
    expect(world.alarmClock.holdReason).toBe('node');
    world.removeNode(old.id);
    const node = world.addNode(world.ut + 2400);
    node.prograde = 5;
    const assist = createAssist('node', world);
    let warped = 0, frames = 0;
    const ended = drive(world, assist, 60 * 300, () => { frames++; if (world.warp.index > 0) warped++; });
    expect(ended?.reason, assist.error).toBe('done');
    expect(warped).toBeGreaterThan(0);
    // 40 minutes of coast must not take 40 minutes of frames.
    expect(frames / 60).toBeLessThan(180);
  }, 60_000);
});

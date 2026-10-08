import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { neutralInput } from '../src/sim/vessel';
import { DEFAULT_START_UT } from '../src/game/store';
import { NumericalPrediction } from '../src/sim/orbit/numericalPrediction';
import { propagate, stateToElements, takeAnchor } from '../src/sim/orbit';
import { length, sub, add, scale, normalize } from '../src/util/vec3';
import { orbitFrameDistance } from '../src/flight/map/framing';
import { smallBodyVisible } from '../src/render/map/framing';
import { WarpDriver } from '../src/flight/controller/warp';
import { assistFrame } from '../src/flight/assist';

function orbitWorld() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const v = world.launch(buildOrbiter());
  placeInCircularOrbit(world, v, 'earth', 200000);
  return { world, v };
}

describe('fleet mission alarms', () => {
  it.each(['rails', 'physics'] as const)('stops %s warp within one second, including a frame that would cross two alarms', mode => {
    const { world, v } = orbitWorld();
    const t = world.ut + (mode === 'rails' ? 4.137 : .057);
    world.alarmClock.add(v.state.id, 'First', t);
    world.alarmClock.add('other-vessel', 'Second', t + 3);
    world.warp = { mode, index: mode === 'rails' ? 7 : 3 };
    while (!world.alarmClock.held) world.tick(.25, neutralInput());
    expect(Math.abs(world.ut - t)).toBeLessThan(1);
    expect(world.warp.index).toBe(0);
    expect(world.alarmClock.alarms[0].fired).toBe(true);
    expect(world.alarmClock.alarms[1].fired).toBeUndefined();
    world.alarmClock.acknowledge();
    world.warp = { mode: 'rails', index: 7 };
    while (!world.alarmClock.held) world.tick(.25, neutralInput());
    expect(world.ut).toBeCloseTo(t + 3, 5);
  });
  it('creates and moves node alarms, removes deleted nodes, and preserves fleet/custom alarms across saves', () => {
    const { world, v } = orbitWorld();
    const node = world.addNode(world.ut + 120);
    world.alarmClock.sync(world);
    expect(world.alarmClock.alarms[0].time).toBe(node.time - 30);
    node.time += 60;
    world.alarmClock.sync(world);
    expect(world.alarmClock.alarms).toHaveLength(1);
    expect(world.alarmClock.alarms[0].time).toBe(node.time - 30);
    world.alarmClock.add(v.state.id, 'Return check', world.ut + 7200);
    world.alarmClock.add('another', 'Relay burn', world.ut + 5000);
    const copy = deserializeWorld(serializeWorld(world), PART_CATALOG);
    expect(copy.alarmClock.alarms).toEqual(world.alarmClock.alarms);
    copy.removeNode(node.id); copy.alarmClock.sync(copy);
    expect(copy.alarmClock.alarms.map(a => a.label)).toEqual(['Return check', 'Relay burn']);
  });
  it('registers SOI events from an existing prediction, discards stale crossings, and does not calculate a path', () => {
    const { world, v } = orbitWorld();
    const patch = { orbit: world.orbitOf(v), startTime: world.ut, endTime: world.ut + 100, endReason: 'soiEnter' as const, nextBody: 'moon' };
    world.alarmClock.predicted(world, v.state.id, [patch]);
    expect(world.alarmClock.next(world.ut)).toBe(patch.endTime);
    world.alarmClock.predicted(world, v.state.id, []);
    expect(world.alarmClock.next(world.ut)).toBe(Infinity);
  });
  it('holds/cancels warp-to and coast assists at a custom alarm until acknowledged', () => {
    const { world, v } = orbitWorld();
    const driver = new WarpDriver();
    driver.startAt(world, 'Far future', world.ut + 10000);
    world.alarmClock.add(v.state.id, 'Check systems', world.ut + 1);
    world.tick(.25, neutralInput());
    world.warp = { mode: 'rails', index: 7 }; world.tick(.25, neutralInput());
    driver.drive(world, 1 / 60);
    expect(driver.target).toBeNull();
    const assist = { name: 'coast', status: '', done: false, update: () => ({ input: neutralInput(), coastUntil: world.ut + 10000 }) };
    const frame = assistFrame(world, assist, neutralInput(), 1 / 60, { warped: true });
    expect(frame.ended?.reason).toBe('pilot');
    expect(world.warp.index).toBe(0);
  });
});

describe('map framing and frozen numerical nodes', () => {
  it('frames a circular orbit and bounds an escaping orbit; filters small bodies locally', () => {
    const { world, v } = orbitWorld();
    const body = world.universe.body(v.body), orbit = world.orbitOf(v);
    expect(orbitFrameDistance(body.radius, orbit.a, orbit)).toBeCloseTo(2.8 * orbit.a, 4);
    expect(orbitFrameDistance(body.radius, orbit.a, { ...orbit, e: 1.2, a: -1e12 })).toBeLessThan(3 * orbit.a);
    expect(smallBodyVisible('asteroid', false, false)).toBe(false);
    expect(smallBodyVisible('comet', false, true)).toBe(true);
    expect(smallBodyVisible('asteroid', true, false)).toBe(true);
    expect(smallBodyVisible('moon', false, false)).toBe(true);
  });
  it.each([false, true])('keeps the anchored target in precise prediction (past node: %s)', past => {
    const { world, v } = orbitWorld();
    const orbit = world.orbitOf(v);
    const node = { id: 1, time: world.ut + 40, prograde: 150, radial: 0, normal: 0 };
    const anchored = { ...node, anchor: takeAnchor(orbit, node) };
    const t = world.ut + (past ? 60 : 10), state = propagate(orbit, t);
    state.velocity = add(state.velocity, scale(normalize(state.velocity), 50));
    const prediction = new NumericalPrediction(world.universe.bodies, world.universe.ephem, 'earth', state, t, node.time + 100, [anchored]);
    prediction.advance(1000);
    const plan = prediction.patches[1];
    expect(plan.startTime).toBe(node.time);
    expect(length(sub(plan.samples![0].velocity, anchored.anchor.velocity))).toBeLessThan(1e-9);
    expect(length(sub(plan.samples![0].position, anchored.anchor.position))).toBeLessThan(1e-9);
    const planned = stateToElements(orbit.mu, orbit.body, anchored.anchor.position, anchored.anchor.velocity, node.time);
    expect(plan.orbit.a).toBeCloseTo(planned.a, 4);
  });
});

it('stops unattended Tracking Station advancement at a persisted fleet alarm', () => {
  const { world, v } = orbitWorld();
  world.activeId = null;
  const time = world.ut + 7.123;
  world.alarmClock.add(v.state.id, 'Probe check', time);
  world.advanceRailsTo(world.ut + 10000);
  expect(world.ut).toBeCloseTo(time, 5);
  expect(world.alarmClock.held).toBe(true);
});


it('an alarm does not cut an ongoing powered assist burn', () => {
  const { world, v } = orbitWorld();
  world.alarmClock.add(v.state.id, 'Read instruments', world.ut);
  world.alarmClock.fire(world);
  const assist = { name: 'burn', status: '', done: false, update: () => ({ input: neutralInput({ throttle: .7 }) }) };
  const frame = assistFrame(world, assist, neutralInput(), 1 / 60, { warped: false });
  expect(frame.ended).toBeUndefined();
  expect(frame.input.throttle).toBe(.7);
  expect(world.warp.index).toBe(0);
});

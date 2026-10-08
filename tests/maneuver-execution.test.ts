import { describe, expect, it } from 'vitest';
import { BurnTracker } from '../src/flight/controller/burn';
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { executeNode } from '../src/game/autopilot';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import {
  apoapsisRadius, inertialDvToManeuver, maneuverToInertialDv, predictTrajectory, propagate, remainingManeuverDv, stateToElements,
  takeAnchor, validAnchor, type Orbit, type TrajectoryPatch,
} from '../src/sim/orbit';
import type { ManeuverNode } from '../src/sim/orbit/api';
import { neutralInput } from '../src/sim/vessel';
import { add, length, normalize, scale, sub } from '../src/util/vec3';
import { requireIntactFlight } from './helpers/structural';

/** The stock Selene (1 MN booster) in a circular 200 km Earth orbit, with a prograde node `lead` s ahead. */
function burnSetup(dv: number, lead = 40) {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const wv = world.launch(STOCK_CRAFTS.find(c => c.id === 'stock-selene')!.build());
  placeInCircularOrbit(world, wv, 'earth', 200000);
  world.tick(0.1, neutralInput());
  const node = world.addNode(world.ut + lead);
  node.prograde = dv;
  return { world, wv, node };
}

/** Hold prograde and fire from `burnStart` s before the node until `stopAfter` s past it (staging on ignition). */
function flyManualBurn(world: World, node: ManeuverNode, burnStart: number, stopAfter: number, each?: () => void) {
  let staged = false;
  while (world.ut < node.time + stopAfter) {
    const burn = world.ut - node.time > -burnStart;
    world.tick(1 / 60, neutralInput({ sas: 'prograde', throttle: burn ? 1 : 0, stage: burn && !staged }));
    staged = staged || burn;
    each?.();
  }
}

const planned = (world: World): TrajectoryPatch => world.trajectory()[1];
const radiusOfApoapsis = (o: Orbit) => apoapsisRadius(o);

describe('maneuver node during its burn (world)', () => {
  it('keeps the planned orbit fixed while the vessel burns through the node', () => {
    const { world, node } = burnSetup(300);
    const before = planned(world).orbit;
    const samples: { t: number; ap: number; sma: number; start: number; patches: number }[] = [];
    flyManualBurn(world, node, 10, 8, () => {
      if (Math.round((world.ut - node.time) * 60) % 30 !== 0) return;
      const p = world.trajectory();
      samples.push({ t: world.ut - node.time, ap: radiusOfApoapsis(p[1].orbit), sma: p[1].orbit.a, start: p[1].startTime, patches: p.length });
    });
    // Burning for several seconds both before and after the node time.
    expect(world.active!.state.telemetry.thrust).toBeGreaterThan(0);
    expect(samples.some(s => s.t < -3)).toBe(true);
    expect(samples.some(s => s.t > 3)).toBe(true);
    for (const s of samples) {
      expect(s.sma).toBeCloseTo(before.a, 0);
      expect(s.ap).toBeCloseTo(apoapsisRadius(before), 0);
      expect(s.start).toBeCloseTo(node.time, 6);
      expect(s.patches).toBeGreaterThanOrEqual(2);
    }
  });

  it('counts the remaining Δv down toward the plan, through the node time and across a save and reload', () => {
    const { world, wv, node } = burnSetup(300);
    const tracker = new BurnTracker();
    const left: number[] = [];
    flyManualBurn(world, node, 10, 4, () => { left.push(tracker.update(world, wv, [], 0)!.dvRemaining); });
    expect(left[0]).toBeCloseTo(300, 0);
    for (let i = 1; i < left.length; i++) expect(left[i]).toBeLessThanOrEqual(left[i - 1] + 1e-6);
    const mid = left[left.length - 1];
    expect(mid).toBeLessThan(250);
    expect(mid).toBeGreaterThan(0);
    // The planned post-burn orbit survives a save/load in the middle of the burn.
    const patch = planned(world);
    const loaded = deserializeWorld(serializeWorld(world), PART_CATALOG);
    expect(loaded.nodes[0].anchor).toBeDefined();
    expect(planned(loaded).orbit.a).toBeCloseTo(patch.orbit.a, 3);
    const lw = loaded.active!;
    expect(new BurnTracker().update(loaded, lw, [], 0)!.dvRemaining).toBeCloseTo(mid, 1);
  });

  it('shows the live orbit as a zero-length patch and the plan from the node, once the node time has passed', () => {
    const { world, node } = burnSetup(300);
    flyManualBurn(world, node, 10, 4);
    const [live, plan] = world.trajectory();
    expect(live.endReason).toBe('maneuver');
    expect(live.startTime).toBe(world.ut);
    expect(live.endTime).toBe(world.ut);
    expect(plan.startTime).toBe(node.time);
    expect(plan.orbit.a).toBeGreaterThan(live.orbit.a);
  });

  it('clears the node when the burn is finished, but keeps it after an early cut', () => {
    const { world, wv, node } = burnSetup(300);
    flyManualBurn(world, node, 10, 0.5);
    world.tick(1 / 60, neutralInput({ sas: 'prograde', throttle: 0 }));
    for (let i = 0; i < 300; i++) world.tick(1 / 60, neutralInput({ sas: 'prograde', throttle: 0 }));
    // Cut with Δv to go: the node stays, still pointing at the same target.
    const left = length(remainingManeuverDv(world.orbitOf(wv), node));
    expect(left).toBeGreaterThan(20);
    expect(world.nodes).toHaveLength(1);
    // Finish the burn exactly (an ideal pilot), then coast.
    const o = world.orbitOf(wv), dv = remainingManeuverDv(o, node);
    wv.state.velocity = add(wv.state.velocity, dv);
    for (let i = 0; i < 300; i++) world.tick(1 / 60, neutralInput({ sas: 'prograde', throttle: 0 }));
    expect(world.nodes).toHaveLength(0);
    expect(world.messages.some(m => m.text === 'Maneuver complete')).toBe(true);
  });

  it('does not freeze a node for thrust that is nowhere near it', () => {
    const { world, node } = burnSetup(300, 3000);
    flyManualBurn(world, { ...node, time: world.ut + 3 }, 0, 0.5);
    expect(node.anchor).toBeUndefined();
  });

  it('resumes the burn from the frozen plan when the node executor starts mid-burn', () => {
    const { world, wv, node } = burnSetup(300);
    flyManualBurn(world, node, 10, 4);
    const remaining = length(remainingManeuverDv(world.orbitOf(wv), node));
    expect(remaining).toBeLessThan(250);
    const ap = executeNode(world, node);
    ap.update(world);
    expect(ap.remaining()).toBeCloseTo(remaining, 1);
  });

  it('drops the frozen plan as soon as the node is edited', () => {
    const { world, node } = burnSetup(300);
    flyManualBurn(world, node, 10, 2);
    expect(validAnchor(node, 'earth')).toBeDefined();
    node.prograde = 100;
    expect(validAnchor(node, 'earth')).toBeUndefined();
  });
});

describe('maneuver anchors (sim)', () => {
  const mu = 3.986e14;
  const orbit = stateToElements(mu, 'earth', { x: 6.6e6, y: 0, z: 0 }, { x: 0, y: Math.sqrt(mu / 6.6e6), z: 0 }, 0);
  const node: ManeuverNode = { id: 1, time: 600, prograde: 200, normal: 30, radial: 0 };

  it('plans from the live orbit before the burn and from the frozen state after it begins', () => {
    const anchored = { ...node, anchor: takeAnchor(orbit, node) };
    const at = propagate(orbit, node.time);
    const dv = maneuverToInertialDv(at, node);
    expect(length(sub(sub(anchored.anchor.velocity, at.velocity), dv))).toBeLessThan(1e-9);
    // A vessel that already delivered 80 m/s: the unanchored plan overshoots, the anchored one does not.
    const state = propagate(orbit, 100);
    const burned = { position: state.position, velocity: add(state.velocity, scale(normalize(state.velocity), 80)) };
    const run = (n: ManeuverNode) => predictTrajectory({
      ephem: undefined as never, bodies: new Map([['earth', { id: 'earth', gm: mu, radius: 6.371e6, children: [], soi: Infinity } as never]]),
      initialBody: 'earth', state: burned, t0: 100, maneuvers: [n], horizon: 4000,
    });
    const target = stateToElements(mu, 'earth', at.position, add(at.velocity, dv), node.time);
    expect(run(anchored)[1].orbit.a).toBeCloseTo(target.a, 3);
    expect(Math.abs(run(node)[1].orbit.a - target.a)).toBeGreaterThan(1e5);
    // Remaining Δv: the whole node before the burn, what is left after it.
    expect(length(remainingManeuverDv(orbit, anchored))).toBeCloseTo(length(dv), 6);
    const live = stateToElements(mu, 'earth', burned.position, burned.velocity, 100);
    const rem = remainingManeuverDv(live, anchored);
    expect(length(rem)).toBeLessThan(length(dv) - 30);
    expect(inertialDvToManeuver(propagate(live, node.time), rem).prograde).toBeGreaterThan(0);
  });
});

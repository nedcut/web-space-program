import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/util/format';
import { flightData } from '../src/game/flightData';
import { BurnTracker, stageBurnTime } from '../src/flight/controller/burn';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { spawnRelative } from '../src/scenarios/catalog';
import { burnTimeEstimate } from '../src/sim/orbit';
import type { StageDeltaV } from '../src/sim/vessel';
import { add, normalize, scale, v3 } from '../src/util/vec3';

function orbiting() {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  const b = world.universe.body('earth');
  const r = b.radius + 150000;
  const wv = spawnRelative(world, buildOrbiter(), 'earth', v3(r, 0, 0), v3(0, Math.sqrt(b.gm / r), 0));
  return { world, wv };
}
const stage = (s: Partial<StageDeltaV>): StageDeltaV => ({ stage: 0, dvVac: 0, dvAsl: 0, dv: 0, burnTime: 0, startMass: 1000, endMass: 500, thrustVac: 0, thrustAsl: 0, thrust: 0, twrStart: 0, twrEnd: 0, isp: 300, ...s } as StageDeltaV);

describe('navball maneuver burn readout', () => {
  it('reports no burn without a node', () => {
    const { world, wv } = orbiting();
    expect(new BurnTracker().update(world, wv, [], 1)).toBeNull();
  });
  it('counts remaining Δv down as the vessel accelerates along the node vector', () => {
    const { world, wv } = orbiting();
    const node = world.addNode(world.ut);
    node.prograde = 100;
    const tracker = new BurnTracker();
    const before = tracker.update(world, wv, [], 1)!;
    expect(before.dvTotal).toBeCloseTo(100, 6);
    expect(before.dvRemaining).toBeCloseTo(100, 3);
    expect(before.burnTime).toBe(Infinity);
    const vel = wv.state.velocity;
    const body = world.universe.ephem.getBodyState('earth', world.ut).velocity;
    const pro = normalize({ x: vel.x - body.x, y: vel.y - body.y, z: vel.z - body.z });
    wv.state.velocity = add(vel, scale(pro, 60));
    expect(tracker.update(world, wv, [], 1)!.dvRemaining).toBeCloseTo(40, 1);
    // Editing the node re-anchors the plan on the current orbit.
    node.prograde = 30;
    expect(tracker.update(world, wv, [], 1)!.dvRemaining).toBeCloseTo(30, 3);
  });
  it('uses the same staged duration and half-Δv lead in Flight Data and navball countdown', () => {
    const { world, wv } = orbiting();
    const first = wv.state.nextStage;
    const stages = [stage({ stage: first, dv: 200, thrust: 50000, startMass: 5000, isp: 300 }),
      stage({ stage: first - 1, dv: 1000, thrust: 10000, startMass: 1000, isp: 340 })];
    world.addNode(world.ut + 600).prograde = 500;
    const burn = new BurnTracker().update(world, wv, stages, first + 1)!;
    const expected = stageBurnTime(stages, first, 500, 1, false);
    expect(burn.burnTime).toBeCloseTo(expected, 8);
    expect(burn.burnStartLead).toBeCloseTo(stageBurnTime(stages, first, 250, 1, false), 8);
    expect(Math.abs(burn.burnStartLead - burn.burnTime / 2)).toBeGreaterThan(0.1);
    const data = flightData(world, wv, stages, { crossings: [], impact: null });
    const row = data.find(d => d.title === 'Propulsion')!.rows.find(r => r[0] === 'Next node burn')!;
    expect(row[1]).toBe(formatDuration(expected));
  });
  it('spends stages in firing order for the burn time estimate', () => {
    const upper = stage({ stage: 1, dv: 500, thrust: 50000, startMass: 5000, isp: 320 });
    const lower = stage({ stage: 0, dv: 1000, thrust: 10000, startMass: 1000, isp: 300 });
    expect(stageBurnTime([lower, upper], 1, 200)).toBeCloseTo(burnTimeEstimate(200, 50000, 5000, 320), 9);
    expect(stageBurnTime([lower, upper], 1, 700)).toBeCloseTo(burnTimeEstimate(500, 50000, 5000, 320) + burnTimeEstimate(200, 10000, 1000, 300), 9);
    expect(stageBurnTime([lower, upper], 0, 1200)).toBe(Infinity);
    expect(stageBurnTime([lower, upper], 1, 2000)).toBe(Infinity);
  });
});

import { requireIntactFlight } from './helpers/structural';
import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildRealOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, coastUntil, executeNode, planCircularization, runAutopilot } from '../src/game/autopilot';
import { period } from '../src/sim/orbit';

it.each(['challenging', 'real'] as const)('%s orbital mission', (preset) => {
  const world = new World(new Universe(preset), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  world.launch(buildRealOrbiter());
  const vessel = world.active!;
  const target = preset === 'real' ? 220000 : 140000;
  const ascent = ascentGuidance(world, { targetApoapsis: target, minStage: 2 });
  expect(runAutopilot(world, ascent, { maxTime: 1800 }), ascent.error).toBe(true);
  const circularize = executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 });
  expect(runAutopilot(world, circularize, { maxTime: 10000 }), circularize.error).toBe(true);
  const orbit = world.orbitSummary(vessel);
  console.log(`${preset}: T+${(world.ut - DEFAULT_START_UT).toFixed(0)}s, ` +
    `${(orbit.pe / 1000).toFixed(2)} × ${(orbit.ap / 1000).toFixed(2)} km, ${vessel.state.mass.toFixed(0)} kg`);
  expect(orbit.pe).toBeGreaterThan(world.universe.body('earth').atmosphere!.height);
  expect(orbit.ap).toBeLessThan(target * 3);
  const parts = vessel.state.parts.length;
  coastUntil(world, world.ut + 2 * period(orbit.orbit));
  expect(world.active).toBe(vessel);
  expect(vessel.body).toBe('earth');
  expect(vessel.state.parts).toHaveLength(parts);
  // Packing/unpacking heliocentric float64 states may move osculating apsides by metres.
  expect(Math.abs(world.orbitSummary(vessel).pe - orbit.pe)).toBeLessThan(20);
}, 180000);

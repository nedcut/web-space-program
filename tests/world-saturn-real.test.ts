import { requireIntactFlight } from './helpers/structural';
import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildRealRingrunner } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, executeNode, planCircularization, runAutopilot } from '../src/game/autopilot';
import { computeStageDeltaV } from '../src/sim/vessel';
import { planInterplanetaryTransfer } from '../src/game/interplanetary';

// A full nuclear departure/cruise exceeds three minutes on the shared machine. Fly the actual
// stock launcher to orbit, then verify an encounter and its remaining fuel budget with the planner.
it('Ringrunner Real reaches Earth orbit and budgets a planned Saturn flyby', () => {
  const world = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(buildRealRingrunner());
  const ascent = ascentGuidance(world, { targetApoapsis: 220000, minStage: 2 });
  expect(runAutopilot(world, ascent, { maxTime: 2000 }), ascent.error).toBe(true);
  const parking = executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 });
  expect(runAutopilot(world, parking, { maxTime: 4000 }), parking.error).toBe(true);
  const orbit = world.orbitSummary(vessel);
  expect(orbit.pe).toBeGreaterThan(world.universe.body('earth').atmosphere!.height);
  expect(vessel.state.parts.some(p => p.def.id === 'eng-hearth')).toBe(true);
  const budget = computeStageDeltaV(vessel.state).reduce((sum, stage) => sum + stage.dvVac, 0);
  const transfer = planInterplanetaryTransfer(world, 'saturn', {
    periapsisAltitude: 120000000, includeCapture: false,
  });
  expect(transfer).not.toBeNull();
  expect(transfer!.patches.map(p => p.orbit.body)).toEqual(['earth', 'sun', 'saturn']);
  expect(Math.abs(transfer!.periapsisAltitude - 120000000)).toBeLessThan(1000);
  expect(world.trajectory().some(p => p.orbit.body === 'saturn')).toBe(true);
  expect(budget).toBeGreaterThan(transfer!.dv + 500); // Explicit reserve for early and late cruise trims.
  expect(world.nodes).toHaveLength(1);
  process.stdout.write(`Ringrunner Real: parking ${(orbit.pe / 1000).toFixed(2)} × ${(orbit.ap / 1000).toFixed(2)} km; ` +
    `remaining Δv ${budget.toFixed(1)} m/s, Saturn departure ${transfer!.dv.toFixed(1)} m/s + 500 m/s reserve; ` +
    `wait ${((transfer!.node.time - world.ut) / 86400).toFixed(1)} days, flight ${(transfer!.timeOfFlight / 86400).toFixed(1)} days\n`);
}, 180000);

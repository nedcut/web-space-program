import { requireIntactFlight } from './helpers/structural';
import { expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildRealRingrunner } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, executeNode, planCircularization, runAutopilot } from '../src/game/autopilot';
import { activateStage, computeStageDeltaV, neutralInput, setGear } from '../src/sim/vessel';
import { planInterplanetaryTransfer } from '../src/game/interplanetary';
import { placeInCircularOrbit } from '../src/game/scenarios';

// Burn both retained upper stages dry in deep space. This covers their highest acceleration and
// verifies that the internal engine mounts actually feed from the tanks, without a multi-year cruise.
it('Ringrunner Real retains every upper-stage attachment through complete chemical and nuclear burns', () => {
  const world = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(buildRealRingrunner());
  activateStage(vessel.state, 3); // Discard the Earth delivery stack for this propulsion regression.
  vessel.state.nextStage = 2;
  placeInCircularOrbit(world, vessel, 'sun', 1e13);
  setGear(vessel.state, true); // Open both engine interstages.
  for (const engineId of ['eng-foehn', 'eng-hearth']) {
    if (engineId === 'eng-hearth') world.tick(0.02, neutralInput({ stage: true }));
    const engine = vessel.state.parts.find(p => p.partId === engineId)!;
    const initialFuel = vessel.state.parts.reduce((sum, p) => sum + (p.resources.liquidFuel ?? 0), 0);
    const parts = vessel.state.parts.length;
    world.tick(0.02, neutralInput({ stage: true, throttle: 1 }));
    for (let i = 0; i < 60000 && !engine.engine!.flamedOut; i++) {
      world.tick(0.2, neutralInput({ throttle: 1, sas: 'stabilityAssist' }));
      for (const load of vessel.state.cache.jointLoads?.values() ?? []) expect(load.fraction).toBeLessThanOrEqual(1);
    }
    expect(engine.engine!.flamedOut, engineId).toBe(true);
    expect(vessel.state.parts).toHaveLength(parts);
    const fuel = vessel.state.parts.reduce((sum, p) => sum + (p.resources.liquidFuel ?? 0), 0);
    expect(initialFuel - fuel).toBeGreaterThan(initialFuel * 0.2);
    if (engineId === 'eng-hearth') expect(fuel).toBeLessThan(1e-6);
  }
}, 180000);

// A full nuclear departure/cruise exceeds three minutes on the shared machine. Fly the actual
// stock launcher to orbit, then verify an encounter and its remaining fuel budget with the planner.
it('Ringrunner Real reaches Earth orbit and budgets a planned Saturn flyby', () => {
  const world = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(buildRealRingrunner());
  let peakJointLoad = 0;
  let peakJoint: unknown;
  const observeLoads = () => {
    // Clamp-release contact impulses use the stress model's existing exposure grace. The intact-flight
    // guard covers release too; measure continuous flight loads after the whole stack clears the pad.
    const agl = world.universe.surfaceInfo(vessel.body, vessel.state.position, world.ut).heightAboveTerrain;
    if (agl <= vessel.state.cache.boundingRadius + 1) return;
    for (const [uid, load] of vessel.state.cache.jointLoads ?? []) if (load.fraction > peakJointLoad) {
      peakJointLoad = load.fraction;
      const part = vessel.state.cache.byUid.get(uid);
      peakJoint = { uid, part: part?.partId, parent: part?.parent, time: world.ut - DEFAULT_START_UT,
        q: vessel.state.telemetry.dynamicPressure, load };
    }
  };
  const ascent = ascentGuidance(world, { targetApoapsis: 220000, minStage: 2 });
  expect(runAutopilot(world, ascent, { maxTime: 2000, onTick: observeLoads }), ascent.error).toBe(true);
  const parking = executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 });
  expect(runAutopilot(world, parking, { maxTime: 4000, onTick: observeLoads }), parking.error).toBe(true);
  expect(peakJointLoad, JSON.stringify(peakJoint)).toBeLessThanOrEqual(1);
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
    `wait ${((transfer!.node.time - world.ut) / 86400).toFixed(1)} days, flight ${(transfer!.timeOfFlight / 86400).toFixed(1)} days; ` +
    `peak flight joint load ${(peakJointLoad * 100).toFixed(1)}%\n`);
}, 180000);

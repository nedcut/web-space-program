import { expect } from 'vitest';
import { Universe } from '../../src/game/universe';
import { World } from '../../src/game/world';
import { PART_CATALOG } from '../../src/data/parts';
import { buildRealRingrunner } from '../../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../../src/game/store';
import { activateStage, neutralInput, setGear } from '../../src/sim/vessel';
import { placeInCircularOrbit } from '../../src/game/scenarios';
import { requireIntactFlight } from './structural';

/** Ringrunner Real in deep space with the Earth delivery stack discarded and both engine interstages open. */
export function launchRingrunnerUpperStages(firstStage: number) {
  const world = new World(new Universe('real'), PART_CATALOG, DEFAULT_START_UT);
  requireIntactFlight(world);
  const vessel = world.launch(buildRealRingrunner());
  activateStage(vessel.state, 3); // Discard the Earth delivery stack for this propulsion regression.
  vessel.state.nextStage = firstStage;
  placeInCircularOrbit(world, vessel, 'sun', 1e13);
  setGear(vessel.state, true); // Open both engine interstages.
  return { world, vessel };
}

/** Burn one engine dry at full throttle, checking that no attachment is lost or overloaded on the way. */
export function burnEngineDry(world: World, vessel: ReturnType<World['launch']>, engineId: string, dryFuel: boolean) {
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
  if (dryFuel) expect(fuel).toBeLessThan(1e-6);
}

import type { World } from '../world';
import type { TransferPlan } from './transfers';
import type { EntryTrimPlan } from './entry';
import type { ManeuverNode } from '../../sim/orbit/api';
import type { PlanningSnapshot } from './protocol';
import { propagate } from '../../sim/orbit';
import { length, sub } from '../../util/vec3';

/** Accept against the live world only after success; failures/cancellation never erase existing nodes. */
export function applyPlanningResult(world: World, snapshot: PlanningSnapshot, plan: TransferPlan): void {
  assertCurrent(world, snapshot, plan.node.time);
  // World owns node IDs and cache invalidation; worker-local IDs are deliberately not installed.
  world.nodes = [];
  install(world, plan.node);
}

/** An entry trim is flown after the existing nodes: they stay, the trim is added. */
export function applyEntryTrim(world: World, snapshot: PlanningSnapshot, plan: EntryTrimPlan): void {
  assertCurrent(world, snapshot, plan.node.time);
  install(world, plan.node);
}

function install(world: World, planned: ManeuverNode) {
  const node = world.addNode(planned.time);
  node.prograde = planned.prograde; node.normal = planned.normal; node.radial = planned.radial;
  world.nodes = [...world.nodes].sort((a, b) => a.time - b.time);
}

function assertCurrent(world: World, snapshot: PlanningSnapshot, nodeTime: number): void {
  const vessel = world.active;
  if (!vessel || vessel.state.id !== snapshot.vessel?.id || vessel.body !== snapshot.vessel.body ||
    world.universe.preset !== snapshot.preset || JSON.stringify(world.nodes) !== JSON.stringify(snapshot.nodes) ||
    world.ut < snapshot.ut || nodeTime <= world.ut)
    throw new Error('Flight or maneuver nodes changed while planning. Please plan again.');
  const predicted = propagate(snapshot.vessel.orbit, world.ut), current = world.relativeState(vessel);
  if (length(sub(predicted.position, current.position)) > 100 || length(sub(predicted.velocity, current.velocity)) > 0.1)
    throw new Error('Vessel trajectory changed while planning. Please plan again.');
}

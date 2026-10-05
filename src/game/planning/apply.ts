import type { World } from '../world';
import type { TransferPlan } from './transfers';
import type { PlanningSnapshot } from './protocol';
import { propagate } from '../../sim/orbit';
import { length, sub } from '../../util/vec3';

/** Accept against the live world only after success; failures/cancellation never erase existing nodes. */
export function applyPlanningResult(world: World, snapshot: PlanningSnapshot, plan: TransferPlan): void {
  const vessel = world.active;
  if (!vessel || vessel.state.id !== snapshot.vessel?.id || vessel.body !== snapshot.vessel.body ||
    world.universe.preset !== snapshot.preset || JSON.stringify(world.nodes) !== JSON.stringify(snapshot.nodes) ||
    world.ut < snapshot.ut || plan.node.time <= world.ut)
    throw new Error('Flight or maneuver nodes changed while planning. Please plan again.');
  const predicted = propagate(snapshot.vessel.orbit, world.ut), current = world.relativeState(vessel);
  if (length(sub(predicted.position, current.position)) > 100 || length(sub(predicted.velocity, current.velocity)) > 0.1)
    throw new Error('Vessel trajectory changed while planning. Please plan again.');
  // World owns node IDs and cache invalidation; worker-local IDs are deliberately not installed.
  world.nodes = [];
  const node = world.addNode(plan.node.time);
  node.prograde = plan.node.prograde; node.normal = plan.node.normal; node.radial = plan.node.radial;
}

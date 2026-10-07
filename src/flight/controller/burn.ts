import { maneuverToInertialDv, propagate } from '../../sim/orbit';
import { stageBurnTime } from '../../game/autopilot';
import type { ManeuverNode } from '../../sim/orbit/api';
import type { StageDeltaV } from '../../sim/vessel';
import { add, length, sub, type Vec3 } from '../../util/vec3';
import type { World, WorldVessel } from '../../game/world';

/**
 * Navball-side maneuver readout (the block to the right of the navball while a node exists).
 * This is the public contract between the flight HUD and whoever edits nodes (map view, planners, assist):
 * anything that changes `World.nodes` is reflected here, nothing else needs to be fed.
 */
export interface ManeuverBurnTelemetry {
  nodeId: number;
  /** Planned Δv magnitude of the node, m/s. */
  dvTotal: number;
  /** Δv still to burn: planned post-burn velocity minus the current orbit's velocity at the node time, m/s. */
  dvRemaining: number;
  /** Estimated full-throttle burn time for the remaining Δv across the coming stages, s (Infinity without thrust). */
  burnTime: number;
  /** Seconds until the node (negative once passed). */
  timeToNode: number;
}

/**
 * Tracks the remaining Δv of the next node the way the genre classic does: the node fixes a target velocity at its
 * time; while burning, the vessel's osculating orbit evaluated at the node time approaches it. Editing the node
 * (any field) re-anchors the target on the then-current orbit.
 */
export class BurnTracker {
  private key = '';
  private target: Vec3 | null = null;
  private body = '';

  update(world: World, wv: WorldVessel, stages: StageDeltaV[], burning: number): ManeuverBurnTelemetry | null {
    const node = world.nodes[0];
    if (!node || wv.mode === 'prelaunch') { this.key = ''; this.target = null; return null; }
    const dvTotal = Math.hypot(node.prograde, node.normal, node.radial);
    const key = `${wv.state.id}|${wv.body}|${node.id}|${node.time}|${node.prograde}|${node.normal}|${node.radial}`;
    let dvRemaining = dvTotal;
    try {
      if (key !== this.key || !this.target || this.body !== wv.body) {
        this.key = key;
        this.body = wv.body;
        this.target = plannedVelocity(world, wv, node);
      }
      const now = propagate(world.orbitOf(wv), node.time).velocity;
      const r = length(sub(this.target, now));
      if (Number.isFinite(r)) dvRemaining = r;
    } catch {
      this.target = null;
    }
    return { nodeId: node.id, dvTotal, dvRemaining, burnTime: stageBurnTime(stages, burning, dvRemaining), timeToNode: node.time - world.ut };
  }
}

function plannedVelocity(world: World, wv: WorldVessel, node: ManeuverNode): Vec3 {
  const s = propagate(world.orbitOf(wv), node.time);
  return add(s.velocity, maneuverToInertialDv(s, node));
}

/** Shared with the node executor, which adds a pause per stage activation. */
export { stageBurnTime } from '../../game/autopilot';

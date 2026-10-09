import { maneuverToInertialDv, propagate, validAnchor } from '../../sim/orbit';
import { stageBurnTime, NODE_STAGE_PAUSE } from '../../sim/vessel/burnTime';
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
  /** Time to deliver half the remaining Δv, including stage pauses (executor centring rule). */
  burnStartLead: number;
  /** Seconds until the node (negative once passed). */
  timeToNode: number;
}

/**
 * Tracks the remaining Δv of the next node the way the genre classic does: the node fixes a target velocity at its
 * time; while burning, the vessel's osculating orbit evaluated at the node time approaches it. Editing the node
 * (any field) re-anchors the target on the then-current orbit. Once the world has frozen the node's plan
 * (`ManeuverNode.anchor`, from the first thrust of the burn) that plan is the target, also after a reload.
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
      const r = length(sub(validAnchor(node, wv.body)?.velocity ?? this.target, now));
      if (Number.isFinite(r)) dvRemaining = r;
    } catch {
      this.target = null;
    }
    const lit = wv.state.parts.some(p => p.engine?.ignited && !p.engine.flamedOut);
    if (!lit) burning = wv.state.nextStage;
    return {
      nodeId: node.id, dvTotal, dvRemaining, timeToNode: node.time - world.ut,
      burnTime: stageBurnTime(stages, burning, dvRemaining, NODE_STAGE_PAUSE, lit),
      burnStartLead: stageBurnTime(stages, burning, dvRemaining / 2, NODE_STAGE_PAUSE, lit),
    };
  }
}

function plannedVelocity(world: World, wv: WorldVessel, node: ManeuverNode): Vec3 {
  const s = propagate(world.orbitOf(wv), node.time);
  return add(s.velocity, maneuverToInertialDv(s, node));
}

/** Shared with the node executor, which adds a pause per stage activation. */
export { stageBurnTime } from '../../sim/vessel/burnTime';

import { remainingManeuverDv, takeAnchor, validAnchor } from '../../sim/orbit';
import type { ManeuverAnchor, ManeuverNode } from '../../sim/orbit/api';
import { length } from '../../util/vec3';
import type { World } from '../world';

/** Longest burn the engage window will assume, s. */
const MAX_BURN = 3600;
/** Node-time lead (s) over which the pre-burn plan is kept fresh, so the frozen plan predates the first thrust. */
const ARM_LEAD = 3600;
const ARM_PERIOD = 0.5;
/** Quiet time (s) after the last thrust before the finished check (a fine trim fires within this). */
const SETTLE = 2;
/** An unanchored node this far past its time is no longer the one being flown, s. */
const STALE = 120;

/**
 * Anchors the planned post-burn state of the node being burned (`ManeuverNode.anchor`). Until thrust starts near a node,
 * its plan follows the live orbit (the vessel drifts, the player edits). From the first thrust in its burn window the
 * plan is frozen, so the target orbit stays put while the vessel burns toward it, the remaining Δv counts down and
 * the node survives its own time. A finished burn clears the node.
 */
export class NodeAnchors {
  private armed: { key: string; at: number; anchor: ManeuverAnchor } | null = null;
  private lastThrust = -Infinity;
  private lastCheck = -Infinity;

  /** Call after every physics step. */
  update(world: World): void {
    const wv = world.active;
    if (!world.nodes.length || !wv || wv.mode !== 'physics' || wv.state.eva) { this.armed = null; return; }
    const thrust = wv.state.telemetry.thrust, thrusting = thrust > 0, ut = world.ut;
    if (thrusting) this.lastThrust = ut;
    // The node being flown: one already holding a plan, else the earliest not yet long past.
    const body = wv.body;
    let node: ManeuverNode | undefined;
    for (const n of world.nodes) {
      if (validAnchor(n, body)) { node = n; break; }
      if (n.time >= ut - STALE && (!node || n.time < node.time)) node = n;
    }
    if (!node) return;
    const key = `${wv.state.id}|${body}|${node.id}|${node.time}|${node.prograde}|${node.normal}|${node.radial}`;
    const dv = Math.hypot(node.prograde, node.normal, node.radial);
    if (validAnchor(node, body)) {
      // Coasting after the burn (or after an RCS trim): the node is done once the orbit meets its plan.
      if (!thrusting && ut - this.lastThrust > SETTLE && ut - this.lastCheck >= ARM_PERIOD) {
        this.lastCheck = ut;
        try {
          const left = length(remainingManeuverDv(world.orbitOf(wv), node));
          if (left <= Math.min(2, Math.max(0.25, 0.005 * dv))) {
            world.removeNode(node.id);
            world.message('Maneuver complete', 'info', 3);
          }
        } catch { /* degenerate orbit: keep the node */ }
      }
      return;
    }
    if (!(dv > 0)) { this.armed = null; return; }
    try {
      if (thrusting) {
        const burn = Math.min(MAX_BURN, dv * wv.state.mass / thrust);
        if (ut < node.time - (burn + 30) || ut > node.time + 1.5 * burn + 60) return;
        const fresh = this.armed && this.armed.key === key && ut - this.armed.at < 5 ? this.armed.anchor : undefined;
        node.anchor = fresh ?? takeAnchor(world.orbitOf(wv), node);
        this.armed = null;
      } else if (node.time - ut < ARM_LEAD && ut - node.time < 600) {
        if (!this.armed || this.armed.key !== key || ut - this.armed.at >= ARM_PERIOD) this.armed = { key, at: ut, anchor: takeAnchor(world.orbitOf(wv), node) };
      } else this.armed = null;
    } catch { this.armed = null; }
  }
}

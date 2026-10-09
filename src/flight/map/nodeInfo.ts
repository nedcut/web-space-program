import type { World } from '../../game/world';
import type { ManeuverNode, TrajectoryPatch } from '../../sim/orbit/api';
import { apoapsisRadius, period, periapsisRadius } from '../../sim/orbit';
import { stageBurnTime, NODE_STAGE_PAUSE } from '../../sim/vessel';
import { cachedStageDeltaV } from '../../game/stageDeltaVCache';

/** Estimated burn duration for `dv` on the ignited engines, else the next powered stage (Infinity without thrust). */
export function burnTime(world: World, dv: number): number {
  const wv = world.active;
  if (!wv) return Infinity;
  const v = wv.state;
  const lit = v.parts.some(p => p.engine?.ignited && !p.engine.flamedOut);
  return stageBurnTime(cachedStageDeltaV(v, 0, world.universe.body(wv.body).surfaceGravity),
    v.nextStage + (lit ? 1 : 0), dv, NODE_STAGE_PAUSE, lit);
}

/** The trajectory patch a node sits on (the orbit before its burn). */
export function patchAtNode(patches: readonly TrajectoryPatch[], node: ManeuverNode): TrajectoryPatch | undefined {
  return patches.find((p) => node.time >= p.startTime && node.time <= p.endTime + 1e-6);
}

export interface NodeSummary {
  dv: number;
  burn: number;
  /** Orbit after the burn. */
  body: string;
  ap: number;
  pe: number;
  /** Period of the orbit the node sits on (for ±1 orbit). */
  orbitPeriod: number;
  /** First SOI encounter after the burn. */
  encounter?: string;
  /** Periapsis altitude inside that encounter (m above the body's datum; negative = impact). */
  encounterPe?: number;
}

export function nodeSummary(world: World, node: ManeuverNode): NodeSummary {
  const patches = world.trajectory();
  const dv = Math.hypot(node.prograde, node.normal, node.radial);
  const before = patchAtNode(patches, node);
  // A burn in progress leads with a zero-length patch of the current orbit (starting after the node): the plan is the
  // patch that starts at the node itself.
  const after = patches.find((p) => Math.abs(p.startTime - node.time) < 1e-3) ?? patches.find((p) => p.startTime >= node.time - 1e-3) ?? patches[patches.length - 1];
  const body = after?.orbit.body ?? world.active?.body ?? world.universe.sunId;
  const radius = world.universe.body(body).radius;
  const index = after ? patches.indexOf(after) : patches.length;
  const enc = patches.findIndex((p, i) => i >= index && p.endReason === 'soiEnter');
  const inside = enc >= 0 ? patches[enc + 1] : undefined;
  return {
    dv,
    burn: burnTime(world, dv),
    body,
    ap: after ? apoapsisRadius(after.orbit) - radius : NaN,
    pe: after ? periapsisRadius(after.orbit) - radius : NaN,
    orbitPeriod: before ? period(before.orbit) : NaN,
    encounter: enc >= 0 ? patches[enc].nextBody : undefined,
    encounterPe: inside ? periapsisRadius(inside.orbit) - world.universe.body(inside.orbit.body).radius : undefined,
  };
}

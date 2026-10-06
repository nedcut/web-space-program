import type { World } from '../../game/world';
import type { ManeuverNode, TrajectoryPatch } from '../../sim/orbit/api';
import { apoapsisRadius, burnTimeEstimate, period, periapsisRadius } from '../../sim/orbit';
import { computeStageDeltaV } from '../../sim/vessel';
import { thrustLimit } from '../../sim/vessel/tweaks';

/** Estimated burn duration for `dv` on the ignited engines, else the next powered stage (Infinity without thrust). */
export function burnTime(world: World, dv: number): number {
  const wv = world.active;
  if (!wv) return Infinity;
  let thrust = wv.state.parts.reduce((s, p) => {
    const e = p.def.modules.find((m) => m.type === 'engine');
    return s + (e && e.type === 'engine' && p.engine?.ignited ? e.maxThrustVac * thrustLimit(p) : 0);
  }, 0);
  let isp = 300;
  try {
    const stages = computeStageDeltaV(wv.state, 0, world.universe.body(wv.body).surfaceGravity);
    // Engines not lit yet: plan with the next stage that has thrust (as the stage readout does).
    const st = thrust > 0 ? stages[0] : stages.find(x => x.thrustVac > 0);
    if (st?.isp) isp = st.isp;
    if (!(thrust > 0)) thrust = st?.thrustVac ?? 0;
  } catch {
    /* keep default */
  }
  try { return thrust > 0 ? burnTimeEstimate(dv, thrust, wv.state.mass, isp) : Infinity; } catch { return Infinity; }
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
}

export function nodeSummary(world: World, node: ManeuverNode): NodeSummary {
  const patches = world.trajectory();
  const dv = Math.hypot(node.prograde, node.normal, node.radial);
  const before = patchAtNode(patches, node);
  const after = patches.find((p) => p.startTime >= node.time - 1e-3) ?? patches[patches.length - 1];
  const body = after?.orbit.body ?? world.active?.body ?? world.universe.sunId;
  const radius = world.universe.body(body).radius;
  const index = after ? patches.indexOf(after) : patches.length;
  return {
    dv,
    burn: burnTime(world, dv),
    body,
    ap: after ? apoapsisRadius(after.orbit) - radius : NaN,
    pe: after ? periapsisRadius(after.orbit) - radius : NaN,
    orbitPeriod: before ? period(before.orbit) : NaN,
    encounter: patches.slice(index).find((p) => p.endReason === 'soiEnter')?.nextBody,
  };
}

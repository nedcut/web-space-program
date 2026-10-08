import type { ManeuverAnchor, ManeuverNode, Orbit, StateVector } from './api';
import { propagate } from './kepler';
import { add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../../util/vec3';
export type ManeuverComponents = Pick<ManeuverNode, 'prograde' | 'normal' | 'radial'>;
function frame(state: StateVector): { prograde: Vec3; normal: Vec3; radial: Vec3 } {
  const prograde = normalize(length(state.velocity) > 0 ? state.velocity : state.position);
  if (length(prograde) === 0) throw new RangeError('Maneuver requires a nonzero state');
  let normal = normalize(cross(state.position, state.velocity));
  if (length(normal) < 0.5) normal = normalize(cross(prograde, Math.abs(prograde.z) < 0.9 ? v3(0, 0, 1) : v3(0, 1, 0)));
  // Radial-out is perpendicular to velocity, i.e. radial projected off prograde.
  return { prograde, normal, radial: cross(prograde, normal) };
}
export function maneuverToInertialDv(stateAtNode: StateVector, node: ManeuverComponents): Vec3 {
  const f = frame(stateAtNode);
  return add(add(scale(f.prograde, node.prograde), scale(f.normal, node.normal)), scale(f.radial, node.radial));
}
export function inertialDvToManeuver(stateAtNode: StateVector, dv: Vec3): ManeuverComponents {
  const f = frame(stateAtNode);
  return { prograde: dot(dv, f.prograde), normal: dot(dv, f.normal), radial: dot(dv, f.radial) };
}
/** Ideal constant-thrust burn, including falling mass. dv in m/s, thrust N, mass kg, isp s. */
export function burnTimeEstimate(dv: number, thrust: number, mass: number, isp: number): number {
  if (![dv, thrust, mass, isp].every(Number.isFinite) || mass <= 0 || isp <= 0 || thrust < 0) throw new RangeError('Invalid burn parameters');
  if (dv === 0) return 0;
  if (thrust === 0) return Infinity;
  const ve = isp * 9.80665;
  return mass * -Math.expm1(-Math.abs(dv) / ve) * ve / thrust;
}

/** The anchor of `node` when it is still valid for `body` (the node has not been edited since it was taken). */
export function validAnchor(node: ManeuverNode, body: string): ManeuverAnchor | undefined {
  const a = node.anchor;
  return a && a.body === body && a.time === node.time && a.prograde === node.prograde && a.normal === node.normal && a.radial === node.radial ? a : undefined;
}

/** Planned state just after the node's burn: its frozen anchor when it has one, else `before` plus the node's Δv. */
export function stateAfterManeuver(before: StateVector, body: string, node: ManeuverNode): StateVector {
  const a = validAnchor(node, body);
  if (a) return { position: a.position, velocity: a.velocity };
  return { position: before.position, velocity: add(before.velocity, maneuverToInertialDv(before, node)) };
}

/** Freeze the node's planned post-burn state from `orbit` (the orbit the vessel is on before the burn). */
export function takeAnchor(orbit: Orbit, node: ManeuverNode): ManeuverAnchor {
  const s = propagate(orbit, node.time), after = stateAfterManeuver(s, orbit.body, { ...node, anchor: undefined });
  return { body: orbit.body, position: after.position, velocity: after.velocity, time: node.time, prograde: node.prograde, normal: node.normal, radial: node.radial };
}

/**
 * Δv (inertial, m/s) still to burn: the planned velocity at the node time minus the orbit's velocity there. Before the
 * burn this is the node's own vector; during it, the vessel's orbit evaluated at the node time converges on the plan.
 */
export function remainingManeuverDv(orbit: Orbit, node: ManeuverNode): Vec3 {
  const s = propagate(orbit, node.time);
  return sub(stateAfterManeuver(s, orbit.body, node).velocity, s.velocity);
}

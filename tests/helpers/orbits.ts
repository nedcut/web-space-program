import { World, type WorldVessel } from '../../src/game/world';
import { Universe } from '../../src/game/universe';
import { PART_CATALOG } from '../../src/data/parts';
import type { CraftDef } from '../../src/sim/vessel/types';
import type { ScalePresetId } from '../../src/sim/bodies';
import { stateToElements } from '../../src/sim/orbit';
import { qRotate } from '../../src/util/quat';
import { add, cross, scale, v3, type Vec3 } from '../../src/util/vec3';
import { requireIntactFlight } from './structural';

export interface OrbitSpec {
  /** Periapsis / apoapsis altitude above the body's radius, m (apoapsis defaults to circular). */
  pe: number;
  ap?: number;
  /** Inclination to the body's equator, degrees. */
  inc: number;
  /** Longitude of the ascending node from the body's current prime meridian, degrees. */
  lan?: number;
  /** Argument of periapsis and true anomaly, degrees. */
  argPe?: number;
  nu?: number;
}

/** Body-relative state for `spec` in the body's equatorial frame at `ut`. */
export function orbitState(world: World, body: string, spec: OrbitSpec): { position: Vec3; velocity: Vec3 } {
  const u = world.universe, b = u.body(body), q = u.ephem.bodyRotation(body, world.ut);
  const Z = qRotate(q, v3(0, 0, 1)), X = qRotate(q, v3(1, 0, 0)), Y = cross(Z, X);
  const d = Math.PI / 180;
  const rp = b.radius + spec.pe, ra = b.radius + (spec.ap ?? spec.pe);
  const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp), p = a * (1 - e * e);
  const nu = (spec.nu ?? 0) * d, w = (spec.argPe ?? 0) * d, O = (spec.lan ?? 0) * d, i = spec.inc * d;
  const r = p / (1 + e * Math.cos(nu)), h = Math.sqrt(b.gm * p);
  // Perifocal → equatorial (3-1-3 rotation).
  const P = [Math.cos(O) * Math.cos(w) - Math.sin(O) * Math.sin(w) * Math.cos(i), Math.sin(O) * Math.cos(w) + Math.cos(O) * Math.sin(w) * Math.cos(i), Math.sin(w) * Math.sin(i)];
  const Q = [-Math.cos(O) * Math.sin(w) - Math.sin(O) * Math.cos(w) * Math.cos(i), -Math.sin(O) * Math.sin(w) + Math.cos(O) * Math.cos(w) * Math.cos(i), Math.cos(w) * Math.sin(i)];
  const toInertial = (c: number[]) => add(add(scale(X, c[0]), scale(Y, c[1])), scale(Z, c[2]));
  const Pi = toInertial(P), Qi = toInertial(Q);
  const position = add(scale(Pi, r * Math.cos(nu)), scale(Qi, r * Math.sin(nu)));
  const velocity = add(scale(Pi, -(b.gm / h) * Math.sin(nu)), scale(Qi, (b.gm / h) * (e + Math.cos(nu))));
  return { position, velocity };
}

/** Put `vessel` on rails on the given body-relative state. */
export function placeOnState(world: World, vessel: WorldVessel, body: string, s: { position: Vec3; velocity: Vec3 }) {
  const u = world.universe, bs = u.ephem.getBodyState(body, world.ut), b = u.body(body);
  vessel.body = body;
  vessel.state.position = add(bs.position, s.position);
  vessel.state.velocity = add(bs.velocity, s.velocity);
  vessel.state.situation = 'flying'; vessel.mode = 'rails'; vessel.fixed = undefined;
  vessel.orbit = stateToElements(b.gm, body, s.position, s.velocity, world.ut);
  vessel.state.angularVelocity = v3();
}

/** A world with `craft` launched and moved onto `spec` around `body`. */
export function worldInOrbit(preset: ScalePresetId, ut: number, craft: CraftDef, body: string, spec: OrbitSpec) {
  const world = new World(new Universe(preset), PART_CATALOG, ut);
  requireIntactFlight(world);
  const vessel = world.launch(craft);
  placeOnState(world, vessel, body, orbitState(world, body, spec));
  return { world, vessel };
}

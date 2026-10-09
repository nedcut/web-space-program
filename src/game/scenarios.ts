import type { CraftDef } from '../sim/vessel/types';
import { freePorts } from '../sim/vessel';
import { propagate, stateToElements } from '../sim/orbit';
import { add, cross, normalize, scale, sub, v3, type Vec3 } from '../util/vec3';
import { qRotate } from '../util/quat';
import { quatFromBasis, type World, type WorldVessel } from './world';

/**
 * Scenario helpers shared by dev URL scenarios (`?scenario=`) and tests.
 */

/** Put a vessel into a circular equatorial-ish orbit above its current ground track, nose prograde. */
export function placeInCircularOrbit(world: World, wv: WorldVessel, bodyId: string, altitude: number) {
  const u = world.universe;
  const t = world.ut;
  const b = u.body(bodyId);
  const bs = u.ephem.getBodyState(bodyId, t);
  const up = normalize(sub(wv.state.position, u.ephem.getBodyState(wv.body, t).position));
  const pole = qRotate(u.ephem.bodyRotation(bodyId, t), v3(0, 0, 1));
  const east = normalize(cross(pole, up));
  const vel = scale(east, Math.sqrt(b.gm / (b.radius + altitude)));
  wv.mode = 'physics';
  wv.fixed = undefined;
  wv.body = bodyId;
  wv.state.position = add(bs.position, scale(up, b.radius + altitude));
  wv.state.velocity = add(bs.velocity, vel);
  wv.state.situation = 'flying';
  const fwd = normalize(vel);
  const side = normalize(cross(fwd, up));
  wv.state.orientation = quatFromBasis(side, fwd, cross(side, fwd));
  wv.state.angularVelocity = v3();
}

/**
 * Spawn a copy of `craft` `ahead` metres further along the active vessel's orbit, turned to face it (nose
 * retrograde), and target its first free docking port.
 */
export function spawnRendezvousTarget(world: World, craft: CraftDef, ahead = 100): WorldVessel | null {
  const act = world.active;
  if (!act) return null;
  const u = world.universe;
  const t = world.ut;
  const rs = world.relativeState(act);
  const o = stateToElements(u.body(act.body).gm, act.body, rs.position, rs.velocity, t);
  const speed = Math.hypot(rs.velocity.x, rs.velocity.y, rs.velocity.z);
  const s = propagate(o, t + ahead / speed);
  const bs = u.ephem.getBodyState(act.body, t);
  const up = normalize(s.position);
  const back = normalize(scale(s.velocity, -1));
  const side = normalize(cross(back, up));
  const wv = world.spawnVessel(
    craft,
    { position: add(bs.position, s.position), velocity: add(bs.velocity, s.velocity), orientation: quatFromBasis(side, back, cross(side, back)) },
    `${craft.name} Target`,
  );
  const port = freePorts(wv.state)[0];
  world.setTarget(wv.state.id, port ? port.part.uid : null);
  return wv;
}

/** Place an upright craft at rest on analytic terrain; useful for surface training and missions. */
/**
 * The most level body-fixed direction on a grid of `n`×`n` points spanning `span` radians around `direction`,
 * judged by the terrain gradient across a `footprint`-metre base (so a lander set down there stays upright).
 */
export function levelSite(world: World, bodyId: string, direction = v3(1, 0, 0), span = 0.01, n = 9, footprint = 4): Vec3 {
  const terrain = world.universe.terrain(bodyId), radius = world.universe.body(bodyId).radius;
  const d0 = normalize(direction);
  const tA = normalize(Math.abs(d0.z) < 0.9 ? cross(v3(0, 0, 1), d0) : cross(v3(1, 0, 0), d0)), tB = cross(d0, tA);
  const eps = footprint / radius;
  const h = (d: Vec3) => terrain.heightAt(d.x, d.y, d.z);
  let best = d0, bestSlope = Infinity;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = (i / (n - 1) - 0.5) * span, b = (j / (n - 1) - 0.5) * span;
    const d = normalize(add(d0, add(scale(tA, a), scale(tB, b))));
    const ga = (h(normalize(add(d, scale(tA, eps)))) - h(normalize(sub(d, scale(tA, eps))))) / (2 * footprint);
    const gb = (h(normalize(add(d, scale(tB, eps)))) - h(normalize(sub(d, scale(tB, eps))))) / (2 * footprint);
    const slope = Math.hypot(ga, gb);
    if (slope < bestSlope) { bestSlope = slope; best = d; }
  }
  return best;
}

export function placeOnSurface(world: World, wv: WorldVessel, bodyId: string, direction = v3(1, 0, 0)) {
  const u = world.universe;
  const up = normalize(direction);
  const rotation = u.ephem.bodyRotation(bodyId, world.ut);
  const inertialUp = qRotate(rotation, up);
  const east = normalize(cross(qRotate(rotation, v3(0, 0, 1)), inertialUp));
  const rel = scale(inertialUp, u.body(bodyId).radius + u.terrain(bodyId).heightAt(up.x, up.y, up.z) + world.bottomOffset(wv.state) + 0.05);
  const bs = u.ephem.getBodyState(bodyId, world.ut);
  wv.body = bodyId;
  wv.mode = 'physics';
  wv.fixed = undefined;
  wv.state.position = add(bs.position, rel);
  wv.state.velocity = add(bs.velocity, u.ephem.surfaceVelocity(bodyId, rel, world.ut));
  wv.state.orientation = quatFromBasis(east, inertialUp, cross(east, inertialUp));
  wv.state.angularVelocity = v3();
  wv.state.situation = 'landed';
  for (const part of wv.state.parts) if (part.leg) part.leg.deployed = true;
}

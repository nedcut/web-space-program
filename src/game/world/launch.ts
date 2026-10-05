import { RESOURCES } from '../../data/resources';
import { launchCost, launchProblem } from '../../data/technology';
import { latLonToUnit, LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../../sim/terrain';
import { buildVessel } from '../../sim/vessel';
import { wheelContactPoint } from '../../sim/vessel/contact';
import type { VesselState } from '../../sim/vessel/runtime';
import { hullPoints } from '../../sim/vessel/shapes';
import type { CraftDef } from '../../sim/vessel/types';
import { qConj, qRotate, type Quat } from '../../util/quat';
import { add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../../util/vec3';
import { recoverScience } from '../science';
import { Universe } from '../universe';
import type { World, WorldVessel } from '../world';
import { quatFromBasis } from '../../util/basis';
import type { WorldInternals } from './internals';
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);

/** Lowest point of the vessel along its own -Y axis, measured from the COM (positive number). */
export function bottomOffset(this: World, _internals: WorldInternals, v: VesselState): number {
  let minY = Infinity;
  for (const p of v.parts) {
    const s = p.def.shape;
    const ext = s.kind === 'cylinder' ? s.height / 2 : s.size.y / 2;
    // Account for rotated parts conservatively using the rotated local Y extent.
    const upInPart = qRotate(qConj(p.rotation), v3(0, 1, 0));
    const radial = s.kind === 'cylinder' ? Math.max(s.radiusTop, s.radiusBottom) : Math.max(s.size.x, s.size.z) / 2;
    const extY = Math.abs(upInPart.y) * ext + Math.sqrt(Math.max(0, 1 - upInPart.y * upInPart.y)) * radial;
    minY = Math.min(minY, p.position.y - extY);
    for (const m of p.def.modules) {
      if (m.type === 'landingLeg') {
        const foot = add(p.position, qRotate(p.rotation, m.footPosition));
        minY = Math.min(minY, foot.y);
      }
    }
  }
  return v.com.y - minY;
}

/**
   * Distance from the COM to the vessel's lowest point along body direction `down` (unit, body frame): hull
   * points of every part and the tyres of deployed wheels at full suspension extension.
   */
export function restOffset(this: World, _internals: WorldInternals, v: VesselState, down: Vec3): number {
  let best = 0;
  for (const p of v.parts) {
    for (const hp of hullPoints(p.def)) best = Math.max(best, dot(sub(add(p.position, qRotate(p.rotation, hp)), v.com), down));
    if (p.wheel && p.wheel.deploy >= 1) {
      const g = wheelContactPoint(v, p);
      best = Math.max(best, dot(sub(g.center, v.com), down) + g.module.radius);
    }
  }
  return best;
}

/**
   * Spawn a craft. 'pad' (default for VAB crafts): on the launch pad, held by launch clamps until the first
   * stage fires. 'runway' (default for SPH crafts): free on its wheels at the runway threshold, nose down the
   * runway (body +Y along the runway, +Z up), ready to taxi.
   */
export function launch(this: World, internals: WorldInternals, craft: CraftDef, site: 'pad' | 'runway' = craft.type === 'SPH' ? 'runway' : 'pad', keepExisting = false): WorldVessel {
  const problem = launchProblem(craft, this.catalog, this.mode, this.progression);
  if (problem) throw new Error(problem);
  // Validate assembly before charging or clearing the launch site.
  buildVessel(craft, this.catalog, { id: 'validation', resourceDefs: RESOURCES });
  if (this.mode === 'career') this.progression.funds -= launchCost(craft, this.catalog);
  if (site === 'runway') return internals.launchRunway(craft, keepExisting);
  const u = this.universe;
  const bodyId = 'earth';
  const body = u.body(bodyId);
  const dir = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const terrainH = Math.max(0, u.terrain(bodyId).heightAt(dir.x, dir.y, dir.z));
  // Body-fixed basis at the pad: +Y up, +X east, +Z = X × Y (south).
  const up = v3(dir.x, dir.y, dir.z);
  const east = normalize(cross(v3(0, 0, 1), up));
  const zAxis = cross(east, up);
  const orientFixed = quatFromBasis(east, up, zAxis);

  // Clear the pad: anything still clamped, or resting within 150 m of the pad, is recovered.
  const padHelio = add(u.ephem.getBodyState(bodyId, this.ut).position, qRotate(bodyQuat(u, bodyId, this.ut), scale(up, body.radius + terrainH)));
  for (const [id, other] of keepExisting ? [] : this.vessels) {
    const near = length(sub(other.state.position, padHelio)) < 150;
    if (other.mode === 'prelaunch' || (near && other.state.situation !== 'flying')) { recoverScience(this, other); this.vessels.delete(id); }
  }
  const state = buildVessel(craft, this.catalog, { id: internals.newVesselId(), resourceDefs: RESOURCES, legsDeployed: false });
  state.name = craft.name;
  if (this.mode === 'career') for (const p of state.parts) p.purchaseCost = p.def.cost;
  this.assignCrew(state);
  const bottom = this.bottomOffset(state);
  const posFixed = scale(up, body.radius + terrainH + bottom + 0.05);
  const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: posFixed, orient: orientFixed } };
  internals.syncFixed(wv, this.ut);
  this.vessels.set(state.id, wv);
  this.activeId = state.id;
  this.nodes = [];
  this.warp = { mode: 'rails', index: 0 };
  return wv;
}


export function launchRunway(this: World, internals: WorldInternals, craft: CraftDef, keepExisting = false): WorldVessel {
  const u = this.universe;
  const bodyId = 'earth';
  const body = u.body(bodyId);
  const along = RUNWAY.length / 2 - RUNWAY.spawnInset;
  const lx = RUNWAY.x - RUNWAY.dirX * along, lz = RUNWAY.z - RUNWAY.dirZ * along;
  const dir = siteLocalToUnit(lx, lz, body.radius);
  const ahead = siteLocalToUnit(lx + RUNWAY.dirX * 100, lz + RUNWAY.dirZ * 100, body.radius);
  const terrainH = Math.max(0, u.terrain(bodyId).heightAt(dir.x, dir.y, dir.z));
  const up = v3(dir.x, dir.y, dir.z);
  let fwd = sub(v3(ahead.x, ahead.y, ahead.z), up);
  fwd = normalize(sub(fwd, scale(up, dot(fwd, up))));
  // Body axes: +Y (nose) down the runway, +Z (top) up, +X = Y × Z (right wing).
  const orientFixed = quatFromBasis(cross(fwd, up), fwd, up);

  const spotHelio = add(u.ephem.getBodyState(bodyId, this.ut).position, qRotate(bodyQuat(u, bodyId, this.ut), scale(up, body.radius + terrainH)));
  for (const [id, other] of keepExisting ? [] : this.vessels)
    if (length(sub(other.state.position, spotHelio)) < 100 && other.state.situation !== 'flying') { recoverScience(this, other); this.vessels.delete(id); }
  const state = buildVessel(craft, this.catalog, { id: internals.newVesselId(), resourceDefs: RESOURCES, legsDeployed: false, gearDeployed: true });
  state.name = craft.name;
  if (this.mode === 'career') for (const p of state.parts) p.purchaseCost = p.def.cost;
  this.assignCrew(state);
  const rest = this.restOffset(state, v3(0, 0, -1));
  const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: scale(up, body.radius + terrainH + rest + 0.03), orient: orientFixed } };
  internals.syncFixed(wv, this.ut);
  // Free on its wheels straight away (no clamps): physics from the first step.
  wv.mode = 'physics';
  wv.fixed = undefined;
  state.situation = 'landed';
  this.vessels.set(state.id, wv);
  this.activeId = state.id;
  this.nodes = [];
  this.warp = { mode: 'rails', index: 0 };
  return wv;
}


export function newVesselId(this: World, _internals: WorldInternals): string {
  const base = `v${Date.now().toString(36)}`;
  let id = base;
  for (let i = 1; this.vessels.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Add a free-flying craft with the given inertial COM state and attitude (physics mode; not made active). */
export function spawnVessel(this: World, _internals: WorldInternals, craft: CraftDef, state: { position: Vec3; velocity: Vec3; orientation: Quat }, name = craft.name): WorldVessel {
  let id = `v${Date.now().toString(36)}`;
  for (let k = 1; this.vessels.has(id); k++) id = `v${Date.now().toString(36)}-${k}`;
  const vs = buildVessel(craft, this.catalog, { id, resourceDefs: RESOURCES, ...state });
  vs.name = name;
  this.assignCrew(vs);
  const wv: WorldVessel = { state: vs, mode: 'physics', body: this.universe.dominantBody(vs.position, this.ut) };
  this.vessels.set(id, wv);
  return wv;
}

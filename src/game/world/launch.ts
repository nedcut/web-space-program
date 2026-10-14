import { RESOURCES } from '../../data/resources';
import { launchCost, launchProblem } from '../../data/technology';
import { latLonToUnit, LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../../sim/terrain';
import { buildVessel } from '../../sim/vessel';
import { wheelContactPoint } from '../../sim/vessel/contact';
import type { VesselState } from '../../sim/vessel/runtime';
import { hullPoints } from '../../sim/vessel/shapes';
import type { CraftDef } from '../../sim/vessel/types';
import { qConj, qFromAxisAngle, qMul, qRotate, type Quat } from '../../util/quat';
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
 * Static rest pose of a vessel standing on its deployed wheels (body +Z up): how far the COM sinks below the
 * "tyres just touching" height and the small pitch/roll the springs settle at, solved so the spring forces carry
 * the weight with no net moment about the COM. Spawning there means a plane does not drop onto its gear and
 * rock when the flight loads. Null when the wheels cannot carry the vessel alone (it then settles under physics).
 */
export function wheelRestPose(v: VesselState, rest: number, gravity: number): { sink: number; pitch: number; roll: number } | null {
  const wheels: { a: [number, number, number]; gap: number; k: number; travel: number }[] = [];
  for (const p of v.parts) {
    if (!p.wheel || p.wheel.deploy < 1) continue;
    const g = wheelContactPoint(v, p);
    const b = sub(add(g.center, scale(g.down, g.module.radius)), v.com);
    // Penetration for COM sink s, pitch α (about +X) and roll β (about +Y): s − α·y + β·x − gap.
    wheels.push({ a: [1, -b.y, b.x], gap: rest + b.z, k: g.module.spring, travel: g.module.travel });
  }
  if (wheels.length < 3) return null;
  const W = v.mass * gravity;
  const u = [0, 0, 0];
  for (let it = 0; it < 60; it++) {
    const r = [-W, 0, 0];
    const J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const w of wheels) {
      const pen = w.a[0] * u[0] + w.a[1] * u[1] + w.a[2] * u[2] - w.gap;
      if (pen <= 0) continue;
      const F = w.k * Math.min(pen, w.travel);
      const k = pen < w.travel ? w.k : 0;
      for (let i = 0; i < 3; i++) { r[i] += F * w.a[i]; for (let j = 0; j < 3; j++) J[i * 3 + j] += k * w.a[i] * w.a[j]; }
    }
    // Damped Newton; the regulariser keeps the step finite while fewer than three tyres touch.
    const kSum = wheels.reduce((s, w) => s + w.k, 0);
    for (let i = 0; i < 3; i++) J[i * 4] += kSum * 1e-6 + (i ? kSum * 1e-3 : 0);
    const du = solve3(J, r);
    if (!du) return null;
    const step = Math.min(1, 0.05 / Math.max(1e-9, Math.abs(du[0]), Math.abs(du[1]), Math.abs(du[2])));
    for (let i = 0; i < 3; i++) u[i] -= du[i] * step;
    if (Math.abs(r[0]) < W * 1e-4 && Math.max(Math.abs(du[0]), Math.abs(du[1]), Math.abs(du[2])) < 1e-6) break;
  }
  // Only small, sane poses (a tail-sitter or tipping craft is left to the physics).
  if (!(u[0] >= 0 && u[0] < 1 && Math.abs(u[1]) < 0.15 && Math.abs(u[2]) < 0.15)) return null;
  return { sink: u[0], pitch: u[1], roll: u[2] };
}

function solve3(A: number[], b: number[]): number[] | null {
  const det = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = det(A);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-30) return null;
  return [0, 1, 2].map(c => det(A.map((x, i) => (i % 3 === c ? b[(i / 3) | 0] : x))) / d);
}

/**
   * Spawn a craft. 'pad' (default for VAB crafts): on the launch pad, held by launch clamps until the first
   * stage fires. 'runway' (default for SPH crafts): free on its wheels at the runway threshold, nose down the
   * runway (body +Y along the runway, +Z up), ready to taxi.
   */
export function launch(this: World, internals: WorldInternals, craft: CraftDef, site: 'pad' | 'runway' = craft.type === 'SPH' ? 'runway' : 'pad', keepExisting = false): WorldVessel {
  const problem = launchProblem(craft, this.catalog, this.mode, this.progression, this.universe.preset);
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
    if (other.mode === 'prelaunch' || (near && other.state.situation !== 'flying')) { this.finishFlight(other, 'recovered'); recoverScience(this, other); this.vessels.delete(id); }
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
    if (length(sub(other.state.position, spotHelio)) < 100 && other.state.situation !== 'flying') { this.finishFlight(other, 'recovered'); recoverScience(this, other); this.vessels.delete(id); }
  const state = buildVessel(craft, this.catalog, { id: internals.newVesselId(), resourceDefs: RESOURCES, legsDeployed: false, gearDeployed: true });
  state.name = craft.name;
  if (this.mode === 'career') for (const p of state.parts) p.purchaseCost = p.def.cost;
  this.assignCrew(state);
  const rest = this.restOffset(state, v3(0, 0, -1));
  // Start at the static rest pose on the gear (compressed springs), not dropped onto it.
  const pose = wheelRestPose(state, rest, body.surfaceGravity);
  const orient = pose ? qMul(orientFixed, qMul(qFromAxisAngle(v3(1, 0, 0), pose.pitch), qFromAxisAngle(v3(0, 1, 0), pose.roll))) : orientFixed;
  const height = pose ? rest - pose.sink + 0.002 : rest + 0.03;
  const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: scale(up, body.radius + terrainH + height), orient } };
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

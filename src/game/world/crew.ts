import { EVA_PART } from '../../data/eva';
import { RESOURCES } from '../../data/resources';
import { remoteControlAllowed } from '../../sim/comms/network';
import { crewIds, generateAstronaut, hasControl, seatCapacity, type Astronaut, type PlantedFlag } from '../../sim/crew/crew';
import { buildVessel, collideEvaWithHull, recomputeMassProperties, EVA_HEIGHT } from '../../sim/vessel';
import type { PartState, VesselState } from '../../sim/vessel/runtime';
import type { Quat } from '../../util/quat';
import { qConj, qFromAxisAngle, qFromTo, qIdentity, qMul, qRotate } from '../../util/quat';
import { add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../../util/vec3';
import { Universe } from '../universe';
import { latLonToUnit, LAUNCH_PAD_PIT, LAUNCH_SITE } from '../../sim/terrain';
import type { World, WorldVessel } from '../world';
import type { WorldInternals } from './internals';
export const BOARD_RANGE = 3;
export const BOARD_SPEED = 3;
/** Height of a hatch above a grounded astronaut that boarding treats as climbable (implicit ladder). */
export const BOARD_CLIMB = 10;
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);

/** Assign only newly created pods. Existing empty seats must stay empty. */
export function assignCrew(this: World, _internals: WorldInternals, v: VesselState): void {
  for (const p of v.parts) {
    if (!seatCapacity(p) || p.crew) continue;
    p.crew = [];
    for (let i = 0; i < seatCapacity(p); i++) {
      const astronaut = generateAstronaut(this.crewSeed, this.crew.length);
      this.crew.push(astronaut);
      p.crew.push(astronaut.id);
    }
  }
  recomputeMassProperties(v, false);
}


export function crewFor(this: World, _internals: WorldInternals, v = this.active?.state): Astronaut[] {
  const ids = v ? crewIds(v) : [];
  return ids.flatMap(id => this.crew.find(c => c.id === id) ?? []);
}


export function canControl(this: World, _internals: WorldInternals, v = this.active?.state): boolean {
  if (!v || !hasControl(v)) return false;
  const crewed = crewIds(v).length > 0;
  // Avoid solving a network for local control or a disabled difficulty setting.
  if (remoteControlAllowed(this.commsSettings, crewed, false)) return true;
  return this.connection(v).connected;
}

/** Hatch is on the pod's +Z face. Public for HUD/rendezvous tools. */
export function hatchPosition(this: World, _internals: WorldInternals, v: VesselState, pod: PartState): Vec3 {
  const shape = pod.def.shape;
  const radius = shape.kind === 'box' ? shape.size.z / 2 : Math.max(shape.radiusTop, shape.radiusBottom);
  return add(v.position, qRotate(v.orientation, sub(add(pod.position, qRotate(pod.rotation, v3(0, 0, radius + 0.6))), v.com)));
}


/** Standing on the ground (or water), on the pad, or packed as landed. */
function grounded(wv: WorldVessel): boolean {
  return wv.mode === 'prelaunch' || wv.mode === 'landedRails' || wv.state.situation === 'landed' || wv.state.situation === 'splashed';
}

/** Half-extent of a part's collision shape along the world direction `d`, given the part's world attitude. */
function partExtent(p: PartState, q: Quat, d: Vec3): number {
  const s = p.def.shape;
  if (s.kind === 'box') return Math.abs(dot(qRotate(q, v3(1, 0, 0)), d)) * s.size.x / 2 + Math.abs(dot(qRotate(q, v3(0, 1, 0)), d)) * s.size.y / 2 + Math.abs(dot(qRotate(q, v3(0, 0, 1)), d)) * s.size.z / 2;
  const c = Math.abs(dot(qRotate(q, v3(0, 1, 0)), d));
  return c * s.height / 2 + Math.max(s.radiusTop, s.radiusBottom) * Math.sqrt(Math.max(0, 1 - c * c));
}

/**
 * Where an astronaut stands to use a grounded vessel's hatch: level with the hatch, straight out from the vessel
 * past every part in the way (fins, wider stages, landing legs), so the ground below is clear of the hull.
 * Implicit ladder: leaving a grounded vessel climbs down to the ground there, and boarding from the ground is
 * measured from there, at any hatch height (ladders stay visual, D-015).
 */
function hatchColumn(world: World, v: VesselState, pod: PartState, up: Vec3, turn = 0): Vec3 {
  const hatch = world.hatchPosition(v, pod);
  const flat = (x: Vec3) => sub(x, scale(up, dot(x, up)));
  let out = flat(sub(hatch, v.position));
  if (length(out) < 0.05) out = flat(qRotate(v.orientation, qRotate(pod.rotation, v3(0, 0, 1))));
  if (length(out) < 1e-6) out = flat(v3(1, 0, 0));
  if (length(out) < 1e-6) out = flat(v3(0, 1, 0));
  out = qRotate(qFromAxisAngle(up, turn), normalize(out));
  const side = cross(up, out);
  let reach = dot(sub(hatch, v.position), out);
  for (const p of v.parts) {
    const q = qMul(v.orientation, p.rotation);
    const c = qRotate(v.orientation, sub(p.position, v.com));
    // Only parts across the astronaut's path (half-width ~0.4 m) are in the way.
    if (Math.abs(dot(c, side)) - partExtent(p, q, side) > 0.4) continue;
    reach = Math.max(reach, dot(c, out) + partExtent(p, q, out) + 0.6);
  }
  return add(add(v.position, scale(out, reach)), scale(up, dot(sub(hatch, v.position), up)));
}

/**
 * Where to climb down: the hatch side, unless that is over the pad's flame pit (grated, but right under the engines);
 * then the side (hatch side, quarter turns, opposite) that needs the shortest walk out to clear the pit.
 */
const exitMemo = new WeakMap<PartState, { ut: number; vessel: VesselState; column: Vec3 }>();
function exitColumn(world: World, vessel: WorldVessel, pod: PartState, up: Vec3): Vec3 {
  // Boarding target and blocker ask for the same spot in one telemetry update.
  const memo = exitMemo.get(pod);
  if (memo && memo.ut === world.ut && memo.vessel === vessel.state) return memo.column;
  const column = findExitColumn(world, vessel, pod, up);
  exitMemo.set(pod, { ut: world.ut, vessel: vessel.state, column });
  return column;
}
function findExitColumn(world: World, vessel: WorldVessel, pod: PartState, up: Vec3): Vec3 {
  const first = hatchColumn(world, vessel.state, pod, up);
  const pad = padFrame(world, vessel.body);
  const overPit = (p: Vec3) => !!pad && inPit(pad, p);
  if (!overPit(first)) return first;
  let best: { column: Vec3; extra: number } | null = null;
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const column = turn ? hatchColumn(world, vessel.state, pod, up, turn) : first;
    const out = sub(column, vessel.state.position);
    const dir = normalize(sub(out, scale(up, dot(out, up))));
    for (let extra = 0; extra <= 16 && (!best || extra < best.extra); extra += 0.5) {
      const p = add(column, scale(dir, extra));
      if (!overPit(p)) { best = { column: p, extra }; break; }
    }
  }
  return best?.column ?? first;
}

interface PadFrame { origin: Vec3; east: Vec3; south: Vec3 }
/** The launch pad's centre and horizontal axes (inertial, now); null away from Earth. */
function padFrame(world: World, body: string): PadFrame | null {
  if (body !== 'earth') return null;
  const u = world.universe;
  const dir = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const east = normalize(cross(v3(0, 0, 1), dir));
  const q = bodyQuat(u, body, world.ut);
  return { origin: add(u.ephem.getBodyState(body, world.ut).position, qRotate(q, scale(dir, u.body(body).radius))), east: qRotate(q, east), south: qRotate(q, cross(east, dir)) };
}
function inPit(pad: PadFrame, p: Vec3): boolean {
  const d = sub(p, pad.origin);
  const x = dot(d, pad.east), z = dot(d, pad.south);
  const m = LAUNCH_PAD_PIT.half + 0.6;
  return Math.abs(x) < m && z < m && z > LAUNCH_PAD_PIT.trenchEnd - 1;
}
/** True when a point is over the launch pad's flame hole or trench (grated over, flush with the deck). */
export function overPadPit(world: World, body: string, p: Vec3): boolean {
  const pad = padFrame(world, body);
  return !!pad && inPit(pad, p);
}

/** After each physics step: astronauts are kept out of the hulls of vessels around them (simulated or on the pad). */
export function collideAstronauts(world: World): void {
  for (const a of world.vessels.values()) {
    if (!a.state.eva || a.mode !== 'physics' || a.state.destroyed) continue;
    for (const v of world.vessels.values()) {
      if (v === a || v.state.eva || v.state.destroyed || v.body !== a.body || (v.mode !== 'physics' && v.mode !== 'prelaunch')) continue;
      collideEvaWithHull(a.state, v.state);
    }
  }
}

export function goEva(this: World, internals: WorldInternals, astronautId?: string): WorldVessel | null {
  const host = this.active;
  if (!host || host.state.eva || host.state.destroyed) return null;
  const onGround = grounded(host);
  const pod = host.state.parts.find(p => p.crew?.some(id => !astronautId || id === astronautId));
  if (!pod) { this.message('No astronaut aboard', 'warn'); return null; }
  if (host.mode === 'rails' || host.mode === 'landedRails') internals.unpack(host);
  this.warp = { mode: 'rails', index: 0 };
  const v = host.state;
  const id = astronautId ?? pod.crew![0];
  const person = this.crew.find(c => c.id === id)!;
  const pos = this.hatchPosition(v, pod);
  const originalPosition = { ...v.position }, velocity = { ...v.velocity }, mass = v.mass;
  const eva = buildVessel({ name: person.name, version: 1, type: 'VAB', parts: [{ uid: 1, partId: EVA_PART.id, position: v3(), rotation: qIdentity() }] }, this.catalog, { id: `eva-${id}`, position: pos, velocity, orientation: v.orientation, resourceDefs: RESOURCES });
  eva.eva = { astronautId: id, walkPhase: 0, walking: false, jetting: false };
  pod.crew = pod.crew!.filter(c => c !== id);
  recomputeMassProperties(v, false);
  // Move the remaining COM so the combined COM and linear momentum are unchanged by hatch transfer.
  v.position = sub(originalPosition, scale(sub(pos, originalPosition), eva.mass / v.mass));
  v.velocity = scale(velocity, (mass - eva.mass) / v.mass);
  if (host.mode === 'prelaunch') internals.captureFixed(host, this.ut);
  if (onGround) climbDown(this, host, pod, eva);
  const wv: WorldVessel = { state: eva, body: host.body, mode: 'physics' };
  this.vessels.set(eva.id, wv);
  this.switchTo(eva.id);
  internals.stageRequested = false;
  this.message(`${person.name} is on EVA`);
  return wv;
}


/** Put an astronaut leaving a grounded vessel on the ground beside it, upright and facing it. */
function climbDown(world: World, host: WorldVessel, pod: PartState, eva: VesselState) {
  const env = world.universe.createEnvironment(() => host.body);
  const up = normalize(sub(eva.position, world.universe.ephem.getBodyState(host.body, world.ut).position));
  let foot = exitColumn(world, host, pod, up);
  let ground = env.ground(foot, world.ut);
  // The surface sample is radial below the point; two passes settle it on slopes.
  for (let i = 0; i < 3 && ground; i++) {
    foot = add(ground.surfacePoint, scale(ground.normal, EVA_HEIGHT));
    ground = env.ground(foot, world.ut);
  }
  if (!ground) return;
  eva.position = foot;
  eva.velocity = { ...ground.surfaceVelocity };
  eva.situation = ground.isWater ? 'splashed' : 'landed';
  const upright = qMul(qFromTo(qRotate(eva.orientation, v3(0, 1, 0)), up), eva.orientation);
  const toVessel = sub(host.state.position, foot);
  const f = qRotate(upright, v3(0, 0, -1));
  const towards = normalize(sub(toVessel, scale(up, dot(toVessel, up))));
  eva.orientation = qMul(qFromAxisAngle(up, Math.atan2(dot(cross(f, towards), up), dot(f, towards))), upright);
}

/**
 * How far the astronaut's feet are above the ground: 0 standing, the hop/flight height when airborne. Measured
 * radially from the terrain (cheap, no normal), so standing on a slope is not mistaken for a hop.
 */
function footLift(world: World, eva: WorldVessel): number {
  if (eva.state.situation === 'landed' || eva.state.situation === 'splashed') return 0;
  return Math.max(0, world.universe.surfaceInfo(eva.body, eva.state.position, world.ut).heightAboveTerrain - EVA_HEIGHT);
}

/**
 * Distance from the astronaut to a hatch for boarding. Standing on the ground, up to BOARD_CLIMB metres of the
 * hatch's height above the astronaut is climbed rather than counted, so tall landers stay boardable on foot.
 * Airborne (a hop, a jetpack flight) the on-foot measures add the feet's height above the ground in quadrature
 * and the straight-line distance still counts: the result is continuous, so a hop beside a tall rocket reads
 * 4.0 → 4.1 → 4.0 m, not 4 → 15 → 4 m.
 */
function hatchReach(world: World, eva: WorldVessel, vessel: WorldVessel, pod: PartState, up: Vec3, lift: number): number {
  const hatch = world.hatchPosition(vessel.state, pod);
  const d = sub(hatch, eva.state.position);
  const direct = length(d);
  // The on-foot measures only ever shorten the distance; far up they cannot.
  if (lift >= direct) return direct;
  const climb = Math.max(0, Math.min(BOARD_CLIMB, dot(d, up)));
  let foot = length(sub(d, scale(up, climb)));
  // Grounded vessel: the spot below the hatch, clear of the hull, at any hatch height (see hatchColumn).
  if (grounded(vessel) && Math.hypot(foot, lift) > BOARD_RANGE && direct <= vessel.state.cache.boundingRadius + 50) {
    for (const column of [hatchColumn(world, vessel.state, pod, up), exitColumn(world, vessel, pod, up)]) {
      const c = sub(column, eva.state.position);
      if (dot(c, up) >= -BOARD_RANGE) foot = Math.min(foot, length(sub(c, scale(up, dot(c, up)))));
    }
  }
  return Math.min(direct, Math.hypot(foot, lift));
}

/** Local up at the astronaut and its feet's height above the ground, shared by every hatch it is measured to. */
function reachFrame(world: World, eva: WorldVessel): { up: Vec3; lift: number } {
  return { up: normalize(sub(eva.state.position, world.universe.ephem.getBodyState(eva.body, world.ut).position)), lift: footLift(world, eva) };
}


export function boardingTarget(this: World, _internals: WorldInternals): { vessel: WorldVessel; pod: PartState } | null {
  const eva = this.active;
  if (!eva?.state.eva) return null;
  const { up, lift } = reachFrame(this, eva);
  for (const vessel of this.vessels.values()) {
    if (vessel === eva || vessel.body !== eva.body || vessel.state.destroyed) continue;
    for (const pod of vessel.state.parts) {
      if (seatCapacity(pod) <= (pod.crew?.length ?? 0)) continue;
      if (hatchReach(this, eva, vessel, pod, up, lift) <= BOARD_RANGE && length(sub(eva.state.velocity, vessel.state.velocity)) < BOARD_SPEED) return { vessel, pod };
    }
  }
  return null;
}


/** The active astronaut's nearest hatch: a free seat outranks a full one, however far. Null off EVA or with no crewed vessel. */
export interface NearestHatch { vessel: WorldVessel; pod: PartState; free: boolean; distance: number; speed: number }
export function nearestHatch(this: World, _internals: WorldInternals): NearestHatch | null {
  const eva = this.active;
  if (!eva?.state.eva) return null;
  let best: NearestHatch | null = null;
  const { up, lift } = reachFrame(this, eva);
  for (const vessel of this.vessels.values()) {
    if (vessel === eva || vessel.body !== eva.body || vessel.state.destroyed) continue;
    for (const pod of vessel.state.parts) {
      if (!seatCapacity(pod)) continue;
      const free = seatCapacity(pod) > (pod.crew?.length ?? 0);
      const distance = hatchReach(this, eva, vessel, pod, up, lift);
      if (!best || (free && !best.free) || (free === best.free && distance < best.distance)) best = { vessel, pod, free, distance, speed: length(sub(eva.state.velocity, vessel.state.velocity)) };
    }
  }
  return best;
}

/** Why the active astronaut cannot board right now (nearest hatch, with the distance or speed to fix), or null when they can. */
export function boardingBlocker(this: World, internals: WorldInternals, whole = false): string | null {
  if (!this.active?.state.eva) return null;
  const best = nearestHatch.call(this, internals);
  if (!best) return 'No crewed vessel nearby to board';
  const name = best.vessel.state.name;
  if (!best.free) return `${name} has no free seat`;
  if (best.distance > BOARD_RANGE) return `Move closer to the hatch of ${name} — ${whole || best.distance >= 100 ? Math.round(best.distance) : best.distance.toFixed(1)} m away, board within ${BOARD_RANGE} m`;
  if (best.speed >= BOARD_SPEED) return `Slow down to board ${name} — ${whole ? Math.round(best.speed) : best.speed.toFixed(1)} m/s relative, below ${BOARD_SPEED} m/s`;
  return null;
}


export function boardEva(this: World, internals: WorldInternals): boolean {
  const eva = this.active;
  const target = this.boardingTarget();
  if (!eva?.state.eva || !target) { if (eva?.state.eva) this.message(this.boardingBlocker() ?? `Move within ${BOARD_RANGE} m of a free pod hatch, below ${BOARD_SPEED} m/s`, 'warn'); return false; }
  const { vessel, pod } = target;
  if (vessel.mode === 'rails' || vessel.mode === 'landedRails') internals.unpack(vessel);
  const v = vessel.state, oldMass = v.mass;
  const velocity = scale(add(scale(v.velocity, oldMass), scale(eva.state.velocity, eva.state.mass)), 1 / (oldMass + eva.state.mass));
  (pod.crew ??= []).push(eva.state.eva.astronautId);
  recomputeMassProperties(v);
  v.velocity = velocity;
  // Suit is serviced/refilled aboard; its full mass is again included in the pod's dry mass.
  if (vessel.mode === 'prelaunch') internals.captureFixed(vessel, this.ut);
  (pod.scienceData ??= []).push(...eva.state.parts.flatMap(p => p.scienceData ?? []));
  pod.visitedBodies = [...new Set([...(pod.visitedBodies ?? []), ...eva.state.parts.flatMap(p => p.visitedBodies ?? [])])];
  this.vessels.delete(eva.state.id);
  if (this.targetId === eva.state.id) this.setTarget(null);
  this.switchTo(v.id);
  this.warp = { mode: 'rails', index: 0 };
  internals.stageRequested = false;
  this.message(`Boarded ${v.name} · suit refilled`);
  return true;
}


export function plantFlag(this: World, _internals: WorldInternals): PlantedFlag | null {
  const eva = this.active;
  if (!eva?.state.eva || eva.state.situation !== 'landed') { this.message('Land your astronaut to plant a flag', 'warn'); return null; }
  const g = this.universe.createEnvironment(() => eva.body).ground(add(eva.state.position, qRotate(eva.state.orientation, v3(0.75, 0, 0))), this.ut);
  if (!g || g.isWater) return null;
  const qi = qConj(bodyQuat(this.universe, eva.body, this.ut));
  const firstMoon = eva.body === 'moon' && !this.flags.some(f => f.body === 'moon');
  const flag: PlantedFlag = { id: `flag-${this.flags.length}`, body: eva.body, position: qRotate(qi, sub(g.surfacePoint, this.universe.ephem.getBodyState(eva.body, this.ut).position)), orientation: qMul(qi, qMul(qFromTo(qRotate(eva.state.orientation, v3(0, 1, 0)), g.normal), eva.state.orientation)), astronautId: eva.state.eva.astronautId, plantedAt: this.ut };
  this.flags.push(flag);
  this.message(firstMoon ? 'First footsteps, a shared horizon. Humanity has planted its first flag on the Moon.' : `Flag planted on ${this.universe.body(eva.body).name}`, 'info', firstMoon ? 14 : 5);
  return flag;
}

import { EVA_PART } from '../../data/eva';
import { RESOURCES } from '../../data/resources';
import { remoteControlAllowed } from '../../sim/comms/network';
import { crewIds, generateAstronaut, hasControl, seatCapacity, type Astronaut, type PlantedFlag } from '../../sim/crew/crew';
import { buildVessel, recomputeMassProperties } from '../../sim/vessel';
import type { PartState, VesselState } from '../../sim/vessel/runtime';
import { qConj, qFromTo, qIdentity, qMul, qRotate } from '../../util/quat';
import { add, length, scale, sub, v3, type Vec3 } from '../../util/vec3';
import { Universe } from '../universe';
import type { World, WorldVessel } from '../world';
import type { WorldInternals } from './internals';
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


export function goEva(this: World, internals: WorldInternals, astronautId?: string): WorldVessel | null {
  const host = this.active;
  if (!host || host.state.eva || host.state.destroyed) return null;
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
  const wv: WorldVessel = { state: eva, body: host.body, mode: 'physics' };
  this.vessels.set(eva.id, wv);
  this.switchTo(eva.id);
  internals.stageRequested = false;
  this.message(`${person.name} is on EVA`);
  return wv;
}


export function boardingTarget(this: World, _internals: WorldInternals): { vessel: WorldVessel; pod: PartState } | null {
  const eva = this.active;
  if (!eva?.state.eva) return null;
  for (const vessel of this.vessels.values()) {
    if (vessel === eva || vessel.body !== eva.body || vessel.state.destroyed) continue;
    for (const pod of vessel.state.parts) {
      if (seatCapacity(pod) <= (pod.crew?.length ?? 0)) continue;
      if (length(sub(eva.state.position, this.hatchPosition(vessel.state, pod))) <= 3 && length(sub(eva.state.velocity, vessel.state.velocity)) < 3) return { vessel, pod };
    }
  }
  return null;
}


export function boardEva(this: World, internals: WorldInternals): boolean {
  const eva = this.active;
  const target = this.boardingTarget();
  if (!eva?.state.eva || !target) { this.message('Move within 3 m of a free pod hatch, below 3 m/s', 'warn'); return false; }
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

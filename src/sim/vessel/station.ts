import type { Quat } from '../../util/quat';
import { qConj, qFromAxisAngle, qMul, qNormalize, qRotate } from '../../util/quat';
import { cross, dot, length, normalize, v3, type Vec3 } from '../../util/vec3';
import { seatCapacity } from '../crew/crew';
import { rebuildTopology, recomputeMassProperties } from './assembly';
import { dockedPartner, dockingModule } from './docking';
import type { PartState, VesselState } from './runtime';
import type { ResourceId } from './types';

/**
 * Docked complexes ("stations") and the two crew/control commands that make them navigable.
 *
 * A docked complex is one rigid VesselState; its "modules" are the pieces between docking joints, i.e. the vessels
 * that undocking would restore. Everything here is derived on demand (UI) or applied once per command (authority),
 * never per physics step.
 *
 * CONTROL FROM HERE: the vessel's body frame defines the control axes (nose = +Y, top = +Z), used by pilot input,
 * SAS, translation, the navball and camera. Controlling from another part re-expresses the whole vessel in that
 * part's control frame: every part pose is rotated by C⁻¹ and the orientation by C, so the rigid body (inertial
 * pose of every part, momentum) is unchanged and every consumer of the body frame follows automatically.
 */

const Y = v3(0, 1, 0);

/** Rotation taking unit `a` to unit `b` (180° turns pick an axis perpendicular to `a`, preferring +X). */
function rotationBetween(a: Vec3, b: Vec3): Quat {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  if (c > 1 - 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  let axis = cross(a, b);
  if (length(axis) < 1e-9) {
    axis = cross(a, v3(1, 0, 0));
    if (length(axis) < 1e-9) axis = cross(a, v3(0, 0, 1));
  }
  return qFromAxisAngle(normalize(axis), Math.acos(c));
}

/** Command parts (pods, probe cores, cabins excluded) and docking ports can be controlled from. */
export function canControlFrom(p: PartState): boolean {
  if (dockingModule(p)) return true;
  return p.def.modules.some(m => m.type === 'command' && m.controllable !== false);
}

/** Control frame → body frame for part `p` (a port looks out of its docking face), or null if not controllable. */
export function controlRotation(p: PartState): Quat | null {
  const mod = dockingModule(p);
  if (mod) {
    const node = p.def.attachNodes.find(n => n.id === mod.node);
    if (!node) return null;
    return qNormalize(qMul(p.rotation, rotationBetween(Y, normalize(node.direction))));
  }
  return canControlFrom(p) ? p.rotation : null;
}

/** Part the vessel is controlled from, if one was chosen and is still aboard. */
export function controlPartUid(v: VesselState): number | null {
  return v.controlUid !== undefined && v.cache.byUid.has(v.controlUid) ? v.controlUid : null;
}

/**
 * Control the vessel from part `uid`: rebase the body frame onto the part's control frame. Pure re-expression of
 * the same rigid body (no impulse, no attitude change). Returns false when the part cannot be controlled from.
 */
export function controlFrom(v: VesselState, uid: number): boolean {
  const p = v.cache.byUid.get(uid);
  const C = p ? controlRotation(p) : null;
  if (!p || !C || v.eva) return false;
  const Ci = qConj(C);
  for (const q of v.parts) {
    q.position = qRotate(Ci, q.position);
    q.rotation = qNormalize(qMul(Ci, q.rotation));
  }
  v.com = qRotate(Ci, v.com);
  v.orientation = qNormalize(qMul(v.orientation, C));
  v.angularVelocity = qRotate(Ci, v.angularVelocity);
  v.sas = { ...v.sas, hold: v.sas.hold ? qNormalize(qMul(v.sas.hold, C)) : null, integral: qRotate(Ci, v.sas.integral) };
  v.controlUid = uid;
  // Body-frame caches (aero centres, bounding data) and the inertia tensor follow the new frame.
  rebuildTopology(v);
  recomputeMassProperties(v, true);
  return true;
}

/** Free seats in a crewed part. */
export const freeSeats = (p: PartState): number => Math.max(0, seatCapacity(p) - (p.crew?.length ?? 0));

/** Move an astronaut to a free seat in part `toUid` of the same vessel. Returns false when not possible. */
export function transferCrew(v: VesselState, astronautId: string, toUid: number): boolean {
  if (v.eva) return false;
  const from = v.parts.find(p => p.crew?.includes(astronautId));
  const to = v.cache.byUid.get(toUid);
  if (!from || !to || from === to || freeSeats(to) <= 0) return false;
  from.crew = from.crew!.filter(id => id !== astronautId);
  (to.crew ??= []).push(astronautId);
  recomputeMassProperties(v, true);
  return true;
}

export interface StationPort {
  uid: number;
  name: string;
  size: number;
  /** Uid of the part docked to it (another module), null when free. */
  partner: number | null;
}

export interface StationModule {
  /** Uid of the module's first part (the vessel root, or the child-side port of its docking joint). */
  key: number;
  name: string;
  partUids: number[];
  mass: number;
  /** Seated parts (capacity > 0). */
  cabins: { uid: number; name: string; seats: number; crew: string[] }[];
  ports: StationPort[];
  /** Parts the vessel can be controlled from. */
  controls: { uid: number; name: string; kind: 'command' | 'port' }[];
  resources: { id: ResourceId; amount: number; max: number }[];
}

/**
 * Split a vessel into its docked modules (cut at every docking joint). The root's module comes first and carries
 * the vessel's name; others use the identity remembered at docking (what undocking would restore).
 */
export function stationModules(v: VesselState): StationModule[] {
  const joints = new Set<number>(); // child-side uid of each docking joint
  for (const p of v.parts) {
    if (p.parent === null) continue;
    const mod = dockingModule(p);
    const parent = v.cache.byUid.get(p.parent);
    const parentMod = parent && dockingModule(parent);
    if ((mod && p.attachNode === mod.node && parent && parentMod && p.parentNode === parentMod.node)) joints.add(p.uid);
  }
  const out: StationModule[] = [];
  const later: [number, string][] = [[v.rootUid, v.name]];
  const visit = (start: number, name: string) => {
    const mod: StationModule = { key: start, name, partUids: [], mass: 0, cabins: [], ports: [], controls: [], resources: [] };
    const res = new Map<ResourceId, { amount: number; max: number }>();
    const stack = [start];
    while (stack.length) {
      const p = v.cache.byUid.get(stack.pop()!);
      if (!p) continue;
      mod.partUids.push(p.uid);
      mod.mass += p.mass;
      const seats = seatCapacity(p);
      if (seats > 0) mod.cabins.push({ uid: p.uid, name: p.def.name, seats, crew: [...(p.crew ?? [])] });
      const dm = dockingModule(p);
      if (dm) mod.ports.push({ uid: p.uid, name: p.def.name, size: dm.size, partner: dockedPartner(v, p)?.uid ?? null });
      if (canControlFrom(p)) mod.controls.push({ uid: p.uid, name: p.def.name, kind: dm ? 'port' : 'command' });
      for (const k in p.maxResources) {
        const id = k as ResourceId;
        const max = p.maxResources[id] ?? 0;
        if (max <= 0 || id === 'intakeAir') continue;
        const r = res.get(id) ?? { amount: 0, max: 0 };
        r.amount += p.resources[id] ?? 0; r.max += max;
        res.set(id, r);
      }
      for (const c of p.children) {
        if (joints.has(c)) {
          const child = v.cache.byUid.get(c)!;
          later.push([c, child.docked?.vesselName ?? `${v.name} module`]);
        } else stack.push(c);
      }
    }
    mod.partUids.sort((a, b) => a - b);
    mod.resources = [...res].map(([id, r]) => ({ id, ...r }));
    out.push(mod);
  };
  while (later.length) {
    const [uid, name] = later.shift()!;
    visit(uid, name);
  }
  // Root first, then in uid order (docking order for in-flight merges), so the list is stable.
  const [root, ...rest] = out;
  out.splice(0, out.length, root, ...rest.sort((a, b) => a.key - b.key));
  for (const m of out) m.ports.sort((a, b) => a.uid - b.uid);
  // Disambiguate repeated names ("Module", "Module 2") so lists stay readable.
  const seen = new Map<string, number>();
  for (const m of out) {
    const n = (seen.get(m.name) ?? 0) + 1;
    seen.set(m.name, n);
    if (n > 1) m.name = `${m.name} ${n}`;
  }
  return out;
}

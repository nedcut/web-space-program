import { add, cross, dot, length, normalize, scale, sub, v3 } from '../../util/vec3';
import type { Vec3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { applyImpulse, splitVessel } from './assembly';
import type { PartLoad, JointLoad } from './loads';
import { m3FromQuat, m3MulVec, m3RotateTensor } from './mat3';
import type { PartState, StepResult, VesselState, VesselCache } from './runtime';
import { localInertia } from './shapes';
import type { ContactPass } from './contact';

/** N / N m, by diameter class (0.625, 1.25, 2.5, 3.75, 5 m). */
const STACK_FORCE = [250_000, 1_500_000, 12_000_000, 40_000_000, 100_000_000];
const STACK_TORQUE = [120_000, 800_000, 10_000_000, 30_000_000, 100_000_000];

export function jointPoint(p: PartState): Vec3 {
  const node = p.def.attachNodes.find(n => n.id === p.attachNode);
  return node ? add(p.position, qRotate(p.rotation, node.position)) : p.position;
}

/** Surface brackets are weaker; lifting surfaces use their distributed root attachment area.
 * Radial stage latches represent a braced, multi-point booster mount, including five-metre boosters.
 * Docking latches carry 65% and pyrotechnic stack rings 90% of the equivalent continuous stack rating.
 */
export function jointStrength(v: VesselState, p: PartState): { force: number; torque: number } {
  const parent = p.parent === null ? undefined : v.cache.byUid.get(p.parent);
  const a = p.def.attachNodes.find(n => n.id === p.attachNode);
  const b = parent?.def.attachNodes.find(n => n.id === p.parentNode);
  const radial = !p.attachNode || p.attachNode === 'srf' || p.parentNode === 'srf';
  const size = Math.max(0, Math.min(4, Math.min(a?.size ?? b?.size ?? 0, b?.size ?? a?.size ?? 0)));
  const ends = [p.def, ...(parent ? [parent.def] : [])];
  let force = STACK_FORCE[size], torque = STACK_TORQUE[size];
  if (radial) {
    const wing = p.def.modules.find(m => m.type === 'liftingSurface');
    const mountSize = Math.max(0, ...p.def.attachNodes.filter(n => n.id !== 'srf').map(n => n.size));
    // Tanks mounted radially use broad saddles sized to their barrel, not the small surface-node marker.
    force = Math.max(120_000, STACK_FORCE[mountSize] * 0.3, (wing?.area ?? 0) * 60_000);
    torque = Math.max(25_000, STACK_TORQUE[mountSize] * 0.3, (wing?.area ?? 0) * 30_000);
    // Gear/leg pivots are braced suspension mounts, rated for landing impulses.
    if (p.leg || p.wheel) { force = Math.max(force, 500_000); torque = Math.max(torque, 250_000); }
    if (ends.some(d => d.modules.some(m => m.type === 'decoupler' && m.radial))) {
      force = 100_000_000; torque = 120_000_000;
    }
  } else {
    const factor = ends.some(d => d.modules.some(m => m.type === 'dockingPort')) ? 0.65
      : ends.some(d => d.modules.some(m => m.type === 'decoupler')) ? 0.9 : 1;
    force *= factor; torque *= factor;
  }
  // Explicit endpoint ratings replace defaults, but cannot override the other endpoint's rating.
  const forces = ends.flatMap(d => d.breakingForce === undefined ? [] : [d.breakingForce]);
  const torques = ends.flatMap(d => d.breakingTorque === undefined ? [] : [d.breakingTorque]);
  return { force: forces.length ? Math.min(...forces) : force, torque: torques.length ? Math.min(...torques) : torque };
}

interface PreparedPart {
  part: PartState;
  point: Vec3;
  strength: { force: number; torque: number };
  inertiaPerKg: number[];
  force: Vec3;
  moment: Vec3;
}
// Geometry/ratings are immutable until topology rebuild (including docking rotations).
const prepared = new WeakMap<VesselCache, { ordered: PreparedPart[]; byUid: Map<number, PreparedPart> }>();
function prepare(v: VesselState) {
  let entry = prepared.get(v.cache);
  if (!entry) {
    const ordered = [...v.parts].sort((a, b) => (v.cache.depth.get(b.uid) ?? 0) - (v.cache.depth.get(a.uid) ?? 0) || a.uid - b.uid)
      .map(part => ({ part, point: jointPoint(part), strength: jointStrength(v, part),
        inertiaPerKg: m3RotateTensor(m3FromQuat(part.rotation), localInertia(part.def, 1)), force: v3(), moment: v3() }));
    entry = { ordered, byUid: new Map(ordered.map(p => [p.part.uid, p])) };
    prepared.set(v.cache, entry);
  }
  return entry;
}

/** Newton–Euler residual on every subtree; uniform gravity cancels from both sides.
 * Includes local part inertia, gyroscopic and centripetal terms, and moments at actual application points.
 * This is observational: it does not alter the rigid-body solution below the failure limits.
 */
export function evaluateJointLoads(v: VesselState, loads: PartLoad[], omega = v.angularVelocity): Map<number, JointLoad> {
  let force = v3(), torque = v3();
  for (const l of loads) {
    force = add(force, l.force);
    torque = add(torque, add(cross(sub(l.point, v.com), l.force), l.torque ?? v3()));
  }
  const acceleration = scale(force, 1 / v.mass);
  const alpha = m3MulVec(v.invInertia, sub(torque, cross(omega, m3MulVec(v.inertia, omega))));
  const { ordered, byUid } = prepare(v);
  const w2 = dot(omega, omega);
  for (const { part: p, inertiaPerKg: I, force: f, moment: m } of ordered) {
    const x = p.position.x - v.com.x, y = p.position.y - v.com.y, z = p.position.z - v.com.z;
    const wr = omega.x * x + omega.y * y + omega.z * z;
    f.x = p.mass * (acceleration.x + alpha.y * z - alpha.z * y + omega.x * wr - x * w2);
    f.y = p.mass * (acceleration.y + alpha.z * x - alpha.x * z + omega.y * wr - y * w2);
    f.z = p.mass * (acceleration.z + alpha.x * y - alpha.y * x + omega.z * wr - z * w2);
    const ix = I[0]*omega.x + I[1]*omega.y + I[2]*omega.z;
    const iy = I[3]*omega.x + I[4]*omega.y + I[5]*omega.z;
    const iz = I[6]*omega.x + I[7]*omega.y + I[8]*omega.z;
    m.x = y*f.z - z*f.y + p.mass * (I[0]*alpha.x + I[1]*alpha.y + I[2]*alpha.z + omega.y*iz - omega.z*iy);
    m.y = z*f.x - x*f.z + p.mass * (I[3]*alpha.x + I[4]*alpha.y + I[5]*alpha.z + omega.z*ix - omega.x*iz);
    m.z = x*f.y - y*f.x + p.mass * (I[6]*alpha.x + I[7]*alpha.y + I[8]*alpha.z + omega.x*iy - omega.y*ix);
  }
  for (const l of loads) {
    const r = byUid.get(l.partUid)!;
    r.force.x -= l.force.x; r.force.y -= l.force.y; r.force.z -= l.force.z;
    const x = l.point.x - v.com.x, y = l.point.y - v.com.y, z = l.point.z - v.com.z;
    r.moment.x -= y*l.force.z - z*l.force.y + (l.torque?.x ?? 0);
    r.moment.y -= z*l.force.x - x*l.force.z + (l.torque?.y ?? 0);
    r.moment.z -= x*l.force.y - y*l.force.x + (l.torque?.z ?? 0);
  }
  const out = new Map<number, JointLoad>();
  for (const { part: p, point, strength, force: f, moment: m } of ordered) {
    if (p.parent === null) continue;
    const x = point.x - v.com.x, y = point.y - v.com.y, z = point.z - v.com.z;
    const moment = { x: m.x - (y*f.z - z*f.y), y: m.y - (z*f.x - x*f.z), z: m.z - (x*f.y - y*f.x) };
    out.set(p.uid, { force: { ...f }, torque: moment, fraction: Math.max(length(f) / strength.force, length(moment) / strength.torque) });
    const parent = byUid.get(p.parent)!;
    parent.force.x += f.x; parent.force.y += f.y; parent.force.z += f.z;
    parent.moment.x += m.x; parent.moment.y += m.y; parent.moment.z += m.z;
  }
  v.cache.jointLoads = out;
  return out;
}

/** 80 ms continuous exposure at >=2x rating; recovery only below 85%, so brief numerical spikes do not flicker. */
export function overloadedJoints(v: VesselState, loads: PartLoad[], dt: number, omega = v.angularVelocity): number[] {
  const cuts: number[] = [];
  for (const [uid, load] of evaluateJointLoads(v, loads, omega)) {
    const p = v.cache.byUid.get(uid)!;
    let fatigue = p.structuralFatigue ?? 0;
    if (load.fraction > 1) fatigue += dt * Math.min(1, load.fraction - 1);
    else if (load.fraction < 0.85) fatigue = Math.max(0, fatigue - dt * 2);
    if (fatigue > 0) p.structuralFatigue = fatigue;
    else delete p.structuralFatigue;
    if (fatigue >= 0.08) cuts.push(uid);
  }
  return cuts;
}

export interface CrashShock { partUid: number; energy: number; }

/** Capture incoming energy before the yielding contact solver changes the velocity. */
export function crashShocks(v: VesselState, cp: ContactPass): CrashShock[] {
  return cp.impacts.map(uid => {
    const p = v.cache.byUid.get(uid)!;
    const speed = cp.impactSpeeds.get(uid) ?? 0;
    return { partUid: uid, energy: 0.5 * p.mass * speed * speed };
  });
}

/** Crush work propagates two attachments beyond the impacted part, attenuating at each joint. */
export function crashJointCuts(v: VesselState, shocks: CrashShock[]): Map<number, number> {
  const cuts = new Map<number, number>();
  for (const shock of shocks) {
    const queue = [{ uid: shock.partUid, energy: shock.energy, depth: 0 }];
    const visited = new Set<number>([shock.partUid]);
    for (let i = 0; i < queue.length; i++) {
      const { uid, energy, depth } = queue[i];
      const p = v.cache.byUid.get(uid)!;
      if (depth >= 3) continue;
      for (const next of [...p.children, ...(p.parent === null ? [] : [p.parent])]) {
        if (visited.has(next)) continue;
        visited.add(next);
        const child = p.parent === next ? p : v.cache.byUid.get(next)!;
        const strength = jointStrength(v, child);
        const work = strength.force * 0.015 + strength.torque * 0.01;
        if (energy > work) cuts.set(child.uid, Math.max(cuts.get(child.uid) ?? 0, energy / work));
        queue.push({ uid: next, energy: energy * 0.2, depth: depth + 1 });
      }
    }
  }
  return cuts;
}

/** Deepest-first cuts handle simultaneous nested failures exactly once and conserve momentum. */
export function breakJoints(v: VesselState, cuts: number[], result: StepResult, crash = new Map<number, number>()): void {
  const ordered = [...new Set(cuts)].sort((a, b) => (v.cache.depth.get(b) ?? 0) - (v.cache.depth.get(a) ?? 0) || a - b);
  const readings = v.cache.jointLoads;
  for (const uid of ordered) {
    const p = v.cache.byUid.get(uid);
    if (!p || p.parent === null) continue;
    const parentUid = p.parent;
    const point = jointPoint(p);
    const strength = jointStrength(v, p);
    const fraction = Math.max(readings?.get(uid)?.fraction ?? 0, crash.get(uid) ?? 0);
    const pieces = splitVessel(v, [uid]);
    delete p.structuralFatigue;
    for (const nv of pieces) {
      // A small part of crush energy releases as opposing fragment motion; never add net momentum.
      if (crash.has(uid)) {
        const d = sub(nv.com, v.com);
        const dir = length(d) > 1e-9 ? normalize(d) : { x: 1, y: 0, z: 0 };
        const reducedMass = nv.mass * v.mass / (nv.mass + v.mass);
        const rn = cross(sub(point, nv.com), dir), rv = cross(sub(point, v.com), dir);
        const inverseEffectiveMass = 1 / reducedMass + dot(rn, m3MulVec(nv.invInertia, rn)) + dot(rv, m3MulVec(v.invInertia, rv));
        const releaseEnergy = 0.01 * crash.get(uid)! * (strength.force * 0.015 + strength.torque * 0.01) / Math.max(1, crash.size);
        const impulse = Math.min(reducedMass * 3, Math.sqrt(2 * releaseEnergy / inverseEffectiveMass));
        const J = scale(qRotate(v.orientation, dir), impulse);
        applyImpulse(nv, J, point);
        applyImpulse(v, scale(J, -1), point);
      }
      result.newVessels.push(nv);
      result.events.push({ type: 'structuralFailure', vesselId: v.id, partUid: uid, parentUid, newVesselId: nv.id, loadFraction: fraction });
    }
  }
}

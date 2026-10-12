import { distributeStrutLoads } from './struts';
import { activeLinks, linkModule } from './links';
import { rebuildTopology } from './assembly';
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
/** Additional crossflow fatigue envelope for rigid rocket barrels. Pa and sin²(AoA). */
export const AERO_FAILURE_Q = 60_000;
export const AERO_FAILURE_SIN2 = Math.sin(25 * Math.PI / 180) ** 2;
/** Warn-only band: from 70% of both limits the hull creaks, but nothing accumulates damage. */
export const AERO_WARN_FRACTION = 0.7;
/** Crossflow breakup follows the first warning by this many seconds (mildest / most extreme exposure). */
export const AERO_BREAKUP_SLOWEST = 2.4;
export const AERO_BREAKUP_FASTEST = 0.8;
/** Stress at which breakup reaches its fastest; ~Mach 2 sideways at 3 km is far beyond it. */
const AERO_STRESS_CAP = AERO_BREAKUP_SLOWEST / AERO_BREAKUP_FASTEST;
/** Re-sounding interval of the warning while the hull stays in the envelope. */
export const AERO_WARN_INTERVAL = 0.5;
/** After leaving the envelope, crossflow fatigue is metal fatigue, not a numerical spike: it relaxes this slowly. */
export const AERO_RECOVERY_TIME = 3;
const AERO_RECOVERY_RATE = 0.08 / 2;
/**
 * Normalized crossflow exposure q/q₀ · sin²α/sin²α₀, symmetric nose-first / shield-first; no angle/vector
 * allocation. ≥ 1 only past both limits (breakup envelope); 0.49–0.99 in the warn-only band; else 0.
 */
export function aerodynamicStress(q: number, velocity: Vec3): number {
  if (q <= AERO_WARN_FRACTION * AERO_FAILURE_Q) return 0;
  const speed2 = dot(velocity, velocity);
  const lateral2 = velocity.x * velocity.x + velocity.z * velocity.z;
  const sin2 = speed2 > 0 ? lateral2 / speed2 : 0;
  if (sin2 <= AERO_WARN_FRACTION * AERO_FAILURE_SIN2) return 0;
  const stress = q / AERO_FAILURE_Q * sin2 / AERO_FAILURE_SIN2;
  return q > AERO_FAILURE_Q && sin2 > AERO_FAILURE_SIN2 ? stress : Math.min(0.99, stress);
}
/** Fatigue per second under crossflow: 0.08 (the failure threshold) over a 2.4 s … 0.8 s breakup time. */
export function aeroFatigueRate(stress: number): number {
  return 0.08 * Math.min(AERO_STRESS_CAP, stress) / AERO_BREAKUP_SLOWEST;
}

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
  distributeStrutLoads(v, out, uid => byUid.get(uid)!.point, uid => byUid.get(uid)!.strength);
  v.cache.jointLoads = out;
  return out;
}

/**
 * 80 ms at >=2x rating; recovery below 85% rejects brief numerical spikes. Inside the crossflow envelope
 * every joint accumulates at the readable crossflow rate (never faster than 0.8 s), after a warning that
 * re-sounds every 0.5 s.
 */
export function overloadedJoints(v: VesselState, loads: PartLoad[], dt: number, omega = v.angularVelocity, result?: StepResult, aeroStress = 0): number[] {
  const cuts: number[] = [];
  let readings = evaluateJointLoads(v, loads, omega);
  if (aeroStress > 0) {
    v.cache.aeroHold = AERO_RECOVERY_TIME;
    v.cache.aeroWarnClock = (v.cache.aeroWarnClock ?? AERO_WARN_INTERVAL) + dt;
    if (v.cache.aeroWarnClock >= AERO_WARN_INTERVAL) {
      v.cache.aeroWarnClock = 0;
      result?.events.push({ type: 'structuralWarning', vesselId: v.id, loadFraction: aeroStress });
    }
  } else if (v.cache.aeroHold !== undefined) {
    // Briefly leaving and re-entering the envelope neither re-warns nor resets the fatigue.
    v.cache.aeroWarnClock = (v.cache.aeroWarnClock ?? 0) + dt;
    v.cache.aeroHold -= dt;
  }
  const recovering = v.cache.aeroHold !== undefined && v.cache.aeroHold > 0;
  if (!recovering) { delete v.cache.aeroHold; delete v.cache.aeroWarnClock; }
  const crossflow = aeroStress >= 1;
  const crossflowRate = crossflow ? aeroFatigueRate(aeroStress) : 0;
  let broken = false;
  for (const p of activeLinks(v, 'strut')) {
    const spec = linkModule(p)!;
    if (spec.type !== 'strut') continue;
    const fraction = (v.cache.strutLoads?.get(p.uid) ?? 0) / spec.strength;
    const fatigue = fraction > 1 ? (p.linkFatigue ?? 0) + dt * Math.min(1, fraction - 1)
      : fraction < 0.85 ? Math.max(0, (p.linkFatigue ?? 0) - dt * 2) : p.linkFatigue ?? 0;
    if (fatigue > 0) p.linkFatigue = fatigue; else delete p.linkFatigue;
    if (fatigue >= 0.08) {
      p.link!.broken = true; delete p.linkFatigue; broken = true;
      result?.events.push({ type: 'linkBroken', vesselId: v.id, partUid: p.uid, targetUid: p.link!.targetUid, loadFraction: fraction });
    }
  }
  if (broken) {
    rebuildTopology(v);
    readings = evaluateJointLoads(v, loads, omega);
  }
  for (const [uid, load] of readings) {
    const p = v.cache.byUid.get(uid)!;
    // A barrel's distributed bending/buffeting is unresolved by a single rigid body. Accumulate it in
    // the existing saved/replicated joint fatigue at a readable rate: breakup follows the first warning by
    // 0.8–2.4 s, however violent the exposure, so the pilot hears the creaks and has a moment to recover.
    // Preserve ordinary Newton–Euler overloads and explicit ratings outside the envelope; wing roots and
    // fairing-enclosed payloads retain their measured loads. Aligned launches and shield-first entries
    // never enter this envelope.
    const shape = p.def.shape;
    if (crossflow && shape.kind === 'cylinder' && shape.height > 2 * Math.max(shape.radiusTop, shape.radiusBottom)
      && !v.cache.shielded?.has(uid)) {
      load.fraction = Math.max(load.fraction, 1 + crossflowRate);
    }
    let fatigue = p.structuralFatigue ?? 0;
    if (load.fraction > 1) fatigue += dt * Math.min(crossflow ? crossflowRate : 1, load.fraction - 1);
    else if (load.fraction < 0.85) fatigue = Math.max(0, fatigue - dt * (recovering ? AERO_RECOVERY_RATE : 2));
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
export function breakJoints(v: VesselState, cuts: number[], result: StepResult, crash = new Map<number, number>(), torn?: ReadonlyMap<number, 'airload' | 'heat'>): void {
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
      const cause = torn?.get(uid);
      result.events.push(cause
        ? { type: 'structuralFailure', vesselId: v.id, partUid: uid, parentUid, newVesselId: nv.id, loadFraction: Math.max(1, fraction), cause }
        : { type: 'structuralFailure', vesselId: v.id, partUid: uid, parentUid, newVesselId: nv.id, loadFraction: fraction });
    }
  }
}

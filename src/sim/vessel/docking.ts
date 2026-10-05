import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, normalize, scale, sub, v3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { qConj, qFromAxisAngle, qMul, qNormalize, qRotate } from '../../util/quat';
import type { DockingPortModule } from './types';
import type { PartState, VesselState } from './runtime';
import { applyImpulse, rebuildTopology, recomputeMassProperties, splitVessel } from './assembly';
import { m3MulVec } from './mat3';

/**
 * Docking: port geometry, the magnetic soft-capture field, vessel merging and undocking.
 *
 * Ports are ordinary parts with a DockingPortModule whose `node` is the docking face. A port is "free" when
 * nothing is attached through that node. When two free, armed ports of equal size are inside capture range,
 * facing each other and slow enough, `stepDocking` applies equal and opposite impulses/torques that pull the
 * faces together and align them; on contact (< 5 cm, aligned) the two vessels merge into one rigid body. The
 * merge conserves linear momentum exactly and angular momentum up to the (sub-5 cm) snap of the faces.
 */

/** Face separation at which ports latch, m. */
export const DOCK_CONTACT_DISTANCE = 0.05;
/** Relative speed given to the two halves on undocking, m/s. */
export const UNDOCK_SEPARATION_SPEED = 0.12;
/** Soft-capture field: relative acceleration = -K d - C v (clamped), angular likewise. */
const MAG_K = 0.8;
const MAG_C = 1.6;
const MAG_AMAX = 0.25;
const ALIGN_K = 1.2;
const ALIGN_C = 2.2;
const ALIGN_AMAX = 0.6;

export interface PortInfo {
  vessel: VesselState;
  part: PartState;
  mod: DockingPortModule;
  /** Docking face centre in the vessel body frame. */
  posBody: Vec3;
  /** Outward face normal in the vessel body frame. */
  dirBody: Vec3;
  /** Inertial face centre and outward normal. */
  pos: Vec3;
  dir: Vec3;
  /** Inertial velocity of the face centre. */
  vel: Vec3;
}

export function dockingModule(p: PartState): DockingPortModule | undefined {
  return p.def.modules.find((m): m is DockingPortModule => m.type === 'dockingPort');
}

/** Inertial angular velocity of a vessel. */
const omegaWorld = (v: VesselState): Vec3 => qRotate(v.orientation, v.angularVelocity);

export function portInfo(v: VesselState, p: PartState): PortInfo | null {
  const mod = dockingModule(p);
  if (!mod) return null;
  const node = p.def.attachNodes.find((n) => n.id === mod.node);
  if (!node) return null;
  const posBody = add(p.position, qRotate(p.rotation, node.position));
  const dirBody = normalize(qRotate(p.rotation, node.direction));
  const r = qRotate(v.orientation, sub(posBody, v.com));
  return {
    vessel: v,
    part: p,
    mod,
    posBody,
    dirBody,
    pos: add(v.position, r),
    dir: qRotate(v.orientation, dirBody),
    vel: add(v.velocity, cross(omegaWorld(v), r)),
  };
}

/** The part docked/attached to port `p` through its docking face, if any. */
export function dockedPartner(v: VesselState, p: PartState): PartState | null {
  const mod = dockingModule(p);
  if (!mod) return null;
  if (p.parent !== null && p.attachNode === mod.node) return v.cache.byUid.get(p.parent) ?? null;
  for (const c of p.children) {
    const ch = v.cache.byUid.get(c);
    if (ch && ch.parentNode === mod.node) return ch;
  }
  return null;
}

export const isPortFree = (v: VesselState, p: PartState): boolean => !!dockingModule(p) && dockedPartner(v, p) === null;

export function freePorts(v: VesselState): PortInfo[] {
  const out: PortInfo[] = [];
  for (const p of v.parts) {
    if (!dockingModule(p) || !isPortFree(v, p)) continue;
    const info = portInfo(v, p);
    if (info) out.push(info);
  }
  return out;
}

/** Ports of `v` that currently join two halves which could be undocked. */
export function dockedPorts(v: VesselState): PartState[] {
  const out: PartState[] = [];
  const seen = new Set<string>();
  for (const p of v.parts) {
    const other = dockedPartner(v, p);
    if (!other) continue;
    const key = [p.uid, other.uid].sort((a, b) => a - b).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export interface PortAlignment {
  /** Face-to-face distance, m. */
  distance: number;
  /** Angle between A's normal and the reversed normal of B, rad (0 = perfectly facing). */
  angle: number;
  /** Relative velocity of B's face w.r.t. A's face, inertial. */
  relVel: Vec3;
  /** B's face centre relative to A's, inertial. */
  offset: Vec3;
}

export function portAlignment(a: PortInfo, b: PortInfo): PortAlignment {
  const offset = sub(b.pos, a.pos);
  const c = Math.max(-1, Math.min(1, -dot(a.dir, b.dir)));
  return { distance: length(offset), angle: Math.acos(c), relVel: sub(b.vel, a.vel), offset };
}

export interface DockingCandidate {
  a: PortInfo;
  b: PortInfo;
  align: PortAlignment;
}

const capture = (a: PortInfo, b: PortInfo) => ({
  range: Math.min(a.mod.captureRange, b.mod.captureRange),
  speed: Math.min(a.mod.captureSpeed, b.mod.captureSpeed),
  angle: Math.min(a.mod.captureAngle, b.mod.captureAngle),
});

/** Pairs of free, armed, same-size ports on different vessels that are inside their capture envelope. */
export function findDockingCandidates(vessels: VesselState[]): DockingCandidate[] {
  const out: DockingCandidate[] = [];
  const ports = vessels.map((v) => (v.destroyed ? [] : freePorts(v).filter((p) => !p.part.dockDisarmed)));
  for (let i = 0; i < vessels.length; i++) {
    if (!ports[i].length) continue;
    for (let j = i + 1; j < vessels.length; j++) {
      if (!ports[j].length) continue;
      const A = vessels[i], B = vessels[j];
      if (length(sub(A.position, B.position)) > A.cache.boundingRadius + B.cache.boundingRadius + 5) continue;
      for (const a of ports[i])
        for (const b of ports[j]) {
          if (a.mod.size !== b.mod.size) continue;
          const cap = capture(a, b);
          const al = portAlignment(a, b);
          if (al.distance > cap.range || al.angle > cap.angle || length(al.relVel) > cap.speed) continue;
          out.push({ a, b, align: al });
        }
    }
  }
  out.sort((x, y) => x.align.distance - y.align.distance);
  return out;
}

/** Add an inertial angular impulse to a vessel. */
function addAngularImpulse(v: VesselState, dL: Vec3) {
  const dLB = qRotate(qConj(v.orientation), dL);
  v.angularVelocity = add(v.angularVelocity, m3MulVec(v.invInertia, dLB));
}

/** Scalar moment of inertia of a vessel about inertial unit axis n. */
function inertiaAbout(v: VesselState, n: Vec3): number {
  const nb = qRotate(qConj(v.orientation), n);
  return dot(nb, m3MulVec(v.inertia, nb));
}

const clampLen = (a: Vec3, max: number) => {
  const l = length(a);
  return l > max ? scale(a, max / l) : a;
};

/** Apply one step of the soft-capture field (equal and opposite impulses, so linear momentum is conserved). */
export function applyCaptureField(c: DockingCandidate, dt: number) {
  const A = c.a.vessel, B = c.b.vessel;
  const mu = (A.mass * B.mass) / (A.mass + B.mass);
  // Pull B's face onto A's face (relative acceleration of B w.r.t. A).
  const acc = clampLen(sub(scale(c.align.offset, -MAG_K), scale(c.align.relVel, MAG_C)), MAG_AMAX);
  const J = scale(acc, mu * dt);
  applyImpulse(B, J, c.b.posBody);
  applyImpulse(A, scale(J, -1), c.a.posBody);
  // Align normals: rotate A's normal toward -B's normal (and B's toward -A's), damping relative spin.
  const target = scale(c.b.dir, -1);
  const ax = cross(c.a.dir, target);
  const s = length(ax);
  const theta = s > 1e-9 ? scale(ax, Math.atan2(s, dot(c.a.dir, target)) / s) : v3();
  const wRel = sub(omegaWorld(A), omegaWorld(B));
  const alpha = clampLen(sub(scale(theta, ALIGN_K), scale(wRel, ALIGN_C)), ALIGN_AMAX);
  const la = length(alpha);
  if (la < 1e-12) return;
  const n = scale(alpha, 1 / la);
  const IA = inertiaAbout(A, n), IB = inertiaAbout(B, n);
  const Ieff = (IA * IB) / (IA + IB);
  const dL = scale(alpha, Ieff * dt);
  addAngularImpulse(A, dL);
  addAngularImpulse(B, scale(dL, -1));
}

/** Total inertial angular momentum of vessels about point X moving with velocity V. */
export function systemAngularMomentum(vs: VesselState[], X: Vec3, V: Vec3): Vec3 {
  let L = v3();
  for (const v of vs) {
    L = add(L, qRotate(v.orientation, m3MulVec(v.inertia, v.angularVelocity)));
    L = add(L, scale(cross(sub(v.position, X), sub(v.velocity, V)), v.mass));
  }
  return L;
}

/** Shortest-arc rotation taking unit vector a onto unit vector b. */
function rotationBetween(a: Vec3, b: Vec3): Quat {
  const c = dot(a, b);
  const ax = cross(a, b);
  const s = length(ax);
  if (s < 1e-12) {
    if (c > 0) return { x: 0, y: 0, z: 0, w: 1 };
    const perp = Math.abs(a.x) < 0.9 ? normalize(cross(a, v3(1, 0, 0))) : normalize(cross(a, v3(0, 1, 0)));
    return qFromAxisAngle(perp, Math.PI);
  }
  return qFromAxisAngle(scale(ax, 1 / s), Math.atan2(s, c));
}

/**
 * Merge vessel `other` into `keep`, joining port `keepPortUid` (on keep) with `otherPortUid` (on other).
 * `other`'s parts are snapped so the faces coincide exactly, re-uid'd, re-rooted at its port and parented to
 * keep's port. Linear momentum is conserved exactly, angular momentum about the combined COM up to the snap.
 * Mutates `keep`; `other` is marked destroyed and must be discarded by the caller.
 */
export function mergeVessels(keep: VesselState, other: VesselState, keepPortUid: number, otherPortUid: number): void {
  const pk = keep.cache.byUid.get(keepPortUid);
  const po = other.cache.byUid.get(otherPortUid);
  if (!pk || !po) throw new Error('mergeVessels: unknown port');
  const a = portInfo(keep, pk), b = portInfo(other, po);
  if (!a || !b) throw new Error('mergeVessels: not a docking port');
  // Conserved quantities, before any snapping.
  const M = keep.mass + other.mass;
  const P = add(scale(keep.velocity, keep.mass), scale(other.velocity, other.mass));
  const X = scale(add(scale(keep.position, keep.mass), scale(other.position, other.mass)), 1 / M);
  const V = scale(P, 1 / M);
  const L = systemAngularMomentum([keep, other], X, V);

  // Snap `other` so its face normal is exactly opposite keep's and the face centres coincide.
  const qSnap = rotationBetween(b.dir, scale(a.dir, -1));
  const qO = qNormalize(qMul(qSnap, other.orientation));
  const facePosO = add(other.position, qRotate(qO, sub(b.posBody, other.com)));
  const posO = add(other.position, sub(a.pos, facePosO));

  // Transform other's parts into keep's body frame.
  const qK = keep.orientation;
  const qKi = qConj(qK);
  const qRel = qNormalize(qMul(qKi, qO));
  let maxUid = 0;
  // Reserve dangling broken endpoint IDs too, so new hardware cannot impersonate a lost anchor.
  for (const p of keep.parts) maxUid = Math.max(maxUid, p.uid, p.link?.sourceUid ?? 0, p.link?.targetUid ?? 0);
  const remap = new Map<number, number>();
  [...other.parts].sort((x, y) => x.uid - y.uid).forEach((p, i) => remap.set(p.uid, maxUid + 1 + i));
  for (const p of other.parts) if (p.link) for (const uid of [p.link.sourceUid, p.link.targetUid]) {
    if (!remap.has(uid)) remap.set(uid, maxUid + 1 + remap.size);
  }
  const oldParent = new Map<number, number | null>();
  const oldAttach = new Map<number, { attachNode?: string; parentNode?: string }>();
  for (const p of other.parts) {
    const world = add(posO, qRotate(qO, sub(p.position, other.com)));
    p.position = add(keep.com, qRotate(qKi, sub(world, keep.position)));
    p.rotation = qNormalize(qMul(qRel, p.rotation));
    oldParent.set(p.uid, p.parent);
    oldAttach.set(p.uid, { attachNode: p.attachNode, parentNode: p.parentNode });
  }
  // Re-root the other tree at its port: reverse parent links along the path port -> old root.
  const path: number[] = [po.uid];
  for (let u = oldParent.get(po.uid) ?? null; u !== null; u = oldParent.get(u) ?? null) path.push(u);
  const byUidO = other.cache.byUid;
  for (let i = path.length - 1; i >= 1; i--) {
    const child = byUidO.get(path[i - 1])!; // old child
    const par = byUidO.get(path[i])!; // old parent -> becomes child of `child`
    const link = oldAttach.get(child.uid)!;
    par.parent = child.uid;
    par.attachNode = link.parentNode;
    par.parentNode = link.attachNode;
    // Fatigue belongs to this attachment, whose child changes when the edge reverses.
    if (child.structuralFatigue !== undefined) par.structuralFatigue = child.structuralFatigue;
    else delete par.structuralFatigue;
  }
  delete po.structuralFatigue; // the newly captured docking latch has no prior overload
  po.parent = pk.uid;
  po.attachNode = b.mod.node;
  po.parentNode = a.mod.node;
  po.docked = { vesselId: other.id, vesselName: other.name };
  for (const p of other.parts) {
    if (p.link) {
      p.link.sourceUid = remap.get(p.link.sourceUid) ?? p.link.sourceUid;
      p.link.targetUid = remap.get(p.link.targetUid) ?? p.link.targetUid;
    }
    p.uid = remap.get(p.uid)!;
    if (p !== po && p.parent !== null) p.parent = remap.get(p.parent)!;
  }
  keep.parts.push(...other.parts);
  rebuildTopology(keep);
  const oldCom = keep.com;
  recomputeMassProperties(keep, false);
  keep.position = add(keep.position, qRotate(qK, sub(keep.com, oldCom)));
  keep.velocity = V;
  // L about a point moving with the COM velocity is independent of the point, so it is the merged spin.
  keep.angularVelocity = m3MulVec(keep.invInertia, qRotate(qKi, L));
  keep.sas = { ...keep.sas, hold: null, integral: v3() };
  other.parts = [];
  other.destroyed = true;
}

export interface DockingEvent {
  keep: VesselState;
  removed: VesselState;
  keepPortUid: number;
  removedName: string;
}

/**
 * One docking step over all physics vessels: re-arm disarmed ports that have drifted clear, apply the capture
 * field to candidate pairs and merge pairs in contact. `prefer(a, b)` picks which vessel survives a merge
 * (default: the heavier). Returns merges performed; removed vessels must be dropped by the caller.
 */
export function stepDocking(vessels: VesselState[], dt: number, prefer?: (a: VesselState, b: VesselState) => VesselState): DockingEvent[] {
  rearmPorts(vessels);
  const events: DockingEvent[] = [];
  const used = new Set<VesselState>();
  for (const c of findDockingCandidates(vessels)) {
    const A = c.a.vessel, B = c.b.vessel;
    if (used.has(A) || used.has(B) || A.destroyed || B.destroyed) continue;
    used.add(A);
    used.add(B);
    if (c.align.distance < DOCK_CONTACT_DISTANCE && c.align.angle < capture(c.a, c.b).angle) {
      const keep = prefer ? prefer(A, B) : A.mass >= B.mass ? A : B;
      const [kp, op] = keep === A ? [c.a, c.b] : [c.b, c.a];
      const removed = op.vessel;
      const removedName = removed.name;
      mergeVessels(keep, removed, kp.part.uid, op.part.uid);
      events.push({ keep, removed, keepPortUid: kp.part.uid, removedName });
    } else applyCaptureField(c, dt);
  }
  return events;
}

/** Re-arm ports disarmed by undocking once no same-size port of another vessel is within 2x capture range. */
export function rearmPorts(vessels: VesselState[]) {
  for (const v of vessels)
    for (const p of v.parts) {
      if (!p.dockDisarmed) continue;
      const me = portInfo(v, p);
      if (!me) {
        p.dockDisarmed = false;
        continue;
      }
      let near = false;
      for (const o of vessels) {
        if (o === v || o.destroyed) continue;
        if (length(sub(o.position, me.pos)) > o.cache.boundingRadius + me.mod.captureRange * 2 + 1) continue;
        for (const q of o.parts) {
          const qm = dockingModule(q);
          if (!qm || qm.size !== me.mod.size) continue;
          const qi = portInfo(o, q);
          if (qi && length(sub(qi.pos, me.pos)) < me.mod.captureRange * 2) near = true;
        }
      }
      if (!near) p.dockDisarmed = false;
    }
}

/**
 * Undock at port `portUid`: split off the half on the far side of the docking joint (restoring its original
 * identity when it was docked in flight) and push the halves apart along the port axis. Returns the new vessel
 * or null when the port is not docked.
 */
export function undock(v: VesselState, portUid: number, separationSpeed = UNDOCK_SEPARATION_SPEED): VesselState | null {
  const p = v.cache.byUid.get(portUid);
  if (!p) return null;
  const partner = dockedPartner(v, p);
  if (!partner) return null;
  const info = portInfo(v, p)!;
  // The joint is the parent link of whichever of the two is the child.
  const childIsPort = p.parent === partner.uid;
  const cut = childIsPort ? p : partner;
  if (cut.uid === v.rootUid) return null;
  const memo = cut.docked;
  const counterpart = childIsPort ? partner : p;
  const pointBody = info.posBody;
  const nvs = splitVessel(v, [cut.uid]);
  const nv = nvs[0];
  if (!nv) return null;
  if (memo) {
    nv.id = memo.vesselId;
    nv.name = memo.vesselName;
  } else nv.name = `${v.name} Module`;
  cut.docked = undefined;
  // Port normal points out of `p`: if `p` left with nv, nv moves against the normal, else along it.
  const sepDirWorld = scale(qRotate(v.orientation, info.dirBody), childIsPort ? -1 : 1);
  const mu = (v.mass * nv.mass) / (v.mass + nv.mass);
  const J = scale(sepDirWorld, mu * separationSpeed);
  applyImpulse(nv, J, pointBody);
  applyImpulse(v, scale(J, -1), pointBody);
  cut.dockDisarmed = true;
  counterpart.dockDisarmed = true;
  return nv;
}

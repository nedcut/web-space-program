import type { CraftDef, PartInstance } from '../../sim/vessel/types';
import { add, length, sub, v3, type Vec3 } from '../../util/vec3';
import { qConj, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';
import { fitFairingShell, isFairingDef } from '../../sim/vessel/fairing';
import { mirrorPosition, mirrorRotation, requirePart, surfaceContact, worldNode, type HeldAssembly, type PartCatalog } from './geometry';

/** Pure subtree helpers shared by the editor core and the 3D view (previews must match committed edits). */

export function descendants(parts: readonly PartInstance[], uid: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const p of parts) if (p.parent !== undefined) {
    const list = children.get(p.parent);
    if (list) list.push(p.uid); else children.set(p.parent, [p.uid]);
  }
  const result = new Set([uid]);
  const stack = [uid];
  while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!result.has(c)) { result.add(c); stack.push(c); }
  return result;
}

const sameRotation = (a: Quat, b: Quat) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) > 1 - 1e-6;

/** A two-member group placed by mirror symmetry (positions and rotations reflected across craft YZ). */
export function isMirrorPair(a: PartInstance, b: PartInstance): boolean {
  return length(sub(b.position, mirrorPosition(a.position))) < 1e-4 && sameRotation(b.rotation, mirrorRotation(a.rotation));
}

/** Symmetry of a part's group as the editor setting that would recreate it. */
export function groupSymmetry(parts: readonly PartInstance[], uid: number): { mode: 'radial' | 'mirror'; count: number } {
  const part = parts.find(p => p.uid === uid);
  if (!part || part.symmetryGroup === undefined) return { mode: 'radial', count: 1 };
  const group = parts.filter(p => p.symmetryGroup === part.symmetryGroup && p.partId === part.partId);
  if (group.length === 2 && isMirrorPair(group[0], group[1])) return { mode: 'mirror', count: 2 };
  return { mode: 'radial', count: [1, 2, 3, 4, 6, 8].includes(group.length) ? group.length : 1 };
}

/**
 * Symmetry counterparts of a part (same group and part type, not inside each other's subtree), each with the map
 * that carries a craft-frame offset or rotation of the part onto it. The part itself comes first.
 */
export function counterpartMaps(parts: readonly PartInstance[], uid: number, symmetric = true):
  { part: PartInstance; vec: (v: Vec3) => Vec3; rot: (q: Quat) => Quat }[] {
  const part = parts.find(p => p.uid === uid);
  if (!part) throw new Error(`Unknown part uid: ${uid}`);
  const out = [{ part, vec: (v: Vec3) => v, rot: (q: Quat) => q }];
  if (!symmetric || part.symmetryGroup === undefined) return out;
  const own = descendants(parts, uid);
  const group = parts.filter(p => p.uid !== uid && p.symmetryGroup === part.symmetryGroup && p.partId === part.partId && !own.has(p.uid));
  const mirror = group.length === 1 && isMirrorPair(part, group[0]);
  for (const c of group) {
    if (descendants(parts, c.uid).has(uid)) continue;
    if (mirror) out.push({ part: c, vec: mirrorPosition, rot: mirrorRotation });
    else {
      const d = qNormalize(qMul(c.rotation, qConj(part.rotation)));
      out.push({ part: c, vec: v => qRotate(d, v), rot: q => qNormalize(qMul(qMul(d, q), qConj(d))) });
    }
  }
  return out;
}

/** Point a placed part pivots about: its surface contact, the attach node it hangs from, or its centre (root). */
export function partPivot(part: PartInstance, catalog: PartCatalog): Vec3 {
  if (part.parent === undefined || !part.attachNode) return part.position;
  const def = requirePart(catalog, part.partId);
  if (part.attachNode === 'srf') return surfaceContact(part, def).point;
  const node = def.attachNodes.find(n => n.id === part.attachNode);
  return node ? worldNode(part, node).position : part.position;
}

export interface PartTransform { offset?: Vec3; rotation?: Quat }
/**
 * Move (craft-frame offset) and/or rotate (craft-frame rotation about the part's pivot) a placed part with its subtree,
 * and its symmetry counterparts with theirs. Returns the changed parts by uid; attachment metadata is unchanged.
 */
export function transformedParts(parts: readonly PartInstance[], catalog: PartCatalog, uid: number, t: PartTransform, symmetric = true): Map<number, PartInstance> {
  const out = new Map<number, PartInstance>();
  const byUid = new Map(parts.map(p => [p.uid, p]));
  const offset = t.offset ?? v3(), rotation = qNormalize(t.rotation ?? qIdentity());
  for (const c of counterpartMaps(parts, uid, symmetric)) {
    const q = c.rot(rotation), d = c.vec(offset), pivot = partPivot(c.part, catalog);
    for (const id of descendants(parts, c.part.uid)) {
      if (out.has(id)) continue;
      const p = byUid.get(id)!;
      out.set(id, { ...p, position: add(add(pivot, qRotate(q, sub(p.position, pivot))), d), rotation: qNormalize(qMul(q, p.rotation)) });
    }
  }
  return out;
}

/**
 * Copy of a subtree with fresh uids from `firstUid`: the root loses its parent; struts and fuel lines are kept only
 * when both endpoints are copied; symmetry groups wholly inside the copy get fresh ids, others are dropped.
 */
export function copySubtree(parts: readonly PartInstance[], uid: number, firstUid: number, groupBase: number): HeldAssembly {
  const ids = descendants(parts, uid);
  const chosen = parts.filter(p => ids.has(p.uid) && (!p.link || (ids.has(p.link.sourceUid) && ids.has(p.link.targetUid))));
  const uids = new Map(chosen.map((p, i) => [p.uid, firstUid + i]));
  const groupCount = new Map<number, number>();
  for (const p of chosen) if (p.symmetryGroup !== undefined) groupCount.set(p.symmetryGroup, (groupCount.get(p.symmetryGroup) ?? 0) + 1);
  const groups = new Map<number, number>();
  for (const [g, n] of groupCount) if (n > 1) groups.set(g, groupBase + groups.size);
  const copies = chosen.map(src => {
    const p = structuredClone(src);
    p.uid = uids.get(src.uid)!;
    if (src.uid === uid) { delete p.parent; delete p.attachNode; delete p.parentNode; }
    else p.parent = uids.get(src.parent!)!;
    if (p.link) p.link = { ...p.link, sourceUid: uids.get(p.link.sourceUid)!, targetUid: uids.get(p.link.targetUid)! };
    if (p.symmetryGroup !== undefined && groups.has(p.symmetryGroup)) p.symmetryGroup = groups.get(p.symmetryGroup);
    else delete p.symmetryGroup;
    return p;
  });
  return { rootUid: uids.get(uid)!, parts: copies };
}

/** Parts on the payload side of a fairing: everything reached through its top node. */
export function fairingPayload(parts: readonly PartInstance[], fairing: PartInstance): PartInstance[] {
  if (fairing.attachNode === 'top') {
    const below = descendants(parts, fairing.uid);
    return parts.filter(p => !below.has(p.uid) && !p.link);
  }
  const out: PartInstance[] = [];
  for (const c of parts) if (c.parent === fairing.uid && c.parentNode === 'top')
    for (const id of descendants(parts, c.uid)) { const p = parts.find(x => x.uid === id)!; if (!p.link) out.push(p); }
  return out;
}

/** Fit every auto-fitted fairing shell to its payload (pure; returns the same craft when nothing changed). */
export function fitFairings(craft: CraftDef, catalog: PartCatalog): CraftDef {
  let changed = false;
  const parts = craft.parts.map(p => {
    const def = requirePart(catalog, p.partId);
    if (!isFairingDef(def) || p.tweaks?.fairingAuto === false) return p;
    const payload = fairingPayload(craft.parts, p).map(q => ({ def: requirePart(catalog, q.partId), position: q.position, rotation: q.rotation }));
    const shell = fitFairingShell(def, { def, position: p.position, rotation: p.rotation }, payload);
    const next = { ...p.tweaks };
    if (shell) { next.fairingHeight = shell.height; next.fairingRadius = shell.radius; }
    else { delete next.fairingHeight; delete next.fairingRadius; }
    if (next.fairingHeight === p.tweaks?.fairingHeight && next.fairingRadius === p.tweaks?.fairingRadius) return p;
    changed = true;
    const out = { ...p };
    if (Object.keys(next).length) out.tweaks = next; else delete out.tweaks;
    return out;
  });
  return changed ? { ...craft, parts } : craft;
}

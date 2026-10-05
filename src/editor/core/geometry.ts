import type { AttachNode, CraftDef, PartDef, PartInstance } from '../../sim/vessel/types';
import { add, sub, scale, negate, normalize, dot, distance, v3, type Vec3 } from '../../util/vec3';
import { qFromTo, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';

export type PartCatalog = Map<string, PartDef>;
/** Held parts retain craft-frame transforms; no transform is baked into their definitions. */
export interface HeldAssembly { rootUid: number; parts: PartInstance[] }
export interface Transform { position: Vec3; rotation: Quat }
export interface WorldAttachNode extends AttachNode { uid: number }
export interface SnapCandidate {
  parent: WorldAttachNode;
  child: WorldAttachNode;
  distance: number;
  /** Rigid delta: newPosition = rotation * oldPosition + position. */
  transform: Transform;
}
export const requirePart = (catalog: PartCatalog, id: string): PartDef => {
  const def = catalog.get(id);
  if (!def) throw new Error(`Unknown part: ${id}`);
  return def;
};
export function worldNode(part: PartInstance, node: AttachNode): WorldAttachNode {
  return { ...node, uid: part.uid, position: add(part.position, qRotate(part.rotation, node.position)), direction: normalize(qRotate(part.rotation, node.direction)) };
}
export function freeAttachNodes(assembly: Pick<CraftDef, 'parts'>, catalog: PartCatalog): WorldAttachNode[] {
  const occupied = new Set<string>();
  for (const part of assembly.parts) {
    if (part.parent === undefined) continue;
    if (part.attachNode && part.attachNode !== 'srf') occupied.add(`${part.uid}:${part.attachNode}`);
    if (part.parentNode && part.parentNode !== 'srf') occupied.add(`${part.parent}:${part.parentNode}`);
  }
  return assembly.parts.flatMap(part => requirePart(catalog, part.partId).attachNodes
    .filter(node => !occupied.has(`${part.uid}:${node.id}`)).map(node => worldNode(part, node)));
}
export function alignNodes(child: WorldAttachNode, parent: WorldAttachNode): Transform {
  const rotation = qFromTo(normalize(child.direction), negate(normalize(parent.direction)));
  return { rotation, position: sub(parent.position, qRotate(rotation, child.position)) };
}
/** Within radius, size matches win, then opposing directions, then distance. */
export function findBestSnap(held: HeldAssembly, craft: CraftDef, catalog: PartCatalog, radius: number): SnapCandidate | undefined {
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid snap radius');
  const parents = freeAttachNodes(craft, catalog);
  let best: SnapCandidate | undefined;
  let bestRank: number[] = [];
  for (const child of freeAttachNodes(held, catalog)) for (const parent of parents) {
    const d = distance(child.position, parent.position);
    if (d > radius) continue;
    const rank = [child.size === parent.size ? 0 : 1, dot(child.direction, parent.direction), d];
    if (!best || rank.some((n, i) => n < bestRank[i] && rank.slice(0, i).every((x, j) => Math.abs(x - bestRank[j]) < 1e-9))) {
      bestRank = rank;
      best = { child, parent, distance: d, transform: alignNodes(child, parent) };
    }
  }
  return best;
}
export function transformAssembly(assembly: HeldAssembly, transform: Transform): HeldAssembly {
  return { rootUid: assembly.rootUid, parts: assembly.parts.map(part => ({ ...part,
    position: add(qRotate(transform.rotation, part.position), transform.position),
    rotation: qNormalize(qMul(transform.rotation, part.rotation)),
  })) };
}
function shapeHalfExtents(def: PartDef): Vec3 {
  if (def.shape.kind === 'box') return scale(def.shape.size, 0.5);
  const r = Math.max(def.shape.radiusTop, def.shape.radiusBottom);
  return v3(r, def.shape.height / 2, r);
}
/**
 * Surface mount of a part (catalogue convention, see src/data/parts.ts): the 'srf' attach node — the mount
 * face, whose direction points into the parent — or, for parts without one, the centre of the local -Z face.
 * Surface parts extend outward along +Z with +Y kept along the parent's "up".
 */
export function surfaceMount(def: PartDef): { position: Vec3; direction: Vec3 } {
  const srf = def.attachNodes.find(n => n.id === 'srf');
  if (srf) return { position: srf.position, direction: normalize(srf.direction) };
  return { position: v3(0, 0, -shapeHalfExtents(def).z), direction: v3(0, 0, -1) };
}
/** Place `def` so its surface mount sits on `point` with the mount direction pointing into the parent
 * (-normal). `rotation` is a preferred craft-frame orientation; the minimal alignment preserves its roll. */
export function surfacePlacement(def: PartDef, point: Vec3, normal: Vec3, rotation: Quat): Transform {
  if (dot(normal, normal) < 1e-12) throw new Error('Surface normal must be nonzero');
  const mount = surfaceMount(def);
  const correction = qFromTo(normalize(qRotate(rotation, mount.direction)), negate(normalize(normal)));
  const aligned = qNormalize(qMul(correction, rotation));
  return { position: sub(point, qRotate(aligned, mount.position)), rotation: aligned };
}
/** Craft-frame mount point and outward surface normal of a surface-attached part instance. */
export function surfaceContact(part: PartInstance, def: PartDef): { point: Vec3; normal: Vec3 } {
  const mount = surfaceMount(def);
  return { point: add(part.position, qRotate(part.rotation, mount.position)), normal: negate(qRotate(part.rotation, mount.direction)) };
}
export const snapAngle = (angle: number, increment = Math.PI / 12): number => {
  if (!Number.isFinite(angle) || !Number.isFinite(increment) || increment <= 0) throw new Error('Invalid snap angle');
  return Math.round(angle / increment) * increment;
};
/** Snap axis-angle rotation to 15 degrees by default. */
export function snapRotation(rotation: Quat, increment = Math.PI / 12): Quat {
  let q = qNormalize(rotation);
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, q.w)));
  const axis = normalize(v3(q.x, q.y, q.z));
  const h = snapAngle(angle, increment) / 2;
  return qNormalize({ x: axis.x * Math.sin(h), y: axis.y * Math.sin(h), z: axis.z * Math.sin(h), w: Math.cos(h) });
}
export const mirrorPosition = (position: Vec3): Vec3 => ({ ...position, x: -position.x });
/** Reflection across craft YZ: R' = M R M, so rotations remain right handed. */
export const mirrorRotation = (rotation: Quat): Quat => ({ x: rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w });
export function partBounds(part: PartInstance, def: PartDef): { min: Vec3; max: Vec3 } {
  const h = shapeHalfExtents(def);
  const points: Vec3[] = [];
  for (const x of [-h.x, h.x]) for (const y of [-h.y, h.y]) for (const z of [-h.z, h.z]) points.push(add(part.position, qRotate(part.rotation, v3(x, y, z))));
  // Deployed wheels hang outside the (stowed) part shape.
  for (const m of def.modules) if (m.type === 'wheel') {
    const c = m.wheelCenter, r = m.radius;
    for (const d of [v3(r, 0, 0), v3(-r, 0, 0), v3(0, r, 0), v3(0, -r, 0), v3(0, 0, r), v3(0, 0, -r)]) points.push(add(part.position, qRotate(part.rotation, add(c, d))));
  }
  return {
    min: v3(Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.min(...points.map(p => p.z))),
    max: v3(Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y)), Math.max(...points.map(p => p.z))),
  };
}

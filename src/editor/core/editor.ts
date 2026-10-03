import type { CraftDef, PartInstance } from '../../sim/vessel/types';
import { add, sub, v3, type Vec3 } from '../../util/vec3';
import { qConj, qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';
import { alignNodes, freeAttachNodes, mirrorPosition, mirrorRotation, requirePart, shapeHalfExtents, surfacePlacement, transformAssembly, worldNode, type HeldAssembly, type PartCatalog, type SnapCandidate } from './geometry';
import { autoStage, getStageList, insertStage, moveToStage, removeEmptyStages, type Stage } from './staging';
import { deserializeCraft, serializeCraft } from './serialization';

export type Symmetry = { mode: 'radial'; count: 1 | 2 | 3 | 4 | 6 | 8 } | { mode: 'mirror'; count?: 2 };
export interface EditorSnapshot { craft: CraftDef; held?: HeldAssembly }
export type ChangeListener = (snapshot: EditorSnapshot) => void;
const copy = <T>(value: T): T => structuredClone(value);
function descendants(parts: PartInstance[], uid: number): Set<number> {
  const result = new Set([uid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of parts) if (p.parent !== undefined && result.has(p.parent) && !result.has(p.uid)) { result.add(p.uid); changed = true; }
  }
  return result;
}
/** Reverse the path to the old root without changing craft-frame geometry. */
function rootAt(parts: PartInstance[], uid: number): PartInstance[] {
  const result = copy(parts);
  const byUid = new Map(result.map(p => [p.uid, p]));
  let current = byUid.get(uid);
  if (!current) throw new Error(`Unknown part uid: ${uid}`);
  let parentUid = current.parent;
  let childNode = current.attachNode, parentNode = current.parentNode;
  delete current.parent; delete current.attachNode; delete current.parentNode;
  while (parentUid !== undefined) {
    const parent = byUid.get(parentUid)!;
    const nextUid = parent.parent, nextChildNode = parent.attachNode, nextParentNode = parent.parentNode;
    parent.parent = current.uid;
    parent.attachNode = parentNode; parent.parentNode = childNode;
    current = parent; parentUid = nextUid; childNode = nextChildNode; parentNode = nextParentNode;
  }
  return result;
}

/** Pure-data editor. Getters/events return defensive snapshots; all writes use explicit
 * transactional methods. Undo includes held assemblies and keeps at least 50 steps.
 * Geometry uses absolute craft-frame rotations. Renderer ray hits use craft coordinates.
 * New attachments auto-stage; manual staging persists until the next structural addition. */
export class CraftEditor {
  private state: EditorSnapshot;
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  private listeners = new Set<ChangeListener>();
  private symmetry: Symmetry = { mode: 'radial', count: 1 };
  readonly historyLimit: number;
  constructor(readonly catalog: PartCatalog, craft: CraftDef = { name: 'Untitled', type: 'VAB', parts: [], version: 1 }, historyLimit = 100) {
    this.state = { craft: deserializeCraft(serializeCraft(craft), catalog) };
    this.historyLimit = Math.max(50, Math.floor(historyLimit) || 100);
  }
  get craft(): CraftDef { return copy(this.state.craft); }
  get held(): HeldAssembly | undefined { return copy(this.state.held); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  onChange(listener: ChangeListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(copy(this.state)); }
  private update<T>(fn: () => T): T {
    const before = copy(this.state);
    let result: T;
    try { result = fn(); } catch (error) { this.state = before; throw error; }
    this.past.push(before);
    if (this.past.length > this.historyLimit) this.past.shift();
    this.future = []; this.emit();
    return copy(result);
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.state); this.state = previous; this.emit(); return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.state); this.state = next; this.emit(); return true;
  }
  setSymmetry(symmetry: Symmetry): void {
    if (symmetry.mode === 'radial' && ![1, 2, 3, 4, 6, 8].includes(symmetry.count)) throw new Error('Unsupported radial symmetry');
    if (symmetry.mode !== 'radial' && symmetry.mode !== 'mirror') throw new Error('Unsupported symmetry mode');
    this.symmetry = copy(symmetry);
  }
  private part(uid: number): PartInstance {
    const p = this.state.craft.parts.find(p => p.uid === uid);
    if (!p) throw new Error(`Unknown part uid: ${uid}`);
    return p;
  }
  private nextUid(): number { return 1 + Math.max(0, ...this.state.craft.parts.map(p => p.uid), ...(this.state.held?.parts.map(p => p.uid) ?? [])); }
  private newPart(partId: string): PartInstance {
    requirePart(this.catalog, partId);
    return { uid: this.nextUid(), partId, position: v3(), rotation: qIdentity() };
  }
  addRoot(partId: string): PartInstance {
    return this.update(() => {
      if (this.state.craft.parts.length) throw new Error('Craft already has a root');
      const part = this.newPart(partId);
      this.state.craft.parts.push(part);
      this.state.craft = autoStage(this.state.craft, this.catalog);
      return this.part(part.uid);
    });
  }
  private node(part: PartInstance, id: string) {
    const node = requirePart(this.catalog, part.partId).attachNodes.find(n => n.id === id);
    if (!node) throw new Error(`Unknown node ${id} on ${part.partId}`);
    return node;
  }
  private assertFree(uid: number, id: string): void {
    if (!freeAttachNodes(this.state.craft, this.catalog).some(n => n.uid === uid && n.id === id)) throw new Error(`Occupied or missing node ${uid}:${id}`);
  }
  /** Symmetry includes the original: x4 adds four parts, not five.
   * Grouped parents take precedence: copies use each corresponding parent once.
   * A single stack node cannot host radial copies; use symmetric parents or surface attachment. */
  private addSymmetric(part: PartInstance, parent: PartInstance): PartInstance {
    const count = this.symmetry.mode === 'mirror' ? 2 : this.symmetry.count;
    let counterparts = parent.symmetryGroup === undefined ? [parent] : this.state.craft.parts.filter(p => p.symmetryGroup === parent.symmetryGroup);
    counterparts = [parent, ...counterparts.filter(p => p.uid !== parent.uid)];
    const useCounterparts = counterparts.length > 1;
    const copies = useCounterparts ? counterparts.length : count;
    if (copies > 1 && !useCounterparts && part.attachNode !== 'srf') throw new Error('Stack symmetry requires symmetric parent parts');
    const group = copies > 1 ? 1 + Math.max(0, ...this.state.craft.parts.map(p => p.symmetryGroup ?? 0)) : undefined;
    const firstUid = this.nextUid();
    for (let i = 0; i < copies; i++) {
      const p = copy(part); p.uid = firstUid + i;
      if (group !== undefined) p.symmetryGroup = group;
      if (useCounterparts) {
        const target = counterparts[i];
        const delta = qMul(target.rotation, qConj(parent.rotation));
        p.position = add(target.position, qRotate(delta, sub(part.position, parent.position)));
        p.rotation = qNormalize(qMul(delta, part.rotation));
        if (i > 0 && this.symmetry.mode === 'mirror' && counterparts.length === 2) {
          this.mirrorPartPlacement(p, part);
        }
        p.parent = target.uid;
        if (p.attachNode !== 'srf') {
          this.assertFree(target.uid, p.parentNode!);
          const t = alignNodes(worldNode(p, this.node(p, p.attachNode!)), worldNode(target, this.node(target, p.parentNode!)));
          p.position = add(qRotate(t.rotation, p.position), t.position);
          p.rotation = qNormalize(qMul(t.rotation, p.rotation));
        }
      } else if (i > 0 && this.symmetry.mode === 'mirror') {
        this.mirrorPartPlacement(p, part);
      } else if (i > 0) {
        const delta = qFromAxisAngle(v3(0, 1, 0), 2 * Math.PI * i / copies);
        p.position = add(parent.position, qRotate(delta, sub(part.position, parent.position)));
        p.rotation = qNormalize(qMul(delta, part.rotation));
      }
      this.state.craft.parts.push(p);
    }
    this.state.craft = autoStage(this.state.craft, this.catalog);
    return this.part(firstUid);
  }
  private mirrorPartPlacement(target: PartInstance, original: PartInstance): void {
    target.position = mirrorPosition(original.position);
    target.rotation = mirrorRotation(original.rotation);
    if (original.attachNode === 'srf') {
      // Quaternions cannot encode reflection. Re-align the local -X anchor after
      // reflecting the preferred orientation, preserving the mirrored contact point.
      const def = requirePart(this.catalog, original.partId);
      const anchor = add(original.position, qRotate(original.rotation, v3(-shapeHalfExtents(def).x, 0, 0)));
      const normal = qRotate(original.rotation, v3(1, 0, 0));
      Object.assign(target, surfacePlacement(def, mirrorPosition(anchor), mirrorPosition(normal), target.rotation));
    }
  }
  attachPart(partId: string, parentUid: number, parentNodeId: string, childNodeId: string, rotation: Quat = qIdentity()): PartInstance {
    return this.update(() => {
      const parent = this.part(parentUid); this.assertFree(parentUid, parentNodeId);
      const part = this.newPart(partId); part.rotation = qNormalize(rotation);
      const t = alignNodes(worldNode(part, this.node(part, childNodeId)), worldNode(parent, this.node(parent, parentNodeId)));
      part.position = t.position; part.rotation = qNormalize(qMul(t.rotation, part.rotation));
      part.parent = parentUid; part.attachNode = childNodeId; part.parentNode = parentNodeId;
      return this.addSymmetric(part, parent);
    });
  }
  /** positionOnParent and normal are in the parent's LOCAL frame. */
  surfaceAttach(partId: string, parentUid: number, positionOnParent: Vec3, normal: Vec3, rotation: Quat = qIdentity()): PartInstance {
    const parent = this.part(parentUid);
    return this.surfaceAttachAtHit(partId, parentUid, add(parent.position, qRotate(parent.rotation, positionOnParent)), qRotate(parent.rotation, normal), rotation);
  }
  /** Renderer convenience: point and normal are in CRAFT frame. */
  surfaceAttachAtHit(partId: string, parentUid: number, point: Vec3, normal: Vec3, rotation: Quat = qIdentity()): PartInstance {
    return this.update(() => {
      const parent = this.part(parentUid), def = requirePart(this.catalog, partId);
      if (!def.surfaceAttachable || !requirePart(this.catalog, parent.partId).allowSurfaceAttachChildren) throw new Error('Surface attachment is not allowed');
      const part = { ...this.newPart(partId), ...surfacePlacement(def, point, normal, qNormalize(rotation)), parent: parentUid, attachNode: 'srf', parentNode: 'srf' };
      return this.addSymmetric(part, parent);
    });
  }
  detachSubtree(uid: number): HeldAssembly {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      this.part(uid);
      const ids = descendants(this.state.craft.parts, uid);
      const parts = copy(this.state.craft.parts.filter(p => ids.has(p.uid)));
      const root = parts.find(p => p.uid === uid)!;
      delete root.parent; delete root.attachNode; delete root.parentNode;
      // Break groups that straddle the detached boundary, retaining wholly detached groups.
      const outsideGroups = new Set(this.state.craft.parts.filter(p => !ids.has(p.uid)).map(p => p.symmetryGroup));
      for (const p of parts) if (outsideGroups.has(p.symmetryGroup)) delete p.symmetryGroup;
      this.state.craft.parts = this.state.craft.parts.filter(p => !ids.has(p.uid));
      this.state.held = { rootUid: uid, parts };
      return this.state.held;
    });
  }
  private requireHeld(): HeldAssembly { if (!this.state.held) throw new Error('No held assembly'); return this.state.held; }
  /** Translate held assembly by a craft-frame delta. */
  moveHeld(delta: Vec3): void { this.update(() => { this.state.held = transformAssembly(this.requireHeld(), { position: delta, rotation: qIdentity() }); }); }
  /** Rotate around held root by default, or an explicit craft-frame pivot. */
  rotateHeld(rotation: Quat, pivot?: Vec3): void {
    this.update(() => {
      const held = this.requireHeld();
      const center = pivot ?? held.parts.find(p => p.uid === held.rootUid)!.position;
      const q = qNormalize(rotation);
      this.state.held = transformAssembly(held, { rotation: q, position: sub(center, qRotate(q, center)) });
    });
  }
  /** Any free node in a held assembly may connect; its tree is rerooted at that part. */
  attachHeld(parentUid: number, parentNodeId: string, childNodeId: string, childUid?: number): PartInstance {
    return this.update(() => {
      const held = this.requireHeld();
      const uid = childUid ?? held.rootUid;
      const parent = this.part(parentUid); this.assertFree(parentUid, parentNodeId);
      const child = held.parts.find(p => p.uid === uid);
      if (!child || !freeAttachNodes(held, this.catalog).some(n => n.uid === uid && n.id === childNodeId)) throw new Error('Held node is missing or occupied');
      const delta = alignNodes(worldNode(child, this.node(child, childNodeId)), worldNode(parent, this.node(parent, parentNodeId)));
      const moved = transformAssembly({ rootUid: uid, parts: rootAt(held.parts, uid) }, delta);
      const root = moved.parts.find(p => p.uid === uid)!;
      root.parent = parentUid; root.parentNode = parentNodeId; root.attachNode = childNodeId;
      this.state.craft.parts.push(...moved.parts); delete this.state.held;
      this.state.craft = autoStage(this.state.craft, this.catalog);
      return this.part(uid);
    });
  }
  attachHeldAtSnap(candidate: SnapCandidate): PartInstance { return this.attachHeld(candidate.parent.uid, candidate.parent.id, candidate.child.id, candidate.child.uid); }
  surfaceAttachHeld(parentUid: number, point: Vec3, normal: Vec3, rotation?: Quat): PartInstance {
    return this.update(() => {
      const held = this.requireHeld(), parent = this.part(parentUid);
      const root = held.parts.find(p => p.uid === held.rootUid)!;
      const def = requirePart(this.catalog, root.partId);
      if (!def.surfaceAttachable || !requirePart(this.catalog, parent.partId).allowSurfaceAttachChildren) throw new Error('Surface attachment is not allowed');
      const target = surfacePlacement(def, point, normal, rotation ?? root.rotation);
      const q = qMul(target.rotation, qConj(root.rotation));
      const moved = transformAssembly(held, { rotation: q, position: sub(target.position, qRotate(q, root.position)) });
      const attached = moved.parts.find(p => p.uid === moved.rootUid)!;
      attached.parent = parentUid; attached.attachNode = 'srf'; attached.parentNode = 'srf';
      this.state.craft.parts.push(...moved.parts); delete this.state.held;
      this.state.craft = autoStage(this.state.craft, this.catalog);
      return this.part(attached.uid);
    });
  }
  discardHeld(): void { this.update(() => { this.requireHeld(); delete this.state.held; }); }
  placeHeldAsRoot(): void {
    this.update(() => {
      if (this.state.craft.parts.length) throw new Error('Craft already has a root');
      const held = this.requireHeld(), root = held.parts.find(p => p.uid === held.rootUid)!;
      this.state.craft.parts = transformAssembly(held, { position: sub(v3(), root.position), rotation: qIdentity() }).parts;
      delete this.state.held;
    });
  }
  deletePart(uid: number): void {
    this.update(() => {
      const target = this.part(uid);
      const roots = this.state.craft.parts.filter(p => p.uid === uid || (target.symmetryGroup !== undefined && p.symmetryGroup === target.symmetryGroup));
      const ids = new Set(roots.flatMap(p => [...descendants(this.state.craft.parts, p.uid)]));
      this.state.craft.parts = this.state.craft.parts.filter(p => !ids.has(p.uid));
    });
  }
  reRoot(uid: number): void {
    this.update(() => {
      const origin = this.part(uid).position;
      this.state.craft.parts = rootAt(this.state.craft.parts, uid).map(p => ({ ...p, position: sub(p.position, origin) }));
    });
  }
  autoStage(): void { this.update(() => { this.state.craft = autoStage(this.state.craft, this.catalog); }); }
  moveToStage(uid: number, stageIndex: number): void { this.update(() => { this.state.craft = moveToStage(this.state.craft, uid, stageIndex); }); }
  insertStage(stageIndex: number): void { this.update(() => { this.state.craft = insertStage(this.state.craft, stageIndex); }); }
  removeEmptyStages(): void { this.update(() => { this.state.craft = removeEmptyStages(this.state.craft); }); }
  getStageList(): Stage[] { return getStageList(this.state.craft); }
}

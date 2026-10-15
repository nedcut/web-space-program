import type { ActionGroupId, CraftDef, PartActionId, PartInstance, PartTweaks, ResourceId } from '../../sim/vessel/types';
import { tweakDescriptors } from '../../sim/vessel/tweaks';
import { partActions } from '../../sim/vessel/actions';
import { add, sub, v3, length, normalize, type Vec3 } from '../../util/vec3';
import { qConj, qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';
import { alignNodes, freeAttachNodes, mirrorPosition, mirrorRotation, requirePart, surfaceContact, surfacePlacement, transformAssembly, worldNode, type HeldAssembly, type PartCatalog, type SnapCandidate, type Transform } from './geometry';
import { autoStage as defaultStager, getStageList, insertIntoStaging, insertStage, moveStage, moveToStage, removeEmptyStages, sameStaging, type Stage, type Stager } from './staging';
import { copySubtree, counterpartMaps, descendants, fitFairings, groupSymmetry, transformedParts, type PartTransform } from './subtree';
import { deserializeCraft, serializeCraft } from './serialization';

export type Symmetry = { mode: 'radial'; count: 1 | 2 | 3 | 4 | 6 | 8 } | { mode: 'mirror'; count?: 2 };
export interface LinkHit { uid: number; point: Vec3; normal: Vec3 }
/** `manualStaging`: the player has arranged the stages; edits insert new parts instead of re-staging everything. */
/** `detached`: assemblies set aside in the hall (craft-frame transforms, no stages). They are not part of the craft:
 * staging, stats and launch ignore them until they are picked up and attached again. */
export interface EditorSnapshot { craft: CraftDef; held?: HeldAssembly; detached?: SetAsidePiece[]; linkStart?: { partId: string; hit: LinkHit }; manualStaging?: boolean }
/** A set-aside assembly. `craft`: the craft set aside by `swapDetached` (it keeps its stages and staging mode). */
export type SetAsidePiece = HeldAssembly & { craft?: { manualStaging: boolean } };
/** Where a held assembly is spliced into an occupied stack joint: `childUid`/`childNodeId` meet the parent node (as in
 * `attachHeld`); the part that sat there re-attaches to `throughUid`/`throughNodeId`, pushed along with its subtree. */
export interface SpliceTarget { parentUid: number; parentNodeId: string; childUid: number; childNodeId: string; throughUid: number; throughNodeId: string }
export interface EditorOptions {
  /** Automatic stager (default: assembly-aware `autoStage`). */
  stager?: Stager;
  /** Start in manual (true) or automatic (false) staging; default: manual when the craft's staging differs from automatic. */
  manualStaging?: boolean;
}
/** A saved, reusable subtree: positions relative to the root; `symmetry` re-creates the set it came from. */
export interface Subassembly { rootUid: number; parts: PartInstance[]; symmetry?: HeldAssembly['symmetry'] }
export type ChangeListener = (snapshot: EditorSnapshot) => void;
const copy = <T>(value: T): T => structuredClone(value);
function assertLinkHit(hit: LinkHit): void {
  if (![hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite)
    || Math.abs(length(hit.normal) - 1) > 1e-5) throw new Error('Invalid surface point');
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
 * Staging is automatic until the player rearranges it; from then on new parts are inserted into the manual order
 * (`insertIntoStaging`) until "reset to automatic". Fairing shells refit to their payload after every edit. */
export class CraftEditor {
  private state: EditorSnapshot;
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  private listeners = new Set<ChangeListener>();
  private symmetry: Symmetry = { mode: 'radial', count: 1 };
  readonly historyLimit: number;
  readonly stager: Stager;
  constructor(readonly catalog: PartCatalog, craft: CraftDef = { name: 'Untitled', type: 'VAB', parts: [], version: 1 }, historyLimit = 100, options: EditorOptions = {}) {
    this.state = { craft: deserializeCraft(serializeCraft(craft), catalog) };
    this.historyLimit = Math.max(50, Math.floor(historyLimit) || 100);
    this.stager = options.stager ?? defaultStager;
    const parts = this.state.craft.parts;
    let manual = options.manualStaging;
    if (manual === undefined) {
      try { manual = parts.length > 0 && !sameStaging(this.state.craft, this.stager(this.state.craft, catalog)); } catch { manual = true; }
    }
    if (manual) this.state.manualStaging = true;
  }
  /** The player arranged the stages (new parts are inserted rather than re-staged). */
  get manualStaging(): boolean { return !!this.state.manualStaging; }
  get craft(): CraftDef { return copy(this.state.craft); }
  get held(): HeldAssembly | undefined { return copy(this.state.held); }
  get detached(): SetAsidePiece[] { return copy(this.state.detached ?? []); }
  get linkStart() { return copy(this.state.linkStart); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  onChange(listener: ChangeListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(copy(this.state)); }
  private coalesce: { key: string; at: number } | null = null;
  /** `coalesceKey`: consecutive edits with the same key within a moment share one undo step (slider drags). */
  private update<T>(fn: () => T, coalesceKey?: string): T {
    const before = copy(this.state);
    let result: T;
    try { result = fn(); } catch (error) { this.state = before; throw error; }
    const now = Date.now();
    const merge = !!coalesceKey && this.coalesce?.key === coalesceKey && now - this.coalesce.at < 1500 && this.past.length > 0;
    this.coalesce = coalesceKey ? { key: coalesceKey, at: now } : null;
    if (!merge) {
      this.past.push(before);
      if (this.past.length > this.historyLimit) this.past.shift();
    }
    this.future = []; this.emit();
    return copy(result);
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.state); this.state = previous; this.emit(); return true;
  }
  /** Undo without leaving a redo entry: the undone step is abandoned, not suspended (cancelled pick-up/copy). */
  rollback(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.state = previous; this.emit(); return true;
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
  /** Uids stay unique across the craft, the held assembly and the set-aside pieces. */
  private maxUid(): number {
    let max = 0;
    for (const p of this.state.craft.parts) max = Math.max(max, p.uid);
    for (const p of this.state.held?.parts ?? []) max = Math.max(max, p.uid);
    for (const a of this.state.detached ?? []) for (const p of a.parts) max = Math.max(max, p.uid);
    return max;
  }
  private nextUid(): number { return 1 + this.maxUid(); }
  private newPart(partId: string): PartInstance {
    requirePart(this.catalog, partId);
    return { uid: this.nextUid(), partId, position: v3(), rotation: qIdentity() };
  }
  addRoot(partId: string): PartInstance {
    return this.update(() => {
      if (this.state.craft.parts.length) throw new Error('Craft already has a root');
      const part = this.newPart(partId);
      this.state.craft.parts.push(part);
      this.settle();
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
  /** After a structural edit: refit fairing shells, then stage automatically or insert into the manual order. */
  private settle(): void {
    let craft = fitFairings(this.state.craft, this.catalog);
    craft = this.state.manualStaging ? insertIntoStaging(craft, this.catalog, this.stager) : this.stager(craft, this.catalog);
    this.state.craft = craft;
  }
  /** Symmetry includes the original: x4 adds four parts, not five.
   * Grouped parents take precedence: copies use each corresponding parent once.
   * A single stack node cannot host radial copies; use symmetric parents or surface attachment. */
  private addSymmetric(part: PartInstance, parent: PartInstance): PartInstance {
    this.replicate([part], part.uid, parent);
    this.settle();
    return this.part(part.uid);
  }
  /**
   * Add a subtree (root already attached to `parent`) plus its symmetry copies: one per parent counterpart when the
   * parent is grouped, otherwise radial/mirror copies per the symmetry setting (surface roots only). The first copy keeps
   * its uids. Groups wholly inside the subtree stay per copy; every other part is grouped with its copies.
   * `skipOccupied`: counterparts whose stack node is taken are skipped instead of failing (re-placed assemblies).
   */
  private replicate(parts: PartInstance[], rootUid: number, parent: PartInstance, skipOccupied = false): void {
    const root = parts.find(p => p.uid === rootUid)!;
    const count = this.symmetry.mode === 'mirror' ? 2 : this.symmetry.count;
    let counterparts = parent.symmetryGroup === undefined ? [parent] : this.state.craft.parts.filter(p => p.symmetryGroup === parent.symmetryGroup);
    counterparts = [parent, ...counterparts.filter(p => p.uid !== parent.uid)];
    const useCounterparts = counterparts.length > 1;
    if (useCounterparts && skipOccupied && root.attachNode !== 'srf') {
      const free = new Set(freeAttachNodes(this.state.craft, this.catalog).map(n => `${n.uid}:${n.id}`));
      counterparts = counterparts.filter((c, i) => i === 0 || free.has(`${c.uid}:${root.parentNode}`));
    }
    const copies = useCounterparts ? counterparts.length : count;
    if (copies > 1 && !useCounterparts && root.attachNode !== 'srf') throw new Error('Stack symmetry requires symmetric parent parts');
    const members = new Map<number, number>();
    for (const p of parts) if (p.symmetryGroup !== undefined) members.set(p.symmetryGroup, (members.get(p.symmetryGroup) ?? 0) + 1);
    const internal = (g?: number) => g !== undefined && (members.get(g) ?? 0) > 1;
    let nextGroup = 1 + Math.max(0, ...this.state.craft.parts.map(p => p.symmetryGroup ?? 0), ...parts.map(p => p.symmetryGroup ?? 0));
    const across = new Map<number, number>();
    if (copies > 1) for (const p of parts) if (!internal(p.symmetryGroup)) across.set(p.uid, nextGroup++);
    let nextUid = 1 + Math.max(this.maxUid(), ...parts.map(p => p.uid));
    const mirror = this.symmetry.mode === 'mirror';
    for (let i = 0; i < copies; i++) {
      const uids = new Map(parts.map(p => [p.uid, i === 0 ? p.uid : nextUid++]));
      const groups = new Map<number, number>();
      let set = parts.map(src => {
        const p = copy(src);
        p.uid = uids.get(src.uid)!;
        if (src.uid !== rootUid && src.parent !== undefined) p.parent = uids.get(src.parent) ?? src.parent;
        if (p.link) p.link = { ...p.link, sourceUid: uids.get(p.link.sourceUid) ?? p.link.sourceUid, targetUid: uids.get(p.link.targetUid) ?? p.link.targetUid };
        if (internal(src.symmetryGroup)) {
          if (i > 0) { if (!groups.has(src.symmetryGroup!)) groups.set(src.symmetryGroup!, nextGroup++); p.symmetryGroup = groups.get(src.symmetryGroup!); }
        } else if (across.has(src.uid)) p.symmetryGroup = across.get(src.uid);
        else delete p.symmetryGroup;
        return p;
      });
      const rootCopy = () => set.find(p => p.uid === uids.get(rootUid))!;
      const move = (t: Transform) => { set = transformAssembly({ rootUid, parts: set }, t).parts; };
      if (useCounterparts) {
        const target = counterparts[i];
        if (i > 0 && mirror && counterparts.length === 2) set = this.mirrorAssembly(set, uids.get(rootUid)!);
        else if (i > 0) {
          const delta = qMul(target.rotation, qConj(parent.rotation));
          move({ rotation: delta, position: sub(target.position, qRotate(delta, parent.position)) });
        }
        const r = rootCopy();
        r.parent = target.uid;
        if (r.attachNode !== 'srf') {
          this.assertFree(target.uid, r.parentNode!);
          move(alignNodes(worldNode(r, this.node(r, r.attachNode!)), worldNode(target, this.node(target, r.parentNode!))));
        }
      } else if (i > 0 && mirror) set = this.mirrorAssembly(set, uids.get(rootUid)!);
      else if (i > 0) {
        const delta = qFromAxisAngle(v3(0, 1, 0), 2 * Math.PI * i / copies);
        move({ rotation: delta, position: sub(parent.position, qRotate(delta, parent.position)) });
      }
      this.state.craft.parts.push(...set);
    }
  }
  /** Reflect an assembly across craft YZ; a surface-mounted root is re-seated flush on the mirrored contact. */
  private mirrorAssembly(parts: PartInstance[], rootUid: number): PartInstance[] {
    const original = parts.find(p => p.uid === rootUid)!;
    let out = parts.map(p => ({ ...p, position: mirrorPosition(p.position), rotation: mirrorRotation(p.rotation) }));
    if (original.attachNode === 'srf') {
      // Quaternions cannot encode reflection: M R M equals the reflection only for parts symmetric about their
      // local YZ plane (all catalogue radial parts). Re-seat the mount on the mirrored contact point so any
      // part still sits flush on the mirrored surface.
      const def = requirePart(this.catalog, original.partId);
      const contact = surfaceContact(original, def);
      const mirrored = out.find(p => p.uid === rootUid)!;
      const seat = surfacePlacement(def, mirrorPosition(contact.point), mirrorPosition(contact.normal), mirrored.rotation);
      const q = qNormalize(qMul(seat.rotation, qConj(mirrored.rotation)));
      out = transformAssembly({ rootUid, parts: out }, { rotation: q, position: sub(seat.position, qRotate(q, mirrored.position)) }).parts;
    }
    return out;
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
  beginLink(partId: string, hit: LinkHit): void {
    this.update(() => {
      assertLinkHit(hit);
      const def = requirePart(this.catalog, partId), host = this.part(hit.uid);
      if (!def.modules.some(m => m.type === 'strut' || m.type === 'fuelLine') || this.state.held
        || !requirePart(this.catalog, host.partId).allowSurfaceAttachChildren) throw new Error('Invalid link source');
      this.state.linkStart = { partId, hit: copy(hit) };
    });
  }
  cancelLink(): void { if (this.state.linkStart) this.update(() => { delete this.state.linkStart; }); }
  /** Finish all symmetry copies in one transaction; both hits are in craft coordinates. */
  completeLink(hit: LinkHit): PartInstance {
    return this.update(() => {
      assertLinkHit(hit);
      const start = this.state.linkStart;
      if (!start) throw new Error('Choose the first endpoint');
      const source = this.part(start.hit.uid), target = this.part(hit.uid);
      const def = requirePart(this.catalog, start.partId);
      const spec = def.modules.find(m => m.type === 'strut' || m.type === 'fuelLine')!;
      const distance = length(sub(hit.point, start.hit.point));
      if (source.uid === target.uid || !requirePart(this.catalog, target.partId).allowSurfaceAttachChildren) throw new Error('Choose a different part surface');
      if (distance < 0.05 || distance > spec.maxLength) throw new Error(`Link length must be 0.05–${spec.maxLength} m`);
      const uid = this.nextUid();
      const mount = { ...this.newPart(start.partId), ...surfacePlacement(def, start.hit.point, start.hit.normal, qIdentity()),
        parent: source.uid, attachNode: 'srf', parentNode: 'srf' };
      this.addSymmetric(mount, source);
      const copies = this.state.craft.parts.filter(p => p.uid >= uid);
      for (let i = 0; i < copies.length; i++) {
        const p = copies[i], host = this.part(p.parent!);
        const mirrored = i > 0 && this.symmetry.mode === 'mirror';
        let transformPoint: (v: Vec3) => Vec3, transformNormal: (v: Vec3) => Vec3;
        if (mirrored) {
          transformPoint = mirrorPosition; transformNormal = mirrorPosition;
        } else {
          const delta = qMul(p.rotation, qConj(mount.rotation));
          transformPoint = v => add(p.position, qRotate(delta, sub(v, mount.position)));
          transformNormal = v => qRotate(delta, v);
        }
        const targetCenter = transformPoint(target.position);
        const counterpart = this.state.craft.parts.find(t => t.partId === target.partId && length(sub(t.position, targetCenter)) < 1e-4);
        if (!counterpart || counterpart.uid === host.uid) throw new Error('Symmetry needs corresponding target parts');
        const localPoint = (v: Vec3, t: PartInstance) => qRotate(qConj(t.rotation), sub(v, t.position));
        p.link = { version: 1, sourceUid: host.uid, sourcePos: localPoint(transformPoint(start.hit.point), host),
          sourceNormal: normalize(qRotate(qConj(host.rotation), transformNormal(start.hit.normal))),
          targetUid: counterpart.uid, targetPos: localPoint(transformPoint(hit.point), counterpart),
          targetNormal: normalize(qRotate(qConj(counterpart.rotation), transformNormal(hit.normal))) };
      }
      delete this.state.linkStart;
      return this.part(uid);
    });
  }
  /**
   * Pick up a part with its subtree. `symmetric`: also remove its symmetry counterparts' subtrees; the held assembly
   * records the set's symmetry so placement re-creates it. The rest of the craft is re-staged (a stage left empty by
   * the pick-up is removed); held parts lose their stage and are staged again when attached.
   */
  detachSubtree(uid: number, symmetric = false): HeldAssembly {
    return this.update(() => this.takeSubtree(uid, symmetric));
  }
  private takeSubtree(uid: number, symmetric: boolean): HeldAssembly {
    if (this.state.held) throw new Error('An assembly is already held');
    this.part(uid);
    const all = this.state.craft.parts;
    const ids = descendants(all, uid);
    const removed = new Set(ids);
    const set = symmetric ? counterpartMaps(all, uid) : [];
    for (const c of set.slice(1)) for (const id of descendants(all, c.part.uid)) removed.add(id);
    const linked = new Set(all.filter(p => p.link && (removed.has(p.link.sourceUid) || removed.has(p.link.targetUid))).map(p => p.uid));
    const parts = copy(all.filter(p => ids.has(p.uid) && !linked.has(p.uid)));
    // A link mount picked directly becomes ordinary held hardware; endpoints are chosen anew.
    for (const p of parts) { if (p.link) delete p.link; delete p.stage; }
    const root = parts.find(p => p.uid === uid)!;
    delete root.parent; delete root.attachNode; delete root.parentNode;
    this.state.craft.parts = all.filter(p => !removed.has(p.uid) && !linked.has(p.uid));
    // Break groups that straddle the detached boundary, retaining wholly detached groups.
    const outsideGroups = new Set(this.state.craft.parts.map(p => p.symmetryGroup));
    for (const p of parts) if (outsideGroups.has(p.symmetryGroup)) delete p.symmetryGroup;
    delete this.state.linkStart;
    this.state.held = { rootUid: uid, parts };
    if (set.length > 1) {
      const sym = groupSymmetry(all, uid);
      this.state.held.symmetry = sym.mode === 'mirror' ? sym : { mode: 'radial', count: set.length };
    }
    if (this.state.craft.parts.length) this.settle();
    return this.state.held;
  }
  /**
   * Whether `detachPart` can take just this part: it must hang from a parent by a stack node and carry at most one
   * stack-attached child (which then closes the gap). Surface-mounted parts on it go with it.
   */
  canDetachPart(uid: number): boolean {
    const p = this.state.craft.parts.find(q => q.uid === uid);
    if (!p || p.parent === undefined || p.attachNode === 'srf' || p.link) return false;
    return this.state.craft.parts.filter(c => c.parent === uid && c.attachNode !== 'srf').length <= 1;
  }
  /**
   * Pick up only this part (with what is surface-mounted on it); the stack it held re-attaches to its parent's node,
   * moved to close the gap. Symmetry counterparts are handled the same way when `symmetric`.
   */
  detachPart(uid: number, symmetric = false): HeldAssembly {
    return this.update(() => {
      if (!this.canDetachPart(uid)) throw new Error('This part holds more than one stack; pick it up with its attached parts');
      const targets = symmetric ? counterpartMaps(this.state.craft.parts, uid).map(c => c.part.uid) : [uid];
      // Bridge each target's stack child over to the target's parent node first.
      for (const t of targets) {
        if (!this.canDetachPart(t)) continue;
        const part = this.part(t), parent = this.part(part.parent!);
        const child = this.state.craft.parts.find(c => c.parent === t && c.attachNode !== 'srf');
        if (!child) continue;
        const subtree = descendants(this.state.craft.parts, child.uid);
        const moved = transformAssembly({ rootUid: child.uid, parts: this.state.craft.parts.filter(p => subtree.has(p.uid)) },
          alignNodes(worldNode(child, this.node(child, child.attachNode!)), worldNode(parent, this.node(parent, part.parentNode!))));
        const byUid = new Map(moved.parts.map(p => [p.uid, p]));
        this.state.craft.parts = this.state.craft.parts.map(p => byUid.get(p.uid) ?? p);
        const bridged = this.part(child.uid);
        // The parent's node is shared for a moment: the part leaves it below.
        bridged.parent = parent.uid; bridged.parentNode = part.parentNode;
      }
      return this.takeSubtree(uid, symmetric);
    });
  }
  /** Alt-click: hold a copy of a part's subtree (fresh uids, same stages); a symmetric source is placed as a set. */
  copySubtree(uid: number): HeldAssembly {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      const all = this.state.craft.parts;
      if (this.part(uid).link) throw new Error('Choose a part, not a strut or fuel line');
      const held = copySubtree(all, uid, this.nextUid(), 1 + Math.max(0, ...all.map(p => p.symmetryGroup ?? 0)));
      const sym = groupSymmetry(all, uid);
      if (sym.count > 1) held.symmetry = sym;
      delete this.state.linkStart;
      this.state.held = held;
      return held;
    });
  }
  /** A reusable subtree (root at the origin, no stage assignments) for the subassembly drawer. */
  subassembly(uid: number): Subassembly {
    const held = copySubtree(this.state.craft.parts, uid, 1, 1);
    const root = held.parts.find(p => p.uid === held.rootUid)!;
    const moved = transformAssembly(held, { position: sub(v3(), root.position), rotation: qIdentity() });
    for (const p of moved.parts) delete p.stage;
    const sym = groupSymmetry(this.state.craft.parts, uid);
    return copy({ rootUid: moved.rootUid, parts: moved.parts, ...(sym.count > 1 ? { symmetry: sym } : {}) });
  }
  /** Hold a subassembly (fresh uids). Parts must exist in the catalogue and form one tree under `rootUid`. */
  holdAssembly(assembly: Subassembly): HeldAssembly {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      for (const p of assembly.parts) requirePart(this.catalog, p.partId);
      if (!assembly.parts.some(p => p.uid === assembly.rootUid)) throw new Error('Subassembly has no root part');
      const held = copySubtree(assembly.parts, assembly.rootUid, this.nextUid(), 1 + Math.max(0, ...this.state.craft.parts.map(p => p.symmetryGroup ?? 0)));
      for (const p of held.parts) if (![p.position.x, p.position.y, p.position.z, p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w].every(Number.isFinite)) throw new Error('Invalid subassembly');
      const sym = assembly.symmetry;
      if (sym && (sym.mode === 'mirror' || [2, 3, 4, 6, 8].includes(sym.count))) held.symmetry = sym.mode === 'mirror' ? { mode: 'mirror', count: 2 } : { mode: 'radial', count: sym.count };
      delete this.state.linkStart;
      this.state.held = held;
      return held;
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
  /** Any free node in a held assembly may connect; its tree is rerooted at that part. Symmetric parents (and, for
   * surface mounts, the symmetry setting) re-create the set. */
  attachHeld(parentUid: number, parentNodeId: string, childNodeId: string, childUid?: number): PartInstance {
    return this.update(() => {
      const uid = childUid ?? this.requireHeld().rootUid;
      this.placeHeldAt(parentUid, parentNodeId, childNodeId, uid, true);
      this.settle();
      return this.part(uid);
    });
  }
  /** Move the held assembly onto a free parent node and add it (with symmetry copies); returns where copies start. */
  private placeHeldAt(parentUid: number, parentNodeId: string, childNodeId: string, uid: number, skipOccupied: boolean): { start: number; size: number; order: number[] } {
    const held = this.requireHeld();
    const parent = this.part(parentUid); this.assertFree(parentUid, parentNodeId);
    const child = held.parts.find(p => p.uid === uid);
    if (!child || !freeAttachNodes(held, this.catalog).some(n => n.uid === uid && n.id === childNodeId)) throw new Error('Held node is missing or occupied');
    const delta = alignNodes(worldNode(child, this.node(child, childNodeId)), worldNode(parent, this.node(parent, parentNodeId)));
    const moved = transformAssembly({ rootUid: uid, parts: rootAt(held.parts, uid) }, delta);
    const root = moved.parts.find(p => p.uid === uid)!;
    root.parent = parentUid; root.parentNode = parentNodeId; root.attachNode = childNodeId;
    delete this.state.held;
    const start = this.state.craft.parts.length;
    this.replicate(moved.parts, uid, parent, skipOccupied);
    return { start, size: moved.parts.length, order: moved.parts.map(p => p.uid) };
  }
  /**
   * Insert the held assembly into an occupied stack joint: it takes the parent's node and the part that sat there (with
   * its subtree) re-attaches to the held assembly's through node, moved out of the way. Symmetric parents splice every
   * counterpart's joint the same way. One undo step.
   */
  spliceHeld(t: SpliceTarget): PartInstance {
    return this.update(() => this.spliceInner(t));
  }
  /** Insert a new part into an occupied stack joint (see `spliceHeld`). */
  insertPart(partId: string, t: Omit<SpliceTarget, 'childUid' | 'throughUid'>, rotation: Quat = qIdentity()): PartInstance {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      const part = this.newPart(partId); part.rotation = qNormalize(rotation);
      this.state.held = { rootUid: part.uid, parts: [part] };
      return this.spliceInner({ ...t, childUid: part.uid, throughUid: part.uid });
    });
  }
  private spliceInner(t: SpliceTarget): PartInstance {
    const held = this.requireHeld();
    if (t.throughUid === t.childUid && t.throughNodeId === t.childNodeId) throw new Error('Choose a part with two stack nodes');
    if (!held.parts.some(p => p.uid === t.throughUid) || !freeAttachNodes(held, this.catalog).some(n => n.uid === t.throughUid && n.id === t.throughNodeId)) throw new Error('Held node is missing or occupied');
    const parent = this.part(t.parentUid);
    const counterparts = parent.symmetryGroup === undefined ? [parent] : [parent, ...this.state.craft.parts.filter(p => p.symmetryGroup === parent.symmetryGroup && p.uid !== parent.uid)];
    // Lift each counterpart's occupant (and its subtree) off the joint.
    const lifted = new Map<number, PartInstance[]>();
    for (const c of counterparts) {
      const occupant = this.state.craft.parts.find(p => p.parent === c.uid && p.parentNode === t.parentNodeId && p.attachNode !== 'srf');
      if (!occupant) continue;
      const ids = descendants(this.state.craft.parts, occupant.uid);
      lifted.set(c.uid, this.state.craft.parts.filter(p => ids.has(p.uid)));
      this.state.craft.parts = this.state.craft.parts.filter(p => !ids.has(p.uid));
    }
    if (!lifted.has(parent.uid)) throw new Error('That joint is free: attach normally');
    const { start, size, order } = this.placeHeldAt(t.parentUid, t.parentNodeId, t.childNodeId, t.childUid, false);
    const throughIndex = order.indexOf(t.throughUid), rootIndex = order.indexOf(t.childUid);
    const placed = this.state.craft.parts.slice(start);
    for (let i = 0; i * size < placed.length; i++) {
      const through = placed[i * size + throughIndex], host = placed[i * size + rootIndex].parent!;
      const subtree = lifted.get(host);
      if (!subtree) continue;
      lifted.delete(host);
      const occupant = subtree.find(p => p.parent === host)!;
      const moved = transformAssembly({ rootUid: occupant.uid, parts: subtree },
        alignNodes(worldNode(occupant, this.node(occupant, occupant.attachNode!)), worldNode(through, this.node(through, t.throughNodeId))));
      const root = moved.parts.find(p => p.uid === occupant.uid)!;
      root.parent = through.uid; root.parentNode = t.throughNodeId;
      this.state.craft.parts.push(...moved.parts);
    }
    if (lifted.size) throw new Error('Symmetry copies could not be inserted');
    this.settle();
    return this.part(t.childUid);
  }
  /**
   * Set the held assembly aside in the hall: it keeps its parts but leaves the craft (no stages; ignored by stats and
   * launch). `rotation` (about the held root) is applied first, then the root is moved to `position` (craft frame).
   */
  parkHeld(position: Vec3, rotation: Quat = qIdentity()): HeldAssembly {
    return this.update(() => {
      if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error('Invalid position');
      const held = this.requireHeld();
      const root = held.parts.find(p => p.uid === held.rootUid)!;
      const q = qNormalize(rotation);
      const turned = transformAssembly(held, { rotation: q, position: sub(root.position, qRotate(q, root.position)) });
      const turnedRoot = turned.parts.find(p => p.uid === held.rootUid)!;
      const parked = transformAssembly(turned, { rotation: qIdentity(), position: sub(position, turnedRoot.position) });
      for (const p of parked.parts) delete p.stage;
      delete this.state.held;
      (this.state.detached ??= []).push(parked);
      if (this.state.craft.parts.length) this.settle();
      return parked;
    });
  }
  /** Pick a set-aside assembly up again; `uid` (one of its parts) becomes the held root. */
  pickUpDetached(index: number, uid?: number): HeldAssembly {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      const list = this.state.detached ?? [];
      const assembly = list[index];
      if (!assembly) throw new Error('No such detached piece');
      const rootUid = uid ?? assembly.rootUid;
      if (!assembly.parts.some(p => p.uid === rootUid)) throw new Error(`Unknown part uid: ${rootUid}`);
      list.splice(index, 1);
      if (!list.length) delete this.state.detached;
      delete this.state.linkStart;
      const parts = rootAt(assembly.parts, rootUid);
      for (const p of parts) delete p.stage;
      this.state.held = { rootUid, parts, ...(assembly.symmetry ? { symmetry: assembly.symmetry } : {}) };
      return this.state.held;
    });
  }
  /**
   * Take a part and what hangs from it off a set-aside piece; the rest stays set aside. The piece's root takes it all.
   * Struts and fuel lines between the two halves are removed; symmetry groups split across them are broken.
   */
  takeFromDetached(index: number, uid: number): HeldAssembly {
    return this.update(() => {
      if (this.state.held) throw new Error('An assembly is already held');
      delete this.state.linkStart;
      return this.state.held = this.splitDetached(index, uid);
    });
  }
  private splitDetached(index: number, uid: number): HeldAssembly {
    const list = this.state.detached ?? [];
    const piece = list[index];
    if (!piece) throw new Error('No such detached piece');
    const part = piece.parts.find(p => p.uid === uid);
    if (!part) throw new Error(`Unknown part uid: ${uid}`);
    if (part.link) throw new Error('Choose a part, not a strut or fuel line');
    const ids = new Set([...descendants(piece.parts, uid)].filter(id => !piece.parts.find(p => p.uid === id)!.link));
    const side = (p: PartInstance) => !p.link ? (ids.has(p.uid) ? 'take' : 'keep')
      : ids.has(p.link.sourceUid) && ids.has(p.link.targetUid) ? 'take' : !ids.has(p.link.sourceUid) && !ids.has(p.link.targetUid) ? 'keep' : 'drop';
    const parts = copy(piece.parts.filter(p => side(p) === 'take'));
    const rest = piece.parts.filter(p => side(p) === 'keep');
    const restGroups = new Set(rest.map(p => p.symmetryGroup));
    for (const p of parts) { delete p.stage; if (rest.length && restGroups.has(p.symmetryGroup)) delete p.symmetryGroup; }
    const root = parts.find(p => p.uid === uid)!;
    delete root.parent; delete root.attachNode; delete root.parentNode;
    if (rest.length) list[index] = { rootUid: piece.rootUid, parts: rest, ...(piece.craft ? { craft: piece.craft } : {}) };
    else { list.splice(index, 1); if (!list.length) delete this.state.detached; }
    return { rootUid: uid, parts, ...(!rest.length && piece.symmetry ? { symmetry: piece.symmetry } : {}) };
  }
  /**
   * Swap a set-aside piece with the craft so it can be edited with every tool: the piece becomes the craft (root at
   * the origin, staged afresh) and the craft is set aside moved by `offset`, keeping its stages and staging mode, so
   * swapping it back restores it. With an empty craft the piece simply takes its place.
   */
  swapDetached(index: number, offset: Vec3): void {
    this.update(() => {
      if (this.state.held) throw new Error('Place or drop the held part first');
      if (![offset.x, offset.y, offset.z].every(Number.isFinite)) throw new Error('Invalid position');
      const list = this.state.detached ?? [];
      const piece = list[index];
      if (!piece) throw new Error('No such detached piece');
      const craft = this.state.craft.parts;
      if (craft.length) {
        const root = craft.find(p => p.parent === undefined && !p.link) ?? craft[0];
        list[index] = { rootUid: root.uid, parts: craft.map(p => ({ ...p, position: add(p.position, offset) })), craft: { manualStaging: !!this.state.manualStaging } };
      } else list.splice(index, 1);
      if (!list.length) delete this.state.detached;
      const origin = piece.parts.find(p => p.uid === piece.rootUid)!.position;
      this.state.craft.parts = rootAt(piece.parts, piece.rootUid).map(p => ({ ...p, position: sub(p.position, origin) }));
      if (piece.craft?.manualStaging) this.state.manualStaging = true; else delete this.state.manualStaging;
      delete this.state.linkStart;
      this.settle();
    });
  }
  /** Delete a set-aside assembly, or only `uid` and what hangs from it. */
  discardDetached(index: number, uid?: number): void {
    this.update(() => {
      const list = this.state.detached ?? [];
      if (!list[index]) throw new Error('No such detached piece');
      this.splitDetached(index, uid ?? list[index].rootUid);
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
      delete this.state.held;
      this.replicate(moved.parts, attached.uid, parent, true);
      this.settle();
      return this.part(attached.uid);
    });
  }
  discardHeld(): void { this.update(() => { this.requireHeld(); delete this.state.held; this.settle(); }); }
  placeHeldAsRoot(): void {
    this.update(() => {
      if (this.state.craft.parts.length) throw new Error('Craft already has a root');
      const held = this.requireHeld(), root = held.parts.find(p => p.uid === held.rootUid)!;
      this.state.craft.parts = transformAssembly(held, { position: sub(v3(), root.position), rotation: qIdentity() }).parts;
      delete this.state.held;
      this.settle();
    });
  }
  deletePart(uid: number): void {
    this.update(() => {
      const target = this.part(uid);
      const roots = this.state.craft.parts.filter(p => p.uid === uid || (target.symmetryGroup !== undefined && p.symmetryGroup === target.symmetryGroup));
      const ids = new Set(roots.flatMap(p => [...descendants(this.state.craft.parts, p.uid)]));
      this.state.craft.parts = this.state.craft.parts.filter(p => !ids.has(p.uid)
        && !(p.link && (ids.has(p.link.sourceUid) || ids.has(p.link.targetUid))));
      delete this.state.linkStart;
      this.settle();
    });
  }
  reRoot(uid: number): void {
    this.update(() => {
      if (this.part(uid).link) throw new Error('A link cannot be the craft root');
      const origin = this.part(uid).position;
      this.state.craft.parts = rootAt(this.state.craft.parts, uid).map(p => ({ ...p, position: sub(p.position, origin) }));
      // Re-rooting keeps the stages as they are. Automatic staging reads the tree from the root, so keep later edits
      // from re-staging everything when its result for the new tree would differ.
      if (!this.state.manualStaging && !sameStaging(this.state.craft, this.stager(this.state.craft, this.catalog))) this.state.manualStaging = true;
      this.state.craft = fitFairings(this.state.craft, this.catalog);
    });
  }
  /**
   * Offset (craft-frame translation) and/or rotate (about the part's attachment point) a placed part with its subtree;
   * with `symmetric`, its counterparts follow (rotated or mirrored). `coalesceKey` merges a gesture into one undo step.
   */
  transformPart(uid: number, t: PartTransform, symmetric = true, coalesceKey?: string): void {
    this.update(() => {
      this.part(uid);
      const changed = transformedParts(this.state.craft.parts, this.catalog, uid, t, symmetric);
      this.state.craft.parts = this.state.craft.parts.map(p => changed.get(p.uid) ?? p);
      this.state.craft = fitFairings(this.state.craft, this.catalog);
    }, coalesceKey);
  }
  /** Switch between vertical (VAB) and horizontal (SPH) building; geometry is unchanged (craft +Y = nose). */
  setCraftType(type: CraftDef['type']): void {
    if (type !== 'VAB' && type !== 'SPH') throw new Error('Unsupported craft type');
    if (this.state.craft.type === type) return;
    this.update(() => { this.state.craft.type = type; });
  }
  /** A part and, when `symmetric`, its symmetry counterparts of the same type. */
  private counterparts(uid: number, symmetric: boolean): PartInstance[] {
    const p = this.part(uid);
    return symmetric && p.symmetryGroup !== undefined ? this.state.craft.parts.filter(q => q.symmetryGroup === p.symmetryGroup && q.partId === p.partId) : [p];
  }
  /** Merge player settings; `undefined` clears a key. Keys the part does not offer are rejected. */
  setPartTweaks(uid: number, tweaks: PartTweaks, symmetric = true): void {
    this.update(() => {
      for (const p of this.counterparts(uid, symmetric)) {
        const offered = new Set(tweakDescriptors(requirePart(this.catalog, p.partId)).map(d => d.key));
        const next: PartTweaks = { ...p.tweaks };
        for (const [k, v] of Object.entries(tweaks) as [keyof PartTweaks, unknown][]) {
          if (!offered.has(k)) throw new Error(`This part has no ${k} setting`);
          if (v === undefined) delete next[k]; else (next as Record<string, unknown>)[k] = copy(v);
        }
        // Sizing a shell by hand stops it following the payload.
        if (('fairingHeight' in tweaks || 'fairingRadius' in tweaks) && !('fairingAuto' in tweaks)) next.fairingAuto = false;
        if (next.fairingAuto === true) delete next.fairingAuto;
        if (Object.keys(next).length) p.tweaks = next; else delete p.tweaks;
      }
      this.state.craft = fitFairings(this.state.craft, this.catalog);
    }, `tweak:${uid}:${Object.keys(tweaks).join()}`);
  }
  /** Set resource amounts (clamped to capacity; full amounts are stored as the default). */
  setPartResources(uid: number, resources: Partial<Record<ResourceId, number>>, symmetric = true): void {
    this.update(() => {
      for (const p of this.counterparts(uid, symmetric)) {
        const capacity = requirePart(this.catalog, p.partId).resources;
        const next: Partial<Record<ResourceId, number>> = { ...p.resources };
        for (const [id, amount] of Object.entries(resources) as [ResourceId, number][]) {
          const max = capacity[id];
          if (max === undefined || !Number.isFinite(amount)) throw new Error('This part cannot hold that resource');
          const v = Math.max(0, Math.min(max, amount));
          if (v >= max - 1e-9) delete next[id]; else next[id] = v;
        }
        if (Object.keys(next).length) p.resources = next; else delete p.resources;
      }
    }, `res:${uid}:${Object.keys(resources).join()}`);
  }
  /** Replace the actions a part contributes to an action group. */
  setPartActions(uid: number, group: ActionGroupId, actions: PartActionId[], symmetric = true): void {
    this.update(() => {
      for (const p of this.counterparts(uid, symmetric)) {
        const offered = partActions(requirePart(this.catalog, p.partId));
        const list = [...new Set(actions)].filter(a => offered.includes(a));
        const next = { ...p.actions };
        if (list.length) next[group] = list; else delete next[group];
        if (Object.keys(next).length) p.actions = next; else delete p.actions;
      }
    });
  }
  /** Remove every binding of an action group. */
  clearGroup(group: ActionGroupId): void {
    this.update(() => {
      for (const p of this.state.craft.parts) if (p.actions?.[group]) {
        delete p.actions[group];
        if (!Object.keys(p.actions).length) delete p.actions;
      }
    });
  }
  /** Reset to automatic staging (new parts re-stage everything again). */
  autoStage(): void { this.update(() => { this.state.craft = this.stager(this.state.craft, this.catalog); delete this.state.manualStaging; }); }
  moveToStage(uid: number, stageIndex: number): void { this.update(() => { this.state.craft = moveToStage(this.state.craft, uid, stageIndex); this.state.manualStaging = true; }); }
  insertStage(stageIndex: number): void { this.update(() => { this.state.craft = insertStage(this.state.craft, stageIndex); this.state.manualStaging = true; }); }
  /** Drag a whole stage to another position (UI indices, 0 fires first). */
  moveStage(from: number, to: number): void {
    if (from === to) return;
    this.update(() => { this.state.craft = moveStage(this.state.craft, from, to); this.state.manualStaging = true; });
  }
  removeEmptyStages(): void { this.update(() => { this.state.craft = removeEmptyStages(this.state.craft); }); }
  getStageList(): Stage[] { return getStageList(this.state.craft); }
}

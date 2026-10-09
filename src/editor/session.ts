import { snapshotEqual } from '../util/snapshotEqual';
import { getTutorial, endTutorial } from '../tutorial/runtime';
import { partUnlocked, launchProblem } from '../data/technology';
import { newProgression } from '../sim/science/progression';
import { PART_CATALOG } from '../data/parts';
import { RESOURCES } from '../data/resources';
import { game } from '../game/store';
import { Universe } from '../game/universe';
import { deleteCraft, listCrafts, saveCraft } from '../game/saves';
import type { ActionGroupId, CraftDef, PartActionId, PartInstance, PartTweaks, ResourceId } from '../sim/vessel/types';
import { qConj, qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../util/quat';
import { sub, v3, type Vec3 } from '../util/vec3';
import { CraftEditor, craftStats, descendants, getStageList, type CraftStats, type LinkHit, type PartTransform, type Stage, type Subassembly } from './core';
import { STOCK_CRAFTS } from './stockCrafts';
import { computeStageStats, type StageStats } from './ui/dv';
import { saveErrorText } from '../game/storageErrors';

export const CATALOG = PART_CATALOG;
export const DENSITIES: Partial<Record<ResourceId, number>> = Object.fromEntries(
  Object.values(RESOURCES).map((r) => [r.id, r.density]),
) as Partial<Record<ResourceId, number>>;

const SYMMETRY_STEPS = [1, 2, 3, 4, 6, 8] as const;
export type SymmetryCount = (typeof SYMMETRY_STEPS)[number];

/** What the player is holding. Positions are resolved every frame by the 3D view. */
export type HeldState =
  | { kind: 'new'; partId: string; rotation: Quat }
  | { kind: 'assembly'; rotation: Quat };

/** A resolved drop target computed by the view. Surface point/normal are in craft frame. */
export type Placement =
  | { kind: 'root' }
  | { kind: 'stack'; parentUid: number; parentNode: string; childUid: number; childNode: string }
  | {
      kind: 'surface';
      parentUid: number;
      /** Desired craft-frame transform of the held root. */
      position: Vec3;
      rotation: Quat;
      /** Hit point and outward surface normal on the parent (craft frame). */
      point: Vec3;
      normal: Vec3;
    };

export type SymmetryMode = 'radial' | 'mirror';

export interface Toast { id: number; text: string; tone: 'info' | 'warn' | 'bad' | 'good'; action?: { label: string; run: () => void } }

/** Build tools (keys 1–4): place/pick up parts, offset or rotate placed parts with a gizmo, choose a new root. */
export type EditorTool = 'place' | 'offset' | 'rotate' | 'reroot';
/** Bodies offered by the Δv/TWR readout picker. */
export interface DvBodyOption { id: string; name: string; gravity: number; atmosphere: boolean }

/** Editor interaction mode: building, or assigning part actions to action groups. */
export type EditorMode = 'build' | 'actions';
/** Floating part inspector panels (newest last). Unpinned panels are replaced by the next one opened. */
export interface InspectorPanelState { uid: number; pinned: boolean }

export interface SessionView {
  craft: CraftDef;
  name: string;
  stages: Stage[];
  stageStats: Map<number, StageStats>;
  stats: CraftStats;
  totalDvVac: number;
  totalDvAsl: number;
  held: HeldState | null;
  linkStart?: { partId: string; hit: LinkHit };
  symmetry: SymmetryCount;
  /** Radial (around the craft's long axis) or mirror (across the craft's YZ plane; count 1 = off, 2 = on). */
  symmetryMode: SymmetryMode;
  /** Building orientation: VAB = vertical (rockets), SPH = horizontal (aircraft). */
  craftType: CraftDef['type'];
  showCoM: boolean;
  showCoT: boolean;
  showCoL: boolean;
  canUndo: boolean;
  canRedo: boolean;
  toasts: Toast[];
  hoverUid: number | null;
  highlightUids: number[];
  /** Parts selected from the staging list or the 3D view (persistent highlight). */
  selectedUids: number[];
  mode: EditorMode;
  /** Action group being edited in 'actions' mode. */
  group: ActionGroupId;
  /** Parts with actions in the selected group (highlighted in 'actions' mode). */
  groupUids: number[];
  panels: InspectorPanelState[];
  /** Active build tool and the part its gizmo is attached to. */
  tool: EditorTool;
  gizmoUid: number | null;
  /** Offset/rotate gizmos snap (15° / 0.05 m; Shift for fine). */
  angleSnap: boolean;
  /** Staging was arranged by hand: new parts are inserted rather than re-staged. */
  manualStaging: boolean;
  /** Reference body for the per-stage Δv/TWR readouts. */
  dvBody: string;
  dvBodies: DvBodyOption[];
  version: number;
}

const EMPTY: CraftDef = { name: 'Untitled Craft', type: 'VAB', parts: [], version: 1 };

/**
 * Editor session: owns the headless CraftEditor plus UI state (held part, symmetry, toggles) and exposes an
 * immutable snapshot for React (`useSyncExternalStore`) and change events for the three.js view.
 */
export class EditorSession {
  editor: CraftEditor;
  private listeners = new Set<() => void>();
  private snap!: SessionView;
  private reference?: { preset: ReturnType<typeof game.get>['scalePreset']; universe: Universe; bodies: DvBodyOption[] };
  private dvBody = 'earth';
  private launchStats: { craft: CraftDef; stats: Map<number, StageStats> } | null = null;
  private tool: EditorTool = 'place';
  private gizmoUid: number | null = null;
  private angleSnap = true;
  /** Symmetry setting to restore after a picked-up set is placed or dropped. */
  private savedSymmetry: { count: SymmetryCount; mode: SymmetryMode } | null = null;
  private name: string;
  private launchWarnedAt = -Infinity;
  private scaleNotices = new Set<string>();
  private held: HeldState | null = null;
  private symmetry: SymmetryCount = 1;
  private symmetryMode: SymmetryMode = 'radial';
  private showCoM = false;
  private showCoT = false;
  private showCoL = false;
  private toasts: Toast[] = [];
  private toastId = 0;
  private hoverUid: number | null = null;
  private highlightUids: number[] = [];
  private selectedUids: number[] = [];
  private mode: EditorMode = 'build';
  private group: ActionGroupId = 'custom1';
  private panels: InspectorPanelState[] = [];
  private version = 0;
  private unsub: () => void = () => {};
  /** Bumped when a whole craft is loaded (view re-frames the camera). */
  loadCounter = 0;

  constructor(craft?: CraftDef | null, type: CraftDef['type'] = 'VAB') {
    this.editor = new CraftEditor(CATALOG, { ...EMPTY, type });
    this.name = EMPTY.name;
    this.attach(this.editor);
    if (craft) this.load(craft, false);
    else {
      this.applyTypeDefaults(type);
      this.refresh();
    }
  }

  /** SPH builds planes: mirror symmetry by default; VAB: radial. */
  private applyTypeDefaults(type: CraftDef['type']) {
    if (type === 'SPH') {
      this.symmetryMode = 'mirror';
      this.symmetry = 2;
      this.showCoL = true;
    } else {
      this.symmetryMode = 'radial';
      this.symmetry = 1;
    }
  }

  // ------------------------------------------------------------------ store plumbing
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private attach(editor: CraftEditor) {
    this.unsub();
    this.unsub = editor.onChange(() => {
      this.syncHeld();
      this.refresh();
    });
  }

  private refresh() {
    let craft = this.editor.craft;
    const preset = game.get().scalePreset;
    const same = this.reference?.preset === preset && snapshotEqual(craft, this.snap?.craft) && this.snap?.dvBody === this.dvBody;
    if (same) craft = this.snap.craft;
    const reference = this.referenceUniverse();
    const stats = same ? this.snap.stats : craftStats(craft, CATALOG, DENSITIES);
    const stages = same ? this.snap.stages : getStageList(craft);
    const stageStats = same ? this.snap.stageStats : computeStageStats(craft, CATALOG, reference.universe.body(this.dvBody));
    let totalDvVac = 0, totalDvAsl = 0;
    for (const s of stageStats.values()) { totalDvVac += s.dvVac; totalDvAsl += s.dvAsl; }
    this.version++;
    // Drop selections/panels of parts that no longer exist (deleted, picked up).
    const alive = new Set(craft.parts.map(p => p.uid));
    this.selectedUids = this.selectedUids.filter(u => alive.has(u));
    this.panels = this.panels.filter(p => alive.has(p.uid));
    this.snap = {
      ...this.uiFields(craft),
      craft, name: this.name, stages, stageStats, stats, totalDvVac, totalDvAsl,
      held: this.held, linkStart: this.editor.linkStart, symmetry: this.symmetry, symmetryMode: this.symmetryMode, craftType: craft.type,
      showCoM: this.showCoM, showCoT: this.showCoT, showCoL: this.showCoL,
      canUndo: this.editor.canUndo || this.held?.kind === 'new', canRedo: this.editor.canRedo,
      toasts: this.toasts, hoverUid: this.hoverUid, highlightUids: this.highlightUids, version: this.version,
    };
    this.listeners.forEach((l) => l());
  }

  /** Scaled universe for the reference bodies (rebuilt when the program's scale preset changes). */
  private referenceUniverse() {
    const preset = game.get().scalePreset;
    if (this.reference?.preset !== preset) {
      const universe = new Universe(preset);
      const bodies: DvBodyOption[] = [];
      const visit = (id: string) => {
        const b = universe.bodies.get(id);
        if (!b) return;
        if (b.solidSurface && (b.kind === 'planet' || b.kind === 'dwarf' || b.kind === 'moon')) bodies.push({ id: b.id, name: b.name, gravity: b.surfaceGravity, atmosphere: !!b.atmosphere });
        for (const c of b.children) visit(c);
      };
      visit(universe.sunId);
      this.reference = { preset, universe, bodies };
      if (!bodies.some(b => b.id === this.dvBody)) this.dvBody = 'earth';
    }
    return this.reference;
  }

  /** Per-stage readouts at the reference body. */
  setDvBody(id: string) {
    if (id === this.dvBody || !this.referenceUniverse().bodies.some(b => b.id === id)) return;
    this.dvBody = id;
    this.refresh();
  }

  /** Earth-relative stage stats for launch checks, whatever the readout body is. */
  launchStageStats(): Map<number, StageStats> {
    if (this.dvBody === 'earth') return this.snap.stageStats;
    if (this.launchStats?.craft !== this.snap.craft) this.launchStats = { craft: this.snap.craft, stats: computeStageStats(this.snap.craft, CATALOG, this.referenceUniverse().universe.body('earth')) };
    return this.launchStats.stats;
  }

  private uiFields(craft: CraftDef = this.snap?.craft ?? this.editor.craft) {
    if (this.gizmoUid !== null && !craft.parts.some(p => p.uid === this.gizmoUid)) this.gizmoUid = null;
    return { selectedUids: this.selectedUids, mode: this.mode, group: this.group, panels: this.panels,
      groupUids: craft.parts.filter(p => p.actions?.[this.group]?.length).map(p => p.uid),
      tool: this.tool, gizmoUid: this.gizmoUid, angleSnap: this.angleSnap, manualStaging: this.editor.manualStaging,
      dvBody: this.dvBody, dvBodies: this.referenceUniverse().bodies };
  }

  /** Lightweight update for UI-only fields (no craft recompute). */
  private touch() {
    this.version++;
    this.snap = {
      ...this.snap, ...this.uiFields(), name: this.name, held: this.held, linkStart: this.editor.linkStart, symmetry: this.symmetry, symmetryMode: this.symmetryMode,
      showCoM: this.showCoM, showCoT: this.showCoT, showCoL: this.showCoL,
      canUndo: this.editor.canUndo || this.held?.kind === 'new', canRedo: this.editor.canRedo,
      toasts: this.toasts, hoverUid: this.hoverUid, highlightUids: this.highlightUids, version: this.version,
    };
    this.listeners.forEach((l) => l());
  }

  /** Keep local hold state consistent with the core (undo/redo can create or remove a held assembly). */
  private syncHeld() {
    if (this.editor.linkStart) this.held = { kind: 'new', partId: this.editor.linkStart.partId, rotation: qIdentity() };
    const coreHeld = !!this.editor.held;
    if (coreHeld && this.held?.kind !== 'assembly') this.held = { kind: 'assembly', rotation: qIdentity() };
    if (!coreHeld && this.held?.kind === 'assembly') { this.held = null; this.restoreSymmetry(); }
  }

  /** Holding a set: show (and place with) its symmetry; the player's setting returns afterwards. */
  private adoptHeldSymmetry() {
    const sym = this.editor.held?.symmetry;
    this.savedSymmetry ??= { count: this.symmetry, mode: this.symmetryMode };
    this.symmetryMode = sym?.mode ?? 'radial';
    this.symmetry = (sym ? (sym.mode === 'mirror' ? 2 : sym.count) : 1) as SymmetryCount;
  }
  private restoreSymmetry() {
    if (!this.savedSymmetry) return;
    this.symmetry = this.savedSymmetry.count;
    this.symmetryMode = this.savedSymmetry.mode;
    this.savedSymmetry = null;
  }

  toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
    const id = ++this.toastId;
    this.toasts = [...this.toasts.slice(-3), { id, text, tone, ...(action ? { action } : {}) }];
    this.touch();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.touch();
    }, Math.max(action ? 6000 : 3200, text.length * 55));
  }
  dismissToast(id: number) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.touch();
  }

  private guard<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e), 'bad');
      return undefined;
    }
  }

  // ------------------------------------------------------------------ craft lifecycle
  load(craft: CraftDef, announce = true) {
    const ok = this.guard(() => {
      const editor = new CraftEditor(CATALOG, { ...craft, parts: craft.parts });
      this.editor = editor;
      this.attach(editor);
      return true;
    });
    if (!ok) return;
    this.name = craft.name || 'Untitled Craft';
    this.held = null;
    this.savedSymmetry = null;
    this.gizmoUid = null;
    this.applyTypeDefaults(this.editor.craft.type);
    this.loadCounter++;
    this.refresh();
    if (announce) this.toast(`Loaded "${this.name}"`, 'good');
  }

  newCraft() {
    this.load({ ...EMPTY, type: this.editor.craft.type }, false);
  }

  /** Toggle the building (and launch) mode: VAB → launch pad, SPH → runway. */
  setCraftType(type: CraftDef['type']) {
    if (this.held) this.cancelHeld();
    if (this.guard(() => (this.editor.setCraftType(type), true))) {
      this.applyTypeDefaults(type);
      this.loadCounter++; // re-frame the camera for the new orientation
      this.refresh();
    }
  }

  setName(name: string) {
    this.name = name;
    this.touch();
  }

  /** Craft with the current name applied (what gets saved / launched). */
  currentCraft(): CraftDef {
    return { ...this.editor.craft, name: this.name.trim() || 'Untitled Craft' };
  }

  async save() {
    const craft = this.currentCraft();
    if (!craft.parts.length) return this.toast('Nothing to save yet', 'warn');
    try {
      await saveCraft(craft);
      this.toast(`Saved "${craft.name}"`, 'good');
    } catch (e) {
      this.toast(saveErrorText(e), 'bad');
    }
  }

  listSaved(): Promise<CraftDef[]> {
    return listCrafts();
  }
  async deleteSaved(name: string) {
    await deleteCraft(name);
    this.touch();
  }

  launch() {
    if (this.held) this.cancelHeld();
    const craft = this.currentCraft();
    if (!craft.parts.length) return this.toast('Build something first!', 'warn');
    const hasCommand = craft.parts.some((p) => CATALOG.get(p.partId)?.modules.some((m) => m.type === 'command' && m.controllable !== false));
    if (!hasCommand) return this.toast('Launch blocked: the craft needs a command pod or probe core', 'bad');
    const g = game.get();
    const problem = launchProblem(craft, CATALOG, g.mode, g.resumeWorld?.progression ?? newProgression());
    if (problem) return this.toast(problem, 'bad');
    const stock = STOCK_CRAFTS.find(s => s.id === craft.stockId);
    const noticeKey = `${stock?.id}:${g.scalePreset}`;
    if (stock && stock.scale !== g.scalePreset && !this.scaleNotices.has(noticeKey)) {
      this.scaleNotices.add(noticeKey);
      return this.toast(`${stock.name} is designed for ${stock.scale} scale; this program uses ${g.scalePreset}. Its mission fuel budget may differ. Press Launch again to fly anyway.`, 'warn');
    }
    // Friendly pre-flight check for rockets: warn once when the first powered stage can't lift off.
    if (craft.type !== 'SPH' && performance.now() - this.launchWarnedAt > 8000) {
      const stats = [...this.launchStageStats().entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
      const first = stats.find((s) => s.twrAsl > 0 || s.dvVac > 0);
      const msg = !first ? 'No engines found: this craft will not leave the pad.' : first.twrAsl < 1 ? `First stage thrust-to-weight is ${first.twrAsl.toFixed(2)} (needs > 1 to lift off).` : '';
      if (msg) {
        this.launchWarnedAt = performance.now();
        return this.toast(`${msg} Press Launch again to fly anyway.`, 'warn');
      }
    }
    game.set({ craft, scene: 'flight', launchPending: true });
  }

  exit() {
    if (getTutorial()) return endTutorial();
    if (this.held) this.cancelHeld();
    const craft = this.currentCraft();
    game.set({ craft: craft.parts.length ? craft : null, scene: 'spaceCenter' });
  }

  // ------------------------------------------------------------------ held parts
  getHeld() {
    return this.held;
  }

  pickNew(partId: string) {
    const g = game.get();
    if (!partUnlocked(partId, g.mode, g.resumeWorld?.progression ?? newProgression())) return this.toast('Research this part first', 'warn');
    if (this.held?.kind === 'assembly') this.cancelHeld();
    this.editor.cancelLink();
    this.held = { kind: 'new', partId, rotation: qIdentity() };
    this.touch();
  }

  isLinkPlacement(): boolean {
    return this.held?.kind === 'new' && !!CATALOG.get(this.held.partId)?.modules.some(m => m.type === 'strut' || m.type === 'fuelLine');
  }
  placeLinkHit(hit: LinkHit): boolean {
    const held = this.held;
    if (held?.kind !== 'new' || !this.isLinkPlacement()) return false;
    const started = !!this.editor.linkStart;
    const ok = this.guard(() => {
      this.applySymmetry();
      if (started) this.editor.completeLink(hit); else this.editor.beginLink(held.partId, hit);
      return true;
    });
    if (ok && started) {
      this.held = null; this.touch();
      if (typeof document !== 'undefined') document.dispatchEvent(new Event('wsp:part-attach'));
    } else if (ok) this.toast(held.partId === 'fuel-line' ? 'Choose the receiving part · maximum 5 m' : 'Choose the second anchor · maximum 5 m');
    return !!ok;
  }

  pickUp(uid: number) {
    if (this.held) return;
    const part = this.editor.craft.parts.find(p => p.uid === uid);
    if (part?.link) {
      this.deletePart(uid); this.pickNew(part.partId); return;
    }
    // Core marks the change; syncHeld() converts it into an 'assembly' hold. A symmetric set comes up together.
    if (this.guard(() => this.editor.detachSubtree(uid, true))) { this.adoptHeldSymmetry(); this.touch(); }
  }

  /** Alt-click: hold a copy of the part's subtree (a symmetric source is placed as a set). */
  copyPart(uid: number) {
    if (this.held) return;
    const part = this.editor.craft.parts.find(p => p.uid === uid);
    if (!part) return;
    const g = game.get();
    const locked = this.editor.craft.parts.find(p => [...descendants(this.editor.craft.parts, uid)].includes(p.uid) && !partUnlocked(p.partId, g.mode, g.resumeWorld?.progression ?? newProgression()));
    if (locked) return this.toast('Research every part in the copy first', 'warn');
    if (this.guard(() => this.editor.copySubtree(uid))) { this.adoptHeldSymmetry(); this.touch(); }
  }

  /** Pick a saved subassembly from the drawer. */
  pickSubassembly(sub: Subassembly) {
    const g = game.get();
    if (sub.parts.some(p => !partUnlocked(p.partId, g.mode, g.resumeWorld?.progression ?? newProgression()))) return this.toast('This subassembly uses parts you have not researched', 'warn');
    if (this.held) this.cancelHeld();
    this.editor.cancelLink();
    if (this.guard(() => this.editor.holdAssembly(sub))) { this.adoptHeldSymmetry(); this.touch(); }
  }

  /** Merge another craft: it is held (root first, no stage numbers) for attaching to this one. */
  mergeCraft(craft: CraftDef) {
    const root = craft.parts.find(p => p.parent === undefined);
    if (!root) return this.toast('That vehicle is empty', 'warn');
    if (!this.editor.craft.parts.length) return this.load(craft);
    const parts = craft.parts.map(p => { const q = structuredClone(p); delete q.stage; return q; });
    this.pickSubassembly({ rootUid: root.uid, parts });
    if (this.editor.held) this.toast(`Attach "${craft.name}" to a node or surface · Esc cancels`, 'info');
  }

  /** A subassembly from the held assembly (preferred) or the selected/given part's subtree. */
  subassemblyFrom(uid?: number): Subassembly | null {
    const held = this.editor.held;
    if (held) {
      const root = held.parts.find(p => p.uid === held.rootUid)!;
      const parts = held.parts.map(p => {
        const q = structuredClone(p);
        q.position = qRotate(qConj(root.rotation), sub(p.position, root.position));
        q.rotation = qNormalize(qMul(qConj(root.rotation), p.rotation));
        delete q.stage;
        return q;
      });
      return { rootUid: held.rootUid, parts, ...(held.symmetry ? { symmetry: held.symmetry } : {}) };
    }
    const target = uid ?? this.selectedUids[0];
    if (target === undefined || !this.editor.craft.parts.some(p => p.uid === target)) return null;
    return this.editor.subassembly(target);
  }

  /** Esc: a new part is simply dropped; a picked-up assembly returns to where it came from. */
  cancelHeld() {
    if (!this.held) return;
    if (this.held.kind === 'new') {
      this.editor.cancelLink();
      this.held = null;
      this.touch();
      return;
    }
    // Undo back to before the detach (rotations are not pushed to the core until placement).
    // (Possibly several steps if the hold came from undoing a placement that included a rotation.)
    // Rolled back, not undone: a cancelled pick-up/copy must not leave a Redo entry.
    for (let i = 0; i < 8 && this.editor.held && this.editor.canUndo; i++) this.editor.rollback();
    if (this.editor.held) this.editor.discardHeld();
  }

  /** Delete key / drop on palette. */
  deleteHeld() {
    if (!this.held) return;
    if (this.held.kind === 'new') {
      this.editor.cancelLink();
      this.held = null;
      this.touch();
      return;
    }
    this.guard(() => this.editor.discardHeld());
  }

  /** Delete a part, its subtree and its symmetry set; `announce` offers an Undo (keyboard deletes). */
  deletePart(uid: number, announce = false) {
    const before = this.editor.craft;
    const part = before.parts.find(p => p.uid === uid);
    if (!part || !this.guard(() => (this.editor.deletePart(uid), true)) || !announce) return;
    const removed = before.parts.length - this.editor.craft.parts.length;
    const name = CATALOG.get(part.partId)?.name ?? 'part';
    this.toast(`Deleted ${name}${removed > 1 ? ` and ${removed - 1} attached part${removed > 2 ? 's' : ''}` : ''}`, 'info', {
      label: 'Undo', run: () => { if (!this.held && snapshotEqual(this.editor.craft, this.snap.craft)) this.editor.undo(); },
    });
  }

  // ------------------------------------------------------------------ build tools
  setTool(tool: EditorTool) {
    if (tool === this.tool) return;
    if (this.held && tool !== 'place') this.cancelHeld();
    this.tool = tool;
    if (tool === 'place' || tool === 'reroot') this.gizmoUid = null;
    else if (this.gizmoUid === null && this.selectedUids.length === 1) this.gizmoUid = this.selectedUids[0];
    this.touch();
  }
  /** Attach the offset/rotate gizmo to a part (null hides it). */
  setGizmo(uid: number | null) {
    if (uid === this.gizmoUid) return;
    this.gizmoUid = uid;
    if (uid !== null) this.selectedUids = [uid];
    this.touch();
  }
  toggleAngleSnap() { this.angleSnap = !this.angleSnap; this.touch(); }
  /** Commit a gizmo gesture (one undo step per `gesture`). */
  transformPart(uid: number, t: PartTransform, symmetric = true, gesture?: string) {
    this.guard(() => this.editor.transformPart(uid, t, symmetric, gesture));
  }
  reRoot(uid: number) {
    const part = this.editor.craft.parts.find(p => p.uid === uid);
    if (!part) return;
    if (part.parent === undefined) return this.toast('That part is already the root', 'info');
    if (this.guard(() => (this.editor.reRoot(uid), true))) {
      this.toast(`${CATALOG.get(part.partId)?.name ?? 'Part'} is now the root part`, 'good');
      this.loadCounter++;
      this.refresh();
    }
  }

  rotateHeld(axis: Vec3, angle: number) {
    if (!this.held) return;
    this.held = { ...this.held, rotation: qNormalize(qMul(qFromAxisAngle(axis, angle), this.held.rotation)) };
    this.touch();
  }

  resetHeldRotation() {
    if (!this.held) return;
    this.held = { ...this.held, rotation: qIdentity() };
    this.touch();
  }

  /**
   * Held parts in "held space": root at the origin, user rotation applied. Craft-frame placement is a
   * rigid transform of these.
   */
  heldParts(): PartInstance[] {
    const h = this.held;
    if (!h) return [];
    if (h.kind === 'new') return [{ uid: -1, partId: h.partId, position: v3(), rotation: h.rotation }];
    const core = this.editor.held;
    if (!core) return [];
    const root = core.parts.find((p) => p.uid === core.rootUid)!;
    return core.parts.map((p) => ({
      ...p,
      position: qRotate(h.rotation, sub(p.position, root.position)),
      rotation: qNormalize(qMul(h.rotation, p.rotation)),
    }));
  }

  heldRootUid(): number {
    return this.held?.kind === 'assembly' ? this.editor.held?.rootUid ?? -1 : -1;
  }

  place(p: Placement): boolean {
    const h = this.held;
    if (!h || this.isLinkPlacement()) return false;
    const ok = this.guard(() => {
      if (h.kind === 'new') {
        if (p.kind === 'root') this.editor.addRoot(h.partId);
        else if (p.kind === 'stack') {
          const parent = this.editor.craft.parts.find((x) => x.uid === p.parentUid);
          if (parent?.symmetryGroup !== undefined && this.symmetryMode === 'mirror') this.editor.setSymmetry({ mode: 'mirror' });
          else this.editor.setSymmetry({ mode: 'radial', count: parent?.symmetryGroup !== undefined ? this.symmetry : 1 });
          this.editor.attachPart(h.partId, p.parentUid, p.parentNode, p.childNode, h.rotation);
        } else {
          this.applySymmetry();
          this.editor.surfaceAttachAtHit(h.partId, p.parentUid, p.point, p.normal, p.rotation);
        }
        return true;
      }
      // Assembly picked up from the craft: push the accumulated rotation into the core first.
      const rotated = Math.abs(h.rotation.w) < 1 - 1e-9;
      if (p.kind === 'surface') {
        this.applySymmetry();
        this.editor.surfaceAttachHeld(p.parentUid, p.point, p.normal, p.rotation);
      } else {
        if (rotated) this.editor.rotateHeld(h.rotation);
        if (p.kind === 'root') this.editor.placeHeldAsRoot();
        else {
          const parent = this.editor.craft.parts.find((x) => x.uid === p.parentUid);
          if (parent?.symmetryGroup !== undefined && this.symmetryMode === 'mirror') this.editor.setSymmetry({ mode: 'mirror' });
          else this.editor.setSymmetry({ mode: 'radial', count: 1 });
          this.editor.attachHeld(p.parentUid, p.parentNode, p.childNode, p.childUid);
        }
      }
      return true;
    });
    if (ok && h.kind === 'new') {
      // Keep holding the same part when Shift is held? Simpler: KSP drops it. Clear the hold.
      this.held = null;
      this.touch();
    }
    if (ok && typeof document !== 'undefined') document.dispatchEvent(new Event('wsp:part-attach'));
    return !!ok;
  }

  /** Push the session's symmetry setting into the core for a new surface attachment. */
  private applySymmetry() {
    if (this.symmetryMode === 'mirror') {
      if (this.symmetry > 1) this.editor.setSymmetry({ mode: 'mirror' });
      else this.editor.setSymmetry({ mode: 'radial', count: 1 });
    } else this.editor.setSymmetry({ mode: 'radial', count: this.symmetry });
  }

  // ------------------------------------------------------------------ misc UI state
  /** X: radial mode cycles 1..8 copies; mirror mode toggles mirroring on/off. */
  cycleSymmetry(dir = 1) {
    if (this.symmetryMode === 'mirror') this.symmetry = this.symmetry > 1 ? 1 : 2;
    else {
      const i = SYMMETRY_STEPS.indexOf(this.symmetry);
      this.symmetry = SYMMETRY_STEPS[(i + dir + SYMMETRY_STEPS.length) % SYMMETRY_STEPS.length];
    }
    this.touch();
  }
  /** R: switch between radial and mirror symmetry. */
  toggleSymmetryMode() {
    this.symmetryMode = this.symmetryMode === 'radial' ? 'mirror' : 'radial';
    this.symmetry = this.symmetryMode === 'mirror' ? 2 : 1;
    this.touch();
  }
  getSymmetry() {
    return this.symmetry;
  }
  /** Number of copies a new surface attachment would get (including the original). */
  symmetryCopies() {
    return this.symmetryMode === 'mirror' ? (this.symmetry > 1 ? 2 : 1) : this.symmetry;
  }
  toggleCoM() { this.showCoM = !this.showCoM; this.touch(); }
  toggleCoT() { this.showCoT = !this.showCoT; this.touch(); }
  toggleCoL() { this.showCoL = !this.showCoL; this.touch(); }
  setHover(uid: number | null) {
    if (uid === this.hoverUid) return;
    this.hoverUid = uid;
    this.touch();
  }
  setHighlight(uids: number[]) {
    this.highlightUids = uids;
    this.touch();
  }

  undo() {
    if (this.editor.linkStart) {
      this.held = null; this.editor.undo(); this.touch(); return;
    }
    if (this.held?.kind === 'new') {
      this.editor.cancelLink();
      this.held = null;
      this.touch();
      return;
    }
    if (this.held?.kind === 'assembly') return this.cancelHeld();
    // Picking up/copying and placing is one action: never stop in a holding state.
    this.editor.undo();
    for (let i = 0; i < 8 && this.editor.held && this.editor.canUndo; i++) this.editor.undo();
  }
  redo() {
    if (this.held?.kind === 'new') { this.held = null; this.touch(); }
    if (this.held?.kind === 'assembly') return;
    this.editor.redo();
    for (let i = 0; i < 8 && this.editor.held && this.editor.canRedo; i++) this.editor.redo();
  }

  // ------------------------------------------------------------------ selection, inspector panels, part settings
  select(uids: number[], toggle = false) {
    const same = uids.length === this.selectedUids.length && uids.every(u => this.selectedUids.includes(u));
    this.selectedUids = toggle && same ? [] : [...uids];
    this.touch();
  }
  /** Open an inspector for a part (replacing the unpinned one) and select it. */
  openPanel(uid: number) {
    if (!this.editor.craft.parts.some(p => p.uid === uid)) return;
    this.panels = [...this.panels.filter(p => p.pinned && p.uid !== uid), { uid, pinned: this.panels.find(p => p.uid === uid)?.pinned ?? false }];
    this.selectedUids = [uid];
    this.touch();
  }
  closePanel(uid: number) {
    this.panels = this.panels.filter(p => p.uid !== uid);
    if (this.selectedUids.length === 1 && this.selectedUids[0] === uid) this.selectedUids = [];
    this.touch();
  }
  /** Esc: close the newest panel. Returns false when none was open. */
  closeTopPanel(): boolean {
    const top = this.panels.at(-1);
    if (!top) return false;
    this.closePanel(top.uid);
    return true;
  }
  togglePin(uid: number) {
    this.panels = this.panels.map(p => p.uid === uid ? { ...p, pinned: !p.pinned } : p);
    this.touch();
  }
  setMode(mode: EditorMode) {
    if (mode === this.mode) return;
    if (this.held) this.cancelHeld();
    this.mode = mode;
    this.touch();
  }
  setGroup(group: ActionGroupId) {
    this.group = group;
    this.touch();
  }
  setPartTweaks(uid: number, tweaks: PartTweaks) { this.guard(() => this.editor.setPartTweaks(uid, tweaks)); }
  setPartResources(uid: number, resources: Partial<Record<ResourceId, number>>) { this.guard(() => this.editor.setPartResources(uid, resources)); }
  /** Add or remove one action of a part in the current (or given) group, mirrored across symmetry. */
  toggleGroupAction(uid: number, action: PartActionId, group: ActionGroupId = this.group) {
    const part = this.editor.craft.parts.find(p => p.uid === uid);
    if (!part) return;
    const list = part.actions?.[group] ?? [];
    this.guard(() => this.editor.setPartActions(uid, group, list.includes(action) ? list.filter(a => a !== action) : [...list, action]));
  }
  clearGroup(group: ActionGroupId) { this.guard(() => this.editor.clearGroup(group)); }

  // Staging
  moveToStage(uid: number, index: number) { this.guard(() => this.editor.moveToStage(uid, index)); }
  moveStage(from: number, to: number) { this.guard(() => this.editor.moveStage(from, to)); }
  insertStage(index: number) { this.guard(() => this.editor.insertStage(index)); }
  removeEmptyStages() { this.guard(() => this.editor.removeEmptyStages()); }
  autoStage() { this.guard(() => this.editor.autoStage()); }

  dispose() {
    this.unsub();
    this.listeners.clear();
  }
}


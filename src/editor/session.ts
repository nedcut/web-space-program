import { getTutorial, endTutorial } from '../tutorial/runtime';
import { partUnlocked, launchProblem } from '../data/technology';
import { newProgression } from '../sim/science/progression';
import { PART_CATALOG } from '../data/parts';
import { RESOURCES } from '../data/resources';
import { game } from '../game/store';
import { deleteCraft, listCrafts, saveCraft } from '../game/saves';
import type { CraftDef, PartInstance, ResourceId } from '../sim/vessel/types';
import { qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../util/quat';
import { sub, v3, type Vec3 } from '../util/vec3';
import { CraftEditor, craftStats, getStageList, type CraftStats, type Stage } from './core';
import { computeStageStats, type StageStats } from './ui/dv';

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

export interface Toast { id: number; text: string; tone: 'info' | 'warn' | 'bad' | 'good' }

export interface SessionView {
  craft: CraftDef;
  name: string;
  stages: Stage[];
  stageStats: Map<number, StageStats>;
  stats: CraftStats;
  totalDvVac: number;
  totalDvAsl: number;
  held: HeldState | null;
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
  private name: string;
  private launchWarnedAt = -Infinity;
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
    const craft = this.editor.craft;
    const stats = craftStats(craft, CATALOG, DENSITIES);
    const stages = getStageList(craft);
    const stageStats = computeStageStats(craft, CATALOG);
    let totalDvVac = 0, totalDvAsl = 0;
    for (const s of stageStats.values()) { totalDvVac += s.dvVac; totalDvAsl += s.dvAsl; }
    this.version++;
    this.snap = {
      craft, name: this.name, stages, stageStats, stats, totalDvVac, totalDvAsl,
      held: this.held, symmetry: this.symmetry, symmetryMode: this.symmetryMode, craftType: craft.type,
      showCoM: this.showCoM, showCoT: this.showCoT, showCoL: this.showCoL,
      canUndo: this.editor.canUndo || this.held?.kind === 'new', canRedo: this.editor.canRedo,
      toasts: this.toasts, hoverUid: this.hoverUid, highlightUids: this.highlightUids, version: this.version,
    };
    this.listeners.forEach((l) => l());
  }

  /** Lightweight update for UI-only fields (no craft recompute). */
  private touch() {
    this.version++;
    this.snap = {
      ...this.snap, name: this.name, held: this.held, symmetry: this.symmetry, symmetryMode: this.symmetryMode,
      showCoM: this.showCoM, showCoT: this.showCoT, showCoL: this.showCoL,
      canUndo: this.editor.canUndo || this.held?.kind === 'new', canRedo: this.editor.canRedo,
      toasts: this.toasts, hoverUid: this.hoverUid, highlightUids: this.highlightUids, version: this.version,
    };
    this.listeners.forEach((l) => l());
  }

  /** Keep local hold state consistent with the core (undo/redo can create or remove a held assembly). */
  private syncHeld() {
    const coreHeld = !!this.editor.held;
    if (coreHeld && this.held?.kind !== 'assembly') this.held = { kind: 'assembly', rotation: qIdentity() };
    if (!coreHeld && this.held?.kind === 'assembly') this.held = null;
  }

  toast(text: string, tone: Toast['tone'] = 'info') {
    const id = ++this.toastId;
    this.toasts = [...this.toasts.slice(-3), { id, text, tone }];
    this.touch();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.touch();
    }, Math.max(3200, text.length * 55));
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

  save() {
    const craft = this.currentCraft();
    if (!craft.parts.length) return this.toast('Nothing to save yet', 'warn');
    try {
      saveCraft(craft);
      this.toast(`Saved "${craft.name}"`, 'good');
    } catch {
      this.toast('Could not save (storage unavailable)', 'bad');
    }
  }

  listSaved(): CraftDef[] {
    return listCrafts();
  }
  deleteSaved(name: string) {
    deleteCraft(name);
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
    // Friendly pre-flight check for rockets: warn once when the first powered stage can't lift off.
    if (craft.type !== 'SPH' && performance.now() - this.launchWarnedAt > 8000) {
      const stats = [...this.snap.stageStats.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
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
    this.held = { kind: 'new', partId, rotation: qIdentity() };
    this.touch();
  }

  pickUp(uid: number) {
    if (this.held) return;
    // Core marks the change; syncHeld() converts it into an 'assembly' hold.
    this.guard(() => this.editor.detachSubtree(uid));
  }

  /** Esc: a new part is simply dropped; a picked-up assembly returns to where it came from. */
  cancelHeld() {
    if (!this.held) return;
    if (this.held.kind === 'new') {
      this.held = null;
      this.touch();
      return;
    }
    // Undo back to before the detach (rotations are not pushed to the core until placement).
    // (Possibly several steps if the hold came from undoing a placement that included a rotation.)
    for (let i = 0; i < 8 && this.editor.held && this.editor.canUndo; i++) this.editor.undo();
    if (this.editor.held) this.editor.discardHeld();
  }

  /** Delete key / drop on palette. */
  deleteHeld() {
    if (!this.held) return;
    if (this.held.kind === 'new') {
      this.held = null;
      this.touch();
      return;
    }
    this.guard(() => this.editor.discardHeld());
  }

  deletePart(uid: number) {
    this.guard(() => this.editor.deletePart(uid));
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
    if (!h) return false;
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
        this.editor.surfaceAttachHeld(p.parentUid, p.point, p.normal, p.rotation);
      } else {
        if (rotated) this.editor.rotateHeld(h.rotation);
        if (p.kind === 'root') this.editor.placeHeldAsRoot();
        else this.editor.attachHeld(p.parentUid, p.parentNode, p.childNode, p.childUid);
      }
      return true;
    });
    if (ok && h.kind === 'new') {
      // Keep holding the same part when Shift is held? Simpler: KSP drops it. Clear the hold.
      this.held = null;
      this.touch();
    }
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
    if (this.held?.kind === 'new') {
      this.held = null;
      this.touch();
      return;
    }
    if (this.held?.kind === 'assembly') return this.cancelHeld();
    this.editor.undo();
  }
  redo() {
    if (this.held?.kind === 'new') { this.held = null; this.touch(); }
    this.editor.redo();
  }

  // Staging
  moveToStage(uid: number, index: number) { this.guard(() => this.editor.moveToStage(uid, index)); }
  insertStage(index: number) { this.guard(() => this.editor.insertStage(index)); }
  removeEmptyStages() { this.guard(() => this.editor.removeEmptyStages()); }
  autoStage() { this.guard(() => this.editor.autoStage()); }

  dispose() {
    this.unsub();
    this.listeners.clear();
  }
}


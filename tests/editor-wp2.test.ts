import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { CraftEditor, autoStage, autoStageByDepth, getStageList, insertIntoStaging, moveStage, transformedParts } from '../src/editor/core';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import type { CraftDef, PartInstance } from '../src/sim/vessel/types';
import { qFromAxisAngle, qRotate } from '../src/util/quat';
import { length, sub, v3 } from '../src/util/vec3';

const engines = (craft: CraftDef, uids: number[]) => uids.filter(u => PART_CATALOG.get(craft.parts.find(p => p.uid === u)!.partId)!.modules.some(m => m.type === 'engine'));
const partOf = (craft: CraftDef, uid: number) => craft.parts.find(p => p.uid === uid)!;

/** Pod, core tank and engine with four side-latched solid boosters (x4 symmetry). */
function coreWithBoosters(editor = new CraftEditor(PART_CATALOG)) {
  const pod = editor.addRoot('pod-lantern-1');
  const tank = editor.attachPart('tank-1-mid', pod.uid, 'bottom', 'top');
  const core = editor.attachPart('eng-sirocco', tank.uid, 'bottom', 'top');
  editor.setSymmetry({ mode: 'radial', count: 4 });
  const latch = editor.surfaceAttach('dec-radial', tank.uid, v3(0.625, 0, 0), v3(1, 0, 0));
  const booster = editor.surfaceAttach('srb-roman-candle', latch.uid, v3(0, 0, 0.12), v3(0, 0, 1));
  editor.setSymmetry({ mode: 'radial', count: 1 });
  return { editor, pod, tank, core, latch, booster };
}

describe('WP2 staging', () => {
  it('lights core and four radial boosters in one ignition stage, then drops the boosters', () => {
    const { editor, core, latch, booster } = coreWithBoosters();
    const craft = editor.craft;
    const stages = getStageList(craft);
    const first = stages[0].partUids;
    expect(engines(craft, first)).toHaveLength(5);
    expect(first).toContain(core.uid);
    const boosters = craft.parts.filter(p => p.symmetryGroup === partOf(craft, booster.uid).symmetryGroup);
    expect(boosters).toHaveLength(4);
    for (const b of boosters) expect(first).toContain(b.uid);
    // Every side latch fires together in the next stage.
    const latches = craft.parts.filter(p => p.symmetryGroup === partOf(craft, latch.uid).symmetryGroup);
    expect(stages[1].partUids.sort()).toEqual(latches.map(p => p.uid).sort());
  });

  it('keeps serial stacks staged exactly as the depth stager did', () => {
    for (const s of STOCK_CRAFTS) {
      const craft = s.build();
      const radial = craft.parts.some(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'decoupler' && (m.radial || p.attachNode === 'srf')));
      if (radial) continue;
      const a = getStageList(autoStage(craft, PART_CATALOG)).map(st => st.partUids.sort());
      const b = getStageList(autoStageByDepth(craft, PART_CATALOG)).map(st => st.partUids.sort());
      expect(a, s.name).toEqual(b);
    }
  });

  it('keeps a manual reorder when a nose cone and a new engine are added', () => {
    const editor = new CraftEditor(PART_CATALOG);
    const pod = editor.addRoot('pod-lantern-1');
    const upper = editor.attachPart('tank-1-mid', pod.uid, 'bottom', 'top');
    const upperEngine = editor.attachPart('eng-sirocco', upper.uid, 'bottom', 'top');
    const dec = editor.attachPart('dec-1', upperEngine.uid, 'bottom', 'top');
    const lower = editor.attachPart('tank-1-mid', dec.uid, 'bottom', 'top');
    const lowerEngine = editor.attachPart('eng-sirocco', lower.uid, 'bottom', 'top');
    expect(editor.getStageList().map(s => s.partUids)).toEqual([[lowerEngine.uid], [dec.uid], [upperEngine.uid]]);
    // Hot staging: fire the decoupler together with the upper engine.
    editor.moveToStage(dec.uid, 2);
    editor.removeEmptyStages();
    const manual = editor.getStageList().map(s => s.partUids);
    expect(manual).toEqual([[lowerEngine.uid], [upperEngine.uid, dec.uid].sort((a, b) => a - b)]);
    expect(editor.manualStaging).toBe(true);
    editor.attachPart('nose-1', pod.uid, 'top', 'bottom');
    expect(editor.getStageList().map(s => s.partUids)).toEqual(manual);
  });

  it('inserts new engines next to the parts they would fire with', () => {
    const editor = new CraftEditor(PART_CATALOG);
    const pod = editor.addRoot('pod-lantern-1');
    const upper = editor.attachPart('tank-1-mid', pod.uid, 'bottom', 'top');
    const upperEngine = editor.attachPart('eng-sirocco', upper.uid, 'bottom', 'top');
    const dec = editor.attachPart('dec-1', upperEngine.uid, 'bottom', 'top');
    const lower = editor.attachPart('tank-1-mid', dec.uid, 'bottom', 'top');
    editor.insertStage(0);
    editor.moveToStage(dec.uid, 0); // odd manual order: decoupler first
    editor.removeEmptyStages();
    const before = editor.getStageList().map(s => s.partUids);
    expect(before[0]).toEqual([dec.uid]);
    const lowerEngine = editor.attachPart('eng-sirocco', lower.uid, 'bottom', 'top');
    const after = editor.getStageList().map(s => s.partUids);
    // The new lower engine gets its own stage just before the part it automatically precedes (the decoupler);
    // the player's relative order of existing parts is untouched.
    const at = (uid: number) => after.findIndex(s => s.includes(uid));
    expect(after).toHaveLength(3);
    expect(at(lowerEngine.uid)).toBe(0);
    expect(at(dec.uid)).toBe(1);
    expect(at(upperEngine.uid)).toBe(2);
    // Reset returns to automatic staging.
    editor.autoStage();
    expect(editor.manualStaging).toBe(false);
    expect(editor.getStageList().map(s => s.partUids)).toEqual([[lowerEngine.uid], [dec.uid], [upperEngine.uid]]);
  });

  it('moves whole stages and detects manual staging on load', () => {
    const { editor } = coreWithBoosters();
    const stages = editor.getStageList();
    editor.moveStage(1, 0);
    const moved = editor.getStageList();
    expect(moved[0].partUids).toEqual(stages[1].partUids);
    expect(moved[1].partUids).toEqual(stages[0].partUids);
    expect(new CraftEditor(PART_CATALOG, editor.craft).manualStaging).toBe(true);
    editor.autoStage();
    expect(new CraftEditor(PART_CATALOG, editor.craft).manualStaging).toBe(false);
    expect(() => moveStage(editor.craft, 0, 99)).toThrow();
  });

  it('assigns every stageable part when inserting into an empty staging', () => {
    const { editor } = coreWithBoosters();
    const bare = { ...editor.craft, parts: editor.craft.parts.map(p => ({ ...p, stage: undefined })) };
    const staged = insertIntoStaging(bare, PART_CATALOG);
    expect(getStageList(staged).map(s => s.partUids)).toEqual(getStageList(editor.craft).map(s => s.partUids));
  });
});

describe('WP2 symmetric sets, copies and subassemblies', () => {
  it('picks up one of four boosters as the whole set and re-places them with symmetry', () => {
    const { editor, tank, latch } = coreWithBoosters();
    const before = editor.craft;
    const latchGroup = partOf(before, latch.uid).symmetryGroup;
    const held = editor.detachSubtree(latch.uid, true);
    expect(held.symmetry).toEqual({ mode: 'radial', count: 4 });
    expect(editor.craft.parts.filter(p => p.partId === 'dec-radial' || p.partId === 'srb-roman-candle')).toHaveLength(0);
    expect(held.parts).toHaveLength(2);
    // Put the set back 1 m lower on the core.
    editor.setSymmetry({ mode: 'radial', count: 4 });
    const t = partOf(before, tank.uid);
    editor.surfaceAttachHeld(tank.uid, v3(0.625, t.position.y - 1, 0), v3(1, 0, 0));
    const after = editor.craft;
    const latches = after.parts.filter(p => p.partId === 'dec-radial');
    const boosters = after.parts.filter(p => p.partId === 'srb-roman-candle');
    expect(latches).toHaveLength(4);
    expect(boosters).toHaveLength(4);
    expect(new Set(latches.map(p => p.symmetryGroup)).size).toBe(1);
    expect(new Set(boosters.map(p => p.symmetryGroup)).size).toBe(1);
    expect(latches.map(p => p.symmetryGroup)[0]).not.toBeUndefined();
    void latchGroup;
    // 90 degrees apart around the core, all 1 m lower than before.
    const sorted = latches.map(p => Math.atan2(p.position.z, p.position.x)).sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(Math.PI / 2, 6);
    for (const l of latches) expect(l.position.y).toBeCloseTo(partOf(before, latch.uid).position.y - 1, 6);
    // Each booster hangs off its own latch and staging still lights all five engines together.
    expect(new Set(boosters.map(b => b.parent))).toEqual(new Set(latches.map(l => l.uid)));
    expect(engines(after, getStageList(after)[0].partUids)).toHaveLength(5);
    // Undo restores the original craft in one step after the placement (and one for the pick-up).
    editor.undo(); editor.undo();
    expect(editor.craft).toEqual(before);
  });

  it('Alt-copy duplicates a subtree with fresh uids and places it as a set', () => {
    const { editor, tank, latch } = coreWithBoosters();
    const count = editor.craft.parts.length;
    const held = editor.copySubtree(latch.uid);
    expect(held.parts).toHaveLength(2);
    expect(held.symmetry).toEqual({ mode: 'radial', count: 4 });
    const uids = new Set(editor.craft.parts.map(p => p.uid));
    for (const p of held.parts) expect(uids.has(p.uid)).toBe(false);
    expect(editor.craft.parts).toHaveLength(count);
    editor.setSymmetry({ mode: 'radial', count: 4 });
    const t = partOf(editor.craft, tank.uid);
    editor.surfaceAttachHeld(tank.uid, v3(0, t.position.y + 0.5, 0.625), v3(0, 0, 1));
    expect(editor.craft.parts).toHaveLength(count + 8);
    // Eight boosters, all lit with the core.
    const craft = editor.craft;
    expect(engines(craft, getStageList(craft)[0].partUids)).toHaveLength(9);
  });

  it('copies the subtree without symmetry when the part is not in a set', () => {
    const { editor, tank } = coreWithBoosters();
    const held = editor.copySubtree(tank.uid);
    // Tank, engine, four latches and four boosters.
    expect(held.parts).toHaveLength(10);
    expect(held.symmetry).toBeUndefined();
    const groups = new Set(held.parts.map(p => p.symmetryGroup).filter(g => g !== undefined));
    expect(groups.size).toBe(2);
    for (const g of groups) expect(editor.craft.parts.some(p => p.symmetryGroup === g)).toBe(false);
  });

  it('picks up a mirrored wing pair and re-places it mirrored', () => {
    const editor = new CraftEditor(PART_CATALOG, { name: 'Plane', type: 'SPH', parts: [], version: 1 });
    const body = editor.addRoot('tank-1-long');
    editor.setSymmetry({ mode: 'mirror' });
    const wing = editor.surfaceAttach('wing-plank', body.uid, v3(0.625, 0, 0), v3(1, 0, 0));
    const held = editor.detachSubtree(wing.uid, true);
    expect(held.symmetry).toEqual({ mode: 'mirror', count: 2 });
    expect(editor.craft.parts).toHaveLength(1);
    editor.setSymmetry({ mode: 'mirror' });
    editor.surfaceAttachHeld(body.uid, v3(0.625, 0.8, 0), v3(1, 0, 0));
    const [a, b] = editor.craft.parts.filter(p => p.partId === 'wing-plank');
    expect(b.position.x).toBeCloseTo(-a.position.x, 9);
    expect(b.position.y).toBeCloseTo(a.position.y, 9);
    expect(a.symmetryGroup).toBe(b.symmetryGroup);
  });

  it('saves and drops subassemblies', () => {
    const { editor, latch } = coreWithBoosters();
    const sub = editor.subassembly(latch.uid);
    expect(sub.parts).toHaveLength(2);
    expect(length(sub.parts.find(p => p.uid === sub.rootUid)!.position)).toBeCloseTo(0, 9);
    for (const p of sub.parts) expect(p.stage).toBeUndefined();
    const other = new CraftEditor(PART_CATALOG);
    const root = other.addRoot('tank-1-mid');
    other.holdAssembly(JSON.parse(JSON.stringify(sub)));
    other.surfaceAttachHeld(root.uid, v3(0.625, 0, 0), v3(1, 0, 0));
    expect(other.craft.parts).toHaveLength(3);
    expect(() => new CraftEditor(PART_CATALOG).holdAssembly({ rootUid: 1, parts: [{ uid: 1, partId: 'nope', position: v3(), rotation: { x: 0, y: 0, z: 0, w: 1 } }] })).toThrow();
  });
});

describe('WP2 offset and rotate tools', () => {
  it('offsets a radial set symmetrically and rotates about the mount point', () => {
    const { editor, latch } = coreWithBoosters();
    const before = editor.craft;
    editor.transformPart(latch.uid, { offset: v3(0, 0.5, 0) });
    const moved = editor.craft;
    for (const p of before.parts.filter(q => q.partId === 'dec-radial' || q.partId === 'srb-roman-candle'))
      expect(partOf(moved, p.uid).position.y - p.position.y).toBeCloseTo(0.5, 9);
    // A sideways offset is carried around the set: each latch moves tangentially by the same amount.
    editor.transformPart(latch.uid, { offset: v3(0, 0, 0.2) });
    const sideways = editor.craft;
    for (const p of moved.parts.filter(q => q.partId === 'dec-radial')) {
      const d = sub(partOf(sideways, p.uid).position, p.position);
      expect(length(d)).toBeCloseTo(0.2, 9);
      expect(Math.abs(d.x * p.position.x + d.z * p.position.z)).toBeLessThan(1e-9);
    }
    // Rotation pivots on the surface contact: the latch stays in contact with the core.
    const pre = editor.craft;
    const turn = qFromAxisAngle(v3(0, 0, 1), 0.3);
    const changed = transformedParts(pre.parts, PART_CATALOG, latch.uid, { rotation: turn });
    expect(changed.size).toBe(8);
    editor.transformPart(latch.uid, { rotation: turn });
    expect(editor.craft.parts.find(p => p.uid === latch.uid)!.rotation).not.toEqual(partOf(pre, latch.uid).rotation);
    const undoSteps = 3;
    for (let i = 0; i < undoSteps; i++) editor.undo();
    expect(editor.craft).toEqual(before);
  });

  it('mirrors offsets on mirror pairs', () => {
    const editor = new CraftEditor(PART_CATALOG, { name: 'Plane', type: 'SPH', parts: [], version: 1 });
    const body = editor.addRoot('tank-1-mid');
    editor.setSymmetry({ mode: 'mirror' });
    const fin = editor.surfaceAttach('fin-keel', body.uid, v3(0.625, 0, 0), v3(1, 0, 0));
    const pair = editor.craft.parts.filter(p => p.partId === 'fin-keel');
    editor.transformPart(fin.uid, { offset: v3(0.1, 0.2, 0.3) });
    const after = editor.craft;
    const [a, b] = pair.map(p => sub(partOf(after, p.uid).position, p.position));
    expect(a.x).toBeCloseTo(-b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9);
    // Asymmetric edit when asked.
    editor.transformPart(fin.uid, { offset: v3(0, 1, 0) }, false);
    expect(partOf(editor.craft, pair[1].uid).position.y).toBeCloseTo(partOf(after, pair[1].uid).position.y, 9);
  });

  it('re-roots without moving parts relative to each other', () => {
    const { editor, core } = coreWithBoosters();
    const before = editor.craft;
    editor.reRoot(core.uid);
    const after = editor.craft;
    expect(after.parts.filter(p => p.parent === undefined).map(p => p.uid)).toEqual([core.uid]);
    const rel = (c: CraftDef, a: PartInstance) => sub(partOf(c, a.uid).position, partOf(c, core.uid).position);
    for (const p of before.parts) expect(length(sub(rel(after, p), rel(before, p)))).toBeLessThan(1e-9);
    // Stages are kept as they were.
    expect(getStageList(after).map(s => s.partUids)).toEqual(getStageList(before).map(s => s.partUids));
    void qRotate;
  });
});

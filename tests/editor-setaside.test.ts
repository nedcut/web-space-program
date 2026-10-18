import { describe, expect, it } from 'vitest';
import type { PartDef, PartModule } from '../src/sim/vessel/types';
import { qFromAxisAngle } from '../src/util/quat';
import { v3, type Vec3 } from '../src/util/vec3';
import { CraftEditor, freeAttachNodes, getStageList } from '../src/editor/core';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { preflightChecks } from '../src/editor/checks';

const engine: PartModule = { type: 'engine', maxThrustVac: 100, ispVac: 300, ispAsl: 250, propellants: { liquidFuel: 1 }, minThrottle: 0, throttleable: true, gimbalRange: 0, thrustDirection: v3(0, 1, 0), spoolTime: 0, plume: 'kerolox', ignitions: -1 };
function def(id: string, modules: PartModule[] = [], half = 1): PartDef {
  return { id, name: id, manufacturer: 'Fixture', description: '', category: 'structural', dryMass: 10, cost: 1,
    resources: {}, attachNodes: [
      { id: 'top', position: v3(0, half, 0), direction: v3(0, 1, 0), size: 1 },
      { id: 'bottom', position: v3(0, -half, 0), direction: v3(0, -1, 0), size: 1 },
    ], surfaceAttachable: true, allowSurfaceAttachChildren: true,
    shape: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 2 * half },
    dragCoefficient: { axial: 0.2, side: 0.5 }, maxTemp: 1000, crashTolerance: 10, modules, mesh: 'fixture' };
}
function catalog(): Map<string, PartDef> {
  return new Map([
    ['pod', def('pod', [{ type: 'command', crew: 1, sasLevel: 1, ecPerSecond: 0 }])],
    ['tank', { ...def('tank'), resources: { liquidFuel: 100 } }],
    ['short', def('short', [], 0.25)],
    ['engine', def('engine', [engine])],
    ['decoupler', def('decoupler', [{ type: 'decoupler', ejectionImpulse: 10, node: 'bottom' }])],
    ['fin', def('fin')],
  ]);
}
const close = (a: Vec3, b: Vec3) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9); };
function rocket() {
  const editor = new CraftEditor(catalog());
  let p = editor.addRoot('pod'); const uids = [p.uid];
  for (const id of ['tank', 'engine', 'decoupler', 'tank', 'engine']) { p = editor.attachPart(id, p.uid, 'bottom', 'top'); uids.push(p.uid); }
  return { editor, uids };
}
const y = (ed: CraftEditor, uid: number) => ed.craft.parts.find(p => p.uid === uid)!.position.y;

describe('set-aside (detached) assemblies', () => {
  it('parks the held assembly beside the craft, out of staging and stats, and picks it up again', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[4]);
    const parked = ed.parkHeld(v3(8, -3, 0), qFromAxisAngle(v3(0, 0, 1), 0.3));
    expect(ed.held).toBeUndefined();
    expect(ed.detached).toHaveLength(1);
    close(parked.parts.find(p => p.uid === uids[4])!.position, v3(8, -3, 0));
    expect(parked.parts.every(p => p.stage === undefined)).toBe(true);
    // The craft is re-staged without the parked engine: no empty first stage left behind.
    expect(ed.craft.parts.map(p => p.uid)).toEqual(uids.slice(0, 4));
    expect(getStageList(ed.craft).every(s => s.partUids.length > 0)).toBe(true);
    // New parts never reuse a parked uid.
    const added = ed.attachPart('tank', uids[3], 'bottom', 'top');
    expect(parked.parts.some(p => p.uid === added.uid)).toBe(false);
    ed.undo();
    // Pick it up by its engine and put it back on the decoupler.
    const held = ed.pickUpDetached(0, uids[5]);
    expect(held.rootUid).toBe(uids[5]);
    expect(ed.detached).toHaveLength(0);
    ed.attachHeld(uids[3], 'bottom', 'top', uids[4]);
    expect(ed.craft.parts).toHaveLength(6);
    expect(ed.craft.parts.find(p => p.uid === uids[5])!.parent).toBe(uids[4]);
    close(ed.craft.parts.find(p => p.uid === uids[4])!.position, v3(0, -8, 0));
  });
  it('undo and redo cover parking, picking up and discarding', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[4]); ed.parkHeld(v3(6, 0, 0));
    ed.pickUpDetached(0); ed.parkHeld(v3(-6, 0, 0));
    ed.discardDetached(0);
    expect(ed.detached).toHaveLength(0);
    ed.undo(); expect(ed.detached[0].parts[0].position.x).toBeCloseTo(-6);
    ed.undo(); expect(ed.held).toBeDefined(); expect(ed.detached).toHaveLength(0);
    ed.undo(); expect(ed.detached[0].parts[0].position.x).toBeCloseTo(6);
    ed.redo(); ed.redo(); ed.redo(); expect(ed.detached).toHaveLength(0);
  });
  it('preflight on the remaining craft does not report a missing first-stage engine (Gossamer case)', () => {
    const craft = STOCK_CRAFTS.find(s => s.id === 'stock-gossamer')!.build();
    const ed = new CraftEditor(PART_CATALOG, craft);
    const lower = ed.craft.parts.find(p => p.partId === 'tank-2-long')!;
    ed.detachSubtree(lower.uid, true);
    ed.parkHeld(v3(10, -20, 0));
    const ids = preflightChecks(ed.craft, PART_CATALOG).map(c => c.id);
    expect(ids).not.toContain('first-engine');
    expect(getStageList(ed.craft)[0].partUids.length).toBeGreaterThan(0);
    expect(ed.detached[0].parts.some(p => p.partId === 'eng-chinook')).toBe(true);
  });
});

describe('insert between (splice)', () => {
  it('splices a new part into an occupied joint and pushes the parts beyond it', () => {
    const { editor: ed, uids } = rocket();
    const before = y(ed, uids[5]);
    const tank = ed.insertPart('short', { parentUid: uids[1], parentNodeId: 'bottom', childNodeId: 'top', throughNodeId: 'bottom' });
    expect(tank.parent).toBe(uids[1]);
    expect(ed.craft.parts.find(p => p.uid === uids[2])!.parent).toBe(tank.uid);
    expect(ed.craft.parts.find(p => p.uid === uids[2])!.parentNode).toBe('bottom');
    expect(y(ed, uids[5])).toBeCloseTo(before - 0.5, 9);
    close(tank.position, v3(0, -3.25, 0));
    ed.undo();
    expect(y(ed, uids[5])).toBeCloseTo(before, 9);
    expect(ed.craft.parts).toHaveLength(6);
    ed.redo(); expect(ed.craft.parts).toHaveLength(7);
  });
  it('splices a held assembly using its far node, and a parked one picked back up', () => {
    const { editor: ed, uids } = rocket();
    const t = ed.attachPart('tank', uids[0], 'top', 'bottom');
    ed.detachSubtree(t.uid);
    ed.parkHeld(v3(5, 0, 0));
    ed.pickUpDetached(0);
    ed.spliceHeld({ parentUid: uids[3], parentNodeId: 'bottom', childUid: t.uid, childNodeId: 'top', throughUid: t.uid, throughNodeId: 'bottom' });
    expect(ed.craft.parts.find(p => p.uid === uids[4])!.parent).toBe(t.uid);
    expect(y(ed, uids[5])).toBeCloseTo(-12, 9);
    expect(freeAttachNodes(ed.craft, ed.catalog).map(n => `${n.uid}:${n.id}`).sort()).toEqual([`${uids[0]}:top`, `${uids[5]}:bottom`].sort());
  });
  it('splices every counterpart of a symmetric parent', () => {
    const ed = new CraftEditor(catalog());
    const root = ed.addRoot('tank');
    ed.setSymmetry({ mode: 'radial', count: 3 });
    const pod = ed.surfaceAttachAtHit('fin', root.uid, v3(0.5, 0, 0), v3(1, 0, 0));
    ed.setSymmetry({ mode: 'radial', count: 1 });
    ed.attachPart('engine', pod.uid, 'bottom', 'top');
    const engines = ed.craft.parts.filter(p => p.partId === 'engine');
    expect(engines).toHaveLength(3);
    ed.insertPart('short', { parentUid: pod.uid, parentNodeId: 'bottom', childNodeId: 'top', throughNodeId: 'bottom' });
    const shorts = ed.craft.parts.filter(p => p.partId === 'short');
    expect(shorts).toHaveLength(3);
    for (const e of ed.craft.parts.filter(p => p.partId === 'engine')) expect(shorts.map(s => s.uid)).toContain(e.parent);
  });
  it('refuses to splice into a free joint', () => {
    const { editor: ed, uids } = rocket();
    const before = ed.craft;
    expect(() => ed.insertPart('short', { parentUid: uids[5], parentNodeId: 'bottom', childNodeId: 'top', throughNodeId: 'bottom' })).toThrow('free');
    expect(ed.craft).toEqual(before);
  });
});

describe('pick up just one part', () => {
  it('takes a middle part and closes the gap', () => {
    const { editor: ed, uids } = rocket();
    expect(ed.canDetachPart(uids[0])).toBe(false);
    expect(ed.canDetachPart(uids[2])).toBe(true);
    const held = ed.detachPart(uids[2]);
    expect(held.parts.map(p => p.uid)).toEqual([uids[2]]);
    const decoupler = ed.craft.parts.find(p => p.uid === uids[3])!;
    expect(decoupler.parent).toBe(uids[1]);
    expect(decoupler.position.y).toBeCloseTo(-4, 9);
    expect(y(ed, uids[5])).toBeCloseTo(-8, 9);
    ed.discardHeld();
    ed.undo(); ed.undo();
    expect(ed.craft.parts).toHaveLength(6);
    expect(y(ed, uids[5])).toBeCloseTo(-10, 9);
  });
});

describe('editing set-aside pieces', () => {
  it('takes a part and what hangs from it off a piece, leaving the rest set aside', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[3]); ed.parkHeld(v3(8, 0, 0));
    const held = ed.takeFromDetached(0, uids[4]);
    expect(held.rootUid).toBe(uids[4]);
    expect(held.parts.map(p => p.uid).sort()).toEqual([uids[4], uids[5]].sort());
    expect(held.parts.find(p => p.uid === uids[4])!.parent).toBeUndefined();
    expect(ed.detached).toHaveLength(1);
    expect(ed.detached[0].parts.map(p => p.uid)).toEqual([uids[3]]);
    close(ed.detached[0].parts[0].position, v3(8, 0, 0));
    ed.undo();
    expect(ed.held).toBeUndefined();
    expect(ed.detached[0].parts).toHaveLength(3);
    // The piece's root takes the whole piece.
    ed.takeFromDetached(0, uids[3]);
    expect(ed.held!.parts).toHaveLength(3);
    expect(ed.detached).toHaveLength(0);
  });
  it('swaps a piece onto the stand and back, keeping the craft\'s manual staging', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[4]); ed.parkHeld(v3(8, -3, 0));
    ed.moveStage(0, 1);
    expect(ed.manualStaging).toBe(true);
    const craft = ed.craft;
    ed.swapDetached(0, v3(-10, 0, 0));
    expect(ed.craft.parts.map(p => p.uid).sort()).toEqual([uids[4], uids[5]].sort());
    close(ed.craft.parts.find(p => p.uid === uids[4])!.position, v3(0, 0, 0));
    expect(ed.manualStaging).toBe(false);
    expect(ed.detached[0].parts.find(p => p.uid === uids[0])!.position.x).toBeCloseTo(-10);
    expect(ed.detached[0].craft).toEqual({ manualStaging: true });
    // The piece on the stand edits like any craft.
    ed.attachPart('fin', uids[4], 'top', 'bottom');
    ed.swapDetached(0, v3(10, 0, 0));
    expect(ed.craft).toEqual(craft);
    expect(ed.manualStaging).toBe(true);
    expect(ed.detached[0].parts).toHaveLength(3);
    close(ed.detached[0].parts.find(p => p.uid === uids[4])!.position, v3(10, 0, 0));
    ed.undo();
    expect(ed.craft.parts).toHaveLength(3);
  });
  it('only the craft carries the craft mark: swapping back clears it, picking the craft up keeps it', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[4]); ed.parkHeld(v3(8, -3, 0));
    ed.swapDetached(0, v3(-10, 0, 0));
    // Pick the parked craft up whole and set it down elsewhere: still the craft.
    expect(ed.takeFromDetached(0, uids[0]).craft).toBeDefined();
    ed.parkHeld(v3(-12, 0, 0));
    expect(ed.detached[0].craft).toBeDefined();
    ed.swapDetached(0, v3(10, 0, 0));
    expect(ed.craft.parts.some(p => p.uid === uids[0])).toBe(true);
    expect(ed.detached.some(p => p.craft)).toBe(false);
  });
  it('a set-aside piece takes the stand when the craft is empty', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[0]); ed.parkHeld(v3(5, 0, 0));
    ed.swapDetached(0, v3(0, 0, 0));
    expect(ed.craft.parts).toHaveLength(6);
    expect(ed.detached).toHaveLength(0);
  });
});

describe('attaching to and tweaking set-aside pieces in place', () => {
  /** A rocket with its lower half (decoupler, tank, engine) set aside at x = 8. */
  function parked() {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[3]); ed.parkHeld(v3(8, 0, 0));
    return { ed, uids, craft: ed.craft };
  }
  it('stack-attaches a new part to a piece: the craft and its stages are untouched, the piece stays unstaged', () => {
    const { ed, uids, craft } = parked();
    const free = freeAttachNodes(ed.detached[0], catalog());
    expect(free.some(n => n.uid === uids[5] && n.id === 'bottom')).toBe(true);
    const added = ed.attachPart('tank', uids[5], 'bottom', 'top');
    expect(ed.craft).toEqual(craft);
    const piece = ed.detached[0];
    expect(piece.parts.map(p => p.uid)).toContain(added.uid);
    expect(piece.parts.every(p => p.stage === undefined)).toBe(true);
    const tank = piece.parts.find(p => p.uid === added.uid)!;
    expect(tank.parent).toBe(uids[5]);
    close(tank.position, v3(8, -6, 0));
    // One undo removes it.
    ed.undo();
    expect(ed.detached[0].parts).toHaveLength(3);
  });
  it('surface-attaches with radial symmetry onto a piece, and new uids stay unique across the hall', () => {
    const { ed, uids, craft } = parked();
    ed.setSymmetry({ mode: 'radial', count: 4 });
    const tankPos = ed.detached[0].parts.find(p => p.uid === uids[4])!.position;
    ed.surfaceAttachAtHit('fin', uids[4], v3(tankPos.x + 0.5, tankPos.y, tankPos.z), v3(1, 0, 0));
    expect(ed.craft).toEqual(craft);
    const fins = ed.detached[0].parts.filter(p => p.partId === 'fin');
    expect(fins).toHaveLength(4);
    expect(new Set(fins.map(p => p.symmetryGroup)).size).toBe(1);
    const all = [...ed.craft.parts, ...ed.detached[0].parts].map(p => p.uid);
    expect(new Set(all).size).toBe(all.length);
    // Copies circle the piece's tank, not the craft's axis.
    for (const f of fins) expect(Math.hypot(f.position.x - tankPos.x, f.position.z - tankPos.z)).toBeGreaterThan(0.4);
  });
  it('attaches a held assembly to a piece and inserts a part into a piece\'s joint', () => {
    const { ed, uids, craft } = parked();
    ed.detachSubtree(uids[2]);
    ed.attachHeld(uids[5], 'bottom', 'top', uids[2]);
    expect(ed.held).toBeUndefined();
    expect(ed.craft.parts.map(p => p.uid)).toEqual(craft.parts.filter(p => p.uid !== uids[2]).map(p => p.uid));
    expect(ed.detached[0].parts.find(p => p.uid === uids[2])!.parent).toBe(uids[5]);
    const below = ed.detached[0].parts.find(p => p.uid === uids[2])!.position.y;
    const short = ed.insertPart('short', { parentUid: uids[4], parentNodeId: 'bottom', childNodeId: 'top', throughNodeId: 'bottom' });
    const piece = ed.detached[0];
    expect(piece.parts.find(p => p.uid === uids[5])!.parent).toBe(short.uid);
    // Everything below the joint moved down by the short part's length (0.5 m).
    expect(piece.parts.find(p => p.uid === uids[2])!.position.y).toBeCloseTo(below - 0.5, 9);
    expect(piece.parts.every(p => p.stage === undefined)).toBe(true);
  });
  it('changes settings and resources of a piece\'s part without touching the craft', () => {
    const { ed, uids, craft } = parked();
    ed.setPartResources(uids[4], { liquidFuel: 25 });
    expect(ed.detached[0].parts.find(p => p.uid === uids[4])!.resources).toEqual({ liquidFuel: 25 });
    ed.setPartActions(uids[5], 'custom1', ['engine.toggle']);
    expect(ed.detached[0].parts.find(p => p.uid === uids[5])!.actions).toEqual({ custom1: ['engine.toggle'] });
    expect(ed.craft).toEqual(craft);
    ed.undo();
    ed.undo();
    expect(ed.detached[0].parts.find(p => p.uid === uids[4])!.resources).toBeUndefined();
  });
  it('the craft picked up whole and attached to a piece hands the piece the craft mark', () => {
    const { ed, uids } = parked();
    ed.detachSubtree(uids[2]); ed.parkHeld(v3(-8, 0, 0)); // a second piece: the engine
    ed.swapDetached(0, v3(-10, 0, 0)); // the craft (pod, tank) is set aside, marked
    ed.takeFromDetached(0, uids[0]);
    expect(ed.held!.craft).toBeDefined();
    ed.attachHeld(uids[2], 'top', 'bottom', uids[1]);
    expect(ed.detached).toHaveLength(1);
    expect(ed.detached[0].craft).toBeDefined();
    expect(ed.detached[0].parts.map(p => p.uid).sort()).toEqual([uids[0], uids[1], uids[2]].sort());
    // Swapping it back puts the whole craft on the stand.
    ed.swapDetached(0, v3(10, 0, 0));
    expect(ed.craft.parts.some(p => p.uid === uids[0])).toBe(true);
    expect(ed.detached.some(p => p.craft)).toBe(false);
  });
});

describe('deleting from set-aside pieces', () => {
  it('deletes a part and what hangs from it, or the whole piece', () => {
    const { editor: ed, uids } = rocket();
    ed.detachSubtree(uids[3]); ed.parkHeld(v3(8, 0, 0));
    ed.discardDetached(0, uids[5]);
    expect(ed.detached[0].parts.map(p => p.uid)).toEqual([uids[3], uids[4]]);
    ed.discardDetached(0);
    expect(ed.detached).toHaveLength(0);
    ed.undo(); ed.undo();
    expect(ed.detached[0].parts).toHaveLength(3);
  });
});

describe('session: swap back while holding a piece', () => {
  it('swaps the craft back, not the piece the cancelled hold returned to the list', async () => {
    const { EditorSession } = await import('../src/editor/session');
    const session = new EditorSession(STOCK_CRAFTS.find(s => s.id === 'stock-kestrel')!.build());
    const craftRoot = session.getSnapshot().craft.parts.find(p => p.parent === undefined)!.uid;
    const leaf = () => session.getSnapshot().craft.parts.find(p => p.parent !== undefined && !session.getSnapshot().craft.parts.some(q => q.parent === p.uid))!;
    // Two pieces set aside: A, then B.
    session.pickUp(leaf().uid); session.place({ kind: 'park', position: v3(6, 0, 0) });
    session.pickUp(leaf().uid); session.place({ kind: 'park', position: v3(-6, 0, 0) });
    session.swapDetached(1); // edit B; the craft takes index 1
    expect(session.getSnapshot().detached[1].craft).toBeDefined();
    session.takeFromDetached(0, session.getSnapshot().detached[0].rootUid); // hold A
    void session.save(); // refused while the craft is set aside; offers Swap back
    const toast = session.getSnapshot().toasts.find(t => t.action?.label === 'Swap back')!;
    toast.action!.run();
    expect(session.getSnapshot().craft.parts.some(p => p.uid === craftRoot)).toBe(true);
    expect(session.getSnapshot().detached.some(p => p.craft)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { CraftDef, PartDef, PartModule } from '../src/sim/vessel/types';
import { qFromAxisAngle, qIdentity, qRotate } from '../src/util/quat';
import { distance, sub, v3, type Vec3 } from '../src/util/vec3';
import { CraftEditor, autoStage, craftStats, deserializeCraft, findBestSnap, freeAttachNodes, getStageList, insertStage, mirrorPosition, mirrorRotation, moveToStage, removeEmptyStages, serializeCraft, snapAngle, snapRotation, surfacePlacement, validateCraft } from '../src/editor/core';

const engine: PartModule = { type: 'engine', maxThrustVac: 100, ispVac: 300, ispAsl: 250, propellants: { liquidFuel: 1 }, minThrottle: 0, throttleable: true, gimbalRange: 0, thrustDirection: v3(0, 1, 0), spoolTime: 0, plume: 'kerolox', ignitions: -1 };
function def(id: string, modules: PartModule[] = []): PartDef {
  return { id, name: id, manufacturer: 'Fixture', description: '', category: 'structural', dryMass: 10, cost: 1,
    resources: {}, attachNodes: [
      { id: 'top', position: v3(0, 1, 0), direction: v3(0, 1, 0), size: 1 },
      { id: 'bottom', position: v3(0, -1, 0), direction: v3(0, -1, 0), size: 1 },
    ], surfaceAttachable: true, allowSurfaceAttachChildren: true,
    shape: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 2 },
    dragCoefficient: { axial: 0.2, side: 0.5 }, maxTemp: 1000, crashTolerance: 10, modules, mesh: 'fixture' };
}
function catalog(): Map<string, PartDef> {
  return new Map([
    ['pod', def('pod', [{ type: 'command', crew: 1, sasLevel: 1, ecPerSecond: 0 }])],
    ['tank', { ...def('tank'), resources: { liquidFuel: 100 } }],
    ['engine', def('engine', [engine])],
    ['decoupler', def('decoupler', [{ type: 'decoupler', ejectionImpulse: 10, node: 'bottom' }])],
    ['chute', def('chute', [{ type: 'parachute', deployedCdA: 10, semiCdA: 1, minPressure: 1, deployAltitude: 1000, maxQ: 10000 }])],
    ['wing', def('wing', [{ type: 'liftingSurface', area: 5, liftSlope: 6, deflection: 0, ctrlFraction: 0 }])],
    ['fairing', def('fairing', [{ type: 'fairing', ejectionImpulse: 10 }])],
  ]);
}
function close(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 9); expect(actual.y).toBeCloseTo(expected.y, 9); expect(actual.z).toBeCloseTo(expected.z, 9);
}
function rocket(): { editor: CraftEditor; uids: number[] } {
  const editor = new CraftEditor(catalog());
  let p = editor.addRoot('pod'); const uids = [p.uid];
  for (const id of ['tank', 'engine', 'decoupler', 'tank', 'engine']) {
    p = editor.attachPart(id, p.uid, 'bottom', 'top'); uids.push(p.uid);
  }
  return { editor, uids };
}

describe('node assembly and held transforms', () => {
  it('coincides nodes, opposes directions and preserves preferred roll', () => {
    const ed = new CraftEditor(catalog()); const root = ed.addRoot('pod');
    const roll = qFromAxisAngle(v3(0, 1, 0), Math.PI / 2);
    const part = ed.attachPart('tank', root.uid, 'bottom', 'top', roll);
    close(part.position, v3(0, -2, 0));
    close(qRotate(part.rotation, v3(1, 0, 0)), v3(0, 0, -1));
    expect(freeAttachNodes(ed.craft, ed.catalog).map(n => `${n.uid}:${n.id}`)).toEqual([`${root.uid}:top`, `${part.uid}:bottom`]);
    const before = ed.craft;
    expect(() => ed.attachPart('tank', root.uid, 'bottom', 'top')).toThrow('Occupied');
    expect(ed.craft).toEqual(before);
  });
  it('moves, rotates and reattaches subtrees with a rigid relative transform', () => {
    const { editor: ed, uids } = rocket();
    const held = ed.detachSubtree(uids[3]);
    expect(held.parts).toHaveLength(3); expect(ed.craft.parts).toHaveLength(3);
    const relative = sub(held.parts[2].position, held.parts[0].position);
    ed.moveHeld(v3(4, 3, 2));
    const turn = qFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    ed.rotateHeld(turn);
    close(sub(ed.held!.parts[2].position, ed.held!.parts[0].position), qRotate(turn, relative));
    const attached = ed.attachHeld(uids[0], 'top', 'top');
    expect(ed.held).toBeUndefined(); expect(ed.craft.parts).toHaveLength(6);
    close(attached.position, v3(0, 2, 0));
    close(sub(ed.craft.parts.find(p => p.uid === uids[5])!.position, attached.position), v3(0, 4, 0));
    expect(deserializeCraft(serializeCraft(ed.craft), ed.catalog)).toEqual(ed.craft);
  });
  it('allows snapping at a free node on a held descendant and reverses its tree', () => {
    const { editor: ed, uids } = rocket(); ed.detachSubtree(uids[3]);
    ed.attachHeld(uids[0], 'top', 'bottom', uids[5]);
    expect(ed.craft.parts.find(p => p.uid === uids[5])!.parent).toBe(uids[0]);
    expect(ed.craft.parts.find(p => p.uid === uids[4])!.parent).toBe(uids[5]);
    expect(ed.craft.parts.find(p => p.uid === uids[3])!.parent).toBe(uids[4]);
    expect(() => deserializeCraft(serializeCraft(ed.craft), ed.catalog)).not.toThrow();
  });
  it('reroots the craft while preserving physical relative positions and node metadata', () => {
    const { editor: ed, uids } = rocket(); const original = ed.craft;
    ed.reRoot(uids[4]); const updated = ed.craft;
    close(updated.parts.find(p => p.uid === uids[4])!.position, v3());
    for (let i = 1; i < updated.parts.length; i++) close(sub(updated.parts[i].position, updated.parts[0].position), sub(original.parts[i].position, original.parts[0].position));
    expect(updated.parts.filter(p => p.parent === undefined).map(p => p.uid)).toEqual([uids[4]]);
    expect(() => deserializeCraft(serializeCraft(updated), ed.catalog)).not.toThrow();
  });
  it('can pick up the entire craft and place it as root again', () => {
    const { editor: ed, uids } = rocket(); ed.detachSubtree(uids[0]);
    expect(ed.craft.parts).toEqual([]); ed.moveHeld(v3(20, 0, 0)); ed.placeHeldAsRoot();
    close(ed.craft.parts[0].position, v3()); expect(ed.craft.parts).toHaveLength(6);
  });
});

describe('snapping and surface placement', () => {
  it('selects candidates within world radius and aligns transformed nodes', () => {
    const ed = new CraftEditor(catalog()); const root = ed.addRoot('pod');
    const tank = ed.attachPart('tank', root.uid, 'bottom', 'top'); ed.detachSubtree(tank.uid); ed.moveHeld(v3(0.1, 0, 0));
    expect(findBestSnap(ed.held!, ed.craft, ed.catalog, 0.05)).toBeUndefined();
    const snap = findBestSnap(ed.held!, ed.craft, ed.catalog, 0.2)!;
    expect(snap.parent.id).toBe('bottom'); expect(snap.child.id).toBe('top');
    close(qRotate(snap.transform.rotation, snap.child.direction), v3(0, 1, 0));
    ed.attachHeldAtSnap(snap); close(ed.craft.parts[1].position, v3(0, -2, 0));
  });
  it('prefers matching size then opposed direction over proximity', () => {
    const defs = catalog(); const pod = defs.get('pod')!;
    pod.attachNodes = [
      { id: 'small', size: 0, position: v3(), direction: v3(-1, 0, 0) },
      { id: 'same', size: 1, position: v3(0.2, 0, 0), direction: v3(1, 0, 0) },
      { id: 'opposed', size: 1, position: v3(0.3, 0, 0), direction: v3(-1, 0, 0) },
    ];
    defs.get('tank')!.attachNodes = [{ id: 'node', size: 1, position: v3(), direction: v3(1, 0, 0) }];
    const ed = new CraftEditor(defs); ed.addRoot('pod');
    const held = { rootUid: 2, parts: [{ uid: 2, partId: 'tank', position: v3(), rotation: qIdentity() }] };
    expect(findBestSnap(held, ed.craft, defs, 1)!.parent.id).toBe('opposed');
  });
  it('anchors local -X extent to the supplied hit and aligns inward', () => {
    const d = catalog().get('tank')!; const point = v3(2, 3, 4), normal = v3(0, 0, 1);
    const placement = surfacePlacement(d, point, normal, qIdentity());
    close(sub(placement.position, qRotate(placement.rotation, v3(0.5, 0, 0))), point);
    close(qRotate(placement.rotation, v3(-1, 0, 0)), v3(0, 0, -1));
    const box = { ...d, shape: { kind: 'box' as const, size: v3(4, 2, 2) } };
    close(surfacePlacement(box, v3(), v3(1, 0, 0), qIdentity()).position, v3(2, 0, 0));
    expect(() => surfacePlacement(d, point, v3(), qIdentity())).toThrow();
  });
  it('reattaches a held surface assembly without changing descendant spacing', () => {
    const { editor: ed, uids } = rocket(); ed.detachSubtree(uids[4]);
    const root = ed.surfaceAttachHeld(uids[0], v3(1, 0, 0), v3(1, 0, 0));
    close(root.position, v3(1.5, 0, 0));
    expect(distance(ed.craft.parts.find(p => p.uid === uids[5])!.position, root.position)).toBeCloseTo(2);
  });
  it('snaps angles/quaternions by 15 degrees and mirrors craft YZ', () => {
    expect(snapAngle(16 * Math.PI / 180)).toBeCloseTo(Math.PI / 12);
    expect(snapAngle(-29 * Math.PI / 180)).toBeCloseTo(-Math.PI / 6);
    const snapped = snapRotation(qFromAxisAngle(v3(0, 1, 0), 16 * Math.PI / 180));
    close(qRotate(snapped, v3(1, 0, 0)), v3(Math.cos(Math.PI / 12), 0, -Math.sin(Math.PI / 12)));
    const r = qFromAxisAngle(v3(1, 2, 3), 0.7), p = v3(2, 4, 6);
    close(qRotate(mirrorRotation(r), mirrorPosition(p)), mirrorPosition(qRotate(r, p)));
  });
});

describe('symmetry and history', () => {
  it('adds x4 surface copies 90 degrees apart, then edits the group', () => {
    const ed = new CraftEditor(catalog()); const root = ed.addRoot('pod'); ed.setSymmetry({ mode: 'radial', count: 4 });
    const first = ed.surfaceAttach('engine', root.uid, v3(0.5, 0, 0), v3(1, 0, 0));
    const copies = ed.craft.parts.filter(p => p.symmetryGroup === first.symmetryGroup);
    expect(copies).toHaveLength(4);
    copies.forEach((p, i) => close(p.position, qRotate(qFromAxisAngle(v3(0, 1, 0), i * Math.PI / 2), v3(1, 0, 0))));
    ed.moveToStage(first.uid, 2);
    const stage = ed.getStageList().find(s => s.index === 2)!; expect(stage.partUids).toHaveLength(4);
    ed.deletePart(first.uid); expect(ed.craft.parts).toHaveLength(1);
    ed.undo(); expect(ed.craft.parts).toHaveLength(5);
  });
  it('attaches copies to symmetric parent counterparts', () => {
    const ed = new CraftEditor(catalog()); const root = ed.addRoot('pod'); ed.setSymmetry({ mode: 'radial', count: 4 });
    const tank = ed.surfaceAttach('tank', root.uid, v3(0.5, 0, 0), v3(1, 0, 0));
    ed.attachPart('engine', tank.uid, 'bottom', 'top');
    const engines = ed.craft.parts.filter(p => p.partId === 'engine');
    expect(engines).toHaveLength(4); expect(new Set(engines.map(p => p.parent)).size).toBe(4);
    expect(() => deserializeCraft(serializeCraft(ed.craft), ed.catalog)).not.toThrow();
    ed.deletePart(tank.uid); expect(ed.craft.parts).toHaveLength(1);
  });
  it('mirrors surface copies across craft YZ including rotations', () => {
    const ed = new CraftEditor(catalog(), { name: 'Plane', type: 'SPH', parts: [], version: 1 }); const root = ed.addRoot('pod'); ed.setSymmetry({ mode: 'mirror' });
    ed.surfaceAttach('wing', root.uid, v3(0.5, 0, 0.25), v3(1, 0, 0));
    const [a, b] = ed.craft.parts.slice(1);
    close(b.position, mirrorPosition(a.position));
    close(sub(b.position, qRotate(b.rotation, v3(0.5, 0, 0))), mirrorPosition(sub(a.position, qRotate(a.rotation, v3(0.5, 0, 0)))));
    close(qRotate(b.rotation, v3(-1, 0, 0)), v3(1, 0, 0));
  });
  it('mirrors descendant surface contacts on symmetric parents', () => {
    const ed = new CraftEditor(catalog(), { name: 'Plane', type: 'SPH', parts: [], version: 1 });
    const root = ed.addRoot('pod'); ed.setSymmetry({ mode: 'mirror' });
    const parent = ed.surfaceAttach('tank', root.uid, v3(0.5, 0, 0.25), v3(1, 0, 0));
    ed.surfaceAttach('wing', parent.uid, v3(0.5, 0, 0.3), v3(1, 0, 0));
    const [a, b] = ed.craft.parts.filter(p => p.partId === 'wing');
    expect(a.parent).not.toBe(b.parent);
    close(b.position, mirrorPosition(a.position));
    close(sub(b.position, qRotate(b.rotation, v3(0.5, 0, 0))), mirrorPosition(sub(a.position, qRotate(a.rotation, v3(0.5, 0, 0)))));
  });
  it('supports all requested radial counts and rotates about an off-origin parent', () => {
    for (const count of [1, 2, 3, 4, 6, 8] as const) {
      const ed = new CraftEditor(catalog()); const root = ed.addRoot('pod');
      const parent = ed.attachPart('tank', root.uid, 'bottom', 'top');
      ed.setSymmetry({ mode: 'radial', count }); ed.surfaceAttach('wing', parent.uid, v3(0.5, 0, 0), v3(1, 0, 0));
      const wings = ed.craft.parts.filter(p => p.partId === 'wing'); expect(wings).toHaveLength(count);
      wings.forEach((p, i) => {
        expect(p.position.y).toBeCloseTo(-2);
        close(sub(p.position, parent.position), qRotate(qFromAxisAngle(v3(0, 1, 0), i * 2 * Math.PI / count), v3(1, 0, 0)));
      });
    }
  });
  it('undoes/redoes held transforms, emits independent events and supports 50+ steps', () => {
    const ed = new CraftEditor(catalog(), undefined, 50); const events: number[] = [];
    const stop = ed.onChange(snapshot => { events.push(snapshot.craft.parts.length); snapshot.craft.parts = []; });
    const root = ed.addRoot('pod'); const tank = ed.attachPart('tank', root.uid, 'bottom', 'top');
    ed.detachSubtree(tank.uid); ed.moveHeld(v3(3, 0, 0)); ed.undo(); close(ed.held!.parts[0].position, v3(0, -2, 0));
    ed.redo(); close(ed.held!.parts[0].position, v3(3, -2, 0));
    ed.undo(); ed.undo(); expect(ed.held).toBeUndefined(); expect(ed.craft.parts).toHaveLength(2);
    ed.redo(); expect(ed.held).toBeDefined();
    ed.moveHeld(v3(1, 0, 0)); expect(ed.canRedo).toBe(false);
    for (let i = 0; i < 55; i++) ed.moveHeld(v3(1, 0, 0));
    for (let i = 0; i < 50; i++) expect(ed.undo()).toBe(true);
    expect(ed.undo()).toBe(false); stop(); expect(events.length).toBeGreaterThan(50);
    const snapshot = ed.craft; snapshot.parts = []; expect(ed.craft.parts).toHaveLength(1);
  });
});

describe('staging', () => {
  it('stages lower engine, separation and upper engine in that order', () => {
    const { editor: ed, uids } = rocket(); const stages = getStageList(autoStage(ed.craft, ed.catalog));
    expect(stages).toEqual([
      { index: 0, stage: 2, partUids: [uids[5]] },
      { index: 1, stage: 1, partUids: [uids[3]] },
      { index: 2, stage: 0, partUids: [uids[2]] },
    ]);
    const craft = autoStage(ed.craft, ed.catalog);
    expect(craft.parts.find(p => p.uid === uids[5])!.stage).toBeGreaterThan(craft.parts.find(p => p.uid === uids[2])!.stage!);
  });
  it('handles multiple boundaries, chutes last and fairings', () => {
    const { editor: ed, uids } = rocket(); ed.attachPart('chute', uids[0], 'top', 'bottom');
    const dec = ed.attachPart('decoupler', uids[5], 'bottom', 'top');
    const tank = ed.attachPart('tank', dec.uid, 'bottom', 'top'); const bottom = ed.attachPart('engine', tank.uid, 'bottom', 'top');
    expect(ed.getStageList().map(s => s.partUids)).toEqual([[bottom.uid], [dec.uid], [uids[5]], [uids[3]], [uids[2]], [7]]);
    ed.surfaceAttach('fairing', uids[0], v3(0.5, 0, 0), v3(1, 0, 0));
    expect(ed.craft.parts.find(p => p.partId === 'fairing')!.stage).toBe(ed.craft.parts.find(p => p.uid === uids[2])!.stage);
  });
  it('stages radial boosters before their parent-edge decouplers', () => {
    const defs = catalog(); defs.get('decoupler')!.modules = [{ type: 'decoupler', ejectionImpulse: 10, node: 'srf', radial: true }];
    const ed = new CraftEditor(defs); const pod = ed.addRoot('pod');
    const tank = ed.attachPart('tank', pod.uid, 'bottom', 'top'); const core = ed.attachPart('engine', tank.uid, 'bottom', 'top');
    const dec = ed.surfaceAttach('decoupler', tank.uid, v3(0.5, 0, 0), v3(1, 0, 0));
    const boosterTank = ed.attachPart('tank', dec.uid, 'bottom', 'top'); const booster = ed.attachPart('engine', boosterTank.uid, 'bottom', 'top');
    expect(ed.getStageList().map(s => s.partUids)).toEqual([[booster.uid], [dec.uid], [core.uid]]);
  });
  it('retains inserted empty stages at either end and compacts them explicitly', () => {
    const { editor: ed, uids } = rocket();
    ed.insertStage(0); expect(ed.getStageList()[0].partUids).toEqual([]);
    expect(ed.getStageList()[1].partUids).toEqual([uids[5]]);
    ed.insertStage(ed.getStageList().length); expect(ed.getStageList().at(-1)!.partUids).toEqual([]);
    expect(deserializeCraft(serializeCraft(ed.craft))).toEqual(ed.craft);
    ed.removeEmptyStages(); expect(ed.getStageList()).toHaveLength(3);
    const before = ed.craft; expect(() => insertStage(before, 100)).toThrow();
    expect(() => moveToStage(before, 100, 0)).toThrow();
    expect(getStageList(removeEmptyStages(moveToStage(before, uids[5], 5))).length).toBe(3);
  });
});

describe('stats, validation and saves', () => {
  it('computes dry/resource mass, bounds and weighted centres', () => {
    const { editor: ed } = rocket(); const stats = craftStats(ed.craft, ed.catalog, { liquidFuel: 2 });
    expect(stats.totalMass).toBe(460); expect(stats.partCount).toBe(6);
    expect(stats.height).toBe(12); expect(stats.width).toBe(1); expect(stats.depth).toBe(1);
    close(stats.centreOfMass, v3(0, -5, 0)); close(stats.centreOfThrust!, v3(0, -7, 0)); expect(stats.centreOfLift).toBeUndefined();
    const craft = ed.craft; craft.parts[1].resources = { liquidFuel: 0 };
    expect(craftStats(craft, ed.catalog, new Map([['liquidFuel', 2]])).totalMass).toBe(260);
    expect(() => craftStats(craft, ed.catalog, {})).toThrow('density');
    ed.surfaceAttach('wing', craft.parts[0].uid, v3(0.5, 0, 0), v3(1, 0, 0));
    close(craftStats(ed.craft, ed.catalog, { liquidFuel: 2 }).centreOfLift!, v3(1, 0, 0));
  });
  it('reports absent command, fuel, chutes and positive-volume overlaps', () => {
    const ed = new CraftEditor(catalog()); ed.addRoot('engine');
    expect(validateCraft(ed.craft, ed.catalog).map(w => w.code)).toEqual(['no-command', 'no-parachute', 'no-fuel']);
    const { editor: rocketEditor } = rocket();
    expect(validateCraft(rocketEditor.craft, rocketEditor.catalog).map(w => w.code)).toEqual(['no-parachute']);
    const overlapped = rocketEditor.craft; overlapped.parts[1].position = v3();
    expect(validateCraft(overlapped, rocketEditor.catalog).some(w => w.code === 'overlap')).toBe(true);
    const solid = catalog(); solid.get('engine')!.resources = { liquidFuel: 1 };
    expect(validateCraft(ed.craft, solid).some(w => w.code === 'no-fuel')).toBe(false);
  });
  it('roundtrips versioned craft and rejects malformed trees/transforms/resources', () => {
    const { editor: ed } = rocket(); const saved = serializeCraft(ed.craft);
    expect(deserializeCraft(saved, ed.catalog)).toEqual(ed.craft);
    const mutations: ((craft: CraftDef) => void)[] = [
      c => { c.version = 2 as 1; }, c => { c.parts[1].uid = c.parts[0].uid; },
      c => { c.parts[1].parent = 999; }, c => { c.parts[0].parent = c.parts[1].uid; },
      c => { c.parts[1].position.x = Infinity; }, c => { c.parts[1].rotation.w = 2; },
      c => { c.parts[1].resources = { liquidFuel: -1 }; }, c => { c.parts[1].stage = -1; },
      c => { c.parts[1].partId = 'missing'; }, c => { c.parts[1].attachNode = 'missing'; },
      c => { delete c.parts[1].parent; }, c => { c.parts[2].parentNode = 'top'; },
    ];
    for (const mutate of mutations) { const c = ed.craft; mutate(c); expect(() => deserializeCraft(JSON.stringify(c), ed.catalog)).toThrow(); }
    expect(() => deserializeCraft('{')).toThrow(); expect(() => deserializeCraft('{}')).toThrow();
  });
});

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PART_CATALOG } from '../src/data/parts';
import { CraftEditor, deserializeCraft, serializeCraft } from '../src/editor/core';
import { EditorSession } from '../src/editor/session';
import { LinkView } from '../src/render/vessel/LinkView';
import { linkEndpoints } from '../src/sim/vessel/links';
import { qFromAxisAngle } from '../src/util/quat';
import { add, length, sub, v3 } from '../src/util/vec3';

function editor() {
  const ed = new CraftEditor(PART_CATALOG);
  ed.addRoot('tank-1-mid');
  ed.surfaceAttach('tank-1-mid', 1, v3(.625,0,0), v3(1,0,0));
  return ed;
}
const source = { uid: 1, point: v3(.625,1,0), normal: v3(1,0,0) };
const endpoint = (ed: CraftEditor) => ({ uid: 2, point: add(ed.craft.parts[1].position,v3(-.3,0,0)), normal: v3(-1,0,0) });

describe('editor two-point links', () => {
  it.each(['strut', 'fuel-line'])('places %s only after the second click, and undoes/redoes both anchors', partId => {
    const ed = editor(); ed.beginLink(partId, source);
    expect(ed.craft.parts).toHaveLength(2); expect(ed.linkStart!.hit).toEqual(source);
    const hit = endpoint(ed), mount = ed.completeLink(hit);
    expect(ed.linkStart).toBeUndefined(); expect(mount.link!.sourceUid).toBe(1); expect(mount.link!.targetUid).toBe(2);
    const ends = linkEndpoints(mount.link!, new Map(ed.craft.parts.map(p => [p.uid,p])))!;
    expect(length(sub(ends.a,source.point))).toBeLessThan(1e-10); expect(length(sub(ends.b,hit.point))).toBeLessThan(1e-10);
    expect(deserializeCraft(serializeCraft(ed.craft), PART_CATALOG)).toEqual(ed.craft);
    ed.undo(); expect(ed.craft.parts).toHaveLength(2); expect(ed.linkStart!.hit).toEqual(source);
    ed.redo(); expect(ed.craft.parts).toHaveLength(3); expect(ed.craft.parts[2].link).toEqual(mount.link);
  });

  it('rejects same-part, distant and nonfinite hits atomically, then allows retry', () => {
    const ed = editor(); ed.beginLink('strut',source);
    const craft = ed.craft;
    for (const hit of [{ ...source, point: v3(.625,-1,0) }, { ...endpoint(ed), point: v3(20,0,0) }, { ...endpoint(ed), normal: v3(NaN,0,0) }]) {
      expect(() => ed.completeLink(hit)).toThrow(); expect(ed.craft).toEqual(craft); expect(ed.linkStart).toBeDefined();
    }
    ed.completeLink(endpoint(ed)); expect(ed.craft.parts.filter(p => p.link)).toHaveLength(1);
  });

  it('deletes links when either endpoint is deleted or picked up, including wholly held links, and restores them on undo', () => {
    for (const uid of [1,2]) for (const pickup of [false,true]) {
      const ed = editor(); ed.beginLink('strut',source); ed.completeLink(endpoint(ed));
      const before = ed.craft;
      if (pickup) { ed.detachSubtree(uid); expect(ed.held!.parts.some(p => p.link)).toBe(false); }
      else ed.deletePart(uid);
      expect(ed.craft.parts.some(p => p.link)).toBe(false);
      ed.undo(); expect(ed.craft).toEqual(before);
    }
  });

  it.each(['radial', 'mirror'] as const)('copies both endpoints and target UIDs with %s symmetry', mode => {
    const ed = new CraftEditor(PART_CATALOG); ed.addRoot('tank-1-mid');
    ed.setSymmetry(mode === 'mirror' ? { mode: 'mirror' } : { mode: 'radial', count: 4 });
    ed.surfaceAttach('tank-1-mid', 1, v3(.625,0,0), v3(1,0,0));
    const parent = ed.craft.parts[1];
    // Radial parts rotate their own frames; endpoint positions are expressed in craft space.
    const start = { uid: parent.uid, point: add(parent.position,v3(.05,.2,0)), normal: v3(1,0,0) };
    const end = { uid: 1, point: v3(.625,.8,0), normal: v3(1,0,0) };
    ed.beginLink('fuel-line', start); ed.completeLink(end);
    const links = ed.craft.parts.filter(p => p.link);
    expect(links).toHaveLength(mode === 'mirror' ? 2 : 4);
    expect(new Set(links.map(p => p.link!.sourceUid)).size).toBe(links.length);
    expect(new Set(links.map(p => p.link!.targetUid))).toEqual(new Set([1]));
    expect(() => deserializeCraft(serializeCraft(ed.craft),PART_CATALOG)).not.toThrow();
    const spans = links.map(p => { const e = linkEndpoints(p.link!,new Map(ed.craft.parts.map(p => [p.uid,p])))!; return length(sub(e.a,e.b)); });
    spans.forEach(span => expect(span).toBeCloseTo(spans[0], 8));
  });

  it('deletes symmetry copies together and rolls back unsupported endpoint copies', () => {
    const ed = new CraftEditor(PART_CATALOG); ed.addRoot('tank-1-mid'); ed.setSymmetry({ mode: 'mirror' });
    ed.surfaceAttach('tank-1-mid',1,v3(.625,0,0),v3(1,0,0));
    const part = ed.craft.parts[1];
    ed.beginLink('strut',{uid: part.uid, point:add(part.position,v3(0,.2,0)),normal:v3(1,0,0)});
    const brace = ed.completeLink({uid:1,point:v3(.625,.8,0),normal:v3(1,0,0)});
    expect(ed.craft.parts.filter(p => p.link)).toHaveLength(2);
    ed.deletePart(brace.uid); expect(ed.craft.parts.filter(p => p.link)).toHaveLength(0);
    ed.undo(); expect(ed.craft.parts.filter(p => p.link)).toHaveLength(2);
    const asym = editor(); asym.setSymmetry({mode:'radial',count:4}); asym.beginLink('strut',source);
    const before = asym.craft;
    expect(() => asym.completeLink(endpoint(asym))).toThrow('corresponding target');
    expect(asym.craft).toEqual(before);
  });

  it('preserves anchors when rerooted', () => {
    const ed = editor(); ed.beginLink('strut',source); ed.completeLink(endpoint(ed));
    const before = ed.craft, origin = before.parts[1].position;
    const a = linkEndpoints(before.parts[2].link!,new Map(before.parts.map(p => [p.uid,p])))!;
    ed.reRoot(2);
    const craft = ed.craft, b = linkEndpoints(craft.parts.find(p => p.link)!.link!,new Map(craft.parts.map(p => [p.uid,p])))!;
    expect(length(sub(b.a,sub(a.a,origin)))).toBeLessThan(1e-10);
    expect(length(sub(b.b,sub(a.b,origin)))).toBeLessThan(1e-10);
    expect(() => serializeCraft(craft)).not.toThrow();
  });

  it('session selection uses two surface clicks and restores placement through undo/redo', () => {
    vi.useFakeTimers();
    try {
      const ed = editor(), session = new EditorSession(ed.craft);
      session.pickNew('fuel-line'); expect(session.isLinkPlacement()).toBe(true);
      expect(session.place({kind:'root'})).toBe(false);
      session.placeLinkHit(source); expect(session.getSnapshot().linkStart).toBeDefined();
      session.placeLinkHit(endpoint(ed)); expect(session.getSnapshot().held).toBeNull();
      expect(session.currentCraft().parts.filter(p => p.link)).toHaveLength(1);
      session.undo(); expect(session.getSnapshot().linkStart).toBeDefined(); expect(session.isLinkPlacement()).toBe(true);
      session.redo(); expect(session.currentCraft().parts.filter(p => p.link)).toHaveLength(1);
      session.cancelHeld(); session.dispose();
    } finally { vi.useRealTimers(); }
  });
});

describe('craft-frame cable rendering', () => {
  it('follows endpoints each frame and shows two separated stubs after failure', () => {
    const ed = editor(); ed.beginLink('strut',source); ed.completeLink(endpoint(ed));
    const craft = ed.craft, view = new LinkView(); view.update(craft.parts);
    const group = view.root.children[0], tube = group.children[0] as THREE.Mesh;
    const ends = linkEndpoints(craft.parts[2].link!,new Map(craft.parts.map(p => [p.uid,p])))!;
    expect(tube.scale.y).toBeCloseTo(length(sub(ends.a,ends.b)),8);
    expect(tube.position.x).toBeCloseTo((ends.a.x + ends.b.x)/2,8);
    craft.parts[1].rotation = qFromAxisAngle(v3(0,1,0),.4); craft.parts[1].position.x += .5;
    view.update(craft.parts);
    const moved = linkEndpoints(craft.parts[2].link!,new Map(craft.parts.map(p => [p.uid,p])))!;
    expect(tube.scale.y).toBeCloseTo(length(sub(moved.a,moved.b)),8);
    craft.parts[2].link!.broken = true; view.update(craft.parts);
    expect(group.children.every(p => p.visible)).toBe(true);
    expect(tube.scale.y).toBeCloseTo(length(sub(moved.a,moved.b))*.35,8);
    craft.parts = craft.parts.filter(p => p.uid !== 2); view.update(craft.parts);
    expect(tube.scale.y).toBeCloseTo(.15,8); expect(group.children[1].visible).toBe(false);
    craft.parts = craft.parts.filter(p => !p.link); view.update(craft.parts); expect(view.root.children).toHaveLength(0);
    view.dispose();
  });
});

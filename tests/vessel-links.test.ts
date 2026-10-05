import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { CraftEditor, deserializeCraft, serializeCraft } from '../src/editor/core';
import { buildVessel, cloneVessel, rebuildTopology, splitVessel } from '../src/sim/vessel/assembly';
import { mergeVessels, freePorts } from '../src/sim/vessel/docking';
import { buildTender } from '../src/editor/stockCrafts';
import { evaluateJointLoads, overloadedJoints } from '../src/sim/vessel/structure';
import { drawResource, flowGroups } from '../src/sim/vessel/resources';
import { linkEndpoints } from '../src/sim/vessel/links';
import { computeAeroForces } from '../src/sim/vessel/aero';
import type { CraftDef, PartLink } from '../src/sim/vessel/types';
import type { PartLoad } from '../src/sim/vessel/loads';
import type { StepResult } from '../src/sim/vessel/runtime';
import { qFromAxisAngle, qIdentity, qRotate } from '../src/util/quat';
import { add, length, sub, v3 } from '../src/util/vec3';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { deserializeWorld, serializeWorld } from '../src/game/persistence';
import { applyDeltas, topologyKey, vesselDeltas } from '../src/net/snapshots';
import { validCraft } from '../src/net/protocol';
import { validateCraft, encodeCraft, decodeCraft } from '../src/game/craftSharing';

const link = (sourceUid: number, targetUid: number, sourcePos = v3(), targetPos = v3()): PartLink => ({
  version: 1, sourceUid, targetUid, sourcePos, targetPos, sourceNormal: v3(1,0,0), targetNormal: v3(-1,0,0),
});
function plumbing(): CraftDef {
  return { name: 'Cascade', type: 'VAB', version: 1, parts: [
    { uid: 1, partId: 'pod-lantern-1', position: v3(0,3,0), rotation: qIdentity() },
    { uid: 2, partId: 'tank-1-mid', parent: 1, attachNode: 'top', parentNode: 'bottom', position: v3(), rotation: qIdentity() },
    { uid: 3, partId: 'eng-sirocco', parent: 2, attachNode: 'top', parentNode: 'bottom', position: v3(0,-2,0), rotation: qIdentity(), stage: 0 },
    { uid: 4, partId: 'dec-radial', parent: 2, attachNode: 'srf', parentNode: 'srf', position: v3(1,0,0), rotation: qIdentity(), stage: 2 },
    { uid: 5, partId: 'tank-1-mid', parent: 4, attachNode: 'srf', parentNode: 'srf', position: v3(2,0,0), rotation: qIdentity() },
    { uid: 6, partId: 'fuel-line', parent: 5, attachNode: 'srf', parentNode: 'srf', position: v3(1.375,0,0), rotation: qIdentity(), link: link(5,2,v3(-.625,0,0),v3(.625,0,0)) },
    { uid: 7, partId: 'dec-radial', parent: 5, attachNode: 'srf', parentNode: 'srf', position: v3(3,0,0), rotation: qIdentity(), stage: 1 },
    { uid: 8, partId: 'tank-1-mid', parent: 7, attachNode: 'srf', parentNode: 'srf', position: v3(4,0,0), rotation: qIdentity() },
    { uid: 9, partId: 'fuel-line', parent: 8, attachNode: 'srf', parentNode: 'srf', position: v3(3.375,0,0), rotation: qIdentity(), link: link(8,5,v3(-.625,0,0),v3(.625,0,0)) },
  ] };
}

function reinforced(withBrace: boolean, strength = 600_000) {
  const craft: CraftDef = { name: 'Braced', type: 'VAB', version: 1, parts: [
    { uid: 1, partId: 'tank-1-mid', position: v3(), rotation: qIdentity(), resources: { liquidFuel: 0, oxidizer: 0 } },
    { uid: 2, partId: 'tank-1-mid', parent: 1, attachNode: 'srf', parentNode: 'srf', position: v3(2,0,0), rotation: qIdentity() },
  ] };
  if (withBrace) craft.parts.push({ uid: 3, partId: 'strut', parent: 1, attachNode: 'srf', parentNode: 'srf',
    position: v3(.625,1,0), rotation: qIdentity(), link: link(1,2,v3(.625,1,0),v3(-.625,-1,0)) });
  const catalog = new Map(PART_CATALOG);
  catalog.set('tank-1-mid', { ...catalog.get('tank-1-mid')!, breakingForce: 150_000, breakingTorque: 100_000 });
  catalog.set('strut', { ...catalog.get('strut')!, modules: [{ type: 'strut', maxLength: 5, stiffness: 200_000_000, strength }] });
  return buildVessel(craft, catalog);
}

describe('axial brace load paths', () => {
  it('reduces a side-heavy radial attachment from failure to below rating under max-Q aero loads', () => {
    const a = reinforced(false), b = reinforced(true);
    const ctx = { air: { density: 1.225, pressure: 101325, temperature: 288, speedOfSound: 340 },
      airVelocityBody: v3(0,400,0), control: v3() };
    const loadsA: PartLoad[] = [], loadsB: PartLoad[] = [];
    const aeroA = computeAeroForces(a, ctx, loadsA); computeAeroForces(b, ctx, loadsB);
    expect(aeroA.dynamicPressure).toBeGreaterThan(90_000);
    const before = evaluateJointLoads(a, loadsA).get(2)!.fraction;
    const after = evaluateJointLoads(b, loadsB).get(2)!.fraction;
    expect(before).toBeGreaterThan(1);
    expect(after).toBeLessThan(1);
    for (let i = 0; i < 10; i++) expect(overloadedJoints(b, loadsB, .02)).toEqual([]);
    expect(overloadedJoints(a, loadsA, 1)).toContain(2);
  });

  it('breaks an overloaded brace once, emits an event, and restores the unbraced load', () => {
    const v = reinforced(true, 100);
    const loads: PartLoad[] = [{ partUid: 2, point: v.parts[1].position, force: v3(0,100_000,0) }];
    const supported = evaluateJointLoads(v, loads).get(2)!.fraction;
    const result: StepResult = { events: [], newVessels: [] };
    for (let i = 0; i < 4; i++) overloadedJoints(v, loads, .02, v.angularVelocity, result);
    expect(v.parts[2].link!.broken).toBe(true);
    expect(result.events).toEqual([expect.objectContaining({ type: 'linkBroken', partUid: 3, targetUid: 2 })]);
    expect(v.cache.jointLoads!.get(2)!.fraction).toBeGreaterThan(supported);
    overloadedJoints(v, loads, .02, v.angularVelocity, result);
    expect(result.events).toHaveLength(1);
  });

  it('does not relieve a force perpendicular to the brace and solves multiple braces without double-counting', () => {
    const a = reinforced(false), b = reinforced(true);
    const transverse: PartLoad[] = [{ partUid: 2, point: v3(2,0,0), force: v3(0,0,10_000) }];
    expect(evaluateJointLoads(b, transverse).get(2)!.fraction).toBeCloseTo(evaluateJointLoads(a, transverse).get(2)!.fraction, 2);
    const first = b.parts[2];
    b.parts.push({ ...structuredClone(first), def: first.def, uid: 4 }); rebuildTopology(b);
    const loads: PartLoad[] = [{ partUid: 2, point: v3(2,0,0), force: v3(0,10_000,0) }];
    evaluateJointLoads(b, loads);
    expect(b.cache.strutLoads!.get(3)).toBeCloseTo(b.cache.strutLoads!.get(4)!, 6);
    expect(Number.isFinite(b.cache.jointLoads!.get(2)!.fraction)).toBe(true);
    expect(evaluateJointLoads(cloneVessel(b), loads)).toEqual(evaluateJointLoads(b, loads));
  });
});

describe('directed fuel crossfeed', () => {
  it('drains the outer donor first despite reversed decoupler stage priority, then the inner donor, then core', () => {
    const v = buildVessel(plumbing(), PART_CATALOG);
    const core = v.cache.byUid.get(2)!, inner = v.cache.byUid.get(5)!, outer = v.cache.byUid.get(8)!;
    const full = outer.resources.liquidFuel!;
    expect(drawResource(v, 3, 'liquidFuel', full)).toBe(full);
    expect(outer.resources.liquidFuel).toBe(0); expect(inner.resources.liquidFuel).toBe(full); expect(core.resources.liquidFuel).toBe(full);
    drawResource(v, 3, 'liquidFuel', full);
    expect(inner.resources.liquidFuel).toBe(0); expect(core.resources.liquidFuel).toBe(full);
    drawResource(v, 3, 'liquidFuel', 1); expect(core.resources.liquidFuel).toBe(full - 1);
  });

  it('does not reverse flow or open a decoupler, and removes feed after donor staging', () => {
    const v = buildVessel(plumbing(), PART_CATALOG);
    expect(flowGroups(v, 8, 'liquidFuel').flat()).not.toContain(2);
    const before = v.parts[1].resources.liquidFuel!;
    const [debris] = splitVessel(v, [4]);
    expect(flowGroups(v, 3, 'liquidFuel').flat()).not.toContain(5);
    expect(debris.cache.byUid.get(6)!.link!.broken).toBe(true);
    expect(debris.cache.byUid.get(9)!.link!.broken).toBeUndefined();
    drawResource(v, 3, 'liquidFuel', 1); expect(v.parts[1].resources.liquidFuel).toBe(before - 1);
    const blocked = plumbing(); blocked.parts = blocked.parts.filter(p => !p.link);
    const noHoses = buildVessel(blocked, PART_CATALOG);
    expect(flowGroups(noHoses, 3, 'liquidFuel').flat()).not.toContain(5);
  });

  it('drains symmetric donor tanks proportionally and bounds cyclic plumbing', () => {
    const craft = plumbing(); craft.parts = craft.parts.filter(p => p.uid < 7);
    craft.parts.push({ ...craft.parts[4], uid: 8, position: v3(-2,0,0) },
      { ...craft.parts[5], uid: 9, parent: 8, position: v3(-1.375,0,0), link: link(8,2,v3(.625,0,0),v3(-.625,0,0)) });
    const v = buildVessel(craft, PART_CATALOG);
    drawResource(v, 3, 'liquidFuel', 20);
    expect(v.cache.byUid.get(5)!.resources.liquidFuel).toBe(v.cache.byUid.get(8)!.resources.liquidFuel);
    v.parts.push({ ...v.parts[5], uid: 10, parent: 2, link: link(2,5) }); rebuildTopology(v);
    const groups = flowGroups(v, 3, 'liquidFuel').flat();
    expect(new Set(groups).size).toBe(groups.length);
    expect(drawResource(v, 3, 'liquidFuel', 1)).toBe(1);
  });
});

describe('link persistence and protocol', () => {
  it('roundtrips links through editor JSON, share codes, world saves and multiplayer deltas', async () => {
    const craft = plumbing();
    expect(deserializeCraft(serializeCraft(craft), PART_CATALOG)).toEqual(craft);
    expect(validateCraft(await decodeCraft(await encodeCraft(craft)), PART_CATALOG).craft).toEqual(craft);
    expect(validCraft(craft)).toBe(true);
    const server = new World(new Universe('standard'), PART_CATALOG, 0); server.launch(craft);
    const hose = server.active!.state.cache.byUid.get(6)!;
    hose.linkFatigue = .04;
    const client = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(server))), PART_CATALOG);
    const replica = client.active!.state.cache.byUid.get(6)!;
    expect(replica.link).toEqual(hose.link); expect(replica.linkFatigue).toBe(.04);
    expect(hose.link!.broken, JSON.stringify(hose.link)).toBeUndefined();
    const prior = topologyKey(server);
    hose.link!.broken = true; delete hose.linkFatigue; rebuildTopology(server.active!.state);
    expect(topologyKey(server)).not.toBe(prior);
    applyDeltas(client, server.ut, JSON.parse(JSON.stringify(vesselDeltas(server))));
    expect(replica.link!.broken).toBe(true); expect(replica.linkFatigue).toBeUndefined();
    expect(flowGroups(client.active!.state, 3, 'liquidFuel').flat()).not.toContain(5);
  });

  it('rejects missing/self/nonfinite/overlong/versioned endpoints on every craft ingress', () => {
    for (const mutate of [
      (l: PartLink) => { l.targetUid = 999; }, (l: PartLink) => { l.targetUid = l.sourceUid; },
      (l: PartLink) => { l.targetPos.x = 999; }, (l: PartLink) => { l.targetNormal.x = 2; },
      (l: PartLink) => { l.version = 2 as 1; },
    ]) {
      const craft = plumbing(); mutate(craft.parts[5].link!);
      expect(() => buildVessel(craft, PART_CATALOG)).toThrow();
      expect(() => deserializeCraft(JSON.stringify(craft), PART_CATALOG)).toThrow();
      expect(validateCraft(craft, PART_CATALOG).craft).toBeNull(); expect(validCraft(craft)).toBe(false);
    }
  });

  it('isolates live links from staging projections and rejects unsupported linked parts', () => {
    const v = buildVessel(plumbing(), PART_CATALOG), clone = cloneVessel(v);
    splitVessel(clone, [4]);
    expect(clone.parts.some(p => p.uid === 5)).toBe(false);
    expect(v.cache.byUid.get(6)!.link!.broken).toBeUndefined();
    const craft = plumbing(); craft.parts[5].partId = 'tank-1-short';
    expect(() => buildVessel(craft, PART_CATALOG)).toThrow('unsupported link');
  });

  it('remaps both endpoint UIDs on docking and preserves local anchor positions under rotation and rerooting', () => {
    const craft = buildTender();
    const editor = new CraftEditor(PART_CATALOG, craft);
    const tanks = craft.parts.filter(p => p.partId.startsWith('tank-'));
    const [a, b] = tanks.length > 1 ? tanks : [craft.parts[0], tanks[0]];
    editor.beginLink('strut', { uid: a.uid, point: add(a.position,v3(.2,0,0)), normal: v3(1,0,0) });
    const brace = editor.completeLink({ uid: b.uid, point: add(b.position,v3(.2,0,0)), normal: v3(1,0,0) });
    const keep = buildVessel(buildTender(), PART_CATALOG, { id: 'A' });
    const other = buildVessel(editor.craft, PART_CATALOG, { id: 'B', orientation: qFromAxisAngle(v3(1,0,0), Math.PI) });
    const kp = freePorts(keep)[0], op = freePorts(other)[0];
    other.position = add(other.position, sub(kp.pos, op.pos));
    const oldEnds = linkEndpoints(brace.link!, other.cache.byUid)!;
    const worldPoint = (p: ReturnType<typeof buildVessel>, pt: ReturnType<typeof v3>) => add(p.position, qRotate(p.orientation, sub(pt,p.com)));
    const worldA = worldPoint(other, oldEnds.a), worldB = worldPoint(other, oldEnds.b);
    mergeVessels(keep, other, kp.part.uid, op.part.uid);
    const merged = keep.parts.find(p => p.link)!;
    expect(merged.link!.sourceUid).not.toBe(brace.link!.sourceUid); expect(merged.link!.targetUid).not.toBe(brace.link!.targetUid);
    const newEnds = linkEndpoints(merged.link!, keep.cache.byUid)!;
    expect(length(sub(worldPoint(keep,newEnds.a),worldA))).toBeLessThan(1e-8);
    expect(length(sub(worldPoint(keep,newEnds.b),worldB))).toBeLessThan(1e-8);
    expect(merged.link!.broken).toBeUndefined();
  });
});

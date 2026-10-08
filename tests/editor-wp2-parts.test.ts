import { describe, expect, it } from 'vitest';
import { PART_CATALOG, PART_DEFS } from '../src/data/parts';
import { TECH_NODES } from '../src/data/technology';
import { CraftEditor, getStageList } from '../src/editor/core';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { computeStageStats } from '../src/editor/ui/dv';
import { Universe } from '../src/game/universe';
import { activateNextStage, applyPartAction, buildVessel, computeAeroForces, rebuildTopology, stepThermal, type VesselEvent, type VesselState } from '../src/sim/vessel';
import { jettisonFairing } from '../src/sim/vessel/staging';
import { FAIRING_RING_FRACTION, fairingEncloses, fairingMassDelta, fairingPanelCount, fairingShell, fairingShellMass } from '../src/sim/vessel/fairing';
import type { PartLoad } from '../src/sim/vessel/loads';
import type { CraftDef } from '../src/sim/vessel/types';
import { length } from '../src/util/vec3';

const air = { pressure: 26500, density: 0.41, temperature: 223, speedOfSound: 300 };
/** Climbing at Mach 1 with 6 degrees angle of attack. */
const ctx = { air, airVelocityBody: { x: 31, y: 298, z: 0 }, control: { x: 0, y: 0, z: 0 } };

/** Upper stage tank, optional fairing, then a probe stack. */
function payloadCraft(fairing: boolean): { craft: CraftDef; payload: number[]; fairingUid?: number } {
  const ed = new CraftEditor(PART_CATALOG);
  const tank = ed.addRoot('tank-1-mid');
  let base = tank.uid;
  let fairingUid: number | undefined;
  if (fairing) { fairingUid = ed.attachPart('fairing-1', tank.uid, 'top', 'bottom').uid; base = fairingUid; }
  const probe = ed.attachPart('probe-cairn', base, 'top', 'bottom');
  const battery = ed.attachPart('probe-pebble', probe.uid, 'top', 'bottom');
  return { craft: ed.craft, payload: [probe.uid, battery.uid], fairingUid };
}

function payloadDrag(v: VesselState, uids: number[]): number {
  const loads: PartLoad[] = [];
  computeAeroForces(v, ctx, loads);
  return loads.filter(l => uids.includes(l.partUid)).reduce((sum, l) => sum + length(l.force), 0);
}

describe('procedural fairings', () => {
  it('fit the shell to the payload and shield it from drag (≤ 5 % of exposed drag)', () => {
    const open = payloadCraft(false), closed = payloadCraft(true);
    const fairing = closed.craft.parts.find(p => p.uid === closed.fairingUid)!;
    expect(fairing.tweaks?.fairingHeight).toBeGreaterThan(0.6);
    const def = PART_CATALOG.get('fairing-1')!;
    const shell = fairingShell(def, fairing.tweaks)!;
    for (const uid of closed.payload) {
      const p = closed.craft.parts.find(q => q.uid === uid)!;
      expect(fairingEncloses(shell, { def, ...fairing }, { def: PART_CATALOG.get(p.partId)!, ...p })).toBe(true);
    }
    const exposed = payloadDrag(buildVessel(open.craft, PART_CATALOG), open.payload);
    const vessel = buildVessel(closed.craft, PART_CATALOG);
    for (const uid of closed.payload) expect(vessel.cache.shielded?.has(uid)).toBe(true);
    const inside = payloadDrag(vessel, closed.payload);
    expect(exposed).toBeGreaterThan(100);
    expect(inside).toBeLessThanOrEqual(0.05 * exposed);
    // The streamlined shell takes the drag instead, acting part-way up the shell.
    const loads: PartLoad[] = [];
    computeAeroForces(vessel, ctx, loads);
    const shellLoad = loads.find(l => l.partUid === closed.fairingUid)!;
    expect(length(shellLoad.force)).toBeGreaterThan(0.1 * exposed);
    expect(shellLoad.point.y).toBeGreaterThan(fairing.position.y + 0.2);
  });

  it('protects the payload from ascent heating until jettisoned', () => {
    const closed = payloadCraft(true);
    const v = buildVessel(closed.craft, PART_CATALOG);
    for (const uid of closed.payload) expect(v.cache.exposed.get(uid)).toEqual([0, 0, 0, 0, 0, 0]);
    const hot = { air: { pressure: 300, density: 0.004, temperature: 230, speedOfSound: 300 }, airVelocityBody: { x: 0, y: 2600, z: 0 }, sunDirBody: { x: 1, y: 0, z: 0 }, sunDistance: Infinity };
    const t0 = closed.payload.map(uid => v.cache.byUid.get(uid)!.skinTemperature[2]);
    for (let i = 0; i < 50; i++) stepThermal(v, hot, 0.1);
    closed.payload.forEach((uid, i) => expect(v.cache.byUid.get(uid)!.skinTemperature[2]).toBeLessThan(t0[i] + 5));
    // Jettison: the shell leaves and the payload is exposed again.
    const events: VesselEvent[] = [];
    jettisonFairing([v], closed.fairingUid!, events);
    expect(events).toEqual([{ type: 'fairingJettison', vesselId: v.id, partUid: closed.fairingUid }]);
    for (const uid of closed.payload) expect(v.cache.byUid.has(uid)).toBe(true);
    expect(v.cache.shielded?.size ?? 0).toBe(0);
    expect(payloadDrag(v, closed.payload)).toBeGreaterThan(100);
  });

  it('jettisons only the shell: the ring and payload stay attached, the shell mass leaves', () => {
    const closed = payloadCraft(true);
    const v = buildVessel(closed.craft, PART_CATALOG);
    const ring = v.cache.byUid.get(closed.fairingUid!)!;
    const probe = v.cache.byUid.get(closed.payload[0])!;
    const shellMass = fairingShellMass(ring.def, ring.tweaks);
    expect(shellMass).toBeGreaterThan(0.5 * ring.def.dryMass);
    const before = { mass: v.mass, ring: ring.mass, uids: v.parts.map(p => p.uid), probeY: probe.position.y, parent: probe.parent };
    // Staging fires the fairing like any other stage: no piece splits off.
    ring.stage = 7;
    rebuildTopology(v);
    const { newVessels, events } = activateNextStage(v);
    expect(newVessels).toEqual([]);
    expect(events.some(e => e.type === 'fairingJettison' && e.partUid === ring.uid)).toBe(true);
    expect(v.parts.map(p => p.uid)).toEqual(before.uids);
    // No ring-height gap: the payload still sits on the ring.
    expect(probe.parent).toBe(before.parent);
    expect(probe.parent).toBe(ring.uid);
    expect(probe.position.y).toBe(before.probeY);
    expect(ring.mass).toBeCloseTo(before.ring - shellMass, 6);
    expect(ring.mass).toBeCloseTo(ring.def.dryMass * FAIRING_RING_FRACTION, 6);
    expect(v.mass).toBeCloseTo(before.mass - shellMass, 6);
    // Shielding has ended and the ring is an ordinary node-attached part (no shell areas).
    expect(v.cache.shielded?.size ?? 0).toBe(0);
    expect(v.cache.aeroCentre?.has(ring.uid) ?? false).toBe(false);
    for (const uid of closed.payload) expect(v.cache.exposed.get(uid)!.some(a => a > 0)).toBe(true);
    // A second jettison is refused.
    expect(applyPartAction(v, { kind: 'part', uid: ring.uid, action: 'fairing.jettison' }, [])).toBe(false);
  });

  it('jettisons the shell of a root fairing and splits wide shells into three panels', () => {
    const ed = new CraftEditor(PART_CATALOG);
    const f = ed.addRoot('fairing-1');
    ed.attachPart('probe-cairn', f.uid, 'top', 'bottom');
    const v = buildVessel(ed.craft, PART_CATALOG);
    expect(v.cache.shielded?.size).toBe(1);
    const events: VesselEvent[] = [];
    expect(applyPartAction(v, { kind: 'part', uid: f.uid, action: 'fairing.jettison' }, events)).toBe(true);
    expect(events.map(e => e.type)).toContain('fairingJettison');
    expect(v.cache.shielded?.size ?? 0).toBe(0);
    expect(fairingPanelCount(fairingShell(PART_CATALOG.get('fairing-2')!)!.radius)).toBe(2);
    expect(fairingPanelCount(2.7)).toBe(3);
  });

  it('charges shell mass for larger shells and keeps catalogue crafts unchanged', () => {
    const def = PART_CATALOG.get('fairing-2')!;
    expect(fairingMassDelta(def, undefined)).toBe(0);
    expect(fairingMassDelta(def, { fairingHeight: 12 })).toBeGreaterThan(50);
    expect(fairingMassDelta(def, { fairingHeight: 2 })).toBeLessThan(0);
    // Manual sizing stops auto-fit; re-enabling refits.
    const ed = new CraftEditor(PART_CATALOG);
    const tank = ed.addRoot('tank-2-mid');
    const f = ed.attachPart('fairing-2', tank.uid, 'top', 'bottom');
    ed.attachPart('probe-cairn', f.uid, 'top', 'bottom');
    const fitted = ed.craft.parts.find(p => p.uid === f.uid)!.tweaks!;
    ed.setPartTweaks(f.uid, { fairingHeight: 9 });
    expect(ed.craft.parts.find(p => p.uid === f.uid)!.tweaks).toMatchObject({ fairingAuto: false, fairingHeight: 9 });
    ed.setPartTweaks(f.uid, { fairingAuto: true });
    expect(ed.craft.parts.find(p => p.uid === f.uid)!.tweaks?.fairingHeight).toBe(fitted.fairingHeight);
  });

  it('refits when the payload grows', () => {
    const ed = new CraftEditor(PART_CATALOG);
    const tank = ed.addRoot('tank-1-mid');
    const f = ed.attachPart('fairing-1', tank.uid, 'top', 'bottom');
    const probe = ed.attachPart('probe-cairn', f.uid, 'top', 'bottom');
    const h1 = ed.craft.parts.find(p => p.uid === f.uid)!.tweaks!.fairingHeight!;
    ed.attachPart('tank-1-short', probe.uid, 'top', 'bottom');
    const h2 = ed.craft.parts.find(p => p.uid === f.uid)!.tweaks!.fairingHeight!;
    expect(h2).toBeGreaterThan(h1 + 0.5);
  });
});

describe('multi-way couplers', () => {
  it('are in the catalogue, the tech tree and feed every clustered engine', () => {
    const ids = ['coupler-1-x2', 'coupler-1-x4', 'coupler-2-x2', 'coupler-2-x3', 'coupler-2-x4'];
    for (const id of ids) {
      expect(PART_CATALOG.has(id)).toBe(true);
      expect(TECH_NODES.filter(n => n.parts.includes(id))).toHaveLength(1);
    }
    expect(PART_DEFS.slice(-ids.length).map(p => p.id)).toEqual(ids);
    const ed = new CraftEditor(PART_CATALOG);
    const pod = ed.addRoot('pod-lantern-1');
    const adapter = ed.attachPart('adapt-1-2', pod.uid, 'bottom', 'top');
    const tank = ed.attachPart('tank-2-mid', adapter.uid, 'bottom', 'top');
    const tri = ed.attachPart('coupler-2-x3', tank.uid, 'bottom', 'top');
    const engines = ['bottom', 'bottom2', 'bottom3'].map(node => ed.attachPart('eng-sirocco', tri.uid, node, 'top'));
    const craft = ed.craft;
    // All three ignite together and sit apart.
    expect(getStageList(craft)[0].partUids.sort()).toEqual(engines.map(e => e.uid).sort());
    const xs = engines.map(e => craft.parts.find(p => p.uid === e.uid)!.position);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(xs[i].x - xs[j].x, xs[i].z - xs[j].z)).toBeGreaterThan(1.2);
    const v = buildVessel(craft, PART_CATALOG);
    for (const e of engines) {
      const feed = v.cache.feed.get(e.uid)!.flat();
      expect(feed).toContain(tank.uid);
    }
    const stats = computeStageStats(craft, PART_CATALOG);
    expect(stats.get(0)!.dvVac).toBeGreaterThan(1000);
  });
});

describe('Δv / TWR reference body', () => {
  it("reports Selene's lander stage TWR above 1 on the Moon", () => {
    const craft = STOCK_CRAFTS.find(s => s.id === 'stock-selene')!.build();
    const universe = new Universe('standard');
    const doldrum = craft.parts.find(p => p.partId === 'eng-doldrum')!;
    const index = getStageList(craft).find(s => s.partUids.includes(doldrum.uid))!.index;
    const earth = computeStageStats(craft, PART_CATALOG, universe.body('earth')).get(index)!;
    const moon = computeStageStats(craft, PART_CATALOG, universe.body('moon')).get(index)!;
    expect(earth.twrVac).toBeLessThan(1);
    expect(moon.twrAsl).toBeGreaterThan(1);
    expect(moon.twrAsl).toBeCloseTo(moon.twrVac, 6);
    expect(moon.twrEndAsl).toBeGreaterThan(moon.twrAsl);
    expect(moon.dvVac).toBeCloseTo(earth.dvVac, 6);
    expect(moon.startMass).toBeGreaterThan(moon.endMass);
  });
});

import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { deserializeCraft, getStageList, serializeCraft, validateCraft } from '../src/editor/core';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { STOCK_CATEGORIES, stockCategory, stockFeatures } from '../src/editor/stock/guide';
import { TECH_NODES } from '../src/data/technology';
import { computeStageStats, localEstimate } from '../src/editor/ui/dv';
import { qRotate } from '../src/util/quat';
import { Universe } from '../src/game/universe';
import { sampleAtmosphere } from '../src/sim/atmosphere';
import { buildVessel, computeStageDeltaV } from '../src/sim/vessel';
import { v3 } from '../src/util/vec3';

describe('stock crafts', () => {
  for (const s of STOCK_CRAFTS) {
    it(`${s.name} is valid and staged`, () => {
      const craft = s.build();
      expect(() => deserializeCraft(serializeCraft(craft), PART_CATALOG)).not.toThrow();
      const warnings = validateCraft(craft, PART_CATALOG).filter((w) => w.code === 'no-command' || w.code === 'no-fuel');
      expect(warnings).toEqual([]);
      const stats = computeStageStats(craft, PART_CATALOG);
      const total = [...stats.values()].reduce((a, x) => a + x.dvVac, 0);
      const local = [...localEstimate(craft, PART_CATALOG, getStageList(craft).length - 1).values()].reduce((a, x) => a + x.dvVac, 0);
      console.log(s.name, craft.parts.length, 'parts', Math.round(total), 'm/s (sim)', Math.round(local), 'm/s (local)',
        [...stats.entries()].map(([i, x]) => `S${i}:${Math.round(x.dvVac)}/${x.twrAsl.toFixed(2)}`).join(' '));
      const rover = !craft.parts.some(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'engine'));
      if (rover) expect(craft.parts.filter(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'wheel' && m.motorTorque)).length).toBeGreaterThanOrEqual(4);
      else expect(total).toBeGreaterThan(s.needsResearch ? 0 : 2000);
      if (!s.needsResearch) expect(Math.abs(total - local) / total).toBeLessThan(0.15);
      expect(craft.parts.some(p => PART_CATALOG.get(p.partId)!.modules.some(m => m.type === 'command' && m.controllable !== false))).toBe(true);
      for (const stage of getStageList(craft)) {
        expect(stage.partUids.length).toBeGreaterThan(0);
        for (const uid of stage.partUids) expect(PART_CATALOG.get(craft.parts.find(p => p.uid === uid)!.partId)!.modules.some(m => ['engine', 'decoupler', 'parachute', 'fairing'].includes(m.type))).toBe(true);
      }
      const launchBody = s.launchBody ?? (craft.type === 'VAB' && !s.needsResearch && s.id !== 'stock-tender' ? 'earth' : undefined);
      if (launchBody) {
        const body = new Universe(s.scale).body(launchBody);
        const pressure = sampleAtmosphere(body.atmosphere, 0, body.surfaceGravity).pressure;
        const first = computeStageDeltaV(buildVessel(craft, PART_CATALOG), pressure, body.surfaceGravity)[0];
        expect(first.twrStart, `${launchBody} liftoff TWR`).toBeGreaterThan(1.15);
      }
    });
  }

  it('every stock craft has a picker group and a tip, and its features are parts it carries', () => {
    for (const s of STOCK_CRAFTS) {
      const craft = s.build();
      expect(STOCK_CATEGORIES.map(c => c.id), s.id).toContain(stockCategory(s, craft));
      expect(s.tip?.length, s.id).toBeGreaterThan(20);
      expect(s.tip!.length, s.id).toBeLessThan(130);
      for (const tag of s.tags ?? []) if (PART_CATALOG.has(tag)) expect(craft.parts.some(p => p.partId === tag), `${s.id} ${tag}`).toBe(true);
      expect(stockFeatures(s, craft).length, s.id).toBeGreaterThan(0);
    }
  });

  it('starting-equipment designs use only starting parts', () => {
    const foundation = TECH_NODES.find(n => n.id === 'foundation')!.parts;
    const starters = STOCK_CRAFTS.filter(s => s.blurb.startsWith('Starting equipment'));
    expect(starters.map(s => s.id)).toEqual(expect.arrayContaining(['stock-firstlight', 'stock-fizzwick']));
    for (const s of starters) for (const p of s.build().parts) expect(foundation, `${s.id} ${p.partId}`).toContain(p.partId);
  });

  it('moon lander has enough delta-v for the mission', () => {
    const craft = STOCK_CRAFTS[2].build();
    const stats = computeStageStats(craft, PART_CATALOG);
    const total = [...stats.values()].reduce((a, x) => a + x.dvVac, 0);
    expect(total).toBeGreaterThan(5800 * 1.1);
    // First stage must lift off.
    expect(stats.get(0)!.twrAsl).toBeGreaterThan(1.2);
  });

  it('Swift is an SPH craft with mirrored wings and gear seated on their parents', () => {
    const craft = STOCK_CRAFTS.find((s) => s.id === 'stock-swift')!.build();
    expect(craft.type).toBe('SPH');
    for (const id of ['wing-broadleaf', 'gear-bogie', 'intake-gill']) {
      const [a, b] = craft.parts.filter((p) => p.partId === id);
      expect(a && b, id).toBeTruthy();
      expect(b.position.x).toBeCloseTo(-a.position.x, 6);
      expect(b.position.y).toBeCloseTo(a.position.y, 6);
      expect(b.position.z).toBeCloseTo(a.position.z, 6);
      expect(a.symmetryGroup).toBe(b.symmetryGroup);
    }
    // Wings: mount face (-Z) on the fuselage side, span outward, lift normal vertical.
    for (const w of craft.parts.filter((p) => p.partId === 'wing-broadleaf')) {
      const out = qRotate(w.rotation, v3(0, 0, 1));
      expect(Math.abs(out.x)).toBeCloseTo(1, 6);
      expect(Math.abs(qRotate(w.rotation, v3(1, 0, 0)).z)).toBeCloseTo(Math.cos((3 * Math.PI) / 180), 6); // 3 deg incidence
    }
    // Gear hangs straight down.
    for (const g of craft.parts.filter((p) => p.partId.startsWith('gear-'))) expect(qRotate(g.rotation, v3(0, 0, 1)).z).toBeCloseTo(-1, 6);
  });

  it('radial parts mount with their -Z face on the parent surface', () => {
    const craft = STOCK_CRAFTS[0].build();
    const fins = craft.parts.filter((p) => p.partId === 'fin-keel');
    expect(fins.length).toBe(3);
    for (const f of fins) {
      const inward = qRotate(f.rotation, v3(0, 0, -1));
      const radial = Math.hypot(f.position.x, f.position.z);
      // inward direction points toward the axis
      expect((inward.x * f.position.x + inward.z * f.position.z) / radial).toBeLessThan(-0.99);
      // mount face sits on the 0.625 m tank skin (fin span 0.75)
      expect(radial).toBeCloseTo(0.625 + 0.375, 3);
    }
  });
});

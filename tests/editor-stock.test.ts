import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { deserializeCraft, getStageList, serializeCraft, validateCraft } from '../src/editor/core';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { computeStageStats, localEstimate } from '../src/editor/ui/dv';
import { qRotate } from '../src/util/quat';
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
      // eslint-disable-next-line no-console
      console.log(s.name, craft.parts.length, 'parts', Math.round(total), 'm/s (sim)', Math.round(local), 'm/s (local)',
        [...stats.entries()].map(([i, x]) => `S${i}:${Math.round(x.dvVac)}/${x.twrAsl.toFixed(2)}`).join(' '));
      expect(total).toBeGreaterThan(2000);
      expect(Math.abs(total - local) / total).toBeLessThan(0.15);
    });
  }

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
      expect(Math.abs(qRotate(w.rotation, v3(1, 0, 0)).z)).toBeCloseTo(1, 6);
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

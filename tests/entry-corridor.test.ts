import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildMoonLander } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { spawnRelative } from '../src/scenarios/catalog';
import { neutralInput } from '../src/sim/vessel';
import { arrivalPeriapsisAltitude } from '../src/game/planning/arrival';
import type { CraftDef } from '../src/sim/vessel/types';
import { length, sub, v3 } from '../src/util/vec3';

/** The Selene return capsule: everything above the first decoupler (pod, chute, heat shield). */
function capsule(): CraftDef {
  const craft = buildMoonLander();
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const above = (uid: number): boolean => { const p = byUid.get(uid)!; return !p.partId.startsWith('dec-') && (p.parent === undefined || above(p.parent)); };
  return { ...craft, parts: craft.parts.filter(p => above(p.uid)) };
}

/** Fall from the Moon's distance to a vacuum periapsis `pe` and fly the pass: lowest altitude and peak g. */
function entryPass(scale: 'standard' | 'challenging' | 'real', pe: number) {
  const w = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT);
  const u = w.universe, b = u.body('earth'), atmo = b.atmosphere!.height;
  const ra = length(u.ephem.getRelativeState('moon', w.ut).position), rp = b.radius + pe, a = (ra + rp) / 2;
  const r0 = b.radius + atmo + 10000, v0 = Math.sqrt(b.gm * (2 / r0 - 1 / a)), vt = Math.sqrt(b.gm * a * (1 - ((ra - rp) / (ra + rp)) ** 2)) / r0;
  const wv = spawnRelative(w, capsule(), 'earth', v3(r0, 0, 0), v3(-Math.sqrt(v0 * v0 - vt * vt), vt, 0));
  let minAlt = Infinity, maxG = 0;
  for (let i = 0; i < 20 * 900; i++) {
    w.tick(1 / 20, neutralInput());
    const alt = length(sub(wv.state.position, u.ephem.getBodyState('earth', w.ut).position)) - b.radius;
    minAlt = Math.min(minAlt, alt);
    maxG = Math.max(maxG, wv.state.telemetry.gForce ?? 0);
    if (alt < 10000 || (i > 200 && alt > atmo + 15000)) break;
  }
  return { minAlt, maxG, w };
}

describe('lunar return entry corridor', () => {
  for (const scale of ['standard', 'challenging', 'real'] as const) {
    it(`plans a periapsis that captures the capsule in one pass (${scale})`, () => {
      const w = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT);
      const atmo = w.universe.body('earth').atmosphere!.height;
      const pe = arrivalPeriapsisAltitude(w, 'moon', 'earth', w.ut);
      expect(pe).toBeGreaterThan(atmo * 0.1);
      expect(pe).toBeLessThan(atmo * 0.5);
      const pass = entryPass(scale, pe);
      expect(pass.minAlt).toBeLessThan(10000);
      if (scale !== 'real') expect(pass.maxG).toBeLessThan(7);
    }, 120000);
  }
  it('the old default (half the atmosphere height) skips back out', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    expect(entryPass('standard', w.universe.body('earth').atmosphere!.height * 0.5).minAlt).toBeGreaterThan(30000);
  }, 120000);
  it('keeps the outbound and airless defaults', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    expect(arrivalPeriapsisAltitude(w, 'earth', 'moon', w.ut)).toBe(30000);
  });
});

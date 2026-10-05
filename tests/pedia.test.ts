import { describe, expect, it } from 'vitest';
import { BODY_DEFS } from '../src/data/bodies';
import { PART_DEFS } from '../src/data/parts';
import { BODY_ARTICLES, PART_ARTICLES, PEDIA_INDEX, atmosphereProfile } from '../src/data/pedia';
import { buildUniverse, SCALE_PRESETS } from '../src/sim/bodies/scale';
import { BANNED } from './forbiddenTerms';

describe('Spacepedia', () => {
  it('indexes every body and part once with a research assignment', () => {
    expect(BODY_ARTICLES.map(a => a.id)).toEqual(BODY_DEFS.map(b => b.id));
    expect(PART_ARTICLES.map(a => a.id)).toEqual(PART_DEFS.map(p => p.id));
    expect(new Set(PEDIA_INDEX.map(a => `${a.kind}:${a.id}`)).size).toBe(PEDIA_INDEX.length);
    expect(PART_ARTICLES.every(a => a.research?.parts.includes(a.id))).toBe(true);
  });
  it('samples increasing altitude and non-increasing pressure for every preset', () => {
    for (const cfg of Object.values(SCALE_PRESETS)) for (const body of buildUniverse(BODY_DEFS, cfg).values()) {
      const points = atmosphereProfile(body);
      for (let i = 0; i < points.length; i++) {
        expect(Number.isFinite(points[i].temperature)).toBe(true);
        expect(points[i].temperature).toBeGreaterThanOrEqual(0);
        if (i) {
          expect(points[i].altitude).toBeGreaterThan(points[i - 1].altitude);
          expect(points[i].pressure).toBeLessThanOrEqual(points[i - 1].pressure);
        }
      }
      if (points.length) expect(points.at(-1)!.pressure).toBe(0);
    }
  });
  it('uses original terminology throughout the index', () => {
    for (const a of PEDIA_INDEX) expect(`${a.name} ${a.text}`).not.toMatch(BANNED);
  });
});

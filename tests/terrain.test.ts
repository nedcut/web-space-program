import { describe, it, expect } from 'vitest';
import { createTerrain, LAUNCH_SITE, latLonToUnit } from '../src/sim/terrain';
import { Simplex3 } from '../src/sim/terrain/noise';
import { scaleBodyDef, SCALE_PRESETS } from '../src/sim/bodies/scale';
import type { BodyDef } from '../src/sim/bodies/types';
import { BODY_DEFS } from '../src/data/bodies';

function body(id: string, preset: string, radius: number, relief: number, extra: Partial<BodyDef> = {}): BodyDef {
  return {
    id, name: id, kind: 'planet', gm: 1e14, radius, rotationPeriod: 86400, axialTilt: 0,
    surface: { preset, relief, seed: 1234 + id.length * 97, colors: [[0.1, 0.1, 0.1], [0.3, 0.3, 0.3], [0.6, 0.6, 0.6]] },
    solidSurface: true, ...extra,
  };
}

const std = SCALE_PRESETS.standard;
const FIXTURE: BodyDef[] = [
  body('earth', 'earth', 6371000, 8800, { surface: { preset: 'earth', relief: 8800, seed: 42, colors: [], ocean: true } }),
  body('moon', 'lunar', 1737400, 10000),
  body('mars', 'mars', 3389500, 21000),
  body('mercury', 'mercury', 2439400, 6000),
  body('venus', 'venus', 6051800, 11000),
  body('titan', 'titan', 2574700, 2500),
  body('io', 'io', 1821600, 17000),
  body('europa', 'europa', 1560800, 1000),
  body('enceladus', 'enceladus', 252100, 6000),
  body('callisto', 'icy', 2410300, 5000),
  body('phobos', 'rocky', 11100, 4000),
].map((b) => scaleBodyDef(b, std));

/** Deterministic pseudo-random unit vectors (no Math.random). */
function* directions(n: number, seed = 7): Generator<[number, number, number]> {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, t = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
    yield [q * Math.cos(t), q * Math.sin(t), u];
  }
}

describe('simplex noise', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new Simplex3(5), b = new Simplex3(5), c = new Simplex3(6);
    for (const [x, y, z] of directions(200)) {
      expect(a.noise(x * 3, y * 3, z * 3)).toBe(b.noise(x * 3, y * 3, z * 3));
    }
    let diff = 0;
    for (const [x, y, z] of directions(200)) diff += Math.abs(a.noise(x * 3, y * 3, z * 3) - c.noise(x * 3, y * 3, z * 3));
    expect(diff).toBeGreaterThan(1);
  });
  it('stays within [-1, 1]', () => {
    const n = new Simplex3(1);
    for (const [x, y, z] of directions(5000)) {
      const v = n.noise(x * 17.3, y * 17.3, z * 17.3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('createTerrain', () => {
  it('is deterministic: separate instances give identical heights and colours', () => {
    for (const def of FIXTURE) {
      const t1 = createTerrain(def), t2 = createTerrain(def);
      const c1: [number, number, number] = [0, 0, 0], c2: [number, number, number] = [0, 0, 0];
      for (const [x, y, z] of directions(300, def.id.length)) {
        const h1 = t1.heightAt(x, y, z);
        expect(h1).toBe(t2.heightAt(x, y, z));
        expect(Number.isFinite(h1)).toBe(true);
        t1.colorAt!(x, y, z, h1, c1);
        t2.colorAt!(x, y, z, h1, c2);
        expect(c1).toEqual(c2);
      }
    }
  });

  it('is bounded by [minHeight, maxHeight] and produces real relief', () => {
    for (const def of FIXTURE) {
      const t = createTerrain(def);
      let lo = Infinity, hi = -Infinity;
      for (const [x, y, z] of directions(4000, 3)) {
        const h = t.heightAt(x, y, z);
        expect(h).toBeLessThanOrEqual(t.maxHeight);
        expect(h).toBeGreaterThanOrEqual(t.minHeight);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      // Relief should be a decent fraction of the declared amplitude.
      expect(hi - lo).toBeGreaterThan(def.surface.relief * 0.15);
      // Bounds should not be absurdly loose (renderer uses them for culling).
      expect(t.maxHeight).toBeLessThan(def.surface.relief * 2 + 100);
    }
  });

  it('every body in BODY_DEFS builds a bounded, finite terrain', () => {
    for (const raw of BODY_DEFS) {
      const def = scaleBodyDef(raw, std);
      const t = createTerrain(def);
      for (const [x, y, z] of directions(150, 11)) {
        const h = t.heightAt(x, y, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeLessThanOrEqual(t.maxHeight);
        expect(h).toBeGreaterThanOrEqual(t.minHeight);
      }
    }
  });

  it('gas giants and stars are flat', () => {
    const jup = scaleBodyDef(body('jupiter', 'gasGiant', 69911000, 0, { solidSurface: false }), std);
    const t = createTerrain(jup);
    expect(t.heightAt(0.3, 0.4, Math.sqrt(1 - 0.25))).toBe(0);
    expect(t.maxHeight).toBe(0);
  });

  it('Earth has oceans and land in plausible proportions', () => {
    const t = createTerrain(FIXTURE[0]);
    expect(t.ocean).toBe(true);
    let land = 0, n = 0;
    for (const [x, y, z] of directions(6000, 21)) {
      if (t.heightAt(x, y, z) > 0) land++;
      n++;
    }
    const f = land / n;
    expect(f).toBeGreaterThan(0.18);
    expect(f).toBeLessThan(0.5);
  });

  it('launch site is a flat plateau at ~10 m with ocean to the east', () => {
    for (const scale of [SCALE_PRESETS.standard, SCALE_PRESETS.real]) {
      const earth = scaleBodyDef(body('earth', 'earth', 6371000, 8800, { surface: { preset: 'earth', relief: 8800, seed: 42, colors: [], ocean: true } }), scale);
      const t = createTerrain(earth);
      const R = earth.radius;
      const c = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
      expect(t.heightAt(c.x, c.y, c.z)).toBeCloseTo(LAUNCH_SITE.elevation, 6);
      // Sample a ring of points within the flat radius.
      const dLat = (LAUNCH_SITE.flatRadius * 0.95) / R * (180 / Math.PI);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const f of [0.25, 0.6, 1]) {
          const p = latLonToUnit(LAUNCH_SITE.lat + dLat * f * Math.sin(a), LAUNCH_SITE.lon + (dLat * f * Math.cos(a)) / Math.cos((LAUNCH_SITE.lat * Math.PI) / 180));
          expect(Math.abs(t.heightAt(p.x, p.y, p.z) - LAUNCH_SITE.elevation)).toBeLessThan(0.01);
        }
      }
      // Ocean within ~2.5 degrees east.
      let foundSea = false;
      for (let d = 0.1; d < 2.5; d += 0.05) {
        const p = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon + d);
        if (t.heightAt(p.x, p.y, p.z) < 0) { foundSea = true; break; }
      }
      expect(foundSea).toBe(true);
      // Land to the west.
      const w = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon - 0.5);
      expect(t.heightAt(w.x, w.y, w.z)).toBeGreaterThan(0);
    }
  });

  it('is fast enough for physics queries', () => {
    for (const def of FIXTURE.slice(0, 4)) {
      const t = createTerrain(def);
      const dirs = [...directions(20000, 5)];
      let acc = 0;
      for (const [x, y, z] of dirs.slice(0, 2000)) acc += t.heightAt(x, y, z); // warm-up
      const t0 = performance.now();
      for (const [x, y, z] of dirs) acc += t.heightAt(x, y, z);
      const us = ((performance.now() - t0) * 1000) / dirs.length;
      expect(Number.isFinite(acc)).toBe(true);
      // Generous bound for slow CI machines; typically 1–6 µs.
      expect(us).toBeLessThan(40);
    }
  });
});

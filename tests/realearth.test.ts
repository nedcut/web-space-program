import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { EarthGrid, EARTH_DATA_BYTES, earthData } from '../src/sim/terrain/earthData';
import { createTerrain, latLonToUnit, LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../src/sim/terrain';
import { Universe } from '../src/game/universe';
import { biomeAt, BIOMES } from '../src/sim/science/biomes';
import { buildChunk } from '../src/render/planet/chunkBuilder';
import { cloudLandMask } from '../src/render/planet/cloudCoasts';
import { GROUND_STATIONS } from '../src/game/comms';
import { LANDMARKS } from '../src/sim/terrain/landmarks';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { EXPERIMENTS, subjectKey } from '../src/sim/science/experiments';
const point = (lat: number, lon: number): [number, number, number] => {
  const p = latLonToUnit(lat, lon); return [p.x, p.y, p.z];
};
const elevation = (lat: number, lon: number) => earthData().sample(...point(lat, lon));

describe('real Earth geography', () => {
  it('loads the committed little-endian metre grid and verifies its manifest hash', () => {
    const bytes = readFileSync(new URL('../public/earth/height.i16', import.meta.url));
    const manifest = JSON.parse(readFileSync(new URL('../public/earth/manifest.json', import.meta.url), 'utf8'));
    expect(bytes.length).toBe(EARTH_DATA_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[0].sha256);
    expect(() => new EarthGrid(new ArrayBuffer(4))).toThrow('bytes');
    const grid = new EarthGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    expect(grid.sample(...point(24, 15))).toBe(elevation(24, 15));
  });
  it('puts measured mountains, trenches, deserts and oceans at real coordinates', () => {
    expect(elevation(28, 86.9)).toBeGreaterThan(5500);
    expect(elevation(11.35, 142.2)).toBeLessThan(-8500);
    expect(elevation(24, 15)).toBeGreaterThan(0);
    expect(elevation(0, -30)).toBeLessThan(-3000);
    expect(elevation(-80, 0)).toBeGreaterThan(2000);
    expect(elevation(28.5, -79.5)).toBeLessThan(-100);
  });
  it('preserves the exact pad/runway on land and ocean eastward at all scales', () => {
    for (const scale of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(scale), t = u.terrain('earth'), r = u.body('earth').radius;
      expect(t.heightAt(...point(LAUNCH_SITE.lat, LAUNCH_SITE.lon))).toBe(10);
      for (const x of [-RUNWAY.length / 2, 0, RUNWAY.length / 2]) for (const z of [RUNWAY.z - 30, RUNWAY.z + 30]) {
        const p = siteLocalToUnit(x, z, r); expect(t.heightAt(p.x, p.y, p.z)).toBe(10);
      }
      expect(t.heightAt(...point(28.5, -79.5))).toBeLessThan(0);
      expect(t.heightAt(...point(28.5, -81.1))).toBeGreaterThan(0);
    }
  });
  it('is continuous across antimeridian and converges to one height at each pole', () => {
    const t = new Universe('real').terrain('earth');
    for (let lat = -89; lat <= 89; lat += 5) {
      expect(Math.abs(t.heightAt(...point(lat, -180 + 1e-8)) - t.heightAt(...point(lat, 180 - 1e-8)))).toBeLessThan(.01);
    }
    for (const sign of [-1, 1]) for (let lon = -180; lon < 180; lon += 15) {
      const pole = t.heightAt(0, 0, sign);
      expect(t.heightAt(...point(sign * 90, lon))).toBeCloseTo(pole, 8);
      expect(Math.abs(t.heightAt(...point(sign * (90 - 1e-6), lon)) - pole)).toBeLessThan(.1);
    }
  });
  it('uses real cover regions and retains every legacy science ID', () => {
    const u = new Universe('real'), t = u.terrain('earth');
    for (const [lat, lon, name] of [[24, 15, 'Deserts'], [-80, 0, 'Ice Caps'], [0, -30, 'Oceans'], [-4, -63, 'Rainforests'], [50, 10, 'Forests']] as const) {
      expect(biomeAt(u.body('earth'), t, latLonToUnit(lat, lon))).toBe(name);
    }
    for (const id of ['Oceans', 'Shores', 'Grasslands', 'Deserts', 'Mountains', 'Ice Caps', 'Launch Complex']) expect(BIOMES.earth).toContain(id);
  });
  it('identity-migrates legacy archive keys, decay and accepted biome contracts through saves', () => {
    const w = new World(new Universe('standard'), PART_CATALOG, 0, 'science');
    for (const biome of BIOMES.earth.slice(0, 7)) {
      const context = { body: 'earth', biome, situation: 'landed' as const };
      const key = subjectKey(EXPERIMENTS[0], context);
      w.progression.archive[key] = { ...context, experiment: EXPERIMENTS[0].id, science: 7, runs: 3 };
    }
    const saved = serializeWorld(w), restored = deserializeWorld(saved, PART_CATALOG);
    expect(restored.progression).toEqual(saved.progression);
  });
  it('keeps ground stations and named Earth airfields on real land', () => {
    const t = new Universe('real').terrain('earth');
    for (const s of [...GROUND_STATIONS, ...LANDMARKS.filter(l => l.body === 'earth')]) expect(t.heightAt(...point(s.lat, s.lon)), s.name).toBeGreaterThan(0);
  });
  it('feeds the existing south-first cloud mask from real terrain', () => {
    const t = new Universe('real').terrain('earth'), mask = cloudLandMask(t.heightAt);
    const value = (lat: number, lon: number) => mask[Math.floor((lat + 90) / 180 * 64) * 128 + Math.floor((lon + 180) / 360 * 128)];
    expect(value(24, 15)).toBe(255); expect(value(0, -30)).toBe(0);
  });
  it('matches heights and actual chunk-worker mesh bytes across isolates', async () => {
    const worker = new Worker(new URL('./fixtures/earth-worker.mjs', import.meta.url));
    try {
      const body = new Universe('standard').body('earth'), t = createTerrain(body);
      const points: [number, number, number][] = [];
      for (let i = 0; i < 997; i++) points.push(point(-89 + 178 * i / 996, ((i * 137.508) % 360) - 180));
      const next = () => new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.once('message', resolve); worker.once('error', reject);
      });
      worker.postMessage({ type: 'earthData', buffer: earthData().buffer });
      worker.postMessage({ type: 'init', key: 'earth', body, minWavelength: 6 });
      const heights = next(); worker.postMessage({ type: 'probe', id: 1, body, points });
      expect((await heights).values).toEqual(points.map(p => t.heightAt(...p)));
      const params = { face: 3, level: 4, ix: 7, iy: 4, res: 24, radius: body.radius, ocean: true };
      const result = next(); worker.postMessage({ type: 'build', id: 2, key: 'earth', params });
      const { buildMs: _time, ...actual } = (await result).data as ReturnType<typeof buildChunk>;
      const { buildMs: _otherTime, ...expected } = buildChunk(t, params);
      expect(actual).toEqual(expected);
    } finally { await worker.terminate(); }
  });
});

import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { CAPE_PATCH, EarthGrid, EARTH_DATA_BYTES, EARTH_FILES, earthData } from '../src/sim/terrain/earthData';
import { createTerrain, latLonToUnit, LAUNCH_SITE, launchPlateau, RUNWAY, siteClearance, siteLocalToUnit } from '../src/sim/terrain';
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
  it('loads the committed little-endian metre grids and verifies their manifest hashes', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/earth/manifest.json', import.meta.url), 'utf8'));
    const parts = EARTH_FILES.map(file => {
      const bytes = readFileSync(new URL(`../public/earth/${file.path}`, import.meta.url));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files.find((f: { path: string }) => f.path === file.path).sha256);
      return bytes;
    });
    const bytes = Buffer.concat(parts);
    expect(bytes.length).toBe(EARTH_DATA_BYTES);
    expect(() => new EarthGrid(new ArrayBuffer(4))).toThrow('bytes');
    const grid = new EarthGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    expect(grid.sample(...point(24, 15))).toBe(elevation(24, 15));
    expect(grid.sample(...point(28.47, -80.56))).toBe(elevation(28.47, -80.56));
  });
  it('resolves the Cape Canaveral barrier islands and lagoons from the 15 arc-second patch', () => {
    // Cape Canaveral, Merritt Island and the mainland are land; the Banana and Indian Rivers between them are water.
    expect(elevation(28.47, -80.56)).toBeGreaterThan(0);
    expect(elevation(28.53, -80.68)).toBeGreaterThan(0);
    expect(elevation(28.5, -80.83)).toBeGreaterThan(0);
    expect(elevation(28.5, -80.61)).toBeLessThanOrEqual(0);
    expect(elevation(28.5, -80.75)).toBeLessThanOrEqual(0);
    expect(elevation(28.5, -80.5)).toBeLessThan(0);
    // The global grid alone (bilinear on its 9.8 km cells) puts the Cape under the sea.
    const g = earthData().values, px = (-80.56 / 360 + .5) * 4096 - .5, py = (90 - 28.47) / 180 * 2048 - .5;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, at = (x: number, y: number) => g[y * 4096 + x];
    expect((at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy).toBeLessThan(0);
  });
  it('blends the patch into the global grid without seams', () => {
    const P = CAPE_PATCH, east = P.west + P.width / P.perDegree, south = P.north - P.height / P.perDegree;
    const out = { range: 0, shore: 0 }, inside = { range: 0, shore: 0 };
    let worst = 0;
    // Straddle each edge by a hair: the patch weight is zero there, so height, range and shore must agree.
    const edges: [number, number, number, number][] = [];
    for (let t = 0; t <= 1; t += 1 / 64) {
      const lat = south + (P.north - south) * t, lon = P.west + (east - P.west) * t;
      edges.push([lat, P.west - 1e-9, lat, P.west + 1e-9], [lat, east + 1e-9, lat, east - 1e-9]);
      edges.push([P.north + 1e-9, lon, P.north - 1e-9, lon], [south - 1e-9, lon, south + 1e-9, lon]);
    }
    for (const [la0, lo0, la1, lo1] of edges) {
      const a = earthData().sample(...point(la0, lo0), out), b = earthData().sample(...point(la1, lo1), inside);
      worst = Math.max(worst, Math.abs(a - b));
      expect(Math.abs(out.range - inside.range)).toBeLessThan(.01);
      expect(Math.abs((out.shore ?? 0) - (inside.shore ?? 0))).toBeLessThan(.001);
    }
    expect(worst).toBeLessThan(.01);
    // Through the blend margin and its inner edge, where sampling switches to the patch alone, there are no jumps:
    // 1e-6 degree (0.1 m) steps change height by centimetres.
    for (const lat of [25, 27.5, 30]) for (let lon = P.west; lon < P.west + P.margin + .01; lon += .0007) {
      expect(Math.abs(elevation(lat, lon + 1e-6) - elevation(lat, lon))).toBeLessThan(.1);
    }
    for (const lat of [25, 27.5, 30]) {
      const edge = P.west + P.margin;
      expect(Math.abs(elevation(lat, edge + 1e-9) - elevation(lat, edge - 1e-9))).toBeLessThan(.001);
    }
  });
  it('preserves the exact pad/runway on land and ocean eastward at all scales', () => {
    for (const scale of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(scale), t = u.terrain('earth'), r = u.body('earth').radius;
      const plateau = launchPlateau(u.body('earth').surface.relief);
      expect(plateau).toBeGreaterThan(0);
      expect(t.heightAt(...point(LAUNCH_SITE.lat, LAUNCH_SITE.lon))).toBe(plateau);
      for (const x of [-RUNWAY.length / 2, 0, RUNWAY.length / 2]) for (const z of [RUNWAY.z - 30, RUNWAY.z + 30]) {
        const p = siteLocalToUnit(x, z, r); expect(t.heightAt(p.x, p.y, p.z)).toBe(plateau);
      }
      expect(t.heightAt(...point(28.5, -79.5))).toBeLessThan(0);
      expect(t.heightAt(...point(28.5, -81.1))).toBeGreaterThan(0);
      // Cape Canaveral stays land and the Atlantic beside it stays sea.
      expect(t.heightAt(...point(28.47, -80.56))).toBeGreaterThan(0);
      expect(t.heightAt(...point(28.47, -80.5))).toBeLessThan(0);
    }
  });
  it('never raises water to land outside the flat site ground', () => {
    for (const scale of ['standard', 'challenging', 'real'] as const) {
      const u = new Universe(scale), t = u.terrain('earth'), r = u.body('earth').radius;
      let water = 0;
      for (let x = -6000; x <= 6000; x += 61) for (let z = -6000; z <= 6000; z += 61) {
        if (siteClearance(x, z) <= 0) continue;
        const p = siteLocalToUnit(x, z, r);
        if (earthData().sample(p.x, p.y, p.z) > 0) continue;
        water++;
        expect(t.heightAt(p.x, p.y, p.z)).toBeLessThanOrEqual(0);
      }
      expect(water).toBeGreaterThan(100);
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
  it('keeps height continuous across internal grid-cell edges', () => {
    const t = new Universe('real').terrain('earth');
    for (let x = 100; x < 4000; x += 113) for (const lat of [-30, 28, 45]) {
      const lon = -180 + (x + .5) * 360 / 4096;
      expect(Math.abs(t.heightAt(...point(lat, lon - 1e-8)) - t.heightAt(...point(lat, lon + 1e-8)))).toBeLessThan(.01);
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
    w.launch(STOCK_CRAFTS.find(c => c.id === 'stock-kestrel')!.build());
    w.active!.state.parts[0].scienceData = [];
    for (const biome of BIOMES.earth.slice(0, 7)) {
      const context = { body: 'earth', biome, situation: 'landed' as const };
      const key = subjectKey(EXPERIMENTS[0], context);
      w.progression.archive[key] = { ...context, experiment: EXPERIMENTS[0].id, science: 7, runs: 3 };
      w.progression.contracts.push({ id: biome, kind: 'science', title: biome, ...context, status: 'active', advance: 1, reward: 2, penalty: 0, reputation: 1, landed: false });
      w.active!.state.parts[0].scienceData!.push({ ...context, id: w.progression.nextDataId++, subject: key, experiment: EXPERIMENTS[0].id, value: 3, credited: 1 });
    }
    const saved = serializeWorld(w), restored = deserializeWorld(saved, PART_CATALOG);
    expect(restored.progression).toEqual(saved.progression);
    expect(restored.active!.state.parts[0].scienceData).toEqual(w.active!.state.parts[0].scienceData);
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

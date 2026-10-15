import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { biomeAt } from '../src/sim/science/biomes';
import { biomeIndexAt, biomeRegions, buildBiomeMap, cellDirection, hasBiomeMap, smoothBiomeGrid, type BiomeGrid } from '../src/sim/science/biomeMap';
import { LAUNCH_SITE, latLonToUnit } from '../src/sim/terrain';
import { newProgression, type Contract } from '../src/sim/science/progression';
import { biomeObjectives } from '../src/game/biomeObjectives';
import { EARTH_CITIES } from '../src/data/earthCities';

const u = new Universe('standard');
const earthMap = buildBiomeMap(u.body('earth'), u.terrain('earth'), { width: 256, height: 128 });

describe('biome map', () => {
  it('classifies each cell exactly as science does at the cell centre', () => {
    const body = u.body('earth'), terrain = u.terrain('earth');
    for (let k = 0; k < 400; k++) {
      const x = (k * 7919) % earthMap.width, y = (k * 104729) % earthMap.height;
      expect(earthMap.names[earthMap.cells[y * earthMap.width + x]]).toBe(biomeAt(body, terrain, cellDirection(earthMap.width, earthMap.height, x, y)));
    }
  });

  it('finds real regions by direction', () => {
    for (const [lat, lon, name] of [[24, 15, 'Deserts'], [-4, -63, 'Rainforests'], [0, -30, 'Oceans'], [-80, 0, 'Ice Caps']] as const) {
      expect(earthMap.names[biomeIndexAt(earthMap, latLonToUnit(lat, lon))]).toBe(name);
    }
  });

  it('labels every biome present, each anchor inside its own region', () => {
    const present = new Set(earthMap.cells);
    for (const id of present) {
      const regions = earthMap.regions.filter(r => r.biome === id);
      expect(regions.length, earthMap.names[id]).toBeGreaterThan(0);
      for (const r of regions) expect(earthMap.names[biomeIndexAt(earthMap, r.anchor)]).toBe(earthMap.names[id]);
    }
    expect(earthMap.regions[0].area).toBeGreaterThanOrEqual(earthMap.regions[1].area);
    expect(earthMap.names[earthMap.regions[0].biome]).toBe('Oceans');
  });

  it('keeps the launch complex findable even when no cell centre falls inside it', () => {
    const lc = earthMap.regions.find(r => earthMap.names[r.biome] === 'Launch Complex');
    expect(lc).toBeDefined();
    const site = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
    expect(lc!.anchor.x * site.x + lc!.anchor.y * site.y + lc!.anchor.z * site.z).toBeGreaterThan(0.99999);
  });

  it('majority filtering removes isolated speckle but keeps large areas', () => {
    const w = 32, h = 16, grid: BiomeGrid = { body: 'test', width: w, height: h, names: ['A', 'B'], cells: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 16; x < w; x++) grid.cells[y * w + x] = 1; // east half B
    grid.cells[5 * w + 4] = 1; // a lone B cell in A
    smoothBiomeGrid(grid);
    expect(grid.cells[5 * w + 4]).toBe(0);
    expect(grid.cells[8 * w + 24]).toBe(1);
    const regions = biomeRegions(grid, 0);
    expect(regions.map(r => grid.names[r.biome]).sort()).toEqual(['A', 'B']);
  });

  it('has no map for single-biome bodies', () => {
    expect(hasBiomeMap(u.body('jupiter'))).toBe(false);
    expect(hasBiomeMap(u.body('moon'))).toBe(true);
  });
});

describe('biome objectives', () => {
  const contract = (over: Partial<Contract>): Contract => ({ id: 'c', kind: 'science', title: 'Field survey · Earth / Rainforests', body: 'earth', biome: 'Rainforests',
    status: 'active', advance: 0, reward: 0, penalty: 0, reputation: 0, landed: false, ...over });
  it('lists biomes named by accepted contracts only, once each', () => {
    const p = newProgression();
    p.contracts = [contract({ id: 'a' }), contract({ id: 'b' }), contract({ id: 'c', status: 'offered', biome: 'Deserts' }),
      contract({ id: 'd', status: 'completed', biome: 'Tundra' }), contract({ id: 'e', kind: 'orbit', biome: undefined })];
    expect(biomeObjectives(p)).toEqual([{ body: 'earth', biome: 'Rainforests', label: 'Rainforests — contract target', title: 'Field survey · Earth / Rainforests' }]);
  });
});

describe('earth cities', () => {
  it('is ordered by population with valid positions and includes the cities round the launch site', () => {
    expect(EARTH_CITIES.length).toBeGreaterThan(300);
    for (let i = 1; i < EARTH_CITIES.length; i++) expect(EARTH_CITIES[i][3]).toBeLessThanOrEqual(EARTH_CITIES[i - 1][3]);
    for (const [, lat, lon] of EARTH_CITIES) { expect(Math.abs(lat)).toBeLessThanOrEqual(90); expect(Math.abs(lon)).toBeLessThanOrEqual(180); }
    const near = EARTH_CITIES.filter(([, lat, lon]) => Math.hypot(lat - LAUNCH_SITE.lat, (lon - LAUNCH_SITE.lon) * Math.cos(lat * Math.PI / 180)) < 4).map(c => c[0]);
    expect(near).toEqual(expect.arrayContaining(['Orlando', 'Tampa', 'Miami']));
  });
});

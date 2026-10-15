import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Universe } from '../src/game/universe';
import { biomeAt, BIOMES } from '../src/sim/science/biomes';
import { generateContracts } from '../src/sim/science/progression';
import { COVER_CLASSES } from '../src/sim/terrain/earthCover';
import { EARTH_COVER, earthData } from '../src/sim/terrain/earthData';
import { latLonToUnit, LAUNCH_SITE } from '../src/sim/terrain';

const SCALES = ['standard', 'challenging', 'real'] as const;
const biome = (scale: typeof SCALES[number], lat: number, lon: number) => {
  const u = new Universe(scale);
  return biomeAt(u.body('earth'), u.terrain('earth'), latLonToUnit(lat, lon));
};

describe('Earth land cover', () => {
  it('stores the class order the manifest records', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/earth/manifest.json', import.meta.url), 'utf8'));
    const cover = manifest.files.find((f: { path: string }) => f.path === 'cover.u4');
    expect(cover.classes).toEqual([...COVER_CLASSES]);
    expect([cover.width, cover.height]).toEqual([EARTH_COVER.width, EARTH_COVER.height]);
  });

  it('classifies known real places on every scale', () => {
    const places: [number, number, string][] = [
      [-4, -63, 'Rainforests'], [0, 22, 'Rainforests'], // Amazon, Congo basin
      [24, 15, 'Deserts'], [-25, 130, 'Deserts'], // Sahara, Australian interior
      [25.8, -80.8, 'Wetlands'], // Everglades
      [72, -40, 'Ice Caps'], [27.99, 86.93, 'Ice Caps'], [33, 88, 'Mountains'], // Greenland, Everest, Tibetan plateau
      [60, 90, 'Forests'], [72, 100, 'Tundra'], // Siberian taiga, Taymyr tundra
      [47.7, -87.5, 'Lakes'], [42, 50.5, 'Lakes'], [-1, 33, 'Lakes'], // Superior, Caspian, Victoria
      [0, -30, 'Oceans'], [LAUNCH_SITE.lat, LAUNCH_SITE.lon, 'Launch Complex'],
    ];
    for (const scale of SCALES) for (const [lat, lon, name] of places) expect(`${scale} ${lat},${lon} ${biome(scale, lat, lon)}`).toBe(`${scale} ${lat},${lon} ${name}`);
  });

  it('puts wetlands right outside the launch complex on every scale', () => {
    for (const scale of SCALES) {
      const u = new Universe(scale), body = u.body('earth'), t = u.terrain('earth');
      const counts = new Map<string, number>();
      // A ring 3 km (playable) from the pad: a short hop on any scale.
      const arc = 3000 / body.radius * 180 / Math.PI;
      for (let a = 0; a < 360; a += 5) {
        const r = a * Math.PI / 180;
        const name = biomeAt(body, t, latLonToUnit(LAUNCH_SITE.lat + arc * Math.cos(r), LAUNCH_SITE.lon + arc * Math.sin(r) / Math.cos(LAUNCH_SITE.lat * Math.PI / 180)));
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const land = [...counts].filter(([name]) => name !== 'Oceans').sort((a, b) => b[1] - a[1]);
      expect(land[0][0]).toBe('Wetlands');
    }
  });

  it('keeps legacy biome IDs first and in order, so saved science and contracts stay valid', () => {
    expect(BIOMES.earth.slice(0, 10)).toEqual(['Oceans', 'Shores', 'Grasslands', 'Deserts', 'Mountains', 'Ice Caps', 'Launch Complex', 'Forests', 'Rainforests', 'Tundra']);
    expect(BIOMES.earth.slice(10)).toEqual(['Wetlands', 'Lakes']);
  });

  it('can reach every Earth biome a contract may name', () => {
    const u = new Universe('standard'), body = u.body('earth'), t = u.terrain('earth'), seen = new Set<string>();
    for (let lat = -89.5; lat < 90; lat += 0.5) for (let lon = -180; lon < 180; lon += 0.5) seen.add(biomeAt(body, t, latLonToUnit(lat, lon)));
    seen.add(biomeAt(body, t, latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon)));
    expect([...BIOMES.earth].filter(name => !seen.has(name))).toEqual([]);
    const named = new Set<string>();
    for (let batch = 1; batch < 400; batch++) named.add(generateContracts(17, batch)[2].biome!);
    expect([...named].every(name => seen.has(name))).toBe(true);
    expect(named.has('Wetlands')).toBe(true);
  });

  it('is deterministic and free of speckle: every class region spans at least 8 cells', () => {
    const { width: W, height: H } = EARTH_COVER, grid = earthData();
    const cells = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[y * W + x] = grid.coverCell(x, y);
    expect(grid.coverCell(-1, 5)).toBe(cells[5 * W + W - 1]);
    const seen = new Uint8Array(W * H);
    let smallest = Infinity;
    for (let start = 0; start < W * H; start++) {
      if (seen[start]) continue;
      const stack = [start], cls = cells[start];
      seen[start] = 1;
      let size = 0;
      while (stack.length) {
        const i = stack.pop()!, x = i % W, y = (i - x) / W;
        size++;
        for (const j of [y * W + (x + W - 1) % W, y * W + (x + 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j >= 0 && !seen[j] && cells[j] === cls) { seen[j] = 1; stack.push(j); }
        }
      }
      smallest = Math.min(smallest, size);
    }
    expect(smallest).toBeGreaterThanOrEqual(8);
  });
});

import { BIOMES, GENERIC_BIOMES, biomeAt } from './biomes';
import type { Body } from '../bodies/types';
import type { Terrain } from '../terrain/api';
import type { Vec3 } from '../../util/vec3';
import { LAUNCH_SITE, latLonToUnit } from '../terrain';

/**
 * Biome classification sampled on an equirectangular grid (row 0 at the north pole, column 0 at longitude −180°,
 * the Earth imagery convention: u = lon/2π + 0.5, v = 0.5 − lat/π). Each cell holds an index into `names`, from
 * `biomeAt` at the cell centre, so the map shows exactly the rules that science uses.
 */
export interface BiomeGrid {
  body: string;
  width: number;
  height: number;
  names: string[];
  cells: Uint8Array;
}

/** A connected patch of one biome, labelled at its most interior cell. */
export interface BiomeRegion {
  biome: number;
  /** Solid angle (steradians). */
  area: number;
  /** Body-fixed unit vector of the label anchor (inside the region). */
  anchor: Vec3;
}

export interface BiomeMap extends BiomeGrid { regions: BiomeRegion[] }

/** Bodies whose surface is one biome need no map. */
export function biomeNames(body: Body): readonly string[] {
  if (body.kind === 'asteroid' || body.kind === 'comet') return ['Surface'];
  if (!body.solidSurface) return ['Atmospheric Bands'];
  return BIOMES[body.id] ?? GENERIC_BIOMES;
}

export function hasBiomeMap(body: Body): boolean {
  return biomeNames(body).length > 1;
}

/** Earth's rules are cheap and its coastlines need detail; slope-based rules elsewhere cost ~15 µs per sample. */
export function biomeGridSize(body: Body): { width: number; height: number } {
  return body.id === 'earth' ? { width: 2048, height: 1024 } : { width: 512, height: 256 };
}

export function cellDirection(width: number, height: number, x: number, y: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const lat = (0.5 - (y + 0.5) / height) * Math.PI, lon = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
  out.x = Math.cos(lat) * Math.cos(lon); out.y = Math.cos(lat) * Math.sin(lon); out.z = Math.sin(lat);
  return out;
}

export function createBiomeGrid(body: Body, width: number, height: number): BiomeGrid {
  return { body: body.id, width, height, names: [...biomeNames(body)], cells: new Uint8Array(width * height) };
}

/** Classify rows [y0, y1) (callers can slice the work). */
export function fillBiomeRows(grid: BiomeGrid, body: Body, terrain: Terrain, y0: number, y1: number): void {
  const { width, height, names, cells } = grid;
  const index = new Map(names.map((n, i) => [n, i]));
  const d: Vec3 = { x: 0, y: 0, z: 0 };
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) {
    const name = biomeAt(body, terrain, cellDirection(width, height, x, y, d));
    let i = index.get(name);
    if (i === undefined) { i = names.length; names.push(name); index.set(name, i); }
    cells[y * width + x] = i;
  }
}

/** Biome index at a body-fixed direction (nearest cell). */
export function biomeIndexAt(grid: BiomeGrid, d: Vec3): number {
  const r = Math.hypot(d.x, d.y, d.z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, d.z / r))), lon = Math.atan2(d.y, d.x);
  const x = Math.min(grid.width - 1, Math.floor((lon / (2 * Math.PI) + 0.5) * grid.width));
  const y = Math.min(grid.height - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * grid.height)));
  return grid.cells[y * grid.width + x];
}

/**
 * Connected regions (4-neighbour, wrapping in longitude) of at least `minArea` steradians, plus the largest
 * region of every biome present, largest first (at most `maxRegions` beyond those). The
 * anchor is the cell farthest from the region's edge (chamfer distance, east–west distances scaled by cos(lat)),
 * so a label sits inside crescents and coastal strips instead of at an outside centroid.
 */
export function biomeRegions(grid: BiomeGrid, minArea = 0.002, maxRegions = 48): BiomeRegion[] {
  const { width: w, height: h, cells } = grid;
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const cellArea = (y: number) => (2 * Math.PI / w) * (Math.PI / h) * Math.cos((0.5 - (y + 0.5) / h) * Math.PI);
  const areas: number[] = [], biomes: number[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] >= 0) continue;
    const id = areas.length, biome = cells[start];
    let top = 0, area = 0;
    stack[top++] = start; label[start] = id;
    while (top) {
      const c = stack[--top], x = c % w, y = (c - x) / w;
      area += cellArea(y);
      const visit = (k: number) => { if (label[k] < 0 && cells[k] === biome) { label[k] = id; stack[top++] = k; } };
      visit(y * w + (x + 1) % w); visit(y * w + (x + w - 1) % w);
      if (y > 0) visit(c - w);
      if (y < h - 1) visit(c + w);
    }
    areas.push(area); biomes.push(biome);
  }
  // Interior distance: two chamfer passes over cells, 0 at any cell whose neighbour belongs to another region.
  const dist = new Float32Array(n);
  const scaleX = new Float32Array(h);
  for (let y = 0; y < h; y++) scaleX[y] = Math.max(0.05, Math.cos((0.5 - (y + 0.5) / h) * Math.PI));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y * w + x, l = label[c];
    const edge = label[y * w + (x + 1) % w] !== l || label[y * w + (x + w - 1) % w] !== l
      || (y > 0 && label[c - w] !== l) || (y < h - 1 && label[c + w] !== l);
    dist[c] = edge ? 0 : Infinity;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y * w + x;
    if (dist[c] === 0) continue;
    let d = dist[c];
    if (x > 0) d = Math.min(d, dist[c - 1] + scaleX[y]);
    if (y > 0) d = Math.min(d, dist[c - w] + 1);
    dist[c] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const c = y * w + x;
    if (dist[c] === 0) continue;
    let d = dist[c];
    if (x < w - 1) d = Math.min(d, dist[c + 1] + scaleX[y]);
    if (y < h - 1) d = Math.min(d, dist[c + w] + 1);
    dist[c] = d;
  }
  // Every biome present keeps at least its largest patch, however small, so it can still be found.
  const largest = new Map<number, number>();
  for (let l = 0; l < areas.length; l++) if (!(areas[largest.get(biomes[l]) ?? -1] >= areas[l])) largest.set(biomes[l], l);
  const keep = (l: number) => areas[l] >= minArea || largest.get(biomes[l]) === l;
  const best = new Int32Array(areas.length).fill(-1);
  for (let c = 0; c < n; c++) {
    const l = label[c];
    if (!keep(l)) continue;
    if (best[l] < 0 || dist[c] > dist[best[l]]) best[l] = c;
  }
  const regions: BiomeRegion[] = [];
  for (let l = 0; l < areas.length; l++) {
    if (best[l] < 0) continue;
    const x = best[l] % w, y = (best[l] - x) / w;
    regions.push({ biome: biomes[l], area: areas[l], anchor: cellDirection(w, h, x, y) });
  }
  regions.sort((a, b) => b.area - a.area);
  const seen = new Set<number>();
  return regions.filter((r, i) => { const first = !seen.has(r.biome); seen.add(r.biome); return i < maxRegions || first; });
}

/** Full grid plus regions: the work a worker does once per body. */
export function buildBiomeMap(body: Body, terrain: Terrain, size = biomeGridSize(body)): BiomeMap {
  const grid = createBiomeGrid(body, size.width, size.height);
  fillBiomeRows(grid, body, terrain, 0, size.height);
  const regions = biomeRegions(grid);
  // The launch complex disc (2.5 km) can fall between cell centres: it is still a biome a player may be sent to.
  if (body.id === 'earth' && !regions.some(r => grid.names[r.biome] === 'Launch Complex')) {
    let index = grid.names.indexOf('Launch Complex');
    if (index < 0) index = grid.names.push('Launch Complex') - 1;
    regions.push({ biome: index, area: Math.PI * (2500 / body.radius) ** 2, anchor: latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon) });
  }
  return { ...grid, regions };
}

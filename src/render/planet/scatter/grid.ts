import type { BodyDef } from '../../../sim/bodies/types';
import type { Terrain, RGB } from '../../../sim/terrain/api';
import { LAUNCH_SITE, latLonToUnit } from '../../../sim/terrain';

export const CELL_SIZE = 64;
export interface Cell { key: string; face: number; x: number; y: number; n: number; center: [number, number, number] }
export function direction(face: number, u: number, v: number): [number, number, number] {
  const p: [number, number, number] = face < 2 ? [face === 0 ? 1 : -1, u, v] : face < 4 ? [u, face === 2 ? 1 : -1, v] : [u, v, face === 4 ? 1 : -1];
  const l = Math.hypot(...p);
  return [p[0] / l, p[1] / l, p[2] / l];
}
export function nearbyCells(radius: number, camera: [number, number, number], range: number): Cell[] {
  const len = Math.hypot(...camera), d = camera.map(v => v / len);
  const n = Math.ceil(2 * radius / (CELL_SIZE * 1.6)), reach = Math.ceil(range * 2 / CELL_SIZE) + 2;
  const cells: Cell[] = [];
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2), denom = d[axis] * (face % 2 === 0 ? 1 : -1);
    if (denom < 0.5) continue;
    const a = axis === 0 ? 1 : 0, b = axis === 2 ? 1 : 2;
    const cx = Math.floor((d[a] / denom + 1) * n / 2), cy = Math.floor((d[b] / denom + 1) * n / 2);
    for (let x = Math.max(0, cx - reach); x <= Math.min(n - 1, cx + reach); x++) {
      for (let y = Math.max(0, cy - reach); y <= Math.min(n - 1, cy + reach); y++) {
        const p = direction(face, (x + 0.5) * 2 / n - 1, (y + 0.5) * 2 / n - 1);
        if (Math.hypot(p[0] - d[0], p[1] - d[1], p[2] - d[2]) * radius > range + CELL_SIZE) continue;
        cells.push({ key: `${face}:${x}:${y}`, face, x, y, n, center: p.map(v => v * radius) as [number, number, number] });
      }
    }
  }
  return cells.sort((a, b) => Math.hypot(...a.center.map((v, i) => v - d[i] * radius)) - Math.hypot(...b.center.map((v, i) => v - d[i] * radius)));
}
export function randomFor(seed: number, cell: Cell): () => number {
  let s = (seed ^ Math.imul(cell.x + 1, 73856093) ^ Math.imul(cell.y + 1, 19349663) ^ Math.imul(cell.face + 1, 83492791)) >>> 0;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const site = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
export function surfaceClass(body: BodyDef, terrain: Terrain, d: [number, number, number], h: number, slope: number): 'none' | 'rock' | 'green' {
  if (body.id === 'earth' && Math.hypot(d[0] - site.x, d[1] - site.y, d[2] - site.z) * body.radius < LAUNCH_SITE.sceneryRadius) return 'none';
  if (terrain.ocean && h <= (terrain.liquid?.level ?? 0)) return 'none';
  if (body.id !== 'earth') return 'rock';
  const c: RGB = [0, 0, 0]; terrain.colorAt?.(...d, h, c);
  if (c[0] > 0.55 || Math.abs(d[2]) > 0.94) return 'none';
  if (slope > 0.24 || h > (body.surface?.relief ?? 1) * 0.22) return 'rock';
  return c[1] > c[0] * 1.05 && c[1] > c[2] * 1.2 && slope < 0.18 ? 'green' : 'none';
}

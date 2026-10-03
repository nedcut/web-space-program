import type { Vec3 } from '../../util/vec3';
import type { Mat3 } from './mat3';
import type { PartDef } from './types';

/** Face order used everywhere for per-direction areas: +X, -X, +Y, -Y, +Z, -Z. */
export const FACE_DIRS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/** Face index for a direction (largest absolute component). */
export function faceIndex(d: Vec3): number {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return d.x >= 0 ? 0 : 1;
  if (ay >= az) return d.y >= 0 ? 2 : 3;
  return d.z >= 0 ? 4 : 5;
}

/** Projected area of each face direction, m^2. */
export function faceAreas(def: PartDef): number[] {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const side = s.height * (s.radiusTop + s.radiusBottom);
    return [side, side, Math.PI * s.radiusTop ** 2, Math.PI * s.radiusBottom ** 2, side, side];
  }
  const { x, y, z } = s.size;
  return [y * z, y * z, x * z, x * z, x * y, x * y];
}

/** Effective nose radius for stagnation heating, per face, m. */
export function faceNoseRadius(def: PartDef): number[] {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const avg = (s.radiusTop + s.radiusBottom) / 2;
    return [avg, avg, s.radiusTop, s.radiusBottom, avg, avg].map((r) => Math.max(0.05, r));
  }
  return faceAreas(def).map((a) => Math.max(0.05, Math.sqrt(a / Math.PI)));
}

/** Actual (curved) surface area attributed to each face direction, m^2. */
export function faceSurfaceAreas(def: PartDef): number[] {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const a = s.radiusTop, b = s.radiusBottom;
    const q = (Math.PI * (a + b) * Math.hypot(s.height, a - b)) / 4;
    return [q, q, Math.PI * a * a, Math.PI * b * b, q, q];
  }
  return faceAreas(def);
}

export function shapeVolume(def: PartDef): number {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const a = s.radiusTop, b = s.radiusBottom;
    return (Math.PI * s.height * (a * a + a * b + b * b)) / 3;
  }
  return s.size.x * s.size.y * s.size.z;
}

export function surfaceArea(def: PartDef): number {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const a = s.radiusTop, b = s.radiusBottom;
    const slant = Math.hypot(s.height, a - b);
    return Math.PI * (a + b) * slant + Math.PI * (a * a + b * b);
  }
  const { x, y, z } = s.size;
  return 2 * (x * y + y * z + z * x);
}

/** Inertia tensor of a part about its own centre, part frame (solid cylinder/frustum or box). */
export function localInertia(def: PartDef, mass: number): Mat3 {
  const s = def.shape;
  if (s.kind === 'cylinder') {
    const a = s.radiusTop, b = s.radiusBottom;
    const r2 = (a * a + a * b + b * b) / 3;
    const ia = 0.5 * mass * r2;
    const it = (mass * (3 * r2 + s.height * s.height)) / 12;
    return [it, 0, 0, 0, ia, 0, 0, 0, it];
  }
  const { x, y, z } = s.size;
  return [(mass * (y * y + z * z)) / 12, 0, 0, 0, (mass * (x * x + z * z)) / 12, 0, 0, 0, (mass * (x * x + y * y)) / 12];
}

/** Contact sample points on the part's hull, part frame. */
export function hullPoints(def: PartDef): Vec3[] {
  const s = def.shape;
  const pts: Vec3[] = [];
  if (s.kind === 'cylinder') {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pts.push({ x: c * s.radiusTop, y: s.height / 2, z: sn * s.radiusTop });
      pts.push({ x: c * s.radiusBottom, y: -s.height / 2, z: sn * s.radiusBottom });
    }
    return pts;
  }
  const { x, y, z } = s.size;
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) pts.push({ x: sx * x, y: sy * y, z: sz * z });
  return pts;
}

/** Radius of a sphere around the part centre enclosing the shape. */
export function shapeRadius(def: PartDef): number {
  const s = def.shape;
  if (s.kind === 'cylinder') return Math.hypot(Math.max(s.radiusTop, s.radiusBottom), s.height / 2);
  return 0.5 * Math.hypot(s.size.x, s.size.y, s.size.z);
}

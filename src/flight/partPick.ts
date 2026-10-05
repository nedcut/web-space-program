import type { PartState } from '../sim/vessel/runtime';
import { qConj, qRotate, type Quat } from '../util/quat';
import { add, sub, type Vec3 } from '../util/vec3';

/**
 * Analytic part picking against the simulation's collision shapes (no render-mesh dependency, so static batching
 * and impostors do not matter). Inputs are camera-relative (floating origin) float64 values.
 */

/** Ray/shape distance in the part frame, or Infinity. Cylinders use their larger radius. */
function hitShape(part: PartState, o: Vec3, d: Vec3): number {
  const s = part.def.shape;
  const slab = (lo: Vec3, hi: Vec3) => {
    let t0 = -Infinity, t1 = Infinity;
    for (const k of ['x', 'y', 'z'] as const) {
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return Infinity; continue; }
      const a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
    }
    return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
  };
  if (s.kind === 'box') {
    const h = { x: s.size.x / 2, y: s.size.y / 2, z: s.size.z / 2 };
    return slab({ x: -h.x, y: -h.y, z: -h.z }, h);
  }
  const r = Math.max(s.radiusTop, s.radiusBottom, 0.05), hh = Math.max(s.height, 0.05) / 2;
  // Infinite cylinder about Y, clipped by the end caps.
  const a = d.x * d.x + d.z * d.z, b = 2 * (o.x * d.x + o.z * d.z), c = o.x * o.x + o.z * o.z - r * r;
  let best = Infinity;
  if (a > 1e-12) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
      if (t >= 0 && Math.abs(o.y + t * d.y) <= hh) best = Math.min(best, t);
    }
  }
  if (Math.abs(d.y) > 1e-12) for (const y of [-hh, hh]) {
    const t = (y - o.y) / d.y;
    const px = o.x + t * d.x, pz = o.z + t * d.z;
    if (t >= 0 && px * px + pz * pz <= r * r) best = Math.min(best, t);
  }
  if (c <= 0 && Math.abs(o.y) <= hh) best = 0;
  return best;
}

/**
 * Closest part hit by a ray. `vesselPos` is the vessel COM relative to the ray origin frame, `orientation`
 * body → world, `com` the body-frame COM.
 */
export function pickPartAlongRay(parts: readonly PartState[], com: Vec3, vesselPos: Vec3, orientation: Quat, rayOrigin: Vec3, rayDir: Vec3): { uid: number; distance: number } | null {
  const inv = qConj(orientation);
  const ob = add(qRotate(inv, sub(rayOrigin, vesselPos)), com);
  const db = qRotate(inv, rayDir);
  let best: { uid: number; distance: number } | null = null;
  for (const p of parts) {
    if (p.link) continue;
    const pi = qConj(p.rotation);
    const t = hitShape(p, qRotate(pi, sub(ob, p.position)), qRotate(pi, db));
    if (t < (best?.distance ?? Infinity)) best = { uid: p.uid, distance: t };
  }
  return best;
}

/** World (camera-relative) position of a part centre. */
export function partWorldPosition(part: PartState, com: Vec3, vesselPos: Vec3, orientation: Quat): Vec3 {
  return add(vesselPos, qRotate(orientation, sub(part.position, com)));
}

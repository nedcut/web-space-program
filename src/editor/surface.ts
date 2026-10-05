import type { PartDef } from '../sim/vessel/types';
import { surfaceMount } from './core';
import { qNormalize, qRotate, type Quat } from '../util/quat';
import { v3, type Vec3 } from '../util/vec3';

/**
 * Surface-attachment helpers shared by the 3D view and the stock-craft builder. The mount convention itself
 * (catalogue 'srf' node at the -Z face, part extending along +Z) lives in the editor core (`surfaceMount`);
 * this only picks the preferred orientation: +Z along the outward normal, +Y as close to `up` as possible.
 */

/** Root transform placing `def`'s mount point at `point` on a surface with outward `normal`. */
export function surfaceTransform(def: PartDef, point: Vec3, normal: Vec3, up: Vec3, extra?: Quat): { position: Vec3; rotation: Quat } {
  let rotation = surfaceBasis(normal, up);
  if (extra) rotation = qNormalize(mul(rotation, extra));
  const m = qRotate(rotation, surfaceMount(def).position);
  return { position: v3(point.x - m.x, point.y - m.y, point.z - m.z), rotation };
}

/** Orientation for a radial part: local +Z along `normal` (outward), local +Y as close to `up` as possible. */
function surfaceBasis(normal: Vec3, up: Vec3): Quat {
  const z = norm(normal);
  let y = sub(up, scale(z, dot(up, z)));
  if (Math.hypot(y.x, y.y, y.z) < 1e-4) y = Math.abs(z.y) < 0.9 ? v3(0, 1, 0) : v3(0, 0, -1);
  y = norm(sub(y, scale(z, dot(y, z))));
  const x = cross(y, z);
  return quatFromBasis(x, y, z);
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, s: number) => v3(a.x * s, a.y * s, a.z * s);
const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a: Vec3) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };
const mul = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/** Rotation matrix with columns x, y, z -> quaternion. */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return qNormalize(q);
}

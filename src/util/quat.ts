import type { Vec3 } from './vec3';

/** Double-precision unit quaternion (x, y, z, w). Rotates body frame -> parent/inertial frame. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export const qMul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

export const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export const qNormalize = (q: Quat): Quat => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};

export const qFromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const h = angle / 2;
  const s = Math.sin(h);
  const l = Math.hypot(axis.x, axis.y, axis.z) || 1;
  return { x: (axis.x / l) * s, y: (axis.y / l) * s, z: (axis.z / l) * s, w: Math.cos(h) };
};

/** Rotate vector v by quaternion q. */
export const qRotate = (q: Quat, v: Vec3): Vec3 => {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};

/** Integrate orientation by body-frame angular velocity omega (rad/s) over dt. */
export const qIntegrate = (q: Quat, omegaBody: Vec3, dt: number): Quat => {
  const ang = Math.hypot(omegaBody.x, omegaBody.y, omegaBody.z) * dt;
  if (ang < 1e-12) return q;
  return qNormalize(qMul(q, qFromAxisAngle(omegaBody, ang)));
};

/** Shortest rotation taking unit vector a to unit vector b. */
export const qFromTo = (a: Vec3, b: Vec3): Quat => {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  if (d < -0.999999) {
    let axis = { x: 0, y: -a.z, z: a.y };
    if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) axis = { x: a.z, y: 0, z: -a.x };
    return qFromAxisAngle(axis, Math.PI);
  }
  const c = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  return qNormalize({ x: c.x, y: c.y, z: c.z, w: 1 + d });
};

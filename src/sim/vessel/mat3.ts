import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';

/** Row-major 3x3 matrix (float64). m[r*3+c]. */
export type Mat3 = number[];

export const m3Zero = (): Mat3 => [0, 0, 0, 0, 0, 0, 0, 0, 0];
export const m3Identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const m3Diag = (a: number, b: number, c: number): Mat3 => [a, 0, 0, 0, b, 0, 0, 0, c];

export const m3MulVec = (m: Mat3, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
});

export const m3Mul = (a: Mat3, b: Mat3): Mat3 => {
  const o = m3Zero();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};

export const m3Transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const m3AddInPlace = (out: Mat3, b: Mat3): Mat3 => {
  for (let i = 0; i < 9; i++) out[i] += b[i];
  return out;
};

export const m3Scale = (m: Mat3, s: number): Mat3 => m.map((x) => x * s);

/** Rotation matrix equivalent to rotating by q (q rotates local -> parent). */
export const m3FromQuat = (q: Quat): Mat3 => {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
};

/** R * I * R^T: express a tensor given in a local frame in the parent frame. */
export const m3RotateTensor = (R: Mat3, I: Mat3): Mat3 => m3Mul(m3Mul(R, I), m3Transpose(R));

export const m3Det = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

export const m3Inverse = (m: Mat3): Mat3 => {
  const det = m3Det(m);
  if (Math.abs(det) < 1e-300) return m3Zero();
  const id = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * id,
    (m[2] * m[7] - m[1] * m[8]) * id,
    (m[1] * m[5] - m[2] * m[4]) * id,
    (m[5] * m[6] - m[3] * m[8]) * id,
    (m[0] * m[8] - m[2] * m[6]) * id,
    (m[2] * m[3] - m[0] * m[5]) * id,
    (m[3] * m[7] - m[4] * m[6]) * id,
    (m[1] * m[6] - m[0] * m[7]) * id,
    (m[0] * m[4] - m[1] * m[3]) * id,
  ];
};

/** Parallel-axis term m(|d|^2 E - d d^T). */
export const m3ParallelAxis = (m: number, d: Vec3): Mat3 => {
  const dd = d.x * d.x + d.y * d.y + d.z * d.z;
  return [
    m * (dd - d.x * d.x), -m * d.x * d.y, -m * d.x * d.z,
    -m * d.y * d.x, m * (dd - d.y * d.y), -m * d.y * d.z,
    -m * d.z * d.x, -m * d.z * d.y, m * (dd - d.z * d.z),
  ];
};

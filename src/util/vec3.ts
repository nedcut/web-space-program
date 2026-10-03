/**
 * Double-precision 3D vector math for the simulation layer.
 * The sim never uses three.js types; rendering converts to float32 relative to a floating origin.
 *
 * Convention: inertial frame is ecliptic J2000-like, right-handed, +Z = ecliptic north.
 * Units: meters, seconds, kilograms, radians.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : v3();
};
export const negate = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => addScaled(a, sub(b, a), t);

/** In-place helpers for hot loops (avoid allocation). */
export const addInPlace = (out: Vec3, b: Vec3): Vec3 => {
  out.x += b.x; out.y += b.y; out.z += b.z;
  return out;
};
export const addScaledInPlace = (out: Vec3, b: Vec3, s: number): Vec3 => {
  out.x += b.x * s; out.y += b.y * s; out.z += b.z * s;
  return out;
};
export const set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x; out.y = y; out.z = z;
  return out;
};

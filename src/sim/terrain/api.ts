/**
 * CONTRACT (owned by terrain module). Deterministic terrain height used by BOTH physics (collision)
 * and renderer (mesh generation) so they always agree.
 *
 * heightAt(bodyId, x, y, z): (x,y,z) is a unit vector in the BODY-FIXED frame (rotates with the body,
 * +Z = north pole, +X = prime meridian). Returns meters above the body's datum radius (may be negative;
 * oceans clamp to 0 visually but physics floats on water at 0).
 */
export type TerrainHeightFn = (x: number, y: number, z: number) => number;

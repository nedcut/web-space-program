/**
 * CONTRACT (owned by terrain module). Deterministic terrain height used by BOTH physics (collision)
 * and renderer (mesh generation) so they always agree.
 *
 * heightAt(bodyId, x, y, z): (x,y,z) is a unit vector in the BODY-FIXED frame (rotates with the body,
 * +Z = north pole, +X = prime meridian). Returns meters above the body's datum radius (may be negative;
 * liquids use the shared body-specific level for rendering and buoyancy).
 */
export type TerrainHeightFn = (x: number, y: number, z: number) => number;

/** Linear-RGB albedo output (0..1), written in place to avoid allocation in hot loops. */
export type RGB = [number, number, number];

/**
 * A body's procedural terrain. Created by `createTerrain(body)` in ./index.ts.
 * Everything is deterministic (seeded from `surface.seed`) and DOM/three-free, so the same
 * object can run in physics, in Web Workers (mesh building) and in Node tests.
 */
export interface Terrain {
  /** Height in meters above datum radius for a body-fixed unit vector. */
  heightAt: TerrainHeightFn;
  /** Upper bound on heightAt (meters). heightAt(...) <= maxHeight for every direction. */
  maxHeight: number;
  /** Lower bound on heightAt (meters, usually negative or 0). */
  minHeight: number;
  /** True if the body has a liquid surface (liquid.level, or legacy datum zero). */
  ocean: boolean;
  /** Shared liquid datum (metres) and bulk density (kg/m³). */
  liquid?: { level: number; density: number; kind: 'water' | 'hydrocarbon' };
  /**
   * Surface albedo (linear RGB) at unit vector (x,y,z) with precomputed height h (meters).
   * Used for vertex colours and baked far-LOD textures. Optional: renderer falls back to palette.
   * `footprint` is the sample spacing as an angle (radians on the unit sphere): colour features smaller than a
   * few samples fade out instead of aliasing into per-vertex speckle. Omitted = full detail.
   */
  colorAt?(x: number, y: number, z: number, h: number, out: RGB, footprint?: number): RGB;
}

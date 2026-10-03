import { hash3, hashNext } from './noise';
import { smax, smin, clamp } from './fbm';

/**
 * Deterministic procedural crater field on the unit sphere.
 *
 * Each octave tiles 3D space with cubic cells of size `cell`; cells straddling the unit sphere may
 * contain one crater (probability `density`) whose centre is hashed from the cell coordinates.
 * Only neighbouring cells that can influence the query point are visited (~8–12 per octave),
 * so the cost is a few hundred integer hashes worst case — microseconds.
 *
 * Profile (r = distance / craterRadius):
 *   cavity  = r² − 1                      (parabolic bowl)
 *   rim     = rimSteep · min(r − 1 − rimW, 0)²
 *   floor   = −floorDepth                 (flat floor for large complex craters)
 *   h       = smin(smax(cavity, floor), rim)  + central peak
 * Heights are relative (−1 = full depth); the caller scales by an octave depth in meters.
 */
export interface CraterOctave {
  /** Cell size on the unit sphere. */
  cell: number;
  /** Probability a cell has a crater. */
  density: number;
  /** Depth (meters) of the deepest crater in this octave. */
  depth: number;
  /** 0..1 — fraction of craters in this octave that are "fresh" (sharp rims, bright ejecta). */
  freshness: number;
  /** Large craters get flat floors and central peaks. */
  complex: boolean;
}

export interface CraterFieldOptions {
  seed: number;
  octaves: CraterOctave[];
  /** Max crater radius as fraction of cell (<= 0.5). */
  maxRadius?: number;
}

/** Build a typical power-law crater population: big rare craters → many small ones. */
export function makeCraterOctaves(opts: {
  /** Largest cell size (unit sphere). */
  largestCell: number;
  /** Smallest cell size (unit sphere). */
  smallestCell: number;
  /** Depth of largest craters (meters) — used when `bodyRadius` is not given. */
  largestDepth: number;
  /**
   * If set, depth follows a physical depth/diameter ratio (≈0.2 simple → ≈0.08 large complex craters)
   * computed from the crater size in meters, clamped to `largestDepth` per octave.
   */
  bodyRadius?: number;
  /** Cell size ratio per octave (0..1). */
  ratio?: number;
  density?: number;
  /** Depth falloff exponent vs size (depth ∝ size^exp). */
  depthExponent?: number;
  freshness?: number;
}): CraterOctave[] {
  const ratio = opts.ratio ?? 0.5;
  const out: CraterOctave[] = [];
  let cell = opts.largestCell;
  let i = 0;
  while (cell >= opts.smallestCell * 0.999 && i < 24) {
    const sizeRel = cell / opts.largestCell;
    let depth = opts.largestDepth * Math.pow(sizeRel, opts.depthExponent ?? 0.75);
    if (opts.bodyRadius) {
      const diameter = 2 * 0.2 * cell * opts.bodyRadius; // typical crater diameter in this octave
      const ratio = diameter < 15000 ? 0.19 : diameter < 60000 ? 0.12 : 0.07;
      depth = Math.min(opts.largestDepth, ratio * diameter);
    }
    out.push({
      cell,
      density: Math.min(0.97, (opts.density ?? 0.55) * 1.35 * (i === 0 ? 0.6 : 1)),
      depth,
      freshness: Math.min(1, (opts.freshness ?? 0.3) + i * 0.04),
      complex: i < 3,
    });
    cell *= ratio;
    i++;
  }
  return out;
}

export class CraterField {
  readonly octaves: CraterOctave[];
  private readonly seed: number;
  private readonly maxR: number;
  /** Sum of octave depths — bound for |height| contribution (rims bounded by 0.35·depth). */
  readonly maxDepth: number;
  /** Side output of the last `height` call: ejecta/ray brightness 0..1 (for colouring). */
  ejecta = 0;
  /** Side output: 1 inside a crater floor (for colouring). */
  inside = 0;

  constructor(opts: CraterFieldOptions) {
    this.octaves = opts.octaves;
    this.seed = opts.seed | 0;
    this.maxR = Math.min(0.5, opts.maxRadius ?? 0.32);
    this.maxDepth = this.octaves.reduce((s, o) => s + o.depth, 0);
  }

  /**
   * Height contribution (meters) at unit vector p. `attenuate(octaveIndex)` optionally scales
   * an octave (e.g. maria flooding erases older large craters). Also sets `ejecta`/`inside`.
   */
  height(x: number, y: number, z: number, attenuate?: (octave: number) => number): number {
    let total = 0;
    let ejecta = 0;
    let inside = 0;
    const maxR = this.maxR;
    // Height influence ends at ~1.32 radii (rim); ejecta colouring may be clipped slightly at cell borders.
    const reach = maxR * 1.45;
    for (let o = 0; o < this.octaves.length; o++) {
      const oct = this.octaves[o];
      const att = attenuate ? attenuate(o) : 1;
      if (att <= 0.001) continue;
      const c = oct.cell;
      const gx = x / c, gy = y / c, gz = z / c;
      const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
      const fx = gx - ix, fy = gy - iy, fz = gz - iz;
      const x0 = fx < reach ? -1 : 0, x1 = fx > 1 - reach ? 1 : 0;
      const y0 = fy < reach ? -1 : 0, y1 = fy > 1 - reach ? 1 : 0;
      const z0 = fz < reach ? -1 : 0, z1 = fz > 1 - reach ? 1 : 0;
      const seed = this.seed + o * 7919;
      let octH = 0;
      for (let dx = x0; dx <= x1; dx++) {
        for (let dy = y0; dy <= y1; dy++) {
          for (let dz = z0; dz <= z1; dz++) {
            const cx = ix + dx, cy = iy + dy, cz = iz + dz;
            // Cheap radial reject before hashing: only cells straddling the unit sphere can host craters.
            const ccx = (cx + 0.5) * c, ccy = (cy + 0.5) * c, ccz = (cz + 0.5) * c;
            const rc = Math.sqrt(ccx * ccx + ccy * ccy + ccz * ccz);
            if (Math.abs(rc - 1) > c * 1.37) continue;
            // One hash → density test (8 bits) + centre offsets (3×8 bits); a second for size/freshness.
            const h = hash3(cx, cy, cz, seed);
            if ((h & 255) * (1 / 256) > oct.density) continue;
            const rx = ((h >>> 8) & 255) * (1 / 256) + 1 / 512;
            const ry = ((h >>> 16) & 255) * (1 / 256) + 1 / 512;
            const rz = (h >>> 24) * (1 / 256) + 1 / 512;
            // Crater centre in cell → keep only cells whose centre lies near the sphere shell.
            let px = (cx + rx) * c, py = (cy + ry) * c, pz = (cz + rz) * c;
            const pl = Math.sqrt(px * px + py * py + pz * pz);
            if (Math.abs(pl - 1) > c * 0.5 || pl === 0) continue;
            const ddx0 = x - px / pl, ddy0 = y - py / pl, ddz0 = z - pz / pl;
            const d2 = ddx0 * ddx0 + ddy0 * ddy0 + ddz0 * ddz0;
            const lim0 = c * maxR * 1.6;
            if (d2 > lim0 * lim0) continue;
            px /= pl; py /= pl; pz /= pl;
            const h2 = hashNext(h);
            const rs = (h2 & 65535) * (1 / 65536);
            // Size distribution inside an octave: skewed towards small.
            const radius = c * maxR * (0.35 + 0.65 * rs * rs);
            const lim = radius * 1.6;
            if (d2 > lim * lim) continue;
            const r = Math.sqrt(d2) / radius;
            const fresh = (h2 >>> 16) * (1 / 65536) < oct.freshness;
            const sizeScale = radius / (c * maxR);
            const prof = craterProfile(r, oct.complex, fresh);
            octH += prof * sizeScale;
            if (fresh) {
              // Bright rim + ejecta blanket fading to ~1.6 R; interior walls slightly bright.
              const e = r < 0.8 ? 0.15 : r < 1.05 ? 0.15 + 0.85 * (r - 0.8) / 0.25 : Math.max(0, 1 - (r - 1.05) / 0.55);
              ejecta = Math.max(ejecta, e * e * (0.4 + 0.6 * sizeScale));
            }
            if (r < 0.85) inside = Math.max(inside, 1 - r / 0.85);
          }
        }
      }
      total += clamp(octH, -1, 0.35) * oct.depth * att;
    }
    this.ejecta = ejecta;
    this.inside = inside;
    return total;
  }
}

/** Relative crater profile, −1 at the deepest point, ~+0.2..0.35 at the rim, 0 far away. */
export function craterProfile(r: number, complex: boolean, fresh: boolean): number {
  const cavity = r * r - 1;
  const floor = complex ? -0.55 : -1;
  const rimW = fresh ? 0.22 : 0.32;
  const rimSteep = fresh ? 5.5 : 2.5;
  const rx = Math.min(r - 1 - rimW, 0);
  const rim = rimSteep * rx * rx;
  let h = smin(smax(cavity, floor, 0.15), rim, fresh ? 0.12 : 0.3);
  if (complex && r < 0.3) {
    const t = r / 0.3;
    h += 0.45 * (1 - t * t) * (1 - t * t);
  }
  return h;
}

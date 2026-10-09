import { hash3, hashNext } from './noise';
import { smax, smin, clamp } from './fbm';

/**
 * Deterministic procedural crater field on the unit sphere.
 *
 * Each octave tiles 3D space with cubic cells of size `cell`; cells straddling the unit sphere may
 * contain one crater (probability `density`) whose centre is hashed from the cell coordinates.
 * Only cells that can host a crater reaching the query point are hashed (~12 per octave; the centre is
 * projected onto the sphere, so its host can be two cells away). Each octave keeps the craters of its
 * last cell window, so neighbouring queries (chunk vertices) mostly skip hashing — a few microseconds.
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
  /** Per-octave share of `ejecta`, for band-limited colouring (`ejectaAt`). */
  private readonly ejectaOct: Float64Array;
  /**
   * Candidate craters (unit centre xyz, radius, fresh, size scale), so neighbouring queries — chunk
   * vertices, bake texels — skip hashing for octaves whose cell window did not change.
   */
  private readonly list: Float64Array;
  private readonly listStride: number;
  /** Per octave: last cell window x0 y0 z0 x1 y1 z1 and 1 if every crater in it is listed, 0 if only
   * those passing the tests for `queryPoint`. */
  private readonly box: Float64Array;
  private readonly cacheN: Int32Array;
  private readonly queryPoint: Float64Array;

  constructor(opts: CraterFieldOptions) {
    this.octaves = opts.octaves;
    this.seed = opts.seed | 0;
    this.maxR = Math.min(0.5, opts.maxRadius ?? 0.32);
    this.maxDepth = this.octaves.reduce((s, o) => s + o.depth, 0);
    this.ejectaOct = new Float64Array(this.octaves.length);
    // Widest cell window per axis (see `height`): at most 2·w + 1 cells.
    const maxCell = this.octaves.reduce((m, o) => Math.max(m, o.cell), 0);
    const span = Math.floor(2 * (this.maxR * 1.6 * (1 + 0.5 * maxCell) + 0.5 + 1e-9)) + 2;
    this.listStride = span * span * span * 6;
    this.list = new Float64Array(this.listStride * this.octaves.length);
    this.queryPoint = new Float64Array(this.octaves.length * 3);
    this.box = new Float64Array(this.octaves.length * 7).fill(NaN);
    this.cacheN = new Int32Array(this.octaves.length);
  }

  /**
   * Ejecta brightness of the last `height` call, keeping only craters wide enough for samples spaced
   * `footprint` (radians) apart to draw their rim; smaller ones fade out instead of becoming speckle.
   */
  ejectaAt(footprint?: number): number {
    if (!footprint) return this.ejecta;
    let e = 0;
    for (let o = 0; o < this.octaves.length; o++) {
      const v = this.ejectaOct[o];
      if (v <= e) continue;
      const radius = this.octaves[o].cell * this.maxR * 0.6;
      const t = Math.min(1, Math.max(0, (radius / footprint - 1.5) / 2.5));
      e = Math.max(e, v * t * t * (3 - 2 * t));
    }
    return e;
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
    const reach = maxR * 1.6;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    const xx = x * x + y * y + z * z;
    const box = this.box;
    const list = this.list;
    const stride = this.listStride;
    const qp = this.queryPoint;
    for (let o = 0; o < this.octaves.length; o++) {
      const oct = this.octaves[o];
      const att = attenuate ? attenuate(o) : 1;
      if (att <= 0.001) { this.ejectaOct[o] = 0; continue; }
      const c = oct.cell;
      // A crater influences points up to 1.6 radii ≤ reach·c from its centre (ejecta; height ends at
      // ~1.32 radii). The centre is hashed inside its host cell, then projected onto the sphere, which
      // moves it radially by up to c/2: along axis i by up to c/2·|q_i| with |q_i| ≤ |x_i| + reach·c.
      // So the host cell can be a further cell away; visiting only adjacent cells cut such craters off.
      const gx = x / c, gy = y / c, gz = z / c;
      const w = reach + 0.5 * reach * c + 1e-9;
      const wx = w + 0.5 * ax, wy = w + 0.5 * ay, wz = w + 0.5 * az;
      const x0 = Math.floor(gx - wx), x1 = Math.floor(gx + wx);
      const y0 = Math.floor(gy - wy), y1 = Math.floor(gy + wy);
      const z0 = Math.floor(gz - wz), z1 = Math.floor(gz + wz);
      const seed = this.seed + o * 7919;
      const b = o * 7;
      const base = o * stride;
      let n: number;
      if (box[b] === x0 && box[b + 1] === y0 && box[b + 2] === z0 && box[b + 3] === x1 && box[b + 4] === y1 && box[b + 5] === z1
        && (box[b + 6] === 1 || (qp[o * 3] === x && qp[o * 3 + 1] === y && qp[o * 3 + 2] === z))) {
        // Same cell window as an earlier query: reuse its candidates (all craters of the window, or the
        // ones that passed the point tests below when it is the same point, e.g. colour after height).
        n = this.cacheN[o];
      } else if (box[b] === x0 && box[b + 1] === y0 && box[b + 2] === z0 && box[b + 3] === x1 && box[b + 4] === y1 && box[b + 5] === z1) {
        // Second point in this window: worth listing every crater in it once.
        n = this.fill(base, oct, c, seed, x0, x1, y0, y1, z0, z1);
        this.cacheN[o] = n;
        box[b + 6] = 1;
      } else {
        // New window: test cells directly against x (cheap rejects first) and remember window and point.
        box[b] = x0; box[b + 1] = y0; box[b + 2] = z0; box[b + 3] = x1; box[b + 4] = y1; box[b + 5] = z1; box[b + 6] = 0;
        qp[o * 3] = x; qp[o * 3 + 1] = y; qp[o * 3 + 2] = z;
        n = 0;
        // A host cell holds p = q·pl with |pl − 1| ≤ c/2; q is within lim0 of x iff x·p ≥ pl·K. The cell
        // centre differs from p by at most c/2·Σ|x_i| along x.
        const lim0 = c * reach;
        const K = 0.5 * (xx + 1 - lim0 * lim0);
        const K2 = K * K * (1 - 1e-9);
        const slab = 0.5 * c * (ax + ay + az) + 1e-9;
        const rHi = (1 + 0.5 * c) * (1 + 1e-9) * Math.sqrt(xx) + slab, rLo = (1 - 0.5 * c) * K - slab;
        const plLo = (1 - 0.5 * c) * (1 - 1e-9), plHi = (1 + 0.5 * c) * (1 + 1e-9);
        const pl2Lo = plLo * plLo, pl2Hi = plHi * plHi;
        for (let cx = x0; cx <= x1; cx++) {
          const dX = (cx + 0.5) * c * x;
          for (let cy = y0; cy <= y1; cy++) {
            const dXY = dX + (cy + 0.5) * c * y;
            for (let cz = z0; cz <= z1; cz++) {
              const dot = dXY + (cz + 0.5) * c * z;
              if (dot > rHi || dot < rLo) continue;
              const h = hash3(cx, cy, cz, seed);
              if ((h & 255) * (1 / 256) > oct.density) continue;
              const px = (cx + ((h >>> 8) & 255) * (1 / 256) + 1 / 512) * c;
              const py = (cy + ((h >>> 16) & 255) * (1 / 256) + 1 / 512) * c;
              const pz = (cz + (h >>> 24) * (1 / 256) + 1 / 512) * c;
              const pl2 = px * px + py * py + pz * pz;
              if (pl2 < pl2Lo || pl2 > pl2Hi) continue;
              const dp = px * x + py * y + pz * z;
              if (dp <= 0 || dp * dp < pl2 * K2) continue;
              n = this.push(n, base, oct, c, h, px, py, pz);
            }
          }
        }
        this.cacheN[o] = n;
      }
      let octH = 0;
      let octE = 0;
      for (let i = 0, k = base; i < n; i++, k += 6) {
        const ddx0 = x - list[k], ddy0 = y - list[k + 1], ddz0 = z - list[k + 2];
        const d2 = ddx0 * ddx0 + ddy0 * ddy0 + ddz0 * ddz0;
        const radius = list[k + 3];
        const lim = radius * 1.6;
        if (d2 > lim * lim) continue;
        const r = Math.sqrt(d2) / radius;
        const fresh = list[k + 4] !== 0;
        const sizeScale = list[k + 5];
        const prof = craterProfile(r, oct.complex, fresh);
        octH += prof * sizeScale;
        if (fresh) {
          // Bright rim + ejecta blanket fading to ~1.6 R; interior walls slightly bright.
          const e = r < 0.8 ? 0.15 : r < 1.05 ? 0.15 + 0.85 * (r - 0.8) / 0.25 : Math.max(0, 1 - (r - 1.05) / 0.55);
          octE = Math.max(octE, e * e * (0.4 + 0.6 * sizeScale));
        }
        if (r < 0.85) inside = Math.max(inside, 1 - r / 0.85);
      }
      total += clamp(octH, -1, 0.35) * oct.depth * att;
      this.ejectaOct[o] = octE;
      if (octE > ejecta) ejecta = octE;
    }
    this.ejecta = ejecta;
    this.inside = inside;
    return total;
  }

  /** Lists every crater of one octave hosted in a cell window (cells in the same order as `height`). */
  private fill(base: number, oct: CraterOctave, c: number, seed: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number {
    let n = 0;
    // Cell centres of hosts lie within c/2 of the shell |pl − 1| ≤ c/2 radially plus half a diagonal.
    const rLo = Math.max(0, 1 - 0.5 * c - 0.87 * c), rHi = 1 + 0.5 * c + 0.87 * c;
    const r2Lo = rLo * rLo, r2Hi = rHi * rHi;
    for (let cx = x0; cx <= x1; cx++) {
      const X = (cx + 0.5) * c;
      for (let cy = y0; cy <= y1; cy++) {
        const Y = (cy + 0.5) * c;
        for (let cz = z0; cz <= z1; cz++) {
          const Z = (cz + 0.5) * c;
          const rc2 = X * X + Y * Y + Z * Z;
          if (rc2 < r2Lo || rc2 > r2Hi) continue;
          const h = hash3(cx, cy, cz, seed);
          if ((h & 255) * (1 / 256) > oct.density) continue;
          const px = (cx + ((h >>> 8) & 255) * (1 / 256) + 1 / 512) * c;
          const py = (cy + ((h >>> 16) & 255) * (1 / 256) + 1 / 512) * c;
          const pz = (cz + (h >>> 24) * (1 / 256) + 1 / 512) * c;
          n = this.push(n, base, oct, c, h, px, py, pz);
        }
      }
    }
    return n;
  }

  /** Appends the crater hashed at p (if it lies on the shell) as centre, radius, fresh, size scale. */
  private push(n: number, base: number, oct: CraterOctave, c: number, h: number, px: number, py: number, pz: number): number {
    // Crater centre in cell → keep only cells whose centre lies near the sphere shell.
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    if (Math.abs(pl - 1) > c * 0.5 || pl === 0) return n;
    const h2 = hashNext(h);
    const rs = (h2 & 65535) * (1 / 65536);
    // Size distribution inside an octave: skewed towards small.
    const radius = c * this.maxR * (0.35 + 0.65 * rs * rs);
    const k = base + n * 6;
    const list = this.list;
    list[k] = px / pl; list[k + 1] = py / pl; list[k + 2] = pz / pl;
    list[k + 3] = radius;
    list[k + 4] = (h2 >>> 16) * (1 / 65536) < oct.freshness ? 1 : 0;
    list[k + 5] = radius / (c * this.maxR);
    return n + 1;
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

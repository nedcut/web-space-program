/** Pure, host-independent ETOPO grid decoder/sampler. I/O belongs to the host. */
export const EARTH_WIDTH = 4096;
export const EARTH_HEIGHT = 2048;
/**
 * Florida detail patch (public/earth/height-cape.i16): native ETOPO 15 arc-second pixels (~460 m), rows north to
 * south. Inside the outer `margin` degrees it blends into the global grid, so its edges are seamless.
 */
export const CAPE_PATCH = { west: -87.75, north: 31, perDegree: 240, width: 1980, height: 1620, margin: .25 } as const;
/** Host files, concatenated in this order into the one buffer given to installEarthData. */
export const EARTH_FILES = [
  { path: 'height.i16', bytes: EARTH_WIDTH * EARTH_HEIGHT * 2 },
  { path: 'height-cape.i16', bytes: CAPE_PATCH.width * CAPE_PATCH.height * 2 },
] as const;
export const EARTH_DATA_BYTES = EARTH_FILES[0].bytes + EARTH_FILES[1].bytes;
export interface EarthSample {
  range: number;
  /** Any corner of the containing cell is on the other side of sea level (per cell, steps at cell edges). */
  coastal?: boolean;
  /** 0–1: share of the containing cell's corners next to a sea-level crossing, interpolated (no cell steps). */
  shore?: number;
}

/** One int16 lattice: bilinear height plus interpolated roughness and coast weight. */
class Lattice {
  constructor(readonly values: Int16Array, readonly width: number, readonly height: number, private readonly wrap: boolean) {}
  private column(ix: number): number {
    return this.wrap ? (ix + this.width) % this.width : Math.max(0, Math.min(this.width - 1, ix));
  }
  private roughness(ix: number, iy: number): number {
    const w = this.width, v = this.values, left = this.column(ix - 1), right = this.column(ix + 1);
    const up = Math.max(0, iy - 1), down = Math.min(this.height - 1, iy + 1);
    return Math.max(Math.abs(v[iy * w + left] - v[iy * w + right]), Math.abs(v[up * w + ix] - v[down * w + ix]));
  }
  /** 1 when this grid point or one of its 4 neighbours lies on the other side of sea level. */
  private coastCorner(ix: number, iy: number): number {
    const w = this.width, values = this.values, row = iy * w, v = values[row + ix] > 0;
    const left = this.column(ix - 1), right = this.column(ix + 1);
    const up = Math.max(0, iy - 1), down = Math.min(this.height - 1, iy + 1);
    return (values[row + left] > 0) !== v || (values[row + right] > 0) !== v
      || (values[up * w + ix] > 0) !== v || (values[down * w + ix] > 0) !== v ? 1 : 0;
  }
  /** Bilinear sample at pixel coordinates (centres on integers); `fy` is already clamped by the caller's rows. */
  sample(px: number, iy: number, fy: number, out: EarthSample | undefined, scale: number): number {
    const w = this.width, v = this.values, ix = Math.floor(px), fx = px - ix;
    const x0 = this.column(ix), x1 = this.column(ix + 1);
    const a = v[iy * w + x0], b = v[iy * w + x1], c = v[(iy + 1) * w + x0], d = v[(iy + 1) * w + x1];
    if (out) {
      // Interpolate vertex roughness too: a per-cell range would step at every cell edge.
      const ra = this.roughness(x0, iy), rb = this.roughness(x1, iy);
      const rc = this.roughness(x0, iy + 1), rd = this.roughness(x1, iy + 1);
      out.range = ((ra + (rb - ra) * fx) * (1 - fy) + (rc + (rd - rc) * fx) * fy) * scale;
      out.coastal = Math.min(a, b, c, d) <= 0 && Math.max(a, b, c, d) > 0;
      const sa = this.coastCorner(x0, iy), sb = this.coastCorner(x1, iy);
      const sc = this.coastCorner(x0, iy + 1), sd = this.coastCorner(x1, iy + 1);
      out.shore = ((sa + (sb - sa) * fx) * (1 - fy) + (sc + (sd - sc) * fx) * fy) * scale;
    }
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
}

const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const P = CAPE_PATCH;
/** Patch pixel-centre extent in degrees; the blend reaches zero half a pixel inside the outermost centres. */
const PATCH_EAST = P.west + P.width / P.perDegree, PATCH_SOUTH = P.north - P.height / P.perDegree;
const patchOut: EarthSample = { range: 0 };

export class EarthGrid {
  /** Global grid values (the first file); the patch follows it in `buffer`. */
  readonly values: Int16Array;
  private readonly global: Lattice;
  private readonly patch: Lattice;
  private readonly north: number;
  private readonly south: number;
  constructor(readonly buffer: ArrayBufferLike) {
    if (buffer.byteLength !== EARTH_DATA_BYTES) throw new Error(`Earth grid must contain ${EARTH_DATA_BYTES} bytes`);
    // The file is little-endian. Reject exotic big-endian hosts rather than silently changing physics.
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Earth grid requires little-endian host');
    this.values = new Int16Array(buffer, 0, EARTH_WIDTH * EARTH_HEIGHT);
    this.global = new Lattice(this.values, EARTH_WIDTH, EARTH_HEIGHT, true);
    this.patch = new Lattice(new Int16Array(buffer, EARTH_FILES[0].bytes, P.width * P.height), P.width, P.height, false);
    let north = 0, south = 0;
    for (let x = 0; x < EARTH_WIDTH; x++) {
      north += this.values[x]; south += this.values[(EARTH_HEIGHT - 1) * EARTH_WIDTH + x];
    }
    this.north = north / EARTH_WIDTH; this.south = south / EARTH_WIDTH;
  }
  /** Metres above geoid. Inputs are body-fixed unit vectors. No allocations in the hot path. */
  sample(x: number, y: number, z: number, out?: EarthSample): number {
    const lon = Math.atan2(y, x) * (180 / Math.PI), lat = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);
    // Patch weight: 1 inside, easing to 0 across the outer margin (separable, so corners stay smooth).
    let patch = 0;
    if (lon > P.west && lon < PATCH_EAST && lat < P.north && lat > PATCH_SOUTH) {
      patch = smooth(Math.min(lon - P.west, PATCH_EAST - lon) / P.margin) * smooth(Math.min(P.north - lat, lat - PATCH_SOUTH) / P.margin);
    }
    let detail = 0;
    if (patch > 0) {
      const py = (P.north - lat) * P.perDegree - .5, iy = Math.max(0, Math.min(P.height - 2, Math.floor(py)));
      detail = this.patch.sample((lon - P.west) * P.perDegree - .5, iy, Math.max(0, Math.min(1, py - iy)), out && patchOut, 1);
      if (patch === 1) {
        if (out) { out.range = patchOut.range; out.coastal = patchOut.coastal; out.shore = patchOut.shore; }
        return detail;
      }
    }
    const px = (lon / 360 + .5) * EARTH_WIDTH - .5;
    const py = (90 - lat) / 180 * EARTH_HEIGHT - .5;
    const iy = Math.max(0, Math.min(EARTH_HEIGHT - 2, Math.floor(py)));
    let polar = 1;
    if (py < 0) polar = Math.max(0, 1 + 2 * py);
    if (py > EARTH_HEIGHT - 1) polar = Math.max(0, 1 - 2 * (py - EARTH_HEIGHT + 1));
    let h = this.global.sample(px, iy, Math.max(0, Math.min(1, py - iy)), out, polar);
    if (py < 0) h = this.north + (h - this.north) * polar;
    if (py > EARTH_HEIGHT - 1) h = this.south + (h - this.south) * polar;
    if (patch > 0) {
      h += (detail - h) * patch;
      if (out) {
        out.range += (patchOut.range - out.range) * patch;
        out.shore = (out.shore ?? 0) + ((patchOut.shore ?? 0) - (out.shore ?? 0)) * patch;
        out.coastal = patch < .5 ? out.coastal : patchOut.coastal;
      }
    }
    return h;
  }
}
let grid: EarthGrid | undefined;
/** Install once before creating any Earth terrain. Never swap physics data during a session. */
export function installEarthData(buffer: ArrayBufferLike): EarthGrid {
  if (!grid) grid = new EarthGrid(buffer);
  return grid;
}
export function earthData(): EarthGrid {
  if (!grid) throw new Error('Earth data not loaded: host must install public/earth/height.i16 + height-cape.i16 before creating terrain');
  return grid;
}

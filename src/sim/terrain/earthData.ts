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

const P = CAPE_PATCH, PW = P.width, PH = P.height;
const DEG = Math.PI / 180;
/** Patch extent (radians, outer pixel edges) and blend margin; the weight is zero on the edges themselves. */
const P_WEST = P.west * DEG, P_EAST = (P.west + PW / P.perDegree) * DEG;
const P_NORTH = P.north * DEG, P_SOUTH = (P.north - PH / P.perDegree) * DEG, P_MARGIN = P.margin * DEG;
const P_PER_RADIAN = P.perDegree / DEG;
const smooth = (t: number) => t >= 1 ? 1 : t * t * (3 - 2 * t);
const patchOut: EarthSample = { range: 0 };

export class EarthGrid {
  /** Global grid values (the first file). */
  readonly values: Int16Array;
  /** Florida patch values (the second file). */
  readonly patch: Int16Array;
  private readonly north: number;
  private readonly south: number;
  constructor(readonly buffer: ArrayBufferLike) {
    if (buffer.byteLength !== EARTH_DATA_BYTES) throw new Error(`Earth grid must contain ${EARTH_DATA_BYTES} bytes`);
    // The file is little-endian. Reject exotic big-endian hosts rather than silently changing physics.
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Earth grid requires little-endian host');
    this.values = new Int16Array(buffer, 0, EARTH_WIDTH * EARTH_HEIGHT);
    this.patch = new Int16Array(buffer, EARTH_FILES[0].bytes, PW * PH);
    let north = 0, south = 0;
    for (let x = 0; x < EARTH_WIDTH; x++) {
      north += this.values[x]; south += this.values[(EARTH_HEIGHT - 1) * EARTH_WIDTH + x];
    }
    this.north = north / EARTH_WIDTH; this.south = south / EARTH_WIDTH;
  }
  private roughness(ix: number, iy: number): number {
    const left = (ix + EARTH_WIDTH - 1) % EARTH_WIDTH, right = (ix + 1) % EARTH_WIDTH;
    const up = Math.max(0, iy - 1), down = Math.min(EARTH_HEIGHT - 1, iy + 1);
    return Math.max(Math.abs(this.values[iy * EARTH_WIDTH + left] - this.values[iy * EARTH_WIDTH + right]),
      Math.abs(this.values[up * EARTH_WIDTH + ix] - this.values[down * EARTH_WIDTH + ix]));
  }
  /** 1 when this grid point or one of its 4 neighbours lies on the other side of sea level. */
  private coastCorner(ix: number, iy: number): number {
    const row = iy * EARTH_WIDTH, v = this.values[row + ix] > 0;
    const left = (ix + EARTH_WIDTH - 1) % EARTH_WIDTH, right = (ix + 1) % EARTH_WIDTH;
    const up = Math.max(0, iy - 1), down = Math.min(EARTH_HEIGHT - 1, iy + 1);
    return (this.values[row + left] > 0) !== v || (this.values[row + right] > 0) !== v
      || (this.values[up * EARTH_WIDTH + ix] > 0) !== v || (this.values[down * EARTH_WIDTH + ix] > 0) !== v ? 1 : 0;
  }
  /** Patch counterparts of roughness/coastCorner: same rules on the patch lattice, clamped at its edges. */
  private patchRoughness(ix: number, iy: number): number {
    const v = this.patch, left = Math.max(0, ix - 1), right = Math.min(PW - 1, ix + 1);
    const up = Math.max(0, iy - 1), down = Math.min(PH - 1, iy + 1);
    return Math.max(Math.abs(v[iy * PW + left] - v[iy * PW + right]), Math.abs(v[up * PW + ix] - v[down * PW + ix]));
  }
  private patchCoast(ix: number, iy: number): number {
    const v = this.patch, row = iy * PW, land = v[row + ix] > 0;
    const left = Math.max(0, ix - 1), right = Math.min(PW - 1, ix + 1);
    const up = Math.max(0, iy - 1), down = Math.min(PH - 1, iy + 1);
    return (v[row + left] > 0) !== land || (v[row + right] > 0) !== land
      || (v[up * PW + ix] > 0) !== land || (v[down * PW + ix] > 0) !== land ? 1 : 0;
  }
  /** Bilinear patch sample at longitude/latitude (radians) inside the patch. */
  private samplePatch(lon: number, lat: number, out: EarthSample | undefined): number {
    const px = (lon - P_WEST) * P_PER_RADIAN - .5, py = (P_NORTH - lat) * P_PER_RADIAN - .5;
    const ix = Math.max(0, Math.min(PW - 2, Math.floor(px))), iy = Math.max(0, Math.min(PH - 2, Math.floor(py)));
    const fx = Math.max(0, Math.min(1, px - ix)), fy = Math.max(0, Math.min(1, py - iy));
    const v = this.patch, i = iy * PW + ix;
    const a = v[i], b = v[i + 1], c = v[i + PW], d = v[i + PW + 1];
    if (out) {
      const ra = this.patchRoughness(ix, iy), rb = this.patchRoughness(ix + 1, iy);
      const rc = this.patchRoughness(ix, iy + 1), rd = this.patchRoughness(ix + 1, iy + 1);
      out.range = (ra + (rb - ra) * fx) * (1 - fy) + (rc + (rd - rc) * fx) * fy;
      out.coastal = Math.min(a, b, c, d) <= 0 && Math.max(a, b, c, d) > 0;
      const sa = this.patchCoast(ix, iy), sb = this.patchCoast(ix + 1, iy);
      const sc = this.patchCoast(ix, iy + 1), sd = this.patchCoast(ix + 1, iy + 1);
      out.shore = (sa + (sb - sa) * fx) * (1 - fy) + (sc + (sd - sc) * fx) * fy;
    }
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  /** Metres above geoid. Inputs are body-fixed unit vectors. No allocations in the hot path. */
  sample(x: number, y: number, z: number, out?: EarthSample): number {
    const lon = Math.atan2(y, x), lat = Math.asin(Math.max(-1, Math.min(1, z)));
    // The Florida branch lives in its own method so this hot path stays small enough to inline.
    if (lon > P_WEST && lon < P_EAST && lat < P_NORTH && lat > P_SOUTH) return this.samplePatched(lon, lat, out);
    return this.sampleGlobal(lon, lat, out);
  }
  /** Inside the patch bounds: weight 1 inside, easing to 0 across the outer margin (separable, smooth corners). */
  private samplePatched(lon: number, lat: number, out: EarthSample | undefined): number {
    const w = smooth(Math.min(lon - P_WEST, P_EAST - lon) / P_MARGIN) * smooth(Math.min(P_NORTH - lat, lat - P_SOUTH) / P_MARGIN);
    if (w === 1) return this.samplePatch(lon, lat, out);
    const detail = this.samplePatch(lon, lat, out && patchOut), h = this.sampleGlobal(lon, lat, out);
    if (out) {
      out.range += (patchOut.range - out.range) * w;
      out.shore = (out.shore ?? 0) + ((patchOut.shore ?? 0) - (out.shore ?? 0)) * w;
      if (w >= .5) out.coastal = patchOut.coastal;
    }
    return h + (detail - h) * w;
  }
  private sampleGlobal(lon: number, lat: number, out: EarthSample | undefined): number {
    const px = (lon / (2 * Math.PI) + .5) * EARTH_WIDTH - .5;
    const py = (.5 - lat / Math.PI) * EARTH_HEIGHT - .5;
    const ix = Math.floor(px), fx = px - ix;
    const x0 = (ix + EARTH_WIDTH) % EARTH_WIDTH, x1 = (x0 + 1) % EARTH_WIDTH;
    const iy = Math.max(0, Math.min(EARTH_HEIGHT - 2, Math.floor(py)));
    const fy = Math.max(0, Math.min(1, py - iy));
    const a = this.values[iy * EARTH_WIDTH + x0], b = this.values[iy * EARTH_WIDTH + x1];
    const c = this.values[(iy + 1) * EARTH_WIDTH + x0], d = this.values[(iy + 1) * EARTH_WIDTH + x1];
    let h = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    let polar = 1;
    if (py < 0) { polar = Math.max(0, 1 + 2 * py); h = this.north + (h - this.north) * polar; }
    if (py > EARTH_HEIGHT - 1) { polar = Math.max(0, 1 - 2 * (py - EARTH_HEIGHT + 1)); h = this.south + (h - this.south) * polar; }
    if (out) {
      // Interpolate vertex roughness too: a per-cell range would step at every cell edge.
      const ra = this.roughness(x0, iy), rb = this.roughness(x1, iy);
      const rc = this.roughness(x0, iy + 1), rd = this.roughness(x1, iy + 1);
      out.range = ((ra + (rb - ra) * fx) * (1 - fy) + (rc + (rd - rc) * fx) * fy) * polar;
      out.coastal = Math.min(a, b, c, d) <= 0 && Math.max(a, b, c, d) > 0;
      const sa = this.coastCorner(x0, iy), sb = this.coastCorner(x1, iy);
      const sc = this.coastCorner(x0, iy + 1), sd = this.coastCorner(x1, iy + 1);
      out.shore = ((sa + (sb - sa) * fx) * (1 - fy) + (sc + (sd - sc) * fx) * fy) * polar;
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

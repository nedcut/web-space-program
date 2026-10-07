/** Pure, host-independent ETOPO grid decoder/sampler. I/O belongs to the host. */
export const EARTH_WIDTH = 4096;
export const EARTH_HEIGHT = 2048;
export const EARTH_DATA_BYTES = EARTH_WIDTH * EARTH_HEIGHT * 2;
export interface EarthSample { range: number; coastal?: boolean }
export class EarthGrid {
  readonly values: Int16Array;
  private readonly north: number;
  private readonly south: number;
  constructor(readonly buffer: ArrayBufferLike) {
    if (buffer.byteLength !== EARTH_DATA_BYTES) throw new Error(`Earth grid must contain ${EARTH_DATA_BYTES} bytes`);
    // The file is little-endian. Reject exotic big-endian hosts rather than silently changing physics.
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Earth grid requires little-endian host');
    this.values = new Int16Array(buffer);
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
  /** Metres above geoid. Inputs are body-fixed unit vectors. No allocations in the hot path. */
  sample(x: number, y: number, z: number, out?: EarthSample): number {
    const px = (Math.atan2(y, x) / (2 * Math.PI) + .5) * EARTH_WIDTH - .5;
    const py = (.5 - Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI) * EARTH_HEIGHT - .5;
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
  if (!grid) throw new Error('Earth data not loaded: host must install public/earth/height.i16 before creating terrain');
  return grid;
}

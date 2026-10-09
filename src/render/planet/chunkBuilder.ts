/**
 * Cube-sphere chunk mesh generation. PURE TypeScript (no three.js, no DOM) so it runs both in Web
 * Workers and on the main thread.
 *
 * A chunk is addressed by (face, level, ix, iy): face ∈ 0..5, level 0 = whole face, ix/iy ∈ [0, 2^level).
 * Vertices are stored relative to a per-chunk ORIGIN (float32-safe): the 1024 m-aligned body-fixed point at or
 * below the chunk centre, returned in float64 so the renderer places the mesh via the floating origin. Because the
 * origin is aligned to the detail-texture period, the local position doubles as the seamless detail coordinate.
 *
 * Packed vertex layout (20 bytes, every attribute 4-byte aligned for Metal/ANGLE):
 *   land:  position f32×3 · aNormalOct int16×2 (normalised octahedral) · aColor uint8×4 (normalised, gamma-2 RGB)
 *   ocean: position f32×3 · aNormalOct int16×2 · aDepth f32
 */
import type { Terrain, RGB } from '../../sim/terrain/api';

export interface ChunkKey {
  face: number;
  level: number;
  ix: number;
  iy: number;
}

export interface ChunkBuildParams extends ChunkKey {
  /** Quads per edge. */
  res: number;
  radius: number;
  /** Generate a liquid mesh where terrain dips below its shared datum. */
  ocean: boolean;
}

export interface ChunkData extends ChunkKey {
  /** Chunk centre in body-fixed coordinates (float64), on the displaced surface. */
  center: [number, number, number];
  /** Body-fixed origin of the vertex positions (float64, multiples of DETAIL_PERIOD). */
  origin: [number, number, number];
  /** Bounding sphere radius around center (m). */
  boundRadius: number;
  minHeight: number;
  maxHeight: number;
  /** Body-fixed position minus `origin` (×3): also the seamless detail-texture coordinate. */
  positions: Float32Array;
  /** Octahedral-encoded unit normals, Int16 normalised (×2). Decode with `octDecode`. */
  normals: Int16Array;
  /** Albedo RGB (gamma-2 encoded, 0..1) packed as Uint8 normalised (×4, alpha unused). */
  colors: Uint8Array;
  /** Optional ocean mesh (same grid at radius R + liquid level, attribute depth). Land and ocean share
   * `chunkIndices(res)`; chunks carry no index arrays of their own. */
  ocean?: {
    positions: Float32Array;
    normals: Int16Array;
    depth: Float32Array;
  };
  buildMs: number;
}

/** Face frames (n, u, v) with u × v = n so triangles wind CCW seen from outside. */
export const FACES: ReadonlyArray<{ n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }> = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [0, 0, -1], v: [1, 0, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** Map face coords (s,t) ∈ [-1,1]² to a unit-sphere direction (spherified cube, near-uniform cells). */
export function faceToSphere(face: number, s: number, t: number, out: [number, number, number]): [number, number, number] {
  const f = FACES[face];
  const x = f.n[0] + f.u[0] * s + f.v[0] * t;
  const y = f.n[1] + f.u[1] * s + f.v[1] * t;
  const z = f.n[2] + f.u[2] * s + f.v[2] * t;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  const sx = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
  const sy = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3));
  const sz = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
  const l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  out[0] = sx / l;
  out[1] = sy / l;
  out[2] = sz / l;
  return out;
}

/** Face-coordinate bounds of a chunk. */
export function chunkBounds(level: number, ix: number, iy: number): { s0: number; t0: number; size: number } {
  const size = 2 / (1 << level);
  return { s0: -1 + ix * size, t0: -1 + iy * size, size };
}

/** Approximate arc length of a chunk edge on a sphere of radius R. */
export function chunkEdgeLength(level: number, radius: number): number {
  return ((Math.PI / 2) * radius) / (1 << level);
}

export function chunkId(k: ChunkKey): string {
  return `${k.face}/${k.level}/${k.ix}/${k.iy}`;
}

const DETAIL_PERIOD = 1024;

/** Write unit vector (x,y,z) as an Int16 normalised octahedral pair at out[i], out[i+1]. */
export function octEncode(x: number, y: number, z: number, out: Int16Array, i: number): void {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l1, v = y / l1;
  if (z < 0) {
    const pu = u;
    u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1);
    v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1);
  }
  out[i] = Math.round(Math.max(-1, Math.min(1, u)) * 32767);
  out[i + 1] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
}

/** Inverse of `octEncode` (the shaders' `octDecode`), normalised. */
export function octDecode(a: number, b: number, out: [number, number, number]): [number, number, number] {
  const u = Math.max(a / 32767, -1), v = Math.max(b / 32767, -1);
  let x = u, y = v;
  const z = 1 - Math.abs(u) - Math.abs(v);
  const t = Math.max(-z, 0);
  x += x >= 0 ? -t : t;
  y += y >= 0 ? -t : t;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

/** Build one chunk. Cost ≈ (res+3)² terrain queries. */
export function buildChunk(terrain: Terrain, p: ChunkBuildParams): ChunkData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const { res, radius: R, face, level, ix, iy } = p;
  const N = res + 1; // vertices per edge
  const G = N + 2; // with 1-vertex border for normals
  const { s0, t0: tt0, size } = chunkBounds(level, ix, iy);
  const step = size / res;

  // 1) Sample positions on the bordered grid (float64).
  const px = new Float64Array(G * G);
  const py = new Float64Array(G * G);
  const pz = new Float64Array(G * G);
  const hs = new Float64Array(G * G);
  const dirs = new Float64Array(G * G * 3);
  const d: [number, number, number] = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity;
  const vCount = N * N + 4 * N;
  // Albedo, gamma-2 encoded so dark albedos stay precise in 8 bits (decoded as c*c in the shader).
  const colors = new Uint8Array(vCount * 4);
  const col: RGB = [0.5, 0.5, 0.5];
  // Vertex spacing as an angle: colour detail finer than the mesh fades instead of speckling.
  const footprint = chunkEdgeLength(level, R) / res / R;
  for (let j = 0; j < G; j++) {
    const t = tt0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const s = s0 + (i - 1) * step;
      faceToSphere(face, s, t, d);
      const h = terrain.heightAt(d[0], d[1], d[2]);
      const k = j * G + i;
      const r = R + h;
      px[k] = d[0] * r;
      py[k] = d[1] * r;
      pz[k] = d[2] * r;
      hs[k] = h;
      dirs[k * 3] = d[0];
      dirs[k * 3 + 1] = d[1];
      dirs[k * 3 + 2] = d[2];
      if (i > 0 && j > 0 && i < G - 1 && j < G - 1) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        // Colour immediately after the height query so presets can reuse side outputs (no re-evaluation).
        if (terrain.colorAt) terrain.colorAt(d[0], d[1], d[2], h, col, footprint);
        const vi = ((j - 1) * N + (i - 1)) * 4;
        colors[vi] = Math.round(Math.sqrt(Math.min(1, Math.max(0, col[0]))) * 255);
        colors[vi + 1] = Math.round(Math.sqrt(Math.min(1, Math.max(0, col[1]))) * 255);
        colors[vi + 2] = Math.round(Math.sqrt(Math.min(1, Math.max(0, col[2]))) * 255);
      }
    }
  }

  // Chunk centre: centre direction at the mean of min/max height.
  faceToSphere(face, s0 + size / 2, tt0 + size / 2, d);
  const hc = terrain.heightAt(d[0], d[1], d[2]);
  const cx = d[0] * (R + hc), cy = d[1] * (R + hc), cz = d[2] * (R + hc);
  const offX = Math.floor(cx / DETAIL_PERIOD) * DETAIL_PERIOD;
  const offY = Math.floor(cy / DETAIL_PERIOD) * DETAIL_PERIOD;
  const offZ = Math.floor(cz / DETAIL_PERIOD) * DETAIL_PERIOD;

  const edge = chunkEdgeLength(level, R);
  const skirtDepth = Math.max(edge / res * 1.5, (maxH - minH) * 0.2 + 2);
  const positions = new Float32Array(vCount * 3);
  const normals = new Int16Array(vCount * 2);
  let bound2 = 0;

  const writeVertex = (vi: number, k: number, sink: number) => {
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
    const X = px[k] - dx * sink, Y = py[k] - dy * sink, Z = pz[k] - dz * sink;
    const lx = X - cx, ly = Y - cy, lz = Z - cz;
    const b = lx * lx + ly * ly + lz * lz;
    if (b > bound2) bound2 = b;
    positions[vi * 3] = X - offX;
    positions[vi * 3 + 1] = Y - offY;
    positions[vi * 3 + 2] = Z - offZ;
  };

  // 2) Interior vertices with central-difference normals.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j + 1) * G + (i + 1);
      const vi = j * N + i;
      writeVertex(vi, k, 0);
      const kl = k - 1, kr = k + 1, kd = k - G, ku = k + G;
      const ax = px[kr] - px[kl], ay = py[kr] - py[kl], az = pz[kr] - pz[kl];
      const bx = px[ku] - px[kd], by = py[ku] - py[kd], bz = pz[ku] - pz[kd];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // Ensure outward
      if (nx * dirs[k * 3] + ny * dirs[k * 3 + 1] + nz * dirs[k * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      octEncode(nx, ny, nz, normals, vi * 2);
    }
  }

  // 3) Skirts: duplicate edge vertices pushed down.
  const edgeIdx = (e: number, n: number): number => {
    // e: 0 bottom (j=0), 1 right (i=N-1), 2 top (j=N-1), 3 left (i=0)
    switch (e) {
      case 0: return n;
      case 1: return n * N + (N - 1);
      case 2: return (N - 1) * N + (N - 1 - n);
      default: return (N - 1 - n) * N;
    }
  };
  for (let e = 0; e < 4; e++) {
    for (let n = 0; n < N; n++) {
      const src = edgeIdx(e, n);
      const i = src % N, j = Math.floor(src / N);
      const k = (j + 1) * G + (i + 1);
      const vi = N * N + e * N + n;
      writeVertex(vi, k, skirtDepth);
      normals[vi * 2] = normals[src * 2];
      normals[vi * 2 + 1] = normals[src * 2 + 1];
      colors[vi * 4] = colors[src * 4];
      colors[vi * 4 + 1] = colors[src * 4 + 1];
      colors[vi * 4 + 2] = colors[src * 4 + 2];
    }
  }

  let ocean: ChunkData['ocean'];
  const liquidLevel = terrain.liquid?.level ?? 0;
  if (p.ocean && minH < liquidLevel + 0.5) {
    const oN = N * N + 4 * N;
    const opos = new Float32Array(oN * 3);
    const onrm = new Int16Array(oN * 2);
    const odep = new Float32Array(oN);
    const writeO = (vi: number, k: number, sink: number) => {
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const r = R + liquidLevel - sink;
      opos[vi * 3] = dx * r - offX; opos[vi * 3 + 1] = dy * r - offY; opos[vi * 3 + 2] = dz * r - offZ;
      octEncode(dx, dy, dz, onrm, vi * 2);
      odep[vi] = liquidLevel - hs[k];
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) writeO(j * N + i, (j + 1) * G + (i + 1), 0);
    const oskirt = Math.max(edge / res, 2);
    for (let e = 0; e < 4; e++)
      for (let n = 0; n < N; n++) {
        const src = edgeIdx(e, n);
        const i = src % N, j = Math.floor(src / N);
        writeO(N * N + e * N + n, (j + 1) * G + (i + 1), oskirt);
      }
    ocean = { positions: opos, normals: onrm, depth: odep };
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    face, level, ix, iy,
    center: [cx, cy, cz],
    origin: [offX, offY, offZ],
    boundRadius: Math.sqrt(bound2),
    minHeight: minH,
    maxHeight: maxH,
    positions, normals, colors, ocean,
    buildMs: t1 - t0,
  };
}

const indexCache = new Map<number, Uint16Array | Uint32Array>();

/**
 * Grid + skirt triangle indices of every land and ocean chunk with `res` quads per edge. One shared, cached
 * array: never modify or transfer it.
 */
export function chunkIndices(res: number): Uint16Array | Uint32Array {
  return buildIndices(res + 1, true);
}

function buildIndices(N: number, skirts: boolean): Uint16Array | Uint32Array {
  const cached = indexCache.get(N * 2 + (skirts ? 1 : 0));
  if (cached) return cached;
  const quads = (N - 1) * (N - 1) + (skirts ? 4 * (N - 1) : 0);
  const vCount = N * N + (skirts ? 4 * N : 0);
  const idx = vCount < 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      // alternate diagonals for a more isotropic triangulation
      if ((i + j) & 1) {
        idx[o++] = a; idx[o++] = b; idx[o++] = d;
        idx[o++] = a; idx[o++] = d; idx[o++] = c;
      } else {
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }
  }
  if (skirts) {
    const edgeIdx = (e: number, n: number): number => {
      switch (e) {
        case 0: return n;
        case 1: return n * N + (N - 1);
        case 2: return (N - 1) * N + (N - 1 - n);
        default: return (N - 1 - n) * N;
      }
    };
    for (let e = 0; e < 4; e++) {
      for (let n = 0; n < N - 1; n++) {
        const top0 = edgeIdx(e, n), top1 = edgeIdx(e, n + 1);
        const bot0 = N * N + e * N + n, bot1 = bot0 + 1;
        // Edges are traversed CCW around the chunk, so outward-facing quads are (top0, bot0, top1).
        idx[o++] = top0; idx[o++] = bot0; idx[o++] = top1;
        idx[o++] = top1; idx[o++] = bot0; idx[o++] = bot1;
      }
    }
  }
  indexCache.set(N * 2 + (skirts ? 1 : 0), idx);
  return idx;
}

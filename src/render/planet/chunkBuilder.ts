/**
 * Cube-sphere chunk mesh generation. PURE TypeScript (no three.js, no DOM) so it runs both in Web
 * Workers and on the main thread.
 *
 * A chunk is addressed by (face, level, ix, iy): face ∈ 0..5, level 0 = whole face, ix/iy ∈ [0, 2^level).
 * Vertices are stored RELATIVE TO THE CHUNK CENTRE (float32-safe); the chunk centre is returned in float64
 * body-fixed coordinates so the renderer can place the mesh via the floating origin.
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
  /** Generate an ocean surface mesh where the terrain dips below 0. */
  ocean: boolean;
}

export interface ChunkData extends ChunkKey {
  /** Chunk centre in body-fixed coordinates (float64), on the displaced surface. */
  center: [number, number, number];
  /** Bounding sphere radius around center (m). */
  boundRadius: number;
  minHeight: number;
  maxHeight: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Albedo RGB (linear, 0..1) packed as Uint8 normalised (×3). */
  colors: Uint8Array;
  /** Body-fixed position minus a 1024 m-aligned per-chunk offset (seamless detail texturing). */
  detail: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Optional ocean mesh (same grid at radius R, attribute depth). */
  ocean?: {
    positions: Float32Array;
    normals: Float32Array;
    depth: Float32Array;
    detail: Float32Array;
    indices: Uint16Array | Uint32Array;
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
  const colors = new Uint8Array(vCount * 3);
  const col: RGB = [0.5, 0.5, 0.5];
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
        if (terrain.colorAt) terrain.colorAt(d[0], d[1], d[2], h, col);
        const vi = ((j - 1) * N + (i - 1)) * 3;
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
  const normals = new Float32Array(vCount * 3);
  const detail = new Float32Array(vCount * 3);
  let bound2 = 0;

  const writeVertex = (vi: number, k: number, sink: number) => {
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
    const X = px[k] - dx * sink, Y = py[k] - dy * sink, Z = pz[k] - dz * sink;
    const lx = X - cx, ly = Y - cy, lz = Z - cz;
    positions[vi * 3] = lx;
    positions[vi * 3 + 1] = ly;
    positions[vi * 3 + 2] = lz;
    const b = lx * lx + ly * ly + lz * lz;
    if (b > bound2) bound2 = b;
    detail[vi * 3] = X - offX;
    detail[vi * 3 + 1] = Y - offY;
    detail[vi * 3 + 2] = Z - offZ;
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
      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
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
      normals[vi * 3] = normals[src * 3];
      normals[vi * 3 + 1] = normals[src * 3 + 1];
      normals[vi * 3 + 2] = normals[src * 3 + 2];
      colors[vi * 3] = colors[src * 3];
      colors[vi * 3 + 1] = colors[src * 3 + 1];
      colors[vi * 3 + 2] = colors[src * 3 + 2];
    }
  }

  const indices = buildIndices(N, true);

  let ocean: ChunkData['ocean'];
  if (p.ocean && minH < 0.5) {
    const oN = N * N + 4 * N;
    const opos = new Float32Array(oN * 3);
    const onrm = new Float32Array(oN * 3);
    const odep = new Float32Array(oN);
    const odet = new Float32Array(oN * 3);
    const writeO = (vi: number, k: number, sink: number) => {
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const r = R - sink;
      const X = dx * r, Y = dy * r, Z = dz * r;
      opos[vi * 3] = X - cx; opos[vi * 3 + 1] = Y - cy; opos[vi * 3 + 2] = Z - cz;
      onrm[vi * 3] = dx; onrm[vi * 3 + 1] = dy; onrm[vi * 3 + 2] = dz;
      odet[vi * 3] = X - offX; odet[vi * 3 + 1] = Y - offY; odet[vi * 3 + 2] = Z - offZ;
      odep[vi] = -hs[k];
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) writeO(j * N + i, (j + 1) * G + (i + 1), 0);
    const oskirt = Math.max(edge / res, 2);
    for (let e = 0; e < 4; e++)
      for (let n = 0; n < N; n++) {
        const src = edgeIdx(e, n);
        const i = src % N, j = Math.floor(src / N);
        writeO(N * N + e * N + n, (j + 1) * G + (i + 1), oskirt);
      }
    ocean = { positions: opos, normals: onrm, depth: odep, detail: odet, indices: buildIndices(N, true) };
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    face, level, ix, iy,
    center: [cx, cy, cz],
    boundRadius: Math.sqrt(bound2),
    minHeight: minH,
    maxHeight: maxH,
    positions, normals, colors, detail, indices, ocean,
    buildMs: t1 - t0,
  };
}

const indexCache = new Map<number, Uint16Array | Uint32Array>();

/** Grid + skirt triangle indices (shared pattern for every chunk with the same N). */
export function buildIndices(N: number, skirts: boolean): Uint16Array | Uint32Array {
  const cached = indexCache.get(N * 2 + (skirts ? 1 : 0));
  if (cached) return cached.slice();
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
  return idx.slice();
}

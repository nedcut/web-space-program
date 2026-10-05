import { latLonToUnit } from '../geo';
import type { RGB } from '../api';
import { fbm, ridged, octavesFor, smoothstep, clamp } from '../fbm';
import { hash3, hashNext, mulberry32, U32_TO_UNIT } from '../noise';
import { blendRGB, setRGB, type PresetContext, type PresetResult } from './common';

interface CellFeature {
  /** distance from centre / radius */
  r: number;
  /** feature radius relative to its cell maximum (0..1) */
  size: number;
  /** extra random 0..1 */
  rnd: number;
}

/**
 * Visit features hashed per cell (one per occupied cell) near unit vector p, calling `fn` for each
 * whose influence (reach × radius) covers p.
 */
function visitCells(x: number, y: number, z: number, cell: number, density: number, maxR: number, reach: number, seed: number, fn: (f: CellFeature) => void): void {
  const gx = x / cell, gy = y / cell, gz = z / cell;
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        let h = hash3(cx, cy, cz, seed);
        if (h * U32_TO_UNIT > density) continue;
        h = hashNext(h); const rx = h * U32_TO_UNIT;
        h = hashNext(h); const ry = h * U32_TO_UNIT;
        h = hashNext(h); const rz = h * U32_TO_UNIT;
        let px = (cx + rx) * cell, py = (cy + ry) * cell, pz = (cz + rz) * cell;
        const pl = Math.sqrt(px * px + py * py + pz * pz);
        if (Math.abs(pl - 1) > cell * 0.5 || pl === 0) continue;
        px /= pl; py /= pl; pz /= pl;
        h = hashNext(h); const size = 0.3 + 0.7 * h * U32_TO_UNIT;
        h = hashNext(h); const rnd = h * U32_TO_UNIT;
        const radius = cell * maxR * size;
        const d2 = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
        if (d2 > (radius * reach) ** 2) continue;
        fn({ r: Math.sqrt(d2) / radius, size, rnd });
      }
}

/**
 * Io (and generic 'volcanic'): smooth sulphur plains with mottled yellow/white/orange colouring,
 * flat-floored dark paterae (calderas) with red pyroclastic rings, isolated tall block mountains.
 */
export function ioPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nBase = ctx.noise(1);
  const nCol = ctx.noise(2);
  const nMtn = ctx.noise(3);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 14);
  const seed = ctx.seed * 101;
  const lavaLakes = [[18,30],[-26,-75],[42,130]].map(([lat,lon])=>latLonToUnit(lat,lon));
  let pat = 0;
  let ring = 0;
  let mtnMask = 0;
  let lx = NaN, ly = NaN, lz = NaN;
  const height = (x: number, y: number, z: number): number => {
    lx = x; ly = y; lz = z;
    let h = 0.06 * fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    pat = 0;
    ring = 0;
    let patH = 0;
    for (let o = 0; o < 2; o++) {
      const cell = o === 0 ? 0.16 : 0.06;
      visitCells(x, y, z, cell, o === 0 ? 0.45 : 0.4, 0.3, 5, seed + o, (f) => {
        if (f.r < 1) {
          // Flat floor, steep wall
          const d = -smoothstep(1, 0.85, f.r) * 0.18 * f.size * (o === 0 ? 1 : 0.6);
          patH = Math.min(patH, d);
          pat = Math.max(pat, smoothstep(1, 0.9, f.r));
        } else if (f.rnd < 0.35) {
          ring = Math.max(ring, Math.exp(-(((f.r - 3) / 1.2) ** 2)) * (o === 0 ? 1 : 0.5));
        }
      });
    }
    h += patH;
    mtnMask = 0;
    visitCells(x, y, z, 0.2, 0.35, 0.35, 1, seed + 7, (f) => {
      const m = smoothstep(1, 0.4, f.r);
      mtnMask = Math.max(mtnMask, m);
    });
    if (mtnMask > 0) h += 0.85 * mtnMask * ridged(nMtn, x * 12, y * 12, z * 12, octavesFor(R, 12, ctx.minWavelength * 2, 2.1, 12));
    for (const c of lavaLakes) {
      const d=Math.hypot(x-c.x,y-c.y,z-c.z);
      const basin=smoothstep(0.025,0.019,d);
      h=h*(1-basin)-0.18*basin;
    }
    return relief * h;
  };
  const YEL = ctx.pal(1, [0.62, 0.52, 0.18]);
  const WHITE: RGB = [0.72, 0.7, 0.58];
  const ORANGE = ctx.pal(2, [0.55, 0.28, 0.08]);
  const DARK: RGB = ctx.pal(3, [0.05, 0.04, 0.03]);
  const RED: RGB = [0.5, 0.15, 0.05];
  const POLAR: RGB = ctx.pal(0, [0.32, 0.24, 0.15]);
  const MTN: RGB = [0.4, 0.33, 0.2];
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB): RGB => {
    if (x !== lx || y !== ly || z !== lz) height(x, y, z);
    const a = fbm(nCol, x * 4, y * 4, z * 4, 6);
    const b = fbm(nCol, x * 9 + 4, y * 9, z * 9, 4);
    setRGB(out, YEL[0], YEL[1], YEL[2]);
    blendRGB(out, WHITE, smoothstep(0.05, 0.3, a));
    blendRGB(out, ORANGE, smoothstep(0.1, 0.35, b) * 0.8);
    blendRGB(out, POLAR, smoothstep(0.6, 0.85, Math.abs(z)) * 0.8);
    blendRGB(out, RED, clamp(ring, 0, 1) * 0.75);
    blendRGB(out, MTN, mtnMask * 0.6);
    blendRGB(out, DARK, pat * 0.9);
    return out;
  };
  return { height, maxHeight: relief * 1.0, minHeight: -relief * 0.32, colorAt };
}

/**
 * Europa: very smooth bright ice cut by global double-ridge lineae (reddish-brown bands) at several
 * scales, with patches of chaos terrain.
 */
export function europaPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nBase = ctx.noise(1);
  const nChaos = ctx.noise(2);
  const nWarp = ctx.noise(3);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 12);
  const rnd = mulberry32(ctx.seed * 7 + 99);
  // Global lineae as great-circle arcs: plane normal n, arc centre m, half-length (cos), width.
  interface Linea { nx: number; ny: number; nz: number; mx: number; my: number; mz: number; cosHalf: number; w: number }
  const lineae: Linea[] = [];
  const randUnit = () => {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return { x: s * Math.cos(t), y: s * Math.sin(t), z: u };
  };
  for (let i = 0; i < 70; i++) {
    const m = randUnit();
    let d = randUnit();
    // make d perpendicular to m → great circle through m with direction d
    const dm = d.x * m.x + d.y * m.y + d.z * m.z;
    d = { x: d.x - m.x * dm, y: d.y - m.y * dm, z: d.z - m.z * dm };
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    d = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
    const n = { x: m.y * d.z - m.z * d.y, y: m.z * d.x - m.x * d.z, z: m.x * d.y - m.y * d.x };
    const half = 0.3 + rnd() * 1.2;
    lineae.push({ nx: n.x, ny: n.y, nz: n.z, mx: m.x, my: m.y, mz: m.z, cosHalf: Math.cos(half), w: (0.0012 + rnd() * 0.002) * (i < 12 ? 1.5 : 1) });
  }
  let band = 0;
  let chaosM = 0;
  const height = (x: number, y: number, z: number): number => {
    let h = 0.06 * fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    // Low-frequency vector warp bends each fault differently; scalloped tidal arcs avoid straight strings.
    const wx = 0.025 * nWarp.noise(x * 5, y * 5, z * 5);
    const wy = 0.025 * nWarp.noise(x * 5 + 9, y * 5 - 3, z * 5);
    const wz = 0.025 * nWarp.noise(x * 5, y * 5 + 7, z * 5 - 5);
    band = 0;
    let ridge = 0;
    for (const l of lineae) {
      const plane = (x + wx) * l.nx + (y + wy) * l.ny + (z + wz) * l.nz;
      if (Math.abs(plane) > l.w * 6 + 0.012) continue;
      const arc = x * (l.my * l.nz - l.mz * l.ny) + y * (l.mz * l.nx - l.mx * l.nz) + z * (l.mx * l.ny - l.my * l.nx);
      const scallop = 0.009 * Math.sin(arc * 18 + l.mx * 12) + 0.003 * Math.sin(arc * 39 + l.mz * 8);
      const off = Math.abs(plane + scallop);
      if (off > l.w * 6) continue;
      const along = x * l.mx + y * l.my + z * l.mz;
      if (along < l.cosHalf) continue;
      const fade = smoothstep(l.cosHalf, l.cosHalf + 0.02, along);
      const u = off / l.w;
      // double ridge with central groove
      ridge = Math.max(ridge, fade * (Math.exp(-((u - 0.6) ** 2) * 6) * 0.9 - Math.exp(-u * u * 20) * 0.35));
      band = Math.max(band, fade * Math.exp(-((u / 3) ** 2)));
    }
    h += 0.45 * ridge;
    // Fine cracks: high-frequency ridged noise, low amplitude.
    h += 0.05 * ridged(nWarp, x * 60, y * 60, z * 60, octavesFor(R, 60, ctx.minWavelength * 2, 2, 10));
    chaosM = smoothstep(0.22, 0.32, fbm(nChaos, x * 3, y * 3, z * 3, 5));
    if (chaosM > 0) h += chaosM * 0.25 * ridged(nChaos, x * 40, y * 40, z * 40, 5);
    return relief * h;
  };
  const ICE = ctx.pal(2, [0.72, 0.68, 0.6]);
  const BROWN = ctx.pal(0, [0.42, 0.25, 0.15]);
  const CHAOS = ctx.pal(1, [0.5, 0.36, 0.26]);
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB): RGB => {
    height(x, y, z);
    setRGB(out, ICE[0], ICE[1], ICE[2]);
    const n = nBase.noise(x * 8, y * 8, z * 8);
    blendRGB(out, CHAOS, chaosM * 0.8 + 0.1 * smoothstep(0.3, 0.7, n));
    blendRGB(out, BROWN, band * 0.6);
    return out;
  };
  return { height, maxHeight: relief * 0.85, minHeight: -relief * 0.35, colorAt };
}

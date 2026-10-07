import type { RGB } from '../api';
import { CraterField, makeCraterOctaves } from '../craters';
import { fbm, ridged, billow, octavesFor, smoothstep, clamp, bandPass } from '../fbm';
import { latLonToUnit, angleTo, gaussCap, GreatArc, type UnitVec } from '../geo';
import { blendRGB, setRGB, type PresetContext, type PresetResult } from './common';

/** Shield volcano profile: broad flanks, steep scarp at the base, summit caldera. Returns 0..1. */
function shield(theta: number, theta0: number): number {
  if (theta >= theta0) return 0;
  const t = theta / theta0;
  let h = Math.pow(1 - t, 1.6);
  // basal scarp (Olympus Mons has a cliff)
  h += 0.12 * smoothstep(1, 0.92, t);
  // caldera
  if (t < 0.1) h -= 0.12 * smoothstep(0.1, 0.06, t);
  return h;
}

/**
 * Mars: hemispheric dichotomy (low smooth north), Tharsis bulge with giant shield volcanoes,
 * a Valles-Marineris-like canyon system, Hellas/Argyre basins, eroded craters, dune fields, polar caps.
 */
export function marsPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nBase = ctx.noise(1);
  const nDich = ctx.noise(2);
  const nCan = ctx.noise(3);
  const nDune = ctx.noise(4);
  const nAlb = ctx.noise(5);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 15);
  const craters = new CraterField({
    seed: ctx.seed * 17 + 3,
    octaves: makeCraterOctaves({
      largestCell: 0.25,
      smallestCell: Math.max(40 / R, 1e-6),
      largestDepth: relief * 0.22,
      density: 0.55,
      depthExponent: 0.8,
      freshness: 0.12,
    }).slice(0, 13),
  });

  const tharsis = latLonToUnit(2, -105);
  const volcanoes: { c: UnitVec; r: number; h: number }[] = [
    { c: latLonToUnit(18.6, -134), r: 0.16, h: 0.72 }, // Olympus-like
    { c: latLonToUnit(-9, -121), r: 0.09, h: 0.42 },
    { c: latLonToUnit(1, -113), r: 0.08, h: 0.38 },
    { c: latLonToUnit(11, -104), r: 0.08, h: 0.42 },
    { c: latLonToUnit(25, 147), r: 0.08, h: 0.25 }, // Elysium-like
  ];
  const canyon = [latLonToUnit(-6, -100), latLonToUnit(-11, -72), latLonToUnit(-9, -48), latLonToUnit(-2, -32)];
  const canyonArcs = canyon.slice(0, -1).map((c, i) => new GreatArc(c, canyon[i + 1]));
  const basins: { c: UnitVec; r: number; d: number }[] = [
    { c: latLonToUnit(-42, 70), r: 0.36, d: 0.5 }, // Hellas-like
    { c: latLonToUnit(-50, -43), r: 0.2, d: 0.3 }, // Argyre-like
    { c: latLonToUnit(46, 118), r: 0.5, d: 0.12 }, // Utopia-like
  ];

  let lastCanyon = 0;
  let lastNorth = 0;
  let lx = NaN, ly = NaN, lz = NaN;
  const height = (x: number, y: number, z: number): number => {
    lx = x; ly = y; lz = z;
    const warp = 0.18 * fbm(nDich, x * 2, y * 2, z * 2, 5);
    const north = smoothstep(0.1, 0.45, z + warp + 0.1 * Math.sin(Math.atan2(y, x) * 1 + 1));
    lastNorth = north;
    let h = 0.08 - 0.3 * north;
    h += 0.32 * gaussCap(x, y, z, tharsis, 0.55);
    for (const v of volcanoes) {
      const c2 = (x - v.c.x) ** 2 + (y - v.c.y) ** 2 + (z - v.c.z) ** 2;
      if (c2 > v.r * v.r * 1.1) continue; // chord ≥ angle·0.99 for these small caps
      const th = angleTo(x, y, z, v.c);
      if (th < v.r) h += v.h * shield(th, v.r);
    }
    for (const b of basins) {
      const d = Math.sqrt((x - b.c.x) ** 2 + (y - b.c.y) ** 2 + (z - b.c.z) ** 2) / b.r;
      if (d < 1.4) h += b.d * (d < 1 ? -(1 - d * d) * (1 - d * d) * 1.0 : 0) + b.d * 0.15 * Math.exp(-(((d - 1) / 0.15) ** 2));
    }
    // Canyon system along a chain of great-circle arcs.
    let cd = 1e9;
    let ct = 0;
    for (let i = 0; i < canyonArcs.length; i++) {
      const r = canyonArcs[i].query(x, y, z, 0.12);
      if (r && r.d < cd) { cd = r.d; ct = (i + clamp(r.t, 0, 1)) / canyonArcs.length; }
    }
    lastCanyon = 0;
    if (cd < 0.12) {
      const wob = 0.012 * fbm(nCan, x * 30, y * 30, z * 30, 4);
      const width = 0.03 * (0.4 + 0.9 * Math.sin(Math.PI * clamp(ct, 0, 1)));
      const k = smoothstep(width, width * 0.55, cd + wob);
      // Terraced walls
      const terr = k * 0.7 + 0.3 * smoothstep(0.3, 0.7, k);
      lastCanyon = k;
      h -= 0.36 * terr * smoothstep(0, 0.08, ct) * smoothstep(1, 0.85, ct);
    }
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct, 2, 0.5);
    h += 0.07 * base * (1 - 0.6 * north);
    // Dunes in lowlands / basin floors: crescent-ish ridges, small amplitude.
    const dk = R / 260;
    const dune = 1 - Math.abs(Math.sin((x * 0.8 + y * 0.6) * dk + 6 * nDune.noise(x * 40, y * 40, z * 40)));
    const duneMask = north * smoothstep(0.1, 0.4, nDune.noise(x * 6, y * 6, z * 6));
    h += 0.0025 * duneMask * dune * dune;
    // Polar caps (layered ice domes).
    h += 0.04 * smoothstep(0.94, 0.985, Math.abs(z)) + 0.002 * Math.sin(Math.abs(z)*2400) * smoothstep(0.94, 0.97, Math.abs(z));
    const crat = craters.height(x, y, z, (o) => 1 - north * (o < 4 ? 0.85 : 0.4));
    return relief * h + crat;
  };

  const RUST = ctx.pal(1, [0.42, 0.19, 0.08]);
  const DARK = ctx.pal(0, [0.16, 0.09, 0.05]);
  const DUST = ctx.pal(2, [0.55, 0.32, 0.16]);
  const CAP: RGB = ctx.pal(3, [0.82, 0.8, 0.77]);
  const WALL: RGB = [0.2, 0.09, 0.045];
  const colorAt = (x: number, y: number, z: number, h: number, out: RGB, fp?: number): RGB => {
    if (x !== lx || y !== ly || z !== lz) height(x, y, z);
    const a = fbm(nAlb, x * 2.5, y * 2.5, z * 2.5, 6);
    setRGB(out, RUST[0], RUST[1], RUST[2]);
    blendRGB(out, DUST, smoothstep(0.05, 0.4, a) * 0.6);
    blendRGB(out, DARK, smoothstep(-0.05, -0.3, a) * 0.75);
    // Canyon: dark layered walls, darker floor deposits.
    blendRGB(out, WALL, lastCanyon * 0.85);
    blendRGB(out, DARK, smoothstep(0.6, 1, lastCanyon) * 0.5);
    const n = nAlb.noise(x * 60, y * 60, z * 60);
    // Local mottling: darker rocky outcrops vs bright dust drifts at km and sub-km scales. Octaves finer than
    // a few samples are dropped so coarse chunks don't speckle.
    const w900 = bandPass(900, fp), w4000 = bandPass(4000, fp);
    const nl = (w900 > 0 ? nAlb.noise(x * 900, y * 900, z * 900) * 0.6 * w900 : 0)
      + (w4000 > 0 ? nAlb.noise(x * 4000, y * 4000, z * 4000) * 0.4 * w4000 : 0);
    const m = 1 + 0.1 * n + 0.22 * nl;
    out[0] *= m; out[1] *= m * 0.98; out[2] *= m * 0.96;
    blendRGB(out, DARK, smoothstep(0.25, 0.6, -nl) * 0.5);
    blendRGB(out, CAP, smoothstep(0.95, 0.975, Math.abs(z) + 0.02 * n));
    void h; void lastNorth;
    return out;
  };
  return { height, maxHeight: relief * 1.5, minHeight: -relief * 0.95, colorAt };
}

/** Venus: rolling volcanic plains, lava flow ridges, Ishtar/Aphrodite-like highlands, sparse fresh craters. */
export function venusPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nBase = ctx.noise(1);
  const nFlow = ctx.noise(2);
  const baseOct = octavesFor(R, 2.5, ctx.minWavelength, 2, 15);
  const craters = new CraterField({
    seed: ctx.seed * 13 + 1,
    octaves: makeCraterOctaves({ largestCell: 0.12, smallestCell: Math.max(2000 / R, 0.01), largestDepth: relief * 0.12, density: 0.15, freshness: 0.9 }),
  });
  const highlands: { c: UnitVec; r: number; h: number }[] = [
    { c: latLonToUnit(70, 0), r: 0.35, h: 0.35 },
    { c: latLonToUnit(65, 3), r: 0.08, h: 0.6 },
    { c: latLonToUnit(-5, 95), r: 0.3, h: 0.3 },
    { c: latLonToUnit(-8, 130), r: 0.25, h: 0.25 },
    { c: latLonToUnit(25, -80), r: 0.2, h: 0.2 },
  ];
  const height = (x: number, y: number, z: number): number => {
    let h = 0.05 * fbm(nBase, x * 2.5, y * 2.5, z * 2.5, baseOct, 2, 0.5);
    for (const hl of highlands) h += hl.h * gaussCap(x, y, z, hl.c, hl.r);
    const mtn = ridged(nFlow, x * 5, y * 5, z * 5, octavesFor(R, 5, ctx.minWavelength * 2, 2.1, 14));
    h += 0.25 * mtn * mtn * smoothstep(0.1, 0.3, h);
    h += 0.02 * billow(nFlow, x * 20, y * 20, z * 20, 6);
    return relief * h + craters.height(x, y, z);
  };
  const A = ctx.pal(1, [0.3, 0.19, 0.1]);
  const B = ctx.pal(0, [0.18, 0.11, 0.06]);
  const C = ctx.pal(2, [0.42, 0.34, 0.26]);
  const colorAt = (x: number, y: number, z: number, h: number, out: RGB): RGB => {
    setRGB(out, A[0], A[1], A[2]);
    blendRGB(out, B, smoothstep(0.1, 0.4, nFlow.noise(x * 8, y * 8, z * 8)) * 0.7);
    blendRGB(out, C, smoothstep(relief * 0.25, relief * 0.6, h));
    return out;
  };
  return { height, maxHeight: relief * 1.0, minHeight: -relief * 0.25, colorAt };
}

/** Titan: equatorial linear dune seas, bright rugged highlands, dark north-polar lakes. */
export function titanPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nBase = ctx.noise(1);
  const nDune = ctx.noise(2);
  const nLake = ctx.noise(3);
  const nMtn = ctx.noise(4);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 14);
  const xanadu = latLonToUnit(-10, -100);
  const seas = [[76,40,0.12],[80,115,0.08],[69,-55,0.045]].map(([lat,lon,width])=>({c:latLonToUnit(lat,lon),width}));
  let lastDune = 0;
  let lastLake = 0;
  let lastHigh = 0;
  const height = (x: number, y: number, z: number): number => {
    const lat = Math.asin(clamp(z, -1, 1));
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    const high = clamp(gaussCap(x, y, z, xanadu, 0.5) + smoothstep(0.2, 0.5, fbm(nMtn, x * 2, y * 2, z * 2, 4)), 0, 1);
    lastHigh = high;
    let h = 0.15 * base + 0.35 * high * ridged(nMtn, x * 8, y * 8, z * 8, octavesFor(R, 8, ctx.minWavelength * 2, 2.1, 12));
    const duneBelt = smoothstep(0.55, 0.3, Math.abs(lat)) * (1 - high);
    lastDune = duneBelt;
    if (duneBelt > 0.01) {
      const k = R / 1500; // dune wavelength ~1.5 km (scaled)
      const s = Math.abs(Math.sin(lat * k + 3 * nDune.noise(x * 30, y * 30, z * 30)));
      h += 0.04 * duneBelt * (1 - s) * (1 - s);
    }
    lastLake = 0;
    if (z > 0.75) {
      const l = smoothstep(0.1, 0.25, fbm(nLake, x * 6, y * 6, z * 6, 5)) * smoothstep(0.75, 0.9, z);
      lastLake = l;
      // Sable Sea and Lantern Sea: irregular connected northern depressions.
      let named = 0;
      for (const {c,width} of seas) {
        const d = Math.hypot(x-c.x,y-c.y,z-c.z)/width;
        if (d < 1.2) named = Math.max(named, smoothstep(1,0.55,d+0.13*nLake.noise(x*45,y*45,z*45)));
      }
      lastLake = Math.max(l, named);
      h = h * (1-named) - 0.25 * lastLake;
    }
    return relief * (z < 0.75 ? Math.max(-0.10, h) : h);
  };
  const PLAIN = ctx.pal(1, [0.3, 0.2, 0.1]);
  const DUNE = ctx.pal(0, [0.1, 0.07, 0.045]);
  const HIGH = ctx.pal(2, [0.45, 0.36, 0.22]);
  const LAKE: RGB = [0.015, 0.015, 0.018];
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB): RGB => {
    height(x, y, z);
    setRGB(out, PLAIN[0], PLAIN[1], PLAIN[2]);
    blendRGB(out, DUNE, lastDune);
    blendRGB(out, HIGH, lastHigh * 0.8);
    blendRGB(out, LAKE, smoothstep(0.2, 0.6, lastLake));
    return out;
  };
  return { height, maxHeight: relief * 0.6, minHeight: -relief * 0.45, colorAt };
}

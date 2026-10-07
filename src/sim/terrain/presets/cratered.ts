import type { RGB } from '../api';
import { CraterField, makeCraterOctaves } from '../craters';
import { fbm, ridged, octavesFor, smoothstep, clamp } from '../fbm';
import { latLonToUnit, type UnitVec } from '../geo';
import { blendRGB, setRGB, type PresetContext, type PresetResult } from './common';

/** Crater field sized for the body: largest craters ~0.3 unit cell, smallest ~ tens of meters. */
function craterFieldFor(ctx: PresetContext, opts: { largestCell?: number; smallestMeters?: number; depth: number; density?: number; freshness?: number; seedOff?: number }): CraterField {
  const smallest = Math.max((opts.smallestMeters ?? 30) / ctx.radius, 1e-7);
  return new CraterField({
    seed: ctx.seed * 31 + (opts.seedOff ?? 0),
    octaves: makeCraterOctaves({
      largestCell: opts.largestCell ?? 0.32,
      smallestCell: Math.min(smallest, (opts.largestCell ?? 0.32) * 0.5),
      largestDepth: opts.depth,
      bodyRadius: ctx.radius,
      ratio: 0.45,
      density: opts.density ?? 0.6,
      depthExponent: 0.8,
      freshness: opts.freshness ?? 0.25,
    }).slice(0, 15),
  });
}

interface Basin {
  c: UnitVec;
  /** angular radius (rad) */
  r: number;
}

/**
 * Moon: bright cratered highlands, dark flooded maria concentrated on the near side (+X faces the parent
 * for tidally locked bodies), crater rays/ejecta brightening.
 */
export function lunarPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const craters = craterFieldFor(ctx, { depth: relief * 0.3, density: 0.62, freshness: 0.12 });
  const nBase = ctx.noise(1);
  const nMare = ctx.noise(2);
  const nCol = ctx.noise(3);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 14);

  const basins: Basin[] = [
    { c: latLonToUnit(33, -18), r: 0.3 }, // Imbrium-like
    { c: latLonToUnit(28, 17), r: 0.17 }, // Serenitatis-like
    { c: latLonToUnit(8, 31), r: 0.2 }, // Tranquillitatis-like
    { c: latLonToUnit(17, 59), r: 0.1 }, // Crisium-like
    { c: latLonToUnit(18, -57), r: 0.42 }, // Procellarum-like
    { c: latLonToUnit(-21, -17), r: 0.15 }, // Nubium-like
    { c: latLonToUnit(-8, 51), r: 0.14 }, // Fecunditatis-like
    { c: latLonToUnit(-24, -39), r: 0.1 }, // Humorum-like
    { c: latLonToUnit(-48, 160), r: 0.12 }, // a far-side mare
  ];

  const mareMask = (x: number, y: number, z: number): number => {
    // Basin influence field (sum of soft caps) + noise, thresholded: neighbouring basins merge into
    // irregular, lobate lava plains instead of round discs.
    let f = 0;
    for (const b of basins) {
      const d2 = ((x - b.c.x) ** 2 + (y - b.c.y) ** 2 + (z - b.c.z) ** 2) / (b.r * b.r);
      if (d2 < 9) f += Math.exp(-d2 * 1.1);
    }
    const nearSide = smoothstep(-0.3, 0.6, x); // flooding favours the thin-crust near side (+X)
    f += 0.38 * fbm(nMare, x * 2.2, y * 2.2, z * 2.2, 5) + 0.12 * fbm(nMare, x * 9, y * 9, z * 9, 4) + 0.12 * nearSide - 0.06;
    const m = smoothstep(0.3, 0.4, f);
    return m;
  };

  const namedCraters = [
    { name: 'Wayfarer', c: latLonToUnit(-43.3,-11.2), radius: 0.027 },
    { name: 'Bell', c: latLonToUnit(9.6,-20.1), radius: 0.03 },
    { name: 'Glassmaker', c: latLonToUnit(23.7,-47.4), radius: 0.014 },
  ];
  let lastMare = 0;
  let lx = NaN, ly = NaN, lz = NaN;
  const height = (x: number, y: number, z: number): number => {
    lx = x; ly = y; lz = z;
    const m = mareMask(x, y, z);
    lastMare = m;
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct, 2, 0.5);
    const highlands = relief * (0.08 + 0.16 * base);
    const mare = relief * (-0.22 + 0.015 * base);
    const crat = craters.height(x, y, z, (o) => (o < 6 ? 1 - m * 0.97 : 1 - m * 0.5));
    // Wrinkle ridges in maria.
    const wr = m > 0.01 ? m * relief * 0.02 * ridged(nMare, x * 18, y * 18, z * 18, 4) : 0;
    let h = highlands * (1 - m) + mare * m + crat + wr;
    // Bell and Wayfarer basins, at near-side impact analogues.
    for (const {c, radius} of namedCraters) {
      const d = Math.hypot(x-c.x, y-c.y, z-c.z) / radius;
      if (d < 1.5) {
        const floor = -0.20 * smoothstep(1, 0.78, d);
        const peak = 0.16 * Math.exp(-d*d/0.018);
        const rim = 0.065 * Math.exp(-(((d-1)/0.12)**2));
        h += relief * (floor + peak + rim);
      }
    }
    return h;
  };

  const HIGH = ctx.pal(1, [0.22, 0.21, 0.2]);
  // Maria are ~half as reflective as highlands (palette dark entry is the extreme; blend towards it).
  const m0 = ctx.pal(0, [0.075, 0.072, 0.07]);
  const MARE: RGB = [m0[0] * 0.55 + HIGH[0] * 0.45, m0[1] * 0.55 + HIGH[1] * 0.45, m0[2] * 0.55 + HIGH[2] * 0.45];
  const FRESH: RGB = ctx.pal(2, [0.36, 0.35, 0.34]);
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB, fp?: number): RGB => {
    if (x !== lx || y !== ly || z !== lz) height(x, y, z); // refresh side outputs (mare mask, ejecta)
    setRGB(out, HIGH[0], HIGH[1], HIGH[2]);
    const n = nCol.noise(x * 7, y * 7, z * 7) * 0.5 + nCol.noise(x * 30, y * 30, z * 30) * 0.2;
    out[0] *= 1 + 0.12 * n; out[1] *= 1 + 0.12 * n; out[2] *= 1 + 0.12 * n;
    blendRGB(out, MARE, lastMare * (0.9 + 0.1 * n));
    blendRGB(out, FRESH, clamp(craters.ejectaAt(fp) * 0.45, 0, 1));
    return out;
  };

  return { height, maxHeight: relief * 0.3 + craters.maxDepth * 0.35 + relief * 0.05, minHeight: -relief * 0.25 - craters.maxDepth, colorAt };
}

/** Mercury: dense craters + smooth intercrater plains + lobate scarps; brownish grey. */
export function mercuryPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const craters = craterFieldFor(ctx, { depth: relief * 0.3, density: 0.68, freshness: 0.15 });
  const nBase = ctx.noise(1);
  const nPlain = ctx.noise(2);
  const nScarp = ctx.noise(3);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 14);
  const height = (x: number, y: number, z: number): number => {
    const plains = smoothstep(0.05, 0.3, fbm(nPlain, x * 2, y * 2, z * 2, 4));
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    // Lobate scarps: terraces from a quantised noise field.
    const s = nScarp.noise(x * 5, y * 5, z * 5) * 3;
    const scarp = (Math.floor(s) + smoothstep(0.8, 1, s - Math.floor(s))) * 0.03;
    const crat = craters.height(x, y, z, (o) => (o < 5 ? 1 - plains * 0.85 : 1));
    return relief * (0.15 * base + scarp) + crat;
  };
  const A = ctx.pal(1, [0.16, 0.15, 0.14]);
  const B = ctx.pal(0, [0.11, 0.105, 0.1]);
  const F = ctx.pal(2, [0.3, 0.29, 0.27]);
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB, fp?: number): RGB => {
    height(x, y, z);
    const n = fbm(nPlain, x * 2, y * 2, z * 2, 4);
    setRGB(out, A[0], A[1], A[2]);
    blendRGB(out, B, smoothstep(0.0, 0.3, n));
    blendRGB(out, F, clamp(craters.ejectaAt(fp) * 0.8, 0, 1));
    return out;
  };
  return { height, maxHeight: relief * 0.3 + craters.maxDepth * 0.35, minHeight: -relief * 0.3 - craters.maxDepth, colorAt };
}

/** Icy moons (Ganymede/Callisto/Rhea…): craters + bright grooved terrain bands on dark ancient crust. */
export function icyPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const craters = craterFieldFor(ctx, { depth: relief * 0.3, density: 0.6, freshness: 0.2 });
  const nGroove = ctx.noise(1);
  const nMask = ctx.noise(2);
  const nBase = ctx.noise(3);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 12);
  let lastMask = 0;
  let lx = NaN, ly = NaN, lz = NaN;
  const height = (x: number, y: number, z: number): number => {
    lx = x; ly = y; lz = z;
    const mask = smoothstep(-0.05, 0.15, fbm(nMask, x * 2.2, y * 2.2, z * 2.2, 5));
    lastMask = mask;
    const grooves = mask > 0.01 ? mask * ridged(nGroove, x * 40, y * 40, z * 4, 6) : 0;
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    const crat = craters.height(x, y, z, (o) => (o < 4 ? 1 - mask * 0.7 : 1));
    return relief * (0.12 * base + 0.08 * grooves) + crat;
  };
  const iapetus = ctx.body.id === 'iapetus';
  const DARK = iapetus ? ctx.pal(0, [0.03, 0.025, 0.02]) : ctx.pal(1, [0.22, 0.2, 0.18]);
  const BRIGHT = ctx.pal(2, [0.55, 0.55, 0.56]);
  const FRESH = ctx.pal(3, [0.75, 0.76, 0.78]);
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB, fp?: number): RGB => {
    if (x !== lx || y !== ly || z !== lz) height(x, y, z);
    setRGB(out, DARK[0], DARK[1], DARK[2]);
    if (iapetus) {
      // Two-tone: dark leading hemisphere (−Y for a synchronous prograde moon).
      blendRGB(out, BRIGHT, smoothstep(-0.25, 0.15, y + 0.15 * fbm(nMask, x * 3, y * 3, z * 3, 4)));
    } else {
      blendRGB(out, BRIGHT, lastMask);
    }
    blendRGB(out, FRESH, clamp(craters.ejectaAt(fp), 0, 1) * (iapetus ? 0.3 : 1));
    return out;
  };
  return { height, maxHeight: relief * 0.22 + craters.maxDepth * 0.35, minHeight: -relief * 0.15 - craters.maxDepth, colorAt };
}

/** Generic airless rocky body (asteroids, Phobos/Deimos, Pluto-ish fallback). */
export function rockyPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const craters = craterFieldFor(ctx, { depth: relief * 0.3, density: 0.55, freshness: 0.15 });
  const nBase = ctx.noise(1);
  const baseOct = octavesFor(R, 2, ctx.minWavelength, 2, 14);
  const height = (x: number, y: number, z: number): number => {
    const lumps = fbm(nBase, x * 1.5, y * 1.5, z * 1.5, baseOct, 2, 0.5);
    return relief * 0.3 * lumps + craters.height(x, y, z);
  };
  const A = ctx.pal(1, [0.2, 0.18, 0.16]);
  const B = ctx.pal(0, [0.12, 0.11, 0.1]);
  const C = ctx.pal(2, [0.3, 0.28, 0.25]);
  const colorAt = (x: number, y: number, z: number, h: number, out: RGB, fp?: number): RGB => {
    setRGB(out, A[0], A[1], A[2]);
    blendRGB(out, B, smoothstep(0, -relief * 0.4, h) * 0.6);
    craters.height(x, y, z);
    blendRGB(out, C, clamp(craters.ejectaAt(fp) * 0.6, 0, 1));
    return out;
  };
  return { height, maxHeight: relief * 0.3 + craters.maxDepth * 0.35, minHeight: -relief * 0.3 - craters.maxDepth, colorAt };
}

/**
 * Enceladus: very bright ice; cratered north, young smooth south with four parallel "tiger stripe"
 * fissures around the south pole (raised flanks, deep central trough, bluish ice).
 */
export function enceladusPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const craters = craterFieldFor(ctx, { depth: relief * 0.3, density: 0.55, freshness: 0.2 });
  const nBase = ctx.noise(1);
  const nWarp = ctx.noise(2);
  const baseOct = octavesFor(R, 3, ctx.minWavelength, 2, 12);
  // Tangent frame at the south pole, stripes rotated ~45°.
  const ca = Math.cos(0.8), sa = Math.sin(0.8);
  const spacing = 0.14;
  const halfLen = 0.27;
  let stripeT = 0;
  const stripes = (x: number, y: number, z: number): number => {
    if (z > -0.85) return 0;
    const w = 0.012 * nWarp.noise(x * 20, y * 20, z * 20);
    const a = x * ca + y * sa;
    const b = -x * sa + y * ca + w;
    let best = 1e9;
    for (let k = -1.5; k <= 1.5; k += 1) best = Math.min(best, Math.abs(b - k * spacing));
    const along = smoothstep(halfLen, halfLen * 0.75, Math.abs(a + 0.15 * b));
    const width = 0.02;
    const u = best / width;
    stripeT = along * Math.exp(-u * u * 0.25);
    // Trough with raised flanks: −(gaussian) + flanks
    return along * (-Math.exp(-u * u) * 1.0 + 0.45 * Math.exp(-((u - 1.8) ** 2)));
  };
  const height = (x: number, y: number, z: number): number => {
    const southness = smoothstep(-0.2, -0.6, z);
    const base = fbm(nBase, x * 3, y * 3, z * 3, baseOct);
    const crat = craters.height(x, y, z, () => 1 - southness * 0.92);
    const ridgesS = southness * ridged(nWarp, x * 25, y * 25, z * 25, 5) * 0.1;
    return relief * (0.12 * base + ridgesS + 0.5 * stripes(x, y, z)) + crat;
  };
  const ICE = ctx.pal(2, [0.85, 0.86, 0.88]);
  const BLUE: RGB = ctx.pal(0, [0.5, 0.68, 0.8]);
  const colorAt = (x: number, y: number, z: number, _h: number, out: RGB): RGB => {
    stripeT = 0;
    stripes(x, y, z);
    setRGB(out, ICE[0], ICE[1], ICE[2]);
    blendRGB(out, BLUE, clamp(stripeT * 1.3, 0, 1));
    return out;
  };
  return { height, maxHeight: relief * 0.36 + craters.maxDepth * 0.35, minHeight: -relief * 0.62 - craters.maxDepth, colorAt };
}

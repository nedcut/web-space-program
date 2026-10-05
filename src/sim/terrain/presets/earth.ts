import type { RGB } from '../api';
import { fbm, ridged, octavesFor, smoothstep, mix, clamp } from '../fbm';
import { latLonToUnit, angleTo, gaussCap } from '../geo';
import { blendRGB, setRGB, type PresetContext, type PresetResult } from './common';

/** Launch site (DECISIONS D-006): Coastal Launch Complex. */
export const LAUNCH_SITE = { lat: 28.5, lon: -80.6, elevation: 10, flatRadius: 3000, blendRadius: 3500 } as const;

/**
 * Runway on the launch-site plateau, in the pad's local tangent frame (metres: +X east, +Z south), running
 * east–west so take-offs head out to sea like launches. It lies entirely inside LAUNCH_SITE.flatRadius
 * (far corner ≈ 2.1 km from the pad), so the ground under it is exactly flat at the plateau elevation.
 */
export const RUNWAY = {
  /** Centre of the runway. */
  x: 0,
  z: 1600,
  length: 2500,
  width: 60,
  /** Take-off direction (unit, local XZ): toward +X (east). */
  dirX: 1,
  dirZ: 0,
  /** Distance from the west end to the spawn point (past the threshold markings), m. */
  spawnInset: 70,
} as const;

/** Body-fixed unit direction of a point given in the pad's local tangent frame (+X east, +Z south). */
export function siteLocalToUnit(x: number, z: number, radius: number): { x: number; y: number; z: number } {
  const up = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const el = Math.hypot(up.x, up.y);
  const E = { x: -up.y / el, y: up.x / el, z: 0 };
  // S = E × U (same basis as World.launch and LaunchSite).
  const S = { x: E.y * up.z - E.z * up.y, y: E.z * up.x - E.x * up.z, z: E.x * up.y - E.y * up.x };
  const px = up.x * radius + E.x * x + S.x * z, py = up.y * radius + E.y * x + S.y * z, pz = up.z * radius + E.z * x + S.z * z;
  const l = Math.hypot(px, py, pz);
  return { x: px / l, y: py / l, z: pz / l };
}

/**
 * Earth-like terrain: domain-warped continents with shelves and abyssal plains, ridged mountain belts,
 * rolling hills, latitude/moisture biomes. Fictional geography; a launch site plateau is guaranteed on an
 * east coast at LAUNCH_SITE.
 */
export function earthPreset(ctx: PresetContext): PresetResult {
  const { relief, radius: R } = ctx;
  const nWarp = ctx.noise(1);
  const nCont = ctx.noise(2);
  const nMtn = ctx.noise(3);
  const nHill = ctx.noise(4);
  const nBelt = ctx.noise(5);
  const nMoist = ctx.noise(6);
  const nSea = ctx.noise(7);

  const contOct = octavesFor(R, 1.1, 400, 2, 14);
  const mtnOct = octavesFor(R, 7, ctx.minWavelength * 2, 2.1, 16);
  const hillOct = octavesFor(R, 30, ctx.minWavelength, 2, 16);

  const site = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const lonR = (LAUNCH_SITE.lon * Math.PI) / 180;
  const east = { x: -Math.sin(lonR), y: Math.cos(lonR), z: 0 };
  const coastAngle = 0.02; // coastline ~1.1° east of the pad
  const siteTarget = 0.07;

  const rawContinent = (x: number, y: number, z: number, out: { qx: number; qy: number; qz: number }): number => {
    const wf = 1.4;
    const wx = fbm(nWarp, x * wf, y * wf, z * wf, 4);
    const wy = fbm(nWarp, x * wf + 5.2, y * wf + 1.3, z * wf - 2.8, 4);
    const wz = fbm(nWarp, x * wf - 3.7, y * wf + 9.1, z * wf + 4.4, 4);
    const qx = x + 0.5 * wx, qy = y + 0.5 * wy, qz = z + 0.5 * wz;
    out.qx = qx; out.qy = qy; out.qz = qz;
    // Large-scale plate pattern + detailed coast.
    const big = fbm(nCont, qx * 0.9, qy * 0.9, qz * 0.9, 3, 2, 0.5);
    const det = fbm(nCont, qx * 2.4 + 11.1, qy * 2.4 - 7.3, qz * 2.4 + 3.3, contOct, 2, 0.55);
    return big * 0.85 + det * 0.35 - 0.055;
  };

  const q = { qx: 0, qy: 0, qz: 0 };

  const continent = (x: number, y: number, z: number): number => {
    let c = rawContinent(x, y, z, q);
    // Launch-site forcing: blend towards a planar coast running N–S just east of the pad.
    const w = gaussCap(x, y, z, site, 0.1);
    if (w > 1e-4) {
      const eastDist = (x - site.x) * east.x + (y - site.y) * east.y + (z - site.z) * east.z;
      const k = eastDist / coastAngle;
      // Gentle rise inland (west), steeper drop to the continental shelf offshore (east).
      const target = siteTarget * (k < 1 ? 1 - k : 1 - k * 4 + 3);
      c = mix(c, Math.max(target, -0.25), w);
    }
    return c;
  };

  const height = (x: number, y: number, z: number): number => {
    const c = continent(x, y, z);
    const { qx, qy, qz } = q;
    const siteNear = gaussCap(x, y, z, site, 0.06);
    let h: number;
    if (c > 0) {
      const inland = smoothstep(0, 0.3, c);
      const coast = smoothstep(0, 0.025, c);
      const plains = 0.006 * coast + 0.06 * inland * inland;
      const belt = fbm(nBelt, qx * 1.7, qy * 1.7, qz * 1.7, 4);
      const mm = smoothstep(0.0, 0.25, belt) * smoothstep(0.015, 0.14, c) * (1 - siteNear);
      let mtn = 0;
      if (mm > 0.001) {
        // Range-scale ridges (~90 km) carrying sharper sub-ranges (~20 km) and valleys.
        const big = ridged(nMtn, qx * 7, qy * 7, qz * 7, 3, 2.1, 0.5, 1, 2);
        const fine = ridged(nMtn, x * 32 + 5.1, y * 32 - 2.7, z * 32 + 9.3, Math.max(1, mtnOct - 2), 2.1, 0.55, 1, 2.2);
        const r = big * (0.45 + 0.55 * fine);
        mtn = mm * Math.pow(r, 1.4);
      }
      const hills = fbm(nHill, x * 30, y * 30, z * 30, hillOct, 2, 0.5);
      const hillAmp = (0.012 + 0.04 * inland + 0.12 * mm) * (1 - 0.8 * siteNear);
      h = relief * (plains + 0.9 * mtn + hillAmp * hills * coast);
    } else {
      const s = -c;
      const shelf = smoothstep(0, 0.012, s);
      const slope = smoothstep(0.01, 0.08, s);
      const abyss = smoothstep(0.08, 0.3, s);
      const ridge = ridged(nSea, x * 3, y * 3, z * 3, 6, 2.1, 0.5, 1, 2);
      const hills = fbm(nHill, x * 30, y * 30, z * 30, Math.min(hillOct, 10), 2, 0.5);
      h = -relief * (0.012 * shelf + 0.28 * slope + 0.2 * abyss) + relief * (0.12 * abyss * ridge * ridge + 0.015 * hills * shelf);
    }
    // Estuary and inland lagoon; plateau blending below preserves launch flatness.
    const ll = Math.atan2(y, x) * 180 / Math.PI;
    const la = Math.asin(clamp(z, -1, 1)) * 180 / Math.PI;
    if (la > 28 && la < 32 && ll > -84 && ll < -80.5) {
      const river = Math.abs(ll - (-81.35 - 0.35*Math.sin((la-28)*3)));
      const lake = Math.hypot((la-30.2)/0.3, (ll+82.1)/0.24);
      const wet = Math.max(smoothstep(0.035, 0.012, river), smoothstep(1, 0.8, lake));
      h = mix(h, -relief*0.004, wet);
    }
    // Launch pad plateau.
    if (siteNear > 0.05) {
      const dm = angleTo(x, y, z, site) * R;
      if (dm < LAUNCH_SITE.flatRadius + LAUNCH_SITE.blendRadius) {
        const t = 1 - smoothstep(LAUNCH_SITE.flatRadius, LAUNCH_SITE.flatRadius + LAUNCH_SITE.blendRadius, dm);
        h = mix(h, LAUNCH_SITE.elevation, t);
      }
    }
    return h;
  };

  // --- Colours (linear RGB albedo) ---
  const SNOW: RGB = [0.78, 0.8, 0.84];
  const TUNDRA: RGB = [0.17, 0.16, 0.12];
  const BOREAL: RGB = [0.035, 0.06, 0.035];
  const FOREST: RGB = [0.045, 0.085, 0.03];
  const RAIN: RGB = [0.025, 0.065, 0.02];
  const GRASS: RGB = [0.13, 0.16, 0.06];
  const SAVANNA: RGB = [0.28, 0.23, 0.11];
  const DESERT: RGB = [0.5, 0.35, 0.19];
  const SAND: RGB = [0.62, 0.5, 0.32];
  const ROCK: RGB = [0.2, 0.18, 0.15];
  const BEACH: RGB = [0.6, 0.53, 0.38];
  const SEABED: RGB = [0.35, 0.32, 0.25];
  const tmp: RGB = [0, 0, 0];

  const colorAt = (x: number, y: number, z: number, h: number, out: RGB): RGB => {
    const lat = Math.asin(clamp(z, -1, 1));
    const alat = Math.abs(lat);
    const n1 = nMoist.noise(x * 6, y * 6, z * 6);
    const hr = Math.max(h, 0) / Math.max(relief, 1);
    const temp = Math.pow(Math.cos(lat), 0.7) * 1.15 - 0.17 - hr * 0.95 + 0.07 * n1;
    let moist = 0.5 + 0.55 * fbm(nMoist, x * 2.2 + 3, y * 2.2, z * 2.2, 5);
    const dDeg = (alat * 180) / Math.PI;
    moist -= 0.3 * Math.exp(-(((dDeg - 23) / 7) ** 2)); // subtropical desert belt
    moist += 0.35 * Math.exp(-((dDeg / 9) ** 2)); // equatorial rain belt
    moist += 0.15 * Math.exp(-(((dDeg - 52) / 12) ** 2));
    // Coastal lowlands are wetter; high plateaus drier (rain shadow proxy).
    moist += 0.28 * (1 - smoothstep(0, relief * 0.04, h)) - 0.15 * smoothstep(relief * 0.08, relief * 0.3, h);
    // Local variation (fields, forests, wetlands) at ~km scales.
    const nl = nMoist.noise(x * 420, y * 420, z * 420) * 0.6 + nMoist.noise(x * 1700, y * 1700, z * 1700) * 0.4;
    moist += 0.14 * nl;
    moist = clamp(moist, 0, 1);

    if (h < 0) {
      // Seafloor: sand on shelves, darker in depth (mostly hidden under water).
      setRGB(out, SEABED[0], SEABED[1], SEABED[2]);
      const d = clamp(-h / (relief * 0.05), 0, 1);
      out[0] *= 1 - 0.6 * d; out[1] *= 1 - 0.6 * d; out[2] *= 1 - 0.5 * d;
      return out;
    }
    // Base by moisture (warm climate).
    setRGB(out, DESERT[0], DESERT[1], DESERT[2]);
    blendRGB(out, SAVANNA, smoothstep(0.18, 0.35, moist));
    blendRGB(out, GRASS, smoothstep(0.35, 0.5, moist));
    blendRGB(out, FOREST, smoothstep(0.5, 0.68, moist));
    // Hot+wet → rainforest; hot+dry → sand seas
    blendRGB(out, RAIN, smoothstep(0.65, 0.8, moist) * smoothstep(0.75, 0.9, temp));
    blendRGB(out, SAND, smoothstep(0.12, 0.02, moist) * smoothstep(0.6, 0.8, temp) * 0.8);
    // Cold → boreal → tundra → snow
    tmp[0] = BOREAL[0]; tmp[1] = BOREAL[1]; tmp[2] = BOREAL[2];
    blendRGB(out, tmp, smoothstep(0.42, 0.3, temp) * smoothstep(0.2, 0.4, moist));
    blendRGB(out, TUNDRA, smoothstep(0.3, 0.2, temp));
    // Mountains: bare rock high up
    blendRGB(out, ROCK, smoothstep(0.22, 0.45, hr + 0.05 * n1));
    // Beaches
    blendRGB(out, BEACH, smoothstep(relief * 0.0025, 0, h) * 0.85 * (1 - smoothstep(0.3, 0.15, temp)));
    // Snow / ice caps
    blendRGB(out, SNOW, smoothstep(0.14, 0.04, temp));
    return out;
  };

  return {
    height,
    maxHeight: relief * 1.2 + LAUNCH_SITE.elevation,
    minHeight: -relief * 0.75,
    colorAt,
  };
}

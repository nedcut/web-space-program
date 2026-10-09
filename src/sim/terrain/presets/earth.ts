import { earthData } from '../earthData';
import { earthCover } from '../earthCover';
import type { RGB } from '../api';
import { fbm, ridged, octavesFor, smoothstep, mix } from '../fbm';
import { latLonToUnit, angleTo } from '../geo';
import { setRGB, type PresetContext, type PresetResult } from './common';

/** Launch site (DECISIONS D-006): Coastal Launch Complex. */
export const LAUNCH_SITE = { lat: 28.5, lon: -80.6, elevation: 10, flatRadius: 3000, blendRadius: 3500 } as const;

/**
 * Pad flame pit in the pad's local frame (metres: +X east, +Z south): a square hole of half size `half` centred
 * on the pad, and a trench of the same half width running north to `trenchEnd`. The 3D pad is drawn from these;
 * collision terrain stays flat over the pit, so the game keeps astronauts from being placed over it.
 */
export const LAUNCH_PAD_PIT = { half: 5, trenchEnd: -62 } as const;

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

/** Real ETOPO geography plus bounded, deterministic sub-grid detail. */
export function earthPreset(ctx: PresetContext): PresetResult {
  const grid = earthData(), verticalScale = ctx.relief / 8800;
  const site = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
  const noise = ctx.noise(4), variation = { range: 0, coastal: false, shore: 0 };
  const frequency = 4096 / (2 * Math.PI);
  const octaves = Math.min(5, octavesFor(ctx.radius, frequency, ctx.minWavelength, 2, 5));
  const extent = LAUNCH_SITE.flatRadius + LAUNCH_SITE.blendRadius;
  const nearDot = Math.cos(extent / ctx.radius);
  const height = (x: number, y: number, z: number): number => {
    let distance = Infinity;
    if (x * site.x + y * site.y + z * site.z > nearDot) {
      distance = angleTo(x, y, z, site) * ctx.radius;
      if (distance <= LAUNCH_SITE.flatRadius) return LAUNCH_SITE.elevation;
    }
    const metres = grid.sample(x, y, z, variation);
    // Local elevation range approximates slope. Plains stay flat, rugged cells receive ridges.
    // Fade at sea level so noise never creates fictional islands/coast crossings.
    const amplitude = Math.min(120, Math.abs(metres) * .08, variation.range * .12);
    const mountain = smoothstep(300, 1400, variation.range) * smoothstep(400, 1800, metres);
    const rolling = fbm(noise, x * frequency, y * frequency, z * frequency, octaves);
    const crests = mountain > 0 ? 2 * ridged(noise, x * frequency, y * frequency, z * frequency, octaves) - 1 : 0;
    const detail = amplitude * mix(rolling, crests, mountain);
    let h = (metres + detail) * verticalScale;
    if (distance < extent) h = mix(h, LAUNCH_SITE.elevation, 1 - smoothstep(LAUNCH_SITE.flatRadius, extent, distance));
    return h;
  };
  const palette: Record<ReturnType<typeof earthCover>, RGB> = {
    Oceans: [.16, .14, .11], Shores: [.34, .30, .19], Grasslands: [.13, .17, .055],
    Deserts: [.5, .35, .19], Mountains: [.20, .18, .15], 'Ice Caps': [.78, .8, .84],
    Forests: [.045, .085, .03], Rainforests: [.025, .065, .02], Tundra: [.25, .25, .20],
  };
  return {
    height, maxHeight: 9200 * verticalScale + LAUNCH_SITE.elevation, minHeight: -12200 * verticalScale,
    colorAt: (x, y, z, h, out) => {
      const lat = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
      const lon = Math.atan2(y, x) * 180 / Math.PI;
      const metres = grid.sample(x, y, z, variation);
      const cover = earthCover(lat, lon, h / verticalScale);
      const c = palette[cover];
      const v = cover === 'Ice Caps' ? 1 : 1 + .10 * noise.noise(x * 1700, y * 1700, z * 1700);
      // Beaches fade with the interpolated grid height and coast weight instead of switching per ETOPO cell,
      // which drew stair-stepped sand blocks along every coastline.
      const sand = cover === 'Oceans' || cover === 'Ice Caps' ? 0
        : (variation.shore ?? 0) * (1 - smoothstep(0, 12, metres));
      const s = palette.Shores;
      return setRGB(out, mix(c[0], s[0], sand) * v, mix(c[1], s[1], sand) * v, mix(c[2], s[2], sand) * v);
    },
  };
}

import { earthData } from '../earthData';
import { earthCover } from '../earthCover';
import type { RGB } from '../api';
import { fbm, ridged, octavesFor, smoothstep, mix } from '../fbm';
import { latLonToUnit } from '../geo';
import { setRGB, type PresetContext, type PresetResult } from './common';

/**
 * Launch site (DECISIONS D-006, amended 2026-10-14): mainland shore of the Indian River, west of Merritt Island and
 * Cape Canaveral, so the whole complex stands on real land at every scale preset and never reaches the Atlantic.
 * `elevation` is in unscaled metres like the ETOPO grid (the plateau scales with relief); `blend` (m) is how far
 * surrounding land eases toward the plateau; `sceneryRadius` (m) bounds the site's own vegetation.
 */
export const LAUNCH_SITE = { lat: 28.5, lon: -80.83, elevation: 6, blend: 400, sceneryRadius: 3000 } as const;
/** Plateau height in playable metres for a body with Earth's scaled `relief`. */
export const launchPlateau = (relief: number): number => LAUNCH_SITE.elevation * (relief / 8800);

/**
 * Pad flame pit in the pad's local frame (metres: +X east, +Z south): a square hole of half size `half` centred
 * on the pad, and a trench of the same half width running north to `trenchEnd`. The 3D pad is drawn from these;
 * collision terrain stays flat over the pit, so the game keeps astronauts from being placed over it.
 */
export const LAUNCH_PAD_PIT = { half: 5, trenchEnd: -62 } as const;

/**
 * Runway on the launch-site plateau, in the pad's local tangent frame (metres: +X east, +Z south), running
 * east–west so take-offs head out to sea like launches. SITE_GROUND covers it, so the ground under it is exactly
 * flat at the plateau elevation (far corner ≈ 2.1 km from the pad).
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

/** Pad tangent basis: U up, E east, S = E × U south (same basis as World.launch and LaunchSite). */
const SITE_U = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
const SITE_E = { x: -SITE_U.y / Math.hypot(SITE_U.x, SITE_U.y), y: SITE_U.x / Math.hypot(SITE_U.x, SITE_U.y), z: 0 };
const SITE_S = {
  x: SITE_E.y * SITE_U.z - SITE_E.z * SITE_U.y, y: SITE_E.z * SITE_U.x - SITE_E.x * SITE_U.z, z: SITE_E.x * SITE_U.y - SITE_E.y * SITE_U.x,
};

/** Body-fixed unit direction of a point given in the pad's local tangent frame (+X east, +Z south). */
export function siteLocalToUnit(x: number, z: number, radius: number): { x: number; y: number; z: number } {
  const up = SITE_U, E = SITE_E, S = SITE_S;
  const px = up.x * radius + E.x * x + S.x * z, py = up.y * radius + E.y * x + S.y * z, pz = up.z * radius + E.z * x + S.z * z;
  const l = Math.hypot(px, py, pz);
  return { x: px / l, y: py / l, z: pz / l };
}

/**
 * Ground the complex needs exactly flat, as capsules in the pad frame (segment a–b, half width r, metres):
 * pad hub with its buildings, crawlerway and assembly building, service road, taxiway, runway with blast pads.
 */
export const SITE_GROUND: readonly { ax: number; az: number; bx: number; bz: number; r: number }[] = [
  { ax: 0, az: 0, bx: 0, bz: 0, r: 520 },
  { ax: 0, az: 0, bx: 700, bz: -980, r: 260 },
  { ax: 205, az: 172, bx: 260, bz: 400, r: 60 },
  { ax: 260, az: 400, bx: 300, bz: 700, r: 60 },
  { ax: 300, az: 700, bx: RUNWAY.x + 300, bz: RUNWAY.z, r: 60 },
  { ax: RUNWAY.x - RUNWAY.length / 2 - 80, az: RUNWAY.z, bx: RUNWAY.x + RUNWAY.length / 2 + 80, bz: RUNWAY.z, r: 110 },
];
/** Farthest flat ground from the pad, m. */
const SITE_REACH = Math.max(...SITE_GROUND.map(c => Math.max(Math.hypot(c.ax, c.az), Math.hypot(c.bx, c.bz)) + c.r));

/** Signed distance (m) from pad-frame (x, z) to the flat site ground: ≤ 0 on it. */
export function siteClearance(x: number, z: number): number {
  let d = Infinity;
  for (const c of SITE_GROUND) {
    const dx = c.bx - c.ax, dz = c.bz - c.az, l = dx * dx + dz * dz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / l)) : 0;
    d = Math.min(d, Math.hypot(x - c.ax - t * dx, z - c.az - t * dz) - c.r);
  }
  return d;
}

/**
 * Pad-frame position of a body-fixed unit direction (inverse of siteLocalToUnit), or undefined when the direction's
 * cosine to the pad is below `minDot`. Writes into `out` to keep terrain sampling allocation-free.
 */
export function unitToSiteLocal(x: number, y: number, z: number, radius: number, minDot: number, out: { x: number; z: number }): typeof out | undefined {
  const u = x * SITE_U.x + y * SITE_U.y + z * SITE_U.z;
  if (u < minDot) return undefined;
  out.x = radius * (x * SITE_E.x + y * SITE_E.y + z * SITE_E.z) / u;
  out.z = radius * (x * SITE_S.x + y * SITE_S.y + z * SITE_S.z) / u;
  return out;
}

/** Real ETOPO geography plus bounded, deterministic sub-grid detail. */
export function earthPreset(ctx: PresetContext): PresetResult {
  const grid = earthData(), verticalScale = ctx.relief / 8800;
  const noise = ctx.noise(4), variation = { range: 0, coastal: false, shore: 0 };
  const frequency = 4096 / (2 * Math.PI);
  const octaves = Math.min(5, octavesFor(ctx.radius, frequency, ctx.minWavelength, 2, 5));
  const plateau = launchPlateau(ctx.relief), nearDot = Math.cos((SITE_REACH + LAUNCH_SITE.blend) / ctx.radius), local = { x: 0, z: 0 };
  const height = (x: number, y: number, z: number): number => {
    let clearance = Infinity;
    if (unitToSiteLocal(x, y, z, ctx.radius, nearDot, local)) {
      clearance = siteClearance(local.x, local.z);
      if (clearance <= 0) return plateau;
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
    // Land beside the site eases to the plateau; water keeps its own depth, so the site never adds coastline.
    if (clearance < LAUNCH_SITE.blend) h = mix(h, plateau, (1 - smoothstep(0, LAUNCH_SITE.blend, clearance)) * smoothstep(0, 1, metres));
    return h;
  };
  const palette: Record<ReturnType<typeof earthCover>, RGB> = {
    Oceans: [.16, .14, .11], Shores: [.34, .30, .19], Grasslands: [.13, .17, .055],
    Deserts: [.5, .35, .19], Mountains: [.20, .18, .15], 'Ice Caps': [.78, .8, .84],
    Forests: [.045, .085, .03], Rainforests: [.025, .065, .02], Tundra: [.25, .25, .20],
  };
  return {
    height, maxHeight: 9200 * verticalScale, minHeight: -12200 * verticalScale,
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

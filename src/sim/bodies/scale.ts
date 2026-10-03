import type { Body, BodyDef } from './types';

/**
 * Universe scaling (DECISIONS.md D-003).
 *
 * Given a scale factor s (1 = real, 0.1 = KSP-like):
 *  - All lengths (radii, semi-major axes, ring radii, terrain relief) scale by s.
 *  - GM scales by s^2 so surface gravity g = GM/R^2 is preserved.
 *    => orbital velocities scale by sqrt(s), periods by sqrt(s).
 *  - Atmosphere: surface pressure, temperature and composition are preserved; vertical extent
 *    (height and layer altitudes) scales by `atmosphereScale(s)` = s^0.5 by default. This keeps
 *    atmospheres meaningful (not paper-thin) on small planets, like KSP's 70 km on a 600 km Kerbin.
 *  - Rotation periods scale by sqrt(s) so the synchronous-orbit-to-radius ratio stays similar.
 */
export interface ScaleConfig {
  /** Length scale factor. */
  s: number;
  /** Exponent applied to s for atmospheric vertical extent. */
  atmosphereExponent: number;
  /** Exponent applied to s for rotation periods. */
  rotationExponent: number;
}

export const SCALE_PRESETS = {
  /** Default: KSP-like, forgiving, fun. Earth radius 637 km, orbit ~2.4 km/s. */
  standard: { s: 0.1, atmosphereExponent: 0.5, rotationExponent: 0.5 },
  /** Middle ground. */
  challenging: { s: 0.32, atmosphereExponent: 0.5, rotationExponent: 0.5 },
  /** The real thing. */
  real: { s: 1, atmosphereExponent: 1, rotationExponent: 1 },
} satisfies Record<string, ScaleConfig>;

export type ScalePresetId = keyof typeof SCALE_PRESETS;

export function scaleBodyDef(def: BodyDef, cfg: ScaleConfig): BodyDef {
  const { s } = cfg;
  const atmo = Math.pow(s, cfg.atmosphereExponent);
  const rot = Math.pow(s, cfg.rotationExponent);
  return {
    ...def,
    gm: def.gm * s * s,
    radius: def.radius * s,
    rotationPeriod: def.rotationPeriod * rot,
    orbit: def.orbit ? { ...def.orbit, a: def.orbit.a * s } : undefined,
    atmosphere: def.atmosphere
      ? {
          ...def.atmosphere,
          height: def.atmosphere.height * atmo,
          layers: def.atmosphere.layers?.map((l) => ({ altitude: l.altitude * atmo, lapseRate: l.lapseRate / atmo })),
          rayleigh: def.atmosphere.rayleigh?.map((c) => c / atmo) as [number, number, number] | undefined,
          mie: def.atmosphere.mie !== undefined ? def.atmosphere.mie / atmo : undefined,
        }
      : undefined,
    rings: def.rings ? { ...def.rings, innerRadius: def.rings.innerRadius * s, outerRadius: def.rings.outerRadius * s } : undefined,
    surface: { ...def.surface, relief: def.surface.relief * Math.max(s, 0.25) },
  };
}

/** Build the scaled body table with derived quantities (SOI, surface gravity, periods, children). */
export function buildUniverse(defs: BodyDef[], cfg: ScaleConfig): Map<string, Body> {
  const scaled = defs.map((d) => scaleBodyDef(d, cfg));
  const byId = new Map<string, BodyDef>(scaled.map((d) => [d.id, d]));
  const out = new Map<string, Body>();
  for (const d of scaled) {
    const parent = d.parent ? byId.get(d.parent) : undefined;
    let soi = Infinity;
    let orbitalPeriod: number | undefined;
    if (parent && d.orbit) {
      soi = d.orbit.a * Math.pow(d.gm / parent.gm, 0.4);
      orbitalPeriod = 2 * Math.PI * Math.sqrt(Math.pow(d.orbit.a, 3) / (parent.gm + d.gm));
    }
    out.set(d.id, {
      ...d,
      soi,
      surfaceGravity: d.gm / (d.radius * d.radius),
      rotationRate: d.rotationPeriod !== 0 ? (2 * Math.PI) / d.rotationPeriod : 0,
      orbitalPeriod,
      children: scaled.filter((c) => c.parent === d.id).map((c) => c.id),
    });
  }
  return out;
}

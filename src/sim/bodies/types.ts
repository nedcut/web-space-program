/**
 * Celestial body definitions. All values here are REAL-WORLD (scale = 1) source data.
 * The scaled universe is derived via `applyScale` in ./scale.ts — never hand-edit scaled values.
 */

/** Classical Keplerian elements relative to the parent body, at epoch J2000 (TDB seconds = 0). */
export interface OrbitalElements {
  /** Semi-major axis, meters. */
  a: number;
  /** Eccentricity. */
  e: number;
  /** Inclination, radians (relative to ecliptic for planets; parent's equator for most moons — see `frame`). */
  i: number;
  /** Longitude of ascending node, radians. */
  lan: number;
  /** Argument of periapsis, radians. */
  argPe: number;
  /** Mean anomaly at epoch, radians. */
  meanAnomalyAtEpoch: number;
  /** Epoch in seconds since J2000 (usually 0). */
  epoch: number;
  /** Reference plane the elements are given in. Elements are converted to the ecliptic frame at load. */
  frame?: 'ecliptic' | 'parentEquator';
}

export interface AtmosphereLayer {
  /** Base geometric altitude of layer, meters. */
  altitude: number;
  /** Temperature lapse rate in K/m (negative = cooling with altitude). */
  lapseRate: number;
}

export interface AtmosphereDef {
  /** Surface (datum) pressure, Pa. */
  surfacePressure: number;
  /** Surface temperature, K. */
  surfaceTemperature: number;
  /** Mean molar mass of gas, kg/mol. */
  molarMass: number;
  /** Ratio of specific heats (gamma). */
  gamma: number;
  /** Altitude above which atmosphere is treated as vacuum, meters. */
  height: number;
  /** Optional piecewise temperature profile (like US Standard Atmosphere). If omitted, isothermal with scale height. */
  layers?: AtmosphereLayer[];
  /** Rayleigh scattering coefficients (per meter, RGB at sea level) for the renderer. */
  rayleigh?: [number, number, number];
  /** Mie scattering coefficient at sea level (per meter). */
  mie?: number;
  /** Visual tint / haze colour hint (linear RGB 0..1). */
  tint?: [number, number, number];
}

export interface RingDef {
  innerRadius: number;
  outerRadius: number;
  /** Optional named texture/procedural profile id. */
  profile?: string;
  opacity?: number;
}

export type BodyKind = 'star' | 'planet' | 'dwarf' | 'moon';

export interface SurfaceStyle {
  /** Procedural terrain generator preset id, e.g. 'earth', 'lunar', 'mars', 'icy', 'gasGiant', 'volcanic'. */
  preset: string;
  /** Base colours (linear RGB) used by procedural shading. */
  colors: [number, number, number][];
  /** Max terrain relief, meters (real scale). */
  relief: number;
  /** Has liquid ocean at datum. */
  ocean?: boolean;
  /** Random seed for procedural generation. */
  seed: number;
}

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  /** Parent body id; undefined for the Sun. */
  parent?: string;
  /** Standard gravitational parameter GM, m^3/s^2. */
  gm: number;
  /** Mean (volumetric) radius, meters. */
  radius: number;
  /** Sidereal rotation period, seconds (negative = retrograde). */
  rotationPeriod: number;
  /** Axial tilt (obliquity to orbit), radians. */
  axialTilt: number;
  /** Right ascension / declination of north pole (ICRF, radians) — optional, used for precise orientation. */
  poleRA?: number;
  poleDec?: number;
  /** Rotation angle at epoch, radians. */
  rotationAtEpoch?: number;
  orbit?: OrbitalElements;
  atmosphere?: AtmosphereDef;
  rings?: RingDef;
  surface: SurfaceStyle;
  /** Gas giants / stars have no landable surface. */
  solidSurface: boolean;
  /** Short flavour text for the UI. */
  description?: string;
}

/** A body after scaling, with derived quantities. */
export interface Body extends BodyDef {
  /** Sphere of influence radius, meters (Laplace). Infinity for the Sun. */
  soi: number;
  /** Surface gravity, m/s^2. */
  surfaceGravity: number;
  /** Angular rotation rate, rad/s. */
  rotationRate: number;
  /** Orbital period around parent, seconds. */
  orbitalPeriod?: number;
  /** Child body ids. */
  children: string[];
}

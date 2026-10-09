import type { Vec3 } from '../../util/vec3';
import type { AtmosphereSample } from '../atmosphere/api';

/** Standard gravity, m/s^2 (Isp definition). */
export const G0 = 9.80665;
/** 1 standard atmosphere, Pa. */
export const ATM = 101325;
export const AU = 1.495978707e11;
/** Solar irradiance at 1 AU, W/m^2. */
export const SOLAR_CONSTANT = 1361;
export const STEFAN_BOLTZMANN = 5.670374419e-8;
export const GAS_CONSTANT = 8.314462618;

export interface GroundSample {
  /** Point on the terrain (or water surface) under the queried position, inertial frame. */
  surfacePoint: Vec3;
  /** Unit surface normal, inertial frame. */
  normal: Vec3;
  /** Velocity of the surface material at that point (body rotation), inertial frame. */
  surfaceVelocity: Vec3;
  isWater: boolean;
  liquidDensity?: number;
}

export interface AirSample {
  sample: AtmosphereSample;
  /** Velocity of the air mass (co-rotation + wind), inertial frame. */
  windVelocity: Vec3;
}

/**
 * Everything the vessel simulation needs from the world. Injected so the vessel module does not
 * depend on the body/orbit/terrain/atmosphere implementations. All queries take inertial positions.
 */
export interface Environment {
  /** Integrate in the translating body frame for microgravity precision. Requires referenceBody. */
  integrateRelative?: boolean;
  hazardTimeScale?: number;
  radiation?(pos: Vec3, t: number): number;
  regolithConcentration?(pos: Vec3, t: number): number;
  /** Gravitational acceleration at an inertial position (m/s^2). */
  gravity(posInertial: Vec3, t: number): Vec3;
  /** Atmosphere sample + air velocity (body rotation co-rotation) at a position. */
  air(posInertial: Vec3, t: number): AirSample;
  /** Ground under the position (terrain or ocean surface), or null if there is no surface (gas giant / far away). */
  ground(posInertial: Vec3, t: number): GroundSample | null;
  /**
   * OPTIONAL fast path: true only when there is no surface or the point is certainly more than `margin` metres
   * above it (terrain or liquid). One height sample instead of `ground`'s three; contact uses it to skip points
   * whose penetration depth would be negative anyway.
   */
  clearOfGround?(posInertial: Vec3, t: number, margin: number): boolean;
  /**
   * Sun direction (unit, from position toward the Sun) & distance (m) for solar power and heating.
   * `thermalDistance` is the unscaled (real-universe) distance used for skin heating; scaled universes
   * compress distances, so heating from `distance` would be 1/s² too strong. Defaults to `distance`.
   */
  sun(posInertial: Vec3, t: number): { dir: Vec3; distance: number; thermalDistance?: number; exposure?: number };
  /**
   * OPTIONAL: state of the dominant (reference) body. Used by SAS orbital modes (prograde/normal/radial).
   * If absent, inertial velocity is used for prograde and gravity direction for radial.
   */
  referenceBody?(posInertial: Vec3, t: number): { position: Vec3; velocity: Vec3 };
}

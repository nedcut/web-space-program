import type { Vec3 } from '../../util/vec3';

/**
 * CONTRACT (owned by orbit module). Implementations live alongside in src/sim/orbit/.
 * Frame: inertial ecliptic J2000, origin = Sun centre. Time t = seconds since J2000 (sim time).
 */
export interface StateVector {
  position: Vec3;
  velocity: Vec3;
}

/** A conic orbit around a body; used for vessels and bodies alike. */
export interface Orbit {
  /** Parent body id. */
  body: string;
  /** GM of parent, m^3/s^2. */
  mu: number;
  /** Semi-major axis (negative for hyperbolic), m. */
  a: number;
  e: number;
  i: number;
  lan: number;
  argPe: number;
  /** Mean anomaly at epoch; Barker's D + D^3/3 for exact parabolas. */
  m0: number;
  /** Epoch, seconds. */
  epoch: number;
  /** Semi-latus rectum; required for exact parabolas (a = Infinity, e = 1). */
  p?: number;
  /** Preserves precision near parabolic and degenerate radial states. Body-relative. */
  stateAtEpoch?: StateVector;
}

/** One segment of a patched-conic trajectory prediction. */
export interface TrajectoryPatch {
  /** Accepted numerical states in orbit.body frame; absent in patched-conic mode. */
  samples?: import('./numericalPrediction').TrajectorySample[];
  orbit: Orbit;
  startTime: number;
  /** End time (SOI change, impact, or prediction horizon). */
  endTime: number;
  endReason: 'soiExit' | 'soiEnter' | 'impact' | 'atmosphere' | 'horizon' | 'maneuver';
  /** Body id entered/exited at endTime, if applicable. */
  nextBody?: string;
}

export interface ManeuverNode {
  id: number;
  /** Universal time of burn. */
  time: number;
  /** Delta-v in orbit-local frame: prograde, normal, radial (out), m/s. */
  prograde: number;
  normal: number;
  radial: number;
}

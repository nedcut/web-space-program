import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import type { StateVector } from '../orbit/api';
import type { Mat3 } from './mat3';
import type { PartDef, ResourceDef, ResourceId } from './types';

/**
 * Runtime (flight) state of vessels. Everything here is plain data except `def` (shared reference to the
 * catalog PartDef) and `cache` (derived from topology; rebuilt by `rebuildTopology`).
 *
 * FRAMES
 *  - Craft/body frame: the frame PartInstance positions are authored in (root part at origin). Axes are
 *    fixed to the vessel; the vessel's centre of mass `com` is expressed in this frame.
 *  - `orientation` rotates body -> inertial. `position`/`velocity` are of the centre of mass, inertial.
 *  - `angularVelocity` is expressed in the body frame (rad/s).
 *
 * CONTROL AXES (body frame, nose = +Y, top = +Z, right = +X):
 *  - pitch > 0: nose toward +Z  (positive rotation about +X)
 *  - roll  > 0: top toward +X   (positive rotation about +Y)
 *  - yaw   > 0: nose toward +X  (negative rotation about +Z)
 *  Internally a "torque command" vector c = (pitch, roll, -yaw) in body XYZ is used.
 */

export type SasMode =
  | 'off'
  | 'stabilityAssist'
  | 'prograde'
  | 'retrograde'
  | 'normal'
  | 'antinormal'
  | 'radialIn'
  | 'radialOut'
  | 'target'
  | 'antiTarget'
  | 'maneuver';

export interface ControlInput {
  pitch: number;
  yaw: number;
  roll: number;
  translateX: number;
  translateY: number;
  translateZ: number;
  /** Main throttle 0..1. */
  throttle: number;
  sas: SasMode;
  /** Activate the next stage during this step (caller does edge detection). */
  stage: boolean;
  /** RCS enabled. */
  rcs: boolean;
  /** Optional: landing gear/legs desired state (undefined = unchanged). */
  gear?: boolean;
  /** Optional: velocity reference for prograde/retrograde (default 'orbit'). */
  sasReference?: 'orbit' | 'surface' | 'target';
  /** Optional: target state (inertial) for target/antiTarget modes and target-relative prograde. */
  target?: StateVector;
  /** Optional: maneuver burn direction (inertial unit vector) for 'maneuver' mode. */
  maneuverDirection?: Vec3;
}

export const neutralInput = (overrides: Partial<ControlInput> = {}): ControlInput => ({
  pitch: 0,
  yaw: 0,
  roll: 0,
  translateX: 0,
  translateY: 0,
  translateZ: 0,
  throttle: 0,
  sas: 'off',
  stage: false,
  rcs: false,
  ...overrides,
});

export interface EngineState {
  /** Index of the EngineModule in def.modules. */
  moduleIndex: number;
  ignited: boolean;
  flamedOut: boolean;
  /** Actual (spooled) throttle 0..1 — fraction of max mass flow. */
  throttle: number;
  /** Remaining ignitions (-1 = unlimited). */
  ignitionsLeft: number;
  /** Current thrust, N (telemetry/render). */
  thrust: number;
  /** Current mass flow, kg/s. */
  massFlow: number;
  /** Current Isp, s. */
  isp: number;
  /** Gimbal deflection (radians) about the two axes perpendicular to the thrust axis. */
  gimbal: { a: number; b: number };
}

export type ChutePhase = 'stowed' | 'armed' | 'semi' | 'full' | 'cut';

export interface ChuteState {
  moduleIndex: number;
  phase: ChutePhase;
  /** Deploy animation progress for the current phase 0..1. */
  progress: number;
  /** Current drag area CdA, m^2. */
  cda: number;
}

export interface LegState {
  moduleIndex: number;
  deployed: boolean;
  /** Current suspension compression, m. */
  compression: number;
  inContact: boolean;
}

export interface PartState {
  uid: number;
  partId: string;
  def: PartDef;
  /** Part centre in body (craft) frame. */
  position: Vec3;
  /** Part -> body rotation. */
  rotation: Quat;
  parent: number | null;
  children: number[];
  attachNode?: string;
  parentNode?: string;
  symmetryGroup?: number;
  stage?: number;
  /** Has this part's stage fired. */
  activated: boolean;
  resources: Partial<Record<ResourceId, number>>;
  maxResources: Partial<Record<ResourceId, number>>;
  /** Current total mass, kg (dry + resources). */
  mass: number;
  /** Internal (bulk) temperature, K. */
  temperature: number;
  /** Skin temperature per face [+X,-X,+Y,-Y,+Z,-Z] (part frame), K. */
  skinTemperature: number[];
  /** Destruction temperature (max of def.maxTemp and any heat shield rating), K. */
  maxTemp: number;
  engine?: EngineState;
  chute?: ChuteState;
  leg?: LegState;
  /**
   * Docking ports only: set on the port that joined *into* another vessel's port when two vessels docked,
   * remembering the absorbed vessel's identity so undocking restores it.
   */
  docked?: { vesselId: string; vesselName: string };
  /** Docking ports only: disengaged after undocking until no other port is within twice the capture range. */
  dockDisarmed?: boolean;
}

export interface SasState {
  mode: SasMode;
  /** Attitude held in stabilityAssist (body -> inertial), null while damping rates. */
  hold: Quat | null;
  /** Rate-loop integrator (body frame, rad/s^2). */
  integral: Vec3;
}

export type Situation = 'flying' | 'landed' | 'splashed';

export interface VesselTelemetry {
  /** Proper (non-gravitational) acceleration, m/s^2, inertial. */
  properAcceleration: Vec3;
  /** |properAcceleration| / G0. */
  gForce: number;
  mach: number;
  dynamicPressure: number;
  staticPressure: number;
  airDensity: number;
  /** Height of COM above the ground sample (NaN if no ground). */
  altitudeAGL: number;
  /** Total thrust, N. */
  thrust: number;
  /** Last commanded control vector after SAS (pitch, yaw, roll). */
  control: { pitch: number; yaw: number; roll: number };
}

/** Derived topology data. Never serialise; rebuild with `rebuildTopology`. */
export interface VesselCache {
  byUid: Map<number, PartState>;
  /** Tree depth from root. */
  depth: Map<number, number>;
  /** Stage in which the part gets jettisoned (-1 = stays with root). */
  decoupleStage: Map<number, number>;
  /** Stack-flow feed groups (priority order, each a list of uids) per engine uid. */
  feed: Map<number, number[][]>;
  /** Exposed face areas per part in part frame: [+X,-X,+Y,-Y,+Z,-Z], m^2. */
  exposed: Map<number, number[]>;
  /** Thermal links: [uidA, uidB, conductance W/K]. */
  links: [number, number, number][];
  /** Bounding radius about the COM, m. */
  boundingRadius: number;
}

export interface VesselState {
  id: string;
  name: string;
  rootUid: number;
  parts: PartState[];
  /** COM position, inertial, m. */
  position: Vec3;
  velocity: Vec3;
  /** Body -> inertial. */
  orientation: Quat;
  /** Body-frame angular velocity, rad/s. */
  angularVelocity: Vec3;
  mass: number;
  /** COM in body frame. */
  com: Vec3;
  /** Inertia tensor about COM, body axes, kg m^2. */
  inertia: Mat3;
  invInertia: Mat3;
  /** Highest stage number not yet activated (-1 = none). */
  nextStage: number;
  situation: Situation;
  sas: SasState;
  resourceDefs: Record<ResourceId, ResourceDef>;
  /** Counter for deterministic child vessel ids. */
  splitCount: number;
  destroyed: boolean;
  telemetry: VesselTelemetry;
  cache: VesselCache;
}

export type VesselEvent =
  | { type: 'stage'; vesselId: string; stage: number }
  | { type: 'decouple'; vesselId: string; partUid: number; newVesselId: string }
  | { type: 'engineIgnited'; vesselId: string; partUid: number }
  | { type: 'flameout'; vesselId: string; partUid: number }
  | { type: 'chute'; vesselId: string; partUid: number; phase: ChutePhase }
  | { type: 'partDestroyed'; vesselId: string; partUid: number; reason: 'overheat' | 'crash' | 'impact' }
  | { type: 'vesselDestroyed'; vesselId: string }
  | { type: 'docked'; vesselId: string; otherId: string }
  | { type: 'undocked'; vesselId: string; newVesselId: string };

export interface StepResult {
  /** Vessels created during the step (debris, decoupled stages). */
  newVessels: VesselState[];
  events: VesselEvent[];
}

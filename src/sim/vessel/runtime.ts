import type { ScienceData } from '../science/experiments';
import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import type { StateVector } from '../orbit/api';
import type { Mat3 } from './mat3';
import type { ActionGroupId, PartActionId, PartDef, PartGroupActions, PartLink, PartTweaks, ResourceDef, ResourceId } from './types';

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
  /** EVA-only camera attitude, hop edge, and run modifier. */
  evaHeading?: Quat;
  evaJump?: boolean;
  evaRun?: boolean;
  /** Main throttle 0..1. */
  throttle: number;
  sas: SasMode;
  /** Activate the next stage during this step (caller does edge detection). */
  stage: boolean;
  /** RCS enabled. */
  rcs: boolean;
  /** Optional: landing gear/legs desired state (undefined = unchanged). */
  gear?: boolean;
  /** Optional: wheel brakes applied this step. */
  brakes?: boolean;
  /** Optional: wheel drive motor command -1..1 (wheels with motorTorque). */
  wheelThrottle?: number;
  /** Optional: velocity reference for prograde/retrograde (default 'orbit'). */
  sasReference?: 'orbit' | 'surface' | 'target';
  /** Optional: target state (inertial) for target/antiTarget modes and target-relative prograde. */
  target?: StateVector;
  /** Optional: maneuver burn direction (inertial unit vector) for 'maneuver' mode. */
  maneuverDirection?: Vec3;
  /** Optional one-shot commands (part actions, action groups, flight tweaks), applied once by the authority. */
  commands?: VesselCommand[];
}

/** Flight-adjustable tweak keys (the rest are editor-only). */
export type FlightTweaks = Pick<PartTweaks, 'thrustLimit' | 'gimbalLimit' | 'gimbalLock' | 'crossfeed' | 'deflectionLimit' | 'deflectionInvert'
  | 'chuteMinPressure' | 'chuteDeployAltitude' | 'rcsEnabled' | 'rcsAxes' | 'wheelMode' | 'lightOn' | 'lightColor'>;

/** Player commands carried by ControlInput. `state` directs toggles (true = on/extend), absent flips. */
export type VesselCommand =
  | { kind: 'group'; group: ActionGroupId; state?: boolean }
  | { kind: 'part'; uid: number; action: PartActionId; state?: boolean; experiment?: string }
  | { kind: 'tweak'; uid: number; tweaks: FlightTweaks; symmetric?: boolean };

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
  /** Start-up transient finished since ignition: a liquid rocket now follows throttle changes almost at once. */
  spooledUp?: boolean;
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

export interface WheelState {
  moduleIndex: number;
  /** Commanded gear state. */
  deployed: boolean;
  /** Deploy animation 0 (stowed) .. 1 (down and locked). The wheel only touches the ground at 1. */
  deploy: number;
  /** Current suspension compression, m. */
  compression: number;
  inContact: boolean;
  /** Current steering angle, rad (telemetry/render). */
  steer: number;
  /** Wheel spin angle, rad (render). */
  spin: number;
  /** Rolling speed along the wheel heading, m/s (render/telemetry). */
  rollSpeed: number;
}

export interface PartState {
  /** Player settings (copied from the craft, some adjustable in flight). */
  tweaks?: PartTweaks;
  /** Action-group bindings. */
  actions?: PartGroupActions;
  link?: PartLink;
  linkFatigue?: number;
  /** Short overload exposure, seconds; absent when fully recovered. */
  structuralFatigue?: number;
  bayOpen?: boolean;
  drillDeployed?: boolean;
  drillDeploy?: number;
  converterRunning?: boolean;
  converterRecipe?: 'kerolox' | 'monopropellant';
  /** Isolated machinery core with integral radiator; K. */
  processTemperature?: number;
  scienceData?: ScienceData[];
  /** Surface expedition provenance follows hardware through staging and docking. */
  visitedBodies?: string[];
  /** Paid launch cost; spawned/EVA hardware has no salvage value. */
  purchaseCost?: number;
  /** Roster IDs seated in this pod; travels with the part on split/dock. */
  crew?: string[];
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
  ambientTemperature?: number;
  pressureExposure?: number;
  pressureWarned?: boolean;
  heatWarned?: boolean;
  radiationDose?: number;
  electronicsDegraded?: boolean;
  electronicsFailed?: boolean;
  temperature: number;
  /** Skin temperature per face [+X,-X,+Y,-Y,+Z,-Z] (part frame), K. */
  skinTemperature: number[];
  /** Destruction temperature (max of def.maxTemp and any heat shield rating), K. */
  maxTemp: number;
  engine?: EngineState;
  chute?: ChuteState;
  leg?: LegState;
  wheel?: WheelState;
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
  /** Intake air supply / demand of air-breathing engines (1 = fully fed; NaN = no jets running). */
  intakeAirRatio: number;
  /** Last commanded control vector after SAS (pitch, yaw, roll). */
  control: { pitch: number; yaw: number; roll: number };
}

/** Derived topology data. Never serialise; rebuild with `rebuildTopology`. */
export interface VesselCache {
  /** Crossflow warning latch; topology rebuilds and leaving the envelope re-arm it. */
  aeroWarned?: boolean;
  /** Derived flight stress readout; not serialized. */
  strutLoads?: Map<number, number>;
  jointLoads?: Map<number, import('./loads').JointLoad>;
  byUid: Map<number, PartState>;
  /** Tree depth from root. */
  depth: Map<number, number>;
  /** Stage in which the part gets jettisoned (-1 = stays with root). */
  decoupleStage: Map<number, number>;
  /** Stack-flow feed groups (priority order, each a list of uids) per engine uid. */
  feed: Map<number, number[][]>;
  /** Exposed face areas per part in part frame: [+X,-X,+Y,-Y,+Z,-Z], m^2. */
  exposed: Map<number, number[]>;
  /** Parts enclosed by an attached fairing shell (no aerodynamic forces). */
  shielded?: Set<number>;
  /** Body-frame point at which a part's aerodynamic force acts when not its centre (fairing shells). */
  aeroCentre?: Map<number, Vec3>;
  /** Thermal links: [uidA, uidB, conductance W/K]. */
  links: [number, number, number][];
  /** Bounding radius about the COM, m. */
  boundingRadius: number;
}

export interface VesselState {
  /** Toggle state of action groups (absent = off). Replaced, never mutated in place (splits share it). */
  groupState?: Partial<Record<ActionGroupId, boolean>>;
  eva?: { astronautId: string; walkPhase: number; walking: boolean; jetting: boolean };
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
  | { type: 'structuralWarning'; vesselId: string; loadFraction: number }
  | { type: 'linkBroken'; vesselId: string; partUid: number; targetUid: number; loadFraction: number }
  | { type: 'anomalyDiscovered'; vesselId: string; body: string; landmarkId: string }
  | { type: 'structuralFailure'; vesselId: string; partUid: number; parentUid: number; newVesselId: string; loadFraction: number }
  | { type: 'stage'; vesselId: string; stage: number }
  | { type: 'decouple'; vesselId: string; partUid: number; newVesselId: string }
  /** A fairing shell split into panels and fell away; its base ring stays on the vessel. */
  | { type: 'fairingJettison'; vesselId: string; partUid: number }
  | { type: 'engineIgnited'; vesselId: string; partUid: number }
  | { type: 'flameout'; vesselId: string; partUid: number }
  | { type: 'chute'; vesselId: string; partUid: number; phase: ChutePhase }
  | { type: 'hazardWarning'; vesselId: string; message: string }
  | { type: 'partDestroyed'; vesselId: string; partUid: number; reason: 'overheat' | 'crash' | 'impact' | 'pressure' }
  | { type: 'vesselDestroyed'; vesselId: string }
  | { type: 'docked'; vesselId: string; otherId: string }
  | { type: 'undocked'; vesselId: string; newVesselId: string };

export interface StepResult {
  /** Integrated engine and RCS impulse per mass for this step, m/s (excludes aero/contact). */
  propulsiveDv?: number;
  /** Vessels created during the step (debris, decoupled stages). */
  newVessels: VesselState[];
  /** Birth time relative to step start; absent means staging at step start. */
  newVesselTimeOffsets?: Record<string, number>;
  events: VesselEvent[];
}

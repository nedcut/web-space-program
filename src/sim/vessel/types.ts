import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';

/**
 * Part & vessel data model.
 *
 * PART FRAME: +Y is "up" (toward the nose of a rocket stacked vertically), +Z is "forward/top of
 * the vessel's belly-up side" for planes, X completes right-handed. Units meters/kg/s.
 * Parts are authored with their origin at their geometric centre.
 */

export type ResourceId = 'liquidFuel' | 'oxidizer' | 'monopropellant' | 'xenon' | 'solidFuel' | 'electricCharge' | 'ablator' | 'intakeAir' | 'regolith';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  /** Density kg per unit. Units are litres-ish; 1 unit = 1 L for propellants. */
  density: number;
  /** How this resource flows between parts. */
  flow: 'stack' | 'all' | 'none';
}

export interface AttachNode {
  id: string;
  /** Position in part frame. */
  position: Vec3;
  /** Outward direction in part frame (unit). */
  direction: Vec3;
  /** Node size class: 0 = 0.625m, 1 = 1.25m, 2 = 2.5m, 3 = 3.75m, 4 = 5m. */
  size: number;
}

export type PartCategory =
  | 'command'
  | 'fuelTank'
  | 'engine'
  | 'structural'
  | 'coupling'
  | 'aero'
  | 'control'
  | 'utility'
  | 'electrical'
  | 'ground'
  | 'science';

/**
 * Air-breathing (jet) engine performance. Thrust = maxThrustVac (static, sea level) × throttle × machCurve(M)
 * × (rho/rho0)^densityExponent × air supply fraction. Fuel flow = thrust / (Isp g0) with Isp = ispVac (= ispAsl):
 * Isp is the fuel-specific impulse (thousands of seconds), the oxidiser comes from the intake air.
 */
export interface AirBreathingSpec {
  /** Thrust multiplier vs Mach, piecewise linear [mach, multiplier] points (sorted by Mach). */
  machCurve: [number, number][];
  /** Thrust ∝ (rho / 1.225)^densityExponent. */
  densityExponent: number;
  /** Intake air consumed per kg of fuel burned (units = kg). */
  airRatio: number;
}

/** Engine module. Thrust/Isp curves are linear in ambient pressure between vac and ASL (1 atm). */
export interface EngineModule {
  type: 'engine';
  /** Vacuum thrust, N. */
  maxThrustVac: number;
  /** Specific impulse in vacuum and at 1 atm (101325 Pa), seconds. */
  ispVac: number;
  ispAsl: number;
  /** Propellant mix: resource -> ratio by volume (units). */
  propellants: Partial<Record<ResourceId, number>>;
  /** Minimum throttle 0..1 (solid rockets: 1, no throttling). */
  minThrottle: number;
  throttleable: boolean;
  /** Gimbal range, radians. */
  gimbalRange: number;
  /** Thrust direction in part frame (unit) — exhaust goes opposite. Usually (0,-1,0) exhaust, thrust +Y. */
  thrustDirection: Vec3;
  /** Throttle response time constant, seconds (0 = instant). */
  spoolTime: number;
  /** Exhaust plume visual style id. */
  plume: 'kerolox' | 'hydrolox' | 'solid' | 'methalox' | 'ion' | 'monoprop' | 'jet' | 'afterburner';
  /** Restartable in flight. */
  ignitions: number; // -1 = unlimited
  /** Present for jet engines: needs intake air, thrust follows Mach/density curves. */
  airBreathing?: AirBreathingSpec;
}

/** Air intake: produces 'intakeAir' ∝ density × airspeed × area (plus a static suction minimum). */
export interface IntakeModule {
  type: 'intake';
  /** Capture area, m^2. */
  area: number;
}

/**
 * Wheel / landing gear. PART FRAME CONVENTION: the gear hangs along part +Z (outward from the surface it is
 * mounted on, i.e. "down" under a fuselage); the wheel rolls along part +Y; the axle is part X.
 */
export interface WheelModule {
  type: 'wheel';
  /** Tyre radius, m. */
  radius: number;
  /** Suspension spring N/m and damper N*s/m. */
  spring: number;
  damper: number;
  /** Suspension travel, m. */
  travel: number;
  /** Wheel centre (part frame) when deployed and the suspension fully extended. */
  wheelCenter: Vec3;
  /** Max brake torque per wheel, N*m. */
  brakeTorque: number;
  /** Max steering angle, radians (absent = not steerable). */
  steerAngle?: number;
  /** Drive motor torque, N*m (absent = free rolling). */
  motorTorque?: number;
  /** Can be raised (G key). Fixed gear is always down. */
  retractable: boolean;
}

export interface RcsModule {
  type: 'rcs';
  thrustPerNozzle: number;
  ispVac: number;
  ispAsl: number;
  /** Nozzle directions (exhaust) in part frame. */
  nozzles: { position: Vec3; direction: Vec3 }[];
}

export interface ReactionWheelModule {
  type: 'reactionWheel';
  /** Torque per axis, N*m. */
  torque: number;
  /** EC per second at full torque. */
  ecRate: number;
}

export interface DecouplerModule {
  type: 'decoupler';
  /** Ejection impulse, N*s. */
  ejectionImpulse: number;
  /** Which attach node is decoupled ('bottom' typically). */
  node: string;
  /** Radial decouplers detach from parent instead. */
  radial?: boolean;
}

export interface ParachuteModule {
  type: 'parachute';
  /** Deployed drag area Cd*A, m^2. */
  deployedCdA: number;
  /** Semi-deployed drag area, m^2. */
  semiCdA: number;
  /** Min pressure to semi-deploy, Pa. */
  minPressure: number;
  /** Altitude above terrain at which full deployment happens, m. */
  deployAltitude: number;
  /** Max safe deploy dynamic pressure, Pa. */
  maxQ: number;
}

export interface LiftingSurfaceModule {
  type: 'liftingSurface';
  /** Planform area, m^2. */
  area: number;
  /** Lift slope per radian (thin airfoil ~2pi * efficiency). */
  liftSlope: number;
  /** Control surface deflection range (radians); 0 = fixed wing. */
  deflection: number;
  /** Fraction of area that is movable. */
  ctrlFraction: number;
}

export interface LandingLegModule {
  type: 'landingLeg';
  /** Suspension spring constant N/m and damping N*s/m. */
  spring: number;
  damper: number;
  /** Leg travel, m. */
  travel: number;
  /** Foot contact point in part frame when deployed. */
  footPosition: Vec3;
}

export interface SolarPanelModule {
  type: 'solarPanel';
  /** EC/s at 1 AU, facing sun. */
  chargeRate: number;
  tracking: boolean;
}

export interface CommandModule {
  type: 'command';
  crew: number;
  /** Has SAS / probe core level 0..3. */
  sasLevel: number;
  ecPerSecond: number;
  /** Passenger cabins carry crew without supplying flight control. */
  controllable?: false;
}

/**
 * Docking port. Two free ports of the same `size` whose `node`s come within `captureRange` (m), facing each
 * other within `captureAngle` (rad) at a relative speed below `captureSpeed` (m/s) are pulled together and
 * merged into one vessel on contact (see src/sim/vessel/docking.ts).
 */
export interface DockingPortModule {
  type: 'dockingPort';
  /** Port size class (same scale as attach node sizes); only equal sizes mate. */
  size: number;
  captureRange: number;
  captureSpeed: number;
  captureAngle: number;
  /** Attach node id that forms the docking face. */
  node: string;
}

export type LinkModule =
  /** Axial rigidity EA in N (spring stiffness = EA/span); strength in N. */
  | { type: 'strut'; maxLength: number; stiffness: number; strength: number }
  | { type: 'fuelLine'; maxLength: number };

export type PartModule =
  | LinkModule
  | { type: 'drill'; rate: number; ecRate: number; heat: number }
  | { type: 'converter'; rate: number; ecRate: number; heat: number }
  | { type: 'surveyScanner' }
  | { type: 'surfaceScanner' }
  | EngineModule
  | DockingPortModule
  | RcsModule
  | ReactionWheelModule
  | DecouplerModule
  | ParachuteModule
  | LiftingSurfaceModule
  | LandingLegModule
  | SolarPanelModule
  | CommandModule
  | IntakeModule
  | WheelModule
  | { type: 'heatShield'; ablationRate: number; maxTemp: number }
  | { type: 'fairing'; ejectionImpulse: number }
  | { type: 'light' }
  | { type: 'battery' }
  | { type: 'bay' }
  | { type: 'generator'; chargeRate: number }
  | { type: 'fuelCell'; chargeRate: number; fuelRate: number; oxidizerRate: number }
  | { type: 'science'; experiment: string }
  | { type: 'antenna'; transmission: number; range: number; relay: boolean };

export interface PartDef {
  id: string;
  name: string;
  manufacturer: string;
  description: string;
  category: PartCategory;
  /** Dry mass, kg. */
  dryMass: number;
  /** Cost, credits (for future career mode). */
  cost: number;
  /** Max resources stored: resource -> units. Parts start full. */
  resources: Partial<Record<ResourceId, number>>;
  attachNodes: AttachNode[];
  /** Can be surface-attached to other parts. */
  surfaceAttachable: boolean;
  /** Accepts surface-attached children. */
  allowSurfaceAttachChildren: boolean;
  /** Collision/aero bounding shape in part frame. */
  shape: { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number } | { kind: 'box'; size: Vec3 };
  /** Drag coefficient reference for the bare part (axial and side). */
  dragCoefficient: { axial: number; side: number };
  /** Max skin temperature before destruction, K. */
  maxTemp: number;
  /** Impact tolerance, m/s. */
  crashTolerance: number;
  /** Attachment strength overrides, N and N m. The weaker endpoint wins. */
  breakingForce?: number;
  breakingTorque?: number;
  modules: PartModule[];
  /** Procedural mesh builder id (see src/render/parts). */
  mesh: string;
  /** Mesh parameters forwarded to the builder. */
  meshParams?: Record<string, number | string | boolean>;
}

/** Endpoints are in each host part's LOCAL frame; invariant under docking/rerooting.
 * Additive versioned extension of craft/save/protocol v1. Absent on legacy decorative struts. */
export interface PartLink {
  version: 1;
  sourceUid: number;
  sourcePos: Vec3;
  sourceNormal: Vec3;
  targetUid: number;
  targetPos: Vec3;
  targetNormal: Vec3;
  /** Runtime separation/overload latch; never reconnects automatically. */
  broken?: boolean;
}

/** A part placed in a craft (editor output / save format). */
export interface PartInstance {
  link?: PartLink;
  /** Unique within the craft. */
  uid: number;
  partId: string;
  /** Position relative to the root part, in craft frame. */
  position: Vec3;
  rotation: Quat;
  /** Parent uid (undefined for root). */
  parent?: number;
  /** Attach node on this part used to attach to parent (or 'srf' for surface attach). */
  attachNode?: string;
  /** Node on the parent. */
  parentNode?: string;
  /** Symmetry group id. */
  symmetryGroup?: number;
  /** Stage index this part activates in (engines, decouplers, chutes). Higher = fires first like KSP. */
  stage?: number;
  /** Current resources (absent = full). */
  resources?: Partial<Record<ResourceId, number>>;
}

export interface CraftDef {
  name: string;
  /** Original library design; retained when a player renames, edits or saves it. */
  stockId?: string;
  description?: string;
  type: 'VAB' | 'SPH';
  parts: PartInstance[];
  version: 1;
}

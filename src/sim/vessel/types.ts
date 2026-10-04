import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';

/**
 * Part & vessel data model.
 *
 * PART FRAME: +Y is "up" (toward the nose of a rocket stacked vertically), +Z is "forward/top of
 * the vessel's belly-up side" for planes, X completes right-handed. Units meters/kg/s.
 * Parts are authored with their origin at their geometric centre.
 */

export type ResourceId = 'liquidFuel' | 'oxidizer' | 'monopropellant' | 'xenon' | 'solidFuel' | 'electricCharge' | 'ablator';

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
  plume: 'kerolox' | 'hydrolox' | 'solid' | 'methalox' | 'ion' | 'monoprop';
  /** Restartable in flight. */
  ignitions: number; // -1 = unlimited
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

export type PartModule =
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
  | { type: 'heatShield'; ablationRate: number; maxTemp: number }
  | { type: 'fairing'; ejectionImpulse: number }
  | { type: 'light' }
  | { type: 'battery' };

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
  modules: PartModule[];
  /** Procedural mesh builder id (see src/render/parts). */
  mesh: string;
  /** Mesh parameters forwarded to the builder. */
  meshParams?: Record<string, number | string | boolean>;
}

/** A part placed in a craft (editor output / save format). */
export interface PartInstance {
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
  description?: string;
  type: 'VAB' | 'SPH';
  parts: PartInstance[];
  version: 1;
}

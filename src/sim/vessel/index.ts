/**
 * Vessel physics public API. Single rigid-body vessels (DECISIONS D-004), deterministic, float64.
 */
export type * from './types';
export type * from './runtime';
export { neutralInput } from './runtime';
export type { Environment, GroundSample, AirSample } from './env';
export { G0, ATM, AU, SOLAR_CONSTANT, STEFAN_BOLTZMANN } from './env';
export type { Mat3 } from './mat3';

export {
  buildVessel,
  rebuildTopology,
  recomputeMassProperties,
  cloneVessel,
  splitVessel,
  removePart,
  applyImpulse,
  setGear,
  bodyToWorld,
  getPart,
  decouplerCutChildren,
} from './assembly';
export type { BuildOptions } from './assembly';

export {
  DEFAULT_RESOURCE_DEFS,
  buildFeedGroups,
  flowGroups,
  availableResource,
  drawResource,
  drawPropellants,
  addResource,
  totalResource,
  partMass,
} from './resources';

export {
  ispAtPressure,
  maxMassFlow,
  thrustAtPressure,
  targetThrottle,
  spoolThrottle,
  propellantNeed,
  igniteEngine,
  shutdownEngine,
  isSolidMotor,
  stepEngines,
  stepRcs,
  stepReactionWheels,
  gimbalAuthority,
  rcsAuthority,
  wheelAuthority,
} from './engines';

export { getStages, partsInStage, activateStage, activateNextStage, computeStageDeltaV } from './staging';
export type { StageDeltaV } from './staging';

export {
  machDragMultiplier,
  liftMachFactor,
  liftingCoefficients,
  computeExposedAreas,
  computeAeroForces,
  controlSurfaceAuthority,
  updateParachutes,
} from './aero';

export {
  SUTTON_GRAVES_K_EARTH,
  suttonGravesK,
  stagnationHeatFlux,
  recoveryTemperature,
  stepThermal,
  peakTemperature,
} from './heating';

export { MU_STATIC, MU_DYNAMIC, WATER_DENSITY, gatherContacts, solveContacts } from './contact';

export { computeSas, sasTargetDirection, attitudeError, pointingError } from './sas';

export {
  PHYSICS_DT,
  stepVessel,
  integrateOrientation,
  angularMomentum,
  rotationalEnergy,
  controlAuthority,
} from './integrator';
export type { StepOptions } from './integrator';

export {
  DOCK_CONTACT_DISTANCE,
  UNDOCK_SEPARATION_SPEED,
  dockingModule,
  portInfo,
  dockedPartner,
  isPortFree,
  freePorts,
  dockedPorts,
  portAlignment,
  findDockingCandidates,
  applyCaptureField,
  systemAngularMomentum,
  mergeVessels,
  stepDocking,
  rearmPorts,
  undock,
} from './docking';
export type { PortInfo, PortAlignment, DockingCandidate, DockingEvent } from './docking';

export { stepEva, EVA_HEIGHT, EVA_THRUST, EVA_EXHAUST_SPEED } from './eva';

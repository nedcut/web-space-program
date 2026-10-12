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
  gearState,
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
  stepPowerSources,
  partMass,
} from './resources';

export {
  ispAtPressure,
  maxMassFlow,
  thrustAtPressure,
  targetThrottle,
  spoolThrottle,
  spoolDownTime,
  throttleTimeConstant,
  ROCKET_THROTTLE_TIME,
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
  curveAt,
  jetThrustFactor,
  jetThrust,
  intakeRate,
  produceIntakeAir,
  RHO0,
  INTAKE_STATIC_SPEED,
  JET_MIN_AIR_FRACTION,
} from './engines';
export type { EngineAir } from './engines';

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

export { MU_STATIC, MU_DYNAMIC, WATER_DENSITY, TYRE_MU, TYRE_MU_SLIDE, ROLLING_RESISTANCE, GEAR_DEPLOY_TIME, gatherContacts, solveContacts, wheelContactPoint, updateWheelDeploy } from './contact';

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

export { stepEva, collideEvaWithHull, EVA_HEIGHT, EVA_THRUST, EVA_EXHAUST_SPEED } from './eva';
export { advanceISRU } from './isru';

export { evaluateJointLoads, jointStrength, breakJoints } from './structure';
export type { PartLoad, JointLoad } from './loads';

export {
  ACTION_GROUP_IDS,
  PART_ACTION_IDS,
  WORLD_ACTIONS,
  TOGGLE_ACTIONS,
  GROUP_LABELS,
  ACTION_LABELS,
  MAX_COMMANDS,
  partActions,
  actionState,
  actionAvailable,
  groupBindings,
  validGroupActions,
  validCommands,
  expandCommands,
  applyPartAction,
  applyVesselCommands,
  runActionGroup,
  deployable,
} from './actions';
export {
  thrustLimit,
  gimbalScale,
  deflectionScale,
  ejectionScale,
  crossfeedOpen,
  isExtended,
  autoDeploy,
  retractablePanel,
  lightOn,
  rcsEnabled,
  wheelMode,
  tweakDescriptors,
  validTweaks,
  mergeTweaks,
  applyFlightTweaks,
  LIGHT_COLORS,
} from './tweaks';
export type { TweakDescriptor, TweakKey } from './tweaks';
export { panelMaxQ, panelLoad, stepDeployables, PANEL_LOAD_WARN, PANEL_DEPLOY_TIME } from './deployables';

export { stageBurnTime, NODE_STAGE_PAUSE } from './burnTime';
export { canControlFrom, controlFrom, controlPartUid, controlRotation, freeSeats, stationModules, transferCrew } from './station';
export type { StationModule, StationPort } from './station';

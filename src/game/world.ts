import { enqueueNotification, whyCantWarp } from './cues';
import { NumericalPrediction } from '../sim/orbit/numericalPrediction';
import { LAGRANGE_PAIRS, lagrangePoints } from '../sim/orbit/lagrange';
import { advancePackedHazards, advanceCrewDose } from './world/hazards';
import { nearbyLandmarks } from '../sim/terrain/landmarks';

import { newRecorder, trimHistory, recordFor, startRecord, appendEvent, finishRecord, type FlightRecord, type EventKind } from './flightlog/recorder';
import { awardAchievements } from './flightlog/achievements';
import { loadAchievements, saveAchievements } from './flightlog/storage';
import { recordVessel } from './flightlog/worldRecorder';
import { careerScaleMultiplier } from '../sim/bodies/scale';
import { EVA_PART } from '../data/eva';
import { defaultCommsSettings, NO_SIGNAL, type CommsSettings, type Network } from '../sim/comms/network';
import { hasControl, type Astronaut, type PlantedFlag } from '../sim/crew/crew';
import { maneuverToInertialDv, period, predictTrajectory, propagate, stateAfterManeuver, stateToElements, trajectoryClosestApproach, validAnchor, type TrajectoryApproach } from '../sim/orbit';
import type { ManeuverNode, Orbit, StateVector, TrajectoryPatch } from '../sim/orbit/api';
import { newProgression, type GameMode, type ProgressEvent } from '../sim/science/progression';
import { activateNextStage, applyVesselCommands, expandCommands, MAX_COMMANDS, neutralInput, portInfo, recomputeMassProperties, setGear, stepVessel, WORLD_ACTIONS } from '../sim/vessel';
import { stepEva } from '../sim/vessel/eva';
import { advanceISRU, isruMachinery } from '../sim/vessel/isru';
import type { ControlInput, PartState, VesselCommand, VesselEvent, VesselState } from '../sim/vessel/runtime';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import { qRotate, type Quat } from '../util/quat';
import { add, length, scale, sub, type Vec3 } from '../util/vec3';
import { worldNetwork } from './comms';
import { advanceTransmissions, evaluateProgression, recoverScience } from './science';
import { clampWarp, RAILS_WARP, stepWarp, warpRate, warpRefusal, type WarpContext, type WarpState } from './timewarp';
import { Universe } from './universe';
import * as crew from './world/crew';
import * as docking from './world/docking';
import type { TrajectoryCache, WorldInternals } from './world/internals';
import * as launch from './world/launch';
import { AlarmClock } from './alarms';
import { NodeAnchors } from './world/nodeAnchors';
import * as progression from './world/progression';
import * as rails from './world/rails';
import * as readouts from './world/readouts';
import * as resources from './world/resources';
import { RenderHistory } from './world/renderInterpolation';

export const PHYSICS_DT = 1 / 50;
/** Distance from the active vessel inside which other vessels are simulated with full physics. */
const PHYSICS_RANGE = 5000;
/** Max physics steps per frame before we drop simulated time (prevents spiral of death on slow machines). */
const MAX_STEPS_PER_FRAME = 12;
/** Map patches drawn while the engines burn: the current conic and the next one (see World.burnTrajectory). */
const BURN_MAP_PATCHES = 2;

export type VesselMode = 'physics' | 'rails' | 'prelaunch' | 'landedRails';

export interface WorldVessel {
  precise?: { state: StateVector; time: number; frame: string };
  state: VesselState;
  mode: VesselMode;
  /** Dominant (reference) body id. */
  body: string;
  /** On rails: conic relative to `body`. */
  orbit?: Orbit;
  /** Next rails event (SOI change/impact/atmosphere) predicted when packed. */
  railsEvent?: { time: number; reason: TrajectoryPatch['endReason']; nextBody?: string };
  /** Landed/prelaunch: position + attitude fixed in the body's rotating frame. */
  fixed?: { pos: Vec3; orient: Quat };
  /**
   * Prelaunch only: the launch stage has fired and the hold-down clamps keep the vessel at `fixed` while its
   * engines spool up (seconds held, thrust at the previous step, build-frame COM at the last pin). See
   * {@link HOLD_DOWN_MAX}.
   */
  holdDown?: { time: number; thrust: number; com: Vec3 };
}

/** Longest the hold-down clamps keep a vessel whose engines have not reached liftoff thrust, s. */
export const HOLD_DOWN_MAX = 3;
const startHoldDown = (wv: WorldVessel) => ({ time: 0, thrust: 0, com: { ...wv.state.com } });

export interface WorldMessage {
  id: number;
  text: string;
  level: 'info' | 'warn' | 'bad';
  expires: number;
}


/** Pilot input that only means something under physics: steering, or throttle with an engine able to fire. */
function wantsToFly(v: VesselState, input: ControlInput): boolean {
  if (Math.abs(input.pitch) + Math.abs(input.yaw) + Math.abs(input.roll) > 1e-3) return true;
  return input.throttle > 0 && v.parts.some(p => p.engine?.ignited && !p.engine.flamedOut);
}

export class World {
  private readonly systems: WorldInternals = ((owner: World) => ({
    advanceRails: (target: number) => owner.advanceRails(target),
    captureFixed: (wv: WorldVessel, t: number) => owner.captureFixed(wv, t),
    handleEvent: (e: VesselEvent) => owner.handleEvent(e),
    launchRunway: (craft: CraftDef, keepExisting = false) => owner.launchRunway(craft, keepExisting),
    newVesselId: () => owner.newVesselId(),
    pack: (wv: WorldVessel) => owner.pack(wv),
    predictRailsEvent: (wv: WorldVessel) => owner.predictRailsEvent(wv),
    get stageRequested() { return owner.stageRequested; },
    set stageRequested(value: boolean) { owner.stageRequested = value; },
    syncFixed: (wv: WorldVessel, t: number) => owner.syncFixed(wv, t),
    syncPacked: (wv: WorldVessel, t: number) => owner.syncPacked(wv, t),
    get trajectoryCache() { return owner.trajectoryCache; },
    set trajectoryCache(value: TrajectoryCache | null) { owner.trajectoryCache = value; },
    unpack: (wv: WorldVessel) => owner.unpack(wv),
  }))(this);

  preciseGravity = false;
  showLagrangePoints = false;
  /** Adaptive rails proposal; runtime only. */
  preciseStep = 60;
  setPreciseGravity(enabled: boolean) {
    if (this.preciseGravity === enabled) return;
    this.preciseGravity = enabled;
    this.preciseStep = 60;
    this.trajectoryCache = null;
    this.numericalCache = null;
    for (const v of this.vessels.values()) {
      v.precise = undefined;
      if (v.mode === 'rails') {
        const rs = this.relativeState(v);
        v.orbit = stateToElements(this.universe.body(v.body).gm,v.body,rs.position,rs.velocity,this.ut);
        this.predictRailsEvent(v);
      }
    }
  }
  commsSettings: CommsSettings;
  /** Persisted vessel IDs; data credit itself remains on parts through splits/docking. */
  transmitting: string[] = [];
  private networkCache: { ut: number; key: string; value: Network } | null = null;
  /** At most 4 Hz in simulation time, with immediate topology invalidation. */
  get comms(): Network {
    const key = [...this.vessels.values()].map(v => `${v.state.id}:${v.state.destroyed}:${v.state.parts.map(p => p.uid + ':' + p.partId).join(',')}`).join('|');
    if (!this.networkCache || this.networkCache.key !== key || Math.abs(this.ut - this.networkCache.ut) >= 0.25) {
      this.networkCache = { ut: this.ut, key, value: worldNetwork(this) };
    }
    return this.networkCache.value;
  }
  connection(v = this.active?.state) { return v ? this.comms.connections.get(v.id) ?? NO_SIGNAL : NO_SIGNAL; }
  surveyedBodies: string[] = [];
  discoveries: string[] = [];

  discoverLandmarks() {
    for (const v of this.vessels.values()) {
      if (v.state.destroyed) continue;
      const body = this.universe.body(v.body);
      if (!body.solidSurface) continue;
      const rel = sub(v.state.position, this.universe.ephem.getBodyState(v.body, this.ut).position);
      if (Math.abs(length(rel) - body.radius) > this.universe.terrain(v.body).maxHeight + 2000) continue;
      const fixed = this.universe.ephem.toBodyFixed(v.body, rel, this.ut);
      for (const l of nearbyLandmarks(body, this.universe.terrain(v.body), fixed, this.discoveries)) {
        this.discoveries.push(l.id);
        if (this.mode !== 'sandbox') this.progression.science += 25;
        this.onEvent?.({ type: 'anomalyDiscovered', vesselId: v.state.id, body: v.body, landmarkId: l.id });
        this.message(`Discovered ${l.name}${this.mode === 'sandbox' ? '' : ' · +25 science'}`, 'info', 8);
      }
    }
  }

  localConcentration(wv = this.active): number { return resources.localConcentration.call(this, this.systems, wv); }

  /** A bound orbit, above terrain/atmosphere, within 10 degrees of polar relative to the body's pole. */
  surveyBody(wv = this.active): boolean { return resources.surveyBody.call(this, this.systems, wv); }

  flightlog = newRecorder();
  achievementProfile = loadAchievements();
  latestReportId: string | null = null;
  checkAchievements(r: FlightRecord) {
    const earned = awardAchievements(this.achievementProfile.unlocked, r, this.achievementProfile.flags, this.ut);
    if (earned.length) { saveAchievements(this.achievementProfile); for (const a of earned) this.message(`Achievement · ${a.name}`, 'info', 8); }
  }
  recordFlight(v: WorldVessel, ut = this.ut, force = false) { return recordVessel(this, v, ut, force); }
  logFlightEvent(v: WorldVessel, kind: EventKind, detail?: string) {
    const r = recordFor(this.flightlog, v.state.id) ?? startRecord(this.flightlog, v.state.id, v.state.name, this.ut);
    appendEvent(r, this.ut, kind, v.body, { detail }); this.checkAchievements(r);
  }
  closeFlightRecord(v: WorldVessel, outcome: NonNullable<FlightRecord['outcome']>, ut = this.ut) {
    const r = recordFor(this.flightlog, v.state.id);
    if (r) { finishRecord(r, ut, outcome); this.checkAchievements(r); trimHistory(this.flightlog); }
  }
  finishFlight(v: WorldVessel, outcome: 'recovered' | 'lost', ut = this.ut) {
    this.recordFlight(v, ut, true);
    const r = recordFor(this.flightlog, v.state.id);
    if (r) { finishRecord(r, ut, outcome); this.latestReportId = r.id; this.checkAchievements(r); trimHistory(this.flightlog); }
  }
  inheritFlight(parent: WorldVessel, child: WorldVessel) {
    const source = recordFor(this.flightlog, parent.state.id);
    if (!source) { this.recordFlight(child, this.ut, true); return; }
    const target = startRecord(this.flightlog, child.state.id, child.state.name, source.start);
    const identity = { id: target.id, vesselId: target.vesselId, name: target.name };
    Object.assign(target, structuredClone(source), identity);
  }
  progression = newProgression();
  readonly universe: Universe;
  readonly vessels = new Map<string, WorldVessel>();
  crewSeed = 19690720;
  crew: Astronaut[] = [];
  flags: PlantedFlag[] = [];
  activeId: string | null = null;
  ut: number;
  warp: WarpState = { mode: 'rails', index: 0 };
  nodes: ManeuverNode[] = [];
  readonly alarmClock = new AlarmClock();
  private readonly nodeAnchors = new NodeAnchors();
  seenTips: string[] = [];
  private recentMessages = new Map<string, number>();
  messages: WorldMessage[] = [];
  /** Navigation target: a vessel id or a body id (null = none). */
  targetId: string | null = null;
  /** Optional specific docking port (part uid) on the target vessel. */
  targetPortUid: number | null = null;
  /** Real-time accumulator for fixed physics steps. */
  private acc = 0;
  /** Pre-step vessel poses for render interpolation (read-only with respect to the simulation). */
  readonly renderHistory = new RenderHistory();
  /** Fraction of the next physics step already accumulated (0..1): render interpolation factor. */
  get renderAlpha(): number { return Math.max(0, Math.min(1, this.acc / PHYSICS_DT)); }
  private msgId = 0;
  private stageRequested = false;
  private evaJumpRequested = false;
  /** One-shot player commands latched until a physics step consumes them (like staging). */
  private pendingCommands: VesselCommand[] = [];
  private nodeId = 1;
  private trajectoryCache: TrajectoryCache | null = null;
  private approachCache: { time: number; key: string; value: TrajectoryApproach | null } | null = null;
  readonly catalog: Map<string, PartDef>;
  /** Event listeners (audio, camera shake, UI). */
  onEvent: ((e: VesselEvent) => void) | null = null;
  /** Optional headless observer after each physics/rails step; dt and active propulsion cost in m/s. */
  onSimulationStep: ((dt: number, propulsiveDv: number) => void) | null = null;

  constructor(universe: Universe, catalog: Map<string, PartDef>, ut: number, public mode: GameMode = 'sandbox') {
    this.commsSettings = defaultCommsSettings(mode);
    this.universe = universe;
    this.progression = newProgression(careerScaleMultiplier(universe.preset));
    this.catalog = new Map(catalog);
    this.catalog.set(EVA_PART.id, EVA_PART);
    this.ut = ut;
    if (mode === 'career') this.refreshContracts();
  }

  requestRecoveryGrant() { return progression.requestRecoveryGrant.call(this); }
  refreshContracts() { return progression.refreshContracts.call(this); }
  acceptContract(id: string) { return progression.acceptContract.call(this, id); }
  abandonContract(id: string) { return progression.abandonContract.call(this, id); }
  unlockTech(id: string) { return progression.unlockTech.call(this, id); }
  scienceContext(v = this.active) { return progression.scienceContext.call(this, v); }
  scienceInstruments(v = this.active) { return progression.scienceInstruments.call(this, v); }
  runExperiment(uid: number, experiment: string) { return progression.runExperiment.call(this, uid, experiment); }
  transmitScience() { return progression.transmitScience.call(this); }
  emitProgress(event: ProgressEvent) { return progression.emitProgress.call(this, event); }
  onReachedOrbit(v: WorldVessel) { return progression.onReachedOrbit.call(this, v); }
  onLanded(v: WorldVessel) { return progression.onLanded.call(this, v); }
  onEnteredSoi(v: WorldVessel) { return progression.onEnteredSoi.call(this, v); }
  onScienceCollected(v: WorldVessel, biome: string) { return progression.onScienceCollected.call(this, v, biome); }
  onRecovered(v: WorldVessel) { return progression.onRecovered.call(this, v); }

  get active(): WorldVessel | null {
    return this.activeId ? (this.vessels.get(this.activeId) ?? null) : null;
  }

  message(text: string, level: WorldMessage['level'] = 'info', seconds = 4) {
    const now = performance.now();
    const next = enqueueNotification(this.messages, this.recentMessages, { id: ++this.msgId, text, level, expires: now + seconds * 1000 }, now);
    this.messages = next.messages;
    this.recentMessages = next.history;
  }

  /** Lowest point of the vessel along its own -Y axis, measured from the COM (positive number). */
  bottomOffset(v: VesselState): number { return launch.bottomOffset.call(this, this.systems, v); }

  /**
   * Distance from the COM to the vessel's lowest point along body direction `down` (unit, body frame): hull
   * points of every part and the tyres of deployed wheels at full suspension extension.
   */
  restOffset(v: VesselState, down: Vec3): number { return launch.restOffset.call(this, this.systems, v, down); }

  /**
   * Spawn a craft. 'pad' (default for VAB crafts): on the launch pad, held by launch clamps until the first
   * stage fires. 'runway' (default for SPH crafts): free on its wheels at the runway threshold, nose down the
   * runway (body +Y along the runway, +Z up), ready to taxi.
   */
  launch(craft: CraftDef, site: 'pad' | 'runway' = craft.type === 'SPH' ? 'runway' : 'pad', keepExisting = false): WorldVessel { const v = launch.launch.call(this, this.systems, craft, site, keepExisting); this.recordFlight(v, this.ut, true); return v; }

  private launchRunway(craft: CraftDef, keepExisting = false): WorldVessel { return launch.launchRunway.call(this, this.systems, craft, keepExisting); }

  private newVesselId() { return launch.newVesselId.call(this, this.systems); }

  /** Add a free-flying craft with the given inertial COM state and attitude (physics mode; not made active). */
  spawnVessel(craft: CraftDef, state: { position: Vec3; velocity: Vec3; orientation: Quat }, name = craft.name): WorldVessel { return launch.spawnVessel.call(this, this.systems, craft, state, name); }

  /** Assign only newly created pods. Existing empty seats must stay empty. */
  assignCrew(v: VesselState) { return crew.assignCrew.call(this, this.systems, v); }

  crewFor(v = this.active?.state): Astronaut[] { return crew.crewFor.call(this, this.systems, v); }

  canControl(v = this.active?.state): boolean { return crew.canControl.call(this, this.systems, v); }

  /** Hatch is on the pod's +Z face. Public for HUD/rendezvous tools. */
  hatchPosition(v: VesselState, pod: PartState): Vec3 { return crew.hatchPosition.call(this, this.systems, v, pod); }

  goEva(astronautId?: string): WorldVessel | null { const host = this.active; const v = crew.goEva.call(this, this.systems, astronautId); if (v) { this.recordFlight(v, this.ut, true); this.logFlightEvent(v, 'eva'); if (host) this.logFlightEvent(host, 'eva'); } return v; }

  boardingTarget(): { vessel: WorldVessel; pod: PartState } | null { return crew.boardingTarget.call(this, this.systems); }

  boardingBlocker(whole = false): string | null { return crew.boardingBlocker.call(this, this.systems, whole); }

  /** The active astronaut's nearest hatch (free seats first), for the HUD's hatch marker. */
  nearestHatch(): crew.NearestHatch | null { return crew.nearestHatch.call(this, this.systems); }

  boardEva(): boolean { const v = this.active; const ok = crew.boardEva.call(this, this.systems); if (ok && v) this.closeFlightRecord(v, 'boarded'); return ok; }

  plantFlag(): PlantedFlag | null { const flag = crew.plantFlag.call(this, this.systems); if (flag && this.active) { if (!this.achievementProfile.flags.includes(flag.body)) this.achievementProfile.flags.push(flag.body); this.logFlightEvent(this.active, 'flag'); saveAchievements(this.achievementProfile); } return flag; }

  /** Update a body-fixed vessel's inertial state from its fixed coordinates. */
  private syncFixed(wv: WorldVessel, t: number) { return rails.syncFixed.call(this, this.systems, wv, t); }

  /** Capture a landed vessel's body-fixed coordinates (for rails warp while landed). */
  private captureFixed(wv: WorldVessel, t: number) { return rails.captureFixed.call(this, this.systems, wv, t); }

  relativeState(wv: WorldVessel, t = this.ut): StateVector { return readouts.relativeState.call(this, wv, t); }

  orbitOf(wv: WorldVessel): Orbit { return readouts.orbitOf.call(this, wv); }

  /** Put a vessel on rails at the current time. */
  private pack(wv: WorldVessel) { return rails.pack.call(this, this.systems, wv); }

  /** Make another vessel active (switching the floating origin / controls to it). */
  switchTo(id: string): boolean {
    const wv = this.vessels.get(id);
    if (!wv || id === this.activeId) return false;
    this.activeId = id;
    this.stageRequested = false;
    this.evaJumpRequested = false;
    this.pendingCommands = [];
    this.nodes = [];
    this.trajectoryCache = null;
    if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
    return true;
  }

  /** Cycle to the next vessel within physics range of the active one (debris, decoupled stages). */
  /** Switch to the next (or previous, `direction` −1) vessel within physics range, in stable id order. */
  focusNextNearby(direction: 1 | -1 = 1): string | null {
    const act = this.active;
    if (!act) return null;
    const ids = [...this.vessels.values()]
      .filter((v) => v === act || length(sub(v.state.position, act.state.position)) < PHYSICS_RANGE)
      .map((v) => v.state.id)
      .sort();
    if (ids.length < 2) return null;
    const next = ids[(ids.indexOf(act.state.id) + direction + ids.length) % ids.length];
    this.switchTo(next);
    return next;
  }

  /** Recover the active vessel if it's at rest on Earth (returns true when removed). */
  recoverActive(): boolean { return this.activeId ? this.recoverVessel(this.activeId) : false; }

  recoverVessel(id: string): boolean {
    const wv = this.vessels.get(id);
    if (!wv || wv.state.destroyed || wv.body !== 'earth' || (wv.mode !== 'prelaunch' && wv.state.situation === 'flying')) return false;
    this.finishFlight(wv, 'recovered');
    recoverScience(this, wv);
    this.vessels.delete(wv.state.id);
    if (this.activeId === id) { this.activeId = null; this.nodes = []; }
    if (this.targetId === id) this.setTarget(null);
    return true;
  }

  /** After deserialization: recompute derived rails data and resync body-fixed vessels to the current time. */
  restoreAfterLoad() {
    this.nodeId = Math.max(0, ...this.nodes.map(n => n.id)) + 1;
    for (const wv of this.vessels.values()) {
      if (wv.mode === 'rails' && wv.orbit) this.predictRailsEvent(wv);
      if ((wv.mode === 'landedRails' || wv.mode === 'prelaunch') && wv.fixed) this.syncFixed(wv, this.ut);
      // Saved mid hold-down (engines already lit on the pad): resume holding rather than freezing them.
      if (wv.mode === 'prelaunch' && wv.state.parts.some(p => p.engine?.ignited)) wv.holdDown = startHoldDown(wv);
    }
    this.trajectoryCache = null;
    this.approachCache = null;
    this.networkCache = null;
  }

  private predictRailsEvent(wv: WorldVessel) { return rails.predictRailsEvent.call(this, this.systems, wv); }

  /** Take a vessel off rails (back to physics). */
  private unpack(wv: WorldVessel) { return rails.unpack.call(this, this.systems, wv); }

  // ---------- Targets ----------

  /** Set (or clear with null) the navigation target: a vessel id or body id, optionally a docking port. */
  setTarget(id: string | null, portUid: number | null = null) {
    if (id !== null && this.universe.activateAsteroid(id)) {
      this.trajectoryCache = null;
      for (const vessel of this.vessels.values()) if (vessel.mode === 'rails') this.predictRailsEvent(vessel);
    }
    if (id !== null && (id === this.activeId || (!this.vessels.has(id) && !this.universe.bodies.has(id)))) return false;
    this.targetId = id;
    this.targetPortUid = id !== null && this.vessels.has(id) ? portUid : null;
    this.approachCache = null;
    return true;
  }

  targetKind(): 'vessel' | 'body' | null {
    if (!this.targetId) return null;
    if (this.vessels.has(this.targetId)) return 'vessel';
    return this.universe.bodies.has(this.targetId) ? 'body' : null;
  }

  targetName(): string | null {
    const k = this.targetKind();
    if (k === 'vessel') return this.vessels.get(this.targetId!)!.state.name;
    if (k === 'body') return this.universe.body(this.targetId!).name;
    return null;
  }

  /** Drop the target when it no longer exists (merged, destroyed, recovered) or is now the active vessel. */
  private validateTarget() {
    if (this.targetId === null) return;
    if (this.targetKind() === null || this.targetId === this.activeId) {
      this.targetId = null;
      this.targetPortUid = null;
      return;
    }
    if (this.targetPortUid !== null) {
      const wv = this.vessels.get(this.targetId);
      if (!wv || !wv.state.cache.byUid.has(this.targetPortUid)) this.targetPortUid = null;
    }
  }

  /** Inertial state of the target now (the selected docking face if a port is targeted). */
  targetState(): StateVector | null {
    const k = this.targetKind();
    if (k === 'body') return this.universe.ephem.getBodyState(this.targetId!, this.ut);
    if (k !== 'vessel') return null;
    const wv = this.vessels.get(this.targetId!)!;
    if (this.targetPortUid !== null) {
      const p = wv.state.cache.byUid.get(this.targetPortUid);
      const info = p ? portInfo(wv.state, p) : null;
      if (info) return { position: info.pos, velocity: info.vel };
    }
    return { position: wv.state.position, velocity: wv.state.velocity };
  }

  /** Predicted target state at time t relative to body `bodyId` (conic prediction for vessels). */
  targetRelativeState(bodyId: string, t: number): StateVector | null {
    const k = this.targetKind();
    const ref = this.universe.ephem.getBodyState(bodyId, t);
    if (k === 'body') {
      const s = this.universe.ephem.getBodyState(this.targetId!, t);
      return { position: sub(s.position, ref.position), velocity: sub(s.velocity, ref.velocity) };
    }
    if (k !== 'vessel') return null;
    const wv = this.vessels.get(this.targetId!)!;
    const o = this.orbitOf(wv);
    const s = propagate(o, t);
    const b = this.universe.ephem.getBodyState(wv.body, t);
    return { position: sub(add(b.position, s.position), ref.position), velocity: sub(add(b.velocity, s.velocity), ref.velocity) };
  }

  /** Closest approach between the active vessel's predicted trajectory and the target (cached). */
  closestApproach(): TrajectoryApproach | null {
    const wv = this.active;
    if (!wv || !this.targetId || wv.mode === 'prelaunch' || this.targetKind() === null) return null;
    // Targeting the body you are orbiting: "closest approach" would just be periapsis to its centre.
    if (this.targetId === wv.body) return null;
    const patches = this.trajectory();
    if (!patches.length) return null;
    const key = `${this.targetId}|${patches.length}|${patches[0].startTime}|${patches[1]?.startTime}|${this.nodes.map((n) => `${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}${validAnchor(n, wv.body) ? '*' : ''}`).join(',')}`;
    if (this.approachCache && this.approachCache.key === key) return this.approachCache.value;
    let value: TrajectoryApproach | null;
    try {
      value = trajectoryClosestApproach(patches.slice(0, 3), (b, t) => this.targetRelativeState(b, t)!, this.ut);
    } catch {
      value = null;
    }
    this.approachCache = { time: this.ut, key, value };
    return value;
  }

  // ---------- Docking ----------

  /** Docking: capture field + merges between physics vessels (run after every physics step). */
  private stepDockingAll() { return docking.stepDockingAll.call(this, this.systems); }

  /** Undock the active vessel at `portUid` (default: the first docked joint). Returns the new vessel id. */
  undockActive(portUid?: number): string | null { return docking.undockActive.call(this, this.systems, portUid); }

  warpContext(): WarpContext { return readouts.warpContext.call(this); }

  changeWarp(delta: number) {
    const ctx = this.warpContext();
    const next = stepWarp(this.warp, delta, ctx);
    if (delta > 0) {
      // Say why a warp-up did not happen: thrust/atmosphere (cues), else the altitude the next rate needs or the maximum.
      const reason = whyCantWarp(ctx);
      const why = reason ? null : warpRefusal(this.warp, next, ctx);
      if (reason) this.message(reason, 'warn');
      else if (why) this.message(why.text, why.level, 2.5);
    }
    this.alarmClock.acknowledge();
    this.warp = next;
  }

  private disconnectedInput(v?: VesselState): ControlInput {
    return neutralInput({ sas: v && hasControl(v) && v.sas.mode !== 'off' ? 'stabilityAssist' : 'off' });
  }

  /** Advance the simulation by `realDt` seconds of wall time with the given control input for the active vessel. */
  tick(realDt: number, input: ControlInput) {
    this.discoverLandmarks();
    if (!this.canControl()) { input = this.disconnectedInput(this.active?.state); this.stageRequested = false; this.evaJumpRequested = false; this.pendingCommands = []; }
    realDt = Math.min(realDt, 0.25);
    const now = performance.now();
    this.messages = this.messages.filter((m) => m.expires > now);
    this.validateTarget();
    // An explicit new warp assignment acknowledges the previous stop. UI automation (WarpDriver/assist)
    // checks the hold before assigning a rate, so it cannot silently resume past an alarm.
    if (this.alarmClock.held && this.warp.index > 0) this.alarmClock.acknowledge();
    this.alarmClock.sync(this);
    this.alarmClock.fire(this);
    this.warp = clampWarp(this.warp, this.warpContext());
    // A vessel packed on rails ignores throttle, attitude and SAS. Commanding thrust from a live engine or steering
    // is a request to fly, as staging is below: drop to 1× instead of silently ignoring the controls.
    if (this.warp.mode === 'rails' && this.warp.index > 0 && this.active && !this.active.state.eva && wantsToFly(this.active.state, input)) {
      this.warp = { mode: 'rails', index: 0 };
      this.message('Time warp stopped: controls in use', 'info', 2.5);
    }
    const rate = warpRate(this.warp);

    if (input.evaJump) this.evaJumpRequested = true;
    if (input.stage) this.stageRequested = true;
    if (input.commands?.length) this.pendingCommands = [...this.pendingCommands, ...input.commands].slice(0, MAX_COMMANDS);
    if ((this.stageRequested || this.pendingCommands.length) && this.warp.mode === 'rails' && rate > 1) {
      // Staging during rails warp: drop out of warp; the request is consumed by the next physics step.
      this.warp = { mode: 'rails', index: 0 };
      return;
    }

    if (this.warp.mode === 'rails' && rate > 1) {
      this.renderHistory.invalidate();
      for (const wv of this.vessels.values()) this.pack(wv);
      let target = this.ut + realDt * rate;
      this.alarmClock.sync(this, true); // packing supplies the next fleet SOI events
      target = Math.min(target, this.alarmClock.next(this.ut));
      this.advanceRails(target);
      this.alarmClock.fire(this);
      return;
    }

    // Physics.
    for (const wv of this.vessels.values()) if (wv === this.active && (wv.mode === 'rails' || wv.mode === 'landedRails')) this.unpack(wv);
    this.acc += realDt * rate;
    let steps = 0;
    const ut0 = this.ut;
    while (this.acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME * rate) {
      // A frame runs several steps with one input. Keep `input.target` current: heliocentric positions move
      // ~30 km/s, so a frame-old target position is kilometres off. Use the live world target when it is the
      // one being steered to, else carry the given state along with its velocity.
      let target = input.target;
      if (target && this.ut !== ut0) {
        target = (this.targetId ? this.targetState() : null) ?? {
          position: add(target.position, scale(target.velocity, this.ut - ut0)),
          velocity: target.velocity,
        };
      }
      this.renderHistory.capture(this.ut, this.vessels.values());
      // A stage request is latched until a physics step actually consumes it (frames can have zero steps).
      this.physicsStep({ ...input, evaJump: this.evaJumpRequested, stage: this.stageRequested, target, commands: this.pendingCommands.length ? this.pendingCommands : undefined });
      this.stageRequested = false;
      this.evaJumpRequested = false;
      this.pendingCommands = [];
      this.acc -= PHYSICS_DT;
      steps++;
      const alarmWasHeld = this.alarmClock.held;
      this.alarmClock.fire(this);
      if (!alarmWasHeld && this.alarmClock.held) { this.acc = 0; break; }
    }
    if (steps >= MAX_STEPS_PER_FRAME * rate) this.acc = 0;
  }

  /** Advance an unattended world, packing vessels first and processing the normal rails events.
   * Tracking uses this when there is no active vessel (including completely empty worlds).
   */
  advanceRailsTo(ut: number) { return rails.advanceRailsTo.call(this, this.systems, ut); }

  /**
   * Advance all on-rails vessels to `target`, processing rails events in time order. The active vessel goes
   * first and may shorten the frame: at its SOI change (so the next frame re-clamps the warp rate for the new
   * body — at high warp one frame could otherwise also carry it through periapsis or into the surface) and
   * just before atmosphere entry / impact (warp is cancelled). Everything else then advances to that time.
   */
  private advanceRails(target: number) { return rails.advanceRails.call(this, this.systems, target); }

  /** Replica ephemeris update; does not integrate physics or resolve events. */
  syncReplicaPacked(t = this.ut) {
    for (const v of this.vessels.values()) this.syncPacked(v, t);
  }

  /** Update the inertial state of a packed (rails / body-fixed) vessel to time t. */
  private syncPacked(wv: WorldVessel, t: number) { return rails.syncPacked.call(this, this.systems, wv, t); }

  /** One authoritative network tick. All controllers share this single UT increment.
   * Physics warp is capped at 4; rails safety considers the entire fleet. */
  tickMultiplayer(inputs: ReadonlyMap<string, ControlInput>, requestedRate = 1): number {
    let rate = requestedRate;
    const focus = this.activeId;
    if (rate > 4) {
      let index = RAILS_WARP.findIndex(r => r === rate);
      if (index < 0) index = 0;
      for (const v of this.vessels.values()) {
        this.activeId = v.state.id;
        const ctx = this.warpContext();
        ctx.thrusting ||= (inputs.get(v.state.id)?.throttle ?? 0) > 0 || !!inputs.get(v.state.id)?.stage;
        index = Math.min(index, clampWarp({ mode: 'rails', index }, ctx).index);
      }
      this.activeId = focus;
      rate = RAILS_WARP[index];
      if (rate > 1) {
        for (const v of this.vessels.values()) this.pack(v);
        // Make the earliest fleet event active so normal rails logic stops safely for everyone.
        const next = [...this.vessels.values()].filter(v => v.railsEvent).sort((a, b) => a.railsEvent!.time - b.railsEvent!.time)[0];
        if (next) this.activeId = next.state.id;
        this.warp = { mode: 'rails', index };
        let target = this.ut + PHYSICS_DT * rate;
        // Bound the entire step by the earliest event, including horizon refreshes. This
        // prevents a later vessel's atmosphere event being processed as unattended loss.
        if (next?.railsEvent && next.railsEvent.time <= target) target = Math.max(this.ut, next.railsEvent.time);
        this.advanceRails(target);
        if (this.warp.index === 0) rate = 1;
        this.activeId = focus && this.vessels.has(focus) ? focus : null;
        return rate;
      }
    }
    this.warp = { mode: rate > 1 ? 'physics' : 'rails', index: rate > 1 ? rate - 1 : 0 };
    for (let i = 0; i < rate; i++) {
      const controls = new Map([...inputs].map(([id, c]) => [id, i ? { ...c, stage: false, evaJump: false, commands: undefined } : c]));
      this.physicsStep(neutralInput(), controls);
    }
    return rate;
  }

  /** Replica prediction: only the controlled vessel; topology/docking remains authoritative. */
  predictVessel(id: string, input: ControlInput) {
    const v = this.vessels.get(id);
    if (v && !v.state.destroyed) {
      if (v.mode === 'prelaunch') this.syncFixed(v, this.ut + PHYSICS_DT);
      else {
        if (v.mode !== 'physics') this.unpack(v);
        const env = this.universe.createEnvironment(() => v.body, this.preciseGravity);
        const c = this.canControl(v.state) ? { ...input, stage: false, commands: undefined } : neutralInput();
        if (v.state.eva) stepEva(v.state, c, env, this.ut, PHYSICS_DT);
        else stepVessel(v.state, c, env, this.ut, PHYSICS_DT);
      }
    }
    this.ut += PHYSICS_DT;
  }

  private physicsStep(input: ControlInput, inputs?: ReadonlyMap<string, ControlInput>) {
    const t = this.ut;
    let propulsiveDv = 0;
    const active = this.active;
    for (const wv of [...this.vessels.values()]) {
      if (wv.state.destroyed) continue;
      const isActive = inputs ? inputs.has(wv.state.id) : wv === active;
      let vesselInput = isActive && !this.canControl(wv.state) ? this.disconnectedInput(wv.state) : inputs?.get(wv.state.id) ?? input;
      if (isActive && vesselInput.commands?.length) {
        if (wv.state.eva || wv.state.destroyed) vesselInput = { ...vesselInput, commands: undefined };
        else {
          const rest = this.applyWorldCommands(wv, vesselInput.commands);
          if (!this.vessels.has(wv.state.id)) continue;
          vesselInput = { ...vesselInput, commands: rest.length ? rest : undefined };
        }
      }
      if (inputs && isActive && (wv.mode === 'rails' || wv.mode === 'landedRails')) this.unpack(wv);
      const nearby = inputs ? [...inputs.keys()].some(id => {
        const v = this.vessels.get(id);
        return v && length(sub(v.state.position, wv.state.position)) <= PHYSICS_RANGE;
      }) : false;
      if (inputs && nearby && (wv.mode === 'rails' || wv.mode === 'landedRails')) this.unpack(wv);
      if (!isActive && active && !nearby) {
        // Packed vessels' states are only refreshed on rails frames; bring them to `t` before the range check
        // (otherwise the check uses a stale heliocentric position, kilometres off after a few seconds).
        // States are expressed at the end of the step, like physics-stepped vessels.
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.syncPacked(wv, this.preciseGravity && wv.mode === 'rails' ? t : t + PHYSICS_DT);
        const d = length(sub(wv.state.position, active.state.position));
        if (d > PHYSICS_RANGE) {
          if (this.preciseGravity && wv.mode === 'rails') this.syncPacked(wv, t + PHYSICS_DT);
          // Out of the physics bubble: pack (debris in atmosphere is removed).
          const b = this.universe.body(wv.body);
          const alt = length(this.relativeState(wv).position) - b.radius;
          if (b.atmosphere && alt < b.atmosphere.height && wv.state.situation === 'flying') { this.finishFlight(wv, 'lost'); this.vessels.delete(wv.state.id); }
          else {
            this.pack(wv);
            if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') advanceISRU(wv.state, isruMachinery(wv.state).length ? this.localConcentration(wv) : 0, PHYSICS_DT);
            advancePackedHazards(this, this.systems, wv, t, t + PHYSICS_DT);
            this.recordFlight(wv, t + PHYSICS_DT);
          }
          continue;
        }
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
      }
      if (wv.mode === 'prelaunch') {
        if (isActive && vesselInput.gear !== undefined) setGear(wv.state, vesselInput.gear);
        if (isActive && vesselInput.commands?.length) {
          // Pad commands (lamps, deploys, engine tests). Hardware dropped on the pad falls free under physics.
          const events: VesselEvent[] = [];
          const pieces = applyVesselCommands(wv.state, vesselInput.commands, events);
          for (const nv of pieces) { recomputeMassProperties(nv, false); this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body }); }
          for (const e of events) this.handleEvent(e);
          for (const nv of pieces) { const child = this.vessels.get(nv.id); if (child) this.inheritFlight(wv, child); }
        }
        // Staging on the pad starts the hold-down: the vessel is simulated (engines ignite and spool) but pinned
        // to the pad until `releaseHoldDown` lets go, so it never sags onto the pad or hops at release.
        if (isActive && vesselInput.stage && !wv.holdDown) wv.holdDown = startHoldDown(wv);
        if (wv.holdDown) this.syncFixed(wv, t);
        else {
          advanceISRU(wv.state, isruMachinery(wv.state).length ? this.localConcentration(wv) : 0, PHYSICS_DT);
          // States are expressed at the end of the step (t + dt), like physics-stepped vessels.
          advancePackedHazards(this, this.systems, wv, t, t + PHYSICS_DT);
          this.syncFixed(wv, t + PHYSICS_DT);
          this.recordFlight(wv, t + PHYSICS_DT);
          continue;
        }
      }
      if (wv.mode !== 'physics' && !(wv.mode === 'prelaunch' && wv.holdDown)) continue;
      // Update dominant body (SOI transitions in physics).
      wv.body = this.universe.dominantBody(wv.state.position, t);
      const env = this.universe.createEnvironment(() => wv.body, this.preciseGravity);
      // A disconnected probe holds its attitude with SAS, but cannot command thrust or stage.
      const ctrl = isActive ? vesselInput : neutralInput({ sas: 'off' });
      const flight = recordFor(this.flightlog, wv.state.id);
      if (flight && wv.state.situation === 'flying' && wv.state.telemetry.altitudeAGL < 100) flight.touchdownSpeed = length(this.surfaceVelocity(wv));
      advanceCrewDose(this, wv, PHYSICS_DT);
      const res = wv.state.eva ? stepEva(wv.state, ctrl, env, t, PHYSICS_DT) : stepVessel(wv.state, ctrl, env, t, PHYSICS_DT);
      if (isActive) propulsiveDv += res.propulsiveDv ?? 0;
      for (const nv of res.newVessels) {
        if (nv.destroyed) continue;
        recomputeMassProperties(nv, false);
        // Stages split at step start; structural/crash fragments split at a substep end.
        nv.position = add(nv.position, scale(nv.velocity, PHYSICS_DT - (res.newVesselTimeOffsets?.[nv.id] ?? 0)));
        this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
      }
      for (const e of res.events) this.handleEvent(e);
      for (const nv of res.newVessels) { const child = this.vessels.get(nv.id); if (child) this.inheritFlight(wv, child); }
      if (wv.mode === 'prelaunch' && !wv.state.destroyed) this.stepHoldDown(wv, ctrl, t + PHYSICS_DT);
      this.recordFlight(wv, t + PHYSICS_DT);
      if (wv.state.destroyed) {
        this.finishFlight(wv, 'lost', t + PHYSICS_DT);
        if (isActive) this.message(`${wv.state.name} was destroyed`, 'bad', 8);
        this.vessels.delete(wv.state.id);
        if (isActive) this.activeId = null;
      }
    }
    crew.collideAstronauts(this);
    this.stepDockingAll();
    this.ut = t + PHYSICS_DT;
    this.applyPassedNodes();
    advanceTransmissions(this);
    evaluateProgression(this);
    this.onSimulationStep?.(PHYSICS_DT, propulsiveDv);
  }

  /**
   * Expand action groups and run the actions that need World context (science, undocking) for `wv`, as if it were
   * the active vessel (multiplayer runs every controller's commands). Returns the remaining sim-level commands.
   */
  private applyWorldCommands(wv: WorldVessel, commands: readonly VesselCommand[]): VesselCommand[] {
    const expanded = expandCommands(wv.state, commands);
    const rest: VesselCommand[] = [];
    const focus = this.activeId;
    for (const c of expanded) {
      if (c.kind !== 'part' || !WORLD_ACTIONS.has(c.action)) { rest.push(c); continue; }
      const part = wv.state.cache.byUid.get(c.uid);
      if (!part) continue;
      this.activeId = wv.state.id;
      try {
        if (c.action === 'science.transmit') this.transmitScience();
        else if (c.action === 'undock' && part.docked) this.undockActive(c.uid);
        else if (c.action === 'science.run') {
          const instrument = this.scienceInstruments(wv).find(i => i.uid === c.uid && (c.experiment ? i.experiment === c.experiment : i.available && !i.recorded));
          if (instrument) this.runExperiment(instrument.uid, instrument.experiment);
        }
      } finally { this.activeId = focus && this.vessels.has(focus) ? focus : null; }
    }
    return rest;
  }

  private handleEvent(e: VesselEvent) {
    const v = this.vessels.get(e.vesselId);
    if (v) {
      if (e.type === 'decouple') this.logFlightEvent(v, 'separation', `Detached part ${e.partUid} → ${e.newVesselId}`);
      if (e.type === 'stage') this.logFlightEvent(v, 'stage', `Stage ${e.stage}`);
      if (e.type === 'structuralFailure') this.logFlightEvent(v, 'partLoss', `Attachment ${e.partUid} broke at ${(e.loadFraction * 100).toFixed(0)}% load`);
      if (e.type === 'partDestroyed') this.logFlightEvent(v, 'partLoss', `Part ${e.partUid}: ${e.reason}`);
      if (e.type === 'docked') this.logFlightEvent(v, 'docking', e.otherId);
    }
    this.onEvent?.(e);
    if (e.vesselId !== this.activeId) return;
    if (e.type === 'hazardWarning') this.message(e.message, 'warn', 6);
    if (e.type === 'linkBroken') this.message('Structural brace broke!', 'bad', 4);
    if (e.type === 'structuralFailure') this.message('Structural failure — attachment broke!', 'bad', 4);
    if (e.type === 'stage') this.message(`Stage ${e.stage} activated`);
    if (e.type === 'flameout') this.message('Engine flameout — check propellant and intake air', 'warn', 4);
    if (e.type === 'docked' || e.type === 'undocked') this.approachCache = null;
    if (e.type === 'partDestroyed') {
      const why = e.reason === 'pressure' ? 'collapsed under ambient pressure' : e.reason === 'overheat' ? 'overheated and exploded' : 'was destroyed on impact';
      this.message(`A part ${why}`, 'bad', 4);
    }
  }

  /**
   * Hold-down clamps after a pad stage: keep the vessel pinned while its engines spool up and release it once
   * thrust exceeds weight. A vessel that cannot lift off (throttle at zero, no thrust, thrust settled below its
   * weight) is released onto the pad straight away or after {@link HOLD_DOWN_MAX} seconds at the latest.
   */
  private stepHoldDown(wv: WorldVessel, ctrl: ControlInput, t: number) {
    const hold = wv.holdDown!;
    hold.time += PHYSICS_DT;
    const thrust = wv.state.telemetry.thrust;
    const r = length(sub(wv.state.position, this.universe.ephem.getBodyState(wv.body, t).position));
    const weight = wv.state.mass * this.universe.body(wv.body).gm / (r * r);
    const burning = wv.state.parts.some(p => p.engine?.ignited);
    const settled = hold.time > 0.3 && thrust <= hold.thrust * 1.002;
    hold.thrust = thrust;
    // The clamps hold the structure, not the centre of mass: follow the COM as tanks drain or parts drop.
    const fixed = wv.fixed!, com = wv.state.com;
    fixed.pos = add(fixed.pos, qRotate(fixed.orient, sub(com, hold.com)));
    hold.com = { ...com };
    if (thrust >= weight || !burning || ctrl.throttle <= 0 && thrust <= 0 || settled || hold.time >= HOLD_DOWN_MAX - 1e-9) {
      // Leave the vessel exactly where the clamps held it, moving with the pad.
      this.syncFixed(wv, t);
      wv.mode = 'physics';
      wv.fixed = undefined;
      wv.holdDown = undefined;
      this.message(thrust >= weight ? 'Liftoff!' : 'Clamps released');
    } else this.syncFixed(wv, t);
  }

  /** Stage the active vessel immediately (used when clicking the stage button while warping etc.). */
  stageActive() {
    const wv = this.active;
    if (!wv || !this.canControl(wv.state) || wv.state.eva) return;
    if (wv.mode === 'prelaunch') wv.holdDown ??= startHoldDown(wv);
    else if (wv.mode !== 'physics') this.unpack(wv);
    const res = activateNextStage(wv.state);
    for (const nv of res.newVessels) this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
    for (const e of res.events) this.handleEvent(e);
    for (const nv of res.newVessels) { const child = this.vessels.get(nv.id); if (child) this.inheritFlight(wv, child); }
  }

  // ---------- Maneuver nodes ----------
  addNode(time: number): ManeuverNode {
    const n: ManeuverNode = { id: this.nodeId++, time, prograde: 0, normal: 0, radial: 0 };
    this.nodes.push(n);
    this.trajectoryCache = null;
    return n;
  }

  removeNode(id: number) {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.trajectoryCache = null;
  }

  private applyPassedNodes() {
    // Nodes are not auto-executed; they are removed once their time has passed by more than the burn window,
    // except a burn in progress (its plan is frozen, see NodeAnchors).
    this.nodeAnchors.update(this);
    const burning = (this.active?.state.telemetry.thrust ?? 0) > 0;
    this.nodes = this.nodes.filter((n) => n.time > this.ut - 600 || (burning && !!n.anchor));
  }

  private numericalCache: { key: string; time: number; thrusting: boolean; prediction: NumericalPrediction; display?: NumericalPrediction } | null = null;
  get numericalPrediction() { return this.numericalCache?.prediction; }
  /** Rendering only. Planners deliberately retain trajectory()'s fast patched conics. */
  mapTrajectory(): TrajectoryPatch[] {
    if (!this.preciseGravity) return this.burnTrajectory();
    const v = this.active;
    if (!v || v.mode === 'prelaunch' || v.state.situation !== 'flying') return [];
    const key = `${v.state.id}:${v.body}:`+this.nodes.map(n=>`${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}${validAnchor(n, v.body) ? '*' : ''}`).join(',');
    const thrusting = v.state.telemetry.thrust > 0;
    const age = (thrusting ? .2 : 2)*Math.max(1,warpRate(this.warp));
    // Restart at once after an engine cut (see trajectory()).
    const cutSince = !!this.numericalCache?.thrusting && !thrusting;
    if (!this.numericalCache || this.numericalCache.key !== key || cutSince || Math.abs(this.ut-this.numericalCache.time)>age && (thrusting || this.numericalCache.prediction.complete || this.numericalCache.prediction.truncated)) {
      let after = this.orbitOf(v), lastNode = this.ut;
      for (const node of [...this.nodes].filter(n=>n.time>=this.ut).sort((a,b)=>a.time-b.time)) {
        const at = propagate(after,node.time);
        after = stateToElements(after.mu,after.body,at.position,add(at.velocity,maneuverToInertialDv(at,node)),node.time);
        lastNode = node.time;
      }
      const orbitalPeriod = period(after);
      const horizon = this.ut+Math.min(3e9,lastNode-this.ut+(isFinite(orbitalPeriod) ? orbitalPeriod*1.02 : 3e7));
      const display = this.numericalCache?.key === key ? this.numericalCache.display : undefined;
      this.numericalCache = {key,time:this.ut,thrusting,display,prediction:new NumericalPrediction(this.universe.bodies,this.universe.ephem,
        v.body,this.relativeState(v),this.ut,Math.max(this.ut+1,horizon),this.nodes,
        b=>Math.max(b.atmosphere?.height ?? 0,b.solidSurface ? this.universe.terrain(b.id).maxHeight : 0))};
    }
    const deadline = performance.now()+4;
    const cache = this.numericalCache;
    cache.prediction.advance(128,()=>performance.now()>=deadline);
    if (cache.prediction.complete || cache.prediction.truncated) cache.display = cache.prediction;
    return (cache.display ?? cache.prediction).patches;
  }
  mapGravityMarkers() {
    const u = this.universe;
    const markers: {body:string;position:Vec3;label:string;color:string}[] = [];
    if (this.showLagrangePoints) for (const [primary,secondary] of LAGRANGE_PAIRS) {
      const a = u.ephem.getBodyState(primary,this.ut), b = u.ephem.getBodyState(secondary,this.ut);
      for (const point of lagrangePoints(u.body(primary).gm,u.body(secondary).gm,a,b)) markers.push({
        body: primary,position:sub(point.position,a.position),label:`${u.body(primary).name}–${u.body(secondary).name} ${point.name}`,color:'#b99fff',
      });
    }
    if (this.preciseGravity && this.numericalCache) {
      const prediction = this.numericalCache.display ?? this.numericalCache.prediction;
      for (const e of prediction.encounters) markers.push({body:e.frame,position:e.position,
        label:`${u.body(e.body).name} closest: ${(e.distance/1000).toFixed(0)} km`,color:'#ffb35c'});
      const patch=prediction.patches.at(-1), point=patch?.samples?.at(-1);
      if (patch && point) markers.push({body:patch.orbit.body,position:point.position,
        label:prediction !== this.numericalCache.prediction ? 'Precise path: updating…' : prediction.truncated ? 'Precise path: computation limit' : prediction.complete ? 'Precise path' : 'Precise path: computing…',color:'#6fe39a'});
    }
    return markers;
  }

  /** Patched-conic prediction for the active vessel (cached ~0.25 s of game time / when nodes change). */
  trajectory(): TrajectoryPatch[] {
    const wv = this.active;
    if (!wv || wv.mode === 'prelaunch') return [];
    const key = this.nodes.map((n) => `${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}${validAnchor(n, wv.body) ? '*' : ''}`).join(',') + wv.body;
    const thrusting = wv.state.telemetry.thrust > 0;
    const maxAge = thrusting ? 0.2 : 2;
    // A path computed under thrust is stale the moment the engines stop: refresh at once instead of keeping it
    // for the coasting cache age (the orbit line otherwise lags an engine cut by up to 2 s).
    const cutSince = !!this.trajectoryCache?.thrusting && !thrusting;
    if (this.trajectoryCache && !cutSince && this.trajectoryCache.key === key && Math.abs(this.ut - this.trajectoryCache.time) < maxAge * Math.max(1, warpRate(this.warp))) {
      return this.trajectoryCache.patches;
    }
    const rs = this.relativeState(wv);
    let horizon = this.trajectoryHorizon(wv, rs);
    let patches: TrajectoryPatch[];
    try {
      const predict = () => predictTrajectory({
        ephem: this.universe.ephem,
        bodies: this.universe.bodies,
        initialBody: wv.body,
        state: rs,
        t0: this.ut,
        horizon,
        // Under thrust only the current conic and the next one are shown (see burnTrajectory); skip the rest.
        maxPatches: thrusting ? BURN_MAP_PATCHES : 6,
        maneuvers: this.nodes,
      });
      patches = predict();
      // Planetary escape is locally hyperbolic but the solar transfer can last years (e.g. Saturn).
      // Extend the map horizon using that new conic, rather than cutting it at the local escape default.
      const solar = patches.find(p => p.orbit.body === this.universe.sunId && p.endReason === 'horizon');
      if (wv.body !== this.universe.sunId && solar) {
        const solarPeriod = period(solar.orbit);
        const extended = Math.min(3e9, solar.startTime - this.ut + (isFinite(solarPeriod) ? solarPeriod * 1.02 : 3e8));
        if (extended > horizon) { horizon = extended; patches = predict(); }
      }
    } catch {
      patches = [];
    }
    this.alarmClock.predicted(this, wv.state.id, patches);
    this.trajectoryCache = { time: this.ut, key, patches, thrusting };
    return patches;
  }

  /**
   * Horizon: one revolution of the orbit that results after the last node (not the current orbit: a
   * trans-lunar injection from a ~30 min parking orbit leads to a multi-day transfer that must be shown).
   */
  private trajectoryHorizon(wv: WorldVessel, rs: StateVector): number {
    const o = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
    const upcoming = this.nodes.filter((n) => n.time >= this.ut).sort((a, b) => a.time - b.time);
    let after = o;
    // A burn in progress continues on its frozen plan, not on the live orbit.
    const burning = this.nodes.filter((n) => n.time < this.ut && validAnchor(n, wv.body)).sort((a, b) => b.time - a.time)[0];
    if (burning) after = stateToElements(o.mu, o.body, burning.anchor!.position, burning.anchor!.velocity, burning.time);
    for (const n of upcoming) {
      const s = propagate(after, n.time), post = stateAfterManeuver(s, after.body, n);
      after = stateToElements(after.mu, after.body, post.position, post.velocity, n.time);
    }
    const lastNode = upcoming.length ? upcoming[upcoming.length - 1].time - this.ut : 0;
    const Tafter = period(after);
    return Math.min(3e9, lastNode + (isFinite(Tafter) ? Tafter * 1.02 : 3e7));
  }

  /**
   * Map path (patched conics). While the engines burn, the current-SOI conic is recomputed from the live state every
   * frame (the cached trajectory() refreshes only at 5 Hz) and only the next continuation is drawn: further
   * continuations (re-encounters after an escape, etc.) are sensitive to every m/s and would jump between branches on
   * each refresh. They return as soon as thrust ends (trajectory() refreshes at once after a cut).
   */
  private burnTrajectory(): TrajectoryPatch[] {
    const base = this.trajectory();
    const wv = this.active;
    if (!wv || wv.mode === 'prelaunch' || !(wv.state.telemetry.thrust > 0) || !base.length) return base;
    const shown = base.length > BURN_MAP_PATCHES ? base.slice(0, BURN_MAP_PATCHES) : base;
    // Computed this frame: already live.
    if (this.trajectoryCache?.time === this.ut) return shown;
    const rs = this.relativeState(wv);
    let live: TrajectoryPatch | undefined;
    try {
      live = predictTrajectory({
        ephem: this.universe.ephem, bodies: this.universe.bodies, initialBody: wv.body, state: rs, t0: this.ut,
        horizon: this.trajectoryHorizon(wv, rs), maxPatches: 1, maneuvers: this.nodes,
      })[0];
    } catch {
      return shown;
    }
    if (!live) return shown;
    // The cached continuation still applies when the live conic ends the same way (same SOI change); otherwise it
    // describes a path the vessel no longer takes (e.g. the escape just closed into an orbit): drop it until the
    // next refresh rather than drawing a stale branch.
    const first = shown[0];
    const same = first.endReason === live.endReason && first.nextBody === live.nextBody && first.orbit.body === live.orbit.body;
    return same ? [live, ...shown.slice(1)] : [live];
  }

  /** Orbit summary for HUD. */
  orbitSummary(wv: WorldVessel) { return readouts.orbitSummary.call(this, wv); }

  /** Dot helper used by HUD (vertical speed). */
  verticalSpeed(wv: WorldVessel): number { return readouts.verticalSpeed.call(this, wv); }

  surfaceVelocity(wv: WorldVessel): Vec3 { return readouts.surfaceVelocity.call(this, wv); }
}

export { quatFromBasis } from '../util/basis';

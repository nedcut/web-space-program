import { nearbyLandmarks } from '../sim/terrain/landmarks';
import { careerScaleMultiplier } from '../sim/bodies/scale';
import { EVA_PART } from '../data/eva';
import { defaultCommsSettings, NO_SIGNAL, type CommsSettings, type Network } from '../sim/comms/network';
import { hasControl, type Astronaut, type PlantedFlag } from '../sim/crew/crew';
import { maneuverToInertialDv, period, predictTrajectory, propagate, stateToElements, trajectoryClosestApproach, type TrajectoryApproach } from '../sim/orbit';
import type { ManeuverNode, Orbit, StateVector, TrajectoryPatch } from '../sim/orbit/api';
import { newProgression, type GameMode, type ProgressEvent } from '../sim/science/progression';
import { activateNextStage, neutralInput, portInfo, recomputeMassProperties, setGear, stepVessel } from '../sim/vessel';
import { stepEva } from '../sim/vessel/eva';
import { advanceISRU, isruMachinery } from '../sim/vessel/isru';
import type { ControlInput, PartState, VesselEvent, VesselState } from '../sim/vessel/runtime';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import type { Quat } from '../util/quat';
import { add, length, scale, sub, type Vec3 } from '../util/vec3';
import { worldNetwork } from './comms';
import { advanceTransmissions, evaluateProgression, recoverScience } from './science';
import { clampWarp, RAILS_WARP, stepWarp, warpRate, type WarpContext, type WarpState } from './timewarp';
import { Universe } from './universe';
import * as crew from './world/crew';
import * as docking from './world/docking';
import type { WorldInternals } from './world/internals';
import * as launch from './world/launch';
import * as progression from './world/progression';
import * as rails from './world/rails';
import * as readouts from './world/readouts';
import * as resources from './world/resources';

export const PHYSICS_DT = 1 / 50;
/** Distance from the active vessel inside which other vessels are simulated with full physics. */
const PHYSICS_RANGE = 5000;
/** Max physics steps per frame before we drop simulated time (prevents spiral of death on slow machines). */
const MAX_STEPS_PER_FRAME = 12;

export type VesselMode = 'physics' | 'rails' | 'prelaunch' | 'landedRails';

export interface WorldVessel {
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
}

export interface WorldMessage {
  id: number;
  text: string;
  level: 'info' | 'warn' | 'bad';
  expires: number;
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
    set trajectoryCache(value: { time: number; key: string; patches: TrajectoryPatch[] } | null) { owner.trajectoryCache = value; },
    unpack: (wv: WorldVessel) => owner.unpack(wv),
  }))(this);

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
  messages: WorldMessage[] = [];
  /** Navigation target: a vessel id or a body id (null = none). */
  targetId: string | null = null;
  /** Optional specific docking port (part uid) on the target vessel. */
  targetPortUid: number | null = null;
  /** Real-time accumulator for fixed physics steps. */
  private acc = 0;
  private msgId = 0;
  private stageRequested = false;
  private evaJumpRequested = false;
  private nodeId = 1;
  private trajectoryCache: { time: number; key: string; patches: TrajectoryPatch[] } | null = null;
  private approachCache: { time: number; key: string; value: TrajectoryApproach | null } | null = null;
  readonly catalog: Map<string, PartDef>;
  /** Event listeners (audio, camera shake, UI). */
  onEvent: ((e: VesselEvent) => void) | null = null;

  constructor(universe: Universe, catalog: Map<string, PartDef>, ut: number, public mode: GameMode = 'sandbox') {
    this.commsSettings = defaultCommsSettings(mode);
    this.universe = universe;
    this.progression = newProgression(careerScaleMultiplier(universe.preset));
    this.catalog = new Map(catalog);
    this.catalog.set(EVA_PART.id, EVA_PART);
    this.ut = ut;
    if (mode === 'career') this.refreshContracts();
  }

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
    this.messages.push({ id: ++this.msgId, text, level, expires: performance.now() + seconds * 1000 });
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
  launch(craft: CraftDef, site: 'pad' | 'runway' = craft.type === 'SPH' ? 'runway' : 'pad', keepExisting = false): WorldVessel { return launch.launch.call(this, this.systems, craft, site, keepExisting); }

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

  goEva(astronautId?: string): WorldVessel | null { return crew.goEva.call(this, this.systems, astronautId); }

  boardingTarget(): { vessel: WorldVessel; pod: PartState } | null { return crew.boardingTarget.call(this, this.systems); }

  boardEva(): boolean { return crew.boardEva.call(this, this.systems); }

  plantFlag(): PlantedFlag | null { return crew.plantFlag.call(this, this.systems); }

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
    this.nodes = [];
    this.trajectoryCache = null;
    if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
    return true;
  }

  /** Cycle to the next vessel within physics range of the active one (debris, decoupled stages). */
  focusNextNearby(): string | null {
    const act = this.active;
    if (!act) return null;
    const ids = [...this.vessels.values()]
      .filter((v) => v === act || length(sub(v.state.position, act.state.position)) < PHYSICS_RANGE)
      .map((v) => v.state.id)
      .sort();
    if (ids.length < 2) return null;
    const next = ids[(ids.indexOf(act.state.id) + 1) % ids.length];
    this.switchTo(next);
    return next;
  }

  /** Recover the active vessel if it's at rest on Earth (returns true when removed). */
  recoverActive(): boolean { return this.activeId ? this.recoverVessel(this.activeId) : false; }

  recoverVessel(id: string): boolean {
    const wv = this.vessels.get(id);
    if (!wv || wv.state.destroyed || wv.body !== 'earth' || (wv.mode !== 'prelaunch' && wv.state.situation === 'flying')) return false;
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
    const patches = this.trajectory();
    if (!patches.length) return null;
    const key = `${this.targetId}|${patches.length}|${patches[0].startTime}|${this.nodes.map((n) => `${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}`).join(',')}`;
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
    const next = stepWarp(this.warp, delta, this.warpContext());
    if (next.mode === 'rails' && next.index > 0 && this.warp.index === 0 && this.warp.mode === 'rails') {
      // Entering rails warp: refuse if the vessel is spinning fast or accelerating (would lose state).
    }
    this.warp = next;
  }

  private disconnectedInput(v?: VesselState): ControlInput {
    return neutralInput({ sas: v && hasControl(v) && v.sas.mode !== 'off' ? 'stabilityAssist' : 'off' });
  }

  /** Advance the simulation by `realDt` seconds of wall time with the given control input for the active vessel. */
  tick(realDt: number, input: ControlInput) {
    this.discoverLandmarks();
    if (!this.canControl()) { input = this.disconnectedInput(this.active?.state); this.stageRequested = false; this.evaJumpRequested = false; }
    realDt = Math.min(realDt, 0.25);
    const now = performance.now();
    this.messages = this.messages.filter((m) => m.expires > now);
    this.validateTarget();
    this.warp = clampWarp(this.warp, this.warpContext());
    const rate = warpRate(this.warp);

    if (input.evaJump) this.evaJumpRequested = true;
    if (input.stage) this.stageRequested = true;
    if (this.stageRequested && this.warp.mode === 'rails' && rate > 1) {
      // Staging during rails warp: drop out of warp; the request is consumed by the next physics step.
      this.warp = { mode: 'rails', index: 0 };
      return;
    }

    if (this.warp.mode === 'rails' && rate > 1) {
      for (const wv of this.vessels.values()) this.pack(wv);
      let target = this.ut + realDt * rate;
      // Stop warp at the next maneuver node (minus a margin). Active-vessel events (SOI change, atmosphere,
      // impact) are handled in advanceRails.
      const nextNode = this.nodes.filter((n) => n.time > this.ut).sort((a, b) => a.time - b.time)[0];
      if (nextNode && target > nextNode.time - 30 && this.ut < nextNode.time - 30) {
        target = nextNode.time - 30;
        this.warp = { mode: 'rails', index: 0 };
      }
      this.advanceRails(target);
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
      // A stage request is latched until a physics step actually consumes it (frames can have zero steps).
      this.physicsStep({ ...input, evaJump: this.evaJumpRequested, stage: this.stageRequested, target });
      this.stageRequested = false;
      this.evaJumpRequested = false;
      this.acc -= PHYSICS_DT;
      steps++;
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
      const controls = new Map([...inputs].map(([id, c]) => [id, i ? { ...c, stage: false, evaJump: false } : c]));
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
        const env = this.universe.createEnvironment(() => v.body);
        const c = this.canControl(v.state) ? { ...input, stage: false } : neutralInput();
        if (v.state.eva) stepEva(v.state, c, env, this.ut, PHYSICS_DT);
        else stepVessel(v.state, c, env, this.ut, PHYSICS_DT);
      }
    }
    this.ut += PHYSICS_DT;
  }

  private physicsStep(input: ControlInput, inputs?: ReadonlyMap<string, ControlInput>) {
    const t = this.ut;
    const active = this.active;
    for (const wv of [...this.vessels.values()]) {
      if (wv.state.destroyed) continue;
      const isActive = inputs ? inputs.has(wv.state.id) : wv === active;
      const vesselInput = isActive && !this.canControl(wv.state) ? this.disconnectedInput(wv.state) : inputs?.get(wv.state.id) ?? input;
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
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.syncPacked(wv, t + PHYSICS_DT);
        const d = length(sub(wv.state.position, active.state.position));
        if (d > PHYSICS_RANGE) {
          // Out of the physics bubble: pack (debris in atmosphere is removed).
          const b = this.universe.body(wv.body);
          const alt = length(this.relativeState(wv).position) - b.radius;
          if (b.atmosphere && alt < b.atmosphere.height && wv.state.situation === 'flying') this.vessels.delete(wv.state.id);
          else {
            this.pack(wv);
            if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') advanceISRU(wv.state, isruMachinery(wv.state).length ? this.localConcentration(wv) : 0, PHYSICS_DT);
          }
          continue;
        }
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
      }
      if (wv.mode === 'prelaunch') {
        if (isActive && vesselInput.gear !== undefined) setGear(wv.state, vesselInput.gear);
        if (isActive && vesselInput.stage) {
          this.syncFixed(wv, t);
          wv.mode = 'physics';
          wv.fixed = undefined;
          this.message('Liftoff!');
        } else {
          advanceISRU(wv.state, isruMachinery(wv.state).length ? this.localConcentration(wv) : 0, PHYSICS_DT);
          // States are expressed at the end of the step (t + dt), like physics-stepped vessels.
          this.syncFixed(wv, t + PHYSICS_DT);
          continue;
        }
      }
      if (wv.mode !== 'physics') continue;
      // Update dominant body (SOI transitions in physics).
      wv.body = this.universe.dominantBody(wv.state.position, t);
      const env = this.universe.createEnvironment(() => wv.body);
      // A disconnected probe holds its attitude with SAS, but cannot command thrust or stage.
      const ctrl = isActive ? vesselInput : neutralInput({ sas: 'off' });
      const res = wv.state.eva ? stepEva(wv.state, ctrl, env, t, PHYSICS_DT) : stepVessel(wv.state, ctrl, env, t, PHYSICS_DT);
      for (const nv of res.newVessels) {
        if (nv.destroyed) continue;
        recomputeMassProperties(nv, false);
        // Stages split at step start; structural/crash fragments split at a substep end.
        nv.position = add(nv.position, scale(nv.velocity, PHYSICS_DT - (res.newVesselTimeOffsets?.[nv.id] ?? 0)));
        this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
      }
      for (const e of res.events) this.handleEvent(e);
      // Bodies without a surface (gas giants, stars): crushed / vaporised below a small depth.
      const bodyDef = this.universe.body(wv.body);
      if (!bodyDef.solidSurface && !wv.state.destroyed) {
        const depth = bodyDef.radius - length(sub(wv.state.position, this.universe.ephem.getBodyState(wv.body, t + PHYSICS_DT).position));
        if (depth > bodyDef.radius * 0.002) {
          wv.state.destroyed = true;
          if (isActive) this.message(`${wv.state.name} was crushed in the depths of ${bodyDef.name}`, 'bad', 8);
        }
      }
      if (wv.state.destroyed) {
        if (isActive) this.message(`${wv.state.name} was destroyed`, 'bad', 8);
        this.vessels.delete(wv.state.id);
        if (isActive) this.activeId = null;
      }
    }
    this.stepDockingAll();
    this.ut = t + PHYSICS_DT;
    this.applyPassedNodes();
    advanceTransmissions(this);
    evaluateProgression(this);
  }

  private handleEvent(e: VesselEvent) {
    this.onEvent?.(e);
    if (e.vesselId !== this.activeId) return;
    if (e.type === 'structuralFailure') this.message('Structural failure — attachment broke!', 'bad', 4);
    if (e.type === 'flameout') this.message('Flameout!', 'warn', 2);
    if (e.type === 'docked' || e.type === 'undocked') this.approachCache = null;
    if (e.type === 'partDestroyed') {
      const why = e.reason === 'overheat' ? 'overheated and exploded' : 'was destroyed on impact';
      this.message(`A part ${why}`, 'bad', 4);
    }
  }

  /** Stage the active vessel immediately (used when clicking the stage button while warping etc.). */
  stageActive() {
    const wv = this.active;
    if (!wv || !this.canControl(wv.state) || wv.state.eva) return;
    if (wv.mode === 'prelaunch') {
      wv.mode = 'physics';
      wv.fixed = undefined;
      this.message('Liftoff!');
    }
    if (wv.mode !== 'physics') this.unpack(wv);
    const res = activateNextStage(wv.state);
    for (const nv of res.newVessels) this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
    for (const e of res.events) this.handleEvent(e);
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
    // Nodes are not auto-executed; they are removed once their time has passed by more than the burn window.
    this.nodes = this.nodes.filter((n) => n.time > this.ut - 600);
  }

  /** Patched-conic prediction for the active vessel (cached ~0.25 s of game time / when nodes change). */
  trajectory(): TrajectoryPatch[] {
    const wv = this.active;
    if (!wv || wv.mode === 'prelaunch') return [];
    const key = this.nodes.map((n) => `${n.id}:${n.time}:${n.prograde}:${n.normal}:${n.radial}`).join(',') + wv.body;
    const thrusting = wv.state.telemetry.thrust > 0;
    const maxAge = thrusting ? 0.2 : 2;
    if (this.trajectoryCache && this.trajectoryCache.key === key && Math.abs(this.ut - this.trajectoryCache.time) < maxAge * Math.max(1, warpRate(this.warp))) {
      return this.trajectoryCache.patches;
    }
    const rs = this.relativeState(wv);
    const o = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
    // Horizon: one revolution of the orbit that results after the last node (not the current orbit: a
    // trans-lunar injection from a ~30 min parking orbit leads to a multi-day transfer that must be shown).
    const upcoming = this.nodes.filter((n) => n.time >= this.ut).sort((a, b) => a.time - b.time);
    let after = o;
    for (const n of upcoming) {
      const s = propagate(after, n.time);
      after = stateToElements(after.mu, after.body, s.position, add(s.velocity, maneuverToInertialDv(s, n)), n.time);
    }
    const lastNode = upcoming.length ? upcoming[upcoming.length - 1].time - this.ut : 0;
    const Tafter = period(after);
    let horizon = Math.min(3e9, lastNode + (isFinite(Tafter) ? Tafter * 1.02 : 3e7));
    let patches: TrajectoryPatch[];
    try {
      const predict = () => predictTrajectory({
        ephem: this.universe.ephem,
        bodies: this.universe.bodies,
        initialBody: wv.body,
        state: rs,
        t0: this.ut,
        horizon,
        maxPatches: 6,
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
    this.trajectoryCache = { time: this.ut, key, patches };
    return patches;
  }

  /** Orbit summary for HUD. */
  orbitSummary(wv: WorldVessel) { return readouts.orbitSummary.call(this, wv); }

  /** Dot helper used by HUD (vertical speed). */
  verticalSpeed(wv: WorldVessel): number { return readouts.verticalSpeed.call(this, wv); }

  surfaceVelocity(wv: WorldVessel): Vec3 { return readouts.surfaceVelocity.call(this, wv); }
}

export { quatFromBasis } from '../util/basis';

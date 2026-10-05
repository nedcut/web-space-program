import { newProgression, generateContracts, acceptContract, failContract, type GameMode, type ProgressEvent } from '../sim/science/progression';
import { unlockTech, launchProblem, launchCost } from '../data/technology';
import { scienceContext, instruments, runExperiment, transmitScience, recoverScience, progressionEvent, evaluateProgression } from './science';
import { generateAstronaut, crewIds, hasControl, seatCapacity, type Astronaut, type PlantedFlag } from '../sim/crew/crew';
import { EVA_PART } from '../data/eva';
import { stepEva } from '../sim/vessel/eva';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import type { ControlInput, VesselState, PartState, VesselEvent } from '../sim/vessel/runtime';
import { buildVessel, stepVessel, activateNextStage, neutralInput, recomputeMassProperties, stepDocking, undock, dockedPorts, portInfo } from '../sim/vessel';
import type { Orbit, ManeuverNode, TrajectoryPatch, StateVector } from '../sim/orbit/api';
import { stateToElements, propagate, predictTrajectory, periapsisRadius, apoapsisRadius, timeToPeriapsis, timeToApoapsis, period, maneuverToInertialDv, trajectoryClosestApproach, type TrajectoryApproach } from '../sim/orbit';
import { latLonToUnit, LAUNCH_SITE, RUNWAY, siteLocalToUnit } from '../sim/terrain';
import { hullPoints } from '../sim/vessel/shapes';
import { wheelContactPoint } from '../sim/vessel/contact';
import { add, sub, length, scale, normalize, cross, dot, v3, type Vec3 } from '../util/vec3';
import { qIdentity, qFromTo, qMul, qConj, qRotate, qNormalize, type Quat } from '../util/quat';
import { Universe } from './universe';
import { type WarpState, warpRate, stepWarp, clampWarp, type WarpContext, RAILS_WARP } from './timewarp';
import { RESOURCES } from '../data/resources';

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

/** Quaternion that maps body-fixed → inertial for the given body at time t. */
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);

export class World {
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
    this.universe = universe;
    this.catalog = new Map(catalog);
    this.catalog.set(EVA_PART.id, EVA_PART);
    this.ut = ut;
    if (mode === 'career') this.refreshContracts();
  }

  refreshContracts() {
    if (this.mode !== 'career' || this.progression.contracts.some(c => c.status === 'offered')) return;
    const p = this.progression;
    p.contracts.push(...generateContracts(p.contractSeed, p.contractBatch++, p.milestones.includes('first-moon')));
  }
  acceptContract(id: string) { return this.mode === 'career' && acceptContract(this.progression, id, this.ut); }
  abandonContract(id: string) {
    const c = this.progression.contracts.find(c => c.id === id);
    return this.mode === 'career' && !!c && failContract(this.progression, c);
  }
  unlockTech(id: string) { return this.mode !== 'sandbox' && unlockTech(this.progression, id); }
  scienceContext(v = this.active) { return v ? scienceContext(this, v) : null; }
  scienceInstruments(v = this.active) { return v ? instruments(this, v) : []; }
  runExperiment(uid: number, experiment: string) { return runExperiment(this, uid, experiment); }
  transmitScience() { return transmitScience(this); }
  emitProgress(event: ProgressEvent) { progressionEvent(this, event); }
  onReachedOrbit(v: WorldVessel) { this.emitProgress({ type: 'orbit', body: v.body, vesselId: v.state.id }); }
  onLanded(v: WorldVessel) {
    for (const p of v.state.parts) { const visited = p.visitedBodies ??= []; if (!visited.includes(v.body)) visited.push(v.body); }
    this.emitProgress({ type: 'landed', body: v.body, vesselId: v.state.id });
  }
  onEnteredSoi(v: WorldVessel) { this.emitProgress({ type: 'soi', body: v.body, vesselId: v.state.id }); }
  onScienceCollected(v: WorldVessel, biome: string) { this.emitProgress({ type: 'science', body: v.body, biome, vesselId: v.state.id }); }
  onRecovered(v: WorldVessel) { this.emitProgress({ type: 'recovered', body: v.body, vesselId: v.state.id, visited: v.state.parts.flatMap(p => p.visitedBodies ?? []) }); }

  get active(): WorldVessel | null {
    return this.activeId ? (this.vessels.get(this.activeId) ?? null) : null;
  }

  message(text: string, level: WorldMessage['level'] = 'info', seconds = 4) {
    this.messages.push({ id: ++this.msgId, text, level, expires: performance.now() + seconds * 1000 });
  }

  /** Lowest point of the vessel along its own -Y axis, measured from the COM (positive number). */
  bottomOffset(v: VesselState): number {
    let minY = Infinity;
    for (const p of v.parts) {
      const s = p.def.shape;
      const ext = s.kind === 'cylinder' ? s.height / 2 : s.size.y / 2;
      // Account for rotated parts conservatively using the rotated local Y extent.
      const upInPart = qRotate(qConj(p.rotation), v3(0, 1, 0));
      const radial = s.kind === 'cylinder' ? Math.max(s.radiusTop, s.radiusBottom) : Math.max(s.size.x, s.size.z) / 2;
      const extY = Math.abs(upInPart.y) * ext + Math.sqrt(Math.max(0, 1 - upInPart.y * upInPart.y)) * radial;
      minY = Math.min(minY, p.position.y - extY);
      for (const m of p.def.modules) {
        if (m.type === 'landingLeg') {
          const foot = add(p.position, qRotate(p.rotation, m.footPosition));
          minY = Math.min(minY, foot.y);
        }
      }
    }
    return v.com.y - minY;
  }

  /**
   * Distance from the COM to the vessel's lowest point along body direction `down` (unit, body frame): hull
   * points of every part and the tyres of deployed wheels at full suspension extension.
   */
  restOffset(v: VesselState, down: Vec3): number {
    let best = 0;
    for (const p of v.parts) {
      for (const hp of hullPoints(p.def)) best = Math.max(best, dot(sub(add(p.position, qRotate(p.rotation, hp)), v.com), down));
      if (p.wheel && p.wheel.deploy >= 1) {
        const g = wheelContactPoint(v, p);
        best = Math.max(best, dot(sub(g.center, v.com), down) + g.module.radius);
      }
    }
    return best;
  }

  /**
   * Spawn a craft. 'pad' (default for VAB crafts): on the launch pad, held by launch clamps until the first
   * stage fires. 'runway' (default for SPH crafts): free on its wheels at the runway threshold, nose down the
   * runway (body +Y along the runway, +Z up), ready to taxi.
   */
  launch(craft: CraftDef, site: 'pad' | 'runway' = craft.type === 'SPH' ? 'runway' : 'pad', keepExisting = false): WorldVessel {
    const problem = launchProblem(craft, this.catalog, this.mode, this.progression);
    if (problem) throw new Error(problem);
    // Validate assembly before charging or clearing the launch site.
    buildVessel(craft, this.catalog, { id: 'validation', resourceDefs: RESOURCES });
    if (this.mode === 'career') this.progression.funds -= launchCost(craft, this.catalog);
    if (site === 'runway') return this.launchRunway(craft, keepExisting);
    const u = this.universe;
    const bodyId = 'earth';
    const body = u.body(bodyId);
    const dir = latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon);
    const terrainH = Math.max(0, u.terrain(bodyId).heightAt(dir.x, dir.y, dir.z));
    // Body-fixed basis at the pad: +Y up, +X east, +Z = X × Y (south).
    const up = v3(dir.x, dir.y, dir.z);
    const east = normalize(cross(v3(0, 0, 1), up));
    const zAxis = cross(east, up);
    const orientFixed = quatFromBasis(east, up, zAxis);

    // Clear the pad: anything still clamped, or resting within 150 m of the pad, is recovered.
    const padHelio = add(u.ephem.getBodyState(bodyId, this.ut).position, qRotate(bodyQuat(u, bodyId, this.ut), scale(up, body.radius + terrainH)));
    for (const [id, other] of keepExisting ? [] : this.vessels) {
      const near = length(sub(other.state.position, padHelio)) < 150;
      if (other.mode === 'prelaunch' || (near && other.state.situation !== 'flying')) { recoverScience(this, other); this.vessels.delete(id); }
    }
    const state = buildVessel(craft, this.catalog, { id: this.newVesselId(), resourceDefs: RESOURCES, legsDeployed: false });
    state.name = craft.name;
    if (this.mode === 'career') for (const p of state.parts) p.purchaseCost = p.def.cost;
    this.assignCrew(state);
    const bottom = this.bottomOffset(state);
    const posFixed = scale(up, body.radius + terrainH + bottom + 0.05);
    const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: posFixed, orient: orientFixed } };
    this.syncFixed(wv, this.ut);
    this.vessels.set(state.id, wv);
    this.activeId = state.id;
    this.nodes = [];
    this.warp = { mode: 'rails', index: 0 };
    return wv;
  }

  private launchRunway(craft: CraftDef, keepExisting = false): WorldVessel {
    const u = this.universe;
    const bodyId = 'earth';
    const body = u.body(bodyId);
    const along = RUNWAY.length / 2 - RUNWAY.spawnInset;
    const lx = RUNWAY.x - RUNWAY.dirX * along, lz = RUNWAY.z - RUNWAY.dirZ * along;
    const dir = siteLocalToUnit(lx, lz, body.radius);
    const ahead = siteLocalToUnit(lx + RUNWAY.dirX * 100, lz + RUNWAY.dirZ * 100, body.radius);
    const terrainH = Math.max(0, u.terrain(bodyId).heightAt(dir.x, dir.y, dir.z));
    const up = v3(dir.x, dir.y, dir.z);
    let fwd = sub(v3(ahead.x, ahead.y, ahead.z), up);
    fwd = normalize(sub(fwd, scale(up, dot(fwd, up))));
    // Body axes: +Y (nose) down the runway, +Z (top) up, +X = Y × Z (right wing).
    const orientFixed = quatFromBasis(cross(fwd, up), fwd, up);

    const spotHelio = add(u.ephem.getBodyState(bodyId, this.ut).position, qRotate(bodyQuat(u, bodyId, this.ut), scale(up, body.radius + terrainH)));
    for (const [id, other] of keepExisting ? [] : this.vessels)
      if (length(sub(other.state.position, spotHelio)) < 100 && other.state.situation !== 'flying') { recoverScience(this, other); this.vessels.delete(id); }
    const state = buildVessel(craft, this.catalog, { id: this.newVesselId(), resourceDefs: RESOURCES, legsDeployed: false, gearDeployed: true });
    state.name = craft.name;
    if (this.mode === 'career') for (const p of state.parts) p.purchaseCost = p.def.cost;
    this.assignCrew(state);
    const rest = this.restOffset(state, v3(0, 0, -1));
    const wv: WorldVessel = { state, mode: 'prelaunch', body: bodyId, fixed: { pos: scale(up, body.radius + terrainH + rest + 0.03), orient: orientFixed } };
    this.syncFixed(wv, this.ut);
    // Free on its wheels straight away (no clamps): physics from the first step.
    wv.mode = 'physics';
    wv.fixed = undefined;
    state.situation = 'landed';
    this.vessels.set(state.id, wv);
    this.activeId = state.id;
    this.nodes = [];
    this.warp = { mode: 'rails', index: 0 };
    return wv;
  }

  private newVesselId() {
    const base = `v${Date.now().toString(36)}`;
    let id = base;
    for (let i = 1; this.vessels.has(id); i++) id = `${base}-${i}`;
    return id;
  }

  /** Add a free-flying craft with the given inertial COM state and attitude (physics mode; not made active). */
  spawnVessel(craft: CraftDef, state: { position: Vec3; velocity: Vec3; orientation: Quat }, name = craft.name): WorldVessel {
    let id = `v${Date.now().toString(36)}`;
    for (let k = 1; this.vessels.has(id); k++) id = `v${Date.now().toString(36)}-${k}`;
    const vs = buildVessel(craft, this.catalog, { id, resourceDefs: RESOURCES, ...state });
    vs.name = name;
    this.assignCrew(vs);
    const wv: WorldVessel = { state: vs, mode: 'physics', body: this.universe.dominantBody(vs.position, this.ut) };
    this.vessels.set(id, wv);
    return wv;
  }

  /** Assign only newly created pods. Existing empty seats must stay empty. */
  assignCrew(v: VesselState) {
    for (const p of v.parts) {
      if (!seatCapacity(p) || p.crew) continue;
      p.crew = [];
      for (let i = 0; i < seatCapacity(p); i++) {
        const astronaut = generateAstronaut(this.crewSeed, this.crew.length);
        this.crew.push(astronaut);
        p.crew.push(astronaut.id);
      }
    }
    recomputeMassProperties(v, false);
  }

  crewFor(v = this.active?.state): Astronaut[] {
    const ids = v ? crewIds(v) : [];
    return ids.flatMap(id => this.crew.find(c => c.id === id) ?? []);
  }

  canControl(v = this.active?.state): boolean { return !!v && hasControl(v); }

  /** Hatch is on the pod's +Z face. Public for HUD/rendezvous tools. */
  hatchPosition(v: VesselState, pod: PartState): Vec3 {
    const shape = pod.def.shape;
    const radius = shape.kind === 'box' ? shape.size.z / 2 : Math.max(shape.radiusTop, shape.radiusBottom);
    return add(v.position, qRotate(v.orientation, sub(add(pod.position, qRotate(pod.rotation, v3(0, 0, radius + 0.6))), v.com)));
  }

  goEva(astronautId?: string): WorldVessel | null {
    const host = this.active;
    if (!host || host.state.eva || host.state.destroyed) return null;
    const pod = host.state.parts.find(p => p.crew?.some(id => !astronautId || id === astronautId));
    if (!pod) { this.message('No astronaut aboard', 'warn'); return null; }
    if (host.mode === 'rails' || host.mode === 'landedRails') this.unpack(host);
    this.warp = { mode: 'rails', index: 0 };
    const v = host.state;
    const id = astronautId ?? pod.crew![0];
    const person = this.crew.find(c => c.id === id)!;
    const pos = this.hatchPosition(v, pod);
    const originalPosition = { ...v.position }, velocity = { ...v.velocity }, mass = v.mass;
    const eva = buildVessel({ name: person.name, version: 1, type: 'VAB', parts: [{ uid: 1, partId: EVA_PART.id, position: v3(), rotation: qIdentity() }] }, this.catalog, { id: `eva-${id}`, position: pos, velocity, orientation: v.orientation, resourceDefs: RESOURCES });
    eva.eva = { astronautId: id, walkPhase: 0, walking: false, jetting: false };
    pod.crew = pod.crew!.filter(c => c !== id);
    recomputeMassProperties(v, false);
    // Move the remaining COM so the combined COM and linear momentum are unchanged by hatch transfer.
    v.position = sub(originalPosition, scale(sub(pos, originalPosition), eva.mass / v.mass));
    v.velocity = scale(velocity, (mass - eva.mass) / v.mass);
    if (host.mode === 'prelaunch') this.captureFixed(host, this.ut);
    const wv: WorldVessel = { state: eva, body: host.body, mode: 'physics' };
    this.vessels.set(eva.id, wv);
    this.switchTo(eva.id);
    this.stageRequested = false;
    this.message(`${person.name} is on EVA`);
    return wv;
  }

  boardingTarget(): { vessel: WorldVessel; pod: PartState } | null {
    const eva = this.active;
    if (!eva?.state.eva) return null;
    for (const vessel of this.vessels.values()) {
      if (vessel === eva || vessel.body !== eva.body || vessel.state.destroyed) continue;
      for (const pod of vessel.state.parts) {
        if (seatCapacity(pod) <= (pod.crew?.length ?? 0)) continue;
        if (length(sub(eva.state.position, this.hatchPosition(vessel.state, pod))) <= 3 && length(sub(eva.state.velocity, vessel.state.velocity)) < 3) return { vessel, pod };
      }
    }
    return null;
  }

  boardEva(): boolean {
    const eva = this.active;
    const target = this.boardingTarget();
    if (!eva?.state.eva || !target) { this.message('Move within 3 m of a free pod hatch, below 3 m/s', 'warn'); return false; }
    const { vessel, pod } = target;
    if (vessel.mode === 'rails' || vessel.mode === 'landedRails') this.unpack(vessel);
    const v = vessel.state, oldMass = v.mass;
    const velocity = scale(add(scale(v.velocity, oldMass), scale(eva.state.velocity, eva.state.mass)), 1 / (oldMass + eva.state.mass));
    (pod.crew ??= []).push(eva.state.eva.astronautId);
    recomputeMassProperties(v);
    v.velocity = velocity;
    // Suit is serviced/refilled aboard; its full mass is again included in the pod's dry mass.
    if (vessel.mode === 'prelaunch') this.captureFixed(vessel, this.ut);
    (pod.scienceData ??= []).push(...eva.state.parts.flatMap(p => p.scienceData ?? []));
    pod.visitedBodies = [...new Set([...(pod.visitedBodies ?? []), ...eva.state.parts.flatMap(p => p.visitedBodies ?? [])])];
    this.vessels.delete(eva.state.id);
    if (this.targetId === eva.state.id) this.setTarget(null);
    this.switchTo(v.id);
    this.warp = { mode: 'rails', index: 0 };
    this.stageRequested = false;
    this.message(`Boarded ${v.name} · suit refilled`);
    return true;
  }

  plantFlag(): PlantedFlag | null {
    const eva = this.active;
    if (!eva?.state.eva || eva.state.situation !== 'landed') { this.message('Land your astronaut to plant a flag', 'warn'); return null; }
    const g = this.universe.createEnvironment(() => eva.body).ground(add(eva.state.position, qRotate(eva.state.orientation, v3(0.75, 0, 0))), this.ut);
    if (!g || g.isWater) return null;
    const qi = qConj(bodyQuat(this.universe, eva.body, this.ut));
    const firstMoon = eva.body === 'moon' && !this.flags.some(f => f.body === 'moon');
    const flag: PlantedFlag = { id: `flag-${this.flags.length}`, body: eva.body, position: qRotate(qi, sub(g.surfacePoint, this.universe.ephem.getBodyState(eva.body, this.ut).position)), orientation: qMul(qi, qMul(qFromTo(qRotate(eva.state.orientation, v3(0, 1, 0)), g.normal), eva.state.orientation)), astronautId: eva.state.eva.astronautId, plantedAt: this.ut };
    this.flags.push(flag);
    this.message(firstMoon ? 'First footsteps, a shared horizon. Humanity has planted its first flag on the Moon.' : `Flag planted on ${this.universe.body(eva.body).name}`, 'info', firstMoon ? 14 : 5);
    return flag;
  }

  /** Update a body-fixed vessel's inertial state from its fixed coordinates. */
  private syncFixed(wv: WorldVessel, t: number) {
    const u = this.universe;
    const bs = u.ephem.getBodyState(wv.body, t);
    const q = bodyQuat(u, wv.body, t);
    const rel = qRotate(q, wv.fixed!.pos);
    wv.state.position = add(bs.position, rel);
    wv.state.velocity = add(bs.velocity, u.ephem.surfaceVelocity(wv.body, rel, t));
    wv.state.orientation = qNormalize(qMul(q, wv.fixed!.orient));
    // Co-rotate with the body: inertial spin axis expressed in vessel body frame.
    const b = u.body(wv.body);
    const spin = qRotate(q, v3(0, 0, b.rotationRate));
    wv.state.angularVelocity = qRotate(qConj(wv.state.orientation), spin);
  }

  /** Capture a landed vessel's body-fixed coordinates (for rails warp while landed). */
  private captureFixed(wv: WorldVessel, t: number) {
    const u = this.universe;
    const bs = u.ephem.getBodyState(wv.body, t);
    const q = bodyQuat(u, wv.body, t);
    const qi = qConj(q);
    wv.fixed = { pos: qRotate(qi, sub(wv.state.position, bs.position)), orient: qNormalize(qMul(qi, wv.state.orientation)) };
  }

  relativeState(wv: WorldVessel, t = this.ut): StateVector {
    const bs = this.universe.ephem.getBodyState(wv.body, t);
    return { position: sub(wv.state.position, bs.position), velocity: sub(wv.state.velocity, bs.velocity) };
  }

  orbitOf(wv: WorldVessel): Orbit {
    if (wv.mode === 'rails' && wv.orbit) return wv.orbit;
    const rs = this.relativeState(wv);
    return stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
  }

  /** Put a vessel on rails at the current time. */
  private pack(wv: WorldVessel) {
    if (wv.mode === 'rails' || wv.mode === 'landedRails' || wv.mode === 'prelaunch') return;
    if (wv.state.situation !== 'flying') {
      this.captureFixed(wv, this.ut);
      wv.mode = 'landedRails';
      return;
    }
    const rs = this.relativeState(wv);
    wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, rs.position, rs.velocity, this.ut);
    wv.mode = 'rails';
    wv.state.angularVelocity = v3();
    this.predictRailsEvent(wv);
  }

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
    for (const wv of this.vessels.values()) {
      if (wv.mode === 'rails' && wv.orbit) this.predictRailsEvent(wv);
      if ((wv.mode === 'landedRails' || wv.mode === 'prelaunch') && wv.fixed) this.syncFixed(wv, this.ut);
    }
    this.trajectoryCache = null;
  }

  private predictRailsEvent(wv: WorldVessel) {
    const o = wv.orbit!;
    const T = period(o);
    const horizon = Math.min(isFinite(T) ? T * 3 : 3e8, 3e9);
    try {
      const patches = predictTrajectory({
        ephem: this.universe.ephem,
        bodies: this.universe.bodies,
        initialBody: wv.body,
        state: propagate(o, this.ut),
        t0: this.ut,
        horizon,
        maxPatches: 1,
        stopAtAtmosphere: true,
        // Stop warping before the highest terrain, not the datum sphere (mountains/crater rims rise km above it).
        impactAltitude: (b) => (b.solidSurface ? Math.max(0, this.universe.terrain(b.id).maxHeight) : 0),
      });
      const p = patches[0];
      // A 'horizon' event is kept too: when it is reached the prediction is extended (see advanceRails), so
      // encounters further out than one horizon are not missed during long warps.
      wv.railsEvent = p ? { time: p.endTime, reason: p.endReason, nextBody: p.nextBody } : undefined;
    } catch {
      wv.railsEvent = undefined;
    }
  }

  /** Take a vessel off rails (back to physics). */
  private unpack(wv: WorldVessel) {
    if (wv.mode === 'rails' && wv.orbit) {
      const s = propagate(wv.orbit, this.ut);
      const bs = this.universe.ephem.getBodyState(wv.body, this.ut);
      wv.state.position = add(bs.position, s.position);
      wv.state.velocity = add(bs.velocity, s.velocity);
    } else if (wv.mode === 'landedRails') {
      this.syncFixed(wv, this.ut);
    } else return;
    wv.mode = 'physics';
    wv.orbit = undefined;
    wv.railsEvent = undefined;
  }

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
    let value: TrajectoryApproach | null = null;
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
  private stepDockingAll() {
    const phys: VesselState[] = [];
    for (const wv of this.vessels.values()) if (wv.mode === 'physics' && !wv.state.destroyed) phys.push(wv.state);
    if (phys.length < 2) return;
    const events = stepDocking(phys, PHYSICS_DT, (a, b) => (a.id === this.activeId ? a : b.id === this.activeId ? b : a.mass >= b.mass ? a : b));
    for (const e of events) {
      this.vessels.delete(e.removed.id);
      if (this.activeId === e.removed.id) this.activeId = e.keep.id;
      if (this.targetId === e.removed.id || this.targetId === e.keep.id) this.setTarget(null);
      this.trajectoryCache = null;
      const keepWv = this.vessels.get(e.keep.id);
      if (keepWv) keepWv.body = this.universe.dominantBody(e.keep.position, this.ut);
      if (e.keep.id === this.activeId) this.message(`Docked with ${e.removedName}`);
      this.handleEvent({ type: 'docked', vesselId: e.keep.id, otherId: e.removed.id });
    }
  }

  /** Undock the active vessel at `portUid` (default: the first docked joint). Returns the new vessel id. */
  undockActive(portUid?: number): string | null {
    const wv = this.active;
    if (!wv || !this.canControl(wv.state)) return null;
    if (wv.mode !== 'physics') this.unpack(wv);
    if (wv.mode !== 'physics') return null;
    const uid = portUid ?? dockedPorts(wv.state)[0]?.uid;
    if (uid === undefined) return null;
    const nv = undock(wv.state, uid);
    if (!nv) return null;
    if (this.vessels.has(nv.id)) nv.id = `${wv.state.id}.${++wv.state.splitCount}`;
    this.vessels.set(nv.id, { state: nv, mode: 'physics', body: wv.body });
    this.trajectoryCache = null;
    this.message(`Undocked ${nv.name}`);
    this.handleEvent({ type: 'undocked', vesselId: wv.state.id, newVesselId: nv.id });
    return nv.id;
  }

  warpContext(): WarpContext {
    const wv = this.active;
    if (!wv) return { thrusting: false, inAtmosphere: false, landed: true, altitude: 1e9, bodyRadius: 1, atmosphereHeight: 0 };
    const b = this.universe.body(wv.body);
    const alt = length(this.relativeState(wv).position) - b.radius;
    const thrusting = wv.state.telemetry.thrust > 0;
    return {
      thrusting,
      inAtmosphere: !!b.atmosphere && alt < b.atmosphere.height,
      landed: wv.state.situation !== 'flying' || wv.mode === 'prelaunch',
      altitude: alt,
      bodyRadius: b.radius,
      atmosphereHeight: b.atmosphere?.height ?? 0,
    };
  }

  changeWarp(delta: number) {
    const next = stepWarp(this.warp, delta, this.warpContext());
    if (next.mode === 'rails' && next.index > 0 && this.warp.index === 0 && this.warp.mode === 'rails') {
      // Entering rails warp: refuse if the vessel is spinning fast or accelerating (would lose state).
    }
    this.warp = next;
  }

  /** Advance the simulation by `realDt` seconds of wall time with the given control input for the active vessel. */
  tick(realDt: number, input: ControlInput) {
    if (!this.canControl()) { input = neutralInput(); this.stageRequested = false; this.evaJumpRequested = false; }
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
  advanceRailsTo(ut: number) {
    if (!Number.isFinite(ut) || ut < this.ut) return;
    for (const wv of this.vessels.values()) this.pack(wv);
    this.advanceRails(ut);
  }

  /**
   * Advance all on-rails vessels to `target`, processing rails events in time order. The active vessel goes
   * first and may shorten the frame: at its SOI change (so the next frame re-clamps the warp rate for the new
   * body — at high warp one frame could otherwise also carry it through periapsis or into the surface) and
   * just before atmosphere entry / impact (warp is cancelled). Everything else then advances to that time.
   */
  private advanceRails(target: number) {
    const act = this.active;
    const order = [...this.vessels.values()].sort((a, b) => (a === act ? -1 : b === act ? 1 : 0));
    for (const wv of order) {
      if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') continue;
      const isActive = wv === act;
      let guard = 0;
      while (wv.mode === 'rails' && wv.railsEvent && wv.railsEvent.time <= target && guard++ < 32) {
        const ev = wv.railsEvent;
        const s = propagate(wv.orbit!, ev.time);
        if (ev.reason === 'soiEnter' || ev.reason === 'soiExit') {
          const oldB = this.universe.ephem.getBodyState(wv.body, ev.time);
          const newB = this.universe.ephem.getBodyState(ev.nextBody!, ev.time);
          const pos = sub(add(oldB.position, s.position), newB.position);
          const vel = sub(add(oldB.velocity, s.velocity), newB.velocity);
          wv.body = ev.nextBody!;
          this.onEnteredSoi(wv);
          wv.orbit = stateToElements(this.universe.body(wv.body).gm, wv.body, pos, vel, ev.time);
          if (isActive) {
            this.message(`Entered ${this.universe.body(wv.body).name}'s sphere of influence`);
            target = ev.time;
          }
          const saveUt = this.ut;
          this.ut = ev.time;
          this.predictRailsEvent(wv);
          this.ut = saveUt;
        } else if (ev.reason === 'horizon' || ev.reason === 'maneuver') {
          // End of the predicted window without an event: predict the next window.
          const saveUt = this.ut;
          this.ut = ev.time;
          this.predictRailsEvent(wv);
          this.ut = saveUt;
          if (wv.railsEvent && wv.railsEvent.time <= ev.time) wv.railsEvent = undefined;
        } else if (isActive) {
          // Never warp into the atmosphere or the ground: stop just short of it and drop to physics.
          target = Math.max(this.ut, Math.min(target, ev.time - 1));
          this.warp = { mode: 'rails', index: 0 };
          this.message('Time warp stopped: approaching ' + (ev.reason === 'atmosphere' ? 'atmosphere' : 'surface'), 'warn');
          break;
        } else {
          // Non-active vessels entering atmosphere or impacting on rails are lost.
          this.vessels.delete(wv.state.id);
          wv.railsEvent = undefined;
          break;
        }
      }
    }
    this.ut = target;
    for (const wv of this.vessels.values()) this.syncPacked(wv, this.ut);
    evaluateProgression(this);
  }

  /** Replica ephemeris update; does not integrate physics or resolve events. */
  syncReplicaPacked(t = this.ut) {
    for (const v of this.vessels.values()) this.syncPacked(v, t);
  }

  /** Update the inertial state of a packed (rails / body-fixed) vessel to time t. */
  private syncPacked(wv: WorldVessel, t: number) {
    if (wv.mode === 'rails' && wv.orbit) {
      const s = propagate(wv.orbit, t);
      const bs = this.universe.ephem.getBodyState(wv.body, t);
      wv.state.position = add(bs.position, s.position);
      wv.state.velocity = add(bs.velocity, s.velocity);
    } else if (wv.mode === 'landedRails' || wv.mode === 'prelaunch') {
      this.syncFixed(wv, t);
    }
  }

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
      const vesselInput = inputs?.get(wv.state.id) ?? input;
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
          else this.pack(wv);
          continue;
        }
        if (wv.mode === 'rails' || wv.mode === 'landedRails') this.unpack(wv);
      }
      if (wv.mode === 'prelaunch') {
        if (isActive && vesselInput.stage) {
          this.syncFixed(wv, t);
          wv.mode = 'physics';
          wv.fixed = undefined;
          this.message('Liftoff!');
        } else {
          // States are expressed at the end of the step (t + dt), like physics-stepped vessels.
          this.syncFixed(wv, t + PHYSICS_DT);
          continue;
        }
      }
      if (wv.mode !== 'physics') continue;
      // Update dominant body (SOI transitions in physics).
      wv.body = this.universe.dominantBody(wv.state.position, t);
      const env = this.universe.createEnvironment(() => wv.body);
      const ctrl = isActive && this.canControl(wv.state) ? vesselInput : neutralInput({ sas: 'off' });
      const res = wv.state.eva ? stepEva(wv.state, ctrl, env, t, PHYSICS_DT) : stepVessel(wv.state, ctrl, env, t, PHYSICS_DT);
      for (const nv of res.newVessels) {
        recomputeMassProperties(nv, false);
        // Split-off vessels hold state at time t (staging happens at the start of the step); bring them to
        // t + dt so they don't lag the parent by one step of heliocentric motion.
        nv.position = add(nv.position, scale(nv.velocity, PHYSICS_DT));
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
    evaluateProgression(this);
  }

  private handleEvent(e: VesselEvent) {
    this.onEvent?.(e);
    if (e.vesselId !== this.activeId) return;
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
    let patches: TrajectoryPatch[] = [];
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
  orbitSummary(wv: WorldVessel) {
    const b = this.universe.body(wv.body);
    const o = this.orbitOf(wv);
    return {
      orbit: o,
      ap: apoapsisRadius(o) - b.radius,
      pe: periapsisRadius(o) - b.radius,
      timeToAp: timeToApoapsis(o, this.ut),
      timeToPe: timeToPeriapsis(o, this.ut),
    };
  }

  /** Dot helper used by HUD (vertical speed). */
  verticalSpeed(wv: WorldVessel): number {
    const rs = this.relativeState(wv);
    return dot(rs.velocity, normalize(rs.position));
  }

  surfaceVelocity(wv: WorldVessel): Vec3 {
    const rs = this.relativeState(wv);
    return sub(rs.velocity, this.universe.ephem.surfaceVelocity(wv.body, rs.position, this.ut));
  }
}

/** Quaternion from orthonormal basis columns (x, y, z are images of the unit axes). */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return qNormalize(q);
}

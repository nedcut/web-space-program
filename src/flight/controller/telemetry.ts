import { dvBasis, hudStages, totalVacuumDv } from './stages';
import { suicideBurn } from '../../sim/orbit/readouts';
import { flightMessages, ThrottleCueTracker, throttleExplanation } from '../cues';
import { controlAuthority } from '../../sim/vessel/integrator';
import { neutralInput } from '../../sim/vessel/runtime';
import { RESOURCES } from '../../data/resources';
import { RESOURCE_COLORS } from '../../ui/inspector/resources';
import { flightData, flightPredictions } from '../../game/flightData';
import { cachedStageDeltaV } from '../../game/stageDeltaVCache';
import { maxRailsIndexAt, RAILS_WARP, warpLabel } from '../../game/timewarp';
import { type WorldVessel } from '../../game/world';
import { ACTION_GROUP_IDS, dockedPorts, freePorts, GROUP_LABELS, groupBindings, lightOn, type PortInfo, type StageDeltaV } from '../../sim/vessel';
import { bindingLabel } from '../../input/bindings';
import { qRotate } from '../../util/quat';
import { dot, length, negate, sub, v3 } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { DockingTelemetry, Telemetry } from '../hud/Hud';
import type { FlightControllerInternals } from './internals';

import { AlertTracker } from '../alerts';
import { BurnTracker } from './burn';
import { cross, normalize } from '../../util/vec3';
import { warpTargets } from './warp';
import { game } from '../../game/store';
import { getTutorial } from '../../tutorial/runtime';

const cueStates = new WeakMap<FlightController, { vessel: string; body: string; signal: boolean; throttle: string | null; sas: boolean; soi: boolean; orbit: boolean; situation: string; staged: number }>();
const throttleTrackers = new WeakMap<FlightController, ThrottleCueTracker>();
const alertTrackers = new WeakMap<FlightController, AlertTracker>();
const burnTrackers = new WeakMap<FlightController, BurnTracker>();

/** Highest rails warp index allowed right now (0 = rails warp refused: thrusting or in atmosphere). */
function railsWarpLimit(w: FlightController['world']): number {
  const c = w.warpContext();
  if (c.thrusting || (c.inAtmosphere && !c.landed)) return 0;
  return c.landed ? RAILS_WARP.length - 1 : maxRailsIndexAt(c.altitude, c.bodyRadius, c.atmosphereHeight);
}

/** Active and target docking ports for the docking indicator (target port if selected, else the closest pair). */
export function dockingPair(this: FlightController, _internals: FlightControllerInternals): { mine: PortInfo; theirs: PortInfo } | null {
  const w = this.world;
  const act = w.active;
  if (!act || !w.targetId || w.targetKind() !== 'vessel') return null;
  const theirsAll = freePorts(w.vessels.get(w.targetId)!.state);
  const mineAll = freePorts(act.state);
  if (!theirsAll.length || !mineAll.length) return null;
  const dist = (a: PortInfo, b: PortInfo) => length(sub(a.pos, b.pos)) + (a.mod.size === b.mod.size ? 0 : 1e9);
  let best: { mine: PortInfo; theirs: PortInfo } | null = null;
  const theirs = w.targetPortUid !== null ? theirsAll.filter((p) => p.part.uid === w.targetPortUid) : theirsAll;
  for (const t of theirs.length ? theirs : theirsAll)
    for (const m of mineAll) if (!best || dist(m, t) < dist(best.mine, best.theirs)) best = { mine: m, theirs: t };
  return best;
}


export function dockingTelemetry(this: FlightController, internals: FlightControllerInternals): DockingTelemetry | null {
  const pair = internals.dockingPair();
  if (!pair) return null;
  const { mine, theirs } = pair;
  const q = this.world.active!.state.orientation;
  const fwd = mine.dir;
  const right = qRotate(q, qRotate(mine.part.rotation, v3(1, 0, 0)));
  const up = qRotate(q, qRotate(mine.part.rotation, v3(0, 0, 1)));
  const rel = sub(theirs.pos, mine.pos);
  const rv = sub(theirs.vel, mine.vel);
  const facing = negate(theirs.dir);
  return {
    myPort: mine.part.def.name,
    targetPort: theirs.part.def.name,
    sizeMatch: mine.mod.size === theirs.mod.size,
    x: dot(rel, right),
    y: dot(rel, up),
    z: dot(rel, fwd),
    vx: dot(rv, right),
    vy: dot(rv, up),
    vz: dot(rv, fwd),
    angle: (Math.acos(Math.max(-1, Math.min(1, dot(fwd, facing)))) * 180) / Math.PI,
    tiltX: dot(facing, right),
    tiltY: dot(facing, up),
    captureRange: Math.min(mine.mod.captureRange, theirs.mod.captureRange),
    captureSpeed: Math.min(mine.mod.captureSpeed, theirs.mod.captureSpeed),
    captureAngle: (Math.min(mine.mod.captureAngle, theirs.mod.captureAngle) * 180) / Math.PI,
    armed: !mine.part.dockDisarmed && !theirs.part.dockDisarmed,
  };
}


export function targetTelemetry(this: FlightController, _internals: FlightControllerInternals, wv: WorldVessel): Telemetry['target'] {
  const w = this.world;
  const kind = w.targetKind();
  const ts = w.targetState();
  if (!kind || !ts) return null;
  const rel = sub(ts.position, wv.state.position);
  const rv = sub(wv.state.velocity, ts.velocity);
  const d = length(rel);
  const ca = w.closestApproach();
  const tv = kind === 'vessel' ? w.vessels.get(w.targetId!)!.state : null;
  return {
    id: w.targetId!,
    name: w.targetName() ?? '',
    kind,
    distance: kind === 'body' ? d - w.universe.body(w.targetId!).radius : d,
    relSpeed: length(rv),
    closing: d > 0 ? dot(rv, rel) / d : 0,
    portUid: w.targetPortUid,
    ports: tv ? freePorts(tv).map((p) => ({ uid: p.part.uid, name: p.part.def.name })) : [],
    approach: ca ? { distance: ca.distance, time: ca.time - w.ut, relSpeed: ca.relativeSpeed } : null,
  };
}


export function targetOptions(this: FlightController, _internals: FlightControllerInternals, wv: WorldVessel): Telemetry['targetOptions'] {
  const w = this.world;
  const out: Telemetry['targetOptions'] = [];
  for (const v of w.vessels.values()) {
    if (v === wv) continue;
    out.push({ id: v.state.id, name: v.state.name, kind: 'vessel', distance: length(sub(v.state.position, wv.state.position)) });
  }
  out.sort((a, b) => a.distance - b.distance);
  const cur = w.universe.body(wv.body);
  const bodies: Telemetry['targetOptions'] = [];
  for (const b of w.universe.bodies.values()) {
    if (b.id === cur.id || b.parent === cur.id || b.id === cur.parent || (cur.parent && b.parent === cur.parent)) {
      const bp = w.universe.ephem.getBodyState(b.id, w.ut).position;
      bodies.push({ id: b.id, name: b.name, kind: 'body', distance: length(sub(bp, wv.state.position)) - b.radius });
    }
  }
  bodies.sort((a, b) => a.distance - b.distance);
  return [...out.slice(0, 12), ...bodies];
}


export function telemetry(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel): Telemetry {
  const w = this.world;
  const u = w.universe;
  const b = u.body(wv.body);
  const info = u.surfaceInfo(wv.body, wv.state.position, w.ut);
  const orb = w.orbitSummary(wv);
  const rs = w.relativeState(wv);
  const st = wv.state;
  const target = internals.targetTelemetry(wv);
  const speed = this.speedMode === 'surface' ? length(w.surfaceVelocity(wv)) : this.speedMode === 'target' && target ? target.relSpeed : length(rs.velocity);

  // Resources (totals across vessel).
  const totals = new Map<string, { amount: number; max: number }>();
  for (const p of st.parts) {
    for (const [id, max] of Object.entries(p.maxResources)) {
      const e = totals.get(id) ?? { amount: 0, max: 0 };
      e.amount += p.resources[id as keyof typeof p.resources] ?? 0;
      e.max += max ?? 0;
      totals.set(id, e);
    }
  }
  const pressure = st.telemetry.staticPressure;
  let dvs: StageDeltaV[];
  try {
    dvs = cachedStageDeltaV(st, pressure, b.surfaceGravity);
  } catch {
    dvs = [];
  }
  const stages = hudStages(st, dvs);
  const dvAt = dvBasis(pressure, b.atmosphere?.surfacePressure ?? 0);
  let totalDvVac = 0;
  try {
    totalDvVac = dvAt === 'vac' ? stages.reduce((s, x) => s + x.deltaV, 0) : totalVacuumDv(stages, cachedStageDeltaV(st, 0, b.surfaceGravity));
  } catch { /* the readout simply omits the vacuum line */ }

  internals.predictions = flightPredictions(w, wv);
  const ground = internals.groundTelemetry(wv);
  let heat = 0;
  let hottest: string | undefined;
  let ignited = false;
  let flameout = false;
  for (const p of st.parts) {
    let f = p.temperature / p.maxTemp;
    for (const t of p.skinTemperature) f = Math.max(f, t / p.maxTemp);
    if (f > heat) { heat = f; hottest = p.def.name; }
    if (p.engine?.ignited) { ignited = true; if (p.engine.flamedOut) flameout = true; }
  }
  const ec = totals.get('electricCharge');
  const vs = w.verticalSpeed(wv);
  const surfaceSpeed = length(w.surfaceVelocity(wv));
  let tracker = alertTrackers.get(this);
  if (!tracker) alertTrackers.set(this, (tracker = new AlertTracker()));
  const flying = st.situation === 'flying' && wv.mode !== 'prelaunch';
  const currentStage = ignited ? dvs.find(d => d.stage === st.nextStage + 1) : undefined;
  const gravity = b.gm / (info.r * info.r);
  const upward = dot(qRotate(st.orientation, v3(0, 1, 0)), normalize(rs.position));
  const brakingAcceleration = (currentStage?.thrust ?? 0) / st.mass * Math.max(0, upward);
  const noControl = !w.canControl(st) || (!!this.network && this.network.ownId !== st.id);
  const alerts = tracker.update({
    noControl,
    eva: !!st.eva,
    flying,
    heatFraction: heat,
    hottestPart: hottest,
    gForce: st.telemetry.gForce,
    agl: info.heightAboveTerrain,
    verticalSpeed: vs,
    gravity, brakingAcceleration, brakingFuelSeconds: currentStage?.burnTime ?? 0,
    horizontalSpeed: Math.sqrt(Math.max(0, surfaceSpeed * surfaceSpeed - vs * vs)),
    chutes: st.parts.some((p) => p.chute?.phase === 'semi' || p.chute?.phase === 'full'),
    gear: ground.gear,
    thrusting: ignited && this.input.state.throttle > 0,
    stageBurnTime: ignited ? (dvs.find((d) => d.stage === st.nextStage + 1)?.burnTime ?? Number.NaN) : Number.NaN,
    flameout: flameout && this.input.state.throttle > 0,
    power: ec && ec.max > 0 ? ec.amount / ec.max : Number.NaN,
    structuralStress: st.telemetry.crossflowStress,
    panelLoad: st.telemetry.deployableLoad,
  }, performance.now() / 1000);
  const warpTo = this.warpDriver.target;
  const settings = game.get().settings;
  const stored = cueStates.get(this);
  const previous = stored?.vessel === st.id ? stored : undefined;
  const signal = !w.commsSettings.enabled || w.connection(st).connected;
  const throttle = this.input.state.throttle > 0.05 && !st.eva ? throttleExplanation(st) : null;
  const staged = !!previous && previous.staged !== this.stagedCount;
  let throttleTracker = throttleTrackers.get(this);
  if (!throttleTracker || !previous) throttleTrackers.set(this, (throttleTracker = new ThrottleCueTracker()));
  const throttleCue = throttleTracker.update(throttle, performance.now() / 1000, staged);
  if (throttleCue) w.message(throttleCue, 'warn');
  if (previous?.signal && !signal) w.message(w.canControl() ? 'Communications lost — crew retains local control' : 'Communications lost — probe commands unavailable; SAS holds attitude', 'warn');
  const torque = this.sasOn && !st.eva ? controlAuthority(st, neutralInput({ rcs: this.rcsOn }), w.universe.createEnvironment(() => wv.body, w.preciseGravity), w.ut) : null;
  const noTorque = !!torque && Math.hypot(torque.x, torque.y, torque.z) < 1e-6;
  if (noTorque && !previous?.sas) w.message('SAS has no torque — enable reaction wheels or RCS; fins need airflow and gimbals need thrust', 'warn', 6);
  const changedBody = !!previous && previous.body !== wv.body;
  if (changedBody) w.message(`Entering ${b.name}'s sphere of influence`);
  const orbit = flying && orb.orbit.e < 1 && orb.pe > Math.max(b.atmosphere?.height ?? 0, w.universe.terrain(wv.body).maxHeight);
  if (previous && !previous.orbit && orbit) w.message(`Orbit achieved around ${b.name}`);
  // An astronaut's every hop would announce a landing.
  if (previous && previous.situation === 'flying' && st.situation !== 'flying' && !st.eva) w.message(st.situation === 'splashed' ? `Splashed down on ${b.name}` : `Landed on ${b.name}`);
  const soi = changedBody || (previous?.soi ?? false);
  cueStates.set(this, { vessel: st.id, body: wv.body, signal, throttle, sas: noTorque, soi, orbit, situation: st.situation, staged: this.stagedCount });
  const propulsionTwr = ((ignited ? currentStage : dvs.find(d => d.thrust > 0))?.thrust ?? 0) / st.mass / gravity;
  const hint = this.hints.update({
    enabled: settings.flightHints && !this.network && !getTutorial() && !game.get().scenarioActive && !this.assist,
    bodyId: b.id, bodyName: b.name, terrainHeight: u.terrain(b.id).maxHeight, boundOrbit: orb.orbit.e < 1, verticalSpeed: vs,
    map: this.mapMode, node: this.mapMode && w.nodes.length > 0, soi, eva: !!st.eva,
    landing: flying && info.heightAboveTerrain < 10000 && vs < -20 && ignited && !st.parts.some(p => p.chute?.phase === 'semi' || p.chute?.phase === 'full'),
    flying,
    altitude: info.altitude,
    surfaceSpeed,
    apoapsis: orb.ap,
    periapsis: orb.pe,
    timeToAp: orb.timeToAp,
    atmosphereHeight: b.atmosphere?.height ?? 0,
    throttle: this.input.state.throttle,
    hasThrust: dvs.some((d) => d.dv > 1),
    twr: propulsionTwr,
    tilt: (Math.acos(Math.max(-1, Math.min(1, upward))) * 180) / Math.PI,
    sasMode: this.sasOn ? this.sas : 'off',
    stress: st.telemetry.crossflowStress,
  });
  const warp = w.warp;
  let burnTracker = burnTrackers.get(this);
  if (!burnTracker) burnTrackers.set(this, (burnTracker = new BurnTracker()));
  const maneuverBurn = burnTracker.update(w, wv, dvs, st.nextStage + 1);
  // Mission elapsed time from liftoff (the first 'launch' record event), like a mission clock.
  const record = w.flightlog.records.find(r => r.vesselId === st.id && !r.outcome);
  const launchEvent = record?.events.find(e => e.kind === 'launch');
  const propulsionStage = ignited ? currentStage : dvs.find(d => d.thrust > 0);
  const suicide = flying && vs < -1 && internals.predictions.impact ? suicideBurn(info.heightAboveTerrain, vs, gravity, (propulsionStage?.thrust ?? 0) / st.mass) : null;
  const met = record?.launched ? Math.max(0, w.ut - record.start - (launchEvent?.time ?? 0)) : null; // event times are record-relative
  // Inclination against the body's equator (the HUD's orbit strip), not the inertial reference plane.
  const h = cross(rs.position, rs.velocity);
  const pole = qRotate(u.ephem.bodyRotation(wv.body, w.ut), v3(0, 0, 1));
  const inclination = length(h) > 0 ? (Math.acos(Math.max(-1, Math.min(1, dot(normalize(h), pole)))) * 180) / Math.PI : 0;
  return {
    maneuverBurn: maneuverBurn && {
      ...maneuverBurn,
      // HUD snapshots are compared field by field: quantize so an idle coast does not re-render React.
      dvRemaining: Math.round(maneuverBurn.dvRemaining * 10) / 10,
      burnStartLead: Number.isFinite(maneuverBurn.burnStartLead) ? Math.round(maneuverBurn.burnStartLead * 10) / 10 : maneuverBurn.burnStartLead,
      burnTime: Number.isFinite(maneuverBurn.burnTime) ? Math.round(maneuverBurn.burnTime * 10) / 10 : maneuverBurn.burnTime,
    },
    engineering: {
      stageDeltaV: propulsionStage?.dv ?? 0,
      twr: (propulsionStage?.thrust ?? 0) / st.mass / gravity,
      burnCountdown: suicide ? (suicide.overdue ? 0 : suicide.countdown) : null,
      impactTime: internals.predictions.impact ? Math.max(0, internals.predictions.impact.time - w.ut) : null,
    },
    met,
    inclination,
    stageLocked: this.stageLocked,
    vesselName: st.name,
    flightData: flightData(w, wv, dvs, internals.predictions),
    crew: w.crewFor(st),
    noControl,
    eva: st.eva ? { fuel: st.parts[0].resources.monopropellant ?? 0, jetpack: this.jetpackOn, canBoard: !!w.boardingTarget(), boardHint: w.boardingBlocker(true), landed: st.situation === 'landed' || st.situation === 'splashed' } : null,
    ut: w.ut,
    bodyName: b.name,
    altitudeAsl: info.altitude,
    altitudeTerrain: info.heightAboveTerrain,
    speedMode: this.speedMode,
    speedAutomatic: this.speedReference.selection === 'auto',
    speed,
    verticalSpeed: vs,
    apoapsis: orb.ap,
    periapsis: orb.pe,
    timeToAp: orb.timeToAp,
    timeToPe: orb.timeToPe,
    throttle: this.input.state.throttle,
    trim: trimReadout(this.input.trim, this.sasOn),
    gForce: st.telemetry.gForce,
    mach: st.telemetry.airDensity > 0 ? st.telemetry.mach : 0,
    dynamicPressure: st.telemetry.dynamicPressure,
    warp: 1,
    warpLabel: warpLabel(warp) + (warp.mode === 'physics' && warp.index > 0 ? ' phys' : ''),
    physicsWarp: warp.mode === 'physics' && warp.index > 0,
    warpMode: warp.mode,
    warpIndex: warp.index,
    warpLimit: railsWarpLimit(w),
    sasOn: this.sasOn,
    sasMode: this.sas,
    rcsOn: this.rcsOn,
    ...ground,
    stage: st.nextStage,
    stages,
    dvAt,
    totalDvVac,
    resources: [...totals.entries()]
      .filter(([id, e]) => e.max > 0 && id !== 'intakeAir')
      .map(([id, e]) => ({ id, name: RESOURCES[id as keyof typeof RESOURCES]?.name ?? id, amount: e.amount, max: e.max, color: RESOURCE_COLORS[id] ?? '#aaa' })),
    messages: flightMessages(w.messages, throttle, staged).map((m) => ({ id: m.id, text: m.text, level: m.level })),
    mapMode: this.mapMode,
    onSurface: wv.mode === 'prelaunch' || st.situation === 'landed' || st.situation === 'splashed',
    assist: this.assist ? { name: this.assist.name, status: this.assist.status } : null,
    target,
    targetOptions: internals.targetOptions(wv),
    dockingMode: this.dockingMode,
    docking: this.dockingMode ? internals.dockingTelemetry() : null,
    dockedPorts: dockedPorts(st).map((p) => ({ uid: p.uid, name: p.def.name })),
    actionGroups: ACTION_GROUP_IDS.filter(g => g === 'abort' || g.startsWith('custom')).map(g => ({
      id: g, label: GROUP_LABELS[g], key: bindingLabel(g === 'abort' ? 'abort' : `actionGroup${g.slice(6)}` as 'actionGroup1'),
      count: groupBindings(st, g).length, on: !!st.groupState?.[g],
    })),
    lights: st.parts.some(p => p.def.modules.some(m => m.type === 'light')) ? st.parts.some(p => p.def.modules.some(m => m.type === 'light') && lightOn(p)) : null,
    feel: {
      alerts,
      cameraMode: this.cam.mode,
      stagedCount: this.stagedCount,
      warpTargets: this.network || this.assist ? [] : warpTargets(w).map((o) => ({ id: o.id, label: o.label, in: o.time - w.ut })),
      warpTo: warpTo ? { label: warpTo.label, remaining: Math.max(0, warpTo.time - w.ut) } : null,
      countdown: this.countdown === null ? null : Math.ceil(this.countdown),
      hint,
    },
  };
}

/** Gear / brakes / intake-air readouts for the HUD (null fields when the vessel has no such hardware). */
export function groundTelemetry(this: FlightController, _internals: FlightControllerInternals, wv: WorldVessel): Pick<Telemetry, 'gear' | 'brakes' | 'intakeAir'> {
  const st = wv.state;
  let gear: Telemetry['gear'] = null;
  let wheels = false;
  for (const p of st.parts) {
    if (p.wheel) {
      wheels = true;
      const g = p.wheel.deploy >= 1 ? 'down' : p.wheel.deploy <= 0 ? 'up' : 'moving';
      gear = gear === null || gear === g ? g : 'moving';
    } else if (p.leg) {
      const g = p.leg.deployed ? 'down' : 'up';
      gear = gear === null || gear === g ? g : 'moving';
    }
  }
  const air = st.telemetry.intakeAirRatio;
  return { gear, brakes: wheels ? this.input.state.brakes : null, intakeAir: Number.isFinite(air) ? air : null };
}

/** Non-zero trim for the HUD (null when centred); `held` = suspended because SAS is on. */
export function trimReadout(trim: { pitch: number; yaw: number; roll: number }, sasOn: boolean): { pitch: number; yaw: number; roll: number; held: boolean } | null {
  if (!trim.pitch && !trim.yaw && !trim.roll) return null;
  return { pitch: trim.pitch, yaw: trim.yaw, roll: trim.roll, held: sasOn };
}

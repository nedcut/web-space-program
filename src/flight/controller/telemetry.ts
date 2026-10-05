import { RESOURCES } from '../../data/resources';
import { flightData, flightPredictions } from '../../game/flightData';
import { cachedStageDeltaV } from '../../game/stageDeltaVCache';
import { warpLabel } from '../../game/timewarp';
import { type WorldVessel } from '../../game/world';
import { dockedPorts, freePorts, type PortInfo, type StageDeltaV } from '../../sim/vessel';
import { qRotate } from '../../util/quat';
import { dot, length, negate, sub, v3 } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { DockingTelemetry, HudStage, Telemetry } from '../hud/Hud';
import type { FlightControllerInternals } from './internals';
const RESOURCE_COLORS: Record<string, string> = {
  liquidFuel: '#ffb35c',
  oxidizer: '#5cc8ff',
  monopropellant: '#d0d0d0',
  solidFuel: '#ff7a5c',
  electricCharge: '#ffe14d',
  xenon: '#b48cff',
  ablator: '#a08060',
};

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
    if (b.id === cur.id) continue;
    if (b.parent === cur.id || b.id === cur.parent || (cur.parent && b.parent === cur.parent)) {
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
  let dvs: StageDeltaV[] = [];
  try {
    dvs = cachedStageDeltaV(st, pressure, b.surfaceGravity);
  } catch {
    dvs = [];
  }
  const stageMap = new Map<number, HudStage>();
  for (const p of st.parts) {
    // Engines that are already burning are listed as the current ("burning") stage so its Δv stays visible.
    const burning = p.activated && !!p.engine?.ignited;
    if (p.stage === undefined || (p.activated && !burning)) continue;
    const types = p.def.modules.map((m) => m.type);
    const icon: HudStage['parts'][number]['icon'] = types.includes('engine') ? 'engine' : types.includes('decoupler') ? 'decoupler' : types.includes('parachute') ? 'chute' : 'other';
    const idx = burning ? st.nextStage + 1 : p.stage;
    const s = stageMap.get(idx) ?? { index: idx, parts: [], deltaV: 0 };
    s.parts.push({ uid: p.uid, name: p.def.name, icon, active: p.activated });
    stageMap.set(idx, s);
  }
  const stages = [...stageMap.values()].sort((a, b2) => b2.index - a.index);
  stages.forEach((s) => {
    const d = dvs.find((x) => x.stage === s.index);
    s.deltaV = d?.dv ?? 0;
  });

  internals.predictions = flightPredictions(w, wv);
  const warp = w.warp;
  return {
    flightData: flightData(w, wv, dvs, internals.predictions),
    crew: w.crewFor(st),
    noControl: !w.canControl(st) || (!!this.network && this.network.ownId !== st.id),
    eva: st.eva ? { fuel: st.parts[0].resources.monopropellant ?? 0, canBoard: !!w.boardingTarget(), landed: st.situation === 'landed' } : null,
    ut: w.ut,
    bodyName: b.name,
    altitudeAsl: info.altitude,
    altitudeTerrain: info.heightAboveTerrain,
    speedMode: this.speedMode,
    speed,
    verticalSpeed: w.verticalSpeed(wv),
    apoapsis: orb.ap,
    periapsis: orb.pe,
    timeToAp: orb.timeToAp,
    timeToPe: orb.timeToPe,
    throttle: this.input.state.throttle,
    gForce: st.telemetry.gForce,
    mach: st.telemetry.airDensity > 0 ? st.telemetry.mach : 0,
    dynamicPressure: st.telemetry.dynamicPressure,
    warp: 1,
    warpLabel: warpLabel(warp) + (warp.mode === 'physics' && warp.index > 0 ? ' phys' : ''),
    physicsWarp: warp.mode === 'physics' && warp.index > 0,
    sasOn: this.sasOn,
    sasMode: this.sas,
    rcsOn: this.rcsOn,
    ...internals.groundTelemetry(wv),
    stage: st.nextStage,
    stages,
    resources: [...totals.entries()]
      .filter(([id, e]) => e.max > 0 && id !== 'intakeAir')
      .map(([id, e]) => ({ id, name: RESOURCES[id as keyof typeof RESOURCES]?.name ?? id, amount: e.amount, max: e.max, color: RESOURCE_COLORS[id] ?? '#aaa' })),
    messages: w.messages.map((m) => ({ id: m.id, text: m.text, level: m.level })),
    mapMode: this.mapMode,
    onSurface: wv.mode === 'prelaunch' || st.situation === 'landed' || st.situation === 'splashed',
    assist: this.assist ? { name: this.assist.name, status: this.assist.status } : null,
    target,
    targetOptions: internals.targetOptions(wv),
    dockingMode: this.dockingMode,
    docking: this.dockingMode ? internals.dockingTelemetry() : null,
    dockedPorts: dockedPorts(st).map((p) => ({ uid: p.uid, name: p.def.name })),
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

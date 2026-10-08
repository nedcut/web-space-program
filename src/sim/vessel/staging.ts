import type { Vec3 } from '../../util/vec3';
import { length, normalize, scale, sub } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import type { DecouplerModule, ResourceId } from './types';
import type { PartState, VesselEvent, VesselState } from './runtime';
import { G0 } from './env';
import { applyImpulse, cloneVessel, decouplerCutChildren, rebuildTopology, recomputeMassProperties, splitVessel } from './assembly';
import { engineModule, igniteEngine, ispAtPressure, isSolidMotor, maxMassFlow, propellantNeed } from './engines';
import { availableResource, drawPropellants, drawResource } from './resources';
import { ejectionScale, thrustLimit } from './tweaks';
import { runActionGroup } from './actions';
import type { DrawLedger } from './resources';

/** Distinct stage numbers not yet activated, in firing order (highest first). */
export function getStages(v: VesselState): number[] {
  const s = new Set<number>();
  for (const p of v.parts) if (p.stage !== undefined && !p.activated) s.add(p.stage);
  return [...s].sort((a, b) => b - a);
}

export function partsInStage(v: VesselState, stage: number): PartState[] {
  return v.parts.filter((p) => p.stage === stage);
}

function findOwner(vessels: VesselState[], uid: number): VesselState | undefined {
  return vessels.find((x) => x.cache.byUid.has(uid));
}

/**
 * Activate a stage: ignite engines, arm parachutes, fire decouplers and fairings. Decoupling splits the
 * vessel (momentum conserved) and applies equal & opposite ejection impulses. Returns new vessels.
 * The part of the vessel containing the root stays in `v`.
 */
export function activateStage(v: VesselState, stage: number, events: VesselEvent[] = []): VesselState[] {
  const parts = v.parts.filter((p) => p.stage === stage && !p.activated);
  const decouplers: number[] = [];
  const fairings: number[] = [];
  for (const p of parts) {
    p.activated = true;
    if (p.engine) igniteEngine(v, p, events);
    if (p.chute && p.chute.phase === 'stowed') {
      p.chute.phase = 'armed';
      events.push({ type: 'chute', vesselId: v.id, partUid: p.uid, phase: 'armed' });
    }
    if (p.def.modules.some((m) => m.type === 'decoupler')) decouplers.push(p.uid);
    if (p.def.modules.some((m) => m.type === 'fairing')) fairings.push(p.uid);
  }
  events.push({ type: 'stage', vesselId: v.id, stage });
  const all: VesselState[] = [v];
  const created: VesselState[] = [];
  for (const duid of decouplers) fireDecoupler(all, duid, events, created);
  for (const fuid of fairings) jettisonFairing(all, fuid, created);
  runActionGroup(v, 'stage', events, all, created);
  return created;
}

/** Fire one decoupler (staging or a part action). `all` holds the vessel and pieces created so far. */
export function fireDecoupler(all: VesselState[], duid: number, events: VesselEvent[], created: VesselState[]): void {
  const owner = findOwner(all, duid);
  if (!owner) return;
  const d = owner.cache.byUid.get(duid)!;
  const mod = d.def.modules.find((m): m is DecouplerModule => m.type === 'decoupler');
  if (!mod) return;
  d.activated = true;
  const cut = decouplerCutChildren(owner, d);
  if (cut.length === 0) return;
  const node = d.def.attachNodes.find((n) => n.id === mod.node);
  const nodePos = node ? qRotate(d.rotation, node.position) : { x: 0, y: 0, z: 0 };
  const point = { x: d.position.x + nodePos.x, y: d.position.y + nodePos.y, z: d.position.z + nodePos.z };
  const nodeDirBody = node ? normalize(qRotate(d.rotation, node.direction)) : null;
  const comBefore = owner.com;
  const impulse = mod.ejectionImpulse * ejectionScale(d);
  const pieces = splitVessel(owner, cut);
  for (const nv of pieces) {
    let dirBody: Vec3;
    if (!mod.radial && nodeDirBody) dirBody = cut.includes(duid) ? scale(nodeDirBody, -1) : nodeDirBody;
    else {
      const diff = sub(nv.com, owner.com);
      dirBody = length(diff) > 1e-9 ? normalize(diff) : normalize(sub(nv.com, comBefore));
    }
    const J = scale(qRotate(owner.orientation, dirBody), impulse / pieces.length);
    applyImpulse(nv, J, point);
    applyImpulse(owner, scale(J, -1), point);
    events.push({ type: 'decouple', vesselId: owner.id, partUid: duid, newVesselId: nv.id });
    cutDetachedEngines(nv);
    all.push(nv);
    created.push(nv);
  }
}

/**
 * A dropped piece loses its throttle command at once: liquid engines shut down instead of spooling down over a
 * second and shoving the spent stage back into the vessel it just left (hot staging). Solid motors burn on.
 */
function cutDetachedEngines(piece: VesselState): void {
  for (const p of piece.parts) {
    const m = engineModule(p);
    if (p.engine && m && !isSolidMotor(m)) p.engine.throttle = 0;
  }
}

/** Jettison one fairing part (never the root). */
export function jettisonFairing(all: VesselState[], fuid: number, created: VesselState[]): void {
  const owner = findOwner(all, fuid);
  if (!owner || fuid === owner.rootUid) return;
  const f = owner.cache.byUid.get(fuid)!;
  const mod = f.def.modules.find((m) => m.type === 'fairing') as { type: 'fairing'; ejectionImpulse: number } | undefined;
  if (!mod) return;
  f.activated = true;
  const point = { ...f.position };
  // The payload rides on the fairing: hand it to the part below before the shell (with its ring) separates.
  if (f.parent !== null && f.children.length) {
    for (const uid of f.children) {
      const child = owner.cache.byUid.get(uid);
      if (!child) continue;
      child.parent = f.parent;
      child.parentNode = f.parentNode === 'srf' || child.attachNode === 'srf' ? 'srf' : f.parentNode;
      if (child.parentNode === 'srf') child.attachNode = 'srf';
    }
    rebuildTopology(owner);
  }
  const pieces = splitVessel(owner, [fuid]);
  for (const nv of pieces) {
    const diff = sub(nv.com, owner.com);
    const dirBody = length(diff) > 1e-9 ? normalize(diff) : { x: 1, y: 0, z: 0 };
    const J = scale(qRotate(owner.orientation, dirBody), mod.ejectionImpulse);
    applyImpulse(nv, J, point);
    applyImpulse(owner, scale(J, -1), point);
    all.push(nv);
    created.push(nv);
  }
}

/** Fire the next stage (highest unactivated stage number). */
export function activateNextStage(v: VesselState, events: VesselEvent[] = []): { newVessels: VesselState[]; events: VesselEvent[] } {
  if (v.nextStage < 0) return { newVessels: [], events };
  const s = v.nextStage;
  const newVessels = activateStage(v, s, events);
  let next = -1;
  for (const p of v.parts) if (p.stage !== undefined && !p.activated) next = Math.max(next, p.stage);
  v.nextStage = next;
  return { newVessels, events };
}

export interface StageDeltaV {
  /** Stage number (the stage fired to start this burn; nextStage+1 for engines already burning). */
  stage: number;
  /** Delta-v in vacuum, at 1 atm, and at the requested pressure, m/s. */
  dvVac: number;
  dvAsl: number;
  dv: number;
  /** Full-throttle burn time, s. */
  burnTime: number;
  startMass: number;
  endMass: number;
  /** Initial thrust (vac / asl / requested pressure), N. */
  thrustVac: number;
  thrustAsl: number;
  thrust: number;
  /** Lowest steady vacuum thrust at the start of the stage: every engine at its minimum throttle (solids at full), N. */
  minThrustVac: number;
  /** Thrust-to-weight at the requested pressure and gravity, at start and end of the stage. */
  twrStart: number;
  twrEnd: number;
  /** Effective Isp at requested pressure (dv / (g0 ln(m0/m1))), s. */
  isp: number;
}

function burnSimulation(sim: VesselState, stage: number, pressure: number, gravity: number): StageDeltaV {
  const startMass = sim.mass;
  const r: StageDeltaV = {
    stage, dvVac: 0, dvAsl: 0, dv: 0, burnTime: 0, startMass, endMass: startMass,
    thrustVac: 0, thrustAsl: 0, thrust: 0, minThrustVac: 0, twrStart: 0, twrEnd: 0, isp: 0,
  };
  let first = true;
  let lastThrust = 0;
  for (let iter = 0; iter < 1000; iter++) {
    const active: PartState[] = [];
    for (const p of sim.parts) {
      const m = engineModule(p);
      if (!p.engine || !m || !p.engine.ignited) continue;
      let ok = Object.keys(m.propellants).length > 0;
      for (const k in m.propellants) if ((m.propellants[k as ResourceId] ?? 0) > 0 && availableResource(sim, p.uid, k as ResourceId) <= 0) ok = false;
      if (ok) active.push(p);
      else {
        p.engine.ignited = false;
        p.engine.flamedOut = true;
      }
    }
    if (active.length === 0) break;
    const eps = 1e-6;
    const ledgers = new Map<ResourceId, DrawLedger>();
    let mdot = 0, fVac = 0, fAsl = 0, fP = 0, fMin = 0;
    for (const p of active) {
      const m = engineModule(p)!;
      const md = maxMassFlow(m) * thrustLimit(p);
      mdot += md;
      fVac += md * m.ispVac * G0;
      fMin += md * m.ispVac * G0 * (m.throttleable && !isSolidMotor(m) ? m.minThrottle : 1);
      fAsl += md * ispAtPressure(m, 101325) * G0;
      fP += md * ispAtPressure(m, pressure) * G0;
      const need = propellantNeed(m, sim.resourceDefs, md);
      for (const k in need) {
        const res = k as ResourceId;
        if (!ledgers.has(res)) ledgers.set(res, new Map());
        drawResource(sim, p.uid, res, (need[res] ?? 0) * eps, ledgers.get(res));
      }
    }
    let tEvt = Infinity;
    for (const [res, led] of ledgers)
      for (const [uid, units] of led) {
        const rate = units / eps;
        if (rate > 0) tEvt = Math.min(tEvt, (sim.cache.byUid.get(uid)?.resources[res] ?? 0) / rate);
      }
    if (!isFinite(tEvt) || mdot <= 0) break;
    const m0 = sim.mass;
    for (const p of active) drawPropellants(sim, p.uid, propellantNeed(engineModule(p)!, sim.resourceDefs, maxMassFlow(engineModule(p)!) * thrustLimit(p) * tEvt));
    recomputeMassProperties(sim, false);
    const m1 = sim.mass;
    if (first) {
      r.thrustVac = fVac;
      r.thrustAsl = fAsl;
      r.thrust = fP;
      r.minThrustVac = fMin;
      r.twrStart = fP / (startMass * gravity);
      first = false;
    }
    if (m1 < m0) {
      const lr = Math.log(m0 / m1);
      r.dvVac += (fVac / mdot) * lr;
      r.dvAsl += (fAsl / mdot) * lr;
      r.dv += (fP / mdot) * lr;
    }
    r.burnTime += tEvt;
    lastThrust = fP;
    if (tEvt <= 0 && iter > 10) break;
  }
  r.endMass = sim.mass;
  r.twrEnd = r.endMass > 0 ? lastThrust / (r.endMass * gravity) : 0;
  r.isp = r.endMass < startMass ? r.dv / (G0 * Math.log(startMass / r.endMass)) : 0;
  return r;
}

/**
 * KSP-style per-stage delta-v readout. Simulates the remaining staging sequence on a copy of the vessel
 * at full throttle (mass flow is pressure independent, so one pass yields vac/ASL/at-pressure values).
 */
export function computeStageDeltaV(v: VesselState, pressure = 0, gravity = G0): StageDeltaV[] {
  const sim = cloneVessel(v);
  for (const p of sim.parts) if (p.engine && p.engine.ignited && engineModule(p) && isSolidMotor(engineModule(p)!)) p.engine.throttle = 1;
  const out: StageDeltaV[] = [];
  if (sim.parts.some((p) => p.engine?.ignited)) out.push(burnSimulation(sim, sim.nextStage + 1, pressure, gravity));
  let guard = 0;
  while (sim.nextStage >= 0 && guard++ < 200) {
    const s = sim.nextStage;
    activateNextStage(sim);
    out.push(burnSimulation(sim, s, pressure, gravity));
  }
  return out;
}

/**
 * Interplanetary legs for headless career playthroughs: wait for a ground station pass, plan the transfer window with
 * the map planner, fly the departure and the planner's course corrections, then capture, survey or dive in.
 * Probes only act while a ground station hears them (or on nodes uploaded while it did), exactly as in flight.
 */
import type { World } from '../../src/game/world';
import { coastUntil, executeNode, localFrame, planTransferToBody, runAutopilot } from '../../src/game/autopilot';
import { planCourseCorrectionToBody, type InterplanetaryPlan } from '../../src/game/interplanetary';
import { computeStageDeltaV, neutralInput } from '../../src/sim/vessel';
import { inertialDvToManeuver, period, periapsisRadius, propagate, stateToElements, timeToPeriapsis } from '../../src/sim/orbit';
import { length, normalize } from '../../src/util/vec3';
import { doScience, trackBiome, transmitAll } from './flights';

export const dvLeft = (w: World) => computeStageDeltaV(w.active!.state, 0, 9.81).reduce((a, s) => a + s.dvVac, 0);
const debug = (s: string) => { if (process.env.CAREER_DEBUG) console.log(`  [${(performance.now() / 1000).toFixed(0)} s] ${s}`); };

/** Coast on rails until a ground station hears the active vessel; false when none does within `max` seconds. */
export function awaitContact(w: World, max = 2 * 86400): boolean {
  for (let k = 0; k < max / 60 && !w.canControl(); k++) coastUntil(w, w.ut + 60);
  return w.canControl();
}

export interface Leg { departure: number; arrival: number; dv: number; trims: number; trimDv: number; contact: boolean }

/** A transfer the probe has been given: the departure option and what the course corrections aim for. */
export interface Departure { target: string; time: number; periapsis: number; arrivalTime: number; encounter: number }

/**
 * In a parking orbit, during a station pass: plan the transfer to `target` with the map planner. From its options
 * list a player takes the earliest departure the craft can pay for: departure plus an elliptical capture (about half
 * the listed circular one), else departure alone (a flyby); the planner's own pick can be dearer than the craft
 * (a 7.8 km/s "go now" for a 4.6 km/s Real probe). `departure` re-plans a chosen option. Leaves one node.
 */
export function planDeparture(w: World, target: string, periapsis?: number, departure?: number): Departure | string {
  if (!awaitContact(w)) return 'no ground contact in parking orbit';
  for (const n of [...w.nodes]) w.removeNode(n.id);
  const opts = { ...(periapsis === undefined ? {} : { periapsisAltitude: periapsis }), ...(departure === undefined ? {} : { departure }) };
  let plan = planTransferToBody(w, target, opts);
  if (!plan) return `no ${target} transfer found`;
  if (departure === undefined) {
    const budget = dvLeft(w) * 0.9, options = [...(plan.windows ?? [])].sort((a, b) => a.departure - b.departure);
    const pick = options.find(o => o.dv + 0.5 * (o.captureDv ?? 0) <= budget) ?? options.filter(o => o.dv <= budget).sort((a, b) => a.dv - b.dv)[0];
    if (!pick && plan.dv > budget) return `the ${target} transfer needs ${plan.dv.toFixed(0)} m/s, ${dvLeft(w).toFixed(0)} aboard`;
    if (pick && Math.abs(pick.departure - plan.node.time) > 86400) {
      w.removeNode(plan.node.id);
      debug(`option in ${((pick.departure - w.ut) / 86400).toFixed(0)} d instead: ${pick.dv.toFixed(0)} + ${(pick.captureDv ?? 0).toFixed(0)} m/s`);
      plan = planTransferToBody(w, target, { ...opts, departure: pick.departure }) ?? planTransferToBody(w, target, opts);
      if (!plan) return `no ${target} transfer found`;
    }
  }
  debug(`${target} window in ${((plan.node.time - w.ut) / 86400).toFixed(1)} d, ${plan.dv.toFixed(0)} m/s, arrival pe ${(plan.periapsisAltitude / 1000).toFixed(0)} km, Δv aboard ${dvLeft(w).toFixed(0)}`);
  return { target, time: plan.node.time, periapsis: plan.periapsisAltitude, arrivalTime: (plan as InterplanetaryPlan).arrivalTime ?? plan.encounterTime, encounter: plan.encounterTime };
}

/** Fly the planned departure node, then coast out of the home sphere of influence. Returns Δv used or an error. */
export function depart(w: World, minStage = 0): number | string {
  const node = w.nodes[0];
  if (!node) return 'no departure node';
  const burn = executeNode(w, node, { minStage });
  if (!runAutopilot(w, burn, { maxTime: node.time - w.ut + 1e5 })) return `departure: ${burn.error}`;
  debug(`departed: ${burn.dvUsed().toFixed(0)} m/s (${burn.status}), e ${w.orbitOf(w.active!).e.toFixed(3)}, Δv left ${dvLeft(w).toFixed(0)}`);
  return burn.dvUsed();
}

/** The map planner's heliocentric course correction, planned now (it must be uploaded) for `time`; Δv flown. */
export function correct(w: World, d: Departure, time: number, minStage = 0): number | string {
  if (w.active!.body !== w.universe.sunId) return 0;
  if (!w.canControl()) { debug('trim: no contact'); return 'no contact'; }
  const trim = planCourseCorrectionToBody(w, d.target, { time, arrivalTime: d.arrivalTime, periapsisAltitude: d.periapsis, maxDv: 500 });
  if (!trim) { debug('trim: none needed/found'); return 0; }
  const t = executeNode(w, trim.node, { minStage });
  if (!runAutopilot(w, t, { maxTime: trim.node.time - w.ut + 1e5 })) return `course correction: ${t.error}`;
  debug(`trim: ${t.dvUsed().toFixed(1)} m/s (planned ${trim.dv.toFixed(1)}), periapsis ${(trim.periapsisAltitude / 1000).toFixed(0)} km`);
  d.encounter = trim.encounterTime;
  return t.dvUsed();
}

/** Coast into the target's sphere of influence and run the instruments. */
export function arrive(w: World, biomes: Set<string>, d: Departure): string | null {
  coastUntil(w, d.encounter + 600, { stopOnSoi: true });
  if (w.active!.body !== d.target) return `missed ${d.target} (in ${w.active!.body})`;
  doScience(w); trackBiome(w, biomes);
  debug(`arrived ${d.target}: pe ${(w.orbitSummary(w.active!).pe / 1000).toFixed(0)} km, contact ${w.canControl()}, Δv left ${dvLeft(w).toFixed(0)}`);
  return null;
}

/** Whole leg for one probe flown alone: plan, depart, three course corrections, arrival. */
export function toPlanet(w: World, biomes: Set<string>, target: string, minStage = 0, periapsis?: number): { err: string | null; leg?: Leg } {
  const d = planDeparture(w, target, periapsis);
  if (typeof d === 'string') return { err: d };
  const dv = depart(w, minStage);
  if (typeof dv === 'string') return { err: dv };
  coastUntil(w, w.ut + 120 * 86400, { stopOnSoi: true });
  let trims = 0, trimDv = 0;
  for (const fraction of [0.05, 0.6, 0.9]) {
    const used = correct(w, d, w.ut + (d.encounter - w.ut) * fraction, minStage);
    if (typeof used === 'number') { trimDv += used; trims += used > 0 ? 1 : 0; } else if (used !== 'no contact') return { err: used };
  }
  const err = arrive(w, biomes, d);
  if (err) return { err };
  return { err: null, leg: { departure: d.time, arrival: w.ut, dv, trims, trimDv, contact: w.canControl() } };
}

/** Flyby: coast through periapsis running the instruments in each new situation, transmitting while in contact. */
export function flyby(w: World, biomes: Set<string>): number {
  const before = w.progression.science, o = w.orbitOf(w.active!), tPe = w.ut + timeToPeriapsis(o, w.ut);
  if (!(tPe > w.ut)) return 0;
  // Sample the inbound leg ever closer to periapsis (situations change near the planet), then the outbound leg.
  for (const f of [0.5, 0.8, 0.95, 0.99, 1]) {
    coastUntil(w, w.ut + (tPe - w.ut) * f, { stopOnSoi: true });
    if (w.active!.body !== o.body) break;
    trackBiome(w, biomes);
    if (doScience(w)) transmitAll(w);
  }
  transmitAll(w);
  return w.progression.science - before;
}

/** Move the arrival periapsis to `altitude` with a burn along the horizontal velocity ten minutes from now (bisection). */
export function setArrivalPeriapsis(w: World, altitude: number, minStage = 0): string | null {
  const o = w.orbitOf(w.active!), t = w.ut + 600, s = propagate(o, t), R = w.universe.body(o.body).radius;
  // The periapsis follows the angular momentum: push along (or against) the velocity's horizontal part.
  const r = normalize(s.position), radial = s.velocity.x * r.x + s.velocity.y * r.y + s.velocity.z * r.z;
  const h = normalize({ x: s.velocity.x - radial * r.x, y: s.velocity.y - radial * r.y, z: s.velocity.z - radial * r.z });
  const peWith = (x: number) => periapsisRadius(stateToElements(o.mu, o.body, s.position, { x: s.velocity.x + h.x * x, y: s.velocity.y + h.y * x, z: s.velocity.z + h.z * x }, t)) - R;
  const want = Math.sign(altitude - peWith(0)) || 1;
  let lo = 0, hi = 5 * want;
  while (Math.sign(altitude - peWith(hi)) === want && Math.abs(hi) < 2000) hi *= 2;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (Math.sign(altitude - peWith(m)) === want) lo = m; else hi = m; }
  const node = w.addNode(t);
  const c = inertialDvToManeuver(s, { x: h.x * hi, y: h.y * hi, z: h.z * hi });
  node.prograde = c.prograde; node.normal = c.normal; node.radial = c.radial;
  const burn = executeNode(w, node, { minStage, matchEnergy: false });
  if (!runAutopilot(w, burn, { maxTime: 1e5 })) return `periapsis change: ${burn.error}`;
  debug(`periapsis → ${(w.orbitSummary(w.active!).pe / 1000).toFixed(0)} km (${Math.abs(hi).toFixed(1)} m/s)`);
  return null;
}

/**
 * Capture at the next periapsis into an orbit with apoapsis `apoapsis` (m above the datum; at most 60 % of the
 * sphere of influence). When the stages aboard cannot pay for it, the highest apoapsis they can, if any.
 */
export function capture(w: World, biomes: Set<string>, apoapsis: number, minStage = 0): { err: string | null; dv: number } {
  const o = w.orbitOf(w.active!), body = w.universe.body(o.body);
  const t = w.ut + timeToPeriapsis(o, w.ut), s = propagate(o, t), rp = length(s.position), v = length(s.velocity);
  const dvTo = (ra: number) => v - Math.sqrt(o.mu * (2 / rp - 2 / (rp + ra)));
  const have = dvLeft(w) * 0.95;
  let ra = Math.max(rp, body.radius + apoapsis);
  const top = body.radius + Math.min(body.soi * 0.6, 1e12) ;
  if (dvTo(ra) > have) {
    if (dvTo(top) > have) return { err: `capture needs ${dvTo(top).toFixed(0)} m/s, ${dvLeft(w).toFixed(0)} aboard`, dv: 0 };
    let lo = ra, hi = top;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (dvTo(m) > have) lo = m; else hi = m; }
    ra = hi;
  }
  const node = w.addNode(t);
  node.prograde = -dvTo(ra);
  const burn = executeNode(w, node, { minStage, matchEnergy: false });
  if (!runAutopilot(w, burn, { maxTime: t - w.ut + 1e5 })) return { err: `capture: ${burn.error}`, dv: 0 };
  doScience(w); trackBiome(w, biomes);
  debug(`captured: pe ${(w.orbitSummary(w.active!).pe / 1000).toFixed(0)} km ap ${(w.orbitSummary(w.active!).ap / 1000).toFixed(0)} km, Δv left ${dvLeft(w).toFixed(0)}`);
  return { err: null, dv: burn.dvUsed() };
}

/** Stay `orbits` orbits (at most `maxDays`), running every instrument over each new region and transmitting. */
export function survey(w: World, biomes: Set<string>, orbits: number, maxDays = 30): number {
  const before = w.progression.science;
  const T = Math.min(period(w.orbitOf(w.active!)), maxDays * 86400 / orbits), step = T / 24;
  for (let k = 0; k < orbits * 24; k++) {
    coastUntil(w, w.ut + step);
    if (w.active!.body !== w.orbitOf(w.active!).body) break;
    trackBiome(w, biomes);
    if (doScience(w)) transmitAll(w);
  }
  transmitAll(w);
  return w.progression.science - before;
}

/**
 * Dive into the atmosphere ahead (Cinderbloom): drop the cruise stage at the interface, hold surface retrograde
 * shield-first, release the shield below `shieldSpeed`, fall to the surface and run the instruments there.
 */
export function atmosphericLanding(w: World, biomes: Set<string>, shieldSpeed = 300): string | null {
  const wv = w.active!, body = w.universe.body(wv.body), top = body.atmosphere!.height;
  const o = w.orbitOf(wv);
  let t = w.ut;
  while (length(propagate(o, t).position) - body.radius > top * 1.02 && t < w.ut + 3e6) t += 10;
  coastUntil(w, t - 30);
  // Everything above the shield goes: the cruise stage is not rated for the heat or the pressure.
  for (let i = 0; i < 8 && w.active && w.active.state.nextStage > 0; i++) w.stageActive();
  let dropped = false;
  for (let i = 0; i < 400000 && w.active && !w.active.state.destroyed; i++) {
    const s = w.active.state;
    if (s.situation === 'landed' || s.situation === 'splashed') break;
    const speed = length(w.surfaceVelocity(w.active));
    const stage: boolean = !dropped && localFrame(w, w.active).altitude < top && speed < shieldSpeed;
    dropped ||= stage;
    w.warp = { mode: 'rails', index: 0 };
    w.tick(0.1, neutralInput({ stage, sas: 'retrograde', sasReference: 'surface' }));
    if (i % 20 === 0) { doScience(w); trackBiome(w, biomes); }
  }
  if (!w.active || w.active.state.destroyed) return 'lost on entry';
  if (w.active.state.situation !== 'landed') return 'not landed';
  doScience(w); trackBiome(w, biomes);
  transmitAll(w, 3600);
  return null;
}

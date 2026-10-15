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

/** Departure at the planner's window, course corrections on the way, arrival in `target`'s sphere of influence. */
export function toPlanet(w: World, biomes: Set<string>, target: string, minStage = 0, periapsis?: number): { err: string | null; leg?: Leg } {
  if (!awaitContact(w)) return { err: 'no ground contact in parking orbit' };
  debug(`contact; planning ${target}`);
  const plan = planTransferToBody(w, target, periapsis === undefined ? {} : { periapsisAltitude: periapsis });
  if (!plan) return { err: `no ${target} transfer found` };
  const pe = plan.periapsisAltitude, departure = plan.node.time;
  debug(`${target} window in ${((plan.node.time - w.ut) / 86400).toFixed(1)} d, ${plan.dv.toFixed(0)} m/s, arrival pe ${(pe / 1000).toFixed(0)} km, Δv aboard ${dvLeft(w).toFixed(0)}`);
  const burn = executeNode(w, plan.node, { minStage });
  if (!runAutopilot(w, burn, { maxTime: plan.node.time - w.ut + 1e5 })) return { err: `departure: ${burn.error}` };
  const dv = burn.dvUsed();
  debug(`departed: ${dv.toFixed(0)} m/s (${burn.status}), e ${w.orbitOf(w.active!).e.toFixed(3)} ap ${(w.orbitSummary(w.active!).ap / 1000).toFixed(0)} km, Δv left ${dvLeft(w).toFixed(0)}`);
  coastUntil(w, w.ut + 120 * 86400, { stopOnSoi: true });
  // The map planner's heliocentric correction (Lambert to the planet at the planned arrival, then refined).
  const arrivalTime = (plan as InterplanetaryPlan).arrivalTime ?? plan.encounterTime;
  let encounter = plan.encounterTime, trims = 0, trimDv = 0;
  for (const fraction of [0.05, 0.6, 0.9]) {
    // A correction is planned now and uploaded now: out of contact the probe cannot receive it.
    if (!w.canControl()) { debug(`trim ${fraction}: no contact`); continue; }
    if (w.active!.body !== w.universe.sunId) break;
    const trim = planCourseCorrectionToBody(w, target, { time: w.ut + (encounter - w.ut) * fraction, arrivalTime, periapsisAltitude: pe, maxDv: 500 });
    if (!trim) { debug(`trim ${fraction}: none needed/found`); continue; }
    const t = executeNode(w, trim.node, { minStage });
    if (!runAutopilot(w, t, { maxTime: trim.node.time - w.ut + 1e5 })) return { err: `course correction: ${t.error}` };
    trims++; trimDv += t.dvUsed();
    debug(`trim ${fraction}: ${t.dvUsed().toFixed(1)} m/s (planned ${trim.dv.toFixed(1)}), periapsis ${(trim.periapsisAltitude / 1000).toFixed(0)} km`);
    encounter = trim.encounterTime;
  }
  coastUntil(w, encounter + 600, { stopOnSoi: true });
  if (w.active!.body !== target) return { err: `missed ${target} (in ${w.active!.body})` };
  doScience(w); trackBiome(w, biomes);
  const contact = w.canControl();
  debug(`arrived ${target} day pe ${(w.orbitSummary(w.active!).pe / 1000).toFixed(0)} km contact ${contact} Δv left ${dvLeft(w).toFixed(0)}`);
  return { err: null, leg: { departure, arrival: w.ut, dv, trims, trimDv, contact } };
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
    const stage = !dropped && localFrame(w, w.active).altitude < top && speed < shieldSpeed;
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

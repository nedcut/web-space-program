/**
 * Player-like flight helpers for headless career playthroughs: every flight goes through the real World,
 * the same autopilot building blocks the in-game assists use, and the real science/contract/recovery code.
 */
import { World } from '../../src/game/world';
import { PART_CATALOG } from '../../src/data/parts';
import { launchCost, launchProblem } from '../../src/data/technology';
import { neutralInput } from '../../src/sim/vessel';
import { inertialDvToManeuver, period, periapsisRadius, propagate, stateToElements } from '../../src/sim/orbit';
import type { CraftDef } from '../../src/sim/vessel/types';
import {
  ascentGuidance, coastUntil, planFreeReturn, executeNode, landingController, localFrame, planCircularization, planCourseCorrection,
  planPeriapsisChange, planTransferToBody, propulsion, runAutopilot, type Autopilot,
} from '../../src/game/autopilot';
import { length, normalize, scale } from '../../src/util/vec3';
import { arrivalPeriapsisAltitude } from '../../src/game/planning/arrival';
import { enteringDragPerMass, planEntryTrim, type EntryTrimPlan } from '../../src/game/planning/entry';

export const sensor = (craft: CraftDef, partId = 'sensor-thermal', k = 0): CraftDef => {
  craft.parts.push({ uid: 1000 + k, partId, parent: craft.parts[0].uid, attachNode: 'srf', position: { x: 0.7, y: k * 0.2, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
  return craft;
};

/** Run every available, not yet stored experiment aboard (what a diligent player clicks). */
export function doScience(w: World): number {
  let n = 0;
  for (const i of w.scienceInstruments()) {
    if (!i.available || i.recorded) continue;
    if (w.runExperiment(i.uid, i.experiment)) n++;
  }
  return n;
}

export interface FlightResult { ok: boolean; note: string; cost: number; biomes: Set<string> }

/** Buy and put a craft on the pad; null with the blocker when the program cannot. */
export function buy(w: World, craft: CraftDef): { cost: number; problem: string | null } {
  const problem = launchProblem(craft, PART_CATALOG, 'career', w.progression, w.universe.preset);
  if (problem) return { cost: 0, problem };
  const cost = launchCost(craft, PART_CATALOG);
  w.launch(craft);
  return { cost, problem: null };
}

let ticks = 0;
const tick = () => ticks++;

export function trackBiome(w: World, biomes: Set<string>) {
  const c = w.scienceContext();
  if (c) biomes.add(`${c.body}/${c.situation}/${c.biome}`);
}

/** Drive physics with a per-step input until `until` returns true or the time cap. Runs science every ~0.5 s. */
function fly(w: World, maxTime: number, input: (w: World) => ReturnType<typeof neutralInput>, until: (w: World) => boolean, biomes: Set<string>) {
  const end = w.ut + maxTime;
  let k = 0;
  while (w.ut < end && w.active && !w.active.state.destroyed) {
    if (until(w)) return true;
    if (process.env.CAREER_DEBUG && k % 500 === 0) { const f = localFrame(w, w.active); console.log(`  t=${w.ut.toFixed(0)} alt=${f.altitude.toFixed(0)} v=${length(f.surfVel).toFixed(0)} sit=${w.active.state.situation} stage=${w.active.state.nextStage} thrust=${propulsion(w.active.state).thrust.toFixed(0)}`); }
    w.warp = { mode: 'rails', index: 0 };
    w.tick(0.02, input(w));
    if (k++ % 25 === 0) { doScience(w); trackBiome(w, biomes); }
  }
  return !!w.active && until(w);
}

/** Fire every remaining stage (decouplers, chutes) above the capsule. */
function stageAll(w: World) {
  for (let i = 0; i < 8 && w.active && w.active.state.nextStage >= 0; i++) w.stageActive();
}

/** Rails-warp to the next atmosphere entry (after a skip-out or from orbit). */
function coastToEntry(w: World) {
  const wv = w.active!, body = w.universe.body(wv.body), top = (body.atmosphere?.height ?? 0) * 1.02;
  const orbit = w.orbitOf(wv);
  let t = w.ut;
  while (length(propagate(orbit, t).position) - body.radius > top && t < w.ut + 3e6) t += 5;
  coastUntil(w, t);
}

/** Hold retrograde (surface) and fall to the ground or sea; stages everything once descending in air. Skips warp. */
export function descend(w: World, biomes: Set<string>, maxTime = 4000, sas = true): boolean {
  const atmo = w.universe.body(w.active!.body).atmosphere?.height ?? 0;
  let staged = false;
  const down = (w: World) => {
    const s = w.active!.state;
    return (s.situation === 'landed' || s.situation === 'splashed') && length(localFrame(w, w.active!).surfVel) < 0.5;
  };
  for (let pass = 0; pass < 4 && w.active; pass++) {
    const ok = fly(w, maxTime, (w) => {
      const f = localFrame(w, w.active!);
      if (!staged && f.altitude < atmo && length(f.surfVel) > 1) { stageAll(w); staged = true; }
      const v = length(f.surfVel) > 1 ? normalize(f.surfVel) : f.up;
      return sas ? neutralInput({ sas: 'maneuver', maneuverDirection: scale(v, -1), throttle: 0 }) : neutralInput({ throttle: 0 });
    }, (w) => down(w) || (staged && localFrame(w, w.active!).altitude > atmo * 1.05 && dotUp(w) > 0), biomes);
    if (!w.active) return false;
    if (down(w)) return true;
    if (!ok) return false;
    coastToEntry(w);
  }
  return !!w.active && down(w);
}

/**
 * Sounding hop: full throttle until burnout or until the apoapsis reaches `cutoff` (the coast hint's advice),
 * pitching over `pitch` degrees east once moving; coast, descend under chute, science throughout.
 */
export function hop(w: World, craft: CraftDef, opts: { cutoff?: number; pitch?: number; sas?: boolean } = {}): FlightResult {
  const biomes = new Set<string>();
  const { cost, problem } = buy(w, craft);
  if (problem) return { ok: false, note: problem, cost, biomes };
  doScience(w); trackBiome(w, biomes);
  let lit = false;
  const pitch = (opts.pitch ?? 0) * Math.PI / 180;
  fly(w, 600, (w) => {
    const f = localFrame(w, w.active!);
    const stage = !lit; lit = true;
    const tilt = length(f.surfVel) > 60 ? pitch : 0;
    const dir = normalize({ x: f.up.x * Math.cos(tilt) + f.east.x * Math.sin(tilt), y: f.up.y * Math.cos(tilt) + f.east.y * Math.sin(tilt), z: f.up.z * Math.cos(tilt) + f.east.z * Math.sin(tilt) });
    return neutralInput({ sas: 'maneuver', maneuverDirection: dir, throttle: 1, stage });
  }, (w) => lit && w.active!.mode !== 'prelaunch' && (propulsion(w.active!.state).thrust === 0
    || (opts.cutoff !== undefined && w.orbitSummary(w.active!).ap > opts.cutoff)), biomes);
  // Coast to apex then fall.
  fly(w, 3000, () => neutralInput({ sas: 'stabilityAssist', throttle: 0 }), (w) => {
    const f = localFrame(w, w.active!);
    return f.altitude < (w.universe.body('earth').atmosphere!.height) && length(f.surfVel) > 50 && dotUp(w) < 0;
  }, biomes);
  const down = descend(w, biomes, 4000, opts.sas ?? true);
  if (!down || !w.active) return { ok: false, note: 'lost on descent', cost, biomes };
  doScience(w); trackBiome(w, biomes);
  w.recoverActive();
  return { ok: true, note: `biomes ${[...biomes].join(', ')}`, cost, biomes };
}

const dotUp = (w: World) => { const f = localFrame(w, w.active!); return f.surfVel.x * f.up.x + f.surfVel.y * f.up.y + f.surfVel.z * f.up.z; };

/** Gravity-turn ascent and circularisation into a low parking orbit. */
export function toOrbit(w: World, biomes: Set<string>, apoapsis: number, minStage = 0): string | null {
  const science = (ap: Autopilot, t: number) => runAutopilot(w, ap, { maxTime: t, onTick: (w) => { if (tick() % 25 === 0) { doScience(w); trackBiome(w, biomes); } } });
  const asc = ascentGuidance(w, { targetApoapsis: apoapsis, minStage });
  // Plan the circularisation as soon as the engines cut (a probe still has the launch site's signal then, so its
  // flight computer gets the node; at apoapsis it is usually out of contact).
  let planned: ReturnType<typeof planCircularization> | null = null;
  const probe = !w.active!.state.parts.some(p => p.crew?.length);
  const ok = runAutopilot(w, asc, { maxTime: 1200, onTick: (w) => {
    if (tick() % 25 === 0) { doScience(w); trackBiome(w, biomes); }
    if (!planned && probe && asc.status === 'coast' && !w.nodes.length) planned = planCircularization(w, 'apoapsis');
  } });
  if (!ok) return `ascent: ${asc.error}`;
  const circ = executeNode(w, planned && w.nodes.includes(planned) ? planned : planCircularization(w, 'apoapsis'), { minStage });
  if (!science(circ, 3000)) return `circularise: ${circ.error}`;
  doScience(w); trackBiome(w, biomes);
  return null;
}

/** Deorbit from Earth orbit, coast to the entry interface, re-enter and recover. */
export function deorbitAndRecover(w: World, biomes: Set<string>): string | null {
  const wv = w.active!;
  const earth = w.universe.body('earth');
  if (wv.body !== 'earth') return 'not at Earth';
  const o0 = w.orbitSummary(wv);
  if (o0.pe > earth.atmosphere!.height * 0.5) {
    if (propulsion(wv.state).thrust === 0 && wv.state.nextStage >= 0 && !hasFuelLeft(w)) return 'no fuel to deorbit';
    const burn = executeNode(w, planPeriapsisChange(w, earth.atmosphere!.height * 0.35), {});
    if (!runAutopilot(w, burn, { maxTime: 1e5 })) return `deorbit: ${burn.error}`;
  }
  const orbit = w.orbitOf(wv);
  let entry = w.ut;
  while (length(propagate(orbit, entry).position) - earth.radius > earth.atmosphere!.height * 1.05 && entry < w.ut + 3e6) entry += 5;
  coastUntil(w, entry);
  doScience(w); trackBiome(w, biomes);
  if (!descend(w, biomes, 8000) || !w.active) return 'lost on re-entry';
  doScience(w); trackBiome(w, biomes);
  w.recoverActive();
  return null;
}

function hasFuelLeft(w: World) {
  return w.active!.state.parts.some(p => (p.resources.liquidFuel ?? 0) > 1);
}

/** Earth parking orbit → transfer to the Moon (with a course correction) → into its SOI. */
export function toMoon(w: World, biomes: Set<string>, minStage = 0, periapsis = 30000): string | null {
  // A probe flies only nodes it received while in contact: plan during a station pass.
  for (let k = 0; k < 4320 && !w.canControl(); k++) coastUntil(w, w.ut + 60);
  let plan = planTransferToBody(w, 'moon', { periapsisAltitude: periapsis });
  if (!plan) return 'no Moon transfer found';
  coastUntil(w, w.ut + 1);
  // Still not uploaded (contact lost before the node was sent): plan a later one at the next pass.
  for (let k = 0; k < 8 && !w.uploadedNode(plan.node.id) && !w.canControl(); k++) {
    coastUntil(w, plan.node.time - 900);
    if (w.uploadedNode(plan.node.id) || w.canControl()) break;
    w.removeNode(plan.node.id);
    plan = planTransferToBody(w, 'moon', { periapsisAltitude: periapsis, earliest: w.ut + 1200 });
    if (!plan) return 'no Moon transfer found';
  }
  if (process.env.CAREER_DEBUG) console.log('TLI node in', plan.node.time - w.ut, 'uploaded', w.uploadedNode(plan.node.id), 'connected', w.canControl());
  const tli = executeNode(w, plan.node, { minStage });
  if (!runAutopilot(w, tli, { maxTime: 2e6, onTick: (w) => { if (process.env.CAREER_DEBUG && tick() % 500 === 0) console.log('  TLI', tli.status, 'conn', w.canControl(), 'up', w.uploadedNode(plan!.node.id), 'warp', JSON.stringify(w.warp), 'physics', [...w.vessels.values()].filter(v => v.mode === 'physics').map(v => `${v.state.name}:${v.state.situation}`).join(',')); } })) return `TLI: ${tli.error}`;
  const mcc = planCourseCorrection(w, 'moon', periapsis, w.ut + 1800);
  if (mcc) { const m = executeNode(w, mcc.node, { minStage }); runAutopilot(w, m, { maxTime: 1e5 }); }
  coastUntil(w, (mcc ?? plan).encounterTime + 600, { stopOnSoi: true });
  doScience(w); trackBiome(w, biomes);
  return w.active!.body === 'moon' ? null : 'missed the Moon';
}

/** A player's trim on the way home: drag the prograde handle of a node until the periapsis reads `target`. */
export function fixPerigee(w: World, target: number, minStage = 0): string | null {
  const wv = w.active!;
  const R = w.universe.body(wv.body).radius;
  if (Math.abs(w.orbitSummary(wv).pe - target) < 2000) return null;
  const o = w.orbitOf(wv), t = w.ut + 600, s = propagate(o, t);
  const dir = normalize(s.velocity);
  const peWith = (x: number) => periapsisRadius(stateToElements(o.mu, o.body, s.position, { x: s.velocity.x + dir.x * x, y: s.velocity.y + dir.y * x, z: s.velocity.z + dir.z * x }, t)) - R;
  let lo = -60, hi = 60;
  const sLo = Math.sign(peWith(lo) - target);
  if (sLo === Math.sign(peWith(hi) - target)) return 'perigee out of trim range';
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (Math.sign(peWith(m) - target) === sLo) lo = m; else hi = m; }
  const node = w.addNode(t); node.prograde = (lo + hi) / 2;
  const burn = executeNode(w, node, { minStage, matchEnergy: false });
  if (!runAutopilot(w, burn, { maxTime: 1e5 })) return `perigee trim: ${burn.error}`;
  if (process.env.CAREER_DEBUG) console.log('trimmed perigee', w.orbitSummary(wv).pe, 'with', node.prograde);
  return null;
}

/** Free-return Moon flyby: the Moon swings the craft back into Earth's atmosphere without a return burn. */
export function freeReturnFlyby(w: World, biomes: Set<string>, minStage = 0): string | null {
  const t = Date.now();
  const plan = planFreeReturn(w, 'moon', {});
  if (process.env.CAREER_DEBUG) console.log('free return plan', plan && { pe: plan.periapsisAltitude, perigee: plan.returnPerigee, dv: plan.dv }, Date.now() - t, 'ms');
  if (!plan) return 'no free return found';
  const tli = executeNode(w, plan.node, { minStage });
  if (!runAutopilot(w, tli, { maxTime: 2e6 })) return `TLI: ${tli.error}`;
  const mcc = planCourseCorrection(w, 'moon', plan.periapsisAltitude, w.ut + 1800);
  if (mcc) { const m = executeNode(w, mcc.node, { minStage }); runAutopilot(w, m, { maxTime: 1e5 }); }
  coastUntil(w, (mcc ?? plan).encounterTime + 600, { stopOnSoi: true });
  doScience(w); trackBiome(w, biomes);
  if (w.active!.body !== 'moon') return 'missed the Moon';
  coastUntil(w, w.ut + 20 * 86400, { stopOnSoi: true });
  if (process.env.CAREER_DEBUG) console.log('after flyby', w.active!.body, w.orbitSummary(w.active!).pe);
  if ((w.active!.body as string) !== 'earth') return 'did not come back to Earth';
  return entryTrim(w, minStage).err;
}

/** The planner's Entry trim: smallest burn that puts the returning periapsis in this vessel's corridor; flown. */
export function entryTrim(w: World, minStage = 0): { err: string | null; plan: EntryTrimPlan | null } {
  const plan = planEntryTrim(w, [...w.nodes], { dragPerMass: enteringDragPerMass(w.active!.state) });
  if (process.env.CAREER_DEBUG) console.log('entry trim', plan && { dv: plan.dv, before: plan.before, after: plan.after, corridor: plan.corridor, in: plan.node.time - w.ut });
  if (!plan) return { err: 'no entry trim', plan };
  const burn = executeNode(w, plan.node, { minStage, matchEnergy: false });
  if (!runAutopilot(w, burn, { maxTime: 3e6 })) return { err: `entry trim: ${burn.error}`, plan };
  return { err: null, plan };
}

/** In the Moon's SOI: optionally capture, then burn home and coast back into Earth's SOI. */
export function moonHome(w: World, biomes: Set<string>, minStage = 0): string | null {
  const o = w.orbitOf(w.active!);
  if (o.e >= 1) {
    // Flyby: ride the hyperbola out of the Moon's SOI, then fix the Earth periapsis for entry.
    coastUntil(w, w.ut + 30 * 86400, { stopOnSoi: true });
    if (process.env.CAREER_DEBUG) console.log('after flyby coast', w.active!.body, w.orbitSummary(w.active!).pe, w.orbitSummary(w.active!).ap);
    if (w.active!.body !== 'earth') return 'flyby did not return to Earth SOI';
    const fix = executeNode(w, planPeriapsisChange(w, arrivalPeriapsisAltitude(w, 'moon', 'earth', w.ut)), { minStage });
    if (!runAutopilot(w, fix, { maxTime: 3e6 })) return `periapsis fix: ${fix.error}`;
    return null;
  }
  const tei = planTransferToBody(w, 'earth', { periapsisAltitude: arrivalPeriapsisAltitude(w, w.active!.body, 'earth', w.ut) });
  if (!tei) return 'no return transfer found';
  const burn = executeNode(w, tei.node, { minStage });
  if (!runAutopilot(w, burn, { maxTime: 1e6 })) return `TEI: ${burn.error}`;
  coastUntil(w, tei.encounterTime + 600, { stopOnSoi: true });
  doScience(w); trackBiome(w, biomes);
  return w.active!.body === 'earth' ? null : 'did not reach Earth';
}

export function captureMoon(w: World, biomes: Set<string>, minStage = 0): string | null {
  const cap = executeNode(w, planCircularization(w, 'periapsis'), { minStage });
  if (!runAutopilot(w, cap, { maxTime: 1e6 })) return `capture: ${cap.error}`;
  doScience(w); trackBiome(w, biomes);
  return null;
}

export function landMoon(w: World, biomes: Set<string>, minStage = 0): string | null {
  const land = landingController(w, { minStage });
  if (!runAutopilot(w, land, { maxTime: 1e5, onTick: (w) => { if (tick() % 50 === 0) { doScience(w); trackBiome(w, biomes); } } })) return `landing: ${land.error}`;
  doScience(w); trackBiome(w, biomes);
  return w.active!.state.situation === 'landed' ? null : 'not landed';
}

export function moonAscent(w: World, biomes: Set<string>, minStage = 0): string | null {
  const asc = ascentGuidance(w, { targetApoapsis: 30000, minStage });
  if (!runAutopilot(w, asc, { maxTime: 1200 })) return `lunar ascent: ${asc.error}`;
  const c = executeNode(w, planCircularization(w, 'apoapsis'), { minStage });
  if (!runAutopilot(w, c, { maxTime: 1e5 })) return `lunar circularise: ${c.error}`;
  doScience(w); trackBiome(w, biomes);
  return null;
}

/** Transmit everything aboard and keep the link up (physics ticks) until the job finishes. */
export function transmitAll(w: World, maxTime = 4 * 3600): number {
  const before = w.progression.science;
  w.transmitScience();
  // Sends at ~1 science/s while linked; behind the Moon the job pauses, so coast on rails until the link returns.
  const end = w.ut + maxTime;
  let last = w.progression.science, stalled = 0;
  while (w.ut < end && w.transmitting.includes(w.active!.state.id) && stalled < 120) {
    if (w.connection(w.active!.state).connected) {
      w.warp = { mode: 'rails', index: 0 }; w.tick(0.25, neutralInput({ sas: 'stabilityAssist' }));
      stalled = w.progression.science > last ? 0 : stalled + 0.25; last = w.progression.science;
    } else coastUntil(w, w.ut + 60);
  }
  if (process.env.CAREER_DEBUG) console.log('transmitted', (w.progression.science - before).toFixed(1), 'stalled', stalled, 'still', w.transmitting.length);
  return w.progression.science - before;
}

/**
 * Uncrewed lunar orbiter (Tern): parking orbit → Moon transfer (launcher stage, then the probe's kick stage) →
 * capture into a low orbit → a day of orbits running every instrument over new biomes, transmitting as it goes.
 */
export function probeLunarOrbit(w: World, biomes: Set<string>, parking: number, periapsis = 100000, orbits = 6): string | null {
  const err = toOrbit(w, biomes, parking, 2) ?? toMoon(w, biomes, 0, periapsis);
  if (err) return err;
  doScience(w); transmitAll(w);
  const dbg = (s: string) => { if (process.env.CAREER_DEBUG) console.log(`  probe ${s} body=${w.active!.body} pe=${w.orbitSummary(w.active!).pe.toFixed(0)} ap=${w.orbitSummary(w.active!).ap.toFixed(0)} warp=${JSON.stringify(w.warp)} vessels=${w.vessels.size} t=${(Date.now() / 1000 % 10000).toFixed(0)}`); };
  dbg('arrived');
  // The course correction can leave the arrival low (even on the surface): raise the periapsis before capturing.
  if (w.orbitSummary(w.active!).pe < periapsis * 0.5) {
    const o = w.orbitOf(w.active!), t = w.ut + 300, st = propagate(o, t), R = w.universe.body('moon').radius;
    // Radial-out raises a hyperbolic periapsis most per m/s; bisect it.
    const r = normalize(st.position);
    const peWith = (x: number) => periapsisRadius(stateToElements(o.mu, o.body, st.position, { x: st.velocity.x + r.x * x, y: st.velocity.y + r.y * x, z: st.velocity.z + r.z * x }, t)) - R;
    let lo = 0, hi = 50;
    while (peWith(hi) < periapsis && hi < 800) hi *= 2;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (peWith(m) < periapsis) lo = m; else hi = m; }
    const node = w.addNode(t);
    const s0 = propagate(o, t);
    const c = inertialDvToManeuver(s0, { x: r.x * hi, y: r.y * hi, z: r.z * hi });
    node.prograde = c.prograde; node.normal = c.normal; node.radial = c.radial;
    const fix = executeNode(w, node, { minStage: 0, matchEnergy: false });
    if (!runAutopilot(w, fix, { maxTime: 1e5 })) return `periapsis fix: ${fix.error}`;
    dbg('periapsis fixed');
  }
  const cap = captureMoon(w, biomes, 0);
  dbg(`captured ${cap}`);
  if (cap) return cap;
  const o = w.orbitOf(w.active!), step = period(o) / 24;
  for (let k = 0; k < orbits * 24; k++) {
    if (k % 24 === 0) dbg(`orbit ${k / 24}`);
    coastUntil(w, w.ut + step);
    trackBiome(w, biomes);
    if (doScience(w)) transmitAll(w);
  }
  return null;
}

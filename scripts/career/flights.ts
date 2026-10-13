/**
 * Player-like flight helpers for headless career playthroughs: every flight goes through the real World,
 * the same autopilot building blocks the in-game assists use, and the real science/contract/recovery code.
 */
import { World } from '../../src/game/world';
import { PART_CATALOG } from '../../src/data/parts';
import { launchCost, launchProblem } from '../../src/data/technology';
import { neutralInput } from '../../src/sim/vessel';
import { propagate } from '../../src/sim/orbit';
import type { CraftDef } from '../../src/sim/vessel/types';
import {
  ascentGuidance, coastUntil, executeNode, landingController, localFrame, planCircularization, planCourseCorrection,
  planPeriapsisChange, planTransferToBody, propulsion, runAutopilot, type Autopilot,
} from '../../src/game/autopilot';
import { length, normalize, scale } from '../../src/util/vec3';
import { arrivalPeriapsisAltitude } from '../../src/game/planning/arrival';

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
  const problem = launchProblem(craft, PART_CATALOG, 'career', w.progression);
  if (problem) return { cost: 0, problem };
  const cost = launchCost(craft, PART_CATALOG);
  w.launch(craft);
  return { cost, problem: null };
}

let ticks = 0;
const tick = () => ticks++;

function trackBiome(w: World, biomes: Set<string>) {
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

/** Hold retrograde (surface) and fall to the ground or sea; stages everything once descending in air. */
export function descend(w: World, biomes: Set<string>, maxTime = 4000): boolean {
  const wv = w.active!;
  const atmo = w.universe.body(wv.body).atmosphere?.height ?? 0;
  let staged = false;
  return fly(w, maxTime, (w) => {
    const f = localFrame(w, w.active!);
    if (!staged && f.altitude < atmo && length(f.surfVel) > 1) { stageAll(w); staged = true; }
    const v = length(f.surfVel) > 1 ? normalize(f.surfVel) : f.up;
    return neutralInput({ sas: 'maneuver', maneuverDirection: scale(v, -1), throttle: 0 });
  }, (w) => {
    const s = w.active!.state;
    return (s.situation === 'landed' || s.situation === 'splashed') && length(localFrame(w, w.active!).surfVel) < 0.5;
  }, biomes);
}

/**
 * Sounding hop: full throttle until burnout or until the apoapsis reaches `cutoff` (the coast hint's advice),
 * pitching over `pitch` degrees east once moving; coast, descend under chute, science throughout.
 */
export function hop(w: World, craft: CraftDef, opts: { cutoff?: number; pitch?: number } = {}): FlightResult {
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
  const top = Math.max(0, ...[0]);
  void top;
  const down = descend(w, biomes);
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
  if (!science(asc, 1200)) return `ascent: ${asc.error}`;
  const circ = executeNode(w, planCircularization(w, 'apoapsis'), { minStage });
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
  const plan = planTransferToBody(w, 'moon', { periapsisAltitude: periapsis });
  if (!plan) return 'no Moon transfer found';
  const tli = executeNode(w, plan.node, { minStage });
  if (!runAutopilot(w, tli, { maxTime: 2e6 })) return `TLI: ${tli.error}`;
  const mcc = planCourseCorrection(w, 'moon', periapsis, w.ut + 1800);
  if (mcc) { const m = executeNode(w, mcc.node, { minStage }); runAutopilot(w, m, { maxTime: 1e5 }); }
  coastUntil(w, (mcc ?? plan).encounterTime + 600, { stopOnSoi: true });
  doScience(w); trackBiome(w, biomes);
  return w.active!.body === 'moon' ? null : 'missed the Moon';
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

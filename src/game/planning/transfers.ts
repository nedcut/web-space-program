/** Headless transfer planners, shared by autopilot and the planning worker. */
import type { PlanningWorld, PlanningProgressReporter } from './context';
import type { ManeuverNode, Orbit, StateVector, TrajectoryPatch } from '../../sim/orbit/api';
import { propagate, stateToElements, period, periapsisRadius, apoapsisRadius, timeToApoapsis,
  predictTrajectory, maneuverToInertialDv, closestApproach } from '../../sim/orbit';
import { add, sub, scale, length, normalize, type Vec3 } from '../../util/vec3';
import { nelderMead } from '../../util/nelderMead';
import { planInterplanetaryTransfer, refine } from '../interplanetary';
import { transferWindows, type TransferWindow } from './windows';

export interface TransferPlan {
  node: ManeuverNode;
  /** Departure options found for this target (estimates), in time order, when the planner searched them. */
  windows?: TransferWindow[];
  /** Predicted patches from the node onward. */
  patches: TrajectoryPatch[];
  /** UT of the SOI change into the target. */
  encounterTime: number;
  /** Predicted periapsis altitude at the target (above its datum radius), m. */
  periapsisAltitude: number;
  dv: number;
}

export interface TransferOptions {
  /** Desired periapsis altitude at the target, m (default: 30 km for moons, 35 km for atmospheric bodies). */
  periapsisAltitude?: number;
  /** Earliest node time (default: now + 5 min). */
  earliest?: number;
  /** Search window length for the departure time, s (default: one synodic-ish period). */
  window?: number;
  /** Plan the departure option nearest this UT (one of a previous plan's `windows`) instead of choosing one. */
  departure?: number;
}

/**
 * Squash an encounter's periapsis error below the miss branch (which starts at 10): any SOI hit must score
 * better than any miss, otherwise a grazing entry (periapsis near the SOI edge, error in the thousands) is a
 * wall the simplex can never cross and the planner reports "no transfer" from most parking orbits.
 * Monotonic and ≈ the raw error near the optimum. Used as a retry when the raw-error search ends in a miss.
 */
function hitCost(err: number): number {
  return (9.5 * err) / (9.5 + err);
}

/**
 * Evaluate the encounter produced by applying `dv` (inertial) at `t` on `orbit`:
 * returns the predicted periapsis at the target after its SOI change, or a miss measure.
 */
function evaluateEncounter(world: PlanningWorld, orbit: Orbit, t: number, dv: Vec3, targetId: string, horizon: number) {
  const u = world.universe;
  const s = propagate(orbit, t);
  const state: StateVector = { position: s.position, velocity: add(s.velocity, dv) };
  let patches: TrajectoryPatch[];
  try {
    patches = predictTrajectory({ ephem: u.ephem, bodies: u.bodies, initialBody: orbit.body, state, t0: t, horizon, maxPatches: 3 });
  } catch {
    return null;
  }
  const i = patches.findIndex((p) => p.nextBody === targetId && (p.endReason === 'soiEnter' || p.endReason === 'soiExit'));
  if (i >= 0 && patches[i + 1]) {
    const arr = patches[i + 1];
    return { hit: true as const, patches, encounterTime: patches[i].endTime, periapsis: periapsisRadius(arr.orbit) - u.body(targetId).radius };
  }
  return { hit: false as const, patches };
}

/**
 * Plan a transfer from the current (closed) orbit to `targetId`, which must be either a child of the current
 * body (e.g. Earth orbit → Moon), its parent (lunar orbit → Earth), or a sibling planet.
 * Sibling planets route to the Lambert/patched-conic planner in interplanetary.ts.
 *
 * Child target: a coarse analytic scan over departure times picks the Hohmann-like departure whose apoapsis
 * meets the target; then a simplex search over (time, prograde, normal) on the full patched-conic prediction
 * makes the trajectory enter the target's SOI with the requested periapsis.
 * Parent target: scans departure times around the parking orbit for an escape burn that leaves the SOI on the
 * trailing side, then refines (time, prograde) to hit the requested periapsis around the parent.
 * The resulting node is added to `world.nodes`. Returns null if no encounter was found.
 */
function firstWindowTransfer(world: PlanningWorld, targetId: string, opts: TransferOptions = {}, report?: PlanningProgressReporter): TransferPlan | null {
  const u = world.universe;
  const wv = world.active!;
  const o = world.orbitOf(wv);
  const central = u.body(o.body);
  const target = u.body(targetId);
  if (central.parent === u.sunId && target.parent === u.sunId && targetId !== central.id)
    throw new Error('interplanetary targets are routed by planTransferToBody');
  const T = period(o);
  if (!isFinite(T)) return null;
  const earliest = opts.earliest ?? world.ut + 300;
  const peAlt = opts.periapsisAltitude ?? (target.atmosphere ? target.atmosphere.height * 0.5 : 30000);
  const peGoal = target.radius + peAlt;

  report?.('Searching departures', 0);
  let t0: number;
  let pro0: number;
  let horizon: number;
  /** Further departure guesses tried when the first one does not refine to an accurate encounter. */
  let fallbacks: { t: number; pro: number }[] = [];
  if (target.parent === central.id) {
    // ---- Outbound to a moon: coarse analytic scan.
    const window = opts.window ?? (target.orbitalPeriod ?? 10 * T) * 1.05;
    const step = T / 120;
    // Take the first departure window, not the best one in a whole lunar month: any departure whose
    // Hohmann apoapsis falls well inside the target's SOI refines to the same encounter, and the global
    // optimum is often days (Real: weeks) away for a marginal gain. The best window remains the fallback.
    const good = target.soi * 0.9;
    let best = { miss: Infinity, t: earliest, pro: 0 };
    let first: typeof best | null = null;
    for (let t = earliest; t < earliest + window; t += step) {
      const s = propagate(o, t);
      const r1 = length(s.position);
      const v1 = length(s.velocity);
      const rT = length(u.ephem.getRelativeState(targetId, t).position);
      const vNeed = Math.sqrt(o.mu * (2 / r1 - 2 / (r1 + rT)));
      const o2 = stateToElements(o.mu, o.body, s.position, scale(s.velocity, vNeed / v1), t);
      if (o2.e >= 1) continue;
      const tApo = t + timeToApoapsis(o2, t);
      const miss = length(sub(propagate(o2, tApo).position, u.ephem.getRelativeState(targetId, tApo).position));
      if (miss < best.miss) best = { miss, t, pro: vNeed - v1 };
      if (first) {
        // Follow the first good window down to its local minimum, then stop.
        if (miss < first.miss) first = { miss, t, pro: vNeed - v1 };
        else if (miss > first.miss + target.soi * 0.1) break;
      } else if (miss < good) first = { miss, t, pro: vNeed - v1 };
    }
    const start = first ?? best;
    t0 = start.t;
    pro0 = start.pro;
    if (start !== best) fallbacks = [best];
    const rT = length(u.ephem.getRelativeState(targetId, t0).position);
    const r1 = length(propagate(o, t0).position);
    horizon = 2.2 * Math.PI * Math.sqrt(((r1 + rT) / 2) ** 3 / o.mu);
  } else if (central.parent === targetId) {
    // ---- Escape to the parent: scan one parking period with a Hohmann-estimated excess speed.
    const rc = length(u.ephem.getRelativeState(central.id, world.ut).position);
    const vc = length(u.ephem.getRelativeState(central.id, world.ut).velocity);
    const vApo = Math.sqrt(target.gm * (2 / rc - 2 / (rc + peGoal)));
    const vInf = Math.max(0, vc - vApo);
    horizon = Math.max(4 * T, 6 * central.soi / Math.max(50, vInf)) + 2 * Math.PI * Math.sqrt(((rc + peGoal) / 2) ** 3 / target.gm) * 0.6;
    let best = { cost: Infinity, t: earliest, pro: 0 };
    for (let k = 0; k < 120; k++) {
      const t = earliest + (k / 120) * T;
      const s = propagate(o, t);
      const r = length(s.position);
      const pro = Math.sqrt(vInf * vInf + (2 * o.mu) / r) - length(s.velocity);
      const ev = evaluateEncounter(world, o, t, scale(normalize(s.velocity), pro), targetId, horizon);
      if (!ev?.hit) continue;
      const cost = Math.abs(ev.periapsis - peAlt);
      if (cost < best.cost) best = { cost, t, pro };
    }
    if (!isFinite(best.cost)) return null;
    t0 = best.t;
    pro0 = best.pro;
  } else {
    throw new Error(`planTransferToBody: ${targetId} is neither a child nor the parent of ${central.id}`);
  }

  report?.('Refining encounter', 0.5);
  // ---- Refine on the patched-conic prediction.
  const dvAt = (t: number, pro: number, nor: number) => maneuverToInertialDv(propagate(o, t), { prograde: pro, normal: nor, radial: 0 });
  let squash = false;
  const cost = (x: number[]) => {
    const t = t0 + x[0];
    if (t < earliest) return 1e6 + (earliest - t);
    const ev = evaluateEncounter(world, o, t, dvAt(t, x[1], x[2] ?? 0), targetId, horizon);
    if (!ev) return 1e6;
    const dvMag = Math.hypot(x[1], x[2] ?? 0);
    if (ev.hit) {
      const err = ((ev.periapsis - peAlt) / target.radius) ** 2;
      return (squash ? hitCost(err) : err) + 1e-9 * dvMag * dvMag;
    }
    // Missed: distance of closest approach (outbound) or remaining distance to the SOI edge (escape).
    const p0 = ev.patches[0];
    if (target.parent === central.id) {
      const ca = closestApproach(p0.orbit, (tt) => u.ephem.getRelativeState(targetId, tt), t, t + horizon);
      return 10 + (ca.distance / target.soi) ** 2;
    }
    return 10 + Math.max(0, central.soi - apoapsisRadius(p0.orbit)) / central.soi;
  };
  const dims = target.parent === central.id ? 3 : 2;
  const search = () => {
    const x0 = dims === 3 ? [0, pro0, 0] : [0, pro0];
    const steps = dims === 3 ? [T / 30, Math.max(2, pro0 * 0.01), Math.max(2, pro0 * 0.01)] : [T / 30, Math.max(1, pro0 * 0.02)];
    let res = nelderMead(cost, x0, steps, 400);
    for (let restart = 0; restart < 3; restart++) res = nelderMead(cost, res.x, steps.map((s) => s * 0.2), 400);
    const t = t0 + res.x[0];
    return { x: res.x, t, ev: evaluateEncounter(world, o, t, dvAt(t, res.x[1], res.x[2] ?? 0), targetId, horizon) };
  };
  const refine = () => {
    squash = false;
    let found = search();
    if (!found.ev?.hit) {
      // Retry with every hit scored below every miss, so the simplex can cross a grazing SOI entry.
      squash = true;
      found = search();
    }
    return found;
  };
  const error = (f: ReturnType<typeof search>) => f.ev?.hit ? Math.abs(f.ev.periapsis - peAlt) : Infinity;
  const tolerance = Math.max(5000, target.radius * 0.05);
  let found = refine();
  for (const guess of fallbacks) {
    if (error(found) <= tolerance) break;
    report?.('Refining encounter', 0.75);
    t0 = guess.t; pro0 = guess.pro;
    const next = refine();
    if (error(next) < error(found)) found = next;
  }
  const x = found.x;
  const t = found.t;
  const ev = found.ev;
  if (!ev || !ev.hit) return null;
  const node = { id: -1, time: t, prograde: x[1], normal: x[2] ?? 0, radial: 0 };
  return { node, patches: ev.patches, encounterTime: ev.encounterTime, periapsisAltitude: ev.periapsis, dv: Math.hypot(x[1], x[2] ?? 0) };
}

/**
 * Plan a transfer from the current orbit to `targetId`: a moon of the current body (e.g. Earth orbit → Moon), its
 * parent (lunar orbit → Earth), or a sibling planet (routed to the Lambert/patched-conic planner in
 * interplanetary.ts).
 *
 * Moons and parents get two independent searches. The first-window planner (an analytic Hohmann scan refined on
 * the patched-conic prediction) is fast and exact from circular orbits. A Lambert scan of departures from the actual
 * orbit, in any plane, lists the options — the cheapest within the next revolution ("now", often with a plane
 * change) and the cheaper windows later — and seeds a refinement that also covers elliptical, part-burnt, overshot
 * and inclined orbits. The chosen plan is the first-window plan when it is accurate, prompt and not clearly dearer
 * than the best window; otherwise the earliest window within a few percent of the cheapest. `opts.departure` plans
 * the option nearest that UT instead. Exactly one node is added on success, none on failure.
 */
export function planTransferToBody(world: PlanningWorld, targetId: string, opts: TransferOptions = {}, report?: PlanningProgressReporter): TransferPlan | null {
  const u = world.universe;
  const wv = world.active!;
  const o = world.orbitOf(wv);
  const central = u.body(o.body);
  const target = u.body(targetId);
  if (central.parent === u.sunId && target.parent === u.sunId && targetId !== central.id)
    return planInterplanetaryTransfer(world, targetId, opts, report);
  if (target.parent !== central.id && central.parent !== targetId)
    throw new Error(`planTransferToBody: ${targetId} is neither a child nor the parent of ${central.id}`);
  const outbound = target.parent === central.id;
  const earliest = opts.earliest ?? world.ut + 300;
  const peAlt = opts.periapsisAltitude ?? (target.atmosphere ? target.atmosphere.height * 0.5 : 30000);
  const tolerance = Math.max(5000, target.radius * 0.05);
  const T = period(o);
  const accurate = (p: TransferPlan | null): p is TransferPlan => !!p && p.node.time > world.ut && Math.abs(p.periapsisAltitude - peAlt) <= tolerance;

  report?.('Searching departures', 0);
  const windows = transferWindows(world, targetId, { earliest, periapsisRadius: target.radius + peAlt });
  const refineWindow = (w: TransferWindow) => {
    const arrival = w.departure + (outbound ? w.timeOfFlight : 1.5 * w.timeOfFlight + central.soi / 150);
    try {
      const freedom = Number.isFinite(T) ? Math.min(T / 8, 0.05 * w.timeOfFlight) : 0;
      return refine(world, o, targetId, w.departure, [...w.seed], arrival, peAlt, Infinity, freedom, earliest, Infinity, false);
    } catch { return null; }
  };
  let chosen: TransferPlan | null = null;
  /** Options offered to the player: the window estimates plus the first-window plan when it is a distinct option. */
  let offered = windows;
  if (opts.departure !== undefined && windows.length) {
    const want = opts.departure;
    const w = windows.reduce((a, b) => (Math.abs(b.departure - want) < Math.abs(a.departure - want) ? b : a));
    report?.('Refining encounter', 0.5);
    chosen = refineWindow(w);
    if (!accurate(chosen)) chosen = null;
  } else {
    const first = Number.isFinite(T) ? firstWindowTransfer(world, targetId, { ...opts, earliest, periapsisAltitude: peAlt }, report) : null;
    // Take the earliest option that costs about the least: waiting is worth it only for a clearly cheaper burn.
    const cheapest = Math.min(...windows.map(w => w.dv), accurate(first) ? first.dv : Infinity);
    const affordable = (dv: number) => dv <= cheapest * 1.08 + 25;
    const options: ({ at: number; plan: TransferPlan } | { at: number; window: TransferWindow })[] = [
      ...windows.map(w => ({ at: w.departure, window: w })),
      ...(accurate(first) ? [{ at: first.node.time, plan: first }] : []),
    ].sort((x, y) => x.at - y.at);
    const refined: TransferPlan[] = accurate(first) ? [first] : [];
    if (accurate(first) && !windows.some(w => Math.abs(w.departure - first.node.time) < Math.max(3600, (Number.isFinite(T) ? T : 0) / 4))) {
      const n = first.node, wait = n.time - world.ut;
      offered = [...windows, { departure: n.time, wait, dv: first.dv, timeOfFlight: first.encounterTime - n.time, kind: windows.some(w => w.kind === 'now') ? 'window' as const : 'now' as const, seed: [n.prograde, n.normal, n.radial] as [number, number, number] }]
        .sort((x, y) => x.departure - y.departure);
    }
    report?.('Refining departure windows', 0.75);
    for (const option of options) {
      if ('plan' in option) {
        if (affordable(option.plan.dv)) { chosen = option.plan; break; }
        continue;
      }
      if (!affordable(option.window.dv)) continue;
      const p = refineWindow(option.window);
      if (!accurate(p)) continue;
      refined.push(p);
      if (affordable(p.dv)) { chosen = p; break; }
    }
    chosen ??= refined.sort((x, y) => x.dv - y.dv)[0] ?? null;
  }
  if (!chosen) return null;
  const node = world.addNode(chosen.node.time);
  node.prograde = chosen.node.prograde;
  node.normal = chosen.node.normal;
  node.radial = chosen.node.radial;
  return { ...chosen, node, windows: offered };
}

/**
 * Plan a small correction burn at `time` (default 10 min from now) so the current trajectory reaches
 * `targetId` with the requested periapsis. A prograde scan within ±`maxDv`, then a simplex search over the
 * three node components.
 */
export function planCourseCorrection(world: PlanningWorld, targetId: string, periapsisAltitude: number, time = world.ut + 600, maxDv = 80): TransferPlan | null {
  const u = world.universe;
  const wv = world.active!;
  const o = world.orbitOf(wv);
  const target = u.body(targetId);
  const horizon = isFinite(period(o)) ? period(o) : 1e6;
  const sNode = propagate(o, time);
  const cost = (x: number[]) => {
    const dv = maneuverToInertialDv(sNode, { prograde: x[0], normal: x[1], radial: x[2] });
    const ev = evaluateEncounter(world, o, time, dv, targetId, horizon);
    if (!ev) return 1e6;
    const mag = Math.hypot(x[0], x[1], x[2]);
    if (ev.hit) return ((ev.periapsis - periapsisAltitude) / target.radius) ** 2 + 1e-6 * mag * mag;
    const ca = closestApproach(ev.patches[0].orbit, (tt) => u.ephem.getRelativeState(targetId, tt), time, time + horizon);
    return 10 + (ca.distance / target.soi) ** 2;
  };
  // Coarse 1-D scan along prograde (fixes the transfer energy/timing), then refine all three components.
  let x0 = [0, 0, 0];
  let best = cost(x0);
  for (let pro = -maxDv; pro <= maxDv; pro += maxDv / 40) {
    const c = cost([pro, 0, 0]);
    if (c < best) { best = c; x0 = [pro, 0, 0]; }
  }
  let res = nelderMead(cost, x0, [maxDv / 20, maxDv / 20, maxDv / 20], 400);
  for (let k = 0; k < 2; k++) res = nelderMead(cost, res.x, [maxDv / 200, maxDv / 200, maxDv / 200], 400);
  const ev = evaluateEncounter(world, o, time, maneuverToInertialDv(sNode, { prograde: res.x[0], normal: res.x[1], radial: res.x[2] }), targetId, horizon);
  if (!ev || !ev.hit) return null;
  const node = world.addNode(time);
  node.prograde = res.x[0];
  node.normal = res.x[1];
  node.radial = res.x[2];
  return { node, patches: ev.patches, encounterTime: ev.encounterTime, periapsisAltitude: ev.periapsis, dv: Math.hypot(...res.x) };
}


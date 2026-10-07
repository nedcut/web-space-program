/** Impulsive planet-to-planet targeting, followed by full patched-conic encounter refinement. */
import type { PlanningWorld, PlanningProgressReporter } from './planning/context';
import type { TransferPlan } from './planning/transfers';
import type { TransferWindow } from './planning/windows';
import type { Orbit, TrajectoryPatch } from '../sim/orbit/api';
import { solveLambert, propagate, period, periapsisRadius, apoapsisRadius, predictTrajectory,
  closestApproach, inertialDvToManeuver, maneuverToInertialDv } from '../sim/orbit';
import { add, sub, scale, length, dot, normalize, type Vec3 } from '../util/vec3';
import { nelderMead } from '../util/nelderMead';

/** Inclusive range in seconds: absolute UT for departures, duration for flight times. */
export interface SearchRange { min: number; max: number; samples?: number }
export interface PorkchopPoint {
  departureTime: number; timeOfFlight: number; arrivalTime: number;
  departureExcess: Vec3; arrivalExcess: Vec3;
  departureDv: number; captureDv: number; totalDv: number;
}
export interface InterplanetaryOptions {
  earliest?: number;
  /** Departure search span, seconds; default one synodic period. */
  window?: number;
  departureRange?: SearchRange;
  timeOfFlightRange?: SearchRange;
  periapsisAltitude?: number;
  /** Include insertion into a circular orbit at the requested periapsis in the grid score (default true). */
  includeCapture?: boolean;
  /** Plan the window departing nearest this UT (one of a previous plan's `windows`). */
  departure?: number;
}
export interface InterplanetaryPlan extends TransferPlan {
  departureTime: number;
  /** Nominal Lambert arrival UT, used as the reference for subsequent course corrections. */
  arrivalTime: number;
  timeOfFlight: number;
  departureExcess: Vec3;
  arrivalExcess: Vec3;
  captureDvEstimate: number;
}
const safeAltitude = (world: PlanningWorld, id: string) => Math.max(world.universe.body(id).radius * 0.1,
  (world.universe.body(id).atmosphere?.height ?? 0) * 2, 30000);
function planets(world: PlanningWorld, from: string, to: string) {
  const u = world.universe, a = u.body(from), b = u.body(to);
  if (from === to || a.parent !== u.sunId || b.parent !== u.sunId)
    throw new RangeError('Interplanetary targeting requires two distinct planets orbiting the Sun');
  return { a, b, mu: u.body(u.sunId).gm };
}
function checkRange(r: SearchRange, duration = false) {
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max) || r.max < r.min || (duration && r.min <= 0) ||
    !Number.isInteger(r.samples ?? 25) || (r.samples ?? 25) < 2 || (r.samples ?? 25) > 200)
    throw new RangeError('Search ranges require finite min ≤ max and 2–200 samples; flight times must be positive');
}
function point(world: PlanningWorld, from: string, to: string, dep: number, tof: number, parking: number, pe: number): PorkchopPoint {
  const { a, b, mu } = planets(world, from, to), ephem = world.universe.ephem;
  const start = ephem.getRelativeState(from, dep), end = ephem.getRelativeState(to, dep + tof);
  const lambert = solveLambert(mu, start.position, end.position, tof);
  const departureExcess = sub(lambert.departureVelocity, start.velocity), arrivalExcess = sub(lambert.arrivalVelocity, end.velocity);
  const departureDv = Math.sqrt(dot(departureExcess, departureExcess) + 2 * a.gm / parking) - Math.sqrt(a.gm / parking);
  const captureDv = Math.sqrt(dot(arrivalExcess, arrivalExcess) + 2 * b.gm / pe) - Math.sqrt(b.gm / pe);
  return { departureTime: dep, timeOfFlight: tof, arrivalTime: dep + tof, departureExcess, arrivalExcess, departureDv, captureDv, totalDv: departureDv + captureDv };
}
/** Flat row-major grid (departure outermost); singular Lambert cells are null. Does not mutate the world.
 * Scores assume circular parking/capture orbits; the flight planner accounts for the actual parking plane.
 */
export function porkchopGrid(world: PlanningWorld, from: string, to: string, depRange: SearchRange, tofRange: SearchRange): (PorkchopPoint | null)[] {
  return [...porkchopRows(world, from, to, depRange, tofRange)].flat();
}

/** The synchronous API and worker consume exactly the same row generator. */
export function* porkchopRows(world: PlanningWorld, from: string, to: string, depRange: SearchRange, tofRange: SearchRange): Generator<(PorkchopPoint | null)[]> {
  const { a, b } = planets(world, from, to);
  checkRange(depRange); checkRange(tofRange, true);
  const parking = world.active?.body === from ? length(world.relativeState(world.active).position) : a.radius + safeAltitude(world, from);
  for (let i = 0; i < (depRange.samples ?? 25); i++) {
    const row: (PorkchopPoint | null)[] = [];
    for (let j = 0; j < (tofRange.samples ?? 25); j++) {
      try { row.push(point(world, from, to,
        depRange.min + (depRange.max - depRange.min) * i / ((depRange.samples ?? 25) - 1),
        tofRange.min + (tofRange.max - tofRange.min) * j / ((tofRange.samples ?? 25) - 1), parking, b.radius + safeAltitude(world, to))); }
      catch { row.push(null); }
    }
    yield row;
  }
}

/** Velocity at position r on a hyperbola with the specified outgoing asymptote v∞.
 * The hyperbola's plane contains r and v∞; scanning the parking orbit finds the low-cost ejection angle.
 */
export function ejectionVelocity(mu: number, r: Vec3, excess: Vec3): Vec3 {
  const R = length(r), speed = length(excess), q = scale(r, 1 / R), d = normalize(excess);
  const c = dot(q, d);
  const k = speed / 2 + Math.sqrt(speed * speed / 4 + mu / (R * Math.max(1e-12, 1 + c)));
  return add(scale(d, k), scale(q, k - speed));
}

/** Cheapest single-burn ejection onto the asymptote `excess` from the parking orbit within half a revolution of
 * `t`: the parking plane is fixed, so an asymptote far out of it costs a dog-leg that the coplanar estimate ignores. */
function ejectionCost(orbit: Orbit, gm: number, t: number, excess: Vec3, T: number, samples = 24): number {
  let best = Infinity;
  for (let k = 0; k < samples; k++) {
    const s = propagate(orbit, t + (k / samples - 0.5) * T);
    best = Math.min(best, length(sub(ejectionVelocity(gm, s.position, excess), s.velocity)));
  }
  return best;
}

/** Departure options over `span`: local minima of the plane-aware departure Δv (best flight time per date),
 * cheapest few in time order, plus departing at once when that is not absurd. Estimates only. */
function interplanetaryWindows(world: PlanningWorld, a: string, b: string, orbit: Orbit, earliest: number, span: number,
  tofRange: SearchRange, altitude: number, includeCapture: boolean, max = 4): TransferWindow[] {
  const u = world.universe, T = period(orbit), gm = u.body(a).gm, parking = length(world.relativeState(world.active!).position);
  const rows: { t: number; dv: number; tof: number; capture: number; score: number }[] = [];
  const N = 60, M = 12;
  for (let i = 0; i < N; i++) {
    const t = earliest + (span * i) / (N - 1);
    let best = { t, dv: Infinity, tof: 0, capture: 0, score: Infinity };
    for (let j = 0; j < M; j++) {
      const tof = tofRange.min + ((tofRange.max - tofRange.min) * j) / (M - 1);
      try {
        const p = point(world, a, b, t, tof, parking, u.body(b).radius + altitude);
        const dv = ejectionCost(orbit, gm, t, p.departureExcess, T, 12);
        const score = dv + (includeCapture ? p.captureDv : 0);
        if (score < best.score) best = { t, dv, tof, capture: p.captureDv, score };
      } catch { /* collinear cell */ }
    }
    rows.push(best);
  }
  const finite = rows.filter(r => Number.isFinite(r.score));
  if (!finite.length) return [];
  // Ranked like the planner ranks departures (departure plus capture unless capture is excluded).
  const cheapest = Math.min(...finite.map(r => r.score));
  const minima = rows.filter((r, i) => Number.isFinite(r.score) && r.score <= (rows[i - 1]?.score ?? Infinity) && r.score <= (rows[i + 1]?.score ?? Infinity));
  const picked = minima.sort((x, y) => x.score - y.score).slice(0, max);
  if (rows[0] && Number.isFinite(rows[0].score) && rows[0].score < 2.5 * cheapest && !picked.includes(rows[0])) picked.push(rows[0]);
  return picked.sort((x, y) => x.t - y.t).map(r => ({ departure: r.t, wait: r.t - world.ut, dv: r.dv, captureDv: r.capture, timeOfFlight: r.tof,
    kind: r === rows[0] ? 'now' as const : 'window' as const, seed: [0, 0, 0] as [number, number, number] }));
}

function predict(world: PlanningWorld, orbit: Orbit, time: number, components: number[], horizon: number): TrajectoryPatch[] {
  const s = propagate(orbit, time);
  const dv = maneuverToInertialDv(s, { prograde: components[0], normal: components[1], radial: components[2] });
  return predictTrajectory({ ephem: world.universe.ephem, bodies: world.universe.bodies, initialBody: orbit.body,
    state: { position: s.position, velocity: add(s.velocity, dv) }, t0: time, horizon, maxPatches: orbit.body === world.universe.sunId ? 2 : 3 });
}
/** Continuous-ish miss objective through the SOI edge, then periapsis targeting inside the target SOI. */
export function refine(world: PlanningWorld, orbit: Orbit, targetId: string, time: number, initial: number[], arrival: number,
  altitude: number, maxDv = Infinity, timeFreedom = 0, earliest = time, latest = Infinity, commit = true): TransferPlan | null {
  const u = world.universe, target = u.body(targetId), goal = target.radius + altitude;
  const horizon = Math.max(1, arrival - time) * 1.3;
  const objective = (x: number[]) => {
    const t = time + (x[3] ?? 0);
    if (t < earliest || t > latest || Math.abs(x[3] ?? 0) > timeFreedom || Math.hypot(...x.slice(0, 3)) > maxDv) return 1e12;
    try {
      const patches = predict(world, orbit, t, x, horizon);
      const encounter = patches.find(p => p.orbit.body === targetId);
      if (encounter) {
        const error = Math.abs(periapsisRadius(encounter.orbit) - goal);
        return error < 100 ? 0 : (error / target.soi) ** 2;
      }
      // Missed: closest approach in the target's parent frame (heliocentric for planets, planet-centred for moons)…
      const around = patches.find(p => p.orbit.body === target.parent);
      if (around) {
        const ca = closestApproach(around.orbit, tt => u.ephem.getRelativeState(targetId, tt), around.startTime, around.endTime);
        // A miss outside the SOI must always cost more than a valid near-periapsis encounter.
        return ((ca.distance - goal) / target.soi) ** 2;
      }
      // …or, still bound to the departure body, how far the apoapsis falls short of its SOI edge.
      const first = patches[0], soi = u.body(first.orbit.body).soi;
      return 100 + (Number.isFinite(soi) ? Math.max(0, soi - apoapsisRadius(first.orbit)) / soi : 1);
    } catch { return 1e12; }
  };
  const x0 = [...initial, ...(timeFreedom > 0 ? [0] : [])];
  const step = Math.max(0.05, Math.hypot(...initial) * 0.004);
  const steps = [step, step, step, ...(timeFreedom > 0 ? [timeFreedom / 20] : [])];
  let res = nelderMead(objective, x0, steps, 280, 1e-8);
  if (res.fx > (Math.max(100, goal * 0.002) / target.soi) ** 2)
    res = nelderMead(objective, res.x, steps.map(s => s / 5), 280, 1e-8);
  const t = time + (res.x[3] ?? 0);
  let patches: TrajectoryPatch[];
  try { patches = predict(world, orbit, t, res.x, horizon); } catch { return null; }
  const enc = patches.find(p => p.orbit.body === targetId);
  if (!enc || Math.abs(periapsisRadius(enc.orbit) - goal) > Math.max(1000, goal * 0.02)) return null;
  // Uncommitted candidates carry a detached node; the caller adds the one it picks.
  const node = commit ? world.addNode(t) : { id: -1, time: t, prograde: 0, normal: 0, radial: 0 };
  [node.prograde, node.normal, node.radial] = res.x;
  return { node, patches, encounterTime: enc.startTime, periapsisAltitude: periapsisRadius(enc.orbit) - target.radius,
    dv: Math.hypot(...res.x.slice(0, 3)) };
}

/** Search a departure × flight-time grid, refine its minimum, convert v∞ to an inclined parking-orbit
 * ejection, then target the actual SOI encounter. Adds exactly one node on success, none on failure.
 * Moon departure is deliberately unsupported; first escape into a bound planetary parking orbit.
 */
export function planInterplanetaryTransfer(world: PlanningWorld, targetPlanetId: string, opts: InterplanetaryOptions = {}, report?: PlanningProgressReporter): InterplanetaryPlan | null {
  const wv = world.active;
  if (!wv) throw new RangeError('An active vessel is required');
  const { a, b, mu } = planets(world, wv.body, targetPlanetId);
  const orbit = world.orbitOf(wv), T = period(orbit);
  if (!Number.isFinite(T) || periapsisRadius(orbit) <= a.radius + (a.atmosphere?.height ?? 0)) return null;
  const altitude = opts.periapsisAltitude ?? safeAltitude(world, b.id);
  if (!Number.isFinite(altitude) || altitude <= (b.atmosphere?.height ?? 0)) throw new RangeError('Arrival periapsis must clear the atmosphere and surface');
  const earliest = Math.max(world.ut + 300, opts.earliest ?? world.ut + 300);
  const na = Math.sqrt(mu / a.orbit!.a ** 3), nb = Math.sqrt(mu / b.orbit!.a ** 3);
  const hohmann = Math.PI * Math.sqrt(((a.orbit!.a + b.orbit!.a) / 2) ** 3 / mu);
  const synodic = 2 * Math.PI / Math.abs(na - nb);
  let tof = opts.timeOfFlightRange ?? { min: hohmann * 0.65, max: hohmann * 1.35, samples: 25 };
  checkRange(tof, true);
  // Options over two synodic periods. Unless a range or window was given, plan the earliest option within a few
  // percent of the cheapest (departure + capture): a slightly dearer window months earlier beats waiting.
  report?.('Listing transfer windows', 0);
  const windows = opts.departureRange ? [] : interplanetaryWindows(world, a.id, b.id, orbit, earliest, 2 * synodic, tof, altitude, opts.includeCapture !== false);
  let pick = opts.departure;
  if (pick === undefined && opts.window === undefined && windows.length) {
    const totals = windows.map(w => w.dv + (opts.includeCapture === false ? 0 : w.captureDv ?? 0));
    const cheapest = Math.min(...totals);
    pick = windows[totals.findIndex(x => x <= cheapest * 1.08 + 25)].departure;
  }
  const around = pick !== undefined && !opts.departureRange
    ? { min: Math.max(earliest, pick - synodic / 30), max: Math.max(earliest, pick - synodic / 30) + synodic / 15, samples: 9 } : undefined;
  let dep = opts.departureRange ?? around ?? { min: earliest, max: earliest + (opts.window ?? synodic), samples: 25 };
  checkRange(dep); checkRange(tof, true);
  if (dep.min < earliest) throw new RangeError('Departure range starts before the earliest safe node time');
  const depBounds = { ...dep }, tofBounds = { ...tof };
  const parking = length(world.relativeState(wv).position);
  let best: PorkchopPoint | undefined, bestScore = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    report?.('Searching transfer windows', pass / 5);
    for (let i = 0; i < (dep.samples ?? 25); i++) for (let j = 0; j < (tof.samples ?? 25); j++) {
      try {
        const p = point(world, a.id, b.id, dep.min + (dep.max - dep.min) * i / ((dep.samples ?? 25) - 1),
          tof.min + (tof.max - tof.min) * j / ((tof.samples ?? 25) - 1), parking, b.radius + altitude);
        // The parking orbit's plane is fixed: score the real ejection from it, not a coplanar departure.
        const score = ejectionCost(orbit, a.gm, p.departureTime, p.departureExcess, T, 12) + (opts.includeCapture === false ? 0 : p.captureDv);
        if (score < bestScore) { best = p; bestScore = score; }
      } catch { /* Collinear cell; neighbouring cells still cover the transfer window. */ }
    }
    if (!best) return null;
    const dd = (dep.max - dep.min) / ((dep.samples ?? 25) - 1), dt = (tof.max - tof.min) / ((tof.samples ?? 25) - 1);
    dep = { min: Math.max(depBounds.min, best.departureTime - dd), max: Math.min(depBounds.max, best.departureTime + dd), samples: 9 };
    tof = { min: Math.max(tofBounds.min, best.timeOfFlight - dt), max: Math.min(tofBounds.max, best.timeOfFlight + dt), samples: 9 };
  }
  const choice = best!;
  const base = Math.max(depBounds.min, choice.departureTime - T / 2);
  const end = Math.min(depBounds.max, choice.departureTime + T / 2);
  const burn = (t: number) => {
    const p = point(world, a.id, b.id, t, choice.arrivalTime - t, parking, b.radius + altitude);
    const s = propagate(orbit, t);
    return sub(ejectionVelocity(a.gm, s.position, p.departureExcess), s.velocity);
  };
  let time = base, dv = burn(time);
  for (let k = 1; k <= 180; k++) {
    const t = base + (end - base) * k / 180, d = burn(t);
    if (length(d) < length(dv)) { time = t; dv = d; }
  }
  const c = inertialDvToManeuver(propagate(orbit, time), dv);
  report?.('Refining encounter', 0.7);
  const plan = refine(world, orbit, b.id, time, [c.prograde, c.normal, c.radial], choice.arrivalTime, altitude, Infinity, T / 8, depBounds.min, depBounds.max);
  if (!plan) return null;
  return { ...plan, windows, departureTime: plan.node.time, arrivalTime: choice.arrivalTime, timeOfFlight: choice.arrivalTime - plan.node.time,
    departureExcess: choice.departureExcess, arrivalExcess: choice.arrivalExcess, captureDvEstimate: choice.captureDv };
}

export interface CourseCorrectionOptions {
  time?: number;
  /** Estimated periapsis UT, normally taken from the transfer plan. */
  arrivalTime: number;
  periapsisAltitude?: number;
  maxDv?: number;
}
/** Heliocentric correction seeded by Lambert from the vessel's actual position to the planet.
 * The seed aims at the centre; patched-conic refinement moves the aim point to a safe periapsis.
 */
export function planCourseCorrectionToBody(world: PlanningWorld, targetPlanetId: string, opts: CourseCorrectionOptions, report?: PlanningProgressReporter): TransferPlan | null {
  const wv = world.active, u = world.universe;
  if (!wv || wv.body !== u.sunId || u.body(targetPlanetId).parent !== u.sunId)
    throw new RangeError('Course correction requires a heliocentric vessel and a planetary target');
  const time = opts.time ?? world.ut + 600, altitude = opts.periapsisAltitude ?? safeAltitude(world, targetPlanetId);
  if (!Number.isFinite(time) || time <= world.ut || !Number.isFinite(opts.arrivalTime) || opts.arrivalTime <= time ||
    !Number.isFinite(altitude) || altitude <= (u.body(targetPlanetId).atmosphere?.height ?? 0) || !(opts.maxDv === undefined || opts.maxDv > 0))
    throw new RangeError('Invalid correction time, arrival time, periapsis or delta-v limit');
  const orbit = world.orbitOf(wv), s = propagate(orbit, time);
  const end = u.ephem.getRelativeState(targetPlanetId, opts.arrivalTime);
  const lambert = solveLambert(orbit.mu, s.position, end.position, opts.arrivalTime - time);
  const c = inertialDvToManeuver(s, sub(lambert.departureVelocity, s.velocity));
  const maxDv = opts.maxDv ?? 500;
  if (Math.hypot(c.prograde, c.normal, c.radial) > maxDv) return null;
  report?.('Refining course correction', 0.2);
  return refine(world, orbit, targetPlanetId, time, [c.prograde, c.normal, c.radial], opts.arrivalTime, altitude, maxDv);
}

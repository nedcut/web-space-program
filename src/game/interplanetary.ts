/** Impulsive planet-to-planet targeting, followed by full patched-conic encounter refinement. */
import type { World } from './world';
import type { TransferPlan } from './autopilot';
import type { Orbit, TrajectoryPatch } from '../sim/orbit/api';
import { solveLambert, propagate, period, periapsisRadius, predictTrajectory,
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
const safeAltitude = (world: World, id: string) => Math.max(world.universe.body(id).radius * 0.1,
  (world.universe.body(id).atmosphere?.height ?? 0) * 2, 30000);
function planets(world: World, from: string, to: string) {
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
function point(world: World, from: string, to: string, dep: number, tof: number, parking: number, pe: number): PorkchopPoint {
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
export function porkchopGrid(world: World, from: string, to: string, depRange: SearchRange, tofRange: SearchRange): (PorkchopPoint | null)[] {
  const { a, b } = planets(world, from, to);
  checkRange(depRange); checkRange(tofRange, true);
  const parking = world.active?.body === from ? length(world.relativeState(world.active).position) : a.radius + safeAltitude(world, from);
  const result: (PorkchopPoint | null)[] = [];
  for (let i = 0; i < (depRange.samples ?? 25); i++) for (let j = 0; j < (tofRange.samples ?? 25); j++) {
    try { result.push(point(world, from, to,
      depRange.min + (depRange.max - depRange.min) * i / ((depRange.samples ?? 25) - 1),
      tofRange.min + (tofRange.max - tofRange.min) * j / ((tofRange.samples ?? 25) - 1), parking, b.radius + safeAltitude(world, to))); }
    catch { result.push(null); }
  }
  return result;
}

/** Velocity at position r on a hyperbola with the specified outgoing asymptote v∞.
 * The hyperbola's plane contains r and v∞; scanning the parking orbit finds the low-cost ejection angle.
 */
function ejectionVelocity(mu: number, r: Vec3, excess: Vec3): Vec3 {
  const R = length(r), speed = length(excess), q = scale(r, 1 / R), d = normalize(excess);
  const c = dot(q, d);
  const k = speed / 2 + Math.sqrt(speed * speed / 4 + mu / (R * Math.max(1e-12, 1 + c)));
  return add(scale(d, k), scale(q, k - speed));
}

function predict(world: World, orbit: Orbit, time: number, components: number[], horizon: number): TrajectoryPatch[] {
  const s = propagate(orbit, time);
  const dv = maneuverToInertialDv(s, { prograde: components[0], normal: components[1], radial: components[2] });
  return predictTrajectory({ ephem: world.universe.ephem, bodies: world.universe.bodies, initialBody: orbit.body,
    state: { position: s.position, velocity: add(s.velocity, dv) }, t0: time, horizon, maxPatches: orbit.body === world.universe.sunId ? 2 : 3 });
}
/** Continuous-ish miss objective through the SOI edge, then periapsis targeting inside the target SOI. */
function refine(world: World, orbit: Orbit, targetId: string, time: number, initial: number[], arrival: number,
  altitude: number, maxDv = Infinity, timeFreedom = 0, earliest = time, latest = Infinity): TransferPlan | null {
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
      const helio = patches.find(p => p.orbit.body === u.sunId);
      if (!helio) return 1e8;
      const ca = closestApproach(helio.orbit, tt => u.ephem.getRelativeState(targetId, tt), helio.startTime, helio.endTime);
      // A miss outside the SOI must always cost more than a valid near-periapsis encounter.
      return ((ca.distance - goal) / target.soi) ** 2;
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
  const node = world.addNode(t);
  [node.prograde, node.normal, node.radial] = res.x;
  return { node, patches, encounterTime: enc.startTime, periapsisAltitude: periapsisRadius(enc.orbit) - target.radius,
    dv: Math.hypot(...res.x.slice(0, 3)) };
}

/** Search a departure × flight-time grid, refine its minimum, convert v∞ to an inclined parking-orbit
 * ejection, then target the actual SOI encounter. Adds exactly one node on success, none on failure.
 * Moon departure is deliberately unsupported; first escape into a bound planetary parking orbit.
 */
export function planInterplanetaryTransfer(world: World, targetPlanetId: string, opts: InterplanetaryOptions = {}): InterplanetaryPlan | null {
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
  let dep = opts.departureRange ?? { min: earliest, max: earliest + (opts.window ?? 2 * Math.PI / Math.abs(na - nb)), samples: 25 };
  let tof = opts.timeOfFlightRange ?? { min: hohmann * 0.65, max: hohmann * 1.35, samples: 25 };
  checkRange(dep); checkRange(tof, true);
  if (dep.min < earliest) throw new RangeError('Departure range starts before the earliest safe node time');
  const depBounds = { ...dep }, tofBounds = { ...tof };
  const parking = length(world.relativeState(wv).position);
  let best: PorkchopPoint | undefined, bestScore = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < (dep.samples ?? 25); i++) for (let j = 0; j < (tof.samples ?? 25); j++) {
      try {
        const p = point(world, a.id, b.id, dep.min + (dep.max - dep.min) * i / ((dep.samples ?? 25) - 1),
          tof.min + (tof.max - tof.min) * j / ((tof.samples ?? 25) - 1), parking, b.radius + altitude);
        const score = p.departureDv + (opts.includeCapture === false ? 0 : p.captureDv);
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
  const plan = refine(world, orbit, b.id, time, [c.prograde, c.normal, c.radial], choice.arrivalTime, altitude, Infinity, T / 8, depBounds.min, depBounds.max);
  if (!plan) return null;
  return { ...plan, departureTime: plan.node.time, arrivalTime: choice.arrivalTime, timeOfFlight: choice.arrivalTime - plan.node.time,
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
export function planCourseCorrectionToBody(world: World, targetPlanetId: string, opts: CourseCorrectionOptions): TransferPlan | null {
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
  return refine(world, orbit, targetPlanetId, time, [c.prograde, c.normal, c.radial], opts.arrivalTime, altitude, maxDv);
}

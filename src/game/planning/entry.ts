/**
 * Entry corridor and "Entry trim" planning (headless; runs in the planner worker).
 *
 * A one-pass entry is modelled as a point mass flying the vacuum conic's energy and angular momentum into the
 * atmosphere with drag only (`dragPerMass` = C_d·A / m at hypersonic speed, measured from the vessel's own aero model
 * in its retrograde attitude). The corridor is the band of vacuum periapsis altitudes between "too steep" (peak
 * deceleration above `gLimit`) and "too shallow" (the pass leaves the atmosphere again: a skip). Heating is not
 * modelled; the planned point is the 25 kPa design pressure, clamped inside the corridor. With no fitted constants it
 * matches the full rigid-body integrator's skip edge to ~0.5 km and peak g to ~10% (tests/entry-trim.test.ts).
 */
import type { ManeuverNode, StateVector, TrajectoryPatch } from '../../sim/orbit/api';
import type { Body } from '../../sim/bodies/types';
import type { VesselState } from '../../sim/vessel/runtime';
import { sampleAtmosphere } from '../../sim/atmosphere';
import { computeAeroForces } from '../../sim/vessel/aero';
import { cloneVessel } from '../../sim/vessel/assembly';
import { activateNextStage } from '../../sim/vessel/staging';
import { maneuverToInertialDv, periapsisRadius, predictTrajectory, propagate, timeToApoapsis, timeToPeriapsis } from '../../sim/orbit';
import { add } from '../../util/vec3';
import type { PlanningWorld } from './context';
import { ENTRY_DYNAMIC_PRESSURE } from './arrival';

const G0 = 9.80665;
/** Default peak deceleration for the steep edge (crewed capsules; the same limit is used for probes). */
export const ENTRY_G_LIMIT = 10;
/** The planned periapsis keeps at least these fractions of the corridor's width from its skip and steep edges. */
const SKIP_MARGIN = 0.15, STEEP_MARGIN = 0.25;

type EntryBody = Pick<Body, 'radius' | 'gm' | 'atmosphere' | 'surfaceGravity'>;

export interface EntryPass { captured: boolean; peakG: number }

/**
 * Fly one pass of a conic with periapsis radius `rp` and specific orbital energy `energy` (J/kg) through the
 * atmosphere: captured when it gets deep (10% of the atmosphere height) instead of climbing back out.
 */
export function entryPass(body: EntryBody, rp: number, energy: number, dragPerMass: number): EntryPass {
  const atmo = body.atmosphere;
  if (!atmo) return { captured: false, peakG: 0 };
  const top = body.radius + atmo.height, mu = body.gm;
  if (rp >= top) return { captured: false, peakG: 0 };
  const vp2 = 2 * (energy + mu / rp);
  if (vp2 <= 0) return { captured: true, peakG: 0 };
  const h = rp * Math.sqrt(vp2);
  // Start at the interface on the inbound branch: polar state (r, radial and tangential speed).
  let x = top, y = 0;
  const v0 = Math.sqrt(Math.max(0, 2 * (energy + mu / top)));
  let vx = -Math.sqrt(Math.max(0, v0 * v0 - (h / top) ** 2)), vy = h / top;
  const floor = body.radius + atmo.height * 0.1;
  let peak = 0;
  const accel = (px: number, py: number, qx: number, qy: number, out: number[]) => {
    const r = Math.hypot(px, py), v = Math.hypot(qx, qy);
    const rho = sampleAtmosphere(atmo, r - body.radius, body.surfaceGravity).density;
    const d = 0.5 * rho * v * dragPerMass;
    const g = mu / (r * r * r);
    out[0] = -g * px - d * qx; out[1] = -g * py - d * qy; out[2] = d * v;
  };
  const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
  // Fixed RK4 steps of ~1/400 of the pass time across the atmosphere's depth; drag-limited near the bottom.
  const dt = Math.max(0.05, Math.min(2, atmo.height / Math.sqrt(vp2) / 40));
  for (let i = 0; i < 200000; i++) {
    accel(x, y, vx, vy, k1);
    accel(x + vx * dt / 2, y + vy * dt / 2, vx + k1[0] * dt / 2, vy + k1[1] * dt / 2, k2);
    accel(x + (vx + k1[0] * dt / 2) * dt / 2, y + (vy + k1[1] * dt / 2) * dt / 2, vx + k2[0] * dt / 2, vy + k2[1] * dt / 2, k3);
    accel(x + (vx + k2[0] * dt / 2) * dt, y + (vy + k2[1] * dt / 2) * dt, vx + k3[0] * dt, vy + k3[1] * dt, k4);
    x += dt * (vx + dt * (k1[0] + k2[0] + k3[0]) / 6);
    y += dt * (vy + dt * (k1[1] + k2[1] + k3[1]) / 6);
    vx += dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    vy += dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    peak = Math.max(peak, k1[2] / G0);
    const r = Math.hypot(x, y);
    if (r < floor) return { captured: true, peakG: peak };
    if (r > top && x * vx + y * vy > 0) return { captured: false, peakG: peak };
  }
  return { captured: true, peakG: peak };
}

export interface EntryCorridor {
  /** Lowest safe vacuum periapsis altitude (below it: peak deceleration above the limit), m. */
  steep: number;
  /** Highest periapsis altitude that still captures in one pass (above it: skip), m. */
  shallow: number;
  /** Planned periapsis altitude, m. */
  target: number;
  gLimit: number;
}

/** Corridor for an arrival with specific energy `energy` at `body`; null when even the deepest pass skips. */
export function entryCorridor(body: EntryBody, energy: number, dragPerMass: number, gLimit = ENTRY_G_LIMIT): EntryCorridor | null {
  const atmo = body.atmosphere;
  if (!atmo) return null;
  const pass = (alt: number) => entryPass(body, body.radius + alt, energy, dragPerMass);
  // Skip edge: captured below, skipping above. Bisection on altitude.
  let lo = 0, hi = atmo.height;
  if (!pass(lo).captured) return null;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (pass(m).captured) lo = m; else hi = m; }
  const shallow = lo;
  // Steep edge: highest altitude below the skip edge whose peak g exceeds the limit (g falls as periapsis rises).
  let sLo = 0, sHi = shallow;
  if (pass(0).peakG <= gLimit) sHi = 0;
  else for (let i = 0; i < 24; i++) { const m = (sLo + sHi) / 2; if (pass(m).peakG > gLimit) sLo = m; else sHi = m; }
  const steep = sHi;
  // Aim at the lunar-return design pressure (validated in flight on every scale, and gentle on exposed instruments:
  // a side-mounted thermometer overheats at ~29 kPa), kept well inside this vessel's corridor.
  const q = (alt: number) => 0.5 * sampleAtmosphere(atmo, alt, body.surfaceGravity).density * 2 * (energy + body.gm / (body.radius + alt));
  let dLo = 0, dHi = atmo.height;
  for (let i = 0; i < 40; i++) { const m = (dLo + dHi) / 2; if (q(m) > ENTRY_DYNAMIC_PRESSURE) dLo = m; else dHi = m; }
  const width = shallow - steep;
  const target = Math.min(shallow - SKIP_MARGIN * width, Math.max(steep + STEEP_MARGIN * width, (dLo + dHi) / 2));
  return { steep, shallow, target, gLimit };
}

/** Where a vacuum periapsis altitude sits in a corridor. */
export function corridorZone(c: EntryCorridor, pe: number): 'steep' | 'ok' | 'shallow' {
  return pe < c.steep ? 'steep' : pe > c.shallow ? 'shallow' : 'ok';
}

/**
 * Drag per mass of what will enter: a copy of the vessel with every remaining stage fired (a capsule drops its service
 * stage before entry). Vessels without stages are measured whole.
 */
export function enteringDragPerMass(v: VesselState): number {
  if (v.nextStage < 0) return entryDragPerMass(v);
  const c = cloneVessel(v);
  for (let i = 0; i < 32 && c.nextStage >= 0; i++) activateNextStage(c);
  return entryDragPerMass(c);
}

/**
 * Hypersonic C_d·A / m of a vessel flying retrograde (engines or heat shield first), from the same per-part aero
 * model as the flight integrator (blunt heat-shield faces included).
 */
export function entryDragPerMass(v: VesselState): number {
  const speed = 3000;
  const air = { density: 1e-3, pressure: 1, temperature: 250, speedOfSound: 300 };
  const r = computeAeroForces(v, { air, airVelocityBody: { x: 0, y: -speed, z: 0 }, control: { x: 0, y: 0, z: 0 } });
  const f = Math.hypot(r.forceBody.x, r.forceBody.y, r.forceBody.z);
  return v.mass > 0 ? f / (0.5 * air.density * speed * speed * v.mass) : 0;
}

export interface EntryReturn {
  /** Index of the patch around the atmospheric body that reaches its periapsis. */
  index: number;
  body: string;
  /** Vacuum periapsis altitude, m. */
  periapsis: number;
  /** Specific orbital energy of the arrival, J/kg. */
  energy: number;
  /** UT of the vacuum periapsis. */
  periapsisTime: number;
}

/**
 * The first predicted patch that comes down into an atmosphere: its periapsis is ahead, inside the patch, and in
 * the air (arrivals: below twice the atmosphere's height). Null when the trajectory does not come down.
 */
export function findEntry(patches: readonly TrajectoryPatch[], body: (id: string) => EntryBody): EntryReturn | null {
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i], b = body(p.orbit.body);
    if (!b.atmosphere) continue;
    const o = p.orbit, rp = periapsisRadius(o);
    // Arrivals from another sphere of influence (or fast, eccentric returns) are trimmed from up to twice the
    // atmosphere's height; an ordinary orbit only once its periapsis is in the air (a parking orbit is not an entry).
    const arriving = o.e >= 0.5 || (i > 0 && (patches[i - 1].endReason === 'soiExit' || patches[i - 1].endReason === 'soiEnter'));
    if (rp - b.radius > b.atmosphere.height * (arriving ? 2 : 1)) continue;
    const toPe = timeToPeriapsis(o, p.startTime);
    // Outbound hyperbola/ellipse already past periapsis within this patch: not an arrival.
    if (!Number.isFinite(toPe) || (o.e >= 1 && toPe < 0)) continue;
    const tPe = p.startTime + (toPe < 0 ? toPe + 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu) : toPe);
    if (p.endReason !== 'impact' && p.endReason !== 'horizon' && tPe > p.endTime + 1) continue;
    return { index: i, body: o.body, periapsis: rp - b.radius, energy: -o.mu / (2 * o.a), periapsisTime: tPe };
  }
  return null;
}

export interface EntryTrimPlan {
  node: ManeuverNode;
  dv: number;
  body: string;
  corridor: EntryCorridor;
  /** Vacuum periapsis altitude now (with existing nodes) and after the trim, m. */
  before: number;
  after: number;
  /** UT of the periapsis after the trim. */
  entryTime: number;
}

export interface EntryTrimOptions { dragPerMass: number; gLimit?: number }

/**
 * Smallest burn that moves the returning trajectory's periapsis to the corridor's planned altitude. Candidate burn
 * times: in two minutes (after any existing nodes), just after entering the atmospheric body's sphere of influence,
 * and at the return leg's apoapsis; at each, a minimum-norm Newton solve over (prograde, normal, radial). The
 * cheapest wins. Existing nodes are kept and flown first.
 */
export function planEntryTrim(world: PlanningWorld, nodes: readonly ManeuverNode[], opts: EntryTrimOptions,
  report?: (phase: string, fraction: number) => void): EntryTrimPlan | null {
  const u = world.universe, wv = world.active;
  if (!wv) return null;
  const state = world.relativeState(wv), t0 = world.ut;
  const bodyOf = (id: string) => u.body(id);
  const horizon = 40 * 86400;
  const predict = (from: { body: string; state: StateVector; t: number }, maneuvers: readonly ManeuverNode[]) =>
    predictTrajectory({ ephem: u.ephem, bodies: u.bodies, initialBody: from.body, state: from.state, t0: from.t, horizon, maxPatches: 6, maneuvers: [...maneuvers] });
  report?.('Finding the entry', 0.05);
  const base = predict({ body: wv.body, state, t: t0 }, nodes);
  const entry = findEntry(base, bodyOf);
  if (!entry) return null;
  const target = u.body(entry.body);
  const corridor = entryCorridor(target, entry.energy, opts.dragPerMass, opts.gLimit);
  if (!corridor) return null;
  report?.('Corridor', 0.3);
  const last = Math.max(t0, ...nodes.map(n => n.time));
  const latest = entry.periapsisTime - Math.max(600, (entry.periapsisTime - last) * 0.05);
  const times = new Set<number>([last + 120]);
  const arrival = base[entry.index];
  if (arrival.startTime > last + 120) times.add(arrival.startTime + 600);
  const ta = timeToApoapsis(arrival.orbit, arrival.startTime);
  if (arrival.orbit.e < 1 && Number.isFinite(ta) && arrival.startTime + ta > last + 120 && arrival.startTime + ta < entry.periapsisTime) times.add(arrival.startTime + ta);
  // Periapsis after a burn at `t` (relative to the patch flown at t), or null if it no longer comes down there.
  const stateAt = (t: number) => {
    const patch = base.find(p => p.startTime <= t && t <= p.endTime && p.endReason !== 'maneuver') ?? base.findLast(p => p.startTime <= t);
    return patch ? { body: patch.orbit.body, s: propagate(patch.orbit, t) } : null;
  };
  const periapsisAfter = (t: number, at: { body: string; s: StateVector }, x: number[]) => {
    const dv = maneuverToInertialDv(at.s, { prograde: x[0], normal: x[1], radial: x[2] });
    const patches = predict({ body: at.body, state: { position: at.s.position, velocity: add(at.s.velocity, dv) }, t }, []);
    const e = findEntry(patches, bodyOf);
    return e && e.body === entry.body ? e : null;
  };
  let best: { t: number; x: number[]; e: EntryReturn } | null = null;
  const list = [...times].filter(t => t < latest).sort((a, b) => a - b);
  list.forEach((t, k) => {
    report?.('Trimming', 0.3 + 0.7 * k / Math.max(1, list.length));
    const at = stateAt(t);
    if (!at) return;
    const x = [0, 0, 0];
    let e = periapsisAfter(t, at, x);
    for (let it = 0; it < 12 && e; it++) {
      const f = e.periapsis - corridor.target;
      if (Math.abs(f) < 100) break;
      // Finite-difference gradient (m of periapsis per m/s), step scaled to the residual.
      const h = Math.min(1, Math.max(0.01, Math.abs(f) / 2e5));
      const g = [0, 1, 2].map(i => { const y = [...x]; y[i] += h; const ei = periapsisAfter(t, at, y); return ei ? (ei.periapsis - e!.periapsis) / h : 0; });
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (!(g2 > 0)) { e = null; break; }
      let step = 1, next: EntryReturn | null = null, y = x;
      for (; step > 1 / 64; step /= 2) {
        y = x.map((xi, i) => xi - step * f * g[i] / g2);
        next = periapsisAfter(t, at, y);
        if (next && Math.abs(next.periapsis - corridor.target) < Math.abs(f)) break;
      }
      if (!next || Math.abs(next.periapsis - corridor.target) >= Math.abs(f)) break;
      x.splice(0, 3, ...y); e = next;
    }
    if (!e || corridorZone(corridor, e.periapsis) !== 'ok') return;
    if (!best || Math.hypot(...x) < Math.hypot(...best.x) - 0.01) best = { t, x, e };
  });
  if (!best) return null;
  const { t, x, e } = best as { t: number; x: number[]; e: EntryReturn };
  const node = world.addNode(t);
  node.prograde = x[0]; node.normal = x[1]; node.radial = x[2];
  return { node, dv: Math.hypot(x[0], x[1], x[2]), body: entry.body, corridor, before: entry.periapsis, after: e.periapsis, entryTime: e.periapsisTime };
}

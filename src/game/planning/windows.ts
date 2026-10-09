/**
 * Departure windows for transfers between a body and one of its moons (either way), estimated from Lambert arcs
 * that leave the vessel's actual orbit in any plane. These are cheap enough to scan a whole lunar month, so the
 * planner can offer "go now (with a plane change)" next to the cheaper windows and their waits, and seed the
 * patched-conic refinement of whichever the player picks.
 */
import type { PlanningWorld } from './context';
import type { Orbit } from '../../sim/orbit/api';
import { propagate, period, solveLambertAround, inertialDvToManeuver } from '../../sim/orbit';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../../util/vec3';
import { nelderMead } from '../../util/nelderMead';
import { ejectionVelocity } from '../interplanetary';

/** One departure option. Δv is an estimate (impulsive, aimed at the target's centre or on a direct return). */
export interface TransferWindow {
  /** Departure UT. */
  departure: number;
  /** Seconds from the planning time to the departure. */
  wait: number;
  /** Estimated departure Δv, m/s. */
  dv: number;
  /** Estimated capture Δv into a circular orbit at arrival, m/s (interplanetary options rank by departure + capture). */
  captureDv?: number;
  /** Estimated flight time to the target (its SOI edge for a return), s. */
  timeOfFlight: number;
  /** 'now' is the cheapest departure within the next revolution; 'window' a later local minimum. */
  kind: 'now' | 'window';
  /** Maneuver components (prograde, normal, radial) seeding the refinement. */
  seed: [number, number, number];
}

interface Sample { t: number; dv: number; tof: number; seed: [number, number, number]; capture?: number }

/** Lambert estimate from the vessel's orbit at `t` to a moon's centre, best over a few flight times. */
/** Apoapsis radius of the conic through (r, v); Infinity when unbound. */
function apoapsis(mu: number, r: Vec3, v: Vec3): number {
  const energy = dot(v, v) / 2 - mu / length(r);
  if (energy >= 0) return Infinity;
  const a = -mu / (2 * energy), h = length(cross(r, v));
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (mu * a)));
  return a * (1 + e);
}

const TOF_SCALES = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6];
function outbound(o: Orbit, world: PlanningWorld, targetId: string, t: number, tofs?: number[], captureRadius?: number): Sample | null {
  const s = propagate(o, t);
  const h = cross(s.position, s.velocity);
  const hohmann = tofOf(o, world, targetId, t);
  const soi = world.universe.body(o.body).soi;
  let best: Sample | null = null;
  for (const tof of tofs ?? TOF_SCALES.map(f => f * hohmann)) {
    if (!(tof > 0)) continue;
    try {
      const target = world.universe.body(targetId);
      const end = world.universe.ephem.getRelativeState(targetId, t + tof);
      const arc = solveLambertAround(o.mu, s.position, end.position, tof, h);
      const v1 = arc.departureVelocity;
      // Arcs that leave the central body's SOI before arriving are not transfers in patched conics.
      if (apoapsis(o.mu, s.position, v1) > 0.95 * soi) continue;
      const dvv = sub(v1, s.velocity), dv = length(dvv);
      if (!best || dv < best.dv) {
        const c = inertialDvToManeuver(s, dvv);
        const rp = captureRadius ?? target.radius + 30000;
        const excess = length(sub(arc.arrivalVelocity, end.velocity));
        const capture = Math.sqrt(excess * excess + 2 * target.gm / rp) - Math.sqrt(target.gm / rp);
        best = { t, dv, tof, capture, seed: [c.prograde, c.normal, c.radial] };
      }
    } catch { /* collinear or unbracketed arc: neighbouring flight times cover it */ }
  }
  return best;
}

/**
 * Escape estimate from a moon's orbit at `t` back to its parent with the given periapsis radius: the return
 * orbit leaves the moon's distance in any plane through the parent-moon line (angle `phi`) with any radial speed,
 * and the hyperbolic excess it needs is ejected from the vessel's position at `t`.
 */
function homeward(o: Orbit, world: PlanningWorld, parentId: string, moonId: string, peGoal: number, t: number, phi: number, radial: number): Sample | null {
  const u = world.universe, mu = u.body(parentId).gm;
  const m = u.ephem.getRelativeState(moonId, t);
  const rc = length(m.position);
  const q = normalize(m.position);
  // Transverse basis around the parent-moon line, phi = 0 along the moon's own motion.
  const e1 = normalize(sub(m.velocity, scale(q, dot(m.velocity, q))));
  const e2 = cross(q, e1);
  const vt = Math.sqrt((2 * mu * peGoal) / (rc * (rc + peGoal)));
  // Any radial speed keeps the periapsis: only the transverse speed (angular momentum) sets it.
  const need = add(scale(add(scale(e1, Math.cos(phi)), scale(e2, Math.sin(phi))), vt), scale(q, radial));
  const excess = sub(need, m.velocity);
  const s = propagate(o, t);
  const dvv = sub(ejectionVelocity(o.mu, s.position, excess), s.velocity);
  const dv = length(dvv);
  if (!Number.isFinite(dv)) return null;
  const c = inertialDvToManeuver(s, dvv);
  const tof = Math.PI * Math.sqrt(((rc + peGoal) / 2) ** 3 / mu);
  return { t, dv, tof, capture: Math.sqrt(Math.max(0, dot(need, need) + 2 * mu * (1 / peGoal - 1 / rc))) - Math.sqrt(mu / peGoal), seed: [c.prograde, c.normal, c.radial] };
}

/** Group samples by revolution: the cheapest of the first revolution is "now"; later local minima are windows. */
function pickWindows(samples: Sample[], earliest: number, revolution: number, now: number, max: number): TransferWindow[] {
  if (!samples.length) return [];
  const buckets: Sample[] = [];
  for (const s of samples) {
    const k = Math.floor((s.t - earliest) / revolution);
    if (!buckets[k] || s.dv < buckets[k].dv) buckets[k] = s;
  }
  const dense = buckets.filter(Boolean);
  const out: TransferWindow[] = [];
  const add = (s: Sample, kind: TransferWindow['kind']) => out.push({ departure: s.t, wait: s.t - now, dv: s.dv, timeOfFlight: s.tof, captureDv: s.capture, kind, seed: s.seed });
  add(dense[0], 'now');
  const minima: Sample[] = [];
  for (let i = 1; i < dense.length; i++) {
    const prev = dense[i - 1].dv, next = dense[i + 1]?.dv ?? Infinity;
    if (dense[i].dv <= prev && dense[i].dv <= next && dense[i].dv < dense[0].dv - 1) minima.push(dense[i]);
  }
  // Keep the cheapest few (and always the overall best), listed in time order.
  minima.sort((a, b) => a.dv - b.dv);
  for (const s of minima.slice(0, max - 1).sort((a, b) => a.t - b.t)) add(s, 'window');
  return out;
}

/** Polish a sampled departure over (time, flight time) by simplex. */
function polishOutbound(o: Orbit, world: PlanningWorld, targetId: string, s: Sample, step: number, earliest: number, latest: number, captureRadius?: number): Sample {
  let best = s;
  const cost = (x: number[]) => {
    const t = s.t + x[0];
    if (t < earliest || t > latest) return 1e9;
    const r = outbound(o, world, targetId, t, [s.tof * x[1]], captureRadius);
    if (r && r.dv < best.dv) best = r;
    return r ? r.dv : 1e9;
  };
  nelderMead(cost, [0, 1], [step / 2, 0.08], 80);
  return best;
}
function tofOf(o: Orbit, world: PlanningWorld, targetId: string, t: number) {
  const r = length(propagate(o, t).position), rT = length(world.universe.ephem.getRelativeState(targetId, t).position);
  return Math.PI * Math.sqrt(((r + rT) / 2) ** 3 / o.mu);
}

export interface WindowSearch {
  /** Earliest departure UT. */
  earliest: number;
  /** Search span, s (default: one target orbital period outbound, one parking revolution home). */
  span?: number;
  /** Periapsis radius sought at the parent when going home, m. */
  periapsisRadius?: number;
  /** Most options returned (default 4). */
  max?: number;
}

/** Departure options from the active vessel's orbit to `targetId` (a moon of its body, or its parent). */
export function transferWindows(world: PlanningWorld, targetId: string, search: WindowSearch): TransferWindow[] {
  const wv = world.active;
  if (!wv) return [];
  const u = world.universe, o = world.orbitOf(wv), central = u.body(o.body), target = u.body(targetId);
  const T = period(o);
  const closed = Number.isFinite(T);
  const max = search.max ?? 4;
  if (target.parent === central.id) {
    const span = search.span ?? (target.orbitalPeriod ?? 10 * (closed ? T : 3600)) * 1.02;
    const revolution = closed ? T : span;
    const step = closed ? T / 18 : span / 60;
    const samples: Sample[] = [];
    for (let t = search.earliest; t <= search.earliest + span; t += step) {
      const s = outbound(o, world, targetId, t, undefined, search.periapsisRadius);
      if (s) samples.push(s);
    }
    return pickWindows(samples, search.earliest, revolution, world.ut, max)
      .map(w => {
        const p = polishOutbound(o, world, targetId, { t: w.departure, dv: w.dv, tof: w.timeOfFlight, seed: w.seed, capture: w.captureDv }, step, search.earliest, search.earliest + (w.kind === 'now' ? Math.min(revolution, span) : span), search.periapsisRadius);
        return { ...w, departure: p.t, wait: p.t - world.ut, dv: p.dv, captureDv: p.capture, timeOfFlight: p.tof, seed: p.seed };
      });
  }
  if (central.parent === targetId && closed) {
    const peGoal = search.periapsisRadius ?? target.radius + (target.atmosphere ? target.atmosphere.height * 0.5 : 30000);
    const vMoon = length(u.ephem.getRelativeState(central.id, search.earliest).velocity);
    // A fixed parking plane lines up with the way home twice a month: scan half of it, one revolution at a time.
    const span = search.span ?? Math.max(T, 0.5 * (central.orbitalPeriod ?? T));
    const coarse = (t: number, fine: boolean) => {
      let best: (Sample & { phi: number; vr: number }) | null = null;
      const phis = fine ? 24 : 12;
      const radials = (fine ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.3, 0, 0.3]).map(f => f * vMoon);
      for (let j = 0; j < phis; j++) for (const vr of radials) {
        const phi = (2 * Math.PI * j) / phis;
        const s = homeward(o, world, targetId, central.id, peGoal, t, phi, vr);
        if (s && (!best || s.dv < best.dv)) best = { ...s, phi, vr };
      }
      return best;
    };
    const samples: (Sample & { phi: number; vr: number })[] = [];
    const perRev = span > 3 * T ? 24 : 96;
    for (let t = search.earliest; t <= search.earliest + span; t += T / perRev) {
      const s = coarse(t, span <= 3 * T);
      if (s) samples.push(s);
    }
    const polish = (w: TransferWindow): TransferWindow => {
      const start = samples.reduce((x, y) => (Math.abs(y.t - w.departure) < Math.abs(x.t - w.departure) ? y : x));
      let best: Sample = start;
      const arg = coarse(start.t, true) ?? start;
      if (arg.dv < best.dv) best = arg;
      nelderMead(x => {
        const t = arg.t + x[0];
        if (t < search.earliest || t > search.earliest + (w.kind === 'now' ? T : span)) return 1e9;
        const s = homeward(o, world, targetId, central.id, peGoal, t, arg.phi + x[1], arg.vr + x[2]);
        if (s && s.dv < best.dv) best = s;
        return s ? s.dv : 1e9;
      }, [0, 0, 0], [T / 96, 0.13, 0.1 * vMoon], 120);
      return { ...w, departure: best.t, wait: best.t - world.ut, dv: best.dv, captureDv: best.capture, timeOfFlight: best.tof, seed: best.seed };
    };
    return pickWindows(samples, search.earliest, T, world.ut, max).map(polish);
  }
  return [];
}

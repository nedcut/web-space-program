import type { Body } from '../bodies/types';
import type { Ephemeris } from './ephemeris';
import { solveLambert } from './lambert';
import { length, sub } from '../../util/vec3';

/** A planet-to-planet launch season: when the Hohmann phase angle next comes round. */
export interface LaunchSeason {
  /** UT when the phase angle is right. */
  departure: number;
  /** Seconds from `ut` to `departure`. */
  wait: number;
  /** Hohmann flight time, s. */
  timeOfFlight: number;
  /** Time between seasons, s. */
  synodic: number;
}

/**
 * Next launch season from planet `from` to planet `to` (both orbiting the same star). The Hohmann phase angle
 * (from the real heliocentric longitudes) brackets it; a small Lambert scan around that date then picks the
 * departure needing the least departure + capture Δv from and into low orbits, as eccentric orbits shift it by weeks.
 * Guidance only (a few ms): the map planner plans the actual burn from the parking orbit.
 */
export function nextLaunchSeason(bodies: Map<string, Body>, ephem: Ephemeris, from: string, to: string, ut: number): LaunchSeason | null {
  const a = bodies.get(from), b = bodies.get(to);
  if (!a?.orbit || !b?.orbit || a.parent !== b.parent || from === to) return null;
  const mu = bodies.get(a.parent!)!.gm;
  const na = Math.sqrt(mu / a.orbit.a ** 3), nb = Math.sqrt(mu / b.orbit.a ** 3);
  const timeOfFlight = Math.PI * Math.sqrt(((a.orbit.a + b.orbit.a) / 2) ** 3 / mu);
  const synodic = 2 * Math.PI / Math.abs(na - nb);
  const lead = Math.PI - nb * timeOfFlight;
  const longitude = (id: string, t: number) => { const p = ephem.getRelativeState(id, t).position; return Math.atan2(p.y, p.x); };
  const wrap = (x: number) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
  const error = (t: number) => wrap(longitude(to, t) - longitude(from, t) - lead);
  // The error drifts at the relative rate; a crossing of zero in that direction (not the ±π wrap) is the season.
  const sign = Math.sign(nb - na);
  const step = synodic / 180;
  let t0 = ut, e0 = error(t0);
  for (let k = 0; k < 400; k++) {
    const t1 = t0 + step, e1 = error(t1);
    if (Math.sign(e0) === -sign && Math.sign(e1) !== -sign && Math.abs(e1 - e0) < Math.PI) {
      let lo = t0, hi = t1;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Math.sign(error(m)) === -sign) lo = m; else hi = m; }
      return refineSeason(ephem, mu, a, b, ut, hi, timeOfFlight, synodic);
    }
    t0 = t1; e0 = e1;
  }
  return null;
}

/** Burn from / into a low circular orbit (10 % of the radius up) for a hyperbolic excess `vInf`. */
const lowOrbitBurn = (body: Body, vInf: number) => {
  const r = body.radius * 1.1;
  return Math.sqrt(vInf * vInf + 2 * body.gm / r) - Math.sqrt(body.gm / r);
};

function refineSeason(ephem: Ephemeris, mu: number, from: Body, to: Body, ut: number, guess: number, hohmann: number, synodic: number): LaunchSeason {
  let best = { departure: guess, timeOfFlight: hohmann, cost: Infinity };
  const span = synodic / 6;
  for (let i = 0; i <= 24; i++) {
    const dep = Math.max(ut, guess - span + (2 * span * i) / 24);
    const a = ephem.getRelativeState(from.id, dep);
    for (let j = 0; j <= 8; j++) {
      const tof = hohmann * (0.75 + (0.5 * j) / 8), b = ephem.getRelativeState(to.id, dep + tof);
      try {
        const l = solveLambert(mu, a.position, b.position, tof);
        const cost = lowOrbitBurn(from, length(sub(l.departureVelocity, a.velocity))) + lowOrbitBurn(to, length(sub(l.arrivalVelocity, b.velocity)));
        if (cost < best.cost) best = { departure: dep, timeOfFlight: tof, cost };
      } catch { /* Collinear arc; neighbours cover it. */ }
    }
  }
  return { departure: best.departure, wait: best.departure - ut, timeOfFlight: best.timeOfFlight, synodic };
}

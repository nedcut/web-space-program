/**
 * Adaptive conic sampling for map lines (pure: no three.js, no DOM).
 *
 * Uniform-in-time samples crowd the slow apoapsis of an eccentric orbit and leave visible straight chords around
 * periapsis and along hyperbolic flybys. Here an interval is split whenever the polyline would turn by more than
 * `maxTurn` at its midpoint, so curvature (not time) decides where the vertices go and the drawn curve stays smooth
 * at any zoom level.
 */
import type { Orbit } from '../../sim/orbit/api';
import { elementsToState, period } from '../../sim/orbit/kepler';
import type { Vec3 } from '../../util/vec3';

export interface AdaptiveOptions {
  /** Uniform samples before refinement (default 160). */
  initial?: number;
  /** Hard cap on returned points (default 3000). */
  maxPoints?: number;
  /** Largest turn between consecutive segments, radians (default 1.2°). */
  maxTurn?: number;
  /** Recursion depth limit per initial interval (default 10). */
  maxDepth?: number;
}

function turn(a: Vec3, m: Vec3, b: Vec3): number {
  const ux = m.x - a.x, uy = m.y - a.y, uz = m.z - a.z, vx = b.x - m.x, vy = b.y - m.y, vz = b.z - m.z;
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
  if (!(lu > 0 && lv > 0)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv))));
}

/** Sample `at(t)` on [t0, t1], refining where the curve bends. Returns points in time order. */
export function adaptiveSamples(at: (t: number) => Vec3, t0: number, t1: number, opts: AdaptiveOptions = {}): Vec3[] {
  const initial = Math.max(2, opts.initial ?? 160), maxPoints = opts.maxPoints ?? 3000;
  const maxTurn = opts.maxTurn ?? 1.2 * Math.PI / 180, maxDepth = opts.maxDepth ?? 10;
  const out: Vec3[] = [];
  if (!(t1 > t0)) { out.push(at(t0)); return out; }
  let budget = maxPoints - initial - 1;
  const refine = (ta: number, a: Vec3, tb: number, b: Vec3, depth: number) => {
    if (depth >= maxDepth || budget <= 0) { out.push(b); return; }
    const tm = (ta + tb) / 2, m = at(tm);
    if (turn(a, m, b) <= maxTurn) { out.push(b); return; }
    budget--;
    refine(ta, a, tm, m, depth + 1);
    refine(tm, m, tb, b, depth + 1);
  };
  let ta = t0, a = at(t0);
  out.push(a);
  for (let i = 1; i <= initial; i++) {
    const tb = t0 + (t1 - t0) * i / initial, b = at(tb);
    // The midpoint test also needs the neighbouring segment: an initial interval can straddle periapsis.
    refine(ta, a, tb, b, 0);
    ta = tb; a = b;
  }
  return out;
}

/** First time after `from` when an orbit leaves radius `soi` (Infinity when it never does). */
export function soiExitTime(o: Orbit, soi: number, from: number): number {
  if (!Number.isFinite(soi)) return Infinity;
  if (o.e < 1 && o.a * (1 + o.e) < soi) return Infinity;
  const r = (t: number) => { const p = elementsToState(o, t).position; return Math.hypot(p.x, p.y, p.z); };
  if (r(from) >= soi) return from;
  const T = period(o);
  let lo = from, step = Number.isFinite(T) ? T / 64 : Math.max(60, Math.sqrt(soi ** 3 / o.mu) / 64), hi = from + step;
  for (let i = 0; i < 400 && r(hi) < soi; i++) { lo = hi; step *= 1.25; hi += step; }
  if (r(hi) < soi) return Infinity;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (r(mid) < soi) lo = mid; else hi = mid; }
  return hi;
}

/**
 * Sample a conic in its parent's frame. `t1 === null` draws a closed ellipse (one full revolution) or, for open
 * conics, the arc until the orbit leaves the SOI. Hyperbolic and escaping arcs are clipped at the SOI radius.
 */
export function sampleConic(o: Orbit, soi: number, t0: number, t1: number | null, opts: AdaptiveOptions = {}): Vec3[] {
  const at = (t: number) => elementsToState(o, t).position;
  const T = period(o);
  let end: number;
  if (t1 === null) {
    const exit = soiExitTime(o, soi, t0);
    end = Number.isFinite(exit) ? exit : Number.isFinite(T) ? t0 + T : t0 + 1e7;
  } else end = Math.min(t1, soiExitTime(o, soi, t0));
  if (!(end > t0)) end = t0 + 1;
  const pts = adaptiveSamples(at, t0, end, opts);
  // Guard: never draw past the SOI boundary (a far-out hyperbolic leg would otherwise sweep across the parent's map).
  if (Number.isFinite(soi)) {
    const limit = soi * 1.001;
    let n = pts.length;
    while (n > 2 && Math.hypot(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z) > limit) n--;
    pts.length = n;
  }
  return pts;
}

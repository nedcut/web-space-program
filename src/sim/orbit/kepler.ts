import type { Orbit, StateVector } from './api';
import { add, cross, dot, length, scale, sub, v3, type Vec3 } from '../../util/vec3';

export const TAU = 2 * Math.PI;
export const wrapAngle = (x: number): number => { const a = x % TAU; return a < 0 ? a + TAU : a; };
const signedAngle = (x: number): number => { const a = x % TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
function finite(...xs: number[]): void { if (!xs.every(Number.isFinite)) throw new RangeError('Expected finite orbital inputs'); }

/** Cancellation-free E - sin(E), including the near-parabolic corner. */
function xMinusSin(x: number): number {
  if (Math.abs(x) > 0.1) return x - Math.sin(x);
  const x2 = x * x;
  return x * x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110))));
}
function sinhMinusX(x: number): number {
  if (Math.abs(x) > 0.1) return Math.sinh(x) - x;
  const x2 = x * x;
  return x * x2 / 6 * (1 + x2 / 20 * (1 + x2 / 42 * (1 + x2 / 72 * (1 + x2 / 110))));
}

/** Returns the eccentric anomaly on the same revolution as M. */
export function solveKepler(M: number, e: number): number {
  finite(M, e);
  if (e < 0 || e >= 1) throw new RangeError('Elliptic eccentricity must be in [0, 1)');
  const m = signedAngle(M);
  if (m === 0 || e === 0) return M;
  const sign = Math.sign(m), target = Math.abs(m);
  let lo = 0, hi = Math.PI;
  let x = e < 0.8 ? target : Math.min(Math.PI, Math.max(target, Math.cbrt(6 * target)));
  for (let k = 0; k < 100; k++) {
    const f = (1 - e) * x + e * xMinusSin(x) - target;
    if (f > 0) hi = x; else lo = x;
    const derivative = (1 - e) + 2 * e * Math.sin(x / 2) ** 2;
    const next = x - f / derivative;
    if (Math.abs(f / derivative) <= 3e-16 * Math.max(1, x)) break;
    x = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return M - m + sign * x;
}

export function solveHyperbolicKepler(M: number, e: number): number {
  finite(M, e);
  if (e <= 1) throw new RangeError('Hyperbolic eccentricity must exceed 1');
  if (M === 0) return 0;
  const target = Math.abs(M);
  let lo = 0, hi = Math.max(1, Math.asinh(target / e) + 1);
  while (e * Math.sinh(hi) - hi < target) hi *= 2;
  let x = Math.min(hi, Math.max(Math.asinh(target / e), Math.min(1, Math.cbrt(6 * target / e))));
  for (let k = 0; k < 120; k++) {
    const f = (e - 1) * x + e * sinhMinusX(x) - target;
    const d = (e - 1) + 2 * e * Math.sinh(x / 2) ** 2;
    if (Math.abs(f / d) <= 3e-16 * Math.max(1, x)) break;
    if (f > 0) hi = x; else lo = x;
    const next = x - f / d;
    x = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return Math.sign(M) * x;
}

/** At e=1 the eccentric anomaly is Barker's D = tan(nu/2). */
export function trueToEccentricAnomaly(nu: number, e: number): number {
  finite(nu, e);
  if (e < 0) throw new RangeError('Negative eccentricity');
  if (e < 1) return Math.atan2(Math.sqrt((1 - e) * (1 + e)) * Math.sin(nu), e + Math.cos(nu));
  if (e === 1) return Math.tan(nu / 2);
  const denominator = 1 + e * Math.cos(nu);
  if (denominator <= 0) throw new RangeError('True anomaly outside hyperbolic asymptotes');
  return Math.asinh(Math.sqrt((e - 1) * (e + 1)) * Math.sin(nu) / denominator);
}
export function eccentricToTrueAnomaly(E: number, e: number): number {
  if (e < 1) return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  if (e === 1) return 2 * Math.atan(E);
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(E / 2));
}
export function eccentricToMeanAnomaly(E: number, e: number): number {
  if (e < 1) return (1 - e) * E + e * xMinusSin(E);
  if (e === 1) return E + E ** 3 / 3;
  return (e - 1) * E + e * sinhMinusX(E);
}
export function meanToEccentricAnomaly(M: number, e: number): number {
  if (e < 1) return solveKepler(M, e);
  if (e === 1) return 2 * Math.sinh(Math.asinh(1.5 * M) / 3);
  return solveHyperbolicKepler(M, e);
}
export const trueToMeanAnomaly = (nu: number, e: number): number => eccentricToMeanAnomaly(trueToEccentricAnomaly(nu, e), e);
export const meanToTrueAnomaly = (M: number, e: number): number => eccentricToTrueAnomaly(meanToEccentricAnomaly(M, e), e);
export const semiLatusRectum = (o: Orbit): number => o.p ?? o.a * (1 - o.e) * (1 + o.e);
export const periapsisRadius = (o: Orbit): number => semiLatusRectum(o) / (1 + o.e);
export const apoapsisRadius = (o: Orbit): number => o.e < 1 ? semiLatusRectum(o) / (1 - o.e) : Infinity;
export const period = (o: Orbit): number => o.e < 1 ? TAU * Math.sqrt(o.a ** 3 / o.mu) : Infinity;
export const orbitalPeriod = period;
function meanMotion(o: Orbit): number { return o.e === 1 ? 2 * Math.sqrt(o.mu / semiLatusRectum(o) ** 3) : Math.sqrt(o.mu / Math.abs(o.a) ** 3); }

function planeVector(o: Orbit, x: number, y: number): Vec3 {
  const cO = Math.cos(o.lan), sO = Math.sin(o.lan), cw = Math.cos(o.argPe), sw = Math.sin(o.argPe), ci = Math.cos(o.i), si = Math.sin(o.i);
  return v3((cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y,
    (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y, sw * si * x + cw * si * y);
}
function analyticState(o: Orbit, t: number): StateVector {
  finite(o.mu, o.e, o.i, o.lan, o.argPe, o.m0, o.epoch, t);
  const p = semiLatusRectum(o);
  if (!(o.mu > 0 && p > 0) || o.e < 0) throw new RangeError('Invalid conic');
  const M = o.m0 + meanMotion(o) * (t - o.epoch);
  const nu = meanToTrueAnomaly(M, o.e);
  const c = Math.cos(nu), s = Math.sin(nu), r = p / (1 + o.e * c), speed = Math.sqrt(o.mu / p);
  return { position: planeVector(o, r * c, r * s), velocity: planeVector(o, -speed * s, speed * (o.e + c)) };
}
export function elementsToState(o: Orbit, t: number = o.epoch): StateVector {
  if (o.stateAtEpoch) return propagateUniversal(o.mu, o.stateAtEpoch, t - o.epoch);
  if (Math.abs(o.e - 1) < 1e-5 && t !== o.epoch) return propagateUniversal(o.mu, analyticState(o, o.epoch), t - o.epoch);
  return analyticState(o, t);
}
export function propagate(o: Orbit, t: number): StateVector { return elementsToState(o, t); }

/** Singular circular/equatorial angles are assigned zero; their longitude is retained in m0. */
export function stateToElements(mu: number, body: string, r: Vec3, v: Vec3, t: number): Orbit {
  finite(mu, r.x, r.y, r.z, v.x, v.y, v.z, t);
  const R = length(r);
  if (!(mu > 0 && R > 0)) throw new RangeError('Positive GM and nonzero radius required');
  const h = cross(r, v), H = length(h), p = H * H / mu;
  const energy = dot(v, v) / 2 - mu / R;
  const ev = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / R));
  let e = length(ev);
  // Preserve the actual epoch state; a and e alone lose digits as energy approaches zero.
  const stateAtEpoch = { position: { ...r }, velocity: { ...v } };
  if (H <= 1e-14 * Math.sqrt(mu * R)) return { body, mu, a: energy === 0 ? Infinity : -mu / (2 * energy), e: 1, i: 0, lan: 0, argPe: 0, m0: 0, epoch: t, p: 0, stateAtEpoch };
  const n = v3(-h.y, h.x, 0), N = length(n);
  const i = Math.atan2(N, h.z);
  const equatorial = N < H * 1e-12, circular = e < 1e-12;
  const lan = equatorial ? 0 : wrapAngle(Math.atan2(n.y, n.x));
  const angle = (a: Vec3, b: Vec3): number => Math.atan2(dot(cross(a, b), h) / H, dot(a, b));
  let argPe = circular ? 0 : wrapAngle(angle(equatorial ? v3(1, 0, 0) : n, ev));
  let nu = angle(circular ? (equatorial ? v3(1, 0, 0) : n) : ev, r);
  if (circular) e = 0;
  let a = -mu / (2 * energy);
  if (Math.abs(energy) < 4 * Number.EPSILON * mu / R) { e = 1; a = Infinity; }
  if (!Number.isFinite(argPe)) argPe = 0;
  if (!Number.isFinite(nu)) nu = 0;
  // Hyperbolic anomaly from the state (e·sinh F = r·v / √(μ|a|)) rather than from ν: near-radial paths have ν
  // within rounding of an asymptote, where 1 + e·cos ν loses its sign and the conversion would be undefined.
  const m0 = e > 1 ? eccentricToMeanAnomaly(Math.asinh(dot(r, v) / (e * Math.sqrt(mu * Math.abs(a)))), e) : trueToMeanAnomaly(nu, e);
  const nearParabolic = Math.abs(e - 1) < 1e-5;
  return { body, mu, a, e, i, lan, argPe, m0: e < 1 && !nearParabolic ? wrapAngle(m0) : m0, epoch: t, p, ...(nearParabolic ? { stateAtEpoch } : {}) };
}

/** Stumpff C(z), S(z), evaluated by series around zero to avoid cancellation. */
export function stumpff(z: number): { C: number; S: number } {
  if (Math.abs(z) < 0.1) {
    let C = 0.5, S = 1 / 6, c = C, s = S;
    for (let k = 1; k < 12; k++) { c *= -z / ((2 * k + 1) * (2 * k + 2)); s *= -z / ((2 * k + 2) * (2 * k + 3)); C += c; S += s; }
    return { C, S };
  }
  const x = Math.sqrt(Math.abs(z));
  return z > 0 ? { C: 2 * Math.sin(x / 2) ** 2 / z, S: (x - Math.sin(x)) / x ** 3 } : { C: (Math.cosh(x) - 1) / -z, S: (Math.sinh(x) - x) / x ** 3 };
}
export const stumpffC = (z: number): number => stumpff(z).C;
export const stumpffS = (z: number): number => stumpff(z).S;

/** Universal-variable f/g propagation. Supports ellipses, hyperbolas and exact parabolas. */
export function propagateUniversal(mu: number, state: StateVector, dt: number): StateVector {
  const { position: r, velocity: v } = state, R = length(r), rootMu = Math.sqrt(mu);
  finite(mu, dt, r.x, r.y, r.z, v.x, v.y, v.z);
  if (!(mu > 0 && R > 0)) throw new RangeError('Positive GM and radius required');
  const alpha = 2 / R - dot(v, v) / mu;
  if (alpha > 0) { const T = TAU / Math.sqrt(mu * alpha ** 3); if (Number.isFinite(T)) dt %= T; }
  if (dt === 0) return { position: { ...r }, velocity: { ...v } };
  const A = dot(r, v) / rootMu, B = 1 - alpha * R, target = rootMu * dt;
  const evaluate = (x: number) => {
    const { C, S } = stumpff(alpha * x * x);
    return { f: A * x * x * C + B * x ** 3 * S + R * x - target,
      d: A * x * (1 - alpha * x * x * S) + B * x * x * C + R };
  };
  let lo = dt > 0 ? 0 : -1, hi = dt > 0 ? 1 : 0;
  for (let k = 0; k < 1024 && evaluate(lo).f > 0; k++) lo *= 2;
  for (let k = 0; k < 1024 && evaluate(hi).f < 0; k++) hi *= 2;
  let x = (lo + hi) / 2;
  for (let k = 0; k < 160; k++) {
    const { f, d } = evaluate(x);
    if (Math.abs(f) < 2e-14 * Math.max(Math.abs(target), R)) break;
    if (f > 0 || (Number.isNaN(f) && x > 0)) hi = x; else lo = x;
    const next = x - f / d;
    if (Math.abs(hi - lo) < 2e-14 * Math.max(1, Math.abs(x))) break;
    x = Number.isFinite(next) && next > lo && next < hi ? next : (lo + hi) / 2;
  }
  const { C, S } = stumpff(alpha * x * x);
  const f = 1 - x * x * C / R, g = dt - x ** 3 * S / rootMu;
  const position = add(scale(r, f), scale(v, g)), radius = length(position);
  if (!(radius > 0)) throw new RangeError('Propagation reached central singularity');
  const fdot = rootMu / (radius * R) * (alpha * x ** 3 * S - x), gdot = 1 - x * x * C / radius;
  const velocity = add(scale(r, fdot), scale(v, gdot));
  finite(position.x, position.y, position.z, velocity.x, velocity.y, velocity.z);
  return { position, velocity };
}

/** Seconds until the next crossing; Infinity if an unbound crossing is already past. */
export function timeToTrueAnomaly(o: Orbit, nu: number, t: number = o.epoch): number {
  if (!(semiLatusRectum(o) > 0)) throw new RangeError('Anomaly times are undefined for radial trajectories');
  const n = meanMotion(o), current = o.m0 + n * (t - o.epoch), target = trueToMeanAnomaly(nu, o.e);
  if (o.e < 1) return wrapAngle(target - current) / n;
  const dt = (target - current) / n;
  return dt >= -1e-9 ? Math.max(0, dt) : Infinity;
}
export const timeToPeriapsis = (o: Orbit, t: number = o.epoch): number => timeToTrueAnomaly(o, 0, t);
export const timeToApoapsis = (o: Orbit, t: number = o.epoch): number => o.e < 1 ? timeToTrueAnomaly(o, Math.PI, t) : Infinity;

import { describe, expect, it } from 'vitest';
import { buildUniverse, SCALE_PRESETS } from '../src/sim/bodies/scale';
import type { BodyDef } from '../src/sim/bodies/types';
import { add, distance, dot, length, scale, sub, v3 } from '../src/util/vec3';
import { qRotate } from '../src/util/quat';
import { BODY_DEFS } from '../src/data/bodies';
import {
  apoapsisRadius, burnTimeEstimate, closestApproach, createEphemeris, eccentricToMeanAnomaly,
  elementsToState, findDominantBody, gravityAccel, inertialDvToManeuver, integrateState,
  maneuverToInertialDv, meanToTrueAnomaly, periapsisRadius, period, predictTrajectory,
  propagate, propagateUniversal, solveHyperbolicKepler, solveKepler, stateToElements,
  timeToApoapsis, timeToPeriapsis, timeToTrueAnomaly, trueToMeanAnomaly, type Orbit, type StateVector,
} from '../src/sim/orbit';
const MU = 3.986004418e14, R = 6371e3;
const orbit = (extra: Partial<Orbit> = {}): Orbit => ({ body: 'earth', mu: MU, a: R + 420e3, e: 0, i: 0, lan: 0, argPe: 0, m0: 0, epoch: 0, ...extra });
const energy = (s: StateVector, mu = MU): number => dot(s.velocity, s.velocity) / 2 - mu / length(s.position);
function expectState(a: StateVector, b: StateVector, tolerance = 1e-9): void {
  expect(distance(a.position, b.position) / length(a.position)).toBeLessThan(tolerance);
  expect(distance(a.velocity, b.velocity) / length(a.velocity)).toBeLessThan(tolerance);
}
function body(id: string, extra: Partial<BodyDef> = {}): BodyDef {
  return { id, name: id, kind: 'planet', gm: MU, radius: R, rotationPeriod: 86164, axialTilt: 0,
    surface: { preset: 'earth', colors: [[1, 1, 1]], relief: 0, seed: 1 }, solidSurface: true, ...extra };
}
function earthMoon(moonPhase = 0) {
  return buildUniverse([body('earth'), body('moon', { parent: 'earth', kind: 'moon', gm: 4.9048695e12, radius: 1737.4e3,
    orbit: { a: 384400e3, e: 0, i: 0, lan: 0, argPe: 0, meanAnomalyAtEpoch: moonPhase, epoch: 0 } })], SCALE_PRESETS.real);
}

describe('Kepler and conic mechanics', () => {
  it('solves elliptic and hyperbolic Kepler to better than 1e-12', () => {
    for (const e of [0, 0.2, 0.8, 0.99, 0.999999999999]) for (const M of [-20, -Math.PI, -0.1, -1e-12, 0, 1e-15, 1e-8, 0.5, Math.PI, 20]) {
      const E = solveKepler(M, e);
      expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
    }
    for (const e of [1 + 1e-12, 1.001, 1.2, 2, 10]) for (const M of [-100, -1, -1e-12, 0, 1e-15, 1e-8, 0.5, 100]) {
      const H = solveHyperbolicKepler(M, e);
      expect(Math.abs(e * Math.sinh(H) - H - M)).toBeLessThan(1e-12);
    }
  });
  it('round trips anomaly conversions for every conic type', () => {
    for (const e of [0, 0.8, 0.99999, 1, 1.00001, 1.5, 4]) for (const nu of [-1.5, -0.1, 0, 0.5, 1.5]) {
      expect(meanToTrueAnomaly(trueToMeanAnomaly(nu, e), e)).toBeCloseTo(nu, 9);
    }
    expect(eccentricToMeanAnomaly(0, 1)).toBe(0);
  });
  it('round trips 600 deterministic random orbits, including retrograde and equatorial', () => {
    let seed = 123456;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let k = 0; k < 600; k++) {
      const hyper = k % 3 === 0;
      const o = orbit({ a: (hyper ? -1 : 1) * (1e7 + random() * 1e9), e: k % 5 === 0 ? 0 : hyper ? 1.01 + random() * 3 : random() * 0.99,
        i: k % 7 === 0 ? 0 : k % 11 === 0 ? Math.PI : random() * Math.PI, lan: random() * 6, argPe: random() * 6, m0: (random() - 0.5) * 6 });
      if (o.e === 0) o.a = Math.abs(o.a);
      const initial = elementsToState(o, 123);
      const converted = stateToElements(MU, 'earth', initial.position, initial.velocity, 123);
      expectState(initial, elementsToState(converted, 123), 1e-9);
      expectState(propagate(o, 3456), propagate(converted, 3456), 1e-8);
    }
  });
  it('has an ISS-like period and LEO to GEO Hohmann delta-v', () => {
    const leo = orbit();
    expect(period(leo) / 60).toBeCloseTo(92.7, 0);
    const r1 = leo.a, r2 = 42164e3, a = (r1 + r2) / 2;
    const transfer = orbit({ a, e: (r2 - r1) / (r2 + r1) });
    const dv1 = length(propagate(transfer, 0).velocity) - length(propagate(leo, 0).velocity);
    const dv2 = length(propagate(orbit({ a: r2 }), 0).velocity) - length(propagate(transfer, period(transfer) / 2).velocity);
    expect(Math.abs((dv1 + dv2) / 1000 - 3.9)).toBeLessThan(0.06);
  });
  it('conserves energy and agrees with universal propagation', () => {
    for (const e of [0, 0.8, 0.99, 1.01, 2]) {
      const o = orbit({ a: e > 1 ? -2e8 : 2e8, e, m0: 0.2, i: 0.4 });
      const initial = propagate(o, 0), E = energy(initial);
      for (const t of [-100000, -500, 500, 100000]) {
        const propagated = propagate(o, t);
        expect(Math.abs((energy(propagated) - E) / E)).toBeLessThan(1e-10);
        expectState(propagated, propagateUniversal(MU, initial, t), 1e-9);
      }
    }
  });
  it('handles exact and near parabolic states without losing periapsis or energy', () => {
    for (const e of [1 - 1e-10, 1, 1 + 1e-10]) {
      const initial = { position: v3(8e6, 0, 0), velocity: v3(0, Math.sqrt(MU * (1 + e) / 8e6), 0) };
      const o = stateToElements(MU, 'earth', initial.position, initial.velocity, 0);
      expect(periapsisRadius(o)).toBeCloseTo(8e6, 5);
      for (const t of [-100000, 0, 100000]) {
        const s = propagate(o, t);
        expect(Number.isFinite(length(s.position))).toBe(true);
        expect(Math.abs(energy(s) - energy(initial)) / (MU / 8e6)).toBeLessThan(1e-11);
        expectState(initial, propagateUniversal(MU, s, -t), 1e-8);
      }
    }
    const parabola = orbit({ a: Infinity, e: 1, p: 16e6 });
    expectState(elementsToState(parabola, 5000), propagateUniversal(MU, elementsToState(parabola, 0), 5000));
  });
  it('preserves radial states and rejects singular invalid inputs instead of returning NaN', () => {
    const s = { position: v3(8e6, 0, 0), velocity: v3(1000, 0, 0) };
    const o = stateToElements(MU, 'earth', s.position, s.velocity, 0);
    expectState(s, propagate(o, 0));
    expect(Number.isFinite(propagate(o, 10).position.x)).toBe(true);
    expect(() => stateToElements(MU, 'earth', v3(), v3(), 0)).toThrow(RangeError);
    expect(() => solveKepler(1, 1)).toThrow(RangeError);
  });
  it('reports apsides and next event times', () => {
    const o = orbit({ e: 0.4 });
    expect(periapsisRadius(o)).toBeCloseTo(o.a * 0.6, 5);
    expect(apoapsisRadius(o)).toBeCloseTo(o.a * 1.4, 5);
    expect(timeToPeriapsis(o)).toBe(0);
    expect(timeToApoapsis(o)).toBeCloseTo(period(o) / 2, 7);
    expect(timeToTrueAnomaly(o, Math.PI / 2)).toBeGreaterThan(0);
    const h = orbit({ e: 1.4, a: -1e7, m0: 0.1 });
    expect(timeToPeriapsis(h)).toBe(Infinity);
    expect(timeToApoapsis(h)).toBe(Infinity);
  });
});

describe('ephemeris and body frames', () => {
  it('derives Earth SOI from real solar parameters', () => {
    const bodies = buildUniverse(BODY_DEFS, SCALE_PRESETS.real);
    expect(Math.abs(bodies.get('earth')!.soi / 9.24e8 - 1)).toBeLessThan(0.001);
    const e = createEphemeris(bodies);
    expect(findDominantBody(e, bodies, e.getBodyState('earth', 0).position, 0)).toBe('earth');
    expect(findDominantBody(e, bodies, v3(), 0)).toBe('sun');
  });
  it('propagates the complete real body catalog in both time directions', () => {
    const bodies = buildUniverse(BODY_DEFS, SCALE_PRESETS.real), ephem = createEphemeris(bodies);
    for (const t of [-365.25 * 86400, 0, 10 * 365.25 * 86400]) for (const b of bodies.values()) {
      const state = ephem.getBodyState(b.id, t);
      expect(Number.isFinite(length(state.position))).toBe(true);
      expect(Number.isFinite(length(state.velocity))).toBe(true);
      const q = ephem.bodyRotation(b.id, t);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
    }
  });
  it('composes states and memoizes the last time', () => {
    const bodies = earthMoon(), ephem = createEphemeris(bodies);
    expect(ephem.getBodyState('moon', 123)).toBe(ephem.getBodyState('moon', 123));
    const state = ephem.getBodyState('moon', 123);
    expectState(state, ephem.getRelativeState('moon', 123));
    expect(length(state.position)).toBeCloseTo(384400e3, 4);
    expect(distance(state.position, ephem.getBodyState('moon', 10000).position)).toBeGreaterThan(1e6);
  });
  it('uses ICRF pole conversion for rotation and parent equator elements', () => {
    const definitions = [body('earth', { poleRA: 0, poleDec: Math.PI / 2 }), body('moon', { parent: 'earth', gm: 4.9e12,
      orbit: { a: 384400e3, e: 0, i: 0, lan: 0, argPe: 0, meanAnomalyAtEpoch: Math.PI / 2, epoch: 0, frame: 'parentEquator' } })];
    const ephem = createEphemeris(buildUniverse(definitions, SCALE_PRESETS.real));
    const pole = qRotate(ephem.bodyRotation('earth', 0), v3(0, 0, 1));
    expect(pole.y).toBeCloseTo(Math.sin(23.4392911 * Math.PI / 180), 12);
    expect(dot(pole, ephem.getRelativeState('moon', 0).position) / 384400e3).toBeCloseTo(0, 12);
    const p = v3(1e6, 2e6, 3e6), t = 100;
    expect(distance(p, ephem.fromBodyFixed('earth', ephem.toBodyFixed('earth', p, t), t))).toBeLessThan(1e-8);
    const fixed = ephem.toBodyFixed('earth', p, t), dt = 0.01;
    const numerical = scale(sub(ephem.fromBodyFixed('earth', fixed, t + dt), ephem.fromBodyFixed('earth', fixed, t - dt)), 1 / (2 * dt));
    expect(distance(numerical, ephem.surfaceVelocity('earth', p, t))).toBeLessThan(1e-6);
  });
  it('tilts fallback poles about the orbital node and supports retrograde spin', () => {
    const b = body('earth', { axialTilt: 0.3, rotationPeriod: -100, orbit: { a: 1e11, e: 0, i: 0.2, lan: 0, argPe: 0, meanAnomalyAtEpoch: 0, epoch: 0 } });
    const ephem = createEphemeris(buildUniverse([b], SCALE_PRESETS.real));
    const pole = qRotate(ephem.bodyRotation('earth', 0), v3(0, 0, 1));
    expect(pole.y).toBeCloseTo(-Math.sin(0.5), 12);
    expect(ephem.surfaceVelocity('earth', v3(R, 0, 0), 0).y).toBeLessThan(0);
  });
});

describe('maneuvers, gravity and targeting', () => {
  it('round trips maneuver components in an eccentric local frame', () => {
    const s = elementsToState(orbit({ e: 0.5, m0: 1, i: 0.4 }), 0), node = { prograde: 120, normal: -30, radial: 50 };
    const result = inertialDvToManeuver(s, maneuverToInertialDv(s, node));
    expect(result.prograde).toBeCloseTo(node.prograde, 10);
    expect(result.normal).toBeCloseTo(node.normal, 10);
    expect(result.radial).toBeCloseTo(node.radial, 10);
    const ve = 300 * 9.80665, dv = ve * Math.log(2);
    expect(burnTimeEstimate(dv, 1e5, 10000, 300)).toBeCloseTo(5000 * ve / 1e5, 10);
    expect(burnTimeEstimate(0, 0, 10000, 300)).toBe(0);
  });
  it('sums gravitational acceleration and integrates a full orbit accurately', () => {
    const bodies = earthMoon(), ephem = createEphemeris(bodies), position = v3(R + 420e3, 0, 0);
    const a = gravityAccel(position, 0, bodies, ephem, 'dominant', 'earth');
    expect(a.x).toBeCloseTo(-MU / position.x ** 2, 12);
    expect(gravityAccel(position, 0, bodies, ephem, 'nbody', 'earth').x).toBeGreaterThan(a.x);
    const o = orbit(), initial = propagate(o, 0), steps = 2000, dt = period(o) / steps;
    let s = initial;
    for (let k = 0; k < steps; k++) s = integrateState(s, k * dt, dt, p => scale(p, -MU / length(p) ** 3));
    expectState(initial, s, 1e-9);
  });
  it('locates a global closest approach within a specified window', () => {
    const a = orbit(), targetTime = period(a) / 3, target = propagate(a, targetTime);
    const approach = closestApproach(a, () => ({ position: target.position, velocity: v3() }), 0, period(a) * 0.9);
    expect(Math.abs(approach.time - targetTime)).toBeLessThan(0.02);
    expect(approach.distance).toBeLessThan(100);
  });
});

describe('patched trajectories', () => {
  it('enters the Moon SOI on a translunar coast and transforms states continuously', () => {
    const rp = R + 300e3, ra = 384400e3, a = (rp + ra) / 2;
    const transfer = orbit({ a, e: (ra - rp) / (ra + rp) });
    const encounterTime = period(transfer) / 2;
    const nMoon = Math.sqrt((MU + 4.9048695e12) / ra ** 3);
    const bodies = earthMoon(Math.PI - nMoon * encounterTime), ephem = createEphemeris(bodies);
    const patches = predictTrajectory({ ephem, bodies, initialBody: 'earth', state: propagate(transfer, 0), t0: 0, horizon: encounterTime + 1e5, maxPatches: 8 });
    expect(patches[0].endReason).toBe('soiEnter');
    expect(patches[0].nextBody).toBe('moon');
    expect(patches[1].orbit.body).toBe('moon');
    const t = patches[0].endTime, old = propagate(patches[0].orbit, t), next = propagate(patches[1].orbit, t), moon = ephem.getBodyState('moon', t);
    expectState(old, { position: add(next.position, moon.position), velocity: add(next.velocity, moon.velocity) }, 1e-8);
    expect(Math.abs(length(next.position) - bodies.get('moon')!.soi)).toBeLessThan(500);
  });
  it('finds impact and atmosphere entry', () => {
    const defs = [body('earth')], bodies = buildUniverse(defs, SCALE_PRESETS.real), ephem = createEphemeris(bodies);
    const o = orbit({ a: R, e: 0.1, m0: Math.PI });
    const options = { ephem, bodies, initialBody: 'earth', state: propagate(o, 0), t0: 0, horizon: period(o) };
    expect(predictTrajectory(options)[0].endReason).toBe('impact');
    bodies.get('earth')!.atmosphere = { height: 1e5, surfacePressure: 1e5, surfaceTemperature: 288, molarMass: 0.029, gamma: 1.4 };
    expect(predictTrajectory({ ...options, stopAtAtmosphere: true })[0].endReason).toBe('atmosphere');
  });
  it('applies unsorted maneuver nodes at the right times', () => {
    const bodies = buildUniverse([body('earth')], SCALE_PRESETS.real), ephem = createEphemeris(bodies);
    const patches = predictTrajectory({ ephem, bodies, initialBody: 'earth', state: propagate(orbit(), 0), t0: 0, horizon: 2000,
      maneuvers: [{ id: 2, time: 1000, prograde: 100, normal: 0, radial: 0 }, { id: 1, time: 500, prograde: 100, normal: 0, radial: 0 }] });
    expect(patches.map(p => p.endReason)).toEqual(['maneuver', 'maneuver', 'horizon']);
    expect(patches.map(p => p.endTime)).toEqual([500, 1000, 2000]);
    const before = propagate(patches[0].orbit, 500), after = propagate(patches[1].orbit, 500);
    expect(distance(before.position, after.position)).toBeLessThan(1e-5);
    expect(length(after.velocity) - length(before.velocity)).toBeCloseTo(100, 8);
  });
  it('exits a child SOI into the parent', () => {
    const bodies = earthMoon(), ephem = createEphemeris(bodies), moon = bodies.get('moon')!;
    const patches = predictTrajectory({ ephem, bodies, initialBody: 'moon', state: { position: v3(moon.soi * 0.9, 0, 0), velocity: v3(2000, 10, 0) }, t0: 0, horizon: 10000 });
    expect(patches[0].endReason).toBe('soiExit');
    expect(patches[1].orbit.body).toBe('earth');
    expect(patches[1].endTime).toBeGreaterThan(patches[0].endTime);
  });
});

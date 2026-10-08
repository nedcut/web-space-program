import type { Body } from '../bodies/types';
import type { Orbit, StateVector } from './api';
import { propagate } from './kepler';
import { add, cross, scale, v3, type Vec3 } from '../../util/vec3';
import { qConj, qFromAxisAngle, qFromTo, qIdentity, qMul, qRotate, type Quat } from '../../util/quat';

export interface Ephemeris {
  getBodyState(id: string, t: number): StateVector;
  getRelativeState(id: string, t: number): StateVector;
  bodyRotation(id: string, t: number): Quat;
  /** Positions/vectors relative to the body's centre, not heliocentric points. */
  toBodyFixed(id: string, position: Vec3, t: number): Vec3;
  fromBodyFixed(id: string, position: Vec3, t: number): Vec3;
  surfaceVelocity(id: string, posInertialRelBody: Vec3, t: number): Vec3;
}
const X = v3(1, 0, 0), Z = v3(0, 0, 1);
/** Distinct recent times cached by an ephemeris. */
const EPHEMERIS_SLOTS = 4;
const obliquity = 23.4392911 * Math.PI / 180;

/**
 * On-rails ecliptic J2000 ephemeris. Parent-equator elements use the parent's
 * non-spinning equator. With an ICRF pole, the zero meridian is the shortest
 * rotation from ecliptic +Z to the pole; rotationAtEpoch is measured from it.
 * Otherwise the pole is the orbit normal tilted by axialTilt about its ascending
 * node (+X for zero node), preserving that node as the equator's X axis.
 * The fallback orbit plane itself includes any parent-equator transformation.
 */
export function createEphemeris(bodies: Map<string, Body>): Ephemeris {
  const equators = new Map<string, Quat>(), planes = new Map<string, Quat>();
  const constructing = new Set<string>();
  const body = (id: string): Body => { const b = bodies.get(id); if (!b) throw new RangeError(`Unknown body: ${id}`); return b; };
  function referencePlane(b: Body): Quat {
    return b.orbit?.frame === 'parentEquator' && b.parent ? equator(b.parent) : qIdentity();
  }
  function equator(id: string): Quat {
    const cached = equators.get(id); if (cached) return cached;
    if (constructing.has(id)) throw new RangeError('Cyclic body hierarchy');
    constructing.add(id);
    const b = body(id);
    let q: Quat;
    if (b.poleRA !== undefined && b.poleDec !== undefined) {
      const pole = qRotate(qFromAxisAngle(X, -obliquity), v3(Math.cos(b.poleDec) * Math.cos(b.poleRA), Math.cos(b.poleDec) * Math.sin(b.poleRA), Math.sin(b.poleDec)));
      q = qFromTo(Z, pole);
    } else {
      const plane = qMul(referencePlane(b), qMul(qFromAxisAngle(Z, b.orbit?.lan ?? 0), qFromAxisAngle(X, b.orbit?.i ?? 0)));
      q = qMul(plane, qFromAxisAngle(X, b.axialTilt));
    }
    constructing.delete(id); equators.set(id, q); return q;
  }
  // Body elements are immutable for the lifetime of an ephemeris.
  for (const b of bodies.values()) { equator(b.id); planes.set(b.id, referencePlane(b)); }
  // Conic per body, built once (elements are immutable) instead of spread on every evaluation.
  const orbits = new Map<string, Orbit>();
  function orbitOf(b: Body): Orbit {
    let orbit = orbits.get(b.id);
    if (!orbit) {
      const o = b.orbit!;
      orbit = { ...o, body: b.parent!, mu: body(b.parent!).gm + b.gm, m0: o.meanAnomalyAtEpoch };
      orbits.set(b.id, orbit);
    }
    return orbit;
  }
  // A frame alternates between a few times (physics steps, interpolated render time, HUD/audio at world time).
  // One cache per recent time keeps those interleaved queries from discarding each other's Kepler solves.
  interface Slot { t: number; absolute: Map<string, StateVector>; relative: Map<string, StateVector>; rotations: Map<string, Quat> }
  const slots: Slot[] = [];
  let absolute = new Map<string, StateVector>(), relative = new Map<string, StateVector>(), rotations = new Map<string, Quat>();
  let lastT = NaN;
  const visiting = new Set<string>();
  function at(t: number): void {
    if (t === lastT) return;
    if (!Number.isFinite(t)) throw new RangeError('Finite ephemeris time required');
    let i = slots.findIndex(s => s.t === t);
    let slot: Slot;
    if (i >= 0) slot = slots[i];
    else if (slots.length < EPHEMERIS_SLOTS) { slot = { t, absolute: new Map(), relative: new Map(), rotations: new Map() }; slots.push(slot); i = slots.length - 1; }
    else { i = slots.length - 1; slot = slots[i]; slot.t = t; slot.absolute.clear(); slot.relative.clear(); slot.rotations.clear(); }
    // Most recently used first; the least recently used slot is recycled.
    for (let j = i; j > 0; j--) slots[j] = slots[j - 1];
    slots[0] = slot;
    lastT = t; absolute = slot.absolute; relative = slot.relative; rotations = slot.rotations;
  }
  function getRelativeState(id: string, t: number): StateVector {
    at(t); const cached = relative.get(id); if (cached) return cached;
    const b = body(id);
    let state: StateVector = { position: v3(), velocity: v3() };
    if (b.parent && b.orbit) {
      const orbit = orbitOf(b);
      const raw = propagate(orbit, t), q = planes.get(id) ?? referencePlane(b);
      state = { position: qRotate(q, raw.position), velocity: qRotate(q, raw.velocity) };
    }
    relative.set(id, state); return state;
  }
  function getBodyState(id: string, t: number): StateVector {
    at(t); const cached = absolute.get(id); if (cached) return cached;
    if (visiting.has(id)) throw new RangeError('Cyclic body hierarchy');
    visiting.add(id);
    const b = body(id), rel = getRelativeState(id, t);
    const parent = b.parent ? getBodyState(b.parent, t) : { position: v3(), velocity: v3() };
    const state = { position: add(parent.position, rel.position), velocity: add(parent.velocity, rel.velocity) };
    visiting.delete(id); absolute.set(id, state); return state;
  }
  function bodyRotation(id: string, t: number): Quat {
    at(t); const cached = rotations.get(id); if (cached) return cached;
    const b = body(id), q = qMul(equator(id), qFromAxisAngle(Z, b.rotationRate * t + (b.rotationAtEpoch ?? 0)));
    rotations.set(id, q); return q;
  }
  return {
    getBodyState, getRelativeState, bodyRotation,
    toBodyFixed: (id, p, t) => qRotate(qConj(bodyRotation(id, t)), p),
    fromBodyFixed: (id, p, t) => qRotate(bodyRotation(id, t), p),
    surfaceVelocity: (id, p, t) => { at(t); return cross(scale(qRotate(equator(id), Z), body(id).rotationRate), p); },
  };
}

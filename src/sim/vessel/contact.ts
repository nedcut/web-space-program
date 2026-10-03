import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, scale, sub, v3 } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import type { LandingLegModule } from './types';
import type { VesselState } from './runtime';
import type { Environment, GroundSample } from './env';
import type { Mat3 } from './mat3';
import { m3FromQuat, m3MulVec, m3RotateTensor } from './mat3';
import { hullPoints, shapeVolume } from './shapes';

/**
 * Ground & water contact.
 *  - Hull points (part shape extremes) use velocity-level impulse contacts (sequential impulses) with
 *    Coulomb friction (static 0.8 / dynamic 0.6) and Baumgarte penetration recovery.
 *  - Deployed landing legs are spring/damper suspensions (force), with friction resolved as impulses
 *    in the same solver (exact static friction => no creep, no jitter). Bottoming out => rigid contact.
 *  - Water: per-part buoyancy (submerged fraction of an equivalent sphere) + quadratic water drag.
 *  - Crash: a part whose contact point approaches the surface faster than its crashTolerance is destroyed.
 */

export const MU_STATIC = 0.8;
export const MU_DYNAMIC = 0.6;
export const WATER_DENSITY = 1000;
export const WAVE_DAMPING_RATIO = 0.3;
/** Fraction of penetration removed per step by position projection (no velocity bias => no bounce). */
export const POSITION_CORRECTION = 0.8;
export const PENETRATION_SLOP = 0.005;
export const SOLVER_ITERATIONS = 10;

export interface Contact {
  partUid: number;
  /** Contact point relative to COM, inertial frame. */
  r: Vec3;
  n: Vec3;
  surfaceVelocity: Vec3;
  kind: 'rigid' | 'leg';
  depth: number;
  /** For legs: normal impulse already applied by the spring this step (friction budget). */
  legImpulse: number;
  jn: number;
  jt: Vec3;
}

export interface ContactPass {
  /** Spring/buoyancy/water drag force (inertial) and torque about COM (inertial). */
  force: Vec3;
  torque: Vec3;
  contacts: Contact[];
  /** Parts that hit the ground/water faster than their crash tolerance. */
  impacts: number[];
  landed: boolean;
  splashed: boolean;
  altitudeAGL: number;
}

/** Is the vessel close enough to the surface that contact must be evaluated? */
export function nearSurface(v: VesselState, env: Environment, t: number, h: number): { ground: GroundSample | null; agl: number; near: boolean } {
  const g = env.ground(v.position, t);
  if (!g) return { ground: null, agl: NaN, near: false };
  const agl = dot(sub(v.position, g.surfacePoint), g.normal);
  const margin = v.cache.boundingRadius * 1.5 + length(v.velocity) * h * 2 + 1;
  return { ground: g, agl, near: agl < margin };
}

export function gatherContacts(v: VesselState, env: Environment, t: number, h: number, gravityMag: number): ContactPass {
  const out: ContactPass = { force: v3(), torque: v3(), contacts: [], impacts: [], landed: false, splashed: false, altitudeAGL: NaN };
  const ns = nearSurface(v, env, t, h);
  out.altitudeAGL = ns.agl;
  for (const p of v.parts) if (p.leg) { p.leg.inContact = false; p.leg.compression = 0; }
  if (!ns.near) return out;
  const omegaW = qRotate(v.orientation, v.angularVelocity);
  const impacted = new Set<number>();
  const pointVel = (rW: Vec3) => add(v.velocity, cross(omegaW, rW));
  const toWorldOffset = (pBody: Vec3) => qRotate(v.orientation, sub(pBody, v.com));

  for (const p of v.parts) {
    // Hull points.
    for (const hp of hullPoints(p.def)) {
      const rW = toWorldOffset(add(p.position, qRotate(p.rotation, hp)));
      const pw = add(v.position, rW);
      const gs = env.ground(pw, t);
      if (!gs) continue;
      const depth = dot(sub(gs.surfacePoint, pw), gs.normal);
      if (depth <= 0) continue;
      const approach = -dot(sub(pointVel(rW), gs.surfaceVelocity), gs.normal);
      if (gs.isWater) {
        if (approach > p.def.crashTolerance && depth < approach * h + 0.05) impacted.add(p.uid);
        continue;
      }
      if (approach > p.def.crashTolerance) impacted.add(p.uid);
      out.contacts.push({ partUid: p.uid, r: rW, n: gs.normal, surfaceVelocity: gs.surfaceVelocity, kind: 'rigid', depth, legImpulse: 0, jn: 0, jt: v3() });
      out.landed = true;
    }
    // Landing leg suspension.
    if (p.leg && p.leg.deployed) {
      const m = p.def.modules[p.leg.moduleIndex] as LandingLegModule;
      const rW = toWorldOffset(add(p.position, qRotate(p.rotation, m.footPosition)));
      const pw = add(v.position, rW);
      const gs = env.ground(pw, t);
      if (gs && !gs.isWater) {
        const d = dot(sub(gs.surfacePoint, pw), gs.normal);
        if (d > 0) {
          const x = Math.min(d, m.travel);
          const vn = dot(sub(pointVel(rW), gs.surfaceVelocity), gs.normal);
          if (-vn > p.def.crashTolerance) impacted.add(p.uid);
          const F = Math.max(0, m.spring * x - m.damper * vn);
          const Fv = scale(gs.normal, F);
          out.force = add(out.force, Fv);
          out.torque = add(out.torque, cross(rW, Fv));
          p.leg.compression = x;
          p.leg.inContact = true;
          out.landed = true;
          out.contacts.push({ partUid: p.uid, r: rW, n: gs.normal, surfaceVelocity: gs.surfaceVelocity, kind: 'leg', depth: 0, legImpulse: F * h, jn: 0, jt: v3() });
          if (d > m.travel)
            out.contacts.push({ partUid: p.uid, r: rW, n: gs.normal, surfaceVelocity: gs.surfaceVelocity, kind: 'rigid', depth: d - m.travel, legImpulse: 0, jn: 0, jt: v3() });
        }
      }
    }
  }
  // Buoyancy & water drag.
  if (ns.ground && (ns.ground.isWater || ns.agl < v.cache.boundingRadius)) {
    const n = Math.max(1, v.parts.length);
    for (const p of v.parts) {
      const rW = toWorldOffset(p.position);
      const pw = add(v.position, rW);
      const gs = env.ground(pw, t);
      if (!gs || !gs.isWater) continue;
      const depth = dot(sub(gs.surfacePoint, pw), gs.normal);
      const V = shapeVolume(p.def);
      const size = 2 * Math.cbrt((3 * V) / (4 * Math.PI));
      const f = Math.max(0, Math.min(1, 0.5 + depth / Math.max(0.05, size)));
      if (f <= 0) continue;
      out.splashed = true;
      let F = scale(gs.normal, WATER_DENSITY * V * f * gravityMag);
      const vrel = sub(pointVel(rW), gs.surfaceVelocity);
      const sp = length(vrel);
      if (sp > 1e-9) {
        // Quadratic form drag + linear wave-radiation damping (zeta ~0.3 of the heave stiffness).
        const kHeave = (WATER_DENSITY * V * gravityMag) / Math.max(0.05, size);
        const cLin = 2 * WAVE_DAMPING_RATIO * Math.sqrt((kHeave * v.mass) / n) * f;
        let drag = 0.5 * WATER_DENSITY * Math.pow(V, 2 / 3) * f * sp * sp + cLin * sp;
        drag = Math.min(drag, (0.25 * v.mass * sp) / (h * n));
        F = add(F, scale(vrel, -drag / sp));
      }
      out.force = add(out.force, F);
      out.torque = add(out.torque, cross(rW, F));
    }
  }
  out.impacts = [...impacted];
  return out;
}

/** World-frame inverse inertia R I^-1 R^T. */
export function worldInvInertia(v: VesselState): Mat3 {
  return m3RotateTensor(m3FromQuat(v.orientation), v.invInertia);
}

/**
 * Positional correction (split impulse style): translation that removes most of the deepest rigid
 * penetration along its normal, without injecting velocity.
 */
export function penetrationCorrection(contacts: Contact[]): Vec3 {
  let best: Contact | null = null;
  for (const c of contacts) if (c.kind === 'rigid' && (!best || c.depth > best.depth)) best = c;
  if (!best) return v3();
  return scale(best.n, POSITION_CORRECTION * Math.max(0, best.depth - PENETRATION_SLOP));
}

/** Resolve contact impulses (sequential impulses). Mutates velocity & angularVelocity. */
export function solveContacts(v: VesselState, contacts: Contact[]): void {
  if (contacts.length === 0) return;
  const invI = worldInvInertia(v);
  const invM = 1 / v.mass;
  let vel = { ...v.velocity };
  let w = qRotate(v.orientation, v.angularVelocity);
  const apply = (J: Vec3, r: Vec3) => {
    vel = add(vel, scale(J, invM));
    w = add(w, m3MulVec(invI, cross(r, J)));
  };
  const effMass = (r: Vec3, d: Vec3) => invM + dot(d, cross(m3MulVec(invI, cross(r, d)), r));
  for (let it = 0; it < SOLVER_ITERATIONS; it++) {
    for (const c of contacts) {
      if (c.kind === 'rigid') {
        const vrel = sub(add(vel, cross(w, c.r)), c.surfaceVelocity);
        const vn = dot(vrel, c.n);
        const dj = -vn / effMass(c.r, c.n);
        const jnNew = Math.max(0, c.jn + dj);
        apply(scale(c.n, jnNew - c.jn), c.r);
        c.jn = jnNew;
      }
      const budget = c.kind === 'rigid' ? c.jn : c.legImpulse;
      if (budget <= 0) continue;
      const vrel = sub(add(vel, cross(w, c.r)), c.surfaceVelocity);
      const vt = sub(vrel, scale(c.n, dot(vrel, c.n)));
      const vtm = length(vt);
      if (vtm < 1e-12) continue;
      const tdir = scale(vt, 1 / vtm);
      let jtNew = add(c.jt, scale(tdir, -vtm / effMass(c.r, tdir)));
      const jl = length(jtNew);
      if (jl > MU_STATIC * budget) jtNew = scale(jtNew, (MU_DYNAMIC * budget) / jl);
      apply(sub(jtNew, c.jt), c.r);
      c.jt = jtNew;
    }
  }
  v.velocity = vel;
  v.angularVelocity = qRotate({ x: -v.orientation.x, y: -v.orientation.y, z: -v.orientation.z, w: v.orientation.w }, w);
}

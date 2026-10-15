import type { PartLoad } from './loads';
import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, scale, sub, v3 } from '../../util/vec3';
import { qConj, qRotate } from '../../util/quat';
import type { LandingLegModule, WheelModule } from './types';
import type { PartState } from './runtime';
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
 *  - Wheels (landing gear): spring/damper suspension along the gear leg (raycast-like: the tyre's lowest point
 *    vs the ground), a simple tyre model solved as impulses: lateral grip drives side-slip to zero up to
 *    mu(slip) * N (sticky below SLIDE_SPEED, sliding above), low rolling resistance along the wheel heading,
 *    brakes up to min(brakeTorque / radius, mu N), steering turns the heading of steerable wheels with yaw input.
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
/** Tyre friction coefficient (rubber on concrete) at low slip, and when sliding sideways. */
export const TYRE_MU = 1.0;
export const TYRE_MU_SLIDE = 0.7;
/** Lateral slip speed above which a tyre is sliding, m/s. */
export const TYRE_SLIDE_SPEED = 1.5;
/** Rolling resistance coefficient of a free-rolling tyre. */
export const ROLLING_RESISTANCE = 0.015;
/**
 * Rebound (extension) damping relative to the bump (compression) damping of leg and wheel shock absorbers. Real
 * dampers are valved this way: a firm touchdown is absorbed instead of being handed back as a bounce.
 */
export const REBOUND_DAMPING = 3;
/** Bump (compression) damping relative to the catalogue damper: absorbs touchdown energy before it is stored. */
export const BUMP_DAMPING = 1.6;
/** Damping coefficient for a suspension moving at normal speed `vn` (> 0 = extending). */
export const suspensionDamping = (damper: number, vn: number) => (vn > 0 ? damper * REBOUND_DAMPING : damper * BUMP_DAMPING);
/** Time to raise/lower retractable gear, s. */
export const GEAR_DEPLOY_TIME = 3;

/** Wheel controls for the step. */
export interface WheelControl {
  brakes: boolean;
  /** Drive motor command -1..1. */
  throttle: number;
}

export interface Contact {
  partUid: number;
  /** Contact point relative to COM, inertial frame. */
  r: Vec3;
  n: Vec3;
  surfaceVelocity: Vec3;
  kind: 'rigid' | 'leg' | 'wheel';
  depth: number;
  /** For legs/wheels: normal impulse already applied by the spring this step (friction budget). */
  legImpulse: number;
  jn: number;
  jt: Vec3;
  /** Wheels: rolling direction (unit, tangent to the ground, inertial). */
  fwd?: Vec3;
  /** Wheels: max longitudinal impulse from brakes (N*s), 0 = free rolling. */
  brakeImpulse?: number;
  /** Wheels: accumulated lateral / longitudinal impulses. */
  jl?: number;
  jf?: number;
}

/** Wheel geometry in the vessel body frame: wheel centre (full extension), suspension "down" axis, heading. */
export function wheelContactPoint(v: VesselState, p: PartState): { center: Vec3; down: Vec3; heading: Vec3; module: WheelModule } {
  const m = p.def.modules[p.wheel!.moduleIndex] as WheelModule;
  const center = add(p.position, qRotate(p.rotation, m.wheelCenter));
  const down = qRotate(p.rotation, { x: 0, y: 0, z: 1 });
  let heading = qRotate(p.rotation, { x: 0, y: 1, z: 0 });
  const steer = p.wheel!.steer;
  if (steer !== 0) {
    const sx = qRotate(p.rotation, { x: 1, y: 0, z: 0 });
    const side = sx.x >= 0 ? sx : scale(sx, -1);
    heading = add(scale(heading, Math.cos(steer)), scale(side, Math.sin(steer)));
  }
  void v;
  return { center, down, heading, module: m };
}

/** Advance retractable gear animation (contact only when fully down). */
export function updateWheelDeploy(v: VesselState, dt: number): void {
  for (const p of v.parts) {
    const w = p.wheel;
    if (!w) continue;
    const target = w.deployed ? 1 : 0;
    if (w.deploy !== target) w.deploy = target > w.deploy ? Math.min(1, w.deploy + dt / GEAR_DEPLOY_TIME) : Math.max(0, w.deploy - dt / GEAR_DEPLOY_TIME);
  }
}

export interface ContactPass {
  /** Spring/buoyancy/water drag force (inertial) and torque about COM (inertial). */
  force: Vec3;
  torque: Vec3;
  contacts: Contact[];
  /** Parts that hit the ground/water faster than their crash tolerance. */
  impacts: number[];
  /** Incoming normal speeds relative to the moving surface, including water. */
  impactSpeeds: Map<number, number>;
  landed: boolean;
  splashed: boolean;
  altitudeAGL: number;
}

/** Hull/leg points this far (m) above the local surface skip the full ground sample (far above rounding error). */
const CLEAR_MARGIN = 0.05;

/** Is the vessel close enough to the surface that contact must be evaluated? */
export function nearSurface(v: VesselState, env: Environment, t: number, h: number): { ground: GroundSample | null; agl: number; near: boolean } {
  const g = env.ground(v.position, t);
  if (!g) return { ground: null, agl: NaN, near: false };
  const agl = dot(sub(v.position, g.surfacePoint), g.normal);
  const margin = v.cache.boundingRadius * 1.5 + length(v.velocity) * h * 2 + 1;
  return { ground: g, agl, near: agl < margin };
}

export function gatherContacts(v: VesselState, env: Environment, t: number, h: number, gravityMag: number, wheelCtl: WheelControl = { brakes: false, throttle: 0 }, loads?: PartLoad[]): ContactPass {
  const out: ContactPass = { force: v3(), torque: v3(), contacts: [], impacts: [], impactSpeeds: new Map(), landed: false, splashed: false, altitudeAGL: NaN };
  const ns = nearSurface(v, env, t, h);
  out.altitudeAGL = ns.agl;
  for (const p of v.parts) if (p.leg) { p.leg.inContact = false; p.leg.compression = 0; }
  for (const p of v.parts) if (p.wheel) { p.wheel.inContact = false; p.wheel.compression = 0; }
  if (!ns.near) return out;
  const omegaW = qRotate(v.orientation, v.angularVelocity);
  const impacted = new Set<number>();
  const impact = (uid: number, speed: number) => {
    impacted.add(uid);
    out.impactSpeeds.set(uid, Math.max(out.impactSpeeds.get(uid) ?? 0, speed));
  };
  const record = (partUid: number, r: Vec3, force: Vec3) => {
    if (loads) loads.push({ partUid, point: add(v.com, qRotate(qConj(v.orientation), r)), force: qRotate(qConj(v.orientation), force) });
  };
  const pointVel = (rW: Vec3) => add(v.velocity, cross(omegaW, rW));
  const toWorldOffset = (pBody: Vec3) => qRotate(v.orientation, sub(pBody, v.com));

  for (const p of v.parts) {
    // Hull points.
    for (const hp of hullPoints(p.def)) {
      const rW = toWorldOffset(add(p.position, qRotate(p.rotation, hp)));
      const pw = add(v.position, rW);
      // Depth is the radial height below the surface projected on the outward normal: a point clearly above the
      // surface cannot penetrate, so skip the full ground sample (and its finite-difference normal).
      if (env.clearOfGround?.(pw, t, CLEAR_MARGIN)) continue;
      const gs = env.ground(pw, t);
      if (!gs) continue;
      const depth = dot(sub(gs.surfacePoint, pw), gs.normal);
      if (depth <= 0) continue;
      const approach = -dot(sub(pointVel(rW), gs.surfaceVelocity), gs.normal);
      if (gs.isWater) {
        if (approach > p.def.crashTolerance && depth < approach * h + 0.05) impact(p.uid, approach);
        continue;
      }
      if (approach > p.def.crashTolerance) impact(p.uid, approach);
      out.contacts.push({ partUid: p.uid, r: rW, n: gs.normal, surfaceVelocity: gs.surfaceVelocity, kind: 'rigid', depth, legImpulse: 0, jn: 0, jt: v3() });
      out.landed = true;
    }
    // Landing leg suspension.
    if (p.leg && p.leg.deployed) {
      const m = p.def.modules[p.leg.moduleIndex] as LandingLegModule;
      const rW = toWorldOffset(add(p.position, qRotate(p.rotation, m.footPosition)));
      const pw = add(v.position, rW);
      const gs = env.clearOfGround?.(pw, t, CLEAR_MARGIN) ? null : env.ground(pw, t);
      if (gs && !gs.isWater) {
        const d = dot(sub(gs.surfacePoint, pw), gs.normal);
        if (d > 0) {
          const x = Math.min(d, m.travel);
          const vn = dot(sub(pointVel(rW), gs.surfaceVelocity), gs.normal);
          if (-vn > p.def.crashTolerance) impact(p.uid, -vn);
          // In microgravity a millimetre of stored spring energy can exceed escape speed.
          // Treat a deployed foot as a dissipative unilateral contact (no adhesion or bounce).
          if (gravityMag < 0.01) {
            p.leg.compression = x; p.leg.inContact = true; out.landed = true;
            out.contacts.push({ partUid: p.uid, r: rW, n: gs.normal, surfaceVelocity: gs.surfaceVelocity,
              kind: 'rigid', depth: d, legImpulse: 0, jn: 0, jt: v3() });
            continue;
          }
          const F = Math.max(0, m.spring * x - suspensionDamping(m.damper, vn) * vn);
          const Fv = scale(gs.normal, F);
          record(p.uid, rW, Fv);
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
    // Wheels: suspension + tyre.
    if (p.wheel && p.wheel.deploy >= 1) {
      const wg = wheelContactPoint(v, p);
      const m = wg.module;
      const cW = toWorldOffset(wg.center);
      const gs = env.ground(add(v.position, cW), t);
      if (gs && !gs.isWater) {
        const n = gs.normal;
        // Lowest point of the tyre (a disc ~ sphere for small tilts) at full suspension extension.
        const rW = sub(cW, scale(n, m.radius));
        const pen = dot(sub(gs.surfacePoint, add(v.position, rW)), n);
        if (pen > 0) {
          const downW = qRotate(v.orientation, wg.down);
          const cosA = Math.max(0.3, -dot(downW, n));
          const comp = pen / cosA;
          const x = Math.min(comp, m.travel);
          const vrel = sub(pointVel(rW), gs.surfaceVelocity);
          const vn = dot(vrel, n);
          if (-vn > p.def.crashTolerance) impact(p.uid, -vn);
          const F = Math.max(0, m.spring * x * cosA - suspensionDamping(m.damper, vn) * vn);
          const Fv = scale(n, F);
          record(p.uid, rW, Fv);
          out.force = add(out.force, Fv);
          out.torque = add(out.torque, cross(rW, Fv));
          let fwd = qRotate(v.orientation, wg.heading);
          fwd = sub(fwd, scale(n, dot(fwd, n)));
          const fl = length(fwd);
          fwd = fl > 1e-6 ? scale(fwd, 1 / fl) : v3();
          // Drive motor (rovers): force along the heading, limited by grip.
          if (m.motorTorque && wheelCtl.throttle !== 0 && fl > 1e-6) {
            const command = Math.max(-1, Math.min(1, wheelCtl.throttle));
            // A motor spinning with the wheel fades out towards its top speed; reversing against the roll keeps full force.
            const roll = dot(vrel, fwd) * Math.sign(command);
            const fade = m.maxDriveSpeed && roll > 0 ? Math.max(0, 1 - roll / m.maxDriveSpeed) : 1;
            const drive = command * fade * Math.min(m.motorTorque / m.radius, TYRE_MU * F);
            const Fd = scale(fwd, drive);
            record(p.uid, rW, Fd);
            out.force = add(out.force, Fd);
            out.torque = add(out.torque, cross(rW, Fd));
          }
          p.wheel.compression = x;
          p.wheel.inContact = true;
          p.wheel.rollSpeed = dot(vrel, fwd);
          out.landed = true;
          out.contacts.push({
            partUid: p.uid, r: rW, n, surfaceVelocity: gs.surfaceVelocity, kind: 'wheel', depth: 0, legImpulse: F * h, jn: 0, jt: v3(),
            fwd, brakeImpulse: wheelCtl.brakes ? (m.brakeTorque / m.radius) * h : 0, jl: 0, jf: 0,
          });
          if (comp > m.travel)
            out.contacts.push({ partUid: p.uid, r: rW, n, surfaceVelocity: gs.surfaceVelocity, kind: 'rigid', depth: (comp - m.travel) * cosA, legImpulse: 0, jn: 0, jt: v3() });
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
      const density = gs.liquidDensity ?? WATER_DENSITY;
      let F = scale(gs.normal, density * V * f * gravityMag);
      const vrel = sub(pointVel(rW), gs.surfaceVelocity);
      const sp = length(vrel);
      if (sp > 1e-9) {
        // Quadratic form drag + linear wave-radiation damping (zeta ~0.3 of the heave stiffness).
        const kHeave = (density * V * gravityMag) / Math.max(0.05, size);
        const cLin = 2 * WAVE_DAMPING_RATIO * Math.sqrt((kHeave * v.mass) / n) * f;
        let drag = 0.5 * density * Math.pow(V, 2 / 3) * f * sp * sp + cLin * sp;
        drag = Math.min(drag, (0.25 * v.mass * sp) / (h * n));
        F = add(F, scale(vrel, -drag / sp));
      }
      record(p.uid, rW, F);
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
export function solveContacts(v: VesselState, contacts: Contact[], loads?: PartLoad[], dt = 0.02, impacts: number[] = []): void {
  if (contacts.length === 0) return;
  // Crushed hardware yields instead of stopping the entire rigid body in a single step.
  const limits = new Map<number, number>();
  for (const uid of impacts) {
    const cs = contacts.filter(c => c.partUid === uid && c.kind === 'rigid');
    const speed = Math.max(0, ...cs.map(c => -dot(sub(add(v.velocity, cross(qRotate(v.orientation, v.angularVelocity), c.r)), c.surfaceVelocity), c.n)));
    limits.set(uid, 0.35 * (v.cache.byUid.get(uid)?.mass ?? 0) * speed / Math.max(1, cs.length));
  }
  const invI = worldInvInertia(v);
  const invM = 1 / v.mass;
  let vel = { ...v.velocity };
  let w = qRotate(v.orientation, v.angularVelocity);
  const apply = (J: Vec3, r: Vec3) => {
    vel = add(vel, scale(J, invM));
    w = add(w, m3MulVec(invI, cross(r, J)));
  };
  const effMass = (r: Vec3, d: Vec3) => invM + dot(d, cross(m3MulVec(invI, cross(r, d)), r));
  // Tyre: lateral grip (sticky / sliding) and longitudinal rolling resistance or brakes, inside a friction circle.
  const solveTyre = (c: Contact) => {
    const N = c.legImpulse;
    const f = c.fwd!;
    if (N <= 0 || dot(f, f) < 0.5) return;
    const l = cross(c.n, f);
    const vrel = sub(add(vel, cross(w, c.r)), c.surfaceVelocity);
    const vl = dot(vrel, l), vf = dot(vrel, f);
    const mu = Math.abs(vl) > TYRE_SLIDE_SPEED ? TYRE_MU_SLIDE : TYRE_MU;
    const maxTotal = mu * N;
    const longMax = c.brakeImpulse! > 0 ? Math.min(c.brakeImpulse!, maxTotal) : ROLLING_RESISTANCE * N;
    let jf = c.jf! - vf / effMass(c.r, f);
    jf = Math.max(-longMax, Math.min(longMax, jf));
    const latMax = Math.sqrt(Math.max(0, maxTotal * maxTotal - jf * jf));
    let jl = c.jl! - vl / effMass(c.r, l);
    jl = Math.max(-latMax, Math.min(latMax, jl));
    apply(add(scale(f, jf - c.jf!), scale(l, jl - c.jl!)), c.r);
    c.jf = jf;
    c.jl = jl;
  };
  for (let it = 0; it < SOLVER_ITERATIONS; it++) {
    for (const c of contacts) {
      if (c.kind === 'wheel') {
        solveTyre(c);
        continue;
      }
      if (c.kind === 'rigid') {
        const vrel = sub(add(vel, cross(w, c.r)), c.surfaceVelocity);
        const vn = dot(vrel, c.n);
        const dj = -vn / effMass(c.r, c.n);
        const jnNew = Math.min(limits.get(c.partUid) ?? Infinity, Math.max(0, c.jn + dj));
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
  if (loads) for (const c of contacts) {
    const J = c.kind === 'wheel'
      ? add(scale(c.fwd!, c.jf ?? 0), scale(cross(c.n, c.fwd!), c.jl ?? 0))
      : add(scale(c.n, c.jn), c.jt);
    loads.push({ partUid: c.partUid, point: add(v.com, qRotate(qConj(v.orientation), c.r)), force: scale(qRotate(qConj(v.orientation), J), 1 / dt) });
  }
  v.velocity = vel;
  v.angularVelocity = qRotate({ x: -v.orientation.x, y: -v.orientation.y, z: -v.orientation.z, w: v.orientation.w }, w);
}

import type { PartLoad } from './loads';
import { breakJoints, crashJointCuts, crashShocks, overloadedJoints } from './structure';
import { advanceISRU } from './isru';
import type { Vec3 } from '../../util/vec3';
import { add, length, scale, v3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { qConj, qMul, qNormalize, qRotate } from '../../util/quat';
import type { CommandModule, LandingLegModule, SolarPanelModule, WheelModule } from './types';
import type { ControlInput, StepResult, VesselState } from './runtime';
import type { Environment } from './env';
import { AU, G0 } from './env';
import { m3MulVec } from './mat3';
import { recomputeMassProperties, removePart, setGear } from './assembly';
import { activateNextStage } from './staging';
import { gimbalAuthority, produceIntakeAir, rcsAuthority, stepEngines, stepRcs, stepReactionWheels, wheelAuthority } from './engines';
import { computeAeroForces, controlSurfaceAuthority, updateParachutes } from './aero';
import { gatherContacts, nearSurface, penetrationCorrection, solveContacts, updateWheelDeploy } from './contact';
import { stepThermal } from './heating';
import { computeSas } from './sas';
import { addResource, drawResource } from './resources';

/** Fixed physics step, s. */
export const PHYSICS_DT = 1 / 50;
const MAX_SUBSTEPS = 64;

export interface StepOptions {
  /** Minimum substeps per step (more are added automatically for stiff leg suspensions). */
  substeps?: number;
  /** Skip the thermal model (e.g. for performance tests). */
  disableHeating?: boolean;
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

/** Body-frame angular velocity for a given orientation and inertial angular momentum. */
function omegaFromL(v: VesselState, q: Quat, L: Vec3): Vec3 {
  return m3MulVec(v.invInertia, qRotate(qConj(q), L));
}

/** Inertial angular momentum of the vessel about its COM. */
export function angularMomentum(v: VesselState): Vec3 {
  return qRotate(v.orientation, m3MulVec(v.inertia, v.angularVelocity));
}

/** Rotational kinetic energy, J. */
export function rotationalEnergy(v: VesselState): number {
  const Iw = m3MulVec(v.inertia, v.angularVelocity);
  return 0.5 * (Iw.x * v.angularVelocity.x + Iw.y * v.angularVelocity.y + Iw.z * v.angularVelocity.z);
}

/**
 * Integrate orientation over h with inertial angular momentum L held constant (torque-free motion),
 * RK4 on q' = 1/2 q (x) omega_body(q). Exactly conserves L; gyroscopic effects (precession, intermediate-axis
 * instability, principal-axis stability) emerge naturally.
 */
export function integrateOrientation(v: VesselState, q: Quat, L: Vec3, h: number): Quat {
  const f = (qq: Quat): Quat => {
    const qn = qNormalize(qq);
    const w = omegaFromL(v, qn, L);
    const d = qMul(qn, { x: w.x, y: w.y, z: w.z, w: 0 });
    return { x: 0.5 * d.x, y: 0.5 * d.y, z: 0.5 * d.z, w: 0.5 * d.w };
  };
  const addq = (a: Quat, b: Quat, s: number): Quat => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s, w: a.w + b.w * s });
  const k1 = f(q);
  const k2 = f(addq(q, k1, h / 2));
  const k3 = f(addq(q, k2, h / 2));
  const k4 = f(addq(q, k3, h));
  return qNormalize({
    x: q.x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: q.y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: q.z + (h / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
    w: q.w + (h / 6) * (k1.w + 2 * k2.w + 2 * k3.w + k4.w),
  });
}

/** Total control authority (torque per unit command, per body axis). */
export function controlAuthority(v: VesselState, input: ControlInput, env: Environment, t: number): Vec3 {
  const air = env.air(v.position, t);
  const speed = length(add(v.velocity, scale(air.windVelocity, -1)));
  const parts = [wheelAuthority(v), gimbalAuthority(v), input.rcs ? rcsAuthority(v) : v3(), controlSurfaceAuthority(v, air.sample, speed)];
  return parts.reduce((a, b) => add(a, b), v3());
}

/** Number of substeps needed for stable leg suspension integration near the ground. */
function requiredSubsteps(v: VesselState, env: Environment, t: number, dt: number): number {
  const ns = nearSurface(v, env, t, dt);
  if (!ns.near) return 1;
  let K = 0, C = 0;
  for (const p of v.parts)
    if (p.leg?.deployed) {
      const m = p.def.modules[p.leg.moduleIndex] as LandingLegModule;
      K += m.spring;
      C += m.damper;
    }
  for (const p of v.parts)
    if (p.wheel && p.wheel.deploy >= 1) {
      const m = p.def.modules[p.wheel.moduleIndex] as WheelModule;
      K += m.spring;
      C += m.damper;
    }
  if (K <= 0 || v.mass <= 0) return 1;
  const nK = Math.ceil((dt * Math.sqrt(K / v.mass)) / 0.2);
  const nC = Math.ceil((C * dt) / (v.mass * 0.4));
  return Math.max(1, nK, nC);
}

/**
 * Advance a vessel by dt (default 1/50 s). Mutates `v` in place (deterministically) and returns vessels
 * created by staging/destruction plus events. Translation: drift–kick–drift (2nd-order symplectic in
 * gravity) with forces evaluated at the midpoint; rotation: angular-momentum form with RK4 orientation.
 */
export function stepVessel(v: VesselState, input: ControlInput, env: Environment, t: number, dt = PHYSICS_DT, opts: StepOptions = {}): StepResult {
  const result: StepResult = { newVessels: [], events: [] };
  if (v.destroyed || v.parts.length === 0) return result;
  if (input.gear !== undefined) setGear(v, input.gear);
  updateWheelDeploy(v, dt);
  updateSteering(v, input.yaw);
  if (input.stage) result.newVessels.push(...activateNextStage(v, result.events).newVessels);
  const n = Math.min(MAX_SUBSTEPS, Math.max(opts.substeps ?? 1, requiredSubsteps(v, env, t, dt)));
  const h = dt / n;
  for (let s = 0; s < n && !v.destroyed; s++) {
    // `input.target` is the target's state at the step start; SAS evaluates at the substep midpoint, so carry
    // the target along with its velocity (in heliocentric coordinates both move ~30 km/s: a stale target
    // position would be hundreds of metres off and wreck target pointing at close range).
    const tMid = t + (s + 0.5) * h;
    const inp = input.target
      ? { ...input, target: { position: add(input.target.position, scale(input.target.velocity, tMid - t)), velocity: input.target.velocity } }
      : input;
    const before = result.newVessels.length;
    substep(v, inp, env, t + s * h, h, opts, result);
    for (const nv of result.newVessels.slice(before)) {
      (result.newVesselTimeOffsets ??= {})[nv.id] = (s + 1) * h;
    }
  }
  return result;
}

/** Rolling speed at which steering authority has halved, m/s (keeps high-speed taxiing from flipping the craft). */
export const STEER_FADE_SPEED = 12;

/** Steerable wheels follow yaw input (wheels behind the COM steer the opposite way); authority fades with speed. */
function updateSteering(v: VesselState, yaw: number): void {
  for (const p of v.parts) {
    if (!p.wheel) continue;
    const m = p.def.modules[p.wheel.moduleIndex] as WheelModule;
    if (!m.steerAngle) continue;
    const ahead = p.position.y - v.com.y >= 0 ? 1 : -1;
    const fade = 1 / (1 + (p.wheel.rollSpeed / STEER_FADE_SPEED) ** 2);
    p.wheel.steer = clamp1(yaw) * m.steerAngle * fade * ahead;
  }
}

function substep(v: VesselState, input: ControlInput, env: Environment, t: number, h: number, opts: StepOptions, result: StepResult): void {
  const tMid = t + h / 2;
  const loads: PartLoad[] = [];
  const omegaBefore = v.angularVelocity;
  // Drift (half).
  v.position = add(v.position, scale(v.velocity, h / 2));
  const g = env.gravity(v.position, tMid);
  const air = env.air(v.position, tMid);
  const q = v.orientation;
  const qInv = qConj(q);
  const airVelocityBody = qRotate(qInv, add(v.velocity, scale(air.windVelocity, -1)));

  // Contacts & buoyancy (positions at the midpoint, pre-kick velocities).
  const cp = gatherContacts(v, env, tMid, h, length(g), { brakes: !!input.brakes, throttle: input.wheelThrottle ?? 0 }, loads);
  const shocks = crashShocks(v, cp);

  // Controls.
  const pilot = { x: clamp1(input.pitch), y: clamp1(input.roll), z: -clamp1(input.yaw) };
  const sasCmd = input.sas !== 'off' || v.sas.mode !== 'off' ? computeSas(v, input, env, tMid, controlAuthority(v, input, env, tMid), h) : v3();
  const c = { x: clamp1(pilot.x + sasCmd.x), y: clamp1(pilot.y + sasCmd.y), z: clamp1(pilot.z + sasCmd.z) };
  v.telemetry.control = { pitch: c.x, roll: c.y, yaw: -c.z };
  const translate = { x: clamp1(input.translateX), y: clamp1(input.translateY), z: clamp1(input.translateZ) };

  // Actuators (consume resources).
  produceIntakeAir(v, airVelocityBody, air.sample.density, h);
  const machNow = air.sample.speedOfSound > 0 ? length(airVelocityBody) / air.sample.speedOfSound : 0;
  const eng = stepEngines(v, Math.max(0, Math.min(1, input.throttle)), c, air.sample.pressure, h, result.events, { density: air.sample.density, mach: machNow }, loads);
  const rcs = stepRcs(v, input.rcs, c, translate, air.sample.pressure, h, loads);
  const wheels = stepReactionWheels(v, c, h, loads);

  // Electrical: command module consumption & solar generation.
  const sun = env.sun(v.position, tMid);
  const sunBody = qRotate(qInv, sun.dir);
  for (const p of v.parts)
    for (const m of p.def.modules) {
      if (m.type === 'command' && (m as CommandModule).ecPerSecond > 0) drawResource(v, p.uid, 'electricCharge', (m as CommandModule).ecPerSecond * h);
      else if (m.type === 'solarPanel') {
        const sp = m as SolarPanelModule;
        const nrm = qRotate(p.rotation, { x: 0, y: 0, z: 1 });
        const cosA = sp.tracking ? 1 : Math.max(0, nrm.x * sunBody.x + nrm.y * sunBody.y + nrm.z * sunBody.z);
        const flux = sun.distance > 0 && isFinite(sun.distance) ? (AU / sun.distance) ** 2 : 0;
        addResource(v, 'electricCharge', sp.chargeRate * flux * cosA * h);
      }
    }

  advanceISRU(v, v.situation === 'landed' && v.parts.some(p => p.drillDeployed)
    ? env.regolithConcentration?.(v.position, tMid) ?? 0 : 0, h);

  // Aerodynamics & parachutes.
  const aero = computeAeroForces(v, { air: air.sample, airVelocityBody, control: c }, loads);
  updateParachutes(v, { air: air.sample, dynamicPressure: aero.dynamicPressure, altitudeAGL: cp.altitudeAGL }, h, result.events);

  // Sum forces.
  const Fbody = add(add(eng.forceBody, rcs.forceBody), aero.forceBody);
  const Tbody = add(add(add(eng.torqueBody, rcs.torqueBody), wheels.torqueBody), aero.torqueBody);
  const Fworld = add(qRotate(q, Fbody), cp.force);
  const Tworld = add(qRotate(q, Tbody), cp.torque);
  const m = v.mass;
  result.propulsiveDv = (result.propulsiveDv ?? 0) + (eng.thrust + (rcs.thrust ?? 0)) / m * h;

  // Kick.
  v.velocity = add(v.velocity, scale(add(g, scale(Fworld, 1 / m)), h));
  let L = add(angularMomentum(v), scale(Tworld, h));
  v.angularVelocity = omegaFromL(v, q, L);

  // Contact impulses.
  solveContacts(v, cp.contacts, loads, h, cp.impacts);
  const cuts = overloadedJoints(v, loads, h, omegaBefore);
  const crashCuts = crashJointCuts(v, shocks);
  L = angularMomentum(v);

  // Rotate & drift (half).
  v.orientation = integrateOrientation(v, q, L, h);
  v.angularVelocity = omegaFromL(v, v.orientation, L);
  v.position = add(add(v.position, scale(v.velocity, h / 2)), penetrationCorrection(cp.contacts));

  // Thermal.
  const overheated = opts.disableHeating
    ? []
    : stepThermal(v, { air: air.sample, airVelocityBody, sunDirBody: sunBody, sunDistance: sun.distance }, h);

  // Telemetry & situation.
  const pa = scale(Fworld, 1 / m);
  v.telemetry.properAcceleration = pa;
  v.telemetry.gForce = length(pa) / G0;
  v.telemetry.mach = aero.mach;
  v.telemetry.dynamicPressure = aero.dynamicPressure;
  v.telemetry.staticPressure = air.sample.pressure;
  v.telemetry.airDensity = air.sample.density;
  v.telemetry.altitudeAGL = cp.altitudeAGL;
  v.telemetry.thrust = eng.thrust;
  v.telemetry.intakeAirRatio = eng.airRatio;
  for (const p of v.parts)
    if (p.wheel) {
      if (!p.wheel.inContact) p.wheel.rollSpeed *= Math.exp(-h / 4); // free wheel spinning down
      p.wheel.spin = (p.wheel.spin + (p.wheel.rollSpeed / (p.def.modules[p.wheel.moduleIndex] as WheelModule).radius) * h) % (2 * Math.PI);
    }
  v.situation = cp.landed ? 'landed' : cp.splashed ? 'splashed' : 'flying';

  // Break attachments after integration, preserving the solved rigid-body velocity field.
  breakJoints(v, [...cuts, ...crashCuts.keys()], result, crashCuts);

  // Destruction (crash / overheat), including parts detached by another failure this step.
  const kill: [number, 'crash' | 'overheat'][] = [...cp.impacts.map((u) => [u, 'crash'] as [number, 'crash']), ...overheated.map((u) => [u, 'overheat'] as [number, 'overheat'])];
  for (const [uid, reason] of kill) {
    const owner = [v, ...result.newVessels].find(piece => piece.cache.byUid.has(uid));
    if (!owner) continue;
    result.events.push({ type: 'partDestroyed', vesselId: owner.id, partUid: uid, reason });
    result.newVessels.push(...removePart(owner, uid));
    if (owner.destroyed) result.events.push({ type: 'vesselDestroyed', vesselId: owner.id });
  }

  // Resources changed => mass properties (shifts COM state consistently).
  if (!v.destroyed) recomputeMassProperties(v, true);
}

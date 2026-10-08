import type { PartLoad } from './loads';
import type { Vec3 } from '../../util/vec3';
import { add, cross, dot, length, scale, sub, v3 } from '../../util/vec3';
import { qConj, qRotate } from '../../util/quat';
import type { AtmosphereSample } from '../atmosphere/api';
import type { LiftingSurfaceModule, ParachuteModule } from './types';
import type { PartState, VesselEvent, VesselState } from './runtime';
import { faceAreas, faceIndex } from './shapes';
import { deflectionScale } from './tweaks';
import { FAIRING_CYLINDER, fairingEncloses, fairingShell } from './fairing';

/**
 * Aerodynamics: per-part, occlusion-aware drag with Mach-dependent coefficients, lifting surfaces with
 * stall/induced drag/control deflection, and parachutes. Forces act at part centres and are summed into
 * a body-frame force and torque about the COM.
 */

/** Fraction of the rear (base) exposed area that produces drag when the front face is shielded. */
export const BASE_DRAG_FRACTION = 0.3;
/** Stall onset angle of attack, rad (~17 deg). */
export const STALL_ANGLE = 0.3;
/** Width of the stall transition, rad. */
export const STALL_WIDTH = 0.12;
/** Oswald efficiency * aspect ratio used for induced drag. */
export const EFFECTIVE_ASPECT = 5;
/** Parachute deploy animation time per phase, s. */
export const CHUTE_DEPLOY_TIME = 3;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Drag coefficient multiplier vs Mach: flat subsonic, transonic drag rise peaking at 2.5x near
 * Mach 1.1, decaying to 1.6x at high supersonic speed.
 */
export function machDragMultiplier(mach: number): number {
  if (mach <= 0.8) return 1;
  if (mach <= 1.1) return 1 + 1.5 * smoothstep(0.8, 1.1, mach);
  return 1.6 + 0.9 * Math.exp(-(mach - 1.1) * 1.5);
}

/** Lift-slope multiplier vs Mach (Prandtl–Glauert subsonic, Ackeret supersonic, blended transonic). */
export function liftMachFactor(mach: number): number {
  const sub = (m: number) => 1 / Math.sqrt(1 - m * m);
  const sup = (m: number) => Math.min(1, 4 / (2 * Math.PI * Math.sqrt(m * m - 1)));
  if (mach < 0.8) return sub(mach);
  if (mach > 1.2) return sup(mach);
  const t = (mach - 0.8) / 0.4;
  return sub(0.8) * (1 - t) + sup(1.2) * t;
}

/** Lift & drag coefficients of a lifting surface at angle of attack alpha (rad, -pi/2..pi/2). */
export function liftingCoefficients(alpha: number, liftSlope: number, machFactor = 1): { cl: number; cd: number } {
  const w = smoothstep(STALL_ANGLE, STALL_ANGLE + STALL_WIDTH, Math.abs(alpha));
  const clLin = liftSlope * machFactor * alpha;
  const s = Math.sin(alpha), c = Math.cos(alpha);
  const clPlate = 1.8 * s * c;
  const cl = (1 - w) * clLin + w * clPlate;
  const cdInduced = (clLin * clLin) / (Math.PI * EFFECTIVE_ASPECT);
  const cd = 0.008 + (1 - w) * cdInduced + w * 2 * s * s;
  return { cl, cd };
}

export interface FairingShielding {
  /** Parts wholly inside an attached fairing shell: no drag, lift or convective heating. */
  shielded: Set<number>;
  /** Fairing parts: projected shell areas per face [+X,-X,+Y,-Y,+Z,-Z] and the body-frame point their drag acts at. */
  shells: Map<number, { areas: number[]; centre: Vec3 }>;
}

/** Enclosure by fairing shells still attached to the vessel. */
export function fairingShielding(v: VesselState): FairingShielding {
  const out: FairingShielding = { shielded: new Set(), shells: new Map() };
  for (const f of v.parts) {
    const shell = fairingShell(f.def, f.tweaks);
    if (!shell) continue;
    const side = 2 * shell.radius * shell.height * (FAIRING_CYLINDER + (1 - FAIRING_CYLINDER) * 0.67);
    const cap = Math.PI * shell.radius * shell.radius;
    const base = faceAreas(f.def)[3];
    out.shells.set(f.uid, { areas: [side, side, cap, base, side, side], centre: add(f.position, qRotate(f.rotation, { x: 0, y: shell.baseY + shell.height * 0.4, z: 0 })) });
    for (const p of v.parts) if (p !== f && !out.shielded.has(p.uid) && fairingEncloses(shell, f, p)) out.shielded.add(p.uid);
  }
  return out;
}

/** Exposed area per face per part (part frame), accounting for node-attached neighbours and fairing shells. */
export function computeExposedAreas(v: VesselState, shielding: FairingShielding = fairingShielding(v)): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const p of v.parts) out.set(p.uid, faceAreas(p.def));
  for (const p of v.parts) {
    if (p.parent === null) continue;
    const par = v.cache.byUid.get(p.parent);
    if (!par) continue;
    const na = p.def.attachNodes.find((n) => n.id === p.attachNode);
    if (p.attachNode === 'srf' || !p.parentNode || p.parentNode === 'srf') {
      // Surface attached: the mount face of the child is against the parent's hull.
      if (na) out.get(p.uid)![faceIndex(na.direction)] = 0;
      continue;
    }
    const nb = par.def.attachNodes.find((n) => n.id === p.parentNode);
    if (!na || !nb) continue;
    const fa = faceIndex(na.direction), fb = faceIndex(nb.direction);
    const areaA = faceAreas(p.def)[fa], areaB = faceAreas(par.def)[fb];
    out.get(p.uid)![fa] -= areaB;
    out.get(par.uid)![fb] -= areaA;
  }
  for (const arr of out.values()) for (let i = 0; i < 6; i++) arr[i] = Math.max(0, arr[i]);
  for (const [uid, shell] of shielding.shells) {
    const arr = out.get(uid)!;
    for (let i = 0; i < 6; i++) if (i !== 3) arr[i] = shell.areas[i];
  }
  for (const uid of shielding.shielded) out.set(uid, [0, 0, 0, 0, 0, 0]);
  return out;
}

export interface AeroContext {
  air: AtmosphereSample;
  /** Air velocity relative to the COM, body frame (= R^T (wind - v)) negated: vessel velocity through air. */
  airVelocityBody: Vec3;
  /** Torque command vector c = (pitch, roll, -yaw), body frame. */
  control: Vec3;
}

export interface AeroResult {
  forceBody: Vec3;
  torqueBody: Vec3;
  mach: number;
  dynamicPressure: number;
}

/** Velocity of a part's centre through the air, body frame. */
export function partAirVelocityBody(v: VesselState, p: PartState, airVelocityBody: Vec3): Vec3 {
  return add(airVelocityBody, cross(v.angularVelocity, sub(p.position, v.com)));
}

/** Control surface deflection (rad) for a lifting surface given the torque command. */
export function controlDeflection(v: VesselState, p: PartState, mod: LiftingSurfaceModule, control: Vec3): number {
  if (mod.deflection <= 0 || mod.ctrlFraction <= 0) return 0;
  const n = qRotate(p.rotation, { x: 1, y: 0, z: 0 });
  const rxn = cross(sub(p.position, v.com), n);
  const l = length(rxn);
  if (l < 1e-6) return 0;
  return mod.deflection * deflectionScale(p) * Math.max(-1, Math.min(1, dot(scale(rxn, 1 / l), control)));
}

export function computeAeroForces(v: VesselState, ctx: AeroContext, loads?: PartLoad[]): AeroResult {
  const rho = ctx.air.density;
  const speed = length(ctx.airVelocityBody);
  const a = ctx.air.speedOfSound > 0 ? ctx.air.speedOfSound : 340;
  const mach = speed / a;
  const dynamicPressure = 0.5 * rho * speed * speed;
  let force = v3();
  let torque = v3();
  if (rho <= 0) return { forceBody: force, torqueBody: torque, mach, dynamicPressure };
  const machMul = machDragMultiplier(mach);
  const liftMach = liftMachFactor(mach);

  const shielded = v.cache.shielded;
  for (const p of v.parts) {
    if (shielded?.has(p.uid)) continue;
    const vb = partAirVelocityBody(v, p, ctx.airVelocityBody);
    const vp = qRotate(qConj(p.rotation), vb);
    const sp = length(vp);
    if (sp < 1e-9) continue;
    const exposed = v.cache.exposed.get(p.uid) ?? faceAreas(p.def);
    const wing = p.def.modules.find((m): m is LiftingSurfaceModule => m.type === 'liftingSurface');
    const comps = [vp.x, vp.y, vp.z];
    const fp = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      if (wing && i === 0) continue; // normal-direction force of wings comes from the lift model
      const c = comps[i];
      if (c === 0) continue;
      const front = c > 0 ? 2 * i : 2 * i + 1;
      const rear = c > 0 ? 2 * i + 1 : 2 * i;
      const area = Math.max(exposed[front], BASE_DRAG_FRACTION * exposed[rear]);
      const cd = i === 1 ? p.def.dragCoefficient.axial : p.def.dragCoefficient.side;
      fp[i] = -0.5 * rho * sp * c * cd * area * machMul;
    }
    let fPart: Vec3 = { x: fp[0], y: fp[1], z: fp[2] };

    if (wing) {
      const vhat = scale(vp, 1 / sp);
      const n = { x: 1, y: 0, z: 0 };
      const ndv = vhat.x;
      const alpha = Math.asin(Math.max(-1, Math.min(1, -ndv)));
      let lift = sub(n, scale(vhat, ndv));
      const ll = length(lift);
      lift = ll > 1e-9 ? scale(lift, 1 / ll) : v3();
      const q = 0.5 * rho * sp * sp;
      const delta = controlDeflection(v, p, wing, ctx.control);
      const fixed = liftingCoefficients(alpha, wing.liftSlope, liftMach);
      const moving = liftingCoefficients(alpha + delta, wing.liftSlope, liftMach);
      const cf = wing.ctrlFraction;
      const cl = (1 - cf) * fixed.cl + cf * moving.cl;
      const cd = ((1 - cf) * fixed.cd + cf * moving.cd) * machMul;
      fPart = add(fPart, scale(lift, q * wing.area * cl));
      fPart = add(fPart, scale(vhat, -q * wing.area * cd));
    }

    if (p.chute && p.chute.cda > 0) fPart = add(fPart, scale(vp, -0.5 * rho * sp * p.chute.cda));

    const fb = qRotate(p.rotation, fPart);
    const at = v.cache.aeroCentre?.get(p.uid) ?? p.position;
    loads?.push({ partUid: p.uid, point: at, force: fb });
    force = add(force, fb);
    torque = add(torque, cross(sub(at, v.com), fb));
  }
  return { forceBody: force, torqueBody: torque, mach, dynamicPressure };
}

/** Approximate control-surface torque per unit command on each body axis (N*m), for SAS gain scheduling. */
export function controlSurfaceAuthority(v: VesselState, air: AtmosphereSample, speed: number): Vec3 {
  const out = v3();
  if (air.density <= 0 || speed <= 0) return out;
  const q = 0.5 * air.density * speed * speed;
  const lm = liftMachFactor(air.speedOfSound > 0 ? speed / air.speedOfSound : 0);
  for (const p of v.parts) {
    for (const m of p.def.modules) {
      if (m.type !== 'liftingSurface' || m.deflection <= 0 || m.ctrlFraction <= 0) continue;
      const n = qRotate(p.rotation, { x: 1, y: 0, z: 0 });
      const rxn = cross(sub(p.position, v.com), n);
      const l = length(rxn);
      if (l < 1e-6) continue;
      const u = scale(rxn, 1 / l);
      const k = q * m.area * m.ctrlFraction * m.liftSlope * lm * Math.min(m.deflection * Math.abs(deflectionScale(p)), STALL_ANGLE) * l;
      out.x += k * u.x * u.x;
      out.y += k * u.y * u.y;
      out.z += k * u.z * u.z;
    }
  }
  return out;
}

export interface ChuteContext {
  air: AtmosphereSample;
  dynamicPressure: number;
  /** Height above ground (m); NaN/Infinity if unknown. */
  altitudeAGL: number;
}

/** Advance parachute state machines (arming, semi/full deploy animation, cutting on overload). */
export function updateParachutes(v: VesselState, ctx: ChuteContext, dt: number, events: VesselEvent[]): void {
  for (const p of v.parts) {
    const c = p.chute;
    if (!c) continue;
    const m = p.def.modules[c.moduleIndex] as ParachuteModule;
    const overload = ctx.dynamicPressure > 1.5 * m.maxQ;
    const prev = c.phase;
    if (c.phase === 'armed') {
      if (ctx.air.pressure >= (p.tweaks?.chuteMinPressure ?? m.minPressure) && !overload) {
        c.phase = 'semi';
        c.progress = 0;
      }
    } else if (c.phase === 'semi' || c.phase === 'full') {
      if (overload) {
        c.phase = 'cut';
        c.cda = 0;
      } else {
        c.progress = Math.min(1, c.progress + dt / CHUTE_DEPLOY_TIME);
        const e = smoothstep(0, 1, c.progress);
        if (c.phase === 'semi') {
          c.cda = m.semiCdA * e;
          if (ctx.altitudeAGL <= (p.tweaks?.chuteDeployAltitude ?? m.deployAltitude)) {
            c.phase = 'full';
            c.progress = 0;
          }
        } else c.cda = m.semiCdA + (m.deployedCdA - m.semiCdA) * e;
      }
    }
    if (c.phase !== prev) events.push({ type: 'chute', vesselId: v.id, partUid: p.uid, phase: c.phase });
  }
}


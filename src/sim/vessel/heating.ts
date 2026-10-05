import type { Vec3 } from '../../util/vec3';
import { dot, length, scale, sub } from '../../util/vec3';
import { qConj, qRotate } from '../../util/quat';
import type { AtmosphereSample } from '../atmosphere/api';
import type { PartState, VesselState } from './runtime';
import { AU, GAS_CONSTANT, SOLAR_CONSTANT, STEFAN_BOLTZMANN } from './env';
import { faceAreas, faceNoseRadius, faceSurfaceAreas } from './shapes';

/**
 * Thermal model: per part, six skin nodes (one per face direction, part frame) + one internal node.
 *  - Convective stagnation heating on flow-facing exposed skins, Sutton–Graves q = k sqrt(rho/rn) v^3,
 *    scaled by the face's incidence and by (1 - T_skin/T_recovery) (hot walls stop heating / cool);
 *  - radiative cooling of each exposed skin (Stefan–Boltzmann, emissivity 0.8) — shielded faces
 *    (covered by a neighbour) neither heat nor radiate;
 *  - sunlight absorbed per face by incidence (no planetary shadowing — pass distance = Infinity in shadow);
 *  - low-speed convective exchange with ambient air;
 *  - skin <-> internal conduction, internal <-> neighbour conduction across attach nodes;
 *  - ablative heat shields consume ablator to absorb heat on hot skins.
 * A part is destroyed when any skin or its interior exceeds maxTemp. Per-face skins let a leading face
 * reach its local radiative-equilibrium temperature (burn-up) while the rest of the part stays cool.
 */

export const SUTTON_GRAVES_K_EARTH = 1.7415e-4;
export const EMISSIVITY = 0.8;
export const ABSORPTIVITY = 0.4;
/** Specific heat of part material, J/(kg K). */
export const PART_SPECIFIC_HEAT = 800;
/** Skin heat capacity per m^2 (~5 kg/m^2 of metal), J/(m^2 K). Capped at 30% of the part's total. */
export const SKIN_AREAL_HEAT_CAPACITY = 4000;
/** Skin-to-interior conductance per m^2, W/(m^2 K). */
export const SKIN_CONDUCTANCE = 100;
/** Ablator effective heat of ablation (incl. pyrolysis gas blowing), J/kg. */
export const ABLATION_ENTHALPY = 1.0e7;
/** Ablation starts above this skin temperature, K. */
export const ABLATION_START_TEMP = 600;
/** Fraction of stagnation heat flux averaged over a flow-facing face. */
export const FACE_HEAT_FRACTION = 0.5;
const EARTH_AIR_MOLAR_MASS = 0.02897;

/** Molar mass derived from a sample (ideal gas): M = R rho T / p. */
export function molarMassFromSample(s: AtmosphereSample): number {
  if (s.pressure <= 0 || s.density <= 0 || s.temperature <= 0) return EARTH_AIR_MOLAR_MASS;
  return (GAS_CONSTANT * s.density * s.temperature) / s.pressure;
}

/** Sutton–Graves constant for an atmosphere, scaled from Earth air by molar mass (CO2 ~1.9e-4, H2/He ~0.8e-4). */
export function suttonGravesK(s: AtmosphereSample): number {
  return SUTTON_GRAVES_K_EARTH * Math.pow(molarMassFromSample(s) / EARTH_AIR_MOLAR_MASS, 0.3);
}

/** Stagnation-point convective heat flux, W/m^2. */
export function stagnationHeatFlux(rho: number, speed: number, noseRadius: number, k = SUTTON_GRAVES_K_EARTH): number {
  if (rho <= 0 || speed <= 0) return 0;
  return k * Math.sqrt(rho / Math.max(0.01, noseRadius)) * speed * speed * speed;
}

/** Adiabatic recovery temperature of the flow, K. */
export function recoveryTemperature(s: AtmosphereSample, speed: number): number {
  let cp = 1005;
  if (s.pressure > 0 && s.density > 0 && s.temperature > 0) {
    const Rs = s.pressure / (s.density * s.temperature);
    const gamma = s.speedOfSound > 0 ? (s.speedOfSound * s.speedOfSound) / (Rs * s.temperature) : 1.4;
    if (gamma > 1.01) cp = (gamma * Rs) / (gamma - 1);
  }
  return s.temperature + (0.9 * speed * speed) / (2 * cp);
}

export interface ThermalContext {
  air: AtmosphereSample;
  /** Vessel velocity through the air, body frame. */
  airVelocityBody: Vec3;
  /** Sun direction (body frame, unit) and distance (m). */
  sunDirBody: Vec3;
  sunDistance: number;
}

export function heatCapacity(p: PartState): number {
  return Math.max(1, p.mass) * PART_SPECIFIC_HEAT;
}

/** Hottest temperature of a part (any skin or interior), K. */
export function peakTemperature(p: PartState): number {
  return Math.max(p.temperature, ...p.skinTemperature);
}

/**
 * Convective heating in the near wake of an aligned heat shield. Node adjacency alone misses small
 * exposed rims farther up a tapered capsule (notably its stowed chute). Only wholly contained parts
 * receive protection; sideways, upstream and outboard hardware still sees stagnation heating.
 * The finite cylindrical wake is deliberately conservative; residual heating is 3% of free stream.
 */
function shieldWakeFactor(p: PartState, shields: PartState[], flow: Vec3): number {
  const shape = p.def.shape;
  if (shape.kind !== 'cylinder') return 1;
  const axis = qRotate(p.rotation, { x: 0, y: 1, z: 0 });
  const axial = Math.min(1, Math.abs(dot(axis, flow)));
  const projectedRadius = Math.max(shape.radiusTop, shape.radiusBottom) + shape.height * 0.5 * Math.sqrt(1 - axial * axial);
  for (const shield of shields) {
    if (shield === p || shield.def.shape.kind !== 'cylinder') continue;
    const alignment = Math.abs(dot(qRotate(shield.rotation, { x: 0, y: 1, z: 0 }), flow));
    if (alignment < 0.9) continue;
    const radius = Math.max(shield.def.shape.radiusTop, shield.def.shape.radiusBottom);
    const delta = sub(p.position, shield.position);
    const along = dot(delta, flow);
    if (along >= 0 || along < -8 * radius) continue;
    const offset = length(sub(delta, scale(flow, along)));
    if (offset + projectedRadius <= radius * alignment + 1e-6) return 0.03;
  }
  return 1;
}

/** Advance part temperatures by dt. Returns uids of parts exceeding their max temperature. */
export function stepThermal(v: VesselState, ctx: ThermalContext, dt: number): number[] {
  const s = ctx.air;
  const speed = length(ctx.airVelocityBody);
  const k = suttonGravesK(s);
  const Tr = Math.max(1, recoveryTemperature(s, speed));
  const Tsky = 3 + (Math.max(3, s.temperature) - 3) * Math.min(1, s.density / 0.01);
  const solarFlux = isFinite(ctx.sunDistance) && ctx.sunDistance > 0 ? SOLAR_CONSTANT * (AU / ctx.sunDistance) ** 2 : 0;
  const hAmb = s.density > 0 ? 10 * Math.sqrt(s.density / 1.225) : 0;
  const internalPower = new Map<number, number>();
  const destroyed: number[] = [];
  const shields = speed > 0 && s.density > 0 ? v.parts.filter(p => p.def.modules.some(m => m.type === 'heatShield')) : [];
  const flow = speed > 0 ? scale(ctx.airVelocityBody, 1 / speed) : { x: 0, y: 0, z: 0 };

  for (const p of v.parts) {
    const wake = shieldWakeFactor(p, shields, flow);
    const proj = faceAreas(p.def);
    const surf = faceSurfaceAreas(p.def);
    const exposed = v.cache.exposed.get(p.uid) ?? proj;
    const rn = faceNoseRadius(p.def);
    const qp = qConj(p.rotation);
    const vp = qRotate(qp, ctx.airVelocityBody);
    const sp = qRotate(qp, ctx.sunDirBody);
    const flowComp = [vp.x, vp.y, vp.z];
    const sunComp = [sp.x, sp.y, sp.z];
    const Cint = heatCapacity(p);
    let surfTotal = 0;
    for (const a of surf) surfTotal += a;
    const areal = Math.min(SKIN_AREAL_HEAT_CAPACITY, (0.3 * Cint) / Math.max(1e-6, surfTotal));
    const shield = p.def.modules.find((m) => m.type === 'heatShield') as { type: 'heatShield'; ablationRate: number; maxTemp: number } | undefined;
    let exposedSurfTotal = 0;
    const frac = proj.map((a, f) => (a > 0 ? exposed[f] / a : 0));
    for (let f = 0; f < 6; f++) exposedSurfTotal += surf[f] * frac[f];
    let pInt = 0;
    for (let f = 0; f < 6; f++) {
      const axis = f >> 1;
      const sign = f & 1 ? -1 : 1;
      const Cs = Math.max(1, areal * surf[f]);
      const T = p.skinTemperature[f];
      const Arad = surf[f] * frac[f];
      let P = 0;
      if (Arad > 0) {
        const inc = (sign * flowComp[axis]) / Math.max(speed, 1e-9);
        if (inc > 0 && s.density > 0)
          P += stagnationHeatFlux(s.density, speed, rn[f], k) * FACE_HEAT_FRACTION * wake * inc * exposed[f] * (1 - T / Tr);
        P += hAmb * Arad * (s.temperature - T);
        P -= EMISSIVITY * STEFAN_BOLTZMANN * Arad * (T ** 4 - Tsky ** 4);
        const sunInc = sign * sunComp[axis];
        if (sunInc > 0) P += ABSORPTIVITY * solarFlux * sunInc * exposed[f];
      }
      // Skin <-> interior (limited for explicit stability).
      const g = Math.min(SKIN_CONDUCTANCE * surf[f], (0.25 * Math.min(Cs, Cint)) / dt);
      const q = g * (p.temperature - T);
      P += q;
      pInt -= q;
      let Tn = T + (P * dt) / Cs;
      // Ablation on hot skins.
      const abl = p.resources.ablator ?? 0;
      if (shield && abl > 0 && Tn > ABLATION_START_TEMP && Arad > 0) {
        const fr = Math.min(1, (Tn - ABLATION_START_TEMP) / Math.max(1, 0.5 * shield.maxTemp - ABLATION_START_TEMP));
        const dens = v.resourceDefs.ablator.density;
        let units = Math.min(abl, shield.ablationRate * fr * dt * (Arad / Math.max(1e-9, exposedSurfTotal)));
        if (dens > 0) units = Math.min(units, ((Tn - ABLATION_START_TEMP) * Cs) / (dens * ABLATION_ENTHALPY));
        p.resources.ablator = abl - units;
        Tn -= (units * dens * ABLATION_ENTHALPY) / Cs;
      }
      p.skinTemperature[f] = Math.max(2.7, Tn);
    }
    internalPower.set(p.uid, pInt);
  }
  for (const [a, b, g] of v.cache.links) {
    const pa = v.cache.byUid.get(a), pb = v.cache.byUid.get(b);
    if (!pa || !pb) continue;
    const gMax = (0.25 * Math.min(heatCapacity(pa), heatCapacity(pb))) / dt;
    const flow = Math.min(g, gMax) * (pb.temperature - pa.temperature);
    internalPower.set(a, (internalPower.get(a) ?? 0) + flow);
    internalPower.set(b, (internalPower.get(b) ?? 0) - flow);
  }
  for (const p of v.parts) {
    p.temperature = Math.max(2.7, p.temperature + ((internalPower.get(p.uid) ?? 0) * dt) / heatCapacity(p));
    if (peakTemperature(p) > p.maxTemp) destroyed.push(p.uid);
  }
  return destroyed;
}

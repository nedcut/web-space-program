import type { AtmosphereSample } from '../atmosphere/api';
import { sampleAtmosphere } from '../atmosphere';
import type { Body } from '../bodies/types';
import { occluded, type Occluder } from '../comms/network';
import { length, sub, type Vec3 } from '../../util/vec3';

/** Point-source eclipse; shared float64 segment/sphere geometry with communications. */
export function sunExposure(position: Vec3, sun: Vec3, bodies: Occluder[]): number {
  // A terrain valley may sit below the datum sphere. Clamp containing spheres to
  // the observer's radius so the sunward horizon is not permanently buried.
  return occluded(position, sun, bodies.map(b => { const r = length(sub(position, b.position)); return r < b.radius ? { ...b, radius: r } : b; })) ? 0 : 1;
}

/** Continue gas-giant profiles below the one-bar datum with a dry adiabat. */
export function hazardAtmosphere(body: Body, altitude: number): AtmosphereSample {
  // The stellar photosphere is an absorbing thermal boundary, not a landing surface.
  if (body.kind === 'star' && altitude < 0) return { pressure: 1e8, temperature: 5800, density: 0.001, speedOfSound: 8000 };
  const a = body.atmosphere;
  if (!a || body.solidSurface || altitude >= 0) return sampleAtmosphere(a, altitude, body.surfaceGravity);
  const depth = Math.min(body.radius, -altitude) / (a.verticalScale ?? 1);
  const cp = a.gamma / (a.gamma - 1) * 8.314462618 / a.molarMass;
  const temperature = a.surfaceTemperature + body.surfaceGravity * depth / cp;
  const pressure = Math.min(1e12, a.surfacePressure * (temperature / a.surfaceTemperature) ** (a.gamma / (a.gamma - 1)));
  return { temperature, pressure, density: pressure * a.molarMass / (8.314462618 * temperature),
    speedOfSound: Math.sqrt(a.gamma * 8.314462618 * temperature / a.molarMass) };
}

/** Gameplay dose, Gy/s: axisymmetric dipole L-shell belts, not a radiation transport model.
 * Input is body-fixed; lengths normalized by radius preserve belts across scale presets.
 * No cosmic background, solar storms, SAA, or particle spectrum is represented. */
export function radiationRate(bodyId: string, relativeFixed: Vec3, radius: number): number {
  const r = length(relativeFixed) / radius;
  if (r <= 1 || r > 30) return 0;
  const cos2 = Math.max(0.01, 1 - (relativeFixed.z / (r * radius)) ** 2);
  const L = r / cos2;
  const belt = (center: number, width: number, peak: number) => peak * Math.exp(-0.5 * ((L - center) / width) ** 2) * cos2 ** 3;
  const atmosphericCutoff = 1 - Math.exp(-(((r - 1) / 0.15) ** 4));
  if (bodyId === 'jupiter') return atmosphericCutoff * (belt(2.5, 0.9, 0.05) + belt(7, 2.5, 0.005));
  if (bodyId === 'saturn') return atmosphericCutoff * belt(3, 0.8, 2e-6);
  if (bodyId === 'earth') return atmosphericCutoff * (belt(1.6, 0.18, 1e-7) + belt(4, 0.7, 2e-8));
  return 0;
}

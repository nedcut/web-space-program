import type { Vec3 } from '../../util/vec3';

/** Lambert-sphere phase law, scaled by the source's solid angle; bounded near the source surface. */
export function reflectedIrradiance(radius: number, distance: number, phaseCosine: number): number {
  if (radius <= 0 || distance <= radius) return 0;
  const alpha = Math.acos(Math.max(-1, Math.min(1, phaseCosine)));
  const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
  return Math.min(0.15, (2 / 3) * (radius / distance) ** 2 * Math.max(0, phase));
}

export interface PlanetLightSource {
  position: Vec3;
  radius: number;
  albedo: readonly number[];
  sunDirection: Vec3;
  irradiance: number;
}

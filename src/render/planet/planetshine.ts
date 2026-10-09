import type { Vec3 } from '../../util/vec3';

/** Lambert-sphere phase law, scaled by the source's solid angle; bounded near the source surface. */
export function reflectedIrradiance(radius: number, distance: number, phaseCosine: number): number {
  if (radius <= 0 || distance <= radius) return 0;
  const alpha = Math.acos(Math.max(-1, Math.min(1, phaseCosine)));
  const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
  return Math.min(0.15, (2 / 3) * (radius / distance) ** 2 * Math.max(0, phase));
}

/**
 * Planetshine as displayed. The physical value (a fraction of the Sun's irradiance) is ~2e-4 for full
 * earthshine on the Moon: right for a camera exposed for daylight, but it leaves a night side pitch black where
 * an eye adapted to the dark side sees ashen light. Compress the ratio by its square root (≈1.4 % for that full
 * Earth, ~0.4 % at quarter phase), capped like the physical value. Direction, phase and parent colour stay physical.
 */
export function adaptedPlanetshine(reflected: number): number {
  return reflected > 0 ? Math.min(0.15, Math.sqrt(reflected)) : 0;
}

export interface PlanetLightSource {
  position: Vec3;
  radius: number;
  albedo: readonly number[];
  sunDirection: Vec3;
  irradiance: number;
}

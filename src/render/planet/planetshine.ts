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
 * an eye adapted to the dark side sees ashen light. Display 8·√ratio (≈11 % for that full Earth, ~6 % at quarter
 * phase), capped like the physical value. Measured on the real pipeline: the ACES toe crushes anything weaker
 * (√ratio alone, or ×4 of it, still renders the night side at 0–2 / 255); ×8 shows crater rims faintly.
 * Direction, phase and parent colour stay physical.
 */
export function adaptedPlanetshine(reflected: number): number {
  return reflected > 0 ? Math.min(0.15, 8 * Math.sqrt(reflected)) : 0;
}

/**
 * Whole-disc reflectance (linear RGB) of a body lighting its moons. Earth's terrain palette is its land colour
 * (dark green), but its disc is oceans, ice and cloud: Bond albedo ≈ 0.3, slightly blue. Others: the main
 * surface colour.
 */
export function discAlbedo(bodyId: string, surfaceColors: readonly (readonly number[])[] | undefined): readonly number[] {
  if (bodyId === 'earth') return [0.29, 0.31, 0.36];
  return surfaceColors?.[1] ?? [0.4, 0.4, 0.4];
}

export interface PlanetLightSource {
  position: Vec3;
  radius: number;
  albedo: readonly number[];
  sunDirection: Vec3;
  irradiance: number;
}

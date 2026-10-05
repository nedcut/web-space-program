import type { BodyDef, OrbitalElements } from './types';
import { elementsToState } from '../orbit/kepler';
import type { StateVector } from '../orbit/api';

export interface AsteroidSeed { id: string; radius: number; seed: number; orbit: OrbitalElements }
/** Fictional, reproducible objects, deliberately distinct from the real named catalogue. */
export function generateAsteroidField(): AsteroidSeed[] {
  let seed = 0x5eedb17;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: 208 }, (_, i) => {
    const neo = i >= 200;
    return { id: `asteroid-${String(i + 1).padStart(3, '0')}`, radius: 30 + random() * 470, seed: i + 817,
      orbit: { a: (neo ? 0.95 + random() * 0.5 : 2.1 + random() * 1.15) * 149597870700,
        e: neo ? 0.1 + random() * 0.35 : random() * 0.16, i: random() * 0.3,
        lan: random() * 2 * Math.PI, argPe: random() * 2 * Math.PI,
        meanAnomalyAtEpoch: random() * 2 * Math.PI, epoch: 0, frame: 'ecliptic' } };
  });
}
export function asteroidState(seed: AsteroidSeed, sunGM: number, lengthScale: number, t: number): StateVector {
  return elementsToState({ ...seed.orbit, a: seed.orbit.a * lengthScale, body: 'sun', mu: sunGM,
    m0: seed.orbit.meanAnomalyAtEpoch }, t);
}
export function asteroidDefinition(seed: AsteroidSeed): BodyDef {
  return { id: seed.id, name: `Uncatalogued ${seed.id.slice(9)}`, kind: 'asteroid', parent: 'sun',
    radius: seed.radius, gm: 6.67430e-11 * 1800 * 4 / 3 * Math.PI * seed.radius ** 3,
    rotationPeriod: (6 + seed.seed % 17) * 3600, axialTilt: seed.seed % 3,
    orbit: seed.orbit, solidSurface: true,
    surface: { preset: 'irregular', shape: seed.seed % 3 === 0 ? 'bilobed' : 'elongated',
      relief: seed.radius * 0.02, seed: seed.seed, colors: [[0.09, 0.08, 0.07], [0.2, 0.18, 0.16]] },
    description: 'A procedurally generated asteroid, not a measured real object.' };
}

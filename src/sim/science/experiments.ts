import type { Body } from '../bodies/types';
import type { Situation } from './biomes';
export interface Experiment { id: string; name: string; base: number; situations: Situation[]; biomes: Situation[] }
const all: Situation[] = ['landed', 'splashed', 'flyingLow', 'flyingHigh', 'spaceLow', 'spaceHigh'];
const surface: Situation[] = ['landed', 'splashed'];
export const EXPERIMENTS: Experiment[] = [
  { id: 'temperature', name: 'Thermal survey', base: 8, situations: all, biomes: [...surface, 'flyingLow'] },
  { id: 'pressure', name: 'Pressure profile', base: 10, situations: [...surface, 'flyingLow', 'flyingHigh'], biomes: [...surface, 'flyingLow'] },
  { id: 'seismic', name: 'Ground resonance', base: 18, situations: ['landed'], biomes: ['landed'] },
  { id: 'magnetic', name: 'Magnetic field survey', base: 16, situations: all, biomes: surface },
  { id: 'gravity', name: 'Gravity gradient', base: 22, situations: ['landed', 'spaceLow', 'spaceHigh'], biomes: ['landed', 'spaceLow'] },
  { id: 'exposure', name: 'Material exposure', base: 25, situations: ['spaceLow', 'spaceHigh'], biomes: [] },
  { id: 'crewReport', name: 'Crew observations', base: 8, situations: all, biomes: [...surface, 'flyingLow'] },
  { id: 'surfaceSample', name: 'Surface sample', base: 30, situations: ['landed'], biomes: ['landed'] },
];
export interface ScienceContext { body: string; biome: string; situation: Situation }
export interface ScienceData extends ScienceContext { id: number; subject: string; experiment: string; value: number; credited: number }
export interface ArchiveEntry extends ScienceContext { experiment: string; runs: number; science: number }
export function subjectKey(experiment: Experiment, c: ScienceContext): string {
  return [experiment.id, c.body, c.situation, experiment.biomes.includes(c.situation) ? c.biome : 'global'].join('/');
}
export function bodyMultiplier(body: Pick<Body, 'id' | 'parent'>): number {
  if (body.id === 'earth') return 1;
  if (body.id === 'moon') return 3;
  if (body.parent === 'saturn') return 9;
  if (body.parent === 'jupiter') return 7;
  if (body.id === 'mars' || body.id === 'venus') return 4;
  return 6;
}
/** Geometric decay keeps the total per subject finite (2 × first-run value). */
export function scienceValue(base: number, multiplier: number, previousRuns: number): number {
  return base * multiplier * Math.pow(0.5, Math.max(0, previousRuns));
}
export function experimentAvailable(e: Experiment, c: ScienceContext, atmosphere: boolean): boolean {
  return e.situations.includes(c.situation) && (e.id !== 'pressure' || atmosphere);
}

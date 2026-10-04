import type { PartState, VesselState } from '../vessel/runtime';
import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';

export interface Astronaut {
  id: string;
  name: string;
  courage: number;
  skill: number;
  portrait: number;
}
export interface PlantedFlag {
  id: string;
  body: string;
  /** Body-fixed surface position and attitude. */
  position: Vec3;
  orientation: Quat;
  astronautId: string;
  plantedAt: number;
}
export const SUITED_MASS = 100;
export const seatCapacity = (p: PartState) => p.def.modules.reduce((n, m) => n + (m.type === 'command' ? m.crew : 0), 0);
export const crewIds = (v: VesselState) => v.eva ? [v.eva.astronautId] : v.parts.flatMap(p => p.crew ?? []);
export const hasControl = (v: VesselState) => !v.destroyed && (!!v.eva || v.parts.some(p => (p.crew?.length ?? 0) > 0 || p.def.modules.some(m => m.type === 'command' && m.crew === 0)));

/** Stable integer PRNG: names/stats depend only on roster seed and recruitment index. */
export function generateAstronaut(seed: number, index: number): Astronaut {
  let s = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const first = ['Amara', 'Sofia', 'Mei', 'Arjun', 'Leila', 'Mateo', 'Yuna', 'Idris', 'Anika', 'Noah', 'Elena', 'Kwame', 'Hana', 'Rafael', 'Zoya', 'Elias'];
  const last = ['Okafor', 'Navarro', 'Chen', 'Patel', 'Haddad', 'Silva', 'Tanaka', 'Mensah', 'Rao', 'Bennett', 'Petrova', 'Diallo', 'Kim', 'Alvarez', 'Rahman', 'Andersen'];
  return { id: `crew-${seed}-${index}`, name: `${first[Math.floor(random() * first.length)]} ${last[Math.floor(random() * last.length)]}`, courage: Math.round(random() * 100), skill: Math.round(random() * 100), portrait: Math.floor(random() * 65536) };
}

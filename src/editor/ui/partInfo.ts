import { RESOURCES } from '../../data/resources';
import { SIZE_RADIUS } from '../../data/parts';
import type { PartCategory, PartDef, ResourceId } from '../../sim/vessel/types';

export const CATEGORY_TABS: { id: PartCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All parts' },
  { id: 'command', label: 'Command' },
  { id: 'fuelTank', label: 'Fuel tanks' },
  { id: 'engine', label: 'Engines' },
  { id: 'coupling', label: 'Coupling' },
  { id: 'structural', label: 'Structural' },
  { id: 'aero', label: 'Aerodynamics' },
  { id: 'control', label: 'Control' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'utility', label: 'Utility' },
  { id: 'ground', label: 'Ground' },
];

export function wetMass(def: PartDef): number {
  let m = def.dryMass;
  for (const k in def.resources) m += (def.resources[k as ResourceId] ?? 0) * RESOURCES[k as ResourceId].density;
  return m;
}

export function sizeLabel(def: PartDef): string {
  const sizes = def.attachNodes.filter((n) => n.id !== 'srf').map((n) => n.size);
  if (!sizes.length) return 'Radial';
  const lo = Math.min(...sizes), hi = Math.max(...sizes);
  const d = (s: number) => `${(SIZE_RADIUS[s] * 2).toFixed(SIZE_RADIUS[s] * 2 < 1 ? 3 : 2).replace(/0$/, '')} m`;
  return lo === hi ? d(lo) : `${d(lo)} – ${d(hi)}`;
}

export const fmtKg = (kg: number) => (kg < 1000 ? `${kg.toFixed(0)} kg` : `${(kg / 1000).toFixed(kg < 10000 ? 2 : 1)} t`);
export const fmtKN = (n: number) => (n < 1000 ? `${n.toFixed(0)} N` : `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)} kN`);
export const fmtDv = (v: number) => `${Math.round(v).toLocaleString('en-US')} m/s`;

export const RESOURCE_SHORT: Record<ResourceId, string> = {
  liquidFuel: 'Fuel', oxidizer: 'Oxidizer', monopropellant: 'Monoprop', xenon: 'Xenon', solidFuel: 'Solid grain', electricCharge: 'Charge', ablator: 'Ablator', intakeAir: 'Air',
};

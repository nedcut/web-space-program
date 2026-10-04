import { PART_DEFS } from './parts';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import type { GameMode, Progression } from '../sim/science/progression';
export interface TechNode { id: string; name: string; cost: number; requires: string[]; parts: string[]; column: number; row: number }
const starters = new Set(['pod-lantern-1', 'tank-0-short', 'tank-1-short', 'tank-1-mid', 'eng-gust', 'eng-sirocco', 'srb-sparkler',
  'dec-0', 'dec-1', 'fin-keel', 'chute-main', 'shield-1', 'battery-brick', 'antenna-thread', 'sensor-thermal']);
// Small stack separators are essential even if catalogue IDs evolve.
for (const p of PART_DEFS) if (p.modules.some(m => m.type === 'decoupler' && !m.radial) && p.cost <= 400) starters.add(p.id);
const branches = [
  ['propulsion', 'Propellant Practice', 'Vacuum Craft', 'Heavy Combustion', 'Farflight Propulsion'],
  ['structures', 'Load Paths', 'Modular Structures', 'Orbital Assembly', 'Expedition Hardware'],
  ['aviation', 'Airflow Studies', 'Runway Systems', 'Swept Flight', 'High Energy Aviation'],
  ['guidance', 'Stable Platforms', 'Remote Navigation', 'Precision Attitude', 'Crewed Horizons'],
  ['energy', 'Solar Harvest', 'Power Networks', 'Long Range Telemetry', 'Deep Space Power'],
  ['discovery', 'Air Column Studies', 'Surface Listening', 'Field Cartography', 'Matter in Space'],
];
function branch(p: PartDef): string {
  if (p.category === 'science') return 'discovery';
  if (p.category === 'electrical') return 'energy';
  if (p.id.startsWith('jet-') || p.id.startsWith('intake-') || p.id.startsWith('fuse-') || p.id.startsWith('gear-') || p.id.startsWith('cockpit-') || p.category === 'aero') return 'aviation';
  if (p.category === 'engine' || p.category === 'fuelTank') return 'propulsion';
  if (p.category === 'command' || p.category === 'control') return 'guidance';
  return 'structures';
}
export const TECH_NODES: TechNode[] = [{ id: 'foundation', name: 'First Principles', cost: 0, requires: [], parts: PART_DEFS.filter(p => starters.has(p.id)).map(p => p.id), column: 0, row: 2 }];
for (const [row, [id, ...names]] of branches.entries()) {
  const parts = PART_DEFS.filter(p => !starters.has(p.id) && branch(p) === id).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  names.forEach((name, tier) => TECH_NODES.push({ id: `${id}-${tier}`, name, cost: [10, 35, 90, 180][tier],
    requires: [tier ? `${id}-${tier - 1}` : 'foundation'],
    parts: parts.filter((_, i) => Math.min(3, Math.floor(i * 4 / parts.length)) === tier).map(p => p.id), column: tier + 1, row }));
}
export function partUnlocked(partId: string, mode: GameMode, p: Progression): boolean {
  return mode === 'sandbox' || TECH_NODES.some(n => n.parts.includes(partId) && p.unlocked.includes(n.id));
}
export function unlockTech(p: Progression, id: string): boolean {
  const node = TECH_NODES.find(n => n.id === id);
  if (!node || p.unlocked.includes(id) || p.science < node.cost || !node.requires.every(r => p.unlocked.includes(r))) return false;
  p.science -= node.cost; p.unlocked.push(id); return true;
}
export function launchCost(craft: CraftDef, catalog: Map<string, PartDef>): number {
  return craft.parts.reduce((total, part) => total + (catalog.get(part.partId)?.cost ?? 0), 0);
}
export function launchProblem(craft: CraftDef, catalog: Map<string, PartDef>, mode: GameMode, p: Progression): string | null {
  if (!craft.parts.length) return 'Build a vehicle first.';
  const locked = craft.parts.find(part => !partUnlocked(part.partId, mode, p));
  if (locked) return `Research required: ${catalog.get(locked.partId)?.name ?? locked.partId}`;
  if (mode === 'career' && launchCost(craft, catalog) > p.funds) return `Insufficient funds: launch costs ${launchCost(craft, catalog).toLocaleString()} cr.`;
  return null;
}

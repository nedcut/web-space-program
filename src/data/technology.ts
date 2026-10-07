import { ISRU_PARTS } from './isru';
import { PART_DEFS } from './parts';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import type { GameMode, Progression } from '../sim/science/progression';
export interface TechNode { id: string; name: string; cost: number; requires: string[]; parts: string[]; column: number; row: number }
const starters = new Set(['pod-lantern-1', 'tank-0-short', 'tank-1-short', 'tank-1-mid', 'eng-gust', 'eng-sirocco', 'srb-sparkler',
  'dec-0', 'dec-1', 'fin-keel', 'chute-main', 'shield-1', 'battery-brick', 'antenna-thread', 'sensor-thermal']);
// Small stack separators are essential even if catalogue IDs evolve.
for (const p of PART_DEFS) if (p.modules.some(m => m.type === 'decoupler' && !m.radial) && p.cost <= 400) starters.add(p.id);
const resourceParts = new Set(ISRU_PARTS.map(p => p.id));
const branches = [
  ['propulsion', 'Propellant Practice', 'Vacuum Craft', 'Heavy Combustion', 'Farflight Propulsion'],
  ['structures', 'Load Paths', 'Modular Structures', 'Orbital Assembly', 'Expedition Hardware'],
  ['aviation', 'Airflow Studies', 'Runway Systems', 'Swept Flight', 'High Energy Aviation'],
  ['guidance', 'Stable Platforms', 'Remote Navigation', 'Precision Attitude', 'Crewed Horizons'],
  ['energy', 'Solar Harvest', 'Power Networks', 'Long Range Telemetry', 'Deep Space Power'],
  ['discovery', 'Air Column Studies', 'Surface Listening', 'Field Cartography', 'Matter in Space'],
];
// Explicit tiers for expansion hardware keep the original catalogue's research placement stable.
const expansionTiers: Record<string, string> = {};
for (const [node, ids] of Object.entries({
  'propulsion-1': ['eng-dewdrop', 'srb-candle', 'eng-radial-spray', 'eng-mistral'],
  'propulsion-2': ['eng-boreal', 'eng-needle', 'srb-reed', 'eng-radial-rill'],
  'propulsion-3': ['eng-hearth', 'eng-monsoon', 'srb-furnace', 'tank-4-short', 'tank-4-mid', 'tank-4-long'],
  'structures-0': ['fuel-line', 'beam-1', 'beam-2', 'panel-1', 'panel-2', 'strut-cubic', 'mount-radial', 'ladder-1', 'light-task'],
  'structures-1': ['truss-octagonal', 'bay-service-1', 'bay-cargo-1', 'adapt-0-2', 'ladder-2', 'light-area', 'chute-brake', 'rover-chassis'],
  'structures-2': ['bay-service-2', 'bay-cargo-2', 'adapt-1-3', 'fairing-3', 'chute-heavy', 'chute-radial-heavy', 'rover-wheel-0', 'rover-wheel-1', 'radiator-1'],
  'structures-3': ['shell-kiln', 'adapt-3-4', 'dec-4', 'shield-4', 'nose-4', 'fairing-4', 'interstage-4', 'leg-colossus', 'radiator-2'],
  'guidance-1': ['rcs-linear'], 'guidance-2': ['rcs-quint', 'wheel-reaction-2', 'cabin-wayfarer'],
  'guidance-3': ['wheel-reaction-3', 'probe-kiln', 'probe-vault'],
  'energy-1': ['fuelcell-1'], 'energy-2': ['fuelcell-2', 'battery-bank-2', 'solar-grand-1'],
  'energy-3': ['generator-isotope', 'battery-bank-3', 'solar-grand-2'],
  'discovery-3': ['lab-crucible'],
})) for (const id of ids) expansionTiers[id] = node;
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
  const parts = PART_DEFS.filter(p => !starters.has(p.id) && !expansionTiers[p.id] && !resourceParts.has(p.id) && branch(p) === id).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  names.forEach((name, tier) => TECH_NODES.push({ id: `${id}-${tier}`, name, cost: [10, 35, 90, 180][tier],
    requires: [tier ? `${id}-${tier - 1}` : 'foundation'],
    parts: [...parts.filter((_, i) => Math.min(3, Math.floor(i * 4 / parts.length)) === tier).map(p => p.id),
      ...PART_DEFS.filter(p => expansionTiers[p.id] === `${id}-${tier}`).map(p => p.id)], column: tier + 1, row }));
}
// Move only named early-game essentials; keep every unrelated catalogue assignment stable.
for (const [id, ids] of Object.entries({
  'propulsion-0': ['tank-1-long', 'eng-zephyr'],
  'propulsion-1': ['tank-2-short', 'tank-2-mid', 'tank-2-long', 'eng-chinook', 'eng-doldrum'],
  'structures-0': ['adapt-1-2'],
  'structures-1': ['leg-stilt', 'leg-strider'],
})) {
  for (const node of TECH_NODES) node.parts = node.parts.filter(part => !ids.includes(part));
  TECH_NODES.find(node => node.id === id)!.parts.push(...ids);
}
// Explicit assignments preserve the existing cost-sorted tiers when ISRU equipment is added.
for (const p of ISRU_PARTS) {
  const tier = p.id === 'scanner-assay' || p.id === 'regolith-hopper' ? 1 : p.id === 'drill-quarry' || p.id === 'converter-foundry' ? 3 : 2;
  TECH_NODES.find(n => n.id === `discovery-${tier}`)!.parts.push(p.id);
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

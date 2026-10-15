import { PART_CATALOG } from '../../data/parts';
import { partUnlocked, TECH_NODES } from '../../data/technology';
import type { GameMode, Progression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';
import type { StockCategory, StockCraft } from '../stockCrafts';

/**
 * How the craft pickers present stock vehicles: grouped by role, with the parts each one shows off, a "try this" tip
 * and, for locked designs, the research that unlocks them.
 */
export const STOCK_CATEGORIES: readonly { id: StockCategory; label: string }[] = [
  { id: 'first', label: 'First flights' },
  { id: 'orbit', label: 'Orbit & stations' },
  { id: 'worlds', label: 'Moon & planets' },
  { id: 'aircraft', label: 'Aircraft & rovers' },
  { id: 'fun', label: 'Just for fun' },
];

export function stockCategory(s: Pick<StockCraft, 'category' | 'launchBody'>, craft: CraftDef): StockCategory {
  if (s.category) return s.category;
  if (craft.type === 'SPH') return 'aircraft';
  return s.launchBody && s.launchBody !== 'earth' ? 'worlds' : 'orbit';
}

/** Stock entries in category order, keeping each category's catalogue order. */
export function groupStock<T extends { category: StockCategory }>(items: readonly T[]): { id: StockCategory; label: string; items: T[] }[] {
  return STOCK_CATEGORIES.map(c => ({ ...c, items: items.filter(s => s.category === c.id) })).filter(g => g.items.length > 0);
}

/** Signature hardware to name when a design lists no tags: its costliest engines, cockpits, instruments and gear. */
const PLAIN = new Set(['fuelTank', 'coupling', 'structural']);

/** Part names (or free-text tags) a craft is a good example of, at most `max`. */
export function stockFeatures(s: Pick<StockCraft, 'tags'>, craft: CraftDef, max = 4): string[] {
  if (s.tags?.length) return s.tags.slice(0, max).map(tag => PART_CATALOG.get(tag)?.name ?? tag);
  const defs = [...new Set(craft.parts.map(p => p.partId))].map(id => PART_CATALOG.get(id)).filter(d => !!d && !PLAIN.has(d.category));
  return defs.sort((a, b) => b!.cost - a!.cost || a!.name.localeCompare(b!.name)).slice(0, Math.min(max, 3)).map(d => d!.name);
}

/** Research nodes still needed for this craft's parts (empty when everything is unlocked). */
export function unlockingResearch(craft: CraftDef, mode: GameMode, progression: Progression): string[] {
  const nodes = new Set<string>();
  for (const id of new Set(craft.parts.map(p => p.partId))) {
    if (partUnlocked(id, mode, progression)) continue;
    const node = TECH_NODES.find(n => n.parts.includes(id));
    if (node) nodes.add(node.name);
  }
  return [...nodes];
}

/** "Research: A, B and 2 more" (or '' when nothing is locked). */
export function unlockText(nodes: readonly string[]): string {
  if (!nodes.length) return '';
  const shown = nodes.slice(0, 2).join(', ');
  return `Research ${nodes.length > 2 ? `${shown} and ${nodes.length - 2} more` : shown.replace(/, ([^,]*)$/, ' and $1')}`;
}

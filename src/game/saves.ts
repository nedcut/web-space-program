import type { CraftDef } from '../sim/vessel/types';

/**
 * Persistence. Crafts and save games live in localStorage (small JSON). Large data (future: terrain caches)
 * should go to IndexedDB. All keys are namespaced and versioned.
 */
const CRAFTS_KEY = 'wsp.crafts.v1';

export function listCrafts(): CraftDef[] {
  try {
    return JSON.parse(localStorage.getItem(CRAFTS_KEY) ?? '[]') as CraftDef[];
  } catch {
    return [];
  }
}

export function saveCraft(craft: CraftDef) {
  const all = listCrafts().filter((c) => c.name !== craft.name);
  all.push(craft);
  localStorage.setItem(CRAFTS_KEY, JSON.stringify(all));
}

export function deleteCraft(name: string) {
  localStorage.setItem(CRAFTS_KEY, JSON.stringify(listCrafts().filter((c) => c.name !== name)));
}

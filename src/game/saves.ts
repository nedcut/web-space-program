import type { CraftDef } from '../sim/vessel/types';

/**
 * Persistence. Crafts and save games live in localStorage (small JSON). Large data (future: terrain caches)
 * should go to IndexedDB. All keys are namespaced and versioned.
 */
const CRAFTS_KEY = 'wsp.crafts.v1';
const SAVE_PREFIX = 'wsp.save.v1.';

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

export interface SaveGame {
  id: string;
  name: string;
  savedAt: number;
  scalePreset: string;
  ut: number;
  /** Serialized vessels (format owned by the world module). */
  vessels: unknown[];
}

export function writeSave(save: SaveGame) {
  localStorage.setItem(SAVE_PREFIX + save.id, JSON.stringify(save));
}

export function readSave(id: string): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + id);
    return raw ? (JSON.parse(raw) as SaveGame) : null;
  } catch {
    return null;
  }
}

export function listSaves(): SaveGame[] {
  const out: SaveGame[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(SAVE_PREFIX)) {
      const s = readSave(k.slice(SAVE_PREFIX.length));
      if (s) out.push(s);
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

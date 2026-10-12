import type { LibraryCraft } from '../../game/saves';

export type LibrarySort = 'recent' | 'name' | 'parts';

/** Every whitespace-separated word must appear (case-insensitive), in any order. */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = text.toLowerCase();
  return words.every(w => hay.includes(w));
}

/** Craft library rows for a search, folder and sort order (pure; the dialog renders the result). */
export function filterLibrary(items: readonly LibraryCraft[], { query = '', folder = '', sort = 'recent' }: { query?: string; folder?: string; sort?: LibrarySort }): LibraryCraft[] {
  const rows = items.filter(item => (!folder || item.folder === folder) && matchesQuery(`${item.craft.name} ${item.folder} ${item.tags.join(' ')}`, query));
  const byName = (a: LibraryCraft, b: LibraryCraft) => a.craft.name.localeCompare(b.craft.name, undefined, { numeric: true, sensitivity: 'base' });
  return rows.sort(sort === 'name' ? byName : sort === 'parts' ? (a, b) => b.craft.parts.length - a.craft.parts.length || byName(a, b) : (a, b) => b.updatedAt - a.updatedAt || byName(a, b));
}

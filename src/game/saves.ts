import { localId } from '../util/localId';
import type { CraftDef } from '../sim/vessel/types';
import { PART_CATALOG } from '../data/parts';
import { validateCraft } from './craftSharing';

export const CRAFTS_KEY = 'wsp.crafts.v1';
export interface LibraryCraft { id: string; craft: CraftDef; folder: string; tags: string[]; updatedAt: number }
export interface CraftRepository {
  list(): Promise<LibraryCraft[]>;
  put(item: LibraryCraft): Promise<void>;
  remove(id: string): Promise<void>;
}
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wsp.craft-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('crafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('crafts', mode); const req = action(tx.objectStore('crafts'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('Craft storage failed.'));
  });
}
export const craftRepository: CraftRepository = {
  list: () => transaction('readonly', s => s.getAll()),
  put: async item => { await transaction('readwrite', s => s.put(item)); },
  remove: async id => { await transaction('readwrite', s => s.delete(id)); },
};

/** Retry-safe migration: retain the old key until every write has committed. */
export async function migrateCrafts(storage: Pick<Storage, 'getItem' | 'removeItem'>, repository: CraftRepository): Promise<void> {
  const raw = storage.getItem(CRAFTS_KEY); if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Legacy craft library is invalid.');
  const existing = new Set((await repository.list()).map(item => item.id));
  for (const input of parsed) {
    const result = validateCraft(input, PART_CATALOG);
    if (!result.craft) throw new Error(`Legacy craft cannot be migrated: ${[...result.errors, ...result.unknownParts].join(', ')}`);
    const id = `legacy:${result.craft.name}`;
    if (!existing.has(id)) { await repository.put({ id, craft: result.craft, folder: '', tags: [], updatedAt: Date.now() }); existing.add(id); }
  }
  storage.removeItem(CRAFTS_KEY);
}
let migration: Promise<void> | undefined;
async function ready() {
  migration ??= migrateCrafts(localStorage, craftRepository).catch(e => { migration = undefined; throw e; });
  await migration;
}
export async function listLibrary(): Promise<LibraryCraft[]> { await ready(); return craftRepository.list(); }
export async function listCrafts(): Promise<CraftDef[]> { return (await listLibrary()).map(item => item.craft); }
export async function saveLibraryItem(item: LibraryCraft) { await ready(); await craftRepository.put(item); }
export async function saveCraft(craft: CraftDef) {
  const previous = (await listLibrary()).find(item => item.craft.name === craft.name);
  await saveLibraryItem({ id: previous?.id ?? localId(), folder: previous?.folder ?? '', tags: previous?.tags ?? [], craft, updatedAt: Date.now() });
}
export async function deleteCraft(name: string) {
  for (const item of await listLibrary()) if (item.craft.name === name) await craftRepository.remove(item.id);
}

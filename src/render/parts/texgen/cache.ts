/**
 * IndexedDB cache for generated part textures, keyed by recipe name and TEX_VERSION. Works in
 * workers and on the main thread; every failure degrades to "not cached" (private mode, quota).
 */
import type { Channel } from './recipes';

export interface CachedTex {
  size: number;
  buffers: Partial<Record<Channel, ArrayBuffer>>;
}

const DB = 'wsp-part-textures';
const STORE = 'tex';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(version: number): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        prune(db, version);
        resolve(db);
      };
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

/** Drop entries from older texture versions. */
function prune(db: IDBDatabase, version: number) {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) if (typeof k === 'string' && !k.endsWith(`@v${version}`)) store.delete(k);
    };
  } catch {
    /* ignore */
  }
}

export async function cacheGet(key: string, version: number): Promise<CachedTex | null> {
  const db = await open(version);
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${key}@v${version}`);
      req.onsuccess = () => resolve((req.result as CachedTex | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store a texture (the buffers are structured-cloned synchronously, so they may be transferred afterwards). */
export async function cachePut(key: string, version: number, value: CachedTex): Promise<void> {
  const db = await open(version);
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, `${key}@v${version}`);
  } catch {
    /* quota or private mode: ignore */
  }
}

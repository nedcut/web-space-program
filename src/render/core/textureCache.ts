/**
 * Persistent cache for procedurally generated canvas textures (IndexedDB, PNG = lossless).
 *
 * Generating the part texture library costs seconds of main-thread time on a laptop. The first run
 * generates as before and stores PNGs in the background; later page loads decode them off the main
 * thread at startup (`preloadTextureCache`) so `takeCachedTextures` can return finished canvases
 * synchronously. Entries are keyed by a content hash of the generator source, so changing texture
 * code invalidates them automatically. Every failure path falls back to normal generation.
 */
const DB_NAME = 'wsp-texture-cache';
const STORE = 'textures';

export interface CachedTexture { slot: string; srgb: boolean; canvas: HTMLCanvasElement }
interface Record_ { id: string; group: string; slot: string; srgb: boolean; blob: Blob }

const decoded = new Map<string, { slot: string; srgb: boolean; bitmap: ImageBitmap }[]>();
let preload: Promise<void> | null = null;
let disabled = false;

/** FNV-1a 32-bit hash, as 8 hex digits. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: ['id', 'slot'] }); s.createIndex('group', 'group'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Start decoding cached textures (idempotent). Resolves when done or on any failure. */
export function preloadTextureCache(): Promise<void> {
  if (preload) return preload;
  if (typeof indexedDB === 'undefined' || typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
    disabled = true;
    return (preload = Promise.resolve());
  }
  preload = (async () => {
    try {
      const db = await openDb();
      const records = await new Promise<Record_[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as Record_[]);
        req.onerror = () => reject(req.error);
      });
      db.close();
      await Promise.all(records.map(async (r) => {
        const bitmap = await createImageBitmap(r.blob);
        const list = decoded.get(r.id) ?? [];
        list.push({ slot: r.slot, srgb: r.srgb, bitmap });
        decoded.set(r.id, list);
      }));
    } catch {
      disabled = true;
    }
  })();
  return preload;
}

/** Wait for the preload, but never longer than `ms` (slow storage must not delay a scene). */
export function textureCacheReady(ms = 1500): Promise<void> {
  const p = preloadTextureCache();
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Synchronously take decoded canvases for `id` (null when not cached / not yet decoded). */
export function takeCachedTextures(id: string): CachedTexture[] | null {
  const list = decoded.get(id);
  if (!list) return null;
  decoded.delete(id);
  return list.map(({ slot, srgb, bitmap }) => {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { slot, srgb, canvas };
  });
}

/** Store freshly generated canvases in the background and drop older versions of the same group. */
export function persistTextures(group: string, id: string, entries: CachedTexture[]): void {
  if (disabled || typeof indexedDB === 'undefined') return;
  const run = async () => {
    try {
      const blobs = await Promise.all(entries.map((e) => new Promise<Blob | null>((resolve) => e.canvas.toBlob(resolve, 'image/png'))));
      if (blobs.some((b) => !b)) return;
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const stale = store.index('group').openCursor(IDBKeyRange.only(group));
      stale.onsuccess = () => {
        const cur = stale.result;
        if (!cur) {
          // A throw inside this IDB callback would escape to window.onerror (the crash screen); the cache is optional.
          try { entries.forEach((e, i) => store.put({ id, group, slot: e.slot, srgb: e.srgb, blob: blobs[i]! } satisfies Record_)); } catch { /* best-effort */ }
          return;
        }
        if ((cur.value as Record_).id !== id) cur.delete();
        cur.continue();
      };
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch { /* cache is best-effort */ }
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(() => void run(), { timeout: 5000 }); else setTimeout(() => void run(), 1000);
}

/** Optional persistent PNG cache. A hashed production chunk URL invalidates images when art changes. */
const revision = import.meta.url.split('/').pop()!;
const urls = new Map<string, string>();
let database: Promise<IDBDatabase | null> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase | null>(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const timer = setTimeout(() => resolve(null), 500);
    try {
      const request = indexedDB.open('wsp-part-thumbnails', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onerror = () => { clearTimeout(timer); resolve(null); };
      request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    } catch { clearTimeout(timer); resolve(null); }
  });
}
let preload: Promise<void> | undefined;
export function preloadThumbnails(): Promise<void> {
  return preload ??= (async () => {
    const db = await open();
    if (!db) return;
    try {
      await new Promise<void>(resolve => {
        const tx = db.transaction('images', 'readwrite');
        const req = tx.objectStore('images').openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const key = String(cursor.key);
          if (key.startsWith(`${revision}:`)) urls.set(key.slice(revision.length + 1), URL.createObjectURL(cursor.value as Blob));
          else cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } catch { /* Storage is optional. */ }
  })();
}
export function cachedThumbnail(id: string) { return urls.get(id); }
export async function persistThumbnail(id: string, blob: Blob) {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(blob, `${revision}:${id}`);
    tx.onerror = () => {}; // Quota/private-mode failures must not reach the crash overlay.
  } catch { /* Storage is optional. */ }
}

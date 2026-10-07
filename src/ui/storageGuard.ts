/**
 * Must be the first import of main.tsx (modules read settings while they evaluate).
 *
 * Firefox/Safari throw a SecurityError on *any* `localStorage` access when the player blocks site data
 * (cookie blocking, some privacy modes/extensions). The game reads it from dozens of places, including the
 * crash screen, so instead of guarding each one the page gets an in-memory Storage for the session and a
 * notice. Only access errors count: a full but readable store (QuotaExceededError on write) keeps its saves.
 */
function accessible(): boolean {
  try { void window.localStorage.getItem('wsp.settings.v1'); return true; } catch { return false; }
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(String(k)) ?? null,
    setItem: (k: string, v: string) => { data.set(String(k), String(v)); },
    removeItem: (k: string) => { data.delete(String(k)); },
    clear: () => data.clear(),
  };
}

export const storageBlocked = typeof window !== 'undefined' && !accessible();
if (storageBlocked) {
  try { Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }); } catch { /* Leave the native error path. */ }
}

export const STORAGE_BLOCKED_NOTICE = 'This browser is blocking site storage, so settings and saves last only until you close this tab. Allow cookies and site data for this site to keep your progress.';

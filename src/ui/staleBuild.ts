/**
 * A page that started on an older build can outlive its code: the service worker (autoUpdate: skipWaiting +
 * clientsClaim) installs the new build moments after load and drops the old hashed chunks, so the next lazy
 * scene (Integration Hall, Tracking, ...) fails to import and the crash screen appears. Reload onto the new build
 * instead: right away while the player is still on the main menu, otherwise when a chunk actually fails.
 */
const RELOAD_KEY = 'wsp.staleBuildReload';

/** Set while the page is reloading onto a new build; error screens stay hidden so they don't flash. */
export let reloadingForUpdate = false;

export function installStaleBuildRecovery(atMenu: () => boolean) {
  window.addEventListener('vite:preloadError', (event) => {
    // A chunk still missing right after such a reload is a real failure (offline, broken deploy): show it.
    if (Date.now() - Number(readKey() ?? 0) < 10_000) return;
    event.preventDefault();
    reload();
  });
  const sw = navigator.serviceWorker;
  if (!sw) return;
  // First install also claims the page; only a replaced worker means this page runs an older build.
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => { if (hadController && atMenu()) reload(); });
}

function reload() {
  if (reloadingForUpdate) return;
  reloadingForUpdate = true;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked: no loop guard */ }
  location.reload();
}

function readKey(): string | null {
  try { return sessionStorage.getItem(RELOAD_KEY); } catch { return null; }
}

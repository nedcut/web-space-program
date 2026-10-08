import { afterEach, describe, expect, it, vi } from 'vitest';
import { game, updateSettings, DEFAULT_START_UT } from '../src/game/store';
import { trySaveWorld, saveNamedWorld } from '../src/game/persistence';
import { saveProgram } from '../src/game/program';
import { saveErrorText, isQuotaError } from '../src/game/storageErrors';
import { leaveTracking, persistTracking } from '../src/ui/tracking/leave';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { EditorSession } from '../src/editor/session';

const original = game.get();
const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
/** localStorage that reads normally but rejects every write, like a full origin quota. */
function fullStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: () => { throw quota(); }, removeItem: (k: string) => void values.delete(k) });
}
const world = () => { const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT); w.launch(buildSoundingRocket()); return w; };
afterEach(() => { game.set(original); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('saving with full storage never crashes navigation', () => {
  it('Fleet Tracking Back/Fly still navigates and shows a storage-full notification', () => {
    fullStorage();
    game.set({ saveId: 'sandbox-full', scene: 'tracking', saveError: null });
    const w = world();
    expect(() => leaveTracking(w, 'flight')).not.toThrow();
    expect(game.get().scene).toBe('flight');
    expect(game.get().resumeWorld?.activeId).toBe(w.activeId);
    expect(game.get().saveError?.text).toBe('Couldn’t save — storage is full');
    expect(game.get().saveError?.hint).toMatch(/Delete old saves/);
    game.set({ scene: 'tracking', saveError: null });
    expect(() => leaveTracking(w, 'spaceCenter')).not.toThrow();
    expect(game.get().scene).toBe('spaceCenter');
    // The unmount handoff (scene switched elsewhere) is guarded too.
    expect(() => persistTracking(w)).not.toThrow();
    expect(game.get().saveError).not.toBeNull();
  });

  it('autosave, hub saves, settings and the editor draft report instead of throwing', () => {
    fullStorage();
    game.set({ saveId: 'sandbox-full', saveError: null });
    expect(trySaveWorld('autosave', world())).toBe(false);
    expect(() => saveProgram(world())).not.toThrow();
    expect(() => updateSettings({ masterVolume: 0.3 })).not.toThrow();
    expect(game.get().settings.masterVolume).toBe(0.3); // still applied for the session
    expect(() => game.set({ craft: buildSoundingRocket() })).not.toThrow();
    expect(game.get().saveError?.text).toMatch(/storage is full/);
    // Manual saves surface a friendly message; name validation keeps its own text.
    let message = '';
    try { saveNamedWorld('Mine', world()); } catch (e) { message = saveErrorText(e); }
    expect(message).toMatch(/^Couldn’t save — storage is full\. /);
    expect(saveErrorText(new Error('A save slot needs a name.'))).toBe('A save slot needs a name.');
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
  });

  it('editor save survives an IndexedDB put that throws QuotaExceededError', async () => {
    vi.useFakeTimers();
    const store = {
      getAll: () => { const r = { result: [] }; setTimeout(() => tx.oncomplete?.()); return r; },
      put: () => { throw quota(); },
    };
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore(): typeof store } = { objectStore: () => store };
    const db = { transaction: () => tx };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('indexedDB', { open: () => { const req: { result?: unknown; onsuccess?: () => void } = {}; setTimeout(() => { req.result = db; req.onsuccess?.(); }); return req; } });
    const session = new EditorSession(buildSoundingRocket());
    const toast = vi.spyOn(session, 'toast');
    const saving = session.save();
    await vi.runAllTimersAsync();
    await expect(saving).resolves.toBeUndefined();
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/^Couldn’t save — storage is full/), 'bad');
  });
});

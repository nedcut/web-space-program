import { afterEach, describe, expect, it, vi } from 'vitest';
import { game, DEFAULT_START_UT } from '../src/game/store';
import { loadWorldFromStorage, saveWorldToStorage, serializeWorld } from '../src/game/persistence';
import { SLOTS_KEY, flushSaveWrites, listSaveSlots, removeSaveSlot, writeSaveSlot, type SaveSlot } from '../src/game/saveSlots';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket } from '../src/editor/stockCrafts';

const original = game.get();
function memoryStorage() {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { values.set(k, v); }), removeItem: (k: string) => void values.delete(k) };
  vi.stubGlobal('localStorage', storage);
  return { values, storage };
}
const world = () => { const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT); w.launch(buildSoundingRocket()); return w; };
afterEach(() => { flushSaveWrites(); game.set(original); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** The previous implementation: parse everything, append, keep three autosaves per program, stringify everything. */
function referenceWrite(values: Map<string, string>, slot: SaveSlot) {
  const all = (JSON.parse(values.get(SLOTS_KEY) ?? '[]') as SaveSlot[]).sort((a, b) => b.savedAt - a.savedAt).filter(x => x.id !== slot.id);
  all.push(slot);
  const autos = all.filter(x => x.programId === slot.programId && x.kind === 'auto').sort((a, b) => b.savedAt - a.savedAt || all.indexOf(b) - all.indexOf(a));
  const discarded = new Set(autos.slice(3).map(x => x.id));
  values.set(SLOTS_KEY, JSON.stringify(all.filter(x => !discarded.has(x.id))));
}

describe('save slot index cache', () => {
  it('writes the same slots as a full parse/stringify, including after outside changes', () => {
    const { values } = memoryStorage();
    const reference = new Map<string, string>();
    const data = serializeWorld(world());
    let t = 0;
    for (let i = 0; i < 24; i++) {
      const slot: SaveSlot = { id: i % 5 === 0 ? 'p1:quicksave' : `s${i}`, programId: `p${i % 2}`, name: `n${i}`, kind: i % 5 === 0 ? 'manual' : 'auto', savedAt: (t += i % 3 === 0 ? 0 : 10), data, craft: i % 4 ? null : undefined };
      writeSaveSlot(slot);
      referenceWrite(reference, slot);
      expect(JSON.parse(values.get(SLOTS_KEY)!)).toEqual(JSON.parse(reference.get(SLOTS_KEY)!));
      if (i === 10) {
        // Another writer (e.g. a second tab) replaces the index: the cache must notice.
        const edited = (JSON.parse(values.get(SLOTS_KEY)!) as SaveSlot[]).slice(1);
        values.set(SLOTS_KEY, JSON.stringify(edited)); reference.set(SLOTS_KEY, JSON.stringify(edited));
      }
    }
    const victim = listSaveSlots()[2].id;
    removeSaveSlot(victim);
    expect(listSaveSlots().some(s => s.id === victim)).toBe(false);
    expect(listSaveSlots().length).toBe((JSON.parse(reference.get(SLOTS_KEY)!) as SaveSlot[]).length - 1);
  });
});

describe('deferred flight autosave', () => {
  it('snapshots immediately, writes later in order, and flushes before any read', () => {
    vi.useFakeTimers();
    const { values } = memoryStorage();
    game.set({ saveId: 'prog-deferred' });
    const w = world();
    const ut = w.ut;
    saveWorldToStorage('autosave', w, undefined, { defer: true });
    // The snapshot is taken now; later simulation must not leak into it.
    w.ut += 1000;
    expect(values.has(SLOTS_KEY)).toBe(false);
    vi.advanceTimersByTime(0);
    expect(values.has(SLOTS_KEY)).toBe(false);
    vi.runAllTimers();
    const auto = listSaveSlots().find(s => s.programId === 'prog-deferred' && s.kind === 'auto')!;
    expect(auto.data.ut).toBe(ut);
    expect(values.get('wsp.world.v1.autosave')).toBe(JSON.stringify({ savedAt: auto.savedAt, data: auto.data }));

    // A pending autosave followed by an immediate quicksave and a load: everything is visible, in order.
    saveWorldToStorage('autosave', w, undefined, { defer: true });
    saveWorldToStorage('quicksave', w);
    expect(listSaveSlots().filter(s => s.programId === 'prog-deferred').length).toBe(3);
    saveWorldToStorage('autosave', w, undefined, { defer: true });
    expect(loadWorldFromStorage('autosave')?.data.ut).toBe(w.ut);
  });

  it('reports a failed deferred write once and leaves earlier saves intact', () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    game.set({ saveId: 'prog-full' });
    const w = world();
    saveWorldToStorage('autosave', w);
    const before = listSaveSlots().length;
    storage.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const onError = vi.fn();
    saveWorldToStorage('autosave', w, undefined, { defer: true, onError });
    vi.runAllTimers();
    expect(onError).toHaveBeenCalledOnce();
    expect(listSaveSlots().length).toBe(before);
  });
});

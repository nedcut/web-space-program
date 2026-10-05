import { describe, expect, it, vi } from 'vitest';
import { PART_CATALOG } from '../src/data/parts';
import { decodeCraft, encodeCraft, validateCraft } from '../src/game/craftSharing';
import { CRAFTS_KEY, migrateCrafts, type CraftRepository, type LibraryCraft } from '../src/game/saves';
import { removeSaveSlot, exportSaveSlot, importSaveSlot, listSaveSlots, writeSaveSlot, type SaveSlot } from '../src/game/saveSlots';
import type { CraftDef } from '../src/sim/vessel/types';
import { game } from '../src/game/store';
import { loadWorldFromStorage, saveNamedWorld, saveWorldToStorage, serializeWorld } from '../src/game/persistence';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
const craft: CraftDef = { version: 1, type: 'VAB', name: 'Orbiter 🚀', parts: [{ uid: 0, partId: PART_CATALOG.keys().next().value!, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }] };
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('craft sharing', () => {
  it('round trips compressed Unicode craft data and fragment links', async () => {
    const code = await encodeCraft(craft);
    expect(code.startsWith('WSP1.z.')).toBe(true);
    expect(await decodeCraft(code)).toEqual(craft);
    expect(await decodeCraft(`https://offline.invalid/#craft=${code}`)).toEqual(craft);
  });
  it('round trips plain JSON when compression is disabled or absent', async () => {
    expect(await decodeCraft(await encodeCraft(craft, false))).toEqual(craft);
    vi.stubGlobal('CompressionStream', undefined);
    try { const code = await encodeCraft(craft); expect(code.startsWith('WSP1.j.')).toBe(true); expect(await decodeCraft(code)).toEqual(craft); }
    finally { vi.unstubAllGlobals(); }
  });
  it('falls back when a browser exposes an unsupported compression format', async () => {
    vi.stubGlobal('CompressionStream', class { constructor() { throw new Error('unsupported'); } });
    try { expect(await decodeCraft(await encodeCraft(craft))).toEqual(craft); } finally { vi.unstubAllGlobals(); }
  });
  it('reports unavailable decompression clearly', async () => {
    const code = await encodeCraft(craft); vi.stubGlobal('DecompressionStream', undefined);
    try { await expect(decodeCraft(code)).rejects.toThrow('cannot decompress'); } finally { vi.unstubAllGlobals(); }
  });
  it('rejects invalid codes and versions', async () => {
    await expect(decodeCraft('WSP2.j.abc')).rejects.toThrow();
    expect(validateCraft({ ...craft, version: 99 }, PART_CATALOG).craft).toBeNull();
  });
  it('validates catalog references and lists unknown parts', () => {
    expect(validateCraft(craft, PART_CATALOG).craft).toEqual(craft);
    const result = validateCraft({ ...craft, parts: [{ ...craft.parts[0], partId: 'unknown' }] }, PART_CATALOG);
    expect(result.craft).toBeNull(); expect(result.unknownParts).toEqual(['unknown']);
  });
  it('rejects corrupt transforms, duplicate uids, missing parents, and cycles', () => {
    for (const parts of [
      [{ ...craft.parts[0], position: { x: NaN, y: 0, z: 0 } }],
      [{ ...craft.parts[0], rotation: { x: 0, y: 0, z: 0, w: 0 } }],
      [craft.parts[0], craft.parts[0]],
      [craft.parts[0], { ...craft.parts[0], uid: 1, parent: 99 }],
      [craft.parts[0], { ...craft.parts[0], uid: 1, parent: 2 }, { ...craft.parts[0], uid: 2, parent: 1 }],
    ]) expect(validateCraft({ ...craft, parts }, PART_CATALOG).craft).toBeNull();
  });
});
describe('IndexedDB migration contract with mock repository', () => {
  function repository() {
    const rows = new Map<string, LibraryCraft>();
    const repo: CraftRepository = { list: async () => [...rows.values()], put: async item => { rows.set(item.id, item); }, remove: async id => { rows.delete(id); } };
    return { rows, repo };
  }
  it('commits all old craft records before removing localStorage', async () => {
    const store = storage({ [CRAFTS_KEY]: JSON.stringify([craft]) }); const { rows, repo } = repository();
    await migrateCrafts(store, repo);
    expect([...rows.values()][0]).toMatchObject({ craft, folder: '', tags: [] });
    expect(store.getItem(CRAFTS_KEY)).toBeNull();
  });
  it('preserves the source on write failure and retries without duplicating records', async () => {
    const other = { ...craft, name: 'Second' }; const raw = JSON.stringify([craft, other]);
    const store = storage({ [CRAFTS_KEY]: raw }); const { rows, repo } = repository();
    const original = repo.put; let writes = 0;
    repo.put = async item => { if (++writes === 2) throw new Error('quota'); await original(item); };
    await expect(migrateCrafts(store, repo)).rejects.toThrow('quota'); expect(store.getItem(CRAFTS_KEY)).toBe(raw);
    repo.put = original; await migrateCrafts(store, repo); expect(rows.size).toBe(2); expect(store.getItem(CRAFTS_KEY)).toBeNull();
  });
  it('does not overwrite migrated metadata or discard invalid legacy records', async () => {
    const store = storage({ [CRAFTS_KEY]: JSON.stringify([craft]) }); const { rows, repo } = repository();
    rows.set(`legacy:${craft.name}`, { id: `legacy:${craft.name}`, craft, folder: 'Moon', tags: ['lander'], updatedAt: 1 });
    await migrateCrafts(store, repo); expect([...rows.values()][0].folder).toBe('Moon');
    store.setItem(CRAFTS_KEY, JSON.stringify([{ ...craft, parts: [] }]));
    await expect(migrateCrafts(store, repo)).rejects.toThrow(); expect(store.getItem(CRAFTS_KEY)).not.toBeNull();
  });
});
describe('save slots', () => {
  const data = serializeWorld(new World(new Universe('standard'), PART_CATALOG, 123));
  const slot = (id: string, programId = 'A', kind: SaveSlot['kind'] = 'auto', savedAt = Number(id)): SaveSlot => ({ id, programId, kind, savedAt, name: 'Mission', data });
  it('rotates exactly three autosaves per program while retaining manual saves', () => {
    const store = storage(); writeSaveSlot(slot('manual', 'A', 'manual', 0), store); writeSaveSlot(slot('other', 'B', 'auto', 0), store);
    for (let n = 1; n <= 5; n++) writeSaveSlot(slot(String(n)), store);
    expect(listSaveSlots(store).map(x => x.id)).toEqual(['5', '4', '3', 'manual', 'other']);
  });
  it('retains the newest insertion when timestamps tie, and replaces named slots', () => {
    const store = storage(); for (let n = 1; n <= 5; n++) writeSaveSlot(slot(String(n), 'A', 'auto', 1), store);
    expect(listSaveSlots(store).filter(x => x.kind === 'auto')).toHaveLength(3); expect(listSaveSlots(store).map(x => x.id).sort()).toEqual(['3', '4', '5']);
    writeSaveSlot(slot('named', 'A', 'manual', 6), store); writeSaveSlot({ ...slot('named', 'A', 'manual', 7), name: 'Updated' }, store);
    expect(listSaveSlots(store).filter(x => x.id === 'named')).toHaveLength(1);
  });
  it('round trips save files and rejects invalid format, catalog, and timestamps', () => {
    expect(importSaveSlot(exportSaveSlot(slot('1')))).toMatchObject({ name: 'Mission', data, programId: 'A', kind: 'manual' });
    expect(() => importSaveSlot('{}')).toThrow();
    expect(() => importSaveSlot(exportSaveSlot({ ...slot('1'), data: { ...data, ut: Infinity } }))).toThrow();
    expect(() => importSaveSlot(exportSaveSlot({ ...slot('1'), data: { ...data, version: 99 } }))).toThrow();
  });
});


describe('program save integration', () => {
  it('keeps quicksave/load working for legacy and dev flights without a program ID', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, 789);
    const store = storage(), previous = game.get().saveId; vi.stubGlobal('localStorage', store);
    try {
      game.set({ saveId: null }); saveWorldToStorage('quicksave', world);
      expect(loadWorldFromStorage('quicksave')?.data.ut).toBe(789);
    } finally { game.set({ saveId: previous }); vi.unstubAllGlobals(); }
  });
  it('migrates both legacy channels once without resurrecting deleted slots', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, 456);
    const raw = JSON.stringify({ savedAt: 1, data: serializeWorld(world) });
    const store = storage({ 'wsp.world.v1.autosave': raw, 'wsp.world.v1.quicksave': raw });
    const previous = game.get().saveId; vi.stubGlobal('localStorage', store);
    try {
      game.set({ saveId: 'fresh-program' }); saveWorldToStorage('autosave', world);
      expect(listSaveSlots(store).filter(s => s.programId === 'legacy-program')).toHaveLength(2);
      for (const slot of listSaveSlots(store)) removeSaveSlot(slot.id, store);
      for (const saveId of [null, 'legacy-program', 'fresh-program']) {
        game.set({ saveId }); expect(loadWorldFromStorage('autosave')).toBeNull(); expect(loadWorldFromStorage('quicksave')).toBeNull();
      }
      saveWorldToStorage('autosave', world);
      expect(listSaveSlots(store)).toHaveLength(1);
    } finally { game.set({ saveId: previous }); vi.unstubAllGlobals(); }
  });

  it('migrates legacy saves and scopes quickload to the selected program', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, 321);
    const oldData = serializeWorld(world);
    const store = storage({ 'wsp.world.v1.autosave': JSON.stringify({ savedAt: 1, data: oldData }) });
    const previous = game.get().saveId;
    vi.stubGlobal('localStorage', store);
    try {
      game.set({ saveId: 'new-program' });
      saveWorldToStorage('autosave', world);
      expect(listSaveSlots(store).some(x => x.programId === 'legacy-program')).toBe(true);
      expect(loadWorldFromStorage('quicksave')).toBeNull();
      saveWorldToStorage('quicksave', world);
      game.set({ saveId: 'other-program' });
      expect(loadWorldFromStorage('quicksave')).toBeNull();
      expect(loadWorldFromStorage('autosave')).toBeNull();
      saveWorldToStorage('autosave', world);
      expect(loadWorldFromStorage('quicksave')).toBeNull();
      game.set({ saveId: 'new-program' });
      expect(loadWorldFromStorage('quicksave')?.data.ut).toBe(321);
      saveNamedWorld('autosave', world);
      expect(listSaveSlots(store).find(x => x.id === 'new-program:manual:autosave')?.kind).toBe('manual');
      for (const slot of listSaveSlots(store)) if (slot.programId === 'new-program') removeSaveSlot(slot.id, store);
      expect(loadWorldFromStorage('autosave')).toBeNull();
      expect(loadWorldFromStorage('quicksave')).toBeNull();
    } finally { game.set({ saveId: previous }); vi.unstubAllGlobals(); }
  });
});

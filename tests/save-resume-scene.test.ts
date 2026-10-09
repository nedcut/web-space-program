import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_START_UT, game, launchableCraft } from '../src/game/store';
import { deserializeWorld, loadWorldFromStorage, resumeSave, saveWorldToStorage, serializeWorld } from '../src/game/persistence';
import { flushSaveWrites, latestSaveSlot, listSaveSlots, sceneForSave, type SaveSlot } from '../src/game/saveSlots';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket } from '../src/editor/stockCrafts';
import { placeInCircularOrbit } from '../src/game/scenarios';
import { qIdentity } from '../src/util/quat';
import { v3 } from '../src/util/vec3';
import type { CraftDef } from '../src/sim/vessel/types';

const original = game.get();
function memoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => void values.delete(k) });
}
const world = () => { const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT); w.launch(buildSoundingRocket()); return w; };
afterEach(() => { flushSaveWrites(); game.set(original); vi.unstubAllGlobals(); });

describe('loading a save resumes the scene it was made in', () => {
  it('a mid-flight quicksave loads straight into flight with its active vessel', () => {
    memoryStorage();
    game.set({ saveId: 'p1', scene: 'flight' });
    const w = world();
    saveWorldToStorage('quicksave', w);
    const slot = listSaveSlots()[0];
    expect(slot.scene).toBe('flight');
    expect(sceneForSave(slot)).toBe('flight');
    game.set({ scene: 'menu', resumeWorld: null, launchPending: true });
    resumeSave(slot);
    expect(game.get()).toMatchObject({ scene: 'flight', saveId: 'p1', launchPending: false });
    expect(game.get().resumeWorld?.activeId).toBe(w.activeId);
  });

  it('saves made in the Space Center or on leaving flight load into the Space Center', () => {
    memoryStorage();
    game.set({ saveId: 'p1', scene: 'spaceCenter' });
    const w = world();
    saveWorldToStorage('manual:hub', w);
    game.set({ scene: 'flight' });
    saveWorldToStorage('autosave', w, undefined, { scene: 'spaceCenter' });
    const slots = listSaveSlots();
    expect(slots.map(s => s.scene).sort()).toEqual(['spaceCenter', 'spaceCenter']);
    for (const s of slots) expect(sceneForSave(s)).toBe('spaceCenter');
    resumeSave(slots[0]);
    expect(game.get().scene).toBe('spaceCenter');
  });

  it('older slots without a scene, or whose active vessel is gone, load into the Space Center', () => {
    const data = serializeWorld(world());
    const slot: SaveSlot = { id: 'a', programId: 'p', name: 'old', kind: 'manual', savedAt: 1, data };
    expect(sceneForSave(slot)).toBe('spaceCenter');
    expect(sceneForSave({ ...slot, scene: 'flight' })).toBe('flight');
    expect(sceneForSave({ ...slot, scene: 'flight', data: { ...data, activeId: null } })).toBe('spaceCenter');
    expect(sceneForSave({ ...slot, scene: 'flight', data: { ...data, activeId: 'gone' } })).toBe('spaceCenter');
  });

  it('Continue picks the newest save across programs', () => {
    const data = serializeWorld(world());
    const mk = (id: string, savedAt: number): SaveSlot => ({ id, programId: id, name: id, kind: 'manual', savedAt, data });
    expect(latestSaveSlot([])).toBeNull();
    expect(latestSaveSlot([mk('a', 5), mk('c', 30), mk('b', 10)])!.id).toBe('c');
  });

  it('restores an astronaut on EVA as the active vessel after quicksave and quickload', () => {
    memoryStorage();
    game.set({ saveId: 'p1', scene: 'flight' });
    const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const pod: CraftDef = { name: 'Pod', version: 1, type: 'VAB', parts: [{ uid: 1, partId: 'pod-lantern-1', position: v3(), rotation: qIdentity(), stage: 0 }] };
    placeInCircularOrbit(w, w.launch(pod), 'moon', 15000);
    const eva = w.goEva()!;
    saveWorldToStorage('quicksave', w);
    // F9 reads the slot back directly...
    expect(loadWorldFromStorage('quicksave')!.data.activeId).toBe(eva.state.id);
    // ...and Load from the menu enters the flight with the astronaut, not the empty ship, as the active vessel.
    game.set({ scene: 'menu', resumeWorld: null });
    resumeSave(listSaveSlots().find(s => s.name === 'Quicksave')!);
    const resumed = game.get();
    expect(resumed.scene).toBe('flight');
    expect(resumed.resumeWorld?.activeId).toBe(eva.state.id);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(resumed.resumeWorld)), PART_CATALOG);
    expect(loaded.active?.state.eva?.astronautId).toBe(eva.state.eva!.astronautId);
    expect(loaded.canControl()).toBe(true);
  });
});

describe('Space Center launch tile', () => {
  it('an empty editor draft is not a launchable craft', () => {
    const empty: CraftDef = { name: 'Untitled Craft', type: 'VAB', parts: [], version: 1 };
    expect(launchableCraft(empty)).toBeNull();
    expect(launchableCraft(null)).toBeNull();
    const built = buildSoundingRocket();
    expect(launchableCraft(built)).toBe(built);
  });
});

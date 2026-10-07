import { afterEach, describe, expect, it, vi } from 'vitest';
import { game, draftForSave, programCraftKey, DEFAULT_START_UT } from '../src/game/store';
import { saveNamedWorld } from '../src/game/persistence';
import { listSaveSlots, importSaveSlot, exportSaveSlot } from '../src/game/saveSlots';
import { saveProgram } from '../src/game/program';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildSoundingRocket, buildSwift } from '../src/editor/stockCrafts';

const original = game.get();
function memoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) });
  return values;
}
afterEach(() => { game.set(original); vi.unstubAllGlobals(); });

describe('editor draft is scoped to its program', () => {
  it('loading program A restores A\'s draft, not the one built in program B', () => {
    memoryStorage();
    const world = () => new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    // Program A with the Kestrel in the editor, saved.
    game.set({ saveId: 'sandbox-A', craft: null });
    const kestrel = buildSoundingRocket();
    game.set({ craft: kestrel });
    saveNamedWorld('A save', world());
    // New program B (same sequence as Main menu → Start), then build the Swift Jet there.
    game.set({ saveId: 'sandbox-B', craft: null });
    saveProgram(world());
    game.set({ craft: buildSwift() });
    const slotA = listSaveSlots().find(s => s.programId === 'sandbox-A')!;
    const slotB = listSaveSlots().find(s => s.programId === 'sandbox-B')!;
    expect(draftForSave(slotA)?.name).toBe(kestrel.name);
    expect(slotA.craft?.name).toBe(kestrel.name);
    // B's first autosave was written with an empty editor, but B's latest draft is the Swift.
    expect(slotB.craft).toBeNull();
    expect(draftForSave(slotB)?.name).toBe(buildSwift().name);
  });

  it('clears the editor for a program without a draft and falls back to the slot\'s craft on another device', () => {
    const values = memoryStorage();
    game.set({ saveId: 'sandbox-B', craft: buildSwift() });
    expect(draftForSave({ programId: 'never-drafted' })).toBeNull();
    // A program whose editor was emptied stays empty even if an older slot stored a craft.
    game.set({ saveId: 'sandbox-C', craft: buildSoundingRocket() });
    game.set({ craft: null });
    expect(values.get(programCraftKey('sandbox-C'))).toBe('null');
    expect(draftForSave({ programId: 'sandbox-C', craft: buildSoundingRocket() })).toBeNull();
    // Exported saves carry their draft; an import validates it.
    game.set({ saveId: 'sandbox-D', craft: buildSoundingRocket() });
    saveNamedWorld('D save', new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT));
    const exported = exportSaveSlot(listSaveSlots().find(s => s.programId === 'sandbox-D')!);
    values.clear();
    const imported = importSaveSlot(exported);
    expect(draftForSave(imported)?.name).toBe(buildSoundingRocket().name);
    const bad = JSON.parse(exported); bad.slot.craft = { name: 'x', parts: 'nope' };
    expect(importSaveSlot(JSON.stringify(bad)).craft).toBeNull();
  });
});

import { localId } from '../util/localId';
import type { SavedWorld } from './persistence';
import { deserializeWorld, SAVE_VERSION } from './persistence';
import { PART_CATALOG } from '../data/parts';
import type { CraftDef } from '../sim/vessel/types';
import { validateCraft } from './craftSharing';
/** `craft` is the program's editor draft when the slot was written (null: empty editor; absent: older slot). */
export interface SaveSlot { id: string; programId: string; name: string; kind: 'manual' | 'auto'; savedAt: number; data: SavedWorld; craft?: CraftDef | null }
export const SLOTS_KEY = 'wsp.save-slots.v1';
type SlotStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function listSaveSlots(storage: SlotStorage = localStorage): SaveSlot[] {
  const raw = storage.getItem(SLOTS_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Save slot index is invalid.');
  return (data as SaveSlot[]).sort((a, b) => b.savedAt - a.savedAt);
}
/** Newest three autosaves are retained independently for every program. */
export function writeSaveSlot(slot: SaveSlot, storage: SlotStorage = localStorage): void {
  const all = listSaveSlots(storage).filter(x => x.id !== slot.id);
  all.push(slot);
  const autos = all.filter(x => x.programId === slot.programId && x.kind === 'auto').sort((a, b) => b.savedAt - a.savedAt || all.indexOf(b) - all.indexOf(a));
  const discarded = new Set(autos.slice(3).map(x => x.id));
  storage.setItem(SLOTS_KEY, JSON.stringify(all.filter(x => !discarded.has(x.id))));
}
export function removeSaveSlot(id: string, storage: SlotStorage = localStorage) { storage.setItem(SLOTS_KEY, JSON.stringify(listSaveSlots(storage).filter(x => x.id !== id))); }
export function exportSaveSlot(slot: SaveSlot): string { return JSON.stringify({ format: 'wsp-save', version: 1, slot }); }
export function importSaveSlot(text: string): SaveSlot {
  if (text.length > 20_000_000) throw new Error('Save file exceeds 20 MB.');
  const input = JSON.parse(text);
  const s = input?.slot;
  if (input?.format !== 'wsp-save' || input.version !== 1 || !s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 200 || typeof s.programId !== 'string' || s.programId.length > 200 || !Number.isFinite(s.savedAt) || s.data?.version !== SAVE_VERSION || !['standard', 'challenging', 'real'].includes(s.data?.preset) || !Number.isFinite(s.data?.ut) || !Array.isArray(s.data?.vessels) || s.data.vessels.length > 2000 || !Array.isArray(s.data?.nodes) || (s.data.mode !== undefined && !['sandbox', 'science', 'career'].includes(s.data.mode))) throw new Error('Invalid or unsupported save file.');
  // Rebuild the runtime before accepting the file; catches missing catalogue parts and invalid bodies.
  const world = deserializeWorld(s.data, PART_CATALOG);
  for (const vessel of world.vessels.values()) {
    if (!world.universe.bodies.has(vessel.body) || !Number.isFinite(vessel.state.mass) || ![vessel.state.position, vessel.state.velocity].every(v => [v.x, v.y, v.z].every(Number.isFinite))) throw new Error('Invalid vessel state.');
  }
  // An invalid editor draft is dropped rather than rejecting the whole program.
  const craft = s.craft ? validateCraft(s.craft, PART_CATALOG).craft : null;
  return { id: localId(), programId: s.programId, name: s.name, kind: 'manual', savedAt: s.savedAt, data: s.data, craft };
}

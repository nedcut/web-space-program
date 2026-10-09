import { localId } from '../util/localId';
import type { SavedWorld } from './persistence';
import { deserializeWorld, SAVE_VERSION } from './persistence';
import { PART_CATALOG } from '../data/parts';
import type { CraftDef } from '../sim/vessel/types';
import { validateCraft } from './craftSharing';
/** Where Load resumes: a save made mid-flight returns to that flight, any other save to the Space Center. */
export type SaveScene = 'flight' | 'spaceCenter';
/**
 * `craft` is the program's editor draft when the slot was written (null: empty editor; absent: older slot).
 * `scene` is the scene the save was made in (absent in older slots: they load into the Space Center).
 */
export interface SaveSlot { id: string; programId: string; name: string; kind: 'manual' | 'auto'; savedAt: number; data: SavedWorld; craft?: CraftDef | null; scene?: SaveScene }
/** Scene to enter when loading `slot`: the flight itself only if it was saved in flight and its active vessel still exists. */
export function sceneForSave(slot: Pick<SaveSlot, 'data' | 'scene'>): SaveScene {
  const { activeId, vessels } = slot.data;
  return slot.scene === 'flight' && activeId && vessels.some(v => v.state.id === activeId && !v.state.destroyed) ? 'flight' : 'spaceCenter';
}
export const SLOTS_KEY = 'wsp.save-slots.v1';
type SlotStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Writes queued by `deferSaveWrite` (flight autosaves). They run in order on later idle tasks so persistence never
 * shares a frame with rendering; every read or write of saves flushes them first, as does hiding the page.
 */
const pending: (() => void)[] = [];
let scheduled = false;
export function deferSaveWrite(step: () => void): void {
  pending.push(step);
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    // One step per task: each is a single stringify/assembly/storage write.
    const next = pending.shift();
    if (next) next();
    if (pending.length && !scheduled) { scheduled = true; later(run); }
  };
  later(run);
}
/** Complete queued save writes now (before a read, another write, or the page going away). */
export function flushSaveWrites(): void {
  // A timer still scheduled finds the queue empty; later writes schedule afresh. Steps stay FIFO either way.
  scheduled = false;
  while (pending.length) pending.shift()!();
}
const later = (f: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(f, { timeout: 1000 }); else setTimeout(f, 0);
};
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flush = () => { try { flushSaveWrites(); } catch { /* reported by the queued step */ } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/**
 * The last index read or written, with each slot's JSON. While storage still holds exactly that text, a write
 * stringifies only the new slot instead of parsing and re-serialising every program's saves.
 */
interface IndexEntry { meta: Pick<SaveSlot, 'id' | 'programId' | 'kind' | 'savedAt'>; json: string }
let indexCache: { storage: SlotStorage; raw: string; entries: IndexEntry[] } | null = null;
function readIndex(storage: SlotStorage): IndexEntry[] {
  const raw = storage.getItem(SLOTS_KEY);
  if (!raw) return [];
  if (indexCache?.storage === storage && indexCache.raw === raw) return indexCache.entries;
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Save slot index is invalid.');
  const entries = (data as SaveSlot[]).map(s => ({ meta: { id: s.id, programId: s.programId, kind: s.kind, savedAt: s.savedAt }, json: JSON.stringify(s) }));
  indexCache = { storage, raw, entries };
  return entries;
}
function writeIndex(storage: SlotStorage, entries: IndexEntry[]): void {
  const raw = `[${entries.map(e => e.json).join(',')}]`;
  storage.setItem(SLOTS_KEY, raw);
  indexCache = { storage, raw, entries };
}
const byNewest = (a: IndexEntry, b: IndexEntry) => b.meta.savedAt - a.meta.savedAt;

export function listSaveSlots(storage: SlotStorage = localStorage): SaveSlot[] {
  if (storage === globalThis.localStorage) flushSaveWrites();
  const raw = storage.getItem(SLOTS_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Save slot index is invalid.');
  return (data as SaveSlot[]).sort((a, b) => b.savedAt - a.savedAt);
}
/** The most recently written save across all programs (what Continue resumes), or null when there are none. */
export function latestSaveSlot(slots: readonly SaveSlot[]): SaveSlot | null {
  return slots.reduce<SaveSlot | null>((best, s) => !best || s.savedAt > best.savedAt ? s : best, null);
}
/** JSON for a slot; `dataJson` reuses an already serialised world. */
export function saveSlotJson(slot: SaveSlot, dataJson = JSON.stringify(slot.data)): string {
  const head = JSON.stringify({ ...slot, data: undefined });
  return `${head.slice(0, -1)}${head.length > 2 ? ',' : ''}"data":${dataJson}}`;
}
/** Newest three autosaves are retained independently for every program. */
export function writeSaveSlot(slot: SaveSlot, storage: SlotStorage = localStorage, json = saveSlotJson(slot)): void {
  if (storage === globalThis.localStorage) flushSaveWrites();
  commitSaveSlot(slot, storage, json);
}
/** `writeSaveSlot` without flushing the queue: for a queued step that is itself being flushed. */
export function commitSaveSlot(slot: SaveSlot, storage: SlotStorage, json: string): void {
  const all = [...readIndex(storage)].sort(byNewest).filter(x => x.meta.id !== slot.id);
  all.push({ meta: { id: slot.id, programId: slot.programId, kind: slot.kind, savedAt: slot.savedAt }, json });
  const autos = all.filter(x => x.meta.programId === slot.programId && x.meta.kind === 'auto').sort((a, b) => byNewest(a, b) || all.indexOf(b) - all.indexOf(a));
  const discarded = new Set(autos.slice(3).map(x => x.meta.id));
  writeIndex(storage, all.filter(x => !discarded.has(x.meta.id)));
}
export function removeSaveSlot(id: string, storage: SlotStorage = localStorage) {
  if (storage === globalThis.localStorage) flushSaveWrites();
  writeIndex(storage, [...readIndex(storage)].sort(byNewest).filter(x => x.meta.id !== id));
}
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

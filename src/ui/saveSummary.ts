import { BODY_DEFS } from '../data/bodies';
import { sceneForSave, type SaveSlot } from '../game/saveSlots';
import type { GameMode } from '../sim/science/progression';
import type { CraftDef } from '../sim/vessel/types';

/** Display-only summaries of save slots for Continue and Load: readable names instead of ids. */

const MODE_LABEL: Record<GameMode, string> = { sandbox: 'Sandbox', science: 'Science', career: 'Career' };
const SCALE_LABEL: Record<string, string> = { standard: 'Standard scale', challenging: 'Challenging scale', real: 'Real scale' };
const bodyNames = new Map(BODY_DEFS.map(b => [b.id, b.name]));

export const modeLabel = (mode: GameMode | undefined) => MODE_LABEL[mode ?? 'sandbox'] ?? 'Sandbox';
export const scaleLabel = (preset: string) => SCALE_LABEL[preset] ?? preset;

/** When the program was started, from New Game's `<mode>-<epoch ms>` id (null for imported/legacy ids). */
export function programStarted(programId: string): number | null {
  const m = /^(?:sandbox|science|career)-(\d{12,})$/.exec(programId);
  return m ? Number(m[1]) : null;
}

/** "Career program · started 12 Oct" (or "Legacy program"). */
export function programTitle(programId: string, mode: GameMode | undefined, now = Date.now()): string {
  if (programId === 'legacy-program') return 'Earlier program';
  const started = programStarted(programId);
  return started === null ? `${modeLabel(mode)} program` : `${modeLabel(mode)} program · started ${shortDate(started, now)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function shortDate(t: number, now: number): string {
  const d = new Date(t), n = new Date(now);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** Wall-clock age of a save: "just now", "12 min ago", "today 14:05", "yesterday 09:30", "3 Oct 18:12". */
export function savedAgo(savedAt: number, now = Date.now()): string {
  const dt = now - savedAt;
  if (dt < 60_000 && dt > -60_000) return 'just now';
  if (dt > 0 && dt < 3_600_000) return `${Math.floor(dt / 60_000)} min ago`;
  const d = new Date(savedAt), n = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  return `${shortDate(savedAt, now)} ${clock}`;
}

/** Where the save resumes: "In flight · Meridian I near Moon" or "Space Center". */
export function saveWhere(slot: Pick<SaveSlot, 'data' | 'scene'>): string {
  if (sceneForSave(slot) !== 'flight') return 'Space Center';
  const v = slot.data.vessels.find(x => x.state.id === slot.data.activeId);
  if (!v) return 'In flight';
  return `In flight · ${v.state.name} · ${bodyNames.get(v.body) ?? v.body}`;
}

/** Vessels still flying (not destroyed), for "4 vessels" on a program card. */
export const flyingCount = (slot: SaveSlot) => slot.data.vessels.filter(v => !v.state.destroyed).length;

export interface ProgramSaves { programId: string; title: string; latest: SaveSlot; slots: SaveSlot[] }
/** Saves grouped by program, newest program first; each group's slots newest first. */
export function groupByProgram(slots: readonly SaveSlot[], now = Date.now()): ProgramSaves[] {
  const groups = new Map<string, SaveSlot[]>();
  for (const s of [...slots].sort((a, b) => b.savedAt - a.savedAt)) {
    const g = groups.get(s.programId);
    if (g) g.push(s); else groups.set(s.programId, [s]);
  }
  return [...groups].map(([programId, list]) => ({ programId, title: programTitle(programId, list[0].data.mode, now), latest: list[0], slots: list }));
}

/**
 * Craft to picture on a save card: the active vessel as it is now (in flight), else the program's editor
 * draft. Parts keep their vessel-frame placement, which is all the preview renderer reads.
 */
export function previewCraft(slot: SaveSlot): CraftDef | null {
  const v = sceneForSave(slot) === 'flight' ? slot.data.vessels.find(x => x.state.id === slot.data.activeId) : undefined;
  if (v && v.state.parts.length) {
    return {
      name: v.state.name, type: 'VAB', version: 1,
      parts: v.state.parts.map(p => ({ uid: p.uid, partId: p.partId, position: p.position, rotation: p.rotation, parent: p.parent ?? undefined, attachNode: p.attachNode, parentNode: p.parentNode, tweaks: p.tweaks })),
    };
  }
  return slot.craft?.parts.length ? slot.craft : null;
}

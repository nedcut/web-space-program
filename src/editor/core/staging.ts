import type { CraftDef, PartInstance } from '../../sim/vessel/types';
import { requirePart, type PartCatalog } from './geometry';

/** Optional editor metadata retains empty stages, including the first/last stage.
 * Simulation consumers can continue to accept this as an ordinary CraftDef. */
export interface EditorCraft extends CraftDef { editorStageCount?: number }
export interface Stage { /** UI index: zero fires first. */ index: number; /** Stored KSP number: highest fires first. */ stage: number; partUids: number[] }
export function getStageList(craft: CraftDef): Stage[] {
  const maximum = Math.max((craft as EditorCraft).editorStageCount === undefined ? -1 : (craft as EditorCraft).editorStageCount! - 1, ...craft.parts.map(p => p.stage ?? -1));
  return Array.from({ length: maximum + 1 }, (_, index) => ({ index, stage: maximum - index, partUids: craft.parts.filter(p => p.stage === maximum - index).map(p => p.uid) }));
}
/** Pure update. UI indices always count from first-to-fire, stored numbers count backwards. */
export function moveToStage(craft: CraftDef, uid: number, stageIndex: number): EditorCraft {
  const target = craft.parts.find(p => p.uid === uid);
  if (!target) throw new Error(`Unknown part uid: ${uid}`);
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new Error('Invalid stage index');
  const max = Math.max(stageIndex, getStageList(craft).length - 1);
  const shift = max - Math.max(0, getStageList(craft).length - 1);
  return { ...craft, editorStageCount: max + 1, parts: craft.parts.map(p => ({ ...p, stage: p.uid === uid || (target.symmetryGroup !== undefined && p.symmetryGroup === target.symmetryGroup)
    ? max - stageIndex : p.stage === undefined ? undefined : p.stage + shift })) };
}
/** Insert an empty stage before the given UI index (including append). */
export function insertStage(craft: CraftDef, stageIndex: number): EditorCraft {
  const count = getStageList(craft).length;
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > count) throw new Error('Invalid stage index');
  const boundary = count - stageIndex;
  return { ...craft, editorStageCount: count + 1, parts: craft.parts.map(p => ({ ...p, stage: p.stage === undefined ? undefined : p.stage >= boundary ? p.stage + 1 : p.stage })) };
}
export function removeEmptyStages(craft: CraftDef): EditorCraft {
  const numbers = [...new Set(craft.parts.flatMap(p => p.stage === undefined ? [] : [p.stage]))].sort((a, b) => a - b);
  return { ...craft, editorStageCount: numbers.length, parts: craft.parts.map(p => ({ ...p, stage: p.stage === undefined ? undefined : numbers.indexOf(p.stage) })) };
}
/** Each decoupled edge increases engine depth. Engines in the dropped assembly
 * fire before its decoupler, then the retained engine fires. Chutes fire last.
 * Depth d: engine=2d, decoupler=2d+1; empty numbers are compacted.
 * Stage list index 0 fires FIRST; PartInstance.stage's highest number fires FIRST. */
export function autoStage(craft: CraftDef, catalog: PartCatalog): CraftDef {
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const cut = new Set<number>(); // child uid identifies the edge removed
  for (const part of craft.parts) for (const module of requirePart(catalog, part.partId).modules) {
    if (module.type !== 'decoupler') continue;
    if (module.radial || part.attachNode === module.node) { if (part.parent !== undefined) cut.add(part.uid); }
    else for (const child of craft.parts) if (child.parent === part.uid && child.parentNode === module.node) cut.add(child.uid);
  }
  const depths = new Map<number, number>();
  function depth(part: PartInstance, seen = new Set<number>()): number {
    if (depths.has(part.uid)) return depths.get(part.uid)!;
    if (seen.has(part.uid)) throw new Error('Cyclic craft');
    seen.add(part.uid);
    const parent = part.parent === undefined ? undefined : byUid.get(part.parent);
    const value = (parent ? depth(parent, seen) : 0) + (cut.has(part.uid) ? 1 : 0);
    depths.set(part.uid, value);
    return value;
  }
  const staged = { ...craft, parts: craft.parts.map(part => {
    const modules = requirePart(catalog, part.partId).modules;
    let stage: number | undefined;
    const d = depth(part);
    if (modules.some(m => m.type === 'engine')) stage = 2 * d;
    if (modules.some(m => m.type === 'decoupler')) stage = 2 * (cut.has(part.uid) ? Math.max(0, d - 1) : d) + 1;
    if (modules.some(m => m.type === 'fairing')) stage = 2 * d;
    if (modules.some(m => m.type === 'parachute')) stage = -1;
    return { ...part, stage };
  }) };
  return removeEmptyStages(staged);
}

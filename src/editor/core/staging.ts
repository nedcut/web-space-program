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
/** An automatic stager: pure function from craft to craft with every part's `stage` assigned. */
export type Stager = (craft: CraftDef, catalog: PartCatalog) => CraftDef;

/** Stage parts that fire anything: engines, decouplers, fairings and parachutes. */
export const isStageable = (catalog: PartCatalog, part: PartInstance): boolean =>
  requirePart(catalog, part.partId).modules.some(m => m.type === 'engine' || m.type === 'decoupler' || m.type === 'fairing' || m.type === 'parachute');

/** Child uids whose parent edge a decoupler cuts, with the cutting decoupler (child uid identifies the edge). */
function decoupledEdges(craft: CraftDef, catalog: PartCatalog): Map<number, { decoupler: number; parallel: boolean }> {
  const cut = new Map<number, { decoupler: number; parallel: boolean }>();
  for (const part of craft.parts) for (const module of requirePart(catalog, part.partId).modules) {
    if (module.type !== 'decoupler') continue;
    if (module.radial || part.attachNode === module.node) {
      if (part.parent !== undefined) cut.set(part.uid, { decoupler: part.uid, parallel: !!module.radial || part.attachNode === 'srf' });
    } else for (const child of craft.parts) if (child.parent === part.uid && child.parentNode === module.node)
      cut.set(child.uid, { decoupler: part.uid, parallel: child.attachNode === 'srf' });
  }
  return cut;
}

/** Assign `slot` (0 fires first, fractions allowed) to stored stage numbers (highest fires first), compacted. */
function fromSlots(craft: CraftDef, slots: Map<number, number>): CraftDef {
  const distinct = [...new Set(slots.values())].sort((a, b) => a - b);
  const top = distinct.length - 1;
  const index = new Map(distinct.map((s, i) => [s, top - i]));
  return { ...craft, editorStageCount: distinct.length, parts: craft.parts.map(part => ({ ...part, stage: slots.has(part.uid) ? index.get(slots.get(part.uid)!) : undefined })) } as EditorCraft;
}

/**
 * Automatic staging over the tree of decoupled assemblies (pieces between decouplers; the root assembly stays).
 *  - A stack-decoupled child assembly is a lower (serial) stage: its engines burn out and it drops before the parent's
 *    engines ignite, each in its own stage (engines → decoupler → next engines).
 *  - A radially decoupled (parallel) child, e.g. a strap-on booster, ignites together with its parent assembly and drops
 *    in the stage after; the core keeps burning.
 *  - Each decoupler fires in the stage that drops its own assembly. Assemblies without engines (radial payloads, drop
 *    pods) are released just before their parent is dropped, or after everything else on the root.
 *  - Fairings open when their assembly's engines ignite (or right after launch on the first stage). Parachutes fire last.
 * Stage list index 0 fires FIRST; PartInstance.stage's highest number fires FIRST.
 */
export function autoStage(craft: CraftDef, catalog: PartCatalog): CraftDef {
  if (!craft.parts.length) return { ...craft, editorStageCount: 0 } as EditorCraft;
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const edges = decoupledEdges(craft, catalog);
  // Assembly membership: an assembly is identified by its top part's uid (root or a cut child).
  const assemblyOf = new Map<number, number>();
  const find = (part: PartInstance, seen = new Set<number>()): number => {
    const known = assemblyOf.get(part.uid);
    if (known !== undefined) return known;
    if (seen.has(part.uid)) throw new Error('Cyclic craft');
    seen.add(part.uid);
    const parent = part.parent === undefined ? undefined : byUid.get(part.parent);
    const id = !parent || edges.has(part.uid) ? part.uid : find(parent, seen);
    assemblyOf.set(part.uid, id);
    return id;
  };
  interface Assembly { id: number; parallel: boolean; children: Assembly[]; engines: boolean; powered: boolean; ignite: number; drop: number }
  const assemblies = new Map<number, Assembly>();
  const get = (id: number) => {
    let a = assemblies.get(id);
    if (!a) assemblies.set(id, a = { id, parallel: !!edges.get(id)?.parallel, children: [], engines: false, powered: false, ignite: 0, drop: Infinity });
    return a;
  };
  let root: Assembly | undefined;
  for (const part of craft.parts) {
    const a = get(find(part));
    if (requirePart(catalog, part.partId).modules.some(m => m.type === 'engine')) a.engines = true;
    if (part.uid === a.id) {
      const parent = part.parent === undefined ? undefined : byUid.get(part.parent);
      if (parent) get(find(parent)).children.push(a); else root ??= a;
    }
  }
  if (!root) throw new Error('Craft has no root');
  const markPowered = (a: Assembly): boolean => {
    let any = a.engines;
    for (const c of a.children) any = markPowered(c) || any;
    return (a.powered = any);
  };
  markPowered(root);
  // Engine-bearing assemblies, bottom-up for serial children and top-down for parallel ones.
  const solve = (a: Assembly, inherited: number): void => {
    let base = 0;
    for (const s of a.children) if (s.powered && !s.parallel) { solve(s, 0); base = Math.max(base, s.drop + 1); }
    a.ignite = Math.max(base, inherited);
    let latest = a.ignite;
    for (const p of a.children) if (p.powered && p.parallel) { solve(p, a.ignite); latest = Math.max(latest, p.drop); }
    a.drop = latest + 1;
  };
  solve(root, 0);
  let last = 0;
  for (const a of assemblies.values()) if (a.powered) last = Math.max(last, a.ignite, a !== root ? a.drop : 0);
  root.drop = last + 1;
  // Engineless assemblies leave just before their parent does (nested ones slightly earlier still).
  const release = (a: Assembly, step: number): void => {
    for (const c of a.children) {
      if (!c.powered) { c.ignite = a.ignite; c.drop = a.drop - step; }
      release(c, c.powered ? 0.5 : step / 2);
    }
  };
  release(root, 0.5);
  const slots = new Map<number, number>();
  let chutes = false;
  for (const part of craft.parts) {
    const modules = requirePart(catalog, part.partId).modules;
    const a = assemblies.get(assemblyOf.get(part.uid)!)!;
    if (modules.some(m => m.type === 'engine')) slots.set(part.uid, a.ignite);
    if (modules.some(m => m.type === 'fairing')) slots.set(part.uid, a.ignite > 0 ? a.ignite : 0.5);
    if (modules.some(m => m.type === 'decoupler')) {
      let edge: number | undefined;
      for (const [child, e] of edges) if (e.decoupler === part.uid) { edge = child; break; }
      slots.set(part.uid, edge === undefined ? a.ignite + 1 : assemblies.get(edge)!.drop);
    }
    if (modules.some(m => m.type === 'parachute')) chutes = true;
  }
  if (chutes) {
    const end = Math.max(root.drop, ...slots.values()) + 1;
    for (const part of craft.parts) if (requirePart(catalog, part.partId).modules.some(m => m.type === 'parachute')) slots.set(part.uid, end);
  }
  return fromSlots(craft, slots);
}

/** The original depth stager (engine=2d, decoupler=2d+1, chutes last). Kept so tuned stock designs stage exactly
 * as they were flight-tested; it lights radial boosters before their core. */
export function autoStageByDepth(craft: CraftDef, catalog: PartCatalog): CraftDef {
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const cut = new Set(decoupledEdges(craft, catalog).keys());
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

/** Same firing groups and order (empty stages ignored). */
export function sameStaging(a: CraftDef, b: CraftDef): boolean {
  const key = (c: CraftDef) => getStageList(c).filter(s => s.partUids.length).map(s => [...s.partUids].sort((x, y) => x - y).join(',')).join('|');
  return key(a) === key(b);
}

/**
 * Manual staging survives edits: stageable parts without a stage are inserted next to the parts the automatic stager
 * would fire them with, or into a new stage at the matching place in the existing order. Stages that the edit left
 * empty are removed.
 */
export function insertIntoStaging(craft: CraftDef, catalog: PartCatalog, stager: Stager = autoStage): CraftDef {
  const count = getStageList(craft).length;
  const pending = craft.parts.filter(p => isStageable(catalog, p) && (p.stage === undefined || p.stage >= count || p.stage < 0));
  if (!pending.length) return removeEmptyStages(craft);
  const auto = new Map(stager(craft, catalog).parts.map(p => [p.uid, p.stage]));
  const manual = new Map<number, number>();
  for (const p of craft.parts) if (p.stage !== undefined && p.stage >= 0 && p.stage < count && !pending.includes(p)) manual.set(p.uid, p.stage);
  // Fire order of new parts follows the automatic stager.
  pending.sort((a, b) => (auto.get(b.uid) ?? -1) - (auto.get(a.uid) ?? -1));
  for (const p of pending) {
    const slot = auto.get(p.uid);
    if (slot === undefined) continue;
    const peers = new Map<number, number>();
    let before: { auto: number; stage: number } | undefined, after: { auto: number; stage: number } | undefined;
    for (const [uid, stage] of manual) {
      const a = auto.get(uid);
      if (a === undefined) continue;
      if (a === slot) peers.set(stage, (peers.get(stage) ?? 0) + 1);
      else if (a > slot && (!before || a < before.auto || (a === before.auto && stage < before.stage))) before = { auto: a, stage };
      else if (a < slot && (!after || a > after.auto || (a === after.auto && stage > after.stage))) after = { auto: a, stage };
    }
    let stage: number;
    if (peers.size) stage = [...peers.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
    else if (before) stage = before.stage - 0.5;
    else if (after) stage = after.stage + 0.5;
    else stage = slot;
    manual.set(p.uid, stage);
  }
  const numbers = [...new Set(manual.values())].sort((a, b) => a - b);
  return { ...craft, editorStageCount: numbers.length, parts: craft.parts.map(p => ({ ...p, stage: manual.has(p.uid) ? numbers.indexOf(manual.get(p.uid)!) : undefined })) } as EditorCraft;
}

/** Move a whole stage to another UI position (0 fires first); the others keep their order. */
export function moveStage(craft: CraftDef, from: number, to: number): EditorCraft {
  const list = getStageList(craft);
  if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < list.length)) throw new Error('Invalid stage index');
  const order = list.map(s => s.index);
  order.splice(to, 0, ...order.splice(from, 1));
  const top = list.length - 1;
  const numberOf = new Map(order.map((oldIndex, newIndex) => [top - oldIndex, top - newIndex]));
  return { ...craft, editorStageCount: list.length, parts: craft.parts.map(p => ({ ...p, stage: p.stage === undefined ? undefined : numberOf.get(p.stage) ?? p.stage })) };
}

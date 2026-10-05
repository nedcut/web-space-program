import { validCraftLinks } from '../../sim/vessel/links';
import { validGroupActions } from '../../sim/vessel/actions';
import { validTweaks } from '../../sim/vessel/tweaks';
import type { CraftDef } from '../../sim/vessel/types';
import { requirePart, type PartCatalog } from './geometry';
const resourceIds = new Set(['liquidFuel', 'oxidizer', 'monopropellant', 'xenon', 'solidFuel', 'electricCharge', 'ablator', 'regolith']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
function vector(value: unknown, quaternion = false): boolean {
  return record(value) && ['x', 'y', 'z', ...(quaternion ? ['w'] : [])].every(k => finite(value[k]))
    && (!quaternion || Math.abs(Math.hypot(value.x as number, value.y as number, value.z as number, value.w as number) - 1) < 1e-5);
}
/** Reject malformed transforms, duplicate ids, missing parents, disconnected trees and cycles.
 * Optional catalog additionally validates part ids and stack-node occupancy. */
export function deserializeCraft(str: string, catalog?: PartCatalog): CraftDef {
  const value: unknown = JSON.parse(str);
  if (!record(value) || value.version !== 1 || typeof value.name !== 'string' || !['VAB', 'SPH'].includes(value.type as string)
    || (value.stockId !== undefined && typeof value.stockId !== 'string')
    || (value.description !== undefined && typeof value.description !== 'string') || !Array.isArray(value.parts)) throw new Error('Invalid craft header');
  if (value.editorStageCount !== undefined && !integer(value.editorStageCount)) throw new Error('Invalid stage count');
  const ids = new Set<number>();
  for (const p of value.parts) {
    if (!record(p) || !integer(p.uid) || ids.has(p.uid) || typeof p.partId !== 'string' || !p.partId || !vector(p.position) || !vector(p.rotation, true)
      || (p.parent !== undefined && !integer(p.parent)) || (p.stage !== undefined && !integer(p.stage))
      || (p.symmetryGroup !== undefined && !integer(p.symmetryGroup))
      || (p.attachNode !== undefined && typeof p.attachNode !== 'string') || (p.parentNode !== undefined && typeof p.parentNode !== 'string')) throw new Error('Invalid part instance');
    if (p.resources !== undefined && (!record(p.resources) || Object.entries(p.resources).some(([id, amount]) => !resourceIds.has(id) || !finite(amount) || amount < 0))) throw new Error('Invalid resources');
    if (p.tweaks !== undefined && !validTweaks(p.tweaks)) throw new Error('Invalid part settings');
    if (p.actions !== undefined && !validGroupActions(p.actions)) throw new Error('Invalid action groups');
    ids.add(p.uid);
  }
  const craft = value as unknown as CraftDef;
  if (craft.parts.length && craft.parts.filter(p => p.parent === undefined).length !== 1) throw new Error('Craft must have one root');
  if (!validCraftLinks(craft.parts)) throw new Error('Invalid part link');
  const byUid = new Map(craft.parts.map(p => [p.uid, p]));
  const occupied = new Set<string>();
  for (const p of craft.parts) {
    const seen = new Set<number>([p.uid]);
    let parent = p.parent;
    while (parent !== undefined) {
      if (!byUid.has(parent) || seen.has(parent)) throw new Error('Invalid parent tree');
      seen.add(parent); parent = byUid.get(parent)!.parent;
    }
    if (catalog) {
      const def = requirePart(catalog, p.partId);
      if (p.link && (!def.modules.some(m => m.type === 'strut' || m.type === 'fuelLine')
        || byUid.get(p.link.sourceUid)?.link || byUid.get(p.link.targetUid)?.link)) throw new Error('Unsupported link endpoints');
    }
    if (p.parent === undefined) {
      if (p.attachNode !== undefined || p.parentNode !== undefined) throw new Error('Root cannot have attachment metadata');
      continue;
    }
    if (!p.attachNode || !p.parentNode) throw new Error('Missing attachment metadata');
    if ((p.attachNode === 'srf') !== (p.parentNode === 'srf')) throw new Error('Invalid surface attachment');
    if (p.attachNode === 'srf') {
      if (catalog && (!requirePart(catalog, p.partId).surfaceAttachable || !requirePart(catalog, byUid.get(p.parent)!.partId).allowSurfaceAttachChildren)) throw new Error('Unsupported surface attachment');
    } else for (const [uid, node] of [[p.uid, p.attachNode], [p.parent, p.parentNode]] as const) {
      const key = `${uid}:${node}`;
      if (occupied.has(key)) throw new Error('Node used twice');
      occupied.add(key);
      if (catalog && !requirePart(catalog, byUid.get(uid)!.partId).attachNodes.some(n => n.id === node)) throw new Error('Unknown attach node');
    }
  }
  return craft;
}
export function serializeCraft(craft: CraftDef): string {
  const json = JSON.stringify(craft);
  deserializeCraft(json);
  return json;
}

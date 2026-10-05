import type { LinkModule, PartInstance, PartLink } from './types';
import type { PartState, VesselState } from './runtime';
import { qRotate } from '../../util/quat';
import { add, length, sub, type Vec3 } from '../../util/vec3';

type Host = Pick<PartInstance, 'uid' | 'position' | 'rotation'>;
export function linkEndpoints(link: PartLink, byUid: ReadonlyMap<number, Host>): { a: Vec3; b: Vec3 } | undefined {
  const a = byUid.get(link.sourceUid), b = byUid.get(link.targetUid);
  return a && b ? { a: add(a.position, qRotate(a.rotation, link.sourcePos)), b: add(b.position, qRotate(b.rotation, link.targetPos)) } : undefined;
}
export function linkModule(p: PartState): LinkModule | undefined {
  return p.def.modules.find((m): m is LinkModule => m.type === 'strut' || m.type === 'fuelLine');
}
export function activeLinks(v: VesselState, type: LinkModule['type']): PartState[] {
  return v.parts.filter(p => p.link && !p.link.broken && linkModule(p)?.type === type
    && v.cache.byUid.has(p.link.sourceUid) && v.cache.byUid.has(p.link.targetUid));
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const vector = (x: unknown): x is Vec3 => record(x) && ['x', 'y', 'z'].every(k => typeof x[k] === 'number' && Number.isFinite(x[k]) && Math.abs(x[k] as number) <= 1000);
/** Shared validation for editor JSON, offline sharing and network launch requests. */
export function validPartLink(x: unknown): x is PartLink {
  if (!record(x) || x.version !== 1 || !['sourceUid', 'targetUid'].every(k => Number.isSafeInteger(x[k]) && Number(x[k]) >= 0)
    || x.sourceUid === x.targetUid || !vector(x.sourcePos) || !vector(x.targetPos)
    || !vector(x.sourceNormal) || !vector(x.targetNormal) || (x.broken !== undefined && typeof x.broken !== 'boolean')) return false;
  return Math.abs(length(x.sourceNormal) - 1) < 1e-5 && Math.abs(length(x.targetNormal) - 1) < 1e-5;
}
export function validCraftLinks(parts: PartInstance[]): boolean {
  const byUid = new Map(parts.map(p => [p.uid, p]));
  return parts.every(p => {
    if (p.link === undefined) return true;
    if (!validPartLink(p.link) || p.link.sourceUid === p.uid || p.link.targetUid === p.uid) return false;
    const ends = linkEndpoints(p.link, byUid);
    return !!ends && length(sub(ends.a, ends.b)) >= 0.05 && length(sub(ends.a, ends.b)) <= 5 + 1e-6;
  });
}

import type { PartDef, PartInstance } from '../sim/vessel/types';
import type { Subassembly } from './core';
import { validTweaks } from '../sim/vessel/tweaks';

/** A named reusable subtree saved from the editor (shared by every program on this device). */
export interface SavedSubassembly extends Subassembly {
  id: string;
  name: string;
  created: number;
}

export const SUBASSEMBLY_KEY = 'wsp.subassemblies.v1';
const MAX_SAVED = 64;
const listeners = new Set<() => void>();
let cache: SavedSubassembly[] | null = null;

const finite = (...xs: unknown[]) => xs.every(x => typeof x === 'number' && Number.isFinite(x));
function validPart(p: unknown, catalog: ReadonlyMap<string, PartDef>): p is PartInstance {
  if (!p || typeof p !== 'object') return false;
  const q = p as PartInstance;
  return Number.isInteger(q.uid) && typeof q.partId === 'string' && catalog.has(q.partId)
    && !!q.position && finite(q.position.x, q.position.y, q.position.z)
    && !!q.rotation && finite(q.rotation.x, q.rotation.y, q.rotation.z, q.rotation.w)
    && (q.parent === undefined || Number.isInteger(q.parent)) && (q.tweaks === undefined || validTweaks(q.tweaks));
}
/** Untrusted storage: keep only entries whose parts all exist and form one tree under the root. */
function valid(x: unknown, catalog: ReadonlyMap<string, PartDef>): x is SavedSubassembly {
  if (!x || typeof x !== 'object') return false;
  const s = x as SavedSubassembly;
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.parts) || !s.parts.length || !s.parts.every(p => validPart(p, catalog))) return false;
  const uids = new Set(s.parts.map(p => p.uid));
  return uids.size === s.parts.length && uids.has(s.rootUid) && s.parts.every(p => p.uid === s.rootUid || (p.parent !== undefined && uids.has(p.parent)));
}

function read(catalog: ReadonlyMap<string, PartDef>): SavedSubassembly[] {
  try {
    const data: unknown = JSON.parse(globalThis.localStorage?.getItem(SUBASSEMBLY_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter(x => valid(x, catalog)) : [];
  } catch { return []; }
}

export function listSubassemblies(catalog: ReadonlyMap<string, PartDef>): SavedSubassembly[] {
  return cache ??= read(catalog);
}
export function subscribeSubassemblies(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

function write(list: SavedSubassembly[]): void {
  cache = list;
  globalThis.localStorage?.setItem(SUBASSEMBLY_KEY, JSON.stringify(list));
  listeners.forEach(fn => fn());
}

/** Save (or replace by name). Throws when storage is unavailable or full. */
export function saveSubassembly(name: string, sub: Subassembly, catalog: ReadonlyMap<string, PartDef>): SavedSubassembly {
  const clean = name.trim().slice(0, 80) || 'Subassembly';
  const entry: SavedSubassembly = { ...structuredClone(sub), id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: clean, created: Date.now() };
  const list = listSubassemblies(catalog).filter(s => s.name !== clean);
  write([entry, ...list].slice(0, MAX_SAVED));
  return entry;
}

export function deleteSubassembly(id: string, catalog: ReadonlyMap<string, PartDef>): void {
  write(listSubassemblies(catalog).filter(s => s.id !== id));
}

/** Tests: forget the in-memory copy. */
export function resetSubassemblyCache(): void { cache = null; }

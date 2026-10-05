import type { CraftDef, PartDef } from '../sim/vessel/types';

export const MAX_CRAFT_BYTES = 2_000_000;
export interface CraftImport { craft: CraftDef | null; unknownParts: string[]; errors: string[] }
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e8;

/** Validate untrusted craft data before any editor or mesh builder receives it. */
export function validateCraft(input: unknown, catalog: ReadonlyMap<string, PartDef>): CraftImport {
  const errors: string[] = [], unknownParts = new Set<string>();
  if (!record(input) || input.version !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || !['VAB', 'SPH'].includes(String(input.type)) || !Array.isArray(input.parts) || !input.parts.length || input.parts.length > 2000) {
    return { craft: null, errors: ['Invalid craft header, version, or part count (1–2000).'], unknownParts: [] };
  }
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 10000)) errors.push('Invalid description.');
  const ids = new Set<number>();
  const parents = new Map<number, number>();
  let roots = 0;
  for (const p of input.parts) {
    if (!record(p) || !Number.isSafeInteger(p.uid) || typeof p.uid !== 'number' || p.uid < 0 || typeof p.partId !== 'string') { errors.push('Invalid part identity.'); continue; }
    if (ids.has(p.uid)) errors.push(`Duplicate part uid ${p.uid}.`);
    ids.add(p.uid);
    if (!catalog.has(p.partId)) unknownParts.add(p.partId);
    if (!record(p.position) || !['x', 'y', 'z'].every(k => finite(p.position && (p.position as Record<string, unknown>)[k]))) errors.push(`Invalid position on ${p.uid}.`);
    if (!record(p.rotation) || !['x', 'y', 'z', 'w'].every(k => finite(p.rotation && (p.rotation as Record<string, unknown>)[k]))) errors.push(`Invalid rotation on ${p.uid}.`);
    else {
      const norm = Math.hypot(...['x', 'y', 'z', 'w'].map(k => Number((p.rotation as Record<string, unknown>)[k])));
      if (Math.abs(norm - 1) > 0.01) errors.push(`Rotation on ${p.uid} must be normalized.`);
    }
    if (p.parent === undefined) roots++; else if (typeof p.parent !== 'number' || !Number.isSafeInteger(p.parent)) errors.push('Invalid parent uid.'); else parents.set(p.uid, p.parent);
    for (const k of ['stage', 'symmetryGroup']) if (p[k] !== undefined && (!Number.isSafeInteger(p[k]) || Number(p[k]) < 0 || Number(p[k]) > 10000)) errors.push(`Invalid ${k}.`);
    for (const k of ['attachNode', 'parentNode']) if (p[k] !== undefined && (typeof p[k] !== 'string' || String(p[k]).length > 100)) errors.push(`Invalid ${k}.`);
    if (p.resources !== undefined && (!record(p.resources) || Object.values(p.resources).some(v => !finite(v) || Number(v) < 0))) errors.push('Invalid resource quantities.');
  }
  if (roots !== 1) errors.push('Craft must have exactly one root.');
  for (const [id, parent] of parents) {
    if (!ids.has(parent)) errors.push(`Missing parent ${parent}.`);
    const seen = new Set([id]);
    let next: number | undefined = parent;
    while (next !== undefined) {
      if (seen.has(next)) { errors.push('Cyclic part attachment.'); break; }
      seen.add(next); next = parents.get(next);
    }
  }
  return { craft: errors.length || unknownParts.size ? null : structuredClone(input) as unknown as CraftDef, errors: [...new Set(errors)], unknownParts: [...unknownParts].sort() };
}

async function transform(bytes: Uint8Array<ArrayBuffer>, compress: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream('deflate') : new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_CRAFT_BYTES) throw new Error('Craft exceeds size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const output = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function encodeCraft(craft: CraftDef, compression = true): Promise<string> {
  let bytes = new TextEncoder().encode(JSON.stringify(craft));
  if (bytes.length > MAX_CRAFT_BYTES) throw new Error('Craft exceeds size limit.');
  let codec = 'j';
  if (compression && typeof CompressionStream !== 'undefined') {
    try { bytes = await transform(bytes, true); codec = 'z'; } catch { /* Plain JSON works in older browsers. */ }
  }
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return `WSP1.${codec}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export async function decodeCraft(code: string): Promise<unknown> {
  code = code.trim();
  if (code.includes('#craft=')) code = new URLSearchParams(code.slice(code.indexOf('#') + 1)).get('craft') ?? '';
  const match = /^WSP1\.([jz])\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!match || code.length > MAX_CRAFT_BYTES * 1.4) throw new Error('Invalid or unsupported craft share code.');
  const binary = atob(match[2].replace(/-/g, '+').replace(/_/g, '/'));
  let bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (match[1] === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress share codes. Ask for a .craft.json file.');
    bytes = await transform(bytes, false);
  }
  if (bytes.length > MAX_CRAFT_BYTES) throw new Error('Craft exceeds size limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function downloadFile(name: string, data: string | Blob) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function craftFilename(name: string) { return `${name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80) || 'vehicle'}.craft.json`; }

import { installEarthData } from '../../sim/terrain/earthData';
/// <reference lib="webworker" />
/**
 * Web Worker: owns one Terrain per body and builds chunk meshes / equirect bakes on request.
 * Messages:
 *   { type: 'init', key, body, minWavelength }
 *   { type: 'build', id, key, params: ChunkBuildParams }   → { type: 'chunk', id, data: ChunkData }
 *   { type: 'bake', id, key, width }                       → { type: 'bake', id, result: BakeResult }
 */
import { createTerrain } from '../../sim/terrain';
import type { Terrain } from '../../sim/terrain/api';
import type { BodyDef } from '../../sim/bodies/types';
import { buildChunk, type ChunkBuildParams, type ChunkData } from './chunkBuilder';
import { bakeEquirect } from './bake';

const terrains = new Map<string, Terrain>();

type InMsg =
  | { type: 'earthData'; buffer: ArrayBufferLike; blob?: never }
  | { type: 'earthData'; blob: Blob; buffer?: never }
  | { type: 'init'; key: string; body: BodyDef; minWavelength: number }
  | { type: 'build'; id: number; key: string; params: ChunkBuildParams }
  | { type: 'bake'; id: number; key: string; width: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let earthReady: Promise<unknown> = Promise.resolve();
ctx.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === 'earthData') {
    earthReady = msg.blob ? msg.blob.arrayBuffer().then(installEarthData) : Promise.resolve(installEarthData(msg.buffer));
    // Requests below report decode failures with their request ID.
    void earthReady.catch(() => {});
    return;
  }
  try { await earthReady; } catch (error) {
    if ('id' in msg) ctx.postMessage({ type: 'error', id: msg.id, error: String(error) });
    return;
  }
  if (msg.type === 'init') {
    terrains.set(msg.key, createTerrain(msg.body, { minWavelength: msg.minWavelength }));
    return;
  }
  const terrain = terrains.get(msg.key);
  if (!terrain) {
    ctx.postMessage({ type: 'error', id: msg.id, error: `terrain ${msg.key} not initialised` });
    return;
  }
  if (msg.type === 'build') {
    const data = buildChunk(terrain, msg.params);
    ctx.postMessage({ type: 'chunk', id: msg.id, data }, transferablesOf(data));
  } else if (msg.type === 'bake') {
    const result = bakeEquirect(terrain, msg.width);
    ctx.postMessage({ type: 'bake', id: msg.id, result }, [result.data.buffer]);
  }
};

function transferablesOf(d: ChunkData): Transferable[] {
  const t: Transferable[] = [d.positions.buffer, d.normals.buffer, d.colors.buffer, d.detail.buffer];
  if (d.ocean) t.push(d.ocean.positions.buffer, d.ocean.normals.buffer, d.ocean.depth.buffer, d.ocean.detail.buffer);
  return t as Transferable[];
}

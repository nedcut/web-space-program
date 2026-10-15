import { earthDataMessage } from './earthLoader';
import { hasBiomeMap, type BiomeMap } from '../sim/science/biomeMap';
import type { Body } from '../sim/bodies/types';

export type BiomeMapRequest = { type: 'build'; key: string; body: Body };
export type BiomeMapWorkerMessage = BiomeMapRequest
  | { type: 'earthData'; blob: Blob; buffer?: never } | { type: 'earthData'; buffer: ArrayBufferLike; blob?: never };
type Reply = { type: 'result'; key: string; map: BiomeMap } | { type: 'error'; key: string; message: string };

/**
 * Biome maps for the map view, built once per body (and universe scale) in one lazy worker, off the main thread:
 * a full grid takes seconds of terrain sampling. Results are kept for the session.
 */
const maps = new Map<string, Promise<BiomeMap | null>>();
const waiting = new Map<string, (map: BiomeMap | null) => void>();
let worker: Worker | null = null;
let failed = false;

function startWorker(): Worker | null {
  if (worker || failed) return worker;
  if (typeof Worker === 'undefined') { failed = true; return null; }
  try {
    worker = new Worker(new URL('./biomeMap.worker.ts', import.meta.url), { type: 'module', name: 'biome-maps' });
    worker.postMessage({ type: 'earthData', ...earthDataMessage() });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const resolve = waiting.get(e.data.key);
      waiting.delete(e.data.key);
      if (e.data.type === 'error') maps.delete(e.data.key);
      resolve?.(e.data.type === 'result' ? e.data.map : null);
      if (!waiting.size) { worker?.terminate(); worker = null; }
    };
    worker.onerror = () => {
      failed = true; worker?.terminate(); worker = null;
      for (const [key, resolve] of waiting) { maps.delete(key); resolve(null); }
      waiting.clear();
    };
  } catch { failed = true; worker = null; }
  return worker;
}

/** The body's biome map, or null for single-biome bodies and when workers are unavailable. */
export function requestBiomeMap(body: Body): Promise<BiomeMap | null> {
  if (!hasBiomeMap(body)) return Promise.resolve(null);
  const key = `${body.id}:${body.radius}`;
  let hit = maps.get(key);
  if (!hit) {
    hit = new Promise<BiomeMap | null>(resolve => {
      const w = startWorker();
      if (!w) { resolve(null); return; }
      waiting.set(key, resolve);
      w.postMessage({ type: 'build', key, body } satisfies BiomeMapRequest);
    });
    maps.set(key, hit);
  }
  return hit;
}

/// <reference lib="webworker" />
/**
 * Part texture worker: returns cached images from IndexedDB, or generates and caches them.
 * Message in: { key }. Message out: { key, size, buffers } (buffers transferred).
 */
import { cacheGet, cachePut, type CachedTex } from './cache';
import { RECIPES, TEX_VERSION, generate } from './recipes';

declare const self: DedicatedWorkerGlobalScope;

async function load(key: string): Promise<CachedTex> {
  const hit = await cacheGet(key, TEX_VERSION);
  if (hit && hit.size === RECIPES[key]?.size) return hit;
  const data = generate(key);
  const buffers: CachedTex['buffers'] = {};
  for (const [ch, img] of Object.entries(data)) buffers[ch as keyof typeof data] = img.data.buffer as ArrayBuffer;
  const value = { size: RECIPES[key].size, buffers };
  await cachePut(key, TEX_VERSION, value);
  return value;
}

self.onmessage = async (e: MessageEvent<{ key: string }>) => {
  const { key } = e.data;
  try {
    const v = await load(key);
    self.postMessage({ key, size: v.size, buffers: v.buffers }, Object.values(v.buffers) as ArrayBuffer[]);
  } catch (err) {
    self.postMessage({ key, error: String(err) });
  }
};

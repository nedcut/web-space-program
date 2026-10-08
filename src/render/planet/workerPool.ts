import { earthData } from '../../sim/terrain/earthData';
import type { BodyDef } from '../../sim/bodies/types';
import type { Terrain } from '../../sim/terrain/api';
import { buildChunk, type ChunkBuildParams, type ChunkData } from './chunkBuilder';
import { bakeEquirect, type BakeResult } from './bake';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  worker: number;
}

/**
 * Shared pool of terrain workers. Falls back to synchronous main-thread building if Workers are
 * unavailable (the caller then applies its per-frame time budget).
 */
export class TerrainWorkerPool {
  private static _shared: TerrainWorkerPool | null = null;
  private workers: Worker[] = [];
  private inflight: number[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private earthSent = false;
  private terrains = new Map<string, Terrain>();
  private registered = new Map<string, { body: BodyDef; minWavelength: number }>();
  readonly available: boolean;
  private disposed = false;
  private baked = new Map<string, BakeResult>();
  private baking = new Map<string, Promise<BakeResult>>();
  private bakedBytes = 0;

  static shared(workerCount: number): TerrainWorkerPool {
    if (!this._shared) this._shared = new TerrainWorkerPool(workerCount);
    return this._shared;
  }

  constructor(workerCount: number, private readonly bakeCacheBytes = 16 * 1024 * 1024) {
    let ok = false;
    if (typeof Worker !== 'undefined' && workerCount > 0) {
      try {
        const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
        const n = Math.max(1, Math.min(workerCount, hc - 1));
        for (let i = 0; i < n; i++) {
          const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module', name: `terrain-${i}` });
          w.onmessage = (ev) => this.onMessage(i, ev.data);
          w.onerror = (ev) => {
            console.warn('[terrain worker] error', ev.message);
            window.dispatchEvent(new CustomEvent('wsp:worker-error', { detail: `Terrain worker failed: ${ev.message}` }));
          };
          this.workers.push(w);
          this.inflight.push(0);
        }
        ok = this.workers.length > 0;
      } catch (e) {
        console.warn('[terrain worker] unavailable, using main thread', e);
        this.workers = [];
      }
    }
    this.available = ok;
  }

  get workerCount(): number {
    return this.workers.length;
  }

  get totalInflight(): number {
    return this.inflight.reduce((a, b) => a + b, 0);
  }

  register(key: string, body: BodyDef, terrain: Terrain, minWavelength: number): void {
    this.terrains.set(key, terrain);
    if (this.registered.has(key)) return;
    this.registered.set(key, { body, minWavelength });
    if (this.workers.length && body.surface.preset === 'earth' && !this.earthSent) {
      const buffer = earthData().buffer;
      // Blob structured cloning shares its immutable backing store. Materialise ArrayBuffers in the
      // workers instead of synchronously copying the 16 MiB grid once per worker on the render thread.
      const source = buffer instanceof ArrayBuffer ? { blob: new Blob([buffer]) } : { buffer };
      for (const w of this.workers) w.postMessage({ type: 'earthData', ...source });
      this.earthSent = true;
    }
    for (const w of this.workers) w.postMessage({ type: 'init', key, body, minWavelength });
  }

  private pickWorker(): number {
    let best = 0;
    for (let i = 1; i < this.inflight.length; i++) if (this.inflight[i] < this.inflight[best]) best = i;
    return best;
  }

  private send<T>(msg: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const wi = this.pickWorker();
    this.inflight[wi]++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, worker: wi });
      this.workers[wi].postMessage({ ...msg, id });
    });
  }

  private onMessage(wi: number, data: { type: string; id: number; data?: ChunkData; result?: BakeResult; error?: string }): void {
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    this.inflight[wi] = Math.max(0, this.inflight[wi] - 1);
    if (data.type === 'error') p.reject(new Error(data.error));
    else p.resolve(data.type === 'chunk' ? data.data : data.result);
  }

  buildChunk(key: string, params: ChunkBuildParams): Promise<ChunkData> {
    if (!this.available) return Promise.resolve(this.buildChunkSync(key, params));
    return this.send<ChunkData>({ type: 'build', key, params });
  }

  /** Synchronous build on the calling thread (fallback path). */
  buildChunkSync(key: string, params: ChunkBuildParams): ChunkData {
    const t = this.terrains.get(key);
    if (!t) throw new Error(`terrain ${key} not registered`);
    return buildChunk(t, params);
  }

  /** Immutable CPU pixels survive scene/GL teardown, with a bounded least-recently-used budget. */
  bake(key: string, width: number): Promise<BakeResult> {
    if (this.disposed) return Promise.reject(new Error('disposed'));
    const id = `${key}:${width}`;
    const cached = this.baked.get(id);
    if (cached) {
      this.baked.delete(id); this.baked.set(id, cached);
      return Promise.resolve(cached);
    }
    const pending = this.baking.get(id);
    if (pending) return pending;
    const terrain = this.terrains.get(key);
    if (!terrain) return Promise.reject(new Error(`terrain ${key} not registered`));
    const task = this.available ? this.send<BakeResult>({ type: 'bake', key, width })
      : Promise.resolve(bakeEquirect(terrain, width));
    const promise = task.then(result => {
      const bytes = result.data.byteLength;
      if (!this.disposed && bytes <= this.bakeCacheBytes) {
        while (this.bakedBytes + bytes > this.bakeCacheBytes && this.baked.size) {
          const oldest = this.baked.keys().next().value!;
          this.bakedBytes -= this.baked.get(oldest)!.data.byteLength;
          this.baked.delete(oldest);
        }
        this.baked.set(id, result); this.bakedBytes += bytes;
      }
      return result;
    }).finally(() => this.baking.delete(id));
    this.baking.set(id, promise);
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    this.baked.clear(); this.baking.clear(); this.bakedBytes = 0;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
    if (TerrainWorkerPool._shared === this) TerrainWorkerPool._shared = null;
  }
}

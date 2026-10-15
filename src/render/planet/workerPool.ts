import { earthData } from '../../sim/terrain/earthData';
import type { BodyDef } from '../../sim/bodies/types';
import type { Terrain } from '../../sim/terrain/api';
import { buildChunk, type ChunkBuildParams, type ChunkData } from './chunkBuilder';
import { bakeEquirect, type BakeResult } from './bake';
import { earthDataSource, type EarthDataMessage } from './earthSource';

/** Worker replacements per session before a failing slot retires. */
const MAX_RESPAWNS = 3;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  worker: number;
  bake: boolean;
}

/**
 * Shared pool of terrain workers. Falls back to synchronous main-thread building if Workers are
 * unavailable (the caller then applies its per-frame time budget).
 */
export class TerrainWorkerPool {
  private static _shared: TerrainWorkerPool | null = null;
  private workers: (Worker | null)[] = [];
  private inflight: number[] = [];
  /** Bakes running per worker: a multi-second far-LOD bake must not hold chunk builds queued behind it. */
  private workerBakes: number[] = [];
  private bakeQueue: { run: () => void; reject: (e: unknown) => void }[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Sent to every (re)spawned worker once an Earth terrain is registered. */
  private earthMessage: EarthDataMessage | null = null;
  private respawns = 0;
  private terrains = new Map<string, Terrain>();
  private registered = new Map<string, { body: BodyDef; minWavelength: number }>();
  private disposed = false;
  private baked = new Map<string, BakeResult>();
  private baking = new Map<string, Promise<BakeResult>>();
  private bakedBytes = 0;

  static shared(workerCount: number): TerrainWorkerPool {
    if (!this._shared) this._shared = new TerrainWorkerPool(workerCount);
    return this._shared;
  }

  constructor(workerCount: number, private readonly bakeCacheBytes = 16 * 1024 * 1024) {
    if (typeof Worker !== 'undefined' && workerCount > 0) {
      try {
        const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
        const n = Math.max(1, Math.min(workerCount, hc - 1));
        for (let i = 0; i < n; i++) { this.workers.push(this.spawn(i)); this.inflight.push(0); this.workerBakes.push(0); }
      } catch (e) {
        console.warn('[terrain worker] unavailable, using main thread', e);
        this.workers = [];
      }
    }
  }

  /** False once no worker is usable: callers then build on the main thread under their frame budget. */
  get available(): boolean {
    return this.workers.some(w => w !== null);
  }

  /** A new worker receives the Earth grid and every registered terrain, in registration order. */
  private spawn(i: number): Worker {
    const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module', name: `terrain-${i}` });
    w.onmessage = (ev) => this.onMessage(i, ev.data);
    w.onerror = (ev) => {
      ev.preventDefault();
      this.fail(i, ev.message ? `${ev.message} (${ev.filename}:${ev.lineno})` : 'worker script failed to load');
    };
    if (this.earthMessage) w.postMessage({ type: 'earthData', ...this.earthMessage });
    for (const [key, { body, minWavelength }] of this.registered) w.postMessage({ type: 'init', key, body, minWavelength });
    return w;
  }

  /**
   * An uncaught worker error loses that worker's terrains and requests. Its callers see rejections and retry; the
   * worker is replaced a few times per session, after which the slot retires (all retired: main-thread building).
   */
  private fail(i: number, reason: string): void {
    const w = this.workers[i];
    if (!w || this.disposed) return;
    w.terminate();
    for (const [id, p] of this.pending) if (p.worker === i) { this.pending.delete(id); p.reject(new Error(`Terrain worker failed: ${reason}`)); }
    this.inflight[i] = 0; this.workerBakes[i] = 0;
    const respawn = this.respawns < MAX_RESPAWNS;
    if (respawn) this.respawns++;
    this.workers[i] = respawn ? this.trySpawn(i) : null;
    const outcome = this.workers[i] ? 'restarted' : this.available ? 'retired' : 'unavailable, using the main thread';
    console.error(`[terrain worker] terrain-${i} failed: ${reason}; ${outcome}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wsp:worker-warning', { detail: `Terrain worker failed (${reason}) and was ${outcome === 'restarted' ? 'restarted' : 'stopped'}` }));
    }
    this.drainBakes();
  }

  private trySpawn(i: number): Worker | null {
    try { return this.spawn(i); } catch { return null; }
  }

  get workerCount(): number {
    return this.workers.filter(w => w !== null).length;
  }

  get totalInflight(): number {
    return this.inflight.reduce((a, b) => a + b, 0);
  }

  register(key: string, body: BodyDef, terrain: Terrain, minWavelength: number): void {
    this.terrains.set(key, terrain);
    if (this.registered.has(key)) return;
    this.registered.set(key, { body, minWavelength });
    if (this.workers.length && body.surface.preset === 'earth' && !this.earthMessage) {
      // Blob structured cloning shares its immutable backing store. Materialise ArrayBuffers in the
      // workers instead of synchronously copying the 16 MiB grid once per worker on the render thread.
      // Prefer the host's fetched Blob; building a new one copies the grid again on this thread.
      const host = earthDataSource();
      const buffer = host ? undefined : earthData().buffer;
      this.earthMessage = host ? host() : buffer instanceof ArrayBuffer ? { blob: new Blob([buffer]) } : { buffer: buffer! };
      for (const w of this.workers) w?.postMessage({ type: 'earthData', ...this.earthMessage });
    }
    for (const w of this.workers) w?.postMessage({ type: 'init', key, body, minWavelength });
  }

  /** Least-loaded worker; chunk builds prefer workers without a bake running. */
  private pickWorker(build: boolean): number {
    let best = -1;
    for (let pass = build ? 0 : 1; pass < 2 && best < 0; pass++) {
      for (let i = 0; i < this.workers.length; i++) {
        if (!this.workers[i] || (pass === 0 && this.workerBakes[i] > 0)) continue;
        if (best < 0 || this.inflight[i] < this.inflight[best]) best = i;
      }
    }
    return best;
  }

  private send<T>(msg: Record<string, unknown> & { type: 'build' | 'bake' }): Promise<T> {
    const id = this.nextId++;
    const bake = msg.type === 'bake';
    const wi = this.pickWorker(!bake);
    this.inflight[wi]++;
    if (bake) this.workerBakes[wi]++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, worker: wi, bake });
      this.workers[wi]!.postMessage({ ...msg, id });
    });
  }

  private onMessage(wi: number, data: { type: string; id: number; data?: ChunkData; result?: BakeResult; error?: string }): void {
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    this.inflight[wi] = Math.max(0, this.inflight[wi] - 1);
    if (p.bake) { this.workerBakes[wi] = Math.max(0, this.workerBakes[wi] - 1); this.drainBakes(); }
    if (data.type === 'error') p.reject(new Error(data.error));
    else p.resolve(data.type === 'chunk' ? data.data : data.result);
  }

  /** At most all-but-one workers bake at once, so one always takes chunk builds. */
  private drainBakes(): void {
    const running = this.workerBakes.reduce((a, b) => a + b, 0);
    let free = Math.max(1, this.workerCount - 1) - running;
    while (this.bakeQueue.length && (free-- > 0 || !this.available)) this.bakeQueue.shift()!.run();
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
    const task = new Promise<BakeResult>((resolve, reject) => {
      this.bakeQueue.push({ reject, run: () => {
        (this.available ? this.send<BakeResult>({ type: 'bake', key, width }) : Promise.resolve(bakeEquirect(terrain, width))).then(resolve, reject);
      } });
      this.drainBakes();
    });
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
    for (const w of this.workers) w?.terminate();
    this.workers = [];
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    for (const q of this.bakeQueue) q.reject(new Error('disposed'));
    this.bakeQueue = [];
    this.pending.clear();
    if (TerrainWorkerPool._shared === this) TerrainWorkerPool._shared = null;
  }
}

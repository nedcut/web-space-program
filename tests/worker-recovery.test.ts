import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainWorkerPool } from '../src/render/planet/workerPool';
import { createUniverse } from '../src/sim/bodies';
import { createTerrain } from '../src/sim/terrain';

class MockWorker {
  static created: MockWorker[] = [];
  postMessage = vi.fn(); terminate = vi.fn();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: Partial<ErrorEvent> & { preventDefault(): void }) => void) | null = null;
  constructor() { MockWorker.created.push(this); }
  crash(message = '') { this.onerror!({ message, filename: 'chunkWorker.js', lineno: 3, preventDefault() {} }); }
}

afterEach(() => { MockWorker.created = []; vi.unstubAllGlobals(); });

function stub() {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  const events: string[] = [];
  vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent<string>) => events.push(e.detail) });
  vi.stubGlobal('CustomEvent', class { constructor(readonly type: string, init: { detail: string }) { Object.assign(this, init); } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return events;
}

describe('terrain worker failure', () => {
  it('rejects the failed worker\'s requests and replaces it with one that knows every terrain', async () => {
    const events = stub();
    const earth = createUniverse('standard').get('earth')!, moon = createUniverse('standard').get('moon')!;
    const pool = new TerrainWorkerPool(2);
    pool.register('earth', earth, createTerrain(earth), 6);
    pool.register('moon', moon, createTerrain(moon), 6);
    const params = { face: 0, level: 0, x: 0, y: 0, res: 4, radius: moon.radius, ocean: false } as never;
    const a = pool.buildChunk('moon', params), b = pool.buildChunk('moon', params);
    const [first, second] = MockWorker.created;
    const toSecond = second.postMessage.mock.calls.at(-1)![0];
    first.crash();
    await expect(a).rejects.toThrow('Terrain worker failed: worker script failed to load');
    const replacement = MockWorker.created[2];
    expect(first.terminate).toHaveBeenCalled();
    expect(replacement.postMessage.mock.calls.map(c => c[0].type)).toEqual(['earthData', 'init', 'init']);
    expect(replacement.postMessage.mock.calls[0][0].blob).toBe(first.postMessage.mock.calls[0][0].blob);
    expect(replacement.postMessage.mock.calls.slice(1).map(c => c[0].key)).toEqual(['earth', 'moon']);
    expect(events).toEqual(['Terrain worker failed (worker script failed to load) and was restarted']);
    // The other worker's request is untouched and still resolves.
    second.onmessage!({ data: { type: 'chunk', id: toSecond.id, data: 'ok' } });
    await expect(b).resolves.toBe('ok');
    expect(pool.available).toBe(true);
    pool.dispose();
  });

  it('falls back to main-thread building once replacements are exhausted', async () => {
    const events = stub();
    const moon = createUniverse('standard').get('moon')!;
    const pool = new TerrainWorkerPool(1);
    pool.register('moon', moon, createTerrain(moon), 6);
    for (let i = 0; i < 4; i++) MockWorker.created.at(-1)!.crash('RangeError: out of memory');
    expect(MockWorker.created).toHaveLength(4);
    expect(pool.available).toBe(false);
    expect(events.at(-1)).toBe('Terrain worker failed (RangeError: out of memory (chunkWorker.js:3)) and was stopped');
    const data = await pool.buildChunk('moon', { face: 0, level: 0, x: 0, y: 0, res: 4, radius: moon.radius, ocean: false } as never);
    expect(data.positions.length).toBeGreaterThan(0);
    pool.dispose();
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { EARTH_DATA_BYTES, EARTH_FILES } from '../src/sim/terrain/earthData';

// loadEarthData under both hosts: cross-origin isolated (one SharedArrayBuffer for every worker) and plain (Blob per worker).
const bytes = new Int16Array(EARTH_DATA_BYTES / 2);
bytes[123] = -4321;
bytes[EARTH_FILES[0].bytes / 2 + 7] = 1234;

async function load(isolated: boolean) {
  vi.resetModules();
  vi.stubGlobal('crossOriginIsolated', isolated);
  // Each host file is served separately; the loader joins them in EARTH_FILES order.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const index = EARTH_FILES.findIndex(file => url.endsWith(file.path));
    const start = EARTH_FILES.slice(0, index).reduce((sum, file) => sum + file.bytes, 0);
    return new Response(new Blob([new Uint8Array(bytes.buffer, start, EARTH_FILES[index].bytes)]));
  }));
  const loader = await import('../src/game/earthLoader');
  const data = await import('../src/sim/terrain/earthData');
  await loader.loadEarthData();
  return { message: loader.earthDataMessage(), buffer: data.earthData().buffer };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('installs a SharedArrayBuffer and posts it as-is when cross-origin isolated', async () => {
  const { message, buffer } = await load(true);
  expect(buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(message.buffer).toBe(buffer);
  expect(message.blob).toBeUndefined();
  expect(new Int16Array(buffer)[123]).toBe(-4321);
  expect(new Int16Array(buffer)[EARTH_FILES[0].bytes / 2 + 7]).toBe(1234);
});

it('falls back to the fetched Blob without isolation (host without COOP/COEP headers)', async () => {
  const { message, buffer } = await load(false);
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(message.buffer).toBeUndefined();
  expect(message.blob!.size).toBe(buffer.byteLength);
  expect(new Int16Array(await message.blob!.arrayBuffer())[123]).toBe(-4321);
});

it('reports real streamed bytes across all required files before installing terrain', async () => {
  vi.resetModules();
  const releases: (() => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = EARTH_FILES.find(file => url.endsWith(file.path))!;
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(new Uint8Array(8));
      await new Promise<void>(resolve => releases.push(resolve));
      controller.enqueue(new Uint8Array(file.bytes - 8));
      controller.close();
    } }));
  }));
  const loader = await import('../src/game/earthLoader');
  const data = await import('../src/sim/terrain/earthData');
  const progress: number[] = [];
  const pending = loader.loadEarthData((received, total) => {
    expect(total).toBe(EARTH_DATA_BYTES);
    progress.push(received);
  });
  await vi.waitFor(() => expect(progress.at(-1)).toBe(24));
  expect(() => data.earthData()).toThrow('Earth data not loaded');
  releases.forEach(release => release());
  await pending;
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(EARTH_DATA_BYTES);
  expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
  expect(data.earthData().buffer.byteLength).toBe(EARTH_DATA_BYTES);
});

it.each(['http', 'incomplete', 'network'])('rejects %s failures without installing partial terrain and permits retry', async failure => {
  vi.resetModules();
  const fetcher = vi.fn(async (url: string) => {
    const file = EARTH_FILES.find(file => url.endsWith(file.path))!;
    if (failure === 'network') throw new TypeError('Failed to fetch');
    return failure === 'http' ? new Response('', { status: 503 }) : new Response(new Uint8Array(file.bytes - 1));
  });
  vi.stubGlobal('fetch', fetcher);
  const loader = await import('../src/game/earthLoader');
  const data = await import('../src/sim/terrain/earthData');
  await expect(loader.loadEarthData()).rejects.toThrow();
  expect(() => data.earthData()).toThrow('Earth data not loaded');
  fetcher.mockImplementation(async (url: string) => new Response(new Uint8Array(EARTH_FILES.find(file => url.endsWith(file.path))!.bytes)));
  await loader.loadEarthData();
  expect(data.earthData().buffer.byteLength).toBe(EARTH_DATA_BYTES);
});

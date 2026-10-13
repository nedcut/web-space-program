import { afterEach, expect, it, vi } from 'vitest';
import { EARTH_DATA_BYTES } from '../src/sim/terrain/earthData';

// loadEarthData under both hosts: cross-origin isolated (one SharedArrayBuffer for every worker) and plain (Blob per worker).
const bytes = new Int16Array(EARTH_DATA_BYTES / 2);
bytes[123] = -4321;

async function load(isolated: boolean) {
  vi.resetModules();
  vi.stubGlobal('crossOriginIsolated', isolated);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([bytes]))));
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
});

it('falls back to the fetched Blob without isolation (host without COOP/COEP headers)', async () => {
  const { message, buffer } = await load(false);
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(message.buffer).toBeUndefined();
  expect(message.blob!.size).toBe(buffer.byteLength);
  expect(new Int16Array(await message.blob!.arrayBuffer())[123]).toBe(-4321);
});

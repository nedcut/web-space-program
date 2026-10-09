import { afterEach, expect, it, vi } from 'vitest';
import type { ImageStrips } from '../src/render/planet/imageStrips';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetModules(); });
const source = () => ({ width: 1, height: 3, channels: 4 as const, strips: [0, 1, 2].map(y => ({ y, rows: 1, bitmap: { close: vi.fn() } as unknown as ImageBitmap })) });

it('transfers the last-owned bitmaps to the worker for release without closing them on the render thread', async () => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  vi.stubGlobal('Worker', class { postMessage = postMessage; terminate() {} });
  const { releaseImagery } = await import('../src/render/planet/imageryDecode');
  const images: ImageStrips = source();
  releaseImagery(images);
  const bitmaps = images.strips.map(s => s.bitmap!);
  expect(postMessage).toHaveBeenCalledWith({ type: 'release', bitmaps }, bitmaps);
  for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
});

it('yields between individual closes when workers are unavailable', async () => {
  vi.useFakeTimers(); vi.stubGlobal('Worker', undefined);
  const tasks: (() => void)[] = [];
  vi.stubGlobal('setTimeout', (callback: () => void) => { tasks.push(callback); return 0; });
  const { releaseImagery } = await import('../src/render/planet/imageryDecode');
  const images: ImageStrips = source(); releaseImagery(images);
  expect(images.strips[0].bitmap!.close).not.toHaveBeenCalled();
  tasks.shift()!(); await Promise.resolve();
  expect(images.strips[0].bitmap!.close).toHaveBeenCalledOnce();
  expect(images.strips[1].bitmap!.close).not.toHaveBeenCalled();
  while (tasks.length) { tasks.shift()!(); await Promise.resolve(); }
  for (const s of images.strips) expect(s.bitmap!.close).toHaveBeenCalledOnce();
});

it('has nothing to release for pixel strips (Firefox)', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal('Worker', class { postMessage = postMessage; terminate() {} });
  const { releaseImagery } = await import('../src/render/planet/imageryDecode');
  releaseImagery({ width: 1, height: 1, channels: 1, strips: [{ y: 0, rows: 1, pixels: new Uint8Array(1) }] });
  expect(postMessage).not.toHaveBeenCalled();
});

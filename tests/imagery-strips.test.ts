import { afterEach, expect, it, vi } from 'vitest';
import { cutImageStrips } from '../src/render/planet/imageStrips';

afterEach(() => vi.unstubAllGlobals());
it('caps upload strips, preserves the last partial strip and closes the source', async () => {
  const full = { width: 8, height: 5, close: vi.fn() };
  const decode = vi.fn().mockResolvedValueOnce(full).mockImplementation(async () => ({ close: vi.fn() }));
  vi.stubGlobal('createImageBitmap', decode);
  const result = await cutImageStrips(new Blob(), 8 * 4 * 2);
  expect(result).toMatchObject({ width: 8, height: 5, strips: [{ y: 0 }, { y: 2 }, { y: 4 }] });
  expect(decode.mock.calls.slice(1).map(c => c.slice(1, 5))).toEqual([[0, 0, 8, 2], [0, 2, 8, 2], [0, 4, 8, 1]]);
  expect(full.close).toHaveBeenCalledOnce();
  expect(result.strips[0].bitmap!.close).not.toHaveBeenCalled();
});
it('closes already decoded strips and the full image when cropping fails', async () => {
  const full = { width: 8, height: 5, close: vi.fn() }, strip = { close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce(strip).mockRejectedValueOnce(new Error('decode failed')));
  await expect(cutImageStrips(new Blob(), 64)).rejects.toThrow('decode failed');
  expect(full.close).toHaveBeenCalledOnce(); expect(strip.close).toHaveBeenCalledOnce();
});
it('returns packed pixels in Firefox, whose texture upload ignores crops and reads canvas bitmaps back', async () => {
  const full = { width: 2, height: 3, close: vi.fn() };
  const drawImage = vi.fn(), getContext = vi.fn();
  // Row y of the source has red = 10·y + x, green 200, blue 100, alpha 255.
  let lastY = 0;
  const ctx = {
    clearRect: vi.fn(),
    drawImage: (...a: number[]) => { drawImage(...a); lastY = a[2]; },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Array.from({ length: w * h }, (_, i) => [10 * (lastY + Math.floor(i / w)) + (i % w), 200, 100, 255]).flat()) }),
  };
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/143.0 Zen/1.0' });
  vi.stubGlobal('OffscreenCanvas', class { getContext(...a: unknown[]) { getContext(...a); return ctx; } });
  const decode = vi.fn().mockResolvedValueOnce(full);
  vi.stubGlobal('createImageBitmap', decode);
  const red = await cutImageStrips(new Blob(), 2 * 2, 1);
  expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  expect(decode).toHaveBeenCalledOnce(); // no cropped bitmaps
  expect(red).toMatchObject({ width: 2, height: 3, channels: 1 });
  expect(red.strips.map(s => [s.y, s.rows, [...s.pixels!]])).toEqual([[0, 2, [0, 1, 10, 11]], [2, 1, [20, 21]]]);
  expect(full.close).toHaveBeenCalledOnce();
  decode.mockResolvedValueOnce({ ...full, close: vi.fn() });
  const rgba = await cutImageStrips(new Blob(), 2 * 4 * 2, 4);
  expect(rgba.strips.map(s => [s.y, s.rows, s.pixels!.length])).toEqual([[0, 2, 16], [2, 1, 8]]);
  expect([...rgba.strips[1].pixels!.slice(0, 4)]).toEqual([20, 200, 100, 255]);
});

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
  expect(result.strips[0].bitmap.close).not.toHaveBeenCalled();
});
it('closes already decoded strips and the full image when cropping fails', async () => {
  const full = { width: 8, height: 5, close: vi.fn() }, strip = { close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce(strip).mockRejectedValueOnce(new Error('decode failed')));
  await expect(cutImageStrips(new Blob(), 64)).rejects.toThrow('decode failed');
  expect(full.close).toHaveBeenCalledOnce(); expect(strip.close).toHaveBeenCalledOnce();
});
it('copies cropped strips through a 2D canvas in Firefox, whose texture upload ignores the crop', async () => {
  const full = { width: 8, height: 4, close: vi.fn() }, crop = { width: 8, height: 2, close: vi.fn() }, owned = { width: 8, height: 2 };
  const drawImage = vi.fn();
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/143.0 Zen/1.0' });
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage }; } transferToImageBitmap() { return owned; } });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(full).mockResolvedValue(crop));
  const result = await cutImageStrips(new Blob(), 8 * 4 * 2);
  expect(result.strips.map(s => s.bitmap)).toEqual([owned, owned]);
  expect(drawImage).toHaveBeenCalledTimes(2); expect(crop.close).toHaveBeenCalledTimes(2);
});

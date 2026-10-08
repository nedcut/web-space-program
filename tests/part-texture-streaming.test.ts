import { afterEach, expect, it, vi } from 'vitest';
import type { DataTexture } from 'three';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('starts with one texel and adopts transferred pixels for the texture and its repeat clones', async () => {
  class MockWorker {
    static created: MockWorker[] = [];
    onmessage?: (e: { data: unknown }) => void;
    postMessage = vi.fn();
    constructor() { MockWorker.created.push(this); }
  }
  vi.stubGlobal('window', {}); vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', { hardwareConcurrency: 2 }); vi.stubGlobal('Worker', MockWorker);
  const { texSet, repeated, partTexturesReady } = await import('../src/render/parts/textures');
  const set = texSet('metal');
  const texture = set.map as DataTexture;
  const clone = repeated(texture, 3) as DataTexture;
  expect(texture.image).toMatchObject({ width: 1, height: 1 });
  expect(texture.image.data!.byteLength).toBe(4);
  const albedo = new Uint8Array(256 * 256 * 4).fill(123);
  const before = clone.version;
  const dispose = vi.spyOn(texture, 'dispose'), disposeClone = vi.spyOn(clone, 'dispose');
  MockWorker.created[0].onmessage!({ data: { key: 'metal', size: 256, buffers: { albedo: albedo.buffer } } });
  await partTexturesReady();
  expect(dispose).toHaveBeenCalledOnce(); expect(disposeClone).toHaveBeenCalledOnce();
  expect(texture.image).toMatchObject({ width: 256, height: 256 });
  expect(texture.image.data!.buffer).toBe(albedo.buffer);
  expect(clone.source).toBe(texture.source);
  expect(clone.image).toBe(texture.image);
  expect(clone.repeat.x).toBe(3);
  expect(clone.version).toBeGreaterThan(before);
});

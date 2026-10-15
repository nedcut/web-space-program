import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ImageStrips } from '../src/render/planet/imageStrips';

const decoded = vi.hoisted(() => ({ release: vi.fn(), decode: vi.fn() }));
vi.mock('../src/render/planet/imageryDecode', () => ({ decodeImagery: decoded.decode, releaseImagery: decoded.release }));
const strips = (): ImageStrips => ({ width: 4, height: 2, channels: 4, strips: [{ y: 0, rows: 2, pixels: new Uint8Array(32) }] });
const renderer = {
  getContext: () => ({ isContextLost: () => false }), initTexture() {}, copyTextureToTexture() {},
  getRenderTarget: () => null, setRenderTarget() {}, render() {}, autoClear: true,
} as unknown as THREE.WebGLRenderer;
const manifest = { levels: [{ id: '8k', width: 4, height: 2, tiles: 1, bundled: true,
  day: 'day.webp', water: 'water.webp', night: 'night.webp', clouds: 'clouds.webp' }] };

async function setup(options = {}, failRegion = false) {
  vi.stubGlobal('createImageBitmap', () => {});
  vi.stubGlobal('caches', undefined);
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    return new Response(new Blob([url]), { status: failRegion && url.includes('gulf-v1') ? 404 : 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  decoded.decode.mockImplementation(async () => strips());
  const { EarthImagery } = await import('../src/render/planet/earthImagery');
  const imagery = new EarthImagery({ quality: 'medium', radius: 637100, nightLights: true, ...options });
  imagery.update(6);
  return { imagery, fetcher };
}
async function advance(imagery: { step(r: THREE.WebGLRenderer): void }, frames = 80) {
  for (let i = 0; i < frames; i++) { await new Promise(r => setTimeout(r, 0)); imagery.step(renderer); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it('streams the regional textures after the global level, then rebuilds them after context loss', async () => {
  const { imagery } = await setup();
  await advance(imagery);
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(1);
  expect(imagery.levelId).toBe('8k');
  const day = imagery.uniforms.uEarthRegionDay.value;
  const dispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
  imagery.restoreContext();
  expect(dispose.mock.contexts.some(target => target instanceof THREE.WebGLRenderTarget && target.texture === day)).toBe(true);
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(0);
  await advance(imagery);
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(1);
  expect(imagery.uniforms.uEarthRegionDay.value).not.toBe(day);
  imagery.dispose();
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(0);
});

it('retains global imagery when the optional pack is unavailable without repeatedly fetching it', async () => {
  const { imagery, fetcher } = await setup({}, true);
  await advance(imagery);
  expect(imagery.ready).toBe(true);
  expect(imagery.uniforms.uEarthImagery.value).toBe(1);
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(0);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('gulf-v1'))).toHaveLength(4);
  imagery.dispose();
});

it('does not fetch the regional pack for far-only renderers or Low', async () => {
  for (const opts of [{ maxLevel: '4k' }, { quality: 'low' }]) {
    const { imagery, fetcher } = await setup(opts);
    await advance(imagery);
    expect(fetcher.mock.calls.some(([url]) => url.includes('gulf-v1'))).toBe(false);
    imagery.dispose();
  }
});

it('releases a pending pack after disposal and never binds its late result', async () => {
  const { imagery } = await setup();
  const pending: (() => void)[] = [];
  decoded.decode.mockImplementation(async (blob: Blob) => {
    if ((await blob.text()).includes('gulf-v1')) await new Promise<void>(r => pending.push(r));
    return strips();
  });
  await advance(imagery);
  expect(pending).toHaveLength(4);
  imagery.dispose();
  pending.forEach(r => r());
  await advance(imagery, 4);
  expect(imagery.uniforms.uEarthRegionOn.value).toBe(0);
  // Three global images plus the four late regional images each relinquish their decoded data.
  expect(decoded.release).toHaveBeenCalledTimes(7);
});

it('ships the exact derivatives recorded in the regional provenance manifest', () => {
  const root = new URL('../public/earth/imagery/packs/gulf-v1/', import.meta.url);
  const m = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  expect(m.bounds).toEqual({ west: -100, east: -60, south: 10, north: 35 });
  expect([m.width, m.height]).toEqual([4096, 2560]);
  for (const file of m.files) {
    const bytes = readFileSync(new URL(file.path, root));
    expect(bytes.length).toBe(file.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  }
});

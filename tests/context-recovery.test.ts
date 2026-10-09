import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreHook, onContextRestored } from '../src/render/core/contextRecovery';
import { ProceduralCubeMap } from '../src/render/core/proceduralCube';
import type { ImageStrips } from '../src/render/planet/imageStrips';
import { SITE_LAYERS, SiteTextureArray } from '../src/render/site/siteSurfaces';

/** A renderer stand-in: a canvas that can emit context events, and just enough of the draw API for the bakers. */
function fakeRenderer() {
  const dom = new EventTarget();
  const state = { lost: false };
  const calls = { render: 0, copy: 0, init: 0 };
  const renderer = {
    domElement: dom,
    getContext: () => ({ isContextLost: () => state.lost }),
    getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: () => {}, autoClear: true,
    render: () => { calls.render++; },
    copyTextureToTexture: () => { calls.copy++; },
    initTexture: () => { calls.init++; },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, state, calls, restore: () => dom.dispatchEvent(new Event('webglcontextrestored')) };
}

describe('context restore subscription', () => {
  it('calls every subscriber after each restore and stops after unsubscribe', () => {
    const { renderer, restore } = fakeRenderer();
    const a = vi.fn(), b = vi.fn();
    const offA = onContextRestored(renderer, a);
    onContextRestored(renderer, b);
    restore();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    restore();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('registers a single DOM listener per renderer', () => {
    const { renderer } = fakeRenderer();
    const add = vi.spyOn(renderer.domElement, 'addEventListener');
    onContextRestored(renderer, () => {});
    onContextRestored(renderer, () => {});
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('lets a callback unsubscribe itself while the restore is being delivered', () => {
    const { renderer, restore } = fakeRenderer();
    const later = vi.fn();
    const off = onContextRestored(renderer, () => off());
    onContextRestored(renderer, later);
    expect(() => restore()).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('RestoreHook follows the renderer it last saw and ignores repeated attaches', () => {
    const one = fakeRenderer(), two = fakeRenderer();
    const callback = vi.fn();
    const hook = new RestoreHook(callback);
    hook.attach(one.renderer);
    hook.attach(one.renderer);
    one.restore();
    expect(callback).toHaveBeenCalledTimes(1);
    hook.attach(two.renderer);
    one.restore();
    expect(callback).toHaveBeenCalledTimes(1);
    two.restore();
    expect(callback).toHaveBeenCalledTimes(2);
    hook.dispose();
    two.restore();
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe('ProceduralCubeMap across a context loss', () => {
  const bake = () => new ProceduralCubeMap(64, 'vec4 bake(vec3 d) { return vec4(d, 1.0); }');

  it('does not count strips drawn while the context is lost', () => {
    const { renderer, state, calls } = fakeRenderer();
    const map = bake();
    expect(map.step(renderer)).toBe(false);
    expect(calls.render).toBe(1);
    state.lost = true;
    for (let i = 0; i < 10; i++) expect(map.step(renderer)).toBe(false);
    expect(calls.render).toBe(1);
    state.lost = false;
    let steps = 0;
    while (!map.step(renderer)) steps++;
    expect(map.done).toBe(true);
    expect(steps).toBeGreaterThan(0);
    map.dispose();
  });

  it('bakes the whole map again after restart', () => {
    const { renderer, calls } = fakeRenderer();
    const map = bake();
    while (!map.step(renderer));
    const first = calls.render;
    expect(map.done).toBe(true);
    map.restart();
    expect(map.done).toBe(false);
    while (!map.step(renderer));
    expect(calls.render - first).toBe(first);
    expect(map.target.scissorTest).toBe(false);
    map.dispose();
  });
});

describe('Earth imagery after a context restore', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('../src/render/planet/imageryDecode'); });

  const manifest = {
    version: 1,
    levels: [{ id: '2k', width: 8, height: 4, tiles: 1, bundled: true, day: 'day-{MM}.webp', water: 'water.webp', night: 'night.webp', clouds: 'clouds.webp' }],
  };

  async function setup() {
    const decoded: string[] = [], released: ImageStrips[] = [], fetched: string[] = [];
    vi.doMock('../src/render/planet/imageryDecode', () => ({
      decodeImagery: async (blob: Blob) => {
        decoded.push(await blob.text());
        return { width: 8, height: 4, strips: [{ y: 0, bitmap: {} }, { y: 2, bitmap: {} }] } as unknown as ImageStrips;
      },
      releaseImagery: (s: ImageStrips) => { released.push(s); },
    }));
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({}));
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      if (url.endsWith('manifest.json')) return Promise.resolve(new Response(JSON.stringify(manifest)));
      return Promise.resolve(new Response(new Blob([url])));
    });
    const { EarthImagery } = await import('../src/render/planet/earthImagery');
    const gl = fakeRenderer();
    const imagery = new EarthImagery({ quality: 'low', nightLights: true, radius: 6e6, clouds: true });
    imagery.update(3);
    const run = async (done: () => boolean) => {
      for (let i = 0; i < 400 && !done(); i++) {
        imagery.step(gl.renderer);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      expect(done()).toBe(true);
    };
    return { imagery, gl, run, decoded, released, fetched };
  }

  it('drops the blank GPU content and streams the level again', async () => {
    const { imagery, run, decoded } = await setup();
    await run(() => imagery.levelId !== null && imagery.cloudSourceSettled && !!imagery.cloudSource);
    expect(imagery.uniforms.uEarthImagery.value).toBe(1);
    const firstDay = imagery.uniforms.uEarthDay.value;
    const decodedBefore = decoded.length;

    imagery.restoreContext();
    expect(imagery.levelId).toBeNull();
    expect(imagery.ready).toBe(false);
    expect(imagery.uniforms.uEarthImagery.value).toBe(0);
    expect(imagery.uniforms.uEarthNightOn.value).toBe(0);
    expect(imagery.uniforms.uEarthDay.value).not.toBe(firstDay);

    await run(() => imagery.levelId === '2k');
    expect(imagery.uniforms.uEarthImagery.value).toBe(1);
    expect(imagery.uniforms.uEarthNightOn.value).toBe(1);
    expect(imagery.uniforms.uEarthDay.value).not.toBe(firstDay);
    // Nothing was retained after the first upload, so the sources are decoded (from cache) again: day, water, night.
    expect(decoded.length - decodedBefore).toBe(3);
    imagery.dispose();
  });

  it('reuses decoded strips that are still held instead of decoding them again', async () => {
    const { imagery, gl, run, decoded, released } = await setup();
    // Run until the GPU jobs exist but have not finished.
    await run(() => gl.calls.init > 0);
    expect(imagery.levelId).toBeNull();
    const decodedBefore = decoded.length;
    expect(decodedBefore).toBeGreaterThanOrEqual(3);

    imagery.restoreContext();
    expect(released).toHaveLength(0); // the held images pass to the new upload instead of being released and fetched again
    await run(() => imagery.levelId === '2k');
    expect(decoded.length).toBe(decodedBefore);
    imagery.dispose();
  });

  it('does no GPU work while the context is lost', async () => {
    const { imagery, gl, run } = await setup();
    await run(() => gl.calls.init > 0);
    gl.state.lost = true;
    const uploads = gl.calls.init + gl.calls.copy + gl.calls.render;
    for (let i = 0; i < 20; i++) imagery.step(gl.renderer);
    expect(gl.calls.init + gl.calls.copy + gl.calls.render).toBe(uploads);
    gl.state.lost = false;
    await run(() => imagery.levelId === '2k');
    imagery.dispose();
  });

  it('uploads the cloud source again for the re-bake', async () => {
    const { imagery, run } = await setup();
    await run(() => !!imagery.cloudSource);
    const first = imagery.cloudSource;
    imagery.reloadClouds();
    expect(imagery.cloudSource).toBeNull();
    expect(imagery.cloudSourceSettled).toBe(false);
    await run(() => !!imagery.cloudSource);
    expect(imagery.cloudSource).not.toBe(first);
    expect(imagery.cloudSourceSettled).toBe(true);
    imagery.dispose();
  });
});

describe('launch-site texture array after a context restore', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('copies every layer again (the layers only ever existed on the GPU)', () => {
    const ctx2d = { setTransform: () => {}, clearRect: () => {}, drawImage: () => {} };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) });
    const { renderer, calls, restore } = fakeRenderer();
    const source = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    const sites = new SiteTextureArray(Object.fromEntries(SITE_LAYERS.map((l) => [l, source])) as Record<(typeof SITE_LAYERS)[number], HTMLCanvasElement>);
    sites.fill(renderer);
    sites.fill(renderer);
    expect(calls).toMatchObject({ init: 1, copy: SITE_LAYERS.length });
    restore();
    expect(sites.ready).toBe(false);
    sites.fill(renderer);
    expect(calls).toMatchObject({ init: 2, copy: 2 * SITE_LAYERS.length });
    sites.dispose();
    restore();
    expect(sites.ready).toBe(true); // a disposed array no longer listens
  });
});


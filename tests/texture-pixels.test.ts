import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeReleasable, releasePixels, uploadedOn, watchPixels } from '../src/render/texturePixels';

/** Stand-in for WebGLRenderer.properties plus three's DataTexture upload bookkeeping. */
function fakeRenderer() {
  const props = new WeakMap<object, Record<string, unknown>>();
  const renderer = { properties: { get: (o: object) => { let p = props.get(o); if (!p) props.set(o, p = {}); return p; } } } as unknown as THREE.WebGLRenderer;
  const upload = (t: THREE.Texture) => {
    const sp = renderer.properties.get(t.source) as { __version?: number };
    if (sp.__version === t.source.version) return null;
    const data = t.source.dataReady ? (t.image as { data: Uint8Array }).data : null; // three skips texSubImage when !dataReady
    sp.__version = t.source.version;
    t.onUpdate?.(t);
    return data;
  };
  return { renderer, upload };
}

describe('dropping uploaded texture pixels', () => {
  it('releases only what the renderer holds, and refills pixels when another upload needs them', async () => {
    const pixels = new Uint8Array(16).fill(7);
    const tex = new THREE.DataTexture(pixels, 2, 2);
    tex.needsUpdate = true;
    let restores = 0;
    makeReleasable(tex, async () => { restores++; return new Uint8Array(16).fill(9); });
    const a = fakeRenderer(), b = fakeRenderer();
    expect(releasePixels(tex, a.renderer)).toBe(0); // not uploaded yet
    expect(a.upload(tex)).toBe(pixels);
    expect(uploadedOn(a.renderer, tex)).toBe(true);
    expect(releasePixels(tex, a.renderer)).toBe(16);
    expect(tex.image.data).toBeNull();
    expect(tex.source.dataReady).toBe(false);
    // A second renderer allocates the texture empty; the pixels come back and every renderer re-uploads them.
    expect(b.upload(tex)).toBeNull();
    expect(b.upload(tex)).toBeNull(); // no second restore while one is pending
    await Promise.resolve(); await Promise.resolve();
    expect(restores).toBe(1);
    expect(Array.from(tex.image.data as Uint8Array)).toEqual(Array(16).fill(9));
    expect(uploadedOn(a.renderer, tex)).toBe(false);
    expect(Array.from(b.upload(tex)!)).toEqual(Array(16).fill(9));
    expect(Array.from(a.upload(tex)!)).toEqual(Array(16).fill(9));
    expect(releasePixels(tex, b.renderer)).toBe(16);
  });

  it('clones sharing the source trigger the refill too', async () => {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    tex.needsUpdate = true;
    makeReleasable(tex, async () => new Uint8Array(16).fill(3));
    const clone = tex.clone();
    watchPixels(clone);
    const a = fakeRenderer();
    a.upload(tex);
    releasePixels(tex, a.renderer);
    const ctxRestored = fakeRenderer(); // a restored context starts with no GPU textures
    expect(ctxRestored.upload(clone)).toBeNull();
    await Promise.resolve(); await Promise.resolve();
    expect((clone.image as { data: Uint8Array }).data[0]).toBe(3);
  });
});

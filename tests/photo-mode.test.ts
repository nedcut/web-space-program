import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PhotoCamera } from '../src/render/core/PhotoCamera';
import type { RenderPipeline } from '../src/render/core/renderer';
import { photoMode } from '../src/game/photoMode';
import { defaultBindings, saveBindings } from '../src/input/bindings';

let photo: PhotoCamera | undefined;
afterEach(() => { photo?.dispose(); photo = undefined; saveBindings(defaultBindings()); vi.unstubAllGlobals(); });
function harness(initialPaused = false, multiplayer = false) {
  const target = new EventTarget(); vi.stubGlobal('window', target);
  const canvas = new EventTarget();
  const camera = new THREE.PerspectiveCamera(60); camera.position.set(0, 0, 20);
  const pipeline = { renderer: { domElement: canvas }, exposure: 1, photoEffects: { enabled: false, uniforms: Object.fromEntries(['dof', 'vignette', 'grain', 'letterbox'].map(k => [k, { value: 0 }])) } };
  let paused = initialPaused, prior = paused;
  photo = new PhotoCamera(pipeline as unknown as RenderPipeline, new THREE.Scene(), camera, () => new THREE.Vector3(), active => {
    if (active) { if (multiplayer) return false; prior = paused; paused = true; } else paused = prior;
    return true;
  });
  const key = (code: string, patch = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...patch });
    target.dispatchEvent(event); return event;
  };
  return { key, camera, pipeline, paused: () => paused };
}
describe('photo input and pause lifecycle', () => {
  it.each([false, true])('restores camera, exposure and previous pause=%s', paused => {
    const h = harness(paused);
    h.key('KeyP'); expect(photoMode.get().active).toBe(true); expect(h.paused()).toBe(true);
    photoMode.set({ fov: 35, exposure: 2 }); photo!.update(0.1);
    expect(h.camera.fov).toBe(35); expect(h.pipeline.exposure).toBe(2);
    h.key('Escape'); expect(photoMode.get().active).toBe(false); expect(h.paused()).toBe(paused);
    expect(h.camera.fov).toBe(60); expect(h.pipeline.exposure).toBe(1);
  });
  it('honors rebound photo/menu keys, leaves old keys and Ctrl+P available', () => {
    const h = harness(); saveBindings({ ...defaultBindings(), photoMode: ['KeyO'], menu: ['F2'] });
    expect(h.key('KeyP').defaultPrevented).toBe(false); expect(photoMode.get().active).toBe(false);
    expect(h.key('KeyO', { ctrlKey: true }).defaultPrevented).toBe(false);
    h.key('KeyO'); expect(photoMode.get().active).toBe(true);
    h.key('F2'); expect(photoMode.get().active).toBe(false);
  });
  it('refuses photo entry in multiplayer and unregisters on scene disposal', () => {
    const h = harness(false, true); h.key('KeyP');
    expect(photoMode.get().active).toBe(false); expect(h.paused()).toBe(false);
    photo!.dispose(); photo = undefined; expect(photoMode.get().available).toBe(false);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import type { PartDef } from '../src/sim/vessel/types';

const mocks = vi.hoisted(() => ({ build: vi.fn(), ready: vi.fn(), gl: { lost: false }, canvases: [] as EventTarget[] }));
vi.mock('../src/editor/scene/partMesh', () => ({ createPartMesh: mocks.build }));
vi.mock('../src/render/parts/textures', () => ({ partTexturesReady: mocks.ready }));
vi.mock('../src/render/core/studioEnv', () => ({
  createStudioEnvironment: () => ({ texture: null, dispose() {} }),
  StudioEnvironment: class { target = { texture: null, dispose() {} }; dispose() {} },
}));
vi.mock('../src/editor/scene/thumbnailCache', () => ({
  cachedThumbnail: () => undefined, persistThumbnail: async () => {}, preloadThumbnails: async () => {},
}));
vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    debug = { checkShaderErrors: true };
    domElement = Object.assign(new EventTarget(), { toBlob: (cb: (b: Blob) => void) => cb(new Blob()) });
    constructor() { mocks.canvases.push(this.domElement); }
    setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => mocks.gl.lost }; }
    compileAsync() { return mocks.gl.lost ? Promise.reject(new Error('lost')) : Promise.resolve(); }
  }
  return { ...THREE, WebGLRenderer: FakeRenderer };
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('does not build the catalogue on entry, builds one thumbnail per idle slice, and suspends when leaving', async () => {
  vi.resetModules();
  const idle: IdleRequestCallback[] = [];
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => idle.push(cb));
  vi.stubGlobal('document', { createElement: () => ({}), addEventListener() {} });
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  mocks.ready.mockReturnValue(new Promise<void>(() => {}));
  const THREE = await import('three');
  mocks.build.mockImplementation(() => new THREE.Object3D());
  const { requestThumbnails, subscribeThumbnails } = await import('../src/editor/scene/thumbnails');
  const slice = async () => {  const cb = idle.shift()!; cb({ didTimeout: false, timeRemaining: () => 50 }); await new Promise(r => setTimeout(r, 0)); };

  const leave = subscribeThumbnails(() => {});
  requestThumbnails(Array.from({ length: 300 }, (_, i) => ({ id: `part-${i}`, attachNodes: [] }) as unknown as PartDef));
  expect(mocks.build).not.toHaveBeenCalled();
  await new Promise(r => setTimeout(r, 0)); // preload resolves, first slice is queued
  expect(idle).toHaveLength(1);
  await slice();
  expect(mocks.build).toHaveBeenCalledTimes(1);

  leave();
  while (idle.length) await slice();
  expect(mocks.build).toHaveBeenCalledTimes(1); // no work while the palette is gone

  const back = subscribeThumbnails(() => {});
  await new Promise(r => setTimeout(r, 0));
  expect(idle.length).toBeGreaterThan(0); // queued work resumes when the palette returns
  await slice();
  expect(mocks.build).toHaveBeenCalledTimes(2);
  back();
});

it('retries thumbnails that failed while the context was lost once it is restored', async () => {
  vi.resetModules();
  const idle: IdleRequestCallback[] = [];
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => idle.push(cb));
  vi.stubGlobal('document', { createElement: () => ({}), addEventListener() {} });
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  mocks.ready.mockReturnValue(new Promise<void>(() => {}));
  mocks.gl.lost = false;
  const THREE = await import('three');
  mocks.build.mockImplementation(() => new THREE.Object3D());
  const { getThumbnail, requestThumbnails, subscribeThumbnails } = await import('../src/editor/scene/thumbnails');
  const slice = async () => { const cb = idle.shift()!; cb({ didTimeout: false, timeRemaining: () => 50 }); await new Promise(r => setTimeout(r, 0)); };

  const leave = subscribeThumbnails(() => {});
  requestThumbnails(['a', 'b'].map((id) => ({ id, attachNodes: [] }) as unknown as PartDef));
  await new Promise(r => setTimeout(r, 0));
  await slice();
  expect(getThumbnail('a')).toBe('blob:x');

  mocks.gl.lost = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await slice();
  expect(getThumbnail('b')).toBeUndefined(); // not cached as a failure
  expect(idle).toHaveLength(0); // paused while lost

  mocks.gl.lost = false;
  mocks.canvases.at(-1)!.dispatchEvent(new Event('webglcontextrestored'));
  await new Promise(r => setTimeout(r, 0));
  expect(idle.length).toBeGreaterThan(0);
  await slice();
  expect(getThumbnail('b')).toBe('blob:x');
  leave();
});

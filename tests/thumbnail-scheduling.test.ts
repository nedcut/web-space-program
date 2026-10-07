import { afterEach, expect, it, vi } from 'vitest';
import type { PartDef } from '../src/sim/vessel/types';

const mocks = vi.hoisted(() => ({ build: vi.fn(), ready: vi.fn() }));
vi.mock('../src/editor/scene/partMesh', () => ({ createPartMesh: mocks.build }));
vi.mock('../src/render/parts/textures', () => ({ partTexturesReady: mocks.ready }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('does not build the catalogue on entry and suspends pending thumbnail work when leaving', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  let texturesReady!: () => void;
  mocks.ready.mockReturnValue(new Promise<void>(resolve => { texturesReady = resolve; }));
  const { requestThumbnails, subscribeThumbnails } = await import('../src/editor/scene/thumbnails');
  const leave = subscribeThumbnails(() => {});
  requestThumbnails(Array.from({ length: 300 }, (_, i) => ({ id: `part-${i}` }) as PartDef));
  expect(mocks.build).not.toHaveBeenCalled();
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(mocks.build).toHaveBeenCalledTimes(1);
  leave();
  texturesReady();
  await vi.runAllTimersAsync();
  expect(mocks.build).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(0);
  const leaveAgain = subscribeThumbnails(() => {});
  expect(frames).toHaveLength(1); // queued work resumes when the palette returns
  leaveAgain();
  frames.shift()!(1);
  expect(mocks.build).toHaveBeenCalledTimes(1);
});

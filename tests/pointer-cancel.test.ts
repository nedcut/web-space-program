// Canvas pointer gestures end cleanly when the browser cancels a touch, and a second finger never takes over the
// first one's drag. Mouse behaviour is unchanged. Node has no PointerEvent, so events are plain Events with fields.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FlightCamera, type CameraFrame } from '../src/flight/camera';

vi.mock('../src/render/core/studioEnv', () => ({
  createStudioEnvironment: () => ({ texture: null, dispose() {} }),
  StudioEnvironment: class { target = { texture: null, dispose() {} }; dispose() {} },
}));
vi.mock('../src/editor/scene/hangar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/editor/scene/hangar')>();
  const THREE = await import('three');
  return { ...real, buildHangar: () => ({ group: new THREE.Group(), bakeReflections() {}, setFootprint() {}, dispose() {} }) };
});
vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    debug = { checkShaderErrors: true };
    shadowMap = { enabled: false, type: 0, autoUpdate: false, needsUpdate: false };
    info = { render: { calls: 0, triangles: 0 }, memory: {}, programs: [] };
    domElement = fakeCanvas();
    setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {} forceContextLoss() {}
    getContext() { return { isContextLost: () => false, getParameter: () => 4096, MAX_TEXTURE_SIZE: 0, MAX_RENDERBUFFER_SIZE: 0 }; }
  }
  return { ...THREE, WebGLRenderer: FakeRenderer };
});

function fakeCanvas() {
  return Object.assign(new EventTarget(), {
    style: {} as Record<string, string>, clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {}, releasePointerCapture() {}, remove() {},
  });
}

type PointerInit = { id?: number; type?: 'mouse' | 'touch'; primary?: boolean; button?: number; x?: number; y?: number; alt?: boolean };
function pe(kind: string, o: PointerInit = {}): PointerEvent {
  return Object.assign(new Event(kind, { cancelable: true }), {
    pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', isPrimary: o.primary ?? true, button: o.button ?? 0,
    clientX: o.x ?? 0, clientY: o.y ?? 0, altKey: o.alt ?? false, shiftKey: false, ctrlKey: false, metaKey: false,
  }) as unknown as PointerEvent;
}
const touch = (id: number, x: number, y: number, primary = id === 1): PointerInit => ({ id, type: 'touch', primary, x, y });

function stubWindow() {
  // Delegate timers at call time so vi.useFakeTimers() applies.
  const win = Object.assign(new EventTarget(), {
    devicePixelRatio: 1,
    setTimeout: (cb: () => void, ms?: number) => setTimeout(cb, ms),
    clearTimeout: (id?: number) => clearTimeout(id),
  });
  vi.stubGlobal('window', win);
  return win;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------- editor
type EditorInternals = { gYaw: number; altDown: boolean; shiftDown: boolean; partOnlyDown: boolean; gizmoDrag: object | null };
async function editorHarness() {
  const win = stubWindow();
  vi.stubGlobal('document', { createElement: () => ({ style: {}, remove() {} }), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const { EditorView } = await import('../src/editor/scene/EditorView');
  const { EditorSession } = await import('../src/editor/session');
  const proto = EditorView.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const click = vi.spyOn(proto, 'click').mockImplementation(() => {});
  vi.spyOn(proto, 'pickPart').mockReturnValue({ uid: 1 });
  const session = new EditorSession();
  const openPanel = vi.spyOn(session, 'openPanel').mockImplementation(() => {});
  const container = { clientWidth: 800, clientHeight: 600, appendChild() {} } as unknown as HTMLElement;
  const view = new EditorView(container, session);
  const canvas = (view as unknown as { renderer: { domElement: EventTarget } }).renderer.domElement;
  const fire = (kind: string, o?: PointerInit) => canvas.dispatchEvent(pe(kind, o));
  return { view, win, fire, click, openPanel, proto, internals: view as unknown as EditorInternals };
}

describe('editor canvas pointer gestures', () => {
  it('a cancelled touch ends the drag: hover tooltips come back and hovering does not orbit', async () => {
    const h = await editorHarness();
    h.fire('pointerdown', touch(1, 100, 100));
    h.fire('pointermove', touch(1, 130, 100));
    h.fire('pointercancel', touch(1, 130, 100));
    const yaw = h.internals.gYaw;
    h.fire('pointermove', { id: 2, x: 300, y: 200 }); // mouse hover afterwards
    h.fire('pointermove', { id: 2, x: 340, y: 200 });
    expect(h.internals.gYaw).toBe(yaw);
    expect(h.view.pointer()).toEqual({ x: 340, y: 200 });
  });

  it('a cancelled touch does not fire the long-press part panel', async () => {
    vi.useFakeTimers();
    const h = await editorHarness();
    h.fire('pointerdown', touch(1, 100, 100));
    h.fire('pointercancel', touch(1, 100, 100));
    vi.advanceTimersByTime(1000);
    expect(h.openPanel).not.toHaveBeenCalled();
    // The long-press itself still works.
    h.fire('pointerdown', touch(1, 100, 100));
    vi.advanceTimersByTime(600);
    expect(h.openPanel).toHaveBeenCalledWith(1);
  });

  it('losing pointer capture before release ends the gesture without a click', async () => {
    const h = await editorHarness();
    h.fire('pointerdown', { x: 100, y: 100 });
    h.fire('lostpointercapture', { x: 100, y: 100 });
    h.fire('pointerup', { x: 100, y: 100 });
    expect(h.click).not.toHaveBeenCalled();
  });

  it('a cancelled gizmo drag is reverted, not committed', async () => {
    const h = await editorHarness();
    vi.spyOn(h.proto, 'startGizmoDrag').mockImplementation(function (this: EditorInternals) { this.gizmoDrag = {}; return true; });
    const end = vi.spyOn(h.proto, 'endGizmoDrag').mockImplementation(function (this: EditorInternals) { this.gizmoDrag = null; });
    h.fire('pointerdown', touch(1, 100, 100));
    h.fire('pointercancel', touch(1, 100, 100));
    expect(end).toHaveBeenCalledWith(false);
    expect(h.internals.gizmoDrag).toBeNull();
  });

  it('a second finger neither takes over the orbit nor clicks', async () => {
    const h = await editorHarness();
    h.fire('pointerdown', touch(1, 100, 100));
    h.fire('pointermove', touch(1, 110, 100)); // past the 4 px threshold: now orbiting
    const yaw = h.internals.gYaw;
    h.fire('pointerdown', touch(2, 400, 300));
    h.fire('pointermove', touch(1, 120, 100));
    expect(h.internals.gYaw).toBeCloseTo(yaw - 10 * 0.006, 9);
    h.fire('pointerup', touch(2, 400, 300));
    expect(h.click).not.toHaveBeenCalled();
    h.fire('pointermove', touch(1, 130, 100)); // finger 1 still owns the gesture
    expect(h.internals.gYaw).toBeCloseTo(yaw - 20 * 0.006, 9);
  });

  it('a second finger cancels the pending long-press', async () => {
    vi.useFakeTimers();
    const h = await editorHarness();
    h.fire('pointerdown', touch(1, 100, 100));
    h.fire('pointerdown', touch(2, 400, 300));
    vi.advanceTimersByTime(1000);
    expect(h.openPanel).not.toHaveBeenCalled();
  });

  it('window blur clears held modifiers', async () => {
    const h = await editorHarness();
    h.fire('pointermove', { x: 10, y: 10, alt: true });
    expect(h.internals.altDown).toBe(true);
    h.win.dispatchEvent(new Event('blur'));
    expect(h.internals.altDown).toBe(false);
  });

  it('window blur mid-drag ends the gesture: no click, hovering does not orbit', async () => {
    const h = await editorHarness();
    h.fire('pointerdown', { x: 100, y: 100 });
    h.fire('pointermove', { x: 120, y: 100 });
    h.win.dispatchEvent(new Event('blur'));
    const yaw = h.internals.gYaw;
    h.fire('pointermove', { x: 200, y: 100 });
    h.fire('pointerup', { x: 200, y: 100 });
    expect(h.internals.gYaw).toBe(yaw);
    expect(h.click).not.toHaveBeenCalled();
  });

  it('mouse: drag orbits without a click, a still press clicks', async () => {
    const h = await editorHarness();
    const yaw = h.internals.gYaw;
    h.fire('pointerdown', { x: 100, y: 100 });
    h.fire('pointermove', { x: 150, y: 100 });
    h.fire('pointerup', { x: 150, y: 100 });
    expect(h.internals.gYaw).toBeCloseTo(yaw - 50 * 0.006, 9);
    expect(h.click).not.toHaveBeenCalled();
    h.fire('pointerdown', { x: 100, y: 100 });
    h.fire('pointerup', { x: 100, y: 100 });
    expect(h.click).toHaveBeenCalledTimes(1);
    expect(h.view.pointer()).toEqual({ x: 100, y: 100 });
  });
});

// ---------------------------------------------------------------- flight camera
type CameraInternals = { tYaw: number; yawVel: number };
const frame = (): CameraFrame => ({ up: new THREE.Vector3(0, 0, 1), vesselQuat: new THREE.Quaternion(), velocity: new THREE.Vector3(100, 0, 0), spaceBlend: 0, vesselId: 'a', radius: 5 });
function cameraHarness() {
  const win = stubWindow();
  const el = fakeCanvas();
  const cam = new FlightCamera();
  cam.update(frame(), 1 / 60);
  const detach = cam.attach(el as unknown as HTMLElement);
  const fire = (target: EventTarget, kind: string, o?: PointerInit) => target.dispatchEvent(pe(kind, o));
  return { cam, detach, down: (o: PointerInit) => fire(el, 'pointerdown', o), win: (kind: string, o: PointerInit) => fire(win, kind, o), internals: cam as unknown as CameraInternals };
}

describe('flight camera pointer drag', () => {
  it('a cancelled touch stops the drag and does not fling', () => {
    const h = cameraHarness();
    h.down(touch(1, 100, 100));
    h.win('pointermove', touch(1, 140, 100));
    h.win('pointercancel', touch(1, 140, 100));
    const yaw = h.internals.tYaw;
    expect(h.internals.yawVel).toBe(0);
    h.win('pointermove', { id: 2, x: 300, y: 100 }); // a later mouse hover must not orbit
    h.win('pointermove', { id: 2, x: 400, y: 100 });
    expect(h.internals.tYaw).toBe(yaw);
    h.detach();
  });

  it('a second finger does not take over the drag', () => {
    const h = cameraHarness();
    h.down(touch(1, 100, 100));
    const yaw = h.internals.tYaw;
    h.down(touch(2, 400, 100));
    h.win('pointermove', touch(2, 420, 100));
    h.win('pointermove', touch(1, 110, 100));
    expect(h.internals.tYaw).toBeCloseTo(yaw + 10 * 0.005, 9);
    h.win('pointerup', touch(2, 420, 100)); // lifting finger 2 leaves finger 1 dragging
    h.win('pointermove', touch(1, 120, 100));
    expect(h.internals.tYaw).toBeCloseTo(yaw + 20 * 0.005, 9);
    h.detach();
  });

  it('window blur mid-drag stops the drag without a fling', () => {
    const h = cameraHarness();
    h.down({ button: 2, x: 100, y: 100 });
    h.win('pointermove', { x: 140, y: 100 });
    h.win('blur', {});
    const yaw = h.internals.tYaw;
    expect(h.internals.yawVel).toBe(0);
    h.win('pointermove', { x: 300, y: 100 }); // hover after refocus, button long released
    expect(h.internals.tYaw).toBe(yaw);
    h.detach();
  });

  it('mouse: drag orbits and a quick release flings', () => {
    const h = cameraHarness();
    const yaw = h.internals.tYaw;
    h.down({ button: 2, x: 100, y: 100 });
    h.win('pointermove', { x: 160, y: 100 });
    h.win('pointerup', { button: 2, x: 160, y: 100 });
    expect(h.internals.tYaw).toBeCloseTo(yaw + 60 * 0.005, 9);
    expect(h.internals.yawVel).toBeGreaterThan(0);
    h.win('pointermove', { x: 300, y: 100 }); // hover after release
    expect(h.internals.tYaw).toBeCloseTo(yaw + 60 * 0.005, 9);
    h.detach();
  });
});

// ---------------------------------------------------------------- flight part pick
async function partPickHarness() {
  const win = stubWindow();
  const { FlightController } = await import('../src/flight/controller');
  const el = fakeCanvas();
  const picked: number[] = [];
  const at: { x: number; y: number }[] = [];
  const fake = {
    paused: false, photo: { active: false },
    pickPart: (x: number, y: number) => { at.push({ x, y }); return 7; },
    partPickListeners: new Set([(uid: number) => picked.push(uid)]),
  };
  const attach = (FlightController.prototype as unknown as { attachPartPicking(el: unknown): () => void }).attachPartPicking;
  const detach = attach.call(fake, el);
  const fire = (target: EventTarget, kind: string, o?: PointerInit) => target.dispatchEvent(pe(kind, o));
  return { picked, at, detach, down: (o: PointerInit) => fire(el, 'pointerdown', o), win: (kind: string, o: PointerInit) => fire(win, kind, o) };
}

describe('flight part pick (right-click / long-press)', () => {
  it('a cancelled touch does not long-press pick', async () => {
    vi.useFakeTimers();
    const h = await partPickHarness();
    h.down(touch(1, 100, 100));
    h.win('pointercancel', touch(1, 100, 100));
    vi.advanceTimersByTime(1000);
    expect(h.picked).toEqual([]);
    h.detach();
  });

  it('a second finger is a multi-touch gesture, not a long-press', async () => {
    vi.useFakeTimers();
    const h = await partPickHarness();
    h.down(touch(1, 100, 100));
    h.down(touch(2, 400, 300));
    vi.advanceTimersByTime(1000);
    expect(h.picked).toEqual([]);
    h.detach();
  });

  it('window blur drops a pending pick', async () => {
    vi.useFakeTimers();
    const h = await partPickHarness();
    h.down(touch(1, 100, 100));
    h.win('blur', {});
    vi.advanceTimersByTime(1000);
    h.down({ button: 2, x: 200, y: 50 });
    h.win('blur', {});
    h.win('pointerup', { button: 2, x: 200, y: 50 });
    expect(h.picked).toEqual([]);
    h.detach();
  });

  it('a still touch long-presses and a still right-click picks', async () => {
    vi.useFakeTimers();
    const h = await partPickHarness();
    h.down(touch(1, 100, 100));
    vi.advanceTimersByTime(600);
    h.win('pointerup', touch(1, 100, 100));
    h.down({ button: 2, x: 200, y: 50 });
    h.win('pointerup', { button: 2, x: 200, y: 50 });
    expect(h.picked).toEqual([7, 7]);
    expect(h.at).toEqual([{ x: 100, y: 100 }, { x: 200, y: 50 }]);
    h.detach();
  });
});

import { FlightInput } from '../src/flight/input';
import { game } from '../src/game/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS_KEY, conflicts, defaultBindings, getBindings, loadBindings, saveBindings, matches, isTyping, bindingText } from '../src/input/bindings';
import { deadZone, mapGamepad } from '../src/input/gamepad';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
};
afterEach(() => saveBindings(defaultBindings(), memory()));
describe('action bindings', () => {
  it('preserves the familiar defaults and returns independent copies', () => {
    const a = defaultBindings(); a.stage.push('KeyP');
    expect(defaultBindings().stage).toEqual(['Space']);
    expect(defaultBindings().throttleDown).toEqual(['ControlLeft', 'ControlRight']);
    expect(defaultBindings().precision).toEqual(['CapsLock']);
  });
  it('detects conflicts only within an input context', () => {
    const a = defaultBindings(); a.map = ['Space'];
    expect(conflicts(a)).toContainEqual({ key: 'Space', actions: ['stage', 'map'] });
    expect(conflicts(a).some(c => c.actions.includes('editorReset'))).toBe(false);
    a.board = ['Space'];
    expect(conflicts(a)).toContainEqual({ key: 'Space', actions: ['stage', 'map', 'board'] });
  });
  it('persists chords, alternate keys, and explicitly unbound actions', () => {
    const storage = memory();
    const a = defaultBindings(); a.stage = ['KeyP']; a.throttleDown = ['Minus']; a.editorUndo = ['Alt+KeyZ']; a.quicksave = [];
    saveBindings(a, storage);
    expect(loadBindings(storage)).toEqual(a);
    a.stage.push('KeyO');
    expect(getBindings().stage).toEqual(['KeyP']);
  });
  it('migrates partial saves and rejects malformed entries', () => {
    const storage = memory(); storage.setItem(BINDINGS_KEY, JSON.stringify({ stage: ['KeyP'], map: 7, brakes: [null], extra: ['KeyO'] }));
    expect(loadBindings(storage).stage).toEqual(['KeyP']);
    expect(loadBindings(storage).map).toEqual(['KeyM']);
    expect(loadBindings(storage).photoMode).toEqual(['KeyP']);
    expect(loadBindings(storage).stressOverlay).toEqual(['F4']);
    expect(conflicts(loadBindings(storage)).some(c => c.actions.includes('photoMode') && c.actions.includes('stage'))).toBe(true);
    expect(loadBindings(storage).brakes).toEqual(['KeyB']);
    storage.setItem(BINDINGS_KEY, '{'); expect(loadBindings(storage)).toEqual(defaultBindings());
    expect(loadBindings({ getItem: () => { throw new Error('blocked'); } })).toEqual(defaultBindings());
  });
});
const pad = (axes: number[], pressed: Record<number, number> = {}) => ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: pressed[i] ?? 0, pressed: (pressed[i] ?? 0) > 0.5, touched: false })) });
describe('standard gamepad mapping', () => {
  it('removes drift, rescales continuously and clamps sensitivity', () => {
    expect(deadZone(0.1, 0.15)).toBe(0);
    expect(deadZone(-0.15, 0.15)).toBeCloseTo(0);
    expect(deadZone(0.575, 0.15)).toBeCloseTo(0.5);
    expect(deadZone(-0.575, 0.15)).toBeCloseTo(-0.5);
    expect(deadZone(1, 0.15, 2)).toBe(1);
    expect(deadZone(NaN)).toBe(0);
  });
  it('maps sticks to attitude and triggers to throttle', () => {
    const result = mapGamepad(pad([1, -1, 0.5, 1], { 7: 0.8, 6: 0.2 }), 0, 1);
    expect(result).toMatchObject({ pitch: -1, yaw: 1, roll: 0.5, tx: 0, ty: 0, tz: 0 });
    expect(result.throttle).toBeCloseTo(0.6);
  });
  it('switches to translation with LB and automatically on EVA', () => {
    for (const eva of [false, true]) {
      const result = mapGamepad(pad([1, -1, 0, 0.5], eva ? { 10: 1 } : { 4: 1 }), 0, 1, eva);
      expect(result).toMatchObject({ pitch: 0, yaw: 0, roll: 0, tx: 1, ty: -0.5, tz: -1 });
      expect(result.run).toBe(eva);
    }
  });
  it('handles incomplete axes and buttons safely', () => {
    expect(mapGamepad(pad([]), 0.15, 1)).toMatchObject({ pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 });
  });
});


describe('keyboard matching', () => {
  const key = (code: string, modifiers = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;
  it('matches modifier chords on Ctrl and Command without firing a plain shortcut', () => {
    expect(matches('editorUndo', key('KeyZ', { ctrlKey: true }))).toBe(true);
    expect(matches('editorUndo', key('KeyZ', { metaKey: true }))).toBe(true);
    expect(matches('editorUndo', key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches('editorRedo', key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('editorPitchUp', key('KeyW', { ctrlKey: true }))).toBe(false);
    expect(matches('throttleDown', key('ControlLeft', { ctrlKey: true }))).toBe(true);
    saveBindings({ ...defaultBindings(), editorFrame: ['Alt+KeyP'] }, memory());
    expect(matches('editorFrame', key('KeyP', { altKey: true }))).toBe(true);
  });
  it('renders lesson instructions from current bindings, including unbound actions', () => {
    const bindings = { ...defaultBindings(), stage: ['KeyP'], map: [], throttleUp: ['Equal'] };
    expect(bindingText('Press {stage}; hold {throttleUp}; map {map}.', bindings)).toBe('Press P; hold Equal; map Unbound.');
  });
  it('blocks editable fields and the settings modal', () => {
    class ElementDouble { constructor(private editable: boolean) {} closest() { return this.editable ? this : null; } }
    vi.stubGlobal('HTMLElement', ElementDouble);
    try {
      expect(isTyping(new ElementDouble(true) as unknown as EventTarget)).toBe(true);
      expect(isTyping(new ElementDouble(false) as unknown as EventTarget)).toBe(false);
      expect(isTyping(null)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('flight gamepad actions', () => {
  const harness = () => {
    let current = { ...pad([]), index: 0, connected: true, mapping: 'standard' };
    const target = Object.assign(new EventTarget(), {
      document: { hasFocus: () => true, activeElement: null },
      navigator: { getGamepads: () => [current] },
    });
    const input = new FlightInput(target as unknown as Window);
    const actions: string[] = [];
    input.onAction(a => actions.push(a));
    const buttons = (pressed: Record<number, number>) => { current = { ...current, ...pad([], pressed) }; };
    return { input, actions, target, buttons, disconnect: () => { current.connected = false; } };
  };
  it('requires a sustained hold, emits once, and latches held buttons on reconnect', () => {
    const h = harness();
    try {
      h.input.update(0.1);
      h.buttons({ 0: 1 });
      h.input.update(0.5);
      expect(h.actions).toEqual([]);
      expect(h.input.stageProgress).toBeCloseTo(2 / 3);
      h.input.update(0.3); h.input.update(1);
      expect(h.actions).toEqual(['stage']);
      h.buttons({}); h.input.update(0.1);
      h.buttons({ 0: 1 }); h.input.update(0.8);
      expect(h.actions).toEqual(['stage', 'stage']);
      h.target.dispatchEvent(new Event('blur'));
      h.input.update(1);
      expect(h.actions).toEqual(['stage', 'stage']);
      h.disconnect(); h.input.update(1);
      expect(h.input.gamepadConnected).toBe(false);
      expect(h.input.stageProgress).toBe(0);
    } finally { h.input.dispose(); }
  });
  it('maps EVA boarding and run, and pauses/resumes on Start without staging', () => {
    const h = harness();
    try {
      h.input.evaMode = true; h.input.update(0.1);
      h.buttons({ 1: 1, 10: 1 }); h.input.update(0.1);
      expect(h.actions).toEqual(['board']); expect(h.input.running).toBe(true);
      h.buttons({ 9: 1 }); h.input.update(0.1);
      expect(h.actions.at(-1)).toBe('menu');
      h.input.enabled = false; h.input.update(0.1);
      expect(h.actions.filter(a => a === 'menu')).toHaveLength(1);
      h.buttons({}); h.input.update(0.1);
      h.buttons({ 9: 1, 0: 1 }); h.input.update(1);
      expect(h.actions.filter(a => a === 'menu')).toHaveLength(2);
      expect(h.actions).not.toContain('stage');
      expect(h.input.running).toBe(false);
    } finally { h.input.dispose(); }
  });
  it('routes rebound EVA, boarding, flag, gear and brake controls', () => {
    const h = harness(); const settings = game.get().settings;
    const key = (code: string) => h.target.dispatchEvent(Object.assign(new Event('keydown'), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false } });
      saveBindings({ ...defaultBindings(), eva: ['KeyY'], board: ['KeyC'], plantFlag: ['F8'], toggleGear: ['KeyO'], brakes: ['KeyP'] }, memory());
      key('KeyO'); key('KeyY'); key('KeyP'); h.input.update(0.1);
      expect(h.actions).toEqual(['toggleGear', 'eva']); expect(h.input.state.brakes).toBe(true);
      h.input.evaMode = true; key('KeyC'); key('F8');
      expect(h.actions.slice(-2)).toEqual(['board', 'plantFlag']);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('keeps map dragging out of optional mouse-flight attitude controls', () => {
    const h = harness(); const settings = game.get().settings;
    class CanvasDouble {}
    vi.stubGlobal('HTMLCanvasElement', CanvasDouble);
    try {
      game.set({ settings: { ...settings, mouseFlight: true, gamepadEnabled: false, inputSmoothing: 0, invertPitch: false } });
      const move = new Event('pointermove');
      Object.defineProperty(move, 'target', { value: new CanvasDouble() });
      Object.assign(move, { buttons: 1, movementX: 30, movementY: 20 });
      h.target.dispatchEvent(move); h.input.update(0.1);
      expect(h.input.state.yaw).toBeCloseTo(0.3);
      h.input.mouseEnabled = false; h.input.update(0.1);
      expect(h.input.state.yaw).toBe(0); expect(h.input.state.pitch).toBe(0);
      h.target.dispatchEvent(move); h.input.mouseEnabled = true; h.input.update(0.1);
      expect(h.input.state.yaw).toBe(0);
    } finally { h.input.dispose(); game.set({ settings }); vi.unstubAllGlobals(); }
  });
  it('applies pitch inversion changes live while preserving simultaneous throttle and attitude', () => {
    const h = harness(); const settings = game.get().settings;
    const key = (code: string, ctrlKey = false) => h.target.dispatchEvent(Object.assign(new Event('keydown'), { code, ctrlKey, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    try {
      game.set({ settings: { ...settings, invertPitch: true, gamepadEnabled: false, inputSmoothing: 0 } });
      key('KeyW'); h.input.update(0.1); expect(h.input.state.pitch).toBe(1);
      game.set({ settings: { ...game.get().settings, invertPitch: false } });
      h.input.update(0.1); expect(h.input.state.pitch).toBe(-1);
      key('ControlLeft', true); h.input.update(0.1);
      expect(h.input.state.pitch).toBe(-1);
      saveBindings({ ...defaultBindings(), pitchUp: ['Ctrl+KeyW'] }, memory());
      h.input.update(0.1); expect(h.input.state.pitch).toBe(-1);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('uses rebound continuous keys and clears them while paused', () => {
    const h = harness(); const settings = game.get().settings;
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0 } });
      saveBindings({ ...defaultBindings(), pitchUp: ['KeyP'] }, memory());
      h.target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyP', ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
      h.input.update(0.1); expect(h.input.state.pitch).toBe(-1);
      h.input.precision = true; h.input.update(0.1); expect(h.input.state.pitch).toBe(-0.35);
      h.input.enabled = false; h.input.update(0.1); expect(h.input.state.pitch).toBe(0);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
});

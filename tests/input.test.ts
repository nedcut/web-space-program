import { FlightInput } from '../src/flight/input';
import { game } from '../src/game/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS_KEY, conflicts, defaultBindings, getBindings, loadBindings, saveBindings, matches, isTyping, bindingText, bindingLabel, TYPING_SELECTOR } from '../src/input/bindings';
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
    expect(conflicts(a)).toContainEqual({ key: 'Space', actions: ['map', 'evaJump'] });
    expect(conflicts(a).some(c => c.actions.includes('editorReset'))).toBe(false);
    a.board = ['Space'];
    expect(conflicts(a)).toContainEqual({ key: 'Space', actions: ['map', 'board', 'evaJump'] });
  });
  it('gives Space to staging in flight and to jumping on EVA, never both', () => {
    const b = defaultBindings();
    expect(b.stage).toEqual(['Space']);
    expect(b.evaJump).toEqual(['Space']);
    expect(conflicts(b).some(c => c.key === 'Space')).toBe(false);
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
describe('classic flight layout (bindings layout 2)', () => {
  const key = (code: string, modifiers = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;
  it('uses the genre-standard defaults', () => {
    const b = defaultBindings();
    expect(b.toggleLights).toEqual(['KeyU']);
    expect(b.eva).toEqual(['KeyO']);
    expect('iva' in b).toBe(false); // Unimplemented cabin view is not exposed as a bindable action.
    expect(b.screenshot).toEqual(['F1']);
    expect(b.hideUi).toEqual(['F2']);
    expect(b.flightResults).toEqual(['F3']);
    expect(b.help).toEqual(['Shift+F1']);
    expect(b.stageLock).toEqual(['Alt+KeyL']);
    expect(b.sasHold).toEqual(['KeyF']);
    expect(b.focusPrev).toEqual(['BracketLeft']);
    expect(b.focusNext).toEqual(['BracketRight']);
    // Only the documented, intentional EVA Shift sharing remains.
    expect(conflicts(b).every(c => c.actions.every(a => a === 'evaUp' || a === 'evaRun'))).toBe(true);
  });
  it('moves untouched layout-1 defaults and keeps customised keys', () => {
    const storage = memory();
    storage.setItem(BINDINGS_KEY, JSON.stringify({ ...defaultBindings(), help: ['F1'], flightData: ['F3'], eva: ['KeyU'], toggleLights: ['KeyC'], stage: ['KeyP'] }));
    const b = loadBindings(storage);
    expect([b.help, b.flightData, b.eva, b.toggleLights, b.stage]).toEqual([['Shift+F1'], ['Shift+F3'], ['KeyO'], ['KeyU'], ['KeyP']]);
  });
  it('keeps an old default when the new key is already taken, and never migrates a layout-2 save', () => {
    const storage = memory();
    storage.setItem(BINDINGS_KEY, JSON.stringify({ ...defaultBindings(), eva: ['KeyU'], toggleLights: ['KeyC'], toggleGear: ['KeyO'] }));
    const b = loadBindings(storage);
    expect(b.eva).toEqual(['KeyU']);
    expect(b.toggleLights).toEqual(['KeyC']);
    saveBindings({ ...defaultBindings(), help: ['F1'] }, storage);
    expect(loadBindings(storage).help).toEqual(['F1']);
  });
  it('fires a modifier chord without also firing the plain key, but keeps plain keys under a held modifier', () => {
    expect(matches('help', key('F1', { shiftKey: true }))).toBe(true);
    expect(matches('screenshot', key('F1', { shiftKey: true }))).toBe(false);
    expect(matches('screenshot', key('F1'))).toBe(true);
    expect(matches('stageLock', key('KeyL', { altKey: true }))).toBe(true);
    expect(matches('translateRight', key('KeyL', { altKey: true }))).toBe(false);
    expect(matches('stage', key('Space', { shiftKey: true }))).toBe(true);
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
  it('boards from either Enter key (some keyboards and drivers report the keypad code)', () => {
    expect(matches('board', key('Enter'))).toBe(true);
    expect(matches('board', key('NumpadEnter'))).toBe(true);
    expect(bindingLabel('board', defaultBindings())).toBe('Enter');
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
  it('lets switches, sliders and buttons keep the keyboard for game controls', () => {
    // A focused part-menu switch (e.g. gimbal lock) used to count as typing and silently disabled every flight key.
    expect(TYPING_SELECTOR).toContain(':not([type="checkbox"])');
    expect(TYPING_SELECTOR).toContain(':not([type="range"])');
    expect(TYPING_SELECTOR).toMatch(/textarea, select/);
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
  it('jumps instead of staging on EVA (keyboard and gamepad A)', () => {
    const h = harness(); const settings = game.get().settings;
    const key = (code: string, type = 'keydown') => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false } });
      key('Space'); key('Space', 'keyup');
      expect(h.actions).toEqual(['stage']);
      h.input.evaMode = true;
      key('Space'); key('Space', 'keyup');
      expect(h.actions).toEqual(['stage', 'evaJump']);
      game.set({ settings: { ...settings, gamepadEnabled: true } });
      h.input.update(0.1);
      h.buttons({ 0: 1 }); h.input.update(0.1); h.input.update(1);
      expect(h.actions).toEqual(['stage', 'evaJump', 'evaJump']);
      expect(h.input.stageProgress).toBe(0);
      // Boarding with A still held must not stage the vessel the astronaut just entered.
      h.input.evaMode = false; h.input.update(1);
      expect(h.actions.filter(a => a === 'stage')).toHaveLength(1);
    } finally { h.input.dispose(); game.set({ settings }); }
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
  it('toggles SAS momentarily while F is held and ignores it on EVA', () => {
    const h = harness(); const settings = game.get().settings;
    const send = (type: string, code: string, repeat = false) => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false } });
      send('keydown', 'KeyF'); send('keydown', 'KeyF', true); send('keyup', 'KeyF');
      expect(h.actions).toEqual(['sasHold', 'sasHoldRelease']);
      send('keydown', 'KeyF'); h.target.dispatchEvent(new Event('blur'));
      expect(h.actions.slice(-2)).toEqual(['sasHold', 'sasHoldRelease']);
      h.input.evaMode = true; send('keydown', 'KeyF'); send('keyup', 'KeyF');
      expect(h.actions.slice(-1)).toEqual(['plantFlag']);
      h.input.evaMode = false; send('keydown', 'KeyL'); send('keyup', 'KeyL');
      expect(h.actions).not.toContain('stageLock');
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
      key('KeyW'); h.input.update(1); expect(h.input.state.pitch).toBe(1);
      game.set({ settings: { ...game.get().settings, invertPitch: false } });
      h.input.update(0.1); expect(h.input.state.pitch).toBe(-1);
      key('ControlLeft', true); h.input.update(0.1);
      expect(h.input.state.pitch).toBe(-1);
      saveBindings({ ...defaultBindings(), pitchUp: ['Ctrl+KeyW'] }, memory());
      h.input.update(0.1); expect(h.input.state.pitch).toBe(-1);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('reports pilot throttle input once (cut, full, ramp keys) so it can override a flight assist', () => {
    const h = harness(); const settings = game.get().settings;
    const ev = (type: string, code: string) => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0 } });
      h.input.update(0.02);
      expect(h.input.takeThrottleInput()).toBe(false);
      h.input.state.throttle = 0.7; // e.g. set by an assist: not pilot input
      h.input.update(0.02);
      expect(h.input.takeThrottleInput()).toBe(false);
      ev('keydown', 'KeyX');
      expect(h.input.state.throttle).toBe(0);
      expect(h.input.takeThrottleInput()).toBe(true);
      expect(h.input.takeThrottleInput()).toBe(false);
      ev('keyup', 'KeyX');
      ev('keydown', 'KeyZ'); ev('keyup', 'KeyZ');
      expect(h.input.takeThrottleInput()).toBe(true);
      ev('keydown', 'ControlLeft'); h.input.update(0.02); ev('keyup', 'ControlLeft');
      expect(h.input.takeThrottleInput()).toBe(true);
      h.input.update(0.02);
      expect(h.input.takeThrottleInput()).toBe(false);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('uses rebound continuous keys and clears them while paused', () => {
    const h = harness(); const settings = game.get().settings;
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0 } });
      saveBindings({ ...defaultBindings(), pitchUp: ['KeyP'] }, memory());
      h.target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyP', ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
      h.input.update(1); expect(h.input.state.pitch).toBe(-1);
      h.input.precision = true; h.input.update(0.1); expect(h.input.state.pitch).toBe(-0.35);
      h.input.enabled = false; h.input.update(0.1); expect(h.input.state.pitch).toBe(0);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('ramps digital attitude keys: taps are gentle, a one-second hold reaches full authority', () => {
    const h = harness(); const settings = game.get().settings;
    const ev = (type: string, code: string) => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0, invertPitch: false } });
      const frame = 1 / 60;
      // A 50 ms tap commands 5% of full deflection.
      ev('keydown', 'KeyD');
      let peak = 0;
      for (let i = 0; i < 3; i++) { h.input.update(frame); peak = Math.max(peak, h.input.state.yaw); }
      ev('keyup', 'KeyD');
      for (let i = 0; i < 6; i++) h.input.update(frame);
      expect(peak).toBeCloseTo(0.05);
      expect(h.input.state.yaw).toBe(0);
      // Held: full authority within 1 s, and reversing direction passes through zero quickly.
      ev('keydown', 'KeyD');
      for (let i = 0; i < 60; i++) h.input.update(frame);
      expect(h.input.state.yaw).toBeCloseTo(1);
      ev('keyup', 'KeyD'); ev('keydown', 'KeyA');
      let t = 0;
      while (h.input.state.yaw > 0 && t < 1) { h.input.update(frame); t += frame; }
      expect(t).toBeLessThan(0.1);
      for (let i = 0; i < 60; i++) h.input.update(frame);
      expect(h.input.state.yaw).toBeCloseTo(-1);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('trims with Alt + attitude keys, clears with Alt+X, and slows the throttle in fine mode', () => {
    const h = harness(); const settings = game.get().settings;
    const ev = (type: string, code: string, altKey = false) => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey, repeat: false }));
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0, invertPitch: false } });
      saveBindings(defaultBindings(), memory());
      ev('keydown', 'AltLeft'); ev('keydown', 'KeyS', true);
      for (let i = 0; i < 30; i++) h.input.update(1 / 60);
      expect(h.input.state.pitch).toBe(0); // trimming does not deflect
      expect(h.input.trim.pitch).toBeCloseTo(0.1, 6);
      ev('keyup', 'KeyS'); h.input.state.throttle = 0.5;
      ev('keydown', 'KeyX', true);
      expect(h.input.trim.pitch).toBe(0);
      expect(h.actions).toContain('trimReset');
      expect(h.input.state.throttle).toBe(0.5); // Alt+X is not throttle cut
      ev('keyup', 'KeyX'); ev('keyup', 'AltLeft');
      h.input.precision = true; h.input.state.throttle = 0;
      ev('keydown', 'ShiftLeft');
      for (let i = 0; i < 60; i++) h.input.update(1 / 60);
      expect(h.input.state.throttle).toBeCloseTo(0.2, 6);
    } finally { h.input.dispose(); game.set({ settings }); }
  });
  it('bound Alt chords act only as their action: Alt+L stage lock does not translate, trim chords do not steer', () => {
    const h = harness(); const settings = game.get().settings;
    const ev = (type: string, code: string, altKey = false) => h.target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey, repeat: false }));
    const run = () => { for (let i = 0; i < 30; i++) h.input.update(1 / 60); };
    try {
      game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0, invertPitch: false } });
      saveBindings(defaultBindings(), memory());
      ev('keydown', 'AltLeft'); ev('keydown', 'KeyL', true); run();
      expect(h.actions).toEqual(['stageLock']);
      expect(h.input.state.tx).toBe(0);
      // Releasing Alt first must not turn the still-held L into a translation burst.
      ev('keyup', 'AltLeft'); run();
      expect(h.input.state.tx).toBe(0);
      ev('keyup', 'KeyL');
      ev('keydown', 'KeyL'); run();
      expect(h.input.state.tx).toBe(1); // plain L still translates right
      ev('keyup', 'KeyL'); run();
      // Alt+X clears trim only; Alt + attitude keys trim without deflecting or translating.
      ev('keydown', 'AltLeft');
      for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE']) {
        ev('keydown', code, true); run();
        expect(h.input.state).toMatchObject({ pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 });
        ev('keyup', code);
      }
      ev('keydown', 'KeyX', true); run();
      expect(h.input.state).toMatchObject({ pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 });
      expect(h.actions).toEqual(['stageLock', 'trimReset']);
      ev('keyup', 'KeyX');
      // Documented: an unbound Alt + translation key is fine translation (Alt is hold-for-fine).
      ev('keydown', 'KeyI', true); run();
      expect(h.input.state.ty).toBeCloseTo(0.35, 6);
      ev('keyup', 'KeyI'); ev('keyup', 'AltLeft');
    } finally { h.input.dispose(); game.set({ settings }); }
  });
});

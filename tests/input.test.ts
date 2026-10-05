import { afterEach, describe, expect, it } from 'vitest';
import { BINDINGS_KEY, conflicts, defaultBindings, getBindings, loadBindings, saveBindings } from '../src/input/bindings';
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

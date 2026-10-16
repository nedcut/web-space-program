import { afterEach, describe, expect, it } from 'vitest';
import { FlightInput } from '../src/flight/input';
import { game } from '../src/game/store';
import { bindingLabel, defaultBindings, saveBindings } from '../src/input/bindings';
import { TRANSLATION_CONTROLS } from '../src/input/translation';

const settings = game.get().settings;
const storage = { setItem() {} };
afterEach(() => { game.set({ settings }); saveBindings(defaultBindings(), storage); });
function harness() {
  game.set({ settings: { ...settings, gamepadEnabled: false, inputSmoothing: 0 } });
  const target = Object.assign(new EventTarget(), { document: { hasFocus: () => true, activeElement: null } });
  const input = new FlightInput(target as unknown as Window);
  const key = (code: string, type = 'keydown') => target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false }));
  return { input, target, key };
}
describe('RCS translation pad input', () => {
  it('labels all six directions from the current bindings, including rebound and unbound keys', () => {
    expect(TRANSLATION_CONTROLS.map(c => bindingLabel(c.action))).toEqual(['H', 'J', 'L', 'N', 'I', 'K']);
    saveBindings({ ...defaultBindings(), translateUp: ['KeyY'], translateLeft: [] }, storage);
    expect(bindingLabel(TRANSLATION_CONTROLS[0].action)).toBe('Y');
    expect(bindingLabel(TRANSLATION_CONTROLS[1].action)).toBe('Unbound');
  });
  it('drives the same axes and fine authority as keyboard translation and releases each hold', () => {
    const h = harness();
    try {
      const axes = [{ tz: 1 }, { tx: -1 }, { tx: 1 }, { tz: -1 }, { ty: 1 }, { ty: -1 }];
      for (const [i, c] of TRANSLATION_CONTROLS.entries()) {
        h.input.setTranslation(c.action, true); h.input.update(.02);
        expect(h.input.state).toMatchObject(axes[i]);
        expect(h.input.translationSnapshot()).toBe(1 << i);
        h.input.setTranslation(c.action, false); h.input.update(.02);
        expect(h.input.state).toMatchObject({ tx: 0, ty: 0, tz: 0 });
      }
      h.input.precision = true;
      h.input.setTranslation('translateRight', true); h.input.update(.02);
      expect(h.input.state.tx).toBe(.35);
    } finally { h.input.dispose(); }
  });
  it('keeps a physical key held when the pointer releases, and cancels opposite directions', () => {
    const h = harness();
    try {
      h.key('KeyL'); h.input.setTranslation('translateRight', true);
      h.input.setTranslation('translateRight', false); h.input.update(.02);
      expect(h.input.state.tx).toBe(1);
      h.input.setTranslation('translateLeft', true); h.input.update(.02);
      expect(h.input.state.tx).toBe(0);
      h.key('KeyL', 'keyup'); h.input.update(.02);
      expect(h.input.state.tx).toBe(-1);
    } finally { h.input.dispose(); }
  });
  it('clears holds on blur, pause, EVA and panel cleanup without restoring stale input', () => {
    const h = harness();
    try {
      for (const cancel of [() => h.target.dispatchEvent(new Event('blur')), () => h.input.releaseTranslation(), () => { h.input.enabled = false; h.input.update(.02); }]) {
        h.input.enabled = true;
        h.input.setTranslation('translateForward', true); h.input.update(.02);
        expect(h.input.state.ty).toBe(1);
        cancel(); h.input.enabled = true; h.input.update(.02);
        expect(h.input.state.ty).toBe(0);
        expect(h.input.translationSnapshot()).toBe(0);
      }
      h.input.evaMode = true; h.input.setTranslation('translateForward', true);
      expect(h.input.translationSnapshot()).toBe(0);
    } finally { h.input.dispose(); }
  });
});

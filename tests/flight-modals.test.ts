import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FlightInput, type FlightAction } from '../src/flight/input';
import { actionAllowedWhileSuspended, pauseMenuVisible } from '../src/flight/modals';
import { game } from '../src/game/store';

const settings = game.get().settings;
afterEach(() => game.set({ settings }));
function harness() {
  const target = Object.assign(new EventTarget(), { document: { hasFocus: () => true, activeElement: null }, navigator: { getGamepads: () => [] } });
  const input = new FlightInput(target as unknown as Window);
  const actions: FlightAction[] = [];
  input.onAction(a => actions.push(a));
  const key = (type: 'keydown' | 'keyup', code: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
    target.dispatchEvent(Object.assign(new Event(type), { code, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {}, ...mods }));
  return { input, actions, key };
}

describe('Controls overlay in flight', () => {
  it('suspends throttle, staging and steering while open and restores them when closed', () => {
    game.set({ settings: { ...settings, gamepadEnabled: false } });
    const h = harness();
    try {
      // The controller disables FlightInput whenever the Controls reference is open (modalOpen).
      h.input.enabled = false;
      h.key('keydown', 'Space'); h.key('keydown', 'KeyZ'); h.key('keydown', 'ShiftLeft', { shiftKey: true }); h.key('keydown', 'KeyW');
      h.input.update(0.5);
      expect(h.actions.filter(a => !actionAllowedWhileSuspended(a))).toEqual([]);
      expect(h.input.state).toMatchObject({ throttle: 0, pitch: 0, yaw: 0, roll: 0, tx: 0 });
      h.key('keydown', 'Escape');
      expect(h.actions).toEqual(['menu']); // Esc still reaches the scene, which closes the overlay first.
      for (const code of ['Space', 'KeyZ', 'ShiftLeft', 'KeyW', 'Escape']) h.key('keyup', code);
      h.input.enabled = true;
      h.key('keydown', 'KeyW'); h.input.update(0.5);
      expect(h.input.state.pitch).not.toBe(0);
      h.key('keydown', 'Space');
      expect(h.actions).toContain('stage');
    } finally { h.input.dispose(); }
  });
  it('opening Controls from the Pause menu keeps the flight paused and returns to the menu', () => {
    expect(pauseMenuVisible({ paused: true, help: true })).toBe(false);
    expect(pauseMenuVisible({ paused: true, help: false })).toBe(true);
    expect(['stage', 'toggleSas', 'stageLock', 'warpUp', 'trimReset'].some(a => actionAllowedWhileSuspended(a as FlightAction))).toBe(false);
    // Neither Pause card may resume the flight on the way into Controls.
    const scene = readFileSync(new URL('../src/flight/FlightScene.tsx', import.meta.url), 'utf8');
    expect(scene).not.toMatch(/setPaused\(false\);\s*setHelp\(true\)/);
    expect(scene).toMatch(/modalOpen = help/);
  });
});

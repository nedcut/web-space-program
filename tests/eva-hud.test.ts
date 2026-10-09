import { describe, it, expect } from 'vitest';
import { evaHint } from '../src/flight/hud/CrewCards';
import { bindingLabel, defaultBindings } from '../src/input/bindings';

const key = (a: Parameters<typeof bindingLabel>[0]) => bindingLabel(a, defaultBindings());
const eva = { fuel: 5, jetpack: false, canBoard: false, boardHint: null, landed: true };

describe('EVA key hints', () => {
  it('shows the controls that apply right now, with primary keys only', () => {
    expect(evaHint(eva, key)).toBe('WASD walk · Shift run · Space jump');
    expect(evaHint({ ...eva, jetpack: true }, key)).toBe('WASD walk · Shift run · Space jump · Shift lift off');
    expect(evaHint({ ...eva, landed: false }, key)).toBe('Falling · R jetpack on');
    expect(evaHint({ ...eva, landed: false, jetpack: true }, key)).toBe('WASD fly · Shift up · Ctrl down');
    expect(evaHint({ ...eva, landed: false, jetpack: true, fuel: 0 }, key)).toBe('Jetpack empty · board to refill');
  });
});

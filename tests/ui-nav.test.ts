import { describe, expect, it, vi } from 'vitest';
import { createEscapeStack, type EscapeKeyEvent } from '../src/ui/nav/escape';
import { pickInDirection, type Box } from '../src/ui/nav/arrowNav';
import { facilities } from '../src/ui/nav/scenes';

const esc = (over: Partial<EscapeKeyEvent> = {}) => ({ key: 'Escape', target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...over });

describe('escape stack', () => {
  it('lets Escape fall through when nothing is registered (scene handlers keep working)', () => {
    const stack = createEscapeStack();
    const e = esc();
    expect(stack.handle(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('runs only the top entry: higher layer first, then latest push', () => {
    const stack = createEscapeStack(), calls: string[] = [];
    stack.push(() => calls.push('screen'), 'screen');
    const popModal = stack.push(() => calls.push('modal'), 'modal');
    stack.push(() => calls.push('panel'), 'panel'); // pushed later but lower layer
    const e = esc();
    expect(stack.handle(e)).toBe(true);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    popModal();
    stack.handle(esc());
    stack.push(() => calls.push('panel2'), 'panel');
    stack.handle(esc());
    expect(calls).toEqual(['modal', 'panel', 'panel2']);
  });

  it('ignores other keys and auto-repeat', () => {
    const stack = createEscapeStack(), run = vi.fn();
    stack.push(run);
    expect(stack.handle(esc({ key: 'Enter' }))).toBe(false);
    expect(stack.handle(esc({ repeat: true }))).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('first Escape in a text field only leaves the field', () => {
    const stack = createEscapeStack(), run = vi.fn(), blur = vi.fn();
    stack.push(run);
    stack.handle(esc({ target: { tagName: 'INPUT', type: 'search', blur } as unknown as EventTarget }));
    expect(blur).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    stack.handle(esc({ target: { tagName: 'INPUT', type: 'checkbox', blur } as unknown as EventTarget }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('arrow navigation', () => {
  // Main menu: one wide button, a 2-column grid, then a wide button.
  const menu: Box[] = [
    { x: 0, y: 0, w: 390, h: 52 },
    { x: 0, y: 60, w: 190, h: 44 }, { x: 200, y: 60, w: 190, h: 44 },
    { x: 0, y: 112, w: 190, h: 44 }, { x: 200, y: 112, w: 190, h: 44 },
    { x: 0, y: 164, w: 190, h: 44 },
    { x: 0, y: 216, w: 390, h: 44 },
  ];
  it('moves the way the layout looks', () => {
    expect(pickInDirection(menu, 0, 'down')).toBe(1);
    expect(pickInDirection(menu, 1, 'right')).toBe(2);
    expect(pickInDirection(menu, 2, 'down')).toBe(4);
    expect(pickInDirection(menu, 4, 'down')).toBe(6); // nothing directly below in the right column: falls to the wide row
    expect(pickInDirection(menu, 6, 'up')).toBe(5);
    expect(pickInDirection(menu, 2, 'up')).toBe(0);
  });
  it('returns -1 at an edge', () => {
    expect(pickInDirection(menu, 0, 'up')).toBe(-1);
    expect(pickInDirection(menu, 2, 'right')).toBe(-1);
  });
});

describe('facility switcher', () => {
  it('lists only the facilities a program mode has', () => {
    expect(facilities('sandbox').map(f => f.scene)).toEqual(['editor', 'tracking', 'flightlog']);
    expect(facilities('science').map(f => f.scene)).toContain('research');
    expect(facilities('career').map(f => f.scene)).toEqual(['editor', 'tracking', 'flightlog', 'research', 'missions']);
  });
});

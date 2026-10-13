import { describe, expect, it } from 'vitest';
import { clampSize, dragSize, keySize, limits, parseSizes, withSize, KEY_STEP, KEY_STEP_COARSE } from '../src/flight/hud/windowSize';

const lim = limits({ minW: 200, maxW: 500, minH: 100, maxH: 600 });
const start = { w: 270, h: 300 };

describe('window resize', () => {
  it('left edge widens when dragged left (docked column grows leftwards)', () => {
    expect(dragSize(start, 'l', -50, 999, lim)).toEqual({ w: 320 });
  });
  it('right edge and corners move the matching dimensions only', () => {
    expect(dragSize(start, 'r', 30, 40, lim)).toEqual({ w: 300 });
    expect(dragSize(start, 'b', 30, 40, lim)).toEqual({ h: 340 });
    expect(dragSize(start, 'br', 30, 40, lim)).toEqual({ w: 300, h: 340 });
    expect(dragSize(start, 'bl', 30, 40, lim)).toEqual({ w: 240, h: 340 });
  });
  it('keeps the stored dimension the edge does not move', () => {
    expect(dragSize(start, 'b', 0, 20, lim, { w: 400 })).toEqual({ w: 400, h: 320 });
    expect(dragSize(start, 'r', 20, 0, lim, { h: 250 })).toEqual({ w: 290, h: 250 });
  });
  it('clamps to the per-window limits', () => {
    expect(dragSize(start, 'br', 9999, 9999, lim)).toEqual({ w: 500, h: 600 });
    expect(dragSize(start, 'br', -9999, -9999, lim)).toEqual({ w: 200, h: 100 });
    expect(clampSize({ w: Number.NaN, h: 150.6 }, lim)).toEqual({ h: 151 });
  });
  it('arrow keys move the grip; Shift is coarse; Home resets; other keys pass through', () => {
    expect(keySize(start, 'bl', 'ArrowLeft', false, lim)).toEqual({ w: 270 + KEY_STEP });
    expect(keySize(start, 'br', 'ArrowLeft', false, lim)).toEqual({ w: 270 - KEY_STEP });
    expect(keySize(start, 'br', 'ArrowDown', true, lim)).toEqual({ h: 300 + KEY_STEP_COARSE });
    expect(keySize(start, 'r', 'ArrowDown', false, lim)).toBeNull();
    expect(keySize(start, 'r', 'ArrowRight', false, lim)).toEqual({ w: 270 + KEY_STEP });
    expect(keySize(start, 'r', 'Home', false, lim)).toBe('reset');
    expect(keySize(start, 'r', 'a', false, lim)).toBeNull();
  });
  it('keys step from the stored size, not a squeezed measured one', () => {
    // Docked column squeezed a stored 400 px window to 300 px: ↑ shrinks from 400, the width stays stored.
    expect(keySize(start, 'bl', 'ArrowUp', false, lim, { w: 320, h: 400 })).toEqual({ w: 320, h: 400 - KEY_STEP });
    expect(keySize(start, 'bl', 'ArrowLeft', false, lim, { h: 400 })).toEqual({ w: 270 + KEY_STEP, h: 400 });
  });
  it('parses stored sizes defensively and removes reset entries', () => {
    expect(parseSizes('not json')).toEqual({});
    expect(parseSizes('[1]')).toEqual({});
    expect(parseSizes(JSON.stringify({ a: { w: 300.4 }, b: { h: 'x' }, c: null, d: { w: -1, h: 200 } }))).toEqual({ a: { w: 300 }, d: { h: 200 } });
    const s = withSize({}, 'resources', { w: 300 });
    expect(s).toEqual({ resources: { w: 300 } });
    expect(withSize(s, 'resources', null)).toEqual({});
    expect(withSize(s, 'resources', {})).toEqual({});
  });
});

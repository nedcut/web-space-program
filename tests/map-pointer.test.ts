import { describe, expect, it } from 'vitest';
import { pointerOnMap } from '../src/render/map/MapView';

// Minimal DOM stand-ins: the map canvas and a HUD panel stacked above it.
const node = (parent?: object) => ({ nodeType: 1, parent });
const canvas = { ...node(), contains(n: { parent?: unknown }) { return n === this || n.parent === this; } } as unknown as HTMLElement;
const hudButton = node() as unknown as EventTarget;
const child = node(canvas) as unknown as EventTarget;

describe('map pointer', () => {
  it('counts the pointer as on the map only over the canvas itself', () => {
    expect(pointerOnMap(canvas, canvas, 100, 100, 800, 600)).toBe(true);
    expect(pointerOnMap(canvas, child, 100, 100, 800, 600)).toBe(true);
    expect(pointerOnMap(canvas, null, 100, 100, 800, 600)).toBe(true);
  });
  it('a HUD element above the map hides map hover (marker under the navball speed button)', () => {
    expect(pointerOnMap(canvas, hudButton, 100, 100, 800, 600)).toBe(false);
  });
  it('outside the rect is off the map', () => {
    expect(pointerOnMap(canvas, canvas, -1, 100, 800, 600)).toBe(false);
    expect(pointerOnMap(canvas, canvas, 100, 601, 800, 600)).toBe(false);
  });
});

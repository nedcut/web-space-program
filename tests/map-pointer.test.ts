import { describe, expect, it } from 'vitest';
import { pointerOnMap } from '../src/render/map/MapView';
import { layoutScale, toLayoutPoint } from '../src/util/layoutPoint';

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

describe('UI-scaled pointer', () => {
  // The app root is transform-scaled by the UI scale setting: an 800-px-wide canvas shows 1000 px wide at 125%.
  const scaled = { clientWidth: 800, getBoundingClientRect: () => ({ left: 20, top: 10, width: 1000, height: 750 }) } as unknown as Element;
  it('maps client coordinates into the element layout px the map projects into', () => {
    expect(toLayoutPoint(scaled, 520, 385)).toEqual({ x: 400, y: 300 });
    expect(toLayoutPoint(scaled, 1020, 760)).toEqual({ x: 800, y: 600 });
  });
  it('is the plain offset at 100% and when the element is not laid out', () => {
    expect(layoutScale(800, 800)).toBe(1);
    expect(layoutScale(0, 0)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { clampToView, createPlacements, leader, placeWindow, SIDE_GAP, SPACING, type Rect } from '../src/ui/inspector/placement';

const view = { w: 1784, h: 1056 };
const insets = { top: 110, right: 350, bottom: 260, left: 240 };
const size = { w: 264, h: 210 };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, v = view) => r.x >= 0 && r.y >= 0 && r.x + r.w <= v.w && r.y + r.h <= v.h;

describe('placeWindow', () => {
  it('opens beside the part, on the right when there is room', () => {
    const p = placeWindow({ x: 800, y: 500 }, size, view, insets, []);
    expect(p.x).toBe(800 + SIDE_GAP);
  });
  it('opens on the left when the right side is under the HUD', () => {
    const p = placeWindow({ x: 1200, y: 500 }, size, view, insets, []);
    expect(p.x + size.w).toBe(1200 - SIDE_GAP);
  });
  it('stays inside the free area and the screen for parts at the edges or off screen', () => {
    for (const a of [{ x: 5, y: 5 }, { x: 1780, y: 1050 }, { x: 900, y: 1040 }, null]) {
      const p = placeWindow(a, size, view, insets, []);
      expect(inside({ ...p, ...size })).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(insets.top);
      expect(p.y + size.h).toBeLessThanOrEqual(view.h - insets.bottom);
    }
  });
  it('does not cover windows that are already open', () => {
    const others: Rect[] = [];
    for (const a of [{ x: 880, y: 500 }, { x: 890, y: 520 }, { x: 870, y: 480 }, { x: 885, y: 505 }]) {
      const p = { ...placeWindow(a, size, view, insets, others), ...size };
      for (const o of others) expect(overlap(p, o)).toBe(false);
      expect(inside(p)).toBe(true);
      others.push(p);
    }
  });
  it('uses space under the HUD margins rather than covering a window when the free area is full', () => {
    // 1440×900: three tall windows do not fit beside each other in the free area.
    const v = { w: 1440, h: 900 }, tall = { w: 264, h: 366 };
    const others: Rect[] = [];
    for (const a of [{ x: 720, y: 450 }, { x: 720, y: 330 }, { x: 720, y: 520 }]) {
      const p = { ...placeWindow(a, tall, v, insets, others), ...tall };
      for (const o of others) expect(overlap(p, o)).toBe(false);
      expect(inside(p, v)).toBe(true);
      others.push(p);
    }
  });
  it('avoids the HUD boxes it is told about when crowded', () => {
    const v = { w: 1440, h: 900 }, tall = { w: 264, h: 366 };
    const altimeter = { x: 630, y: 8, w: 180, h: 70 };
    const others: Rect[] = [{ x: 410, y: 112, w: 264, h: 366 }, { x: 766, y: 402, w: 264, h: 125 }];
    const p = { ...placeWindow({ x: 720, y: 330 }, tall, v, insets, others, [altimeter]), ...tall };
    for (const o of [...others, altimeter]) expect(overlap(p, o)).toBe(false);
  });
  it('covers as little as possible when the screen is full', () => {
    const small = { w: 600, h: 400 };
    const others = [{ x: 8, y: 8, w: 400, h: 384 }];
    const p = placeWindow({ x: 300, y: 200 }, { w: 300, h: 200 }, small, { top: 0, right: 0, bottom: 0, left: 0 }, others);
    expect(p.x).toBeGreaterThanOrEqual(small.w - 300 - SPACING - 16);
    expect(inside({ ...p, w: 300, h: 200 }, small)).toBe(true);
  });
});

describe('placements', () => {
  it('never moves a window when its part moves (no side flip near the threshold)', () => {
    const book = createPlacements();
    // The part sits right at the old flip threshold (x + gap + width = view width - right inset) and jitters.
    const threshold = view.w - insets.right - size.w - SIDE_GAP;
    const first = { ...book.open(1, { x: threshold - 1, y: 500 }, size, view, insets) };
    for (let i = 0; i < 200; i++) {
      const p = book.open(1, { x: threshold + Math.sin(i) * 12, y: 500 + Math.cos(i * 3) * 9 }, size, view, insets);
      expect({ x: p.x, y: p.y }).toEqual({ x: first.x, y: first.y });
    }
  });
  it('a dragged window stays where the player put it, clamped on screen', () => {
    const book = createPlacements();
    book.open(1, { x: 800, y: 500 }, size, view, insets);
    const p = book.drag(1, { x: 100, y: 120 }, view)!;
    expect(p).toMatchObject({ x: 100, y: 120, moved: true });
    expect(book.open(1, { x: 1500, y: 900 }, size, view, insets)).toMatchObject({ x: 100, y: 120 });
    expect(book.drag(1, { x: -400, y: 5000 }, view)).toMatchObject({ x: SPACING, y: view.h - size.h - SPACING });
  });
  it('a viewport shrink pulls windows back on screen; growing does not move them', () => {
    const book = createPlacements();
    book.open(1, { x: 900, y: 600 }, size, view, insets);
    book.drag(1, { x: 1400, y: 800 }, view);
    const small = { w: 1200, h: 760 };
    expect(book.fit(small)).toEqual([1]);
    const p = book.get(1)!;
    expect(inside(p, small)).toBe(true);
    const at = { x: p.x, y: p.y };
    expect(book.fit(view)).toEqual([]);
    expect({ x: book.get(1)!.x, y: book.get(1)!.y }).toEqual(at);
  });
  it('a window that grows keeps its top-left unless it would leave the screen', () => {
    const book = createPlacements();
    const p0 = { ...book.open(1, { x: 800, y: 300 }, size, view, insets) };
    expect(book.resize(1, { w: 264, h: 260 }, view)).toMatchObject({ x: p0.x, y: p0.y, h: 260 });
    const tall = book.resize(1, { w: 264, h: 1000 }, view)!;
    expect(tall.y + tall.h).toBeLessThanOrEqual(view.h);
  });
  it('reopening a closed window places it afresh', () => {
    const book = createPlacements();
    book.open(1, { x: 800, y: 500 }, size, view, insets);
    book.drag(1, { x: 100, y: 120 }, view);
    book.retain(new Set());
    expect(book.has(1)).toBe(false);
    expect(book.open(1, { x: 800, y: 500 }, size, view, insets).x).toBe(800 + SIDE_GAP);
  });
});

describe('clampToView / leader', () => {
  it('returns the same object when the window already fits', () => {
    const pos = { x: 20, y: 30 };
    expect(clampToView(pos, size, view)).toBe(pos);
  });
  it('keeps the title bar reachable when the window is larger than the view', () => {
    expect(clampToView({ x: 50, y: 50 }, { w: 2000, h: 2000 }, view)).toEqual({ x: SPACING, y: SPACING });
  });
  it('leads to the nearest edge, or nowhere when the part is under the window', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(leader({ x: 50, y: 150 }, r)).toEqual({ x: 100, y: 150 });
    expect(leader({ x: 400, y: 300 }, r)).toEqual({ x: 300, y: 200 });
    expect(leader({ x: 150, y: 150 }, r)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { coveredIndex, nudgeClear, overlapsAny } from '../src/render/map/hudAvoid';

const R = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
// 1280×720: staging stack bottom-left, navball bottom-centre, side panel up the left edge, target panel right.
const W = 1280, H = 720, M = 10;
const hud = [R(10, 400, 250, 310), R(190, 560, 330, 160), R(10, 10, 262, 360), R(960, 80, 260, 300)];

describe('hud avoid', () => {
  it('finds the covering rectangle, with padding', () => {
    expect(coveredIndex(hud, hud.length, 100, 500, 6)).toBe(0);
    expect(coveredIndex(hud, hud.length, 265, 500, 6)).toBe(0); // 5 px right of the stack: inside the 6 px pad
    expect(coveredIndex(hud, hud.length, 267, 450, 6)).toBe(-1); // 7 px: clear
    expect(coveredIndex(hud, hud.length, 700, 300, 6)).toBe(-1);
    expect(coveredIndex(hud, hud.length, 100, 500, 6, 0)).toBe(-1);
    expect(coveredIndex(hud, 0, 100, 500, 6)).toBe(-1);
  });

  it('leaves a clear marker where it is', () => {
    const out = { x: 0, y: 0 };
    expect(nudgeClear(hud, hud.length, 700, 300, W, H, M, out)).toBe(true);
    expect(out).toEqual({ x: 700, y: 300 });
  });

  it('pushes a covered marker out through the nearest edge, margin clear of the rectangle', () => {
    const out = { x: 0, y: 0 };
    // Just inside the right edge of the target panel (x 960..1220).
    expect(nudgeClear([hud[3]], 1, 1210, 200, W, H, M, out)).toBe(true);
    expect(out.x).toBe(1230); expect(out.y).toBe(200);
    // Near the top edge of the same panel.
    expect(nudgeClear([hud[3]], 1, 1100, 90, W, H, M, out)).toBe(true);
    expect(out).toEqual({ x: 1100, y: 70 });
  });

  it('never lands in another panel or outside the viewport', () => {
    const out = { x: 0, y: 0 };
    // Bottom-left corner where the stack and the navball cluster meet.
    expect(nudgeClear(hud, hud.length, 230, 650, W, H, M, out)).toBe(true);
    expect(coveredIndex(hud, hud.length, out.x, out.y, M - 1)).toBe(-1);
    expect(out.x).toBeGreaterThanOrEqual(M); expect(out.y).toBeLessThanOrEqual(H - M);
    // A rectangle spanning the whole width cannot be left sideways; it has to exit vertically.
    expect(nudgeClear([R(0, 300, W, 100)], 1, 640, 330, W, H, M, out)).toBe(true);
    expect(out.y).toBe(290);
  });

  it('gives up (true point kept) when the whole viewport is covered', () => {
    const out = { x: 0, y: 0 };
    expect(nudgeClear([R(0, 0, W, H)], 1, 300, 300, W, H, M, out)).toBe(false);
    expect(out).toEqual({ x: 300, y: 300 });
  });

  it('reserved spots keep two nudged markers apart', () => {
    const out = { x: 0, y: 0 }, rects = [hud[3], R(0, 0, 0, 0)];
    nudgeClear(rects, 1, 1210, 200, W, H, M, out);
    rects[1] = R(out.x - 8, out.y - 8, 16, 16);
    const first = { ...out };
    expect(nudgeClear(rects, 2, 1212, 202, W, H, M, out)).toBe(true);
    expect(Math.hypot(out.x - first.x, out.y - first.y)).toBeGreaterThanOrEqual(16);
  });

  it('allocates nothing per call (works on a caller-owned output)', () => {
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 1000; i++) nudgeClear(hud, hud.length, 100 + (i % 50), 500, W, H, M, out);
    expect(Number.isFinite(out.x)).toBe(true);
  });

  it('detects a caption box running under a panel', () => {
    expect(overlapsAny(R(240, 600, 90, 17), hud, hud.length, 2)).toBe(true);
    expect(overlapsAny(R(600, 300, 90, 17), hud, hud.length, 2)).toBe(false);
    expect(overlapsAny(R(262, 20, 20, 17), hud, hud.length, 2)).toBe(true); // within the 2 px pad of the side panel
    expect(overlapsAny(R(240, 600, 90, 17), hud, 0, 2)).toBe(false);
  });
});

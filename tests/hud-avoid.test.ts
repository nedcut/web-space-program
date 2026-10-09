import { describe, expect, it } from 'vitest';
import { coveredIndex, nodeClearSpot, nudgeClear, overlapsAny } from '../src/render/map/hudAvoid';

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

  describe('maneuver nodes', () => {
    const G = 76, N = 14; // gizmo clearance (handles at 60 px plus their icon), plain node clearance

    it('leaves a node clear of every panel where it is', () => {
      const out = { x: 0, y: 0 };
      expect(nodeClearSpot(hud, hud.length, 700, 300, W, H, G, N, out)).toBe(false);
      expect(out).toEqual({ x: 700, y: 300 });
      expect(nodeClearSpot(hud, 0, 100, 500, W, H, G, N, out)).toBe(false);
      expect(out).toEqual({ x: 100, y: 500 });
    });

    it('moves a covered gizmo node so its whole gizmo clears the panel', () => {
      const out = { x: 0, y: 0 };
      expect(nodeClearSpot(hud, hud.length, 1000, 200, W, H, G, N, out)).toBe(true); // inside the target panel
      expect(out).toEqual({ x: 960 - G, y: 200 });
      // Every handle position around the moved centre is off every panel.
      for (let a = 0; a < 2 * Math.PI; a += Math.PI / 12)
        expect(coveredIndex(hud, hud.length, out.x + 60 * Math.cos(a), out.y + 60 * Math.sin(a), 12)).toBe(-1);
    });

    it('slides continuously along a panel edge (no jump as the true point crosses it)', () => {
      const out = { x: 0, y: 0 };
      let last = NaN;
      for (let x = 820; x <= 1000; x += 1) {
        nodeClearSpot([hud[3]], 1, x, 200, W, H, G, N, out);
        if (Number.isFinite(last)) expect(Math.abs(out.x - last)).toBeLessThanOrEqual(1);
        expect(out.x).toBeLessThanOrEqual(Math.min(x, 960 - G + 0.5));
        last = out.x;
      }
    });

    it('falls back to the small clearance when the gizmo does not fit', () => {
      const out = { x: 0, y: 0 };
      // A 200 px-tall viewport with a band across most of it: no spot 76 px clear of the band and the edges.
      expect(nodeClearSpot([R(0, 60, 400, 100)], 1, 200, 70, 400, 200, G, N, out)).toBe(true);
      expect(out).toEqual({ x: 200, y: 60 - N });
    });

    it('a reserved gizmo spot keeps a second covered node off it', () => {
      const out = { x: 0, y: 0 }, rects = [hud[3], R(0, 0, 0, 0)];
      nodeClearSpot(rects, 1, 1000, 200, W, H, G, N, out);
      rects[1] = R(out.x - 60, out.y - 60, 120, 120);
      const gizmo = { ...out };
      expect(nodeClearSpot(rects, 2, 1000, 205, W, H, N, N, out)).toBe(true);
      expect(coveredIndex(rects, 2, out.x, out.y, N - 1)).toBe(-1);
      expect(Math.hypot(out.x - gizmo.x, out.y - gizmo.y)).toBeGreaterThan(60);
    });
  });
});

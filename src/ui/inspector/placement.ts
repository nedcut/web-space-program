/**
 * Where part windows go. Pure (no DOM) so it can be tested.
 *
 * A window is placed once, when it opens, beside its part, and then stays put in screen space: the camera, a
 * shaking ascent or another window opening never move it. Only the player (dragging), a change of the window's own
 * size or of the viewport (clamped back on screen) do. The thin leader line follows the part instead.
 * Placing per frame from the part's projected position made windows flip between the part's two sides whenever the
 * part sat near the flip threshold (2026-10-13 report: "jumps from the left side to right side super fast").
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

/** Horizontal gap between a part and the window beside it, and the window's lift above the part (px). */
export const SIDE_GAP = 46;
export const LIFT = 36;
/** Space kept between windows, and between a window and the screen edge. */
export const SPACING = 8;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + SPACING && b.x < a.x + a.w + SPACING && a.y < b.y + b.h + SPACING && b.y < a.y + a.h + SPACING;

/**
 * Keeps a window of `size` fully inside `view` (with a small margin). When it is larger than the view, its
 * top-left corner wins so the title bar stays reachable. Returns `pos` itself when nothing changes.
 */
export function clampToView(pos: Point, size: Size, view: Size): Point {
  const x = Math.round(Math.max(SPACING, Math.min(view.w - size.w - SPACING, pos.x)));
  const y = Math.round(Math.max(SPACING, Math.min(view.h - size.h - SPACING, pos.y)));
  return x === pos.x && y === pos.y ? pos : { x, y };
}

/** Clamp into the area the HUD leaves free when the window fits there, else into the whole view. */
function clampFree(pos: Point, size: Size, view: Size, m: Insets): Point {
  const free = { w: view.w - m.left - m.right, h: view.h - m.top - m.bottom };
  const x = size.w + 2 * SPACING <= free.w ? Math.max(m.left, Math.min(view.w - m.right - size.w, pos.x)) : pos.x;
  const y = size.h + 2 * SPACING <= free.h ? Math.max(m.top, Math.min(view.h - m.bottom - size.h, pos.y)) : pos.y;
  return clampToView({ x, y }, size, view);
}

/**
 * Position for a newly opened window. Beside the part on the side with room (right first), then the other side;
 * when those collide with `others` (windows already open), stacked below or above them; failing that, wherever on
 * screen it covers the least of other windows and the HUD. A part off screen (`anchor` null) opens it near the centre.
 */
export function placeWindow(anchor: Point | null, size: Size, view: Size, insets: Insets, others: readonly Rect[]): Point {
  const a = anchor ?? { x: view.w / 2, y: view.h / 2 };
  const y0 = a.y - LIFT - size.h / 2;
  const right = { x: a.x + SIDE_GAP, y: y0 }, left = { x: a.x - SIDE_GAP - size.w, y: y0 };
  const fitsRight = right.x + size.w <= view.w - insets.right, fitsLeft = left.x >= insets.left;
  const sides = fitsRight || !fitsLeft ? [right, left] : [left, right];
  const candidates: Point[] = [];
  for (const s of sides) {
    candidates.push(s);
    // Stack beside earlier windows: below, then above each of them.
    for (const o of others) candidates.push({ x: s.x, y: o.y + o.h + SPACING }, { x: s.x, y: o.y - size.h - SPACING });
  }
  const free = (p: Point) => !others.some(o => overlaps({ ...p, ...size }, o));
  for (const c of candidates) {
    const p = clampFree(c, size, view, insets);
    if (free(p)) return p;
  }
  // The free area is full: scan the screen for the spot that covers the least of other windows, then of the HUD,
  // then is nearest the part. Runs once per opened window.
  const hudFree = { x: insets.left, y: insets.top, w: view.w - insets.left - insets.right, h: view.h - insets.top - insets.bottom };
  let best = clampFree(sides[0], size, view, insets), bestScore = Infinity;
  const step = 16;
  for (let y = SPACING; y <= view.h - size.h - SPACING; y += step) {
    for (let x = SPACING; x <= view.w - size.w - SPACING; x += step) {
      const r = { x, y, ...size };
      let cover = 0;
      for (const o of others) cover += area(r, { x: o.x - SPACING, y: o.y - SPACING, w: o.w + 2 * SPACING, h: o.h + 2 * SPACING });
      const hud = size.w * size.h - area(r, hudFree);
      const dx = Math.max(x - a.x, 0, a.x - x - size.w), dy = Math.max(y - a.y, 0, a.y - y - size.h);
      const score = 8 * cover + hud + 40 * Math.hypot(dx, dy);
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** One window's placement. `moved` once the player dragged it. */
export interface Placement { x: number; y: number; w: number; h: number; moved: boolean }

/**
 * Placements of the open windows, keyed by part uid. Positions change only through `open` (once per window),
 * `drag`, `resize` (the window's own size) and `fit` (viewport size); never from the part's screen position.
 */
export function createPlacements() {
  const map = new Map<number, Placement>();
  return {
    get: (uid: number) => map.get(uid),
    has: (uid: number) => map.has(uid),
    /** Place a window that just opened (no-op when it already has a place). */
    open(uid: number, anchor: Point | null, size: Size, view: Size, insets: Insets): Placement {
      const had = map.get(uid);
      if (had) return had;
      const others = [...map.values()];
      const p = placeWindow(anchor, size, view, insets, others);
      const placed = { ...p, ...size, moved: false };
      map.set(uid, placed);
      return placed;
    },
    /** The player moved the window to `pos` (clamped on screen). */
    drag(uid: number, pos: Point, view: Size): Placement | undefined {
      const p = map.get(uid);
      if (!p) return undefined;
      const c = clampToView(pos, p, view);
      p.x = c.x; p.y = c.y; p.moved = true;
      return p;
    },
    /** The window's own size changed (content, wrapping): keep its top-left, pull it back on screen. */
    resize(uid: number, size: Size, view: Size): Placement | undefined {
      const p = map.get(uid);
      if (!p) return undefined;
      p.w = size.w; p.h = size.h;
      const c = clampToView(p, p, view);
      p.x = c.x; p.y = c.y;
      return p;
    },
    /** Viewport changed: keep every window on screen. Returns the uids that moved. */
    fit(view: Size): number[] {
      const moved: number[] = [];
      for (const [uid, p] of map) {
        const c = clampToView(p, p, view);
        if (c !== p && (c.x !== p.x || c.y !== p.y)) { p.x = c.x; p.y = c.y; moved.push(uid); }
      }
      return moved;
    },
    /** Forget windows that closed (a reopened window is placed afresh). */
    retain(uids: ReadonlySet<number>) { for (const uid of map.keys()) if (!uids.has(uid)) map.delete(uid); },
    get size() { return map.size; },
  };
}
export type Placements = ReturnType<typeof createPlacements>;

/**
 * Leader line from a part (`a`) to the nearest point on its window's edge; null when the part is inside the
 * window (nothing useful to draw).
 */
export function leader(a: Point, r: Rect): { x: number; y: number } | null {
  const x = Math.max(r.x, Math.min(r.x + r.w, a.x)), y = Math.max(r.y, Math.min(r.y + r.h, a.y));
  return x === a.x && y === a.y ? null : { x, y };
}

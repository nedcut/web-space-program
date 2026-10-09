/**
 * Pure placement helpers that keep orbit markers out from under HUD panels. A marker whose true point sits inside
 * a panel's rectangle is drawn at the nearest clear spot (a short leader line joins it to the true point). No DOM,
 * no allocation: callers pass pooled rectangle arrays and an output point.
 */
import type { LabelBox } from './presentation';

export interface ClearPoint { x: number; y: number }

/** A point counts as covered when it lies within `pad` px of a rectangle (or inside it). */
export function coveredIndex(rects: readonly LabelBox[], count: number, x: number, y: number, pad: number, skip = -1): number {
  for (let i = 0; i < count; i++) {
    if (i === skip) continue;
    const r = rects[i];
    if (x > r.x - pad && x < r.x + r.width + pad && y > r.y - pad && y < r.y + r.height + pad) return i;
  }
  return -1;
}

/** Whether a box overlaps any rectangle (each grown by `pad`). */
export function overlapsAny(box: LabelBox, rects: readonly LabelBox[], count: number, pad: number): boolean {
  for (let i = 0; i < count; i++) {
    const r = rects[i];
    if (box.x < r.x + r.width + pad && box.x + box.width > r.x - pad && box.y < r.y + r.height + pad && box.y + box.height > r.y - pad) return true;
  }
  return false;
}

const OFF = 1e6;
const MAX_STEPS = 6;

/**
 * Nearest spot to (x, y) that is at least `margin` px outside every rectangle and `margin` px inside the
 * `width`×`height` viewport. Pushes the point out of the rectangle covering it through whichever edge is closest,
 * preferring exits that do not land in another rectangle. Writes `out` and returns true, or returns false (and
 * leaves `out` at the true point) when no clear spot is found.
 */
export function nudgeClear(rects: readonly LabelBox[], count: number, x: number, y: number, width: number, height: number, margin: number, out: ClearPoint): boolean {
  out.x = x; out.y = y;
  const inflate = margin - 0.5;
  let px = x, py = y;
  for (let step = 0; step < MAX_STEPS; step++) {
    const hit = coveredIndex(rects, count, px, py, inflate);
    if (hit < 0) {
      if (px < margin || py < margin || px > width - margin || py > height - margin) break;
      out.x = px; out.y = py;
      return true;
    }
    const r = rects[hit];
    let bestScore = Infinity, bx = px, by = py;
    for (let k = 0; k < 4; k++) {
      const cx = k === 0 ? r.x - margin : k === 1 ? r.x + r.width + margin : px;
      const cy = k === 2 ? r.y - margin : k === 3 ? r.y + r.height + margin : py;
      let score = Math.hypot(cx - x, cy - y);
      if (cx < margin || cy < margin || cx > width - margin || cy > height - margin) score += OFF;
      else if (coveredIndex(rects, count, cx, cy, inflate, hit) >= 0) score += OFF / 10;
      if (score < bestScore) { bestScore = score; bx = cx; by = cy; }
    }
    if (bestScore >= OFF) break;
    px = bx; py = by;
  }
  return false;
}

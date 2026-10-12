import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Box { x: number; y: number; w: number; h: number }
const DIRS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * Index of the nearest box in `dir` from box `from`, or -1. Pure geometry so grids, rows and
 * irregular layouts (the main menu, hub tiles, lesson cards) all navigate the way they look.
 */
export function pickInDirection(boxes: readonly Box[], from: number, dir: Direction): number {
  const a = boxes[from];
  if (!a) return -1;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  let best = -1, bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const along = dir === 'right' ? bx - ax : dir === 'left' ? ax - bx : dir === 'down' ? by - ay : ay - by;
    if (along <= 1) return;
    // Overlap on the cross axis means "same row/column": strongly preferred over diagonal neighbours.
    const overlap = dir === 'left' || dir === 'right'
      ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const cross = dir === 'left' || dir === 'right' ? Math.abs(by - ay) : Math.abs(bx - ax);
    const score = along + (overlap > 0 ? 0 : 1000 + cross * 2);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([type=hidden]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** onKeyDown for a container: arrow keys move focus between its controls by on-screen position. */
export function arrowNav(e: ReactKeyboardEvent<HTMLElement>, selector = FOCUSABLE) {
  const dir = DIRS[e.key];
  if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
  const target = e.target as HTMLElement;
  // Text fields, sliders and selects use arrows themselves.
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(el => el.offsetParent !== null);
  const from = items.indexOf(target);
  if (from < 0) return;
  const boxes = items.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const to = pickInDirection(boxes, from, dir);
  if (to < 0) return;
  e.preventDefault();
  items[to].focus();
}

/** Focus the panel's primary action, else its first control (keyboard users land in newly opened panels). */
export function focusFirst(el: HTMLElement | null) {
  const target = el?.querySelector<HTMLElement>('[data-autofocus]:not([disabled]), .btn.primary:not([disabled])') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
}

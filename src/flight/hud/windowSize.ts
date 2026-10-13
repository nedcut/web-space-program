/**
 * Player-chosen sizes for HUD windows (flight apps, map planner column). Sizes are in HUD pixels (before the HUD
 * scale), remembered per window in localStorage. Pure helpers: the DOM side lives in `Resizable.tsx`.
 */

export interface SizeLimits { minW: number; maxW: number; minH: number; maxH: number }
/** A dimension left undefined keeps the window's natural (CSS) size. */
export interface WinSize { w?: number; h?: number }
/** Which edge or corner is being dragged: l/r/b edges, bl/br corners. */
export type ResizeEdge = 'l' | 'r' | 'b' | 'bl' | 'br';

export const DEFAULT_LIMITS: SizeLimits = { minW: 200, maxW: 560, minH: 110, maxH: 900 };
/** Arrow-key step (Shift: coarse). */
export const KEY_STEP = 16;
export const KEY_STEP_COARSE = 64;

export const limits = (over?: Partial<SizeLimits>): SizeLimits => ({ ...DEFAULT_LIMITS, ...over });

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));

export function clampSize(s: WinSize, lim: SizeLimits): WinSize {
  const out: WinSize = {};
  if (s.w !== undefined && Number.isFinite(s.w)) out.w = clamp(s.w, lim.minW, lim.maxW);
  if (s.h !== undefined && Number.isFinite(s.h)) out.h = clamp(s.h, lim.minH, lim.maxH);
  return out;
}

const widthSign = (edge: ResizeEdge) => edge === 'l' || edge === 'bl' ? -1 : edge === 'r' || edge === 'br' ? 1 : 0;
const heightSign = (edge: ResizeEdge) => edge === 'b' || edge === 'bl' || edge === 'br' ? 1 : 0;

/**
 * Size after dragging `edge` by (dx, dy) HUD px from a window that measured `start` when the drag began. Only the
 * dimensions the edge moves are set; the other keeps whatever the window had stored (`keep`).
 */
export function dragSize(start: { w: number; h: number }, edge: ResizeEdge, dx: number, dy: number, lim: SizeLimits, keep: WinSize = {}): WinSize {
  const sw = widthSign(edge), sh = heightSign(edge);
  return clampSize({ w: sw ? start.w + sw * dx : keep.w, h: sh ? start.h + dy : keep.h }, lim);
}

/**
 * Keyboard resize on a grip: arrows move the grip (so on a left-edge grip ← widens), Shift for a coarse step,
 * Home resets. Returns the new size, 'reset', or null when the key is not a resize key.
 */
export function keySize(cur: { w: number; h: number }, edge: ResizeEdge, key: string, shift: boolean, lim: SizeLimits, keep: WinSize = {}): WinSize | 'reset' | null {
  if (key === 'Home') return 'reset';
  const step = shift ? KEY_STEP_COARSE : KEY_STEP;
  const sw = widthSign(edge), sh = heightSign(edge);
  let dx = 0, dy = 0;
  if (key === 'ArrowLeft') dx = -step;
  else if (key === 'ArrowRight') dx = step;
  else if (key === 'ArrowUp') dy = -step;
  else if (key === 'ArrowDown') dy = step;
  else return null;
  if ((dx && !sw) || (dy && !sh)) return null;
  return dragSize(cur, edge, dx, dy, lim, keep);
}

export const SIZES_KEY = 'wsp.hud.winSize.v1';
export type SizeStore = Record<string, WinSize>;

export function parseSizes(raw: string | null): SizeStore {
  try {
    const v = JSON.parse(raw ?? 'null') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: SizeStore = {};
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
      if (!s || typeof s !== 'object') continue;
      const { w, h } = s as { w?: unknown; h?: unknown };
      const size: WinSize = {};
      if (typeof w === 'number' && Number.isFinite(w) && w > 0) size.w = Math.round(w);
      if (typeof h === 'number' && Number.isFinite(h) && h > 0) size.h = Math.round(h);
      if (size.w !== undefined || size.h !== undefined) out[k] = size;
    }
    return out;
  } catch { return {}; }
}

/** Store with `id` set to `size` (an empty size removes the entry: the window goes back to its default). */
export function withSize(store: SizeStore, id: string, size: WinSize | null): SizeStore {
  const next = { ...store };
  if (!size || (size.w === undefined && size.h === undefined)) delete next[id];
  else next[id] = size;
  return next;
}

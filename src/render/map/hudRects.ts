/**
 * Cached screen rectangles of the HUD blocks that sit above the map. Measured only after the HUD changes (resize,
 * layout, panels opening or moving), at most a few times a second, never per marker per frame.
 */
import type { LabelBox } from './presentation';
import { layoutScale } from '../../util/layoutPoint';

const MIN_SCAN_MS = 250;

export class HudRectCache {
  /** Rectangles in `origin` element coordinates; entries past `count` are stale pool slots. */
  readonly rects: LabelBox[] = [];
  count = 0;
  private selector = '';
  private root: Element | null = null;
  private dirty = true;
  private lastScan = -Infinity;
  private readonly resize: ResizeObserver | null;
  private readonly mutation: MutationObserver | null;
  private readonly mark = () => { this.dirty = true; };

  constructor(private readonly rootSelector = '.hud') {
    this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(this.mark) : null;
    this.mutation = typeof MutationObserver === 'function' ? new MutationObserver(this.mark) : null;
    window.addEventListener('resize', this.mark);
  }

  /** CSS selector of the HUD blocks that take pointer events (empty disables avoidance). */
  setSelector(selector: string) { if (selector !== this.selector) { this.selector = selector; this.dirty = true; } }

  dispose() {
    window.removeEventListener('resize', this.mark);
    this.resize?.disconnect(); this.mutation?.disconnect();
    this.root = null; this.count = 0;
  }

  /** Rescan if the HUD changed since the last scan; returns the rectangle count. */
  refresh(origin: Element, now: number): number {
    if (!this.selector) return this.count = 0;
    if (!this.dirty && this.root?.isConnected) return this.count;
    if (now - this.lastScan < MIN_SCAN_MS) return this.count;
    this.lastScan = now; this.dirty = false;
    if (!this.root?.isConnected) {
      this.resize?.disconnect(); this.mutation?.disconnect();
      this.root = document.querySelector(this.rootSelector);
      if (this.root) {
        this.resize?.observe(this.root);
        this.mutation?.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
      }
    }
    this.count = 0;
    if (!this.root) return 0;
    // Rects come back in screen px; the map works in `origin` layout px (they differ under the UI scale setting).
    const o = origin.getBoundingClientRect(), s = layoutScale(o.width, origin.clientWidth), list = this.root.querySelectorAll(this.selector);
    for (let i = 0; i < list.length; i++) {
      const el = list[i], r = el.getBoundingClientRect();
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      // Rows scrolled out of a clipping list are not on screen.
      const clip = el.parentElement;
      if (clip && clip.scrollHeight > clip.clientHeight && getComputedStyle(clip).overflowY !== 'visible') {
        const c = clip.getBoundingClientRect();
        x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
      }
      if (x1 - x0 < 2 * s || y1 - y0 < 2 * s) continue;
      const box = this.rects[this.count] ??= { x: 0, y: 0, width: 0, height: 0 };
      box.x = (x0 - o.left) / s; box.y = (y0 - o.top) / s; box.width = (x1 - x0) / s; box.height = (y1 - y0) / s;
      this.count++;
    }
    return this.count;
  }
}

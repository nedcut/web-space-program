/**
 * Per-frame DOM overlay writes (map labels and markers) that touch the element only when a value changes.
 * Blink invalidates style (and, for `left`/`top`, layout) on every inline-style assignment, even an identical
 * one; positions use `transform` so moving labels only re-composites.
 */
type StyleKey = 'display' | 'transform' | 'color' | 'background' | 'border' | 'borderRadius' | 'padding';

const written = new WeakMap<HTMLElement, Partial<Record<StyleKey, string>>>();

export function setStyle(el: HTMLElement, key: StyleKey, value: string): void {
  let last = written.get(el);
  if (!last) written.set(el, (last = {}));
  if (last[key] === value) return;
  last[key] = value;
  el.style[key] = value;
}

/** `translate3d` to a CSS-pixel position, rounded to 0.1 px so sub-pixel jitter does not count as a change. */
export function setPosition(el: HTMLElement, x: number, y: number, suffix = ''): void {
  setStyle(el, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)${suffix}`);
}

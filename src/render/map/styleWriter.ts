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

const positions = new WeakMap<HTMLElement, { x: number; y: number; suffix: string }>();

/**
 * `translate3d` to a CSS-pixel position, rounded to 0.1 px so sub-pixel jitter does not count as a change.
 * The rounded numbers are compared first, so an unchanged label builds no string.
 */
export function setPosition(el: HTMLElement, x: number, y: number, suffix = ''): void {
  const rx = Math.round(x * 10), ry = Math.round(y * 10);
  let last = positions.get(el);
  if (last && last.x === rx && last.y === ry && last.suffix === suffix) return;
  if (!last) positions.set(el, (last = { x: 0, y: 0, suffix }));
  last.x = rx; last.y = ry; last.suffix = suffix;
  setStyle(el, 'transform', `translate3d(${(rx / 10).toFixed(1)}px,${(ry / 10).toFixed(1)}px,0)${suffix}`);
}

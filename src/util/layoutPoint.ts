/**
 * The app root is CSS-scaled by the UI scale setting, so client (screen) pixels differ from an element's own layout
 * pixels (clientWidth, the units renderers and map projections use). These helpers convert between the two.
 */

/** Screen px per layout px of `el` (1 when unscaled or not laid out). */
export function layoutScale(rectWidth: number, clientWidth: number): number {
  return clientWidth > 0 && rectWidth > 0 ? rectWidth / clientWidth : 1;
}

/** Client coordinates to layout px relative to `el`'s top-left. */
export function toLayoutPoint(el: Element, clientX: number, clientY: number, out = { x: 0, y: 0 }): { x: number; y: number } {
  const r = el.getBoundingClientRect(), s = layoutScale(r.width, el.clientWidth);
  out.x = (clientX - r.left) / s; out.y = (clientY - r.top) / s;
  return out;
}

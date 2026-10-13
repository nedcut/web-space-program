import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { SIZES_KEY, dragSize, keySize, parseSizes, withSize, type ResizeEdge, type SizeLimits, type SizeStore, type WinSize } from './windowSize';

function loadSizes(): SizeStore {
  try { return parseSizes(localStorage.getItem(SIZES_KEY)); } catch { return {}; }
}

/** Player-chosen window sizes, remembered across sessions. Changes only on resize release / key press. */
export function useWinSizes() {
  const [sizes, setSizes] = useState<SizeStore>(loadSizes);
  const setSize = useCallback((id: string, size: WinSize | null) => setSizes(s => {
    const next = withSize(s, id, size);
    try { localStorage.setItem(SIZES_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  }), []);
  return { sizes, setSize };
}

/** CSS px per HUD px (the HUD is a scaled overlay). */
function hudScale(el: Element): number {
  const host = el.closest('.overlay') as HTMLElement | null;
  if (!host) return 1;
  return host.getBoundingClientRect().width / Math.max(1, host.clientWidth) || 1;
}

/** Writes a size straight to the element while dragging (React state follows on release). */
function paintSize(el: HTMLElement, s: WinSize) {
  if (s.w !== undefined) el.style.width = `${s.w}px`;
  if (s.h !== undefined) { el.style.height = `${s.h}px`; el.style.maxHeight = 'none'; }
}

/**
 * An edge or corner handle that resizes `target()`. Pointer listeners run only during a drag, painting at most
 * once per animation frame; the size is committed on release. A `focusable` grip also takes arrow keys (they move
 * the grip; Shift for bigger steps) and Home to reset; double-click resets too.
 */
export function ResizeGrip({ edge, target, limits, size, onResize, focusable = false, label }: {
  edge: ResizeEdge;
  target(): HTMLElement | null;
  limits: SizeLimits;
  /** Stored size: the dimension this edge does not move is kept. */
  size?: WinSize;
  onResize(size: WinSize | null): void;
  focusable?: boolean;
  label: string;
}) {
  const drag = useRef<{ id: number; x: number; y: number; scale: number; w: number; h: number; next: WinSize; el: HTMLElement } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const paint = () => {
    frame.current = 0;
    const d = drag.current;
    if (d) paintSize(d.el, d.next);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = target();
    if (!el) return;
    // No focus ring or text selection from a mouse drag; the grip keeps keyboard focus only when tabbed to.
    e.preventDefault();
    e.stopPropagation();
    const scale = hudScale(el), r = el.getBoundingClientRect();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, scale, w: r.width / scale, h: r.height / scale, next: {}, el };
    el.classList.add('resizing');
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.next = dragSize(d, edge, (e.clientX - d.x) / d.scale, (e.clientY - d.y) / d.scale, limits, size);
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    d.el.classList.remove('resizing');
    if (d.next.w !== undefined || d.next.h !== undefined) { paintSize(d.el, d.next); onResize(d.next); }
  };
  const key = (e: ReactKeyboardEvent) => {
    const el = target();
    if (!el) return;
    const scale = hudScale(el), r = el.getBoundingClientRect();
    const next = keySize({ w: r.width / scale, h: r.height / scale }, edge, e.key, e.shiftKey, limits, size);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    onResize(next === 'reset' ? null : next);
  };
  const horizontal = edge === 'b';
  return (
    <div className={`rs-grip rs-${edge}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      onDoubleClick={e => { e.stopPropagation(); onResize(null); }}
      {...(focusable
        ? { tabIndex: 0, role: 'separator', 'aria-orientation': horizontal ? 'horizontal' : 'vertical', 'aria-label': label, 'data-key-owner': '', onKeyDown: key,
          title: `${label} · drag, or arrow keys (Shift: faster) · double-click or Home resets` }
        : { 'aria-hidden': true, title: `${label} · double-click resets` })} />
  );
}

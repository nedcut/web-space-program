import { useEffect, useRef } from 'react';

/**
 * One back/Escape stack for every menu screen, panel and dialog.
 *
 * Esc runs the top entry only: highest layer first, then the most recent push. When the stack is empty
 * the key falls through untouched, so scenes with their own Escape handling (flight pause menu, editor
 * "drop held part") keep working. A handled Escape is consumed (no other listener sees it).
 */
export type EscapeLayer = 'screen' | 'panel' | 'modal' | 'capture';
const RANK: Record<EscapeLayer, number> = { screen: 0, panel: 1, modal: 2, capture: 3 };

interface Entry { id: number; rank: number; run: () => void }
export interface EscapeKeyEvent { key: string; target: EventTarget | null; repeat?: boolean; isComposing?: boolean; preventDefault(): void; stopImmediatePropagation(): void }

export function createEscapeStack() {
  const entries: Entry[] = [];
  let next = 0;
  const top = () => entries.reduce<Entry | null>((best, e) => (!best || e.rank >= best.rank ? e : best), null);
  return {
    push(run: () => void, layer: EscapeLayer = 'panel') {
      const entry = { id: next++, rank: RANK[layer], run };
      entries.push(entry);
      return () => { const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); };
    },
    get size() { return entries.length; },
    /** Returns true when the event was consumed. */
    handle(e: EscapeKeyEvent): boolean {
      if (e.key !== 'Escape' || e.isComposing || !entries.length) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return true;
      // First Esc in a text field only leaves the field (search boxes keep their text).
      if (isTextField(e.target)) { (e.target as HTMLElement).blur(); return true; }
      top()?.run();
      return true;
    },
  };
}

function isTextField(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test((el as HTMLInputElement).type);
}

export const escapeStack = createEscapeStack();
let attached = false;
function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  // Capture phase on window: runs before scene keyboard handlers and element handlers.
  window.addEventListener('keydown', e => { escapeStack.handle(e); }, true);
}

/** Register `onEscape` while mounted and `active`. The latest callback is always used. */
export function useEscape(onEscape: () => void, active = true, layer: EscapeLayer = 'panel') {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    attach();
    return escapeStack.push(() => ref.current(), layer);
  }, [active, layer]);
}

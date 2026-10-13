import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AppIcon, type AppGlyph } from './glyphs';
import { useEscape } from '../../ui/nav/escape';
import { isTyping, matches } from '../../input/bindings';
import { ResizeGrip } from './Resizable';
import { limits as sizeLimits, type SizeLimits, type WinSize } from './windowSize';

export type AppId = 'alarms' | 'resources' | 'flightData' | 'science' | 'crew' | 'assist' | 'target' | 'comms' | 'station';

export interface HudApp {
  id: AppId;
  title: string;
  icon: AppGlyph;
  /** Window body; null hides the toolbar button (app not applicable right now). */
  content: ReactNode | null;
  /** Small status light on the toolbar button. */
  badge?: 'on' | 'warn' | 'target' | null;
  width?: number;
  /**
   * How readily the window gives up height when docked windows don't fit the column (default 1). Long, scrolling
   * readouts use more so short ones (resource bars, alarms) keep their rows.
   */
  shrink?: number;
  /** Resize limits in HUD px (defaults: 200–560 wide, 110–900 tall). */
  limits?: Partial<SizeLimits>;
}

/** Extra toolbar buttons that act rather than open a window (orbit strip, settings, help). */
export interface ToolbarAction { id: string; title: string; icon: AppGlyph; on?: boolean; onClick(): void; tutorial?: string }

const APPS_KEY = 'wsp.hud.apps.v1';
interface AppState { open: AppId[]; pos: Partial<Record<AppId, { x: number; y: number }>> }

function loadApps(): AppState {
  try {
    const raw = JSON.parse(sessionStorage.getItem(APPS_KEY) ?? 'null') as Partial<AppState> | null;
    return { open: Array.isArray(raw?.open) ? raw.open.filter((x): x is AppId => typeof x === 'string') : [], pos: raw?.pos && typeof raw.pos === 'object' ? raw.pos : {} };
  } catch { return { open: [], pos: {} }; }
}
function saveApps(s: AppState) {
  try { sessionStorage.setItem(APPS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Open-app state remembered for this browser session (the genre's toolbar apps stay open across scene loads). */
export function useApps() {
  const [state, setState] = useState<AppState>(loadApps);
  const update = useCallback((fn: (s: AppState) => AppState) => setState(s => { const n = fn(s); saveApps(n); return n; }), []);
  const toggle = useCallback((id: AppId) => update(s => ({ ...s, open: s.open.includes(id) ? s.open.filter(x => x !== id) : [...s.open, id] })), [update]);
  const close = useCallback((id: AppId) => update(s => ({ ...s, open: s.open.filter(x => x !== id) })), [update]);
  const move = useCallback((id: AppId, x: number, y: number) => update(s => ({ ...s, pos: { ...s.pos, [id]: { x, y } } })), [update]);
  const dock = useCallback((id: AppId) => update(s => { const pos = { ...s.pos }; delete pos[id]; return { ...s, pos }; }), [update]);
  return { state, toggle, close, move, dock };
}

/** Input that decides whether Esc belongs to the app windows (true) or to the pause menu (false). */
export type AppEscapeInput =
  | { kind: 'pointer'; inApps: boolean }
  | { kind: 'key'; key: string; typing: boolean; appKey: boolean };

const PASSIVE_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock']);

/**
 * Esc closes app windows only while the pilot is working with them: a click in the toolbar or a window (or the
 * flight-data shortcut) engages; a click in the scene or any flight key hands Esc back to the pause menu. Windows
 * kept open while flying therefore never swallow the pause key.
 */
export function appEscapeEngaged(engaged: boolean, input: AppEscapeInput): boolean {
  if (input.kind === 'pointer') return input.inApps;
  if (input.appKey) return true;
  if (input.typing || PASSIVE_KEYS.has(input.key)) return engaged;
  return false;
}

/**
 * Escape handling for the app windows: while engaged, each Esc closes the most recently opened visible window.
 * Returns the window that the next Esc would close (null when Esc pauses). Listeners are input events only.
 */
export function useAppEscape(visible: AppId[], close: (id: AppId) => void): AppId | null {
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  useEffect(() => {
    // Only a change re-renders the HUD (held flight keys repeat keydown).
    const apply = (input: AppEscapeInput) => {
      const next = appEscapeEngaged(engagedRef.current, input);
      if (next !== engagedRef.current) { engagedRef.current = next; setEngaged(next); }
    };
    const pointer = (e: PointerEvent) => apply({ kind: 'pointer', inApps: !!(e.target as Element | null)?.closest?.('.app-win, .app-bar') });
    const key = (e: KeyboardEvent) => apply({ kind: 'key', key: e.key, typing: isTyping(e.target), appKey: matches('flightData', e) });
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('keydown', key, true); };
  }, []);
  const top = engaged ? visible.at(-1) ?? null : null;
  useEscape(() => { if (top) close(top); }, top !== null, 'panel');
  return top;
}

/** Top-right toolbar strip of small icon buttons. */
export function AppToolbar({ apps, open, onToggle, actions }: { apps: HudApp[]; open: AppId[]; onToggle(id: AppId): void; actions: ToolbarAction[] }) {
  return (
    <nav className="app-bar panel" aria-label="Applications">
      {apps.filter(a => a.content !== null).map(a => (
        <button key={a.id} type="button" className={`app-btn ${open.includes(a.id) ? 'on' : ''}`} aria-pressed={open.includes(a.id)} data-tip={a.title}
          aria-label={a.title} data-tutorial={a.id === 'target' ? 'target' : `app-${a.id}`} onClick={() => onToggle(a.id)}>
          <AppIcon name={a.icon} />
          {a.badge && <span className={`app-badge ${a.badge}`} />}
        </button>
      ))}
      <span className="app-sep" aria-hidden />
      {actions.map(a => (
        <button key={a.id} type="button" className={`app-btn ${a.on ? 'on' : ''}`} data-tip={a.title} aria-label={a.title} aria-pressed={a.on} data-tutorial={a.tutorial} onClick={a.onClick}>
          <AppIcon name={a.icon} />
        </button>
      ))}
    </nav>
  );
}

/**
 * A draggable, resizable app window. Undragged windows stack under the toolbar; dragging detaches one (double-click
 * the title to re-dock). Docked windows resize from the left and bottom edges (the column is right-aligned),
 * floating ones from the right and bottom; the corner grip takes arrow keys. Sizes are remembered per app.
 */
export function AppWindow({ app, pos, scale, escTarget = false, size, onClose, onMove, onDock, onResize }: { app: HudApp; pos?: { x: number; y: number }; scale: number; escTarget?: boolean; size?: WinSize; onClose(): void; onMove(x: number, y: number): void; onDock(): void; onResize(size: WinSize | null): void }) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number; id: number; x: number; y: number; style: string; scale: number; left: number; top: number; maxX: number; maxY: number } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const paint = () => {
    frame.current = 0;
    const el = ref.current, d = drag.current;
    if (el && d) { el.style.left = `${d.x}px`; el.style.top = `${d.y}px`; }
  };
  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const el = ref.current, host = el?.closest('.overlay');
    if (!el || !host) return;
    const r = el.getBoundingClientRect(), h = host.getBoundingClientRect();
    const effectiveScale = h.width / Math.max(1, host.clientWidth) || scale;
    drag.current = { dx: (e.clientX - r.left) / effectiveScale, dy: (e.clientY - r.top) / effectiveScale, id: e.pointerId,
      x: (r.left - h.left) / effectiveScale, y: (r.top - h.top) / effectiveScale, style: el.style.cssText,
      scale: effectiveScale, left: h.left, top: h.top,
      maxX: h.width / effectiveScale - el.offsetWidth, maxY: h.height / effectiveScale - 40 };
    // Keep the same DOM node/capture while undocking. Persist and reparent only on release.
    el.style.position = 'fixed';
    el.style.zIndex = '12';
    paint();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const x = Math.max(0, Math.min(d.maxX, (e.clientX - d.left) / d.scale - d.dx));
    const y = Math.max(0, Math.min(d.maxY, (e.clientY - d.top) / d.scale - d.dy));
    d.x = x; d.y = y;
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (ref.current) ref.current.style.cssText = d.style;
    drag.current = null;
    onMove(d.x, d.y);
  };
  const lim = sizeLimits(app.limits);
  const sized = size?.w !== undefined || size?.h !== undefined;
  const target = () => ref.current;
  const label = `Resize ${app.title}`;
  return (
    <section ref={ref} className={`app-win panel ${pos ? 'floating' : ''}`} aria-label={app.title}
      style={{ width: size?.w ?? app.width ?? 270, ...(size?.h !== undefined ? { height: size.h, maxHeight: 'none' } : null),
        ...(pos ? { left: pos.x, top: pos.y } : { flexShrink: app.shrink ?? 1 }) }}>
      <header className="app-win-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        onDoubleClick={() => pos ? onDock() : sized && onResize(null)}
        title={pos ? 'Drag to move · double-click to dock under the toolbar' : `Drag out to float${sized ? ' · double-click to reset the size' : ''}`}>
        <AppIcon name={app.icon} size={14} />
        <span>{app.title}</span>
        {escTarget && <kbd className="kbd app-win-esc" title="Esc closes this window">Esc</kbd>}
        {sized && <button type="button" className="app-win-close app-win-reset" onClick={() => onResize(null)} aria-label={`Reset ${app.title} size`} title="Reset size">⤡</button>}
        <button type="button" className="app-win-close" onClick={onClose} aria-label={`Close ${app.title}`}>×</button>
      </header>
      <div className="app-win-body">{app.content}</div>
      {pos ? <>
        <ResizeGrip edge="r" target={target} limits={lim} size={size} onResize={onResize} label={label} />
        <ResizeGrip edge="b" target={target} limits={lim} size={size} onResize={onResize} label={label} />
        <ResizeGrip edge="br" target={target} limits={lim} size={size} onResize={onResize} label={label} focusable />
      </> : <>
        <ResizeGrip edge="l" target={target} limits={lim} size={size} onResize={onResize} label={label} />
        <ResizeGrip edge="b" target={target} limits={lim} size={size} onResize={onResize} label={label} />
        <ResizeGrip edge="bl" target={target} limits={lim} size={size} onResize={onResize} label={label} focusable />
      </>}
    </section>
  );
}

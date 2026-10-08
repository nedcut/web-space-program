import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AppIcon, type AppGlyph } from './glyphs';

export type AppId = 'alarms' | 'resources' | 'flightData' | 'science' | 'crew' | 'assist' | 'target' | 'comms';

export interface HudApp {
  id: AppId;
  title: string;
  icon: AppGlyph;
  /** Window body; null hides the toolbar button (app not applicable right now). */
  content: ReactNode | null;
  /** Small status light on the toolbar button. */
  badge?: 'on' | 'warn' | 'target' | null;
  width?: number;
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

/** Top-right toolbar strip of small icon buttons. */
export function AppToolbar({ apps, open, onToggle, actions }: { apps: HudApp[]; open: AppId[]; onToggle(id: AppId): void; actions: ToolbarAction[] }) {
  return (
    <nav className="app-bar panel" aria-label="Applications">
      {apps.filter(a => a.content !== null).map(a => (
        <button key={a.id} type="button" className={`app-btn ${open.includes(a.id) ? 'on' : ''}`} aria-pressed={open.includes(a.id)} title={a.title}
          aria-label={a.title} data-tutorial={a.id === 'target' ? 'target' : `app-${a.id}`} onClick={() => onToggle(a.id)}>
          <AppIcon name={a.icon} />
          {a.badge && <span className={`app-badge ${a.badge}`} />}
        </button>
      ))}
      <span className="app-sep" aria-hidden />
      {actions.map(a => (
        <button key={a.id} type="button" className={`app-btn ${a.on ? 'on' : ''}`} title={a.title} aria-label={a.title} aria-pressed={a.on} data-tutorial={a.tutorial} onClick={a.onClick}>
          <AppIcon name={a.icon} />
        </button>
      ))}
    </nav>
  );
}

/** A draggable app window. Undragged windows stack under the toolbar; dragging detaches one (double-click the title to re-dock). */
export function AppWindow({ app, pos, scale, onClose, onMove, onDock }: { app: HudApp; pos?: { x: number; y: number }; scale: number; onClose(): void; onMove(x: number, y: number): void; onDock(): void }) {
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
  return (
    <section ref={ref} className={`app-win panel ${pos ? 'floating' : ''}`} aria-label={app.title}
      style={{ width: app.width ?? 270, ...(pos ? { left: pos.x, top: pos.y } : {}) }}>
      <header className="app-win-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onDoubleClick={onDock}
        title="Drag to move · double-click to dock under the toolbar">
        <AppIcon name={app.icon} size={14} />
        <span>{app.title}</span>
        <button type="button" className="app-win-close" onClick={onClose} aria-label={`Close ${app.title}`}>×</button>
      </header>
      <div className="app-win-body">{app.content}</div>
    </section>
  );
}

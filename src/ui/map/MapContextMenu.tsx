import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { MapAction, MapActionId } from './mapActions';
import './mapMenus.css';

/** Keep a floating box inside its positioned parent. */
export function clampToParent(el: HTMLElement | null, x: number, y: number) {
  if (!el) return;
  const parent = el.offsetParent as HTMLElement | null;
  const w = parent?.clientWidth ?? window.innerWidth, h = parent?.clientHeight ?? window.innerHeight;
  el.style.left = `${Math.max(8, Math.min(x, w - el.offsetWidth - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, h - el.offsetHeight - 8))}px`;
}

/** Small popup listing actions for a map object (shared by flight map and Tracking Station). */
export function MapContextMenu({ x, y, title, subtitle, actions, onAction, onClose }: {
  x: number; y: number; title: string; subtitle?: string; actions: MapAction[];
  onAction: (id: MapActionId) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { clampToParent(ref.current, x + 12, y - 8); }, [x, y, actions.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return <div ref={ref} className="panel map-menu" role="menu" aria-label={`${title} actions`} onPointerDown={e => e.stopPropagation()}>
    <div className="map-menu-head"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
    {actions.map(a => <button key={a.id} role="menuitem" className="map-menu-item" onClick={() => onAction(a.id)}>{a.label}</button>)}
  </div>;
}

/** Read-only facts about a body or vessel. */
export function MapInfoCard({ title, rows, onClose, style }: { title: string; rows: [string, ReactNode][]; onClose: () => void; style?: CSSProperties }) {
  return <div className="panel map-info" style={style} onPointerDown={e => e.stopPropagation()}>
    <div className="map-menu-head"><strong>{title}</strong><button className="btn ghost small" aria-label="Close" onClick={onClose}>×</button></div>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}</dl>
  </div>;
}

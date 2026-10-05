import { useEffect, useRef, type ReactNode } from 'react';
import { Button, Slider, Toggle } from '../components';
import { Icon } from '../components/Icon';
import { LIGHT_COLORS, type TweakDescriptor } from '../../sim/vessel/tweaks';
import type { PartTweaks, RcsAxes, WheelMode } from '../../sim/vessel/types';
import './inspector.css';

/**
 * Floating part inspector panels shared by the editor and flight. Panels are anchored to a part's screen position
 * (supplied per frame by the 3D view) with a thin tether; positions update in requestAnimationFrame via refs, never
 * through React state. Headers can be dragged to offset a panel from its part.
 */

export interface InspectorPanelProps { uid: number; pinned: boolean }
export interface InspectorContent { title: string; subtitle?: string; body: ReactNode }

export interface Insets { top: number; right: number; bottom: number; left: number }

export function InspectorLayer({ panels, anchor, content, onClose, onPin, insets = { top: 8, right: 8, bottom: 8, left: 8 } }: {
  panels: InspectorPanelProps[];
  /** Part centre in CSS px relative to the layer, or null when off-screen. */
  anchor: (uid: number) => { x: number; y: number } | null;
  content: (uid: number) => InspectorContent | null;
  onClose: (uid: number) => void;
  onPin: (uid: number) => void;
  /** Screen margins kept clear (fixed toolbars and side panels). */
  insets?: Insets;
}) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const offsets = useRef(new Map<number, { x: number; y: number }>());
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const root = host.current, lines = svg.current;
      if (!root || !lines) return;
      const W = root.clientWidth, H = root.clientHeight;
      const m = insetsRef.current;
      const els = [...root.querySelectorAll<HTMLElement>('.insp-panel')];
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const overlaps = (r: { x: number; y: number; w: number; h: number }) => placed.find(q => r.x < q.x + q.w + 6 && q.x < r.x + r.w + 6 && r.y < q.y + q.h + 6 && q.y < r.y + r.h + 6);
      const clampX = (x: number, w: number) => Math.max(m.left, Math.min(W - w - m.right, x));
      const clampY = (y: number, h: number) => Math.max(m.top, Math.min(H - h - m.bottom, y));
      let path = '';
      els.forEach((el) => {
        const uid = Number(el.dataset.uid);
        const a = anchorRef.current(uid);
        const manual = offsets.current.get(uid);
        const off = manual ?? { x: 46, y: -36 };
        const w = el.offsetWidth, h = el.offsetHeight;
        const base = a ?? { x: Number(el.dataset.lx ?? W / 2), y: Number(el.dataset.ly ?? H / 2) };
        if (a) { el.dataset.lx = String(a.x); el.dataset.ly = String(a.y); }
        let x = base.x + off.x, y = base.y + off.y - h / 2;
        // Flip to the left of the part near the right edge; keep inside the free screen area.
        if (x + w > W - m.right && off.x > 0) x = base.x - off.x - w;
        x = clampX(x, w); y = clampY(y, h);
        if (!manual) {
          // Avoid earlier panels: try the other side of the part, then stack below/above the blocker.
          const other = { x: clampX(base.x - off.x - w, w), y, w, h };
          if (overlaps({ x, y, w, h }) && !overlaps(other)) x = other.x;
          for (let guard = 0; guard < 8; guard++) {
            const hit = overlaps({ x, y, w, h });
            if (!hit) break;
            const below = hit.y + hit.h + 8;
            y = below + h <= H - m.bottom ? below : clampY(hit.y - h - 8, h);
            if (y === clampY(hit.y - h - 8, h) && overlaps({ x, y, w, h })) { x = clampX(hit.x + hit.w + 8, w); y = clampY(base.y + off.y - h / 2, h); }
          }
        }
        placed.push({ x, y, w, h });
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.classList.toggle('lost', !a);
        if (a) {
          const ex = Math.max(x, Math.min(x + w, a.x)), ey = Math.max(y, Math.min(y + h, a.y));
          path += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
          path += `M${(a.x + 3).toFixed(1)} ${a.y.toFixed(1)}a3 3 0 1 0 -6 0a3 3 0 1 0 6 0`;
        }
      });
      const p = lines.firstElementChild as SVGPathElement | null;
      if (p && p.getAttribute('d') !== path) p.setAttribute('d', path);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const drag = (uid: number) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const start = { x: e.clientX, y: e.clientY };
    const panel = (e.currentTarget as HTMLElement).closest('.insp-panel') as HTMLElement;
    const rect = panel.getBoundingClientRect(), root = host.current!.getBoundingClientRect();
    const lx = Number(panel.dataset.lx ?? 0), ly = Number(panel.dataset.ly ?? 0);
    // Start from the panel's current placement so dragging does not jump.
    const o0 = offsets.current.get(uid) ?? { x: rect.left - root.left - lx, y: rect.top - root.top + rect.height / 2 - ly };
    const move = (ev: PointerEvent) => offsets.current.set(uid, { x: o0.x + ev.clientX - start.x, y: o0.y + ev.clientY - start.y });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={host} className="insp-layer">
      <svg ref={svg} className="insp-tethers" aria-hidden="true"><path /></svg>
      {panels.map(({ uid, pinned }) => {
        const c = content(uid);
        if (!c) return null;
        return (
          <section key={uid} data-uid={uid} className={`insp-panel panel ${pinned ? 'pinned' : ''}`} aria-label={`${c.title} details`} onContextMenu={e => e.preventDefault()}>
            <header className="insp-head" onPointerDown={drag(uid)}>
              <div className="insp-title">
                <strong>{c.title}</strong>
                {c.subtitle && <span>{c.subtitle}</span>}
              </div>
              <Button className={`insp-icon ${pinned ? 'on' : ''}`} title={pinned ? 'Unpin (closes with the next selection)' : 'Pin: keep open while inspecting other parts'} aria-pressed={pinned} onClick={() => onPin(uid)}>
                <PinGlyph />
              </Button>
              <Button className="insp-icon" title="Close (Esc)" aria-label="Close" onClick={() => onClose(uid)}><Icon name="close" size={14} /></Button>
            </header>
            <div className="insp-body">{c.body}</div>
          </section>
        );
      })}
    </div>
  );
}

function PinGlyph() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M9 3h6l-1 6 4 4H6l4-4-1-6zM12 13v8" /></svg>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <div className="insp-section"><div className="insp-section-head"><span className="label">{title}</span>{aside}</div>{children}</div>;
}

export function StatRows({ rows }: { rows: [string, ReactNode, ('good' | 'warn' | 'bad' | undefined)?][] }) {
  return <dl className="insp-stats">{rows.map(([k, v, tone]) => <div key={k}><dt>{k}</dt><dd className={`mono ${tone ?? ''}`}>{v}</dd></div>)}</dl>;
}

export function Bar({ label, value, max, color, right, tone }: { label: string; value: number; max: number; color: string; right?: string; tone?: 'warn' | 'bad' }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="insp-bar">
      <div className="insp-bar-label"><span>{label}</span><span className={`mono ${tone ?? ''}`}>{right ?? `${value.toFixed(0)} / ${max.toFixed(0)}`}</span></div>
      <div className="insp-bar-track"><div style={{ width: `${f * 100}%`, background: color }} /></div>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const AXES: [keyof RcsAxes, string, string][] = [['pitch', 'Pitch', 'Rotation'], ['yaw', 'Yaw', 'Rotation'], ['roll', 'Roll', 'Rotation'], ['fore', 'Fore', 'Translation'], ['lateral', 'Lateral', 'Translation'], ['vertical', 'Vertical', 'Translation']];

/** Generic controls for a part's tweak descriptors. Values are reported as partial tweak objects. */
export function TweakControls({ descriptors, tweaks, onChange, disabled }: { descriptors: TweakDescriptor[]; tweaks: PartTweaks | undefined; onChange: (t: PartTweaks) => void; disabled?: boolean }) {
  const t = tweaks ?? {};
  return <div className="insp-controls">{descriptors.map(d => {
    switch (d.kind) {
      case 'percent': {
        const v = (t[d.key] as number | undefined) ?? 1;
        return <label key={d.key} className="insp-row slider"><span>{d.label}</span><span className="mono">{pct(v)}</span>
          <Slider aria-label={d.label} min={0} max={100} step={d.step} value={v * 100} disabled={disabled} onChange={e => onChange({ [d.key]: Number(e.target.value) / 100 })} /></label>;
      }
      case 'number': {
        const v = (t[d.key] as number | undefined) ?? d.fallback;
        return <label key={d.key} className="insp-row slider"><span>{d.label}</span><span className="mono">{v.toLocaleString('en-US')} {d.unit}</span>
          <Slider aria-label={d.label} min={d.min} max={d.max} step={d.step} value={v} disabled={disabled} onChange={e => onChange({ [d.key]: Number(e.target.value) })} /></label>;
      }
      case 'toggle': {
        const v = (t[d.key] as boolean | undefined) ?? d.fallback;
        return <label key={d.key} className="insp-row"><span>{d.label}</span><Toggle aria-label={d.label} checked={v} disabled={disabled} onChange={e => onChange({ [d.key]: e.target.checked })} /></label>;
      }
      case 'select':
        return <label key={d.key} className="insp-row"><span>{d.label}</span>
          <select aria-label={d.label} disabled={disabled} value={t.wheelMode ?? 'normal'} onChange={e => onChange({ wheelMode: e.target.value as WheelMode })}>
            {d.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>;
      case 'axes': {
        const axes = t.rcsAxes ?? {};
        return <div key={d.key} className="insp-row axes"><span>{d.label}</span><div className="insp-axes" role="group" aria-label="Thruster axes">
          {AXES.map(([k, label, group]) => <Button key={k} className={`insp-chip ${axes[k] !== false ? 'on' : ''}`} title={`${group}: ${label}`} aria-pressed={axes[k] !== false} disabled={disabled}
            onClick={() => onChange({ rcsAxes: { ...axes, [k]: axes[k] === false } })}>{label}</Button>)}
        </div></div>;
      }
      case 'color': {
        const v = t.lightColor ?? d.fallback;
        return <div key={d.key} className="insp-row"><span>{d.label}</span><div className="insp-swatches" role="radiogroup" aria-label="Lamp colour">
          {LIGHT_COLORS.map(c => <button key={c} type="button" role="radio" aria-checked={v === c} aria-label={c} disabled={disabled} className={`insp-swatch ${v === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ lightColor: c })} />)}
        </div></div>;
      }
    }
  })}</div>;
}

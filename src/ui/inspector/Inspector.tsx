import { lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Slider } from '../components';
import { Icon } from '../components/Icon';
import { LIGHT_COLORS, type TweakDescriptor } from '../../sim/vessel/tweaks';
import type { PartTweaks, RcsAxes, WheelMode } from '../../sim/vessel/types';
import { frameProfiler as prof } from '../../util/frameProfiler';
import { useEscape } from '../nav/escape';
import { createPlacements, leader, type Insets, type Point, type Rect } from './placement';
import './inspector.css';

export type { Insets } from './placement';

/**
 * Floating part windows shared by the editor and flight. A window is placed once beside its part when it opens and
 * then stays where it is (or where the player drags it); a leader line drawn per frame links it to the part.
 * Placement is in `placement.ts`; positions are written to the DOM directly, never through React state.
 */

export interface InspectorPanelProps { uid: number; pinned: boolean }
/**
 * `partId` adds a Spacepedia button that opens the part's article over the scene. `subtitle` is the header tooltip,
 * `badge` a short tag after the name (symmetry count). `sig` (optional) summarises everything the body shows: while it
 * is unchanged a re-render of the layer skips the body.
 */
export interface InspectorContent { title: string; subtitle?: string; badge?: string; body: ReactNode; partId?: string; sig?: string }

const PediaQuickLook = lazy(() => import('../Spacepedia').then(m => ({ default: m.PediaQuickLook })));

/** Body re-renders only when its signature changes (or when it has none). */
const Body = memo(({ children }: { sig?: string; children: ReactNode }) => <>{children}</>, (a, b) => a.sig !== undefined && a.sig === b.sig);

/** Leader-line ring radius around the part (px). */
const RING = 6;

export function InspectorLayer({ panels, anchor, anchorInto, content, onClose, onPin, insets = { top: 8, right: 8, bottom: 8, left: 8 }, obstacles, closeOnEscape = false }: {
  panels: InspectorPanelProps[];
  /** Part centre in CSS px relative to the layer, or null when off-screen. */
  anchor: (uid: number) => Point | null;
  /** Allocation-free variant of `anchor` for the per-frame leader lines (falls back to `anchor`). */
  anchorInto?: (uid: number, out: Point) => boolean;
  content: (uid: number) => InspectorContent | null;
  onClose: (uid: number) => void;
  onPin: (uid: number) => void;
  /** Screen margins kept clear when a window opens (fixed toolbars and side panels). */
  insets?: Insets;
  /** Screen boxes (client px) a new window should avoid covering when the free area is full; read once per open. */
  obstacles?: () => Rect[];
  /** Esc closes the topmost window. */
  closeOnEscape?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [pedia, setPedia] = useState<string | null>(null);
  const [book] = useState(createPlacements);
  const els = useRef(new Map<number, HTMLElement>());
  // Stacking order: the most recently opened or touched window is on top (and closes first on Esc).
  const order = useRef(new Map<number, number>());
  const top = useRef(0);
  /** Bumped whenever a window moves, so the leader lines are redrawn even if no part moved. */
  const moved = useRef(0);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const anchorIntoRef = useRef(anchorInto);
  anchorIntoRef.current = anchorInto;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const items = panels.flatMap(p => { const c = content(p.uid); return c ? [{ ...p, c }] : []; });

  const view = () => ({ w: host.current?.clientWidth ?? 0, h: host.current?.clientHeight ?? 0 });
  const write = (uid: number) => {
    const el = els.current.get(uid), p = book.get(uid);
    if (!el || !p) return;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    moved.current++;
  };
  const raise = (uid: number) => {
    if (order.current.get(uid) === top.current && top.current) return;
    order.current.set(uid, ++top.current);
    const el = els.current.get(uid);
    if (el) el.style.zIndex = String(top.current);
    moved.current++;
  };
  const topmost = () => {
    let best: number | null = null, z = -1;
    for (const { uid } of panels) { const o = order.current.get(uid) ?? 0; if (o > z) { z = o; best = uid; } }
    return best;
  };
  useEscape(() => { const uid = topmost(); if (uid !== null) onClose(uid); }, closeOnEscape && items.length > 0, 'panel');

  // Size changes of a window (content, wrapping) and of the layer (viewport) keep windows on screen. Nothing per frame.
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !host.current) return;
    const ro = new ResizeObserver(entries => {
      const v = view();
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (el === host.current) { for (const uid of book.fit(v)) write(uid); continue; }
        const uid = Number(el.dataset.uid);
        const p = book.get(uid);
        if (p && (p.w !== el.offsetWidth || p.h !== el.offsetHeight)) { book.resize(uid, { w: el.offsetWidth, h: el.offsetHeight }, v); write(uid); }
      }
    });
    ro.observe(host.current);
    observer.current = ro;
    return () => { ro.disconnect(); observer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `write`/`view` only read refs and `book`
  }, [book]);

  // Place windows that just opened (once, before paint); forget closed ones.
  const key = items.map(p => p.uid).join(',');
  useLayoutEffect(() => {
    const open = new Set(items.map(p => p.uid));
    book.retain(open);
    for (const uid of order.current.keys()) if (!open.has(uid)) order.current.delete(uid);
    const v = view();
    let blocks: Rect[] | undefined;
    for (const uid of open) {
      const el = els.current.get(uid);
      if (!el || book.has(uid)) continue;
      if (!blocks && obstaclesRef.current && host.current) {
        const o = host.current.getBoundingClientRect();
        blocks = obstaclesRef.current().map(r => ({ x: r.x - o.left, y: r.y - o.top, w: r.w, h: r.h }));
      }
      book.open(uid, anchorRef.current(uid), { w: el.offsetWidth, h: el.offsetHeight }, v, insetsRef.current, blocks);
      write(uid);
      raise(uid);
      observer.current?.observe(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` lists the open windows
  }, [key, book]);

  // Leader lines: part ring + line to the nearest window edge; the topmost window's line is brighter.
  const hasPanels = items.length > 0;
  useEffect(() => {
    const lines = svg.current;
    const [base, hot] = lines ? [...lines.children] as SVGPathElement[] : [];
    if (!hasPanels || !base || !hot) { base?.setAttribute('d', ''); hot?.setAttribute('d', ''); return; }
    let raf = 0, last = new Float64Array(16), lastMoved = -1;
    const pt = { x: 0, y: 0 };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t0 = prof.now();
      const uids = order.current;
      if (last.length < uids.size * 2) last = new Float64Array(uids.size * 4);
      // Redraw only when a part moved by a quarter pixel or a window moved.
      let i = 0, changed = lastMoved !== moved.current;
      for (const uid of uids.keys()) {
        const into = anchorIntoRef.current;
        let ok: boolean;
        if (into) ok = into(uid, pt);
        else { const a = anchorRef.current(uid); ok = !!a; if (a) { pt.x = a.x; pt.y = a.y; } }
        const x = ok ? pt.x : NaN, y = ok ? pt.y : NaN;
        if (!(Math.abs(x - last[i]) < 0.25 && Math.abs(y - last[i + 1]) < 0.25) && !(Number.isNaN(x) && Number.isNaN(last[i]))) { changed = true; last[i] = x; last[i + 1] = y; }
        const el = els.current.get(uid);
        if (el && el.classList.contains('lost') === ok) el.classList.toggle('lost', !ok);
        i += 2;
      }
      if (changed) {
        lastMoved = moved.current;
        let d = '', h = '';
        const hi = topmost();
        i = 0;
        for (const uid of uids.keys()) {
          const x = last[i], y = last[i + 1], p = book.get(uid);
          i += 2;
          if (Number.isNaN(x) || !p) continue;
          const e = leader({ x, y }, p);
          let seg = `M${(x + RING).toFixed(1)} ${y.toFixed(1)}a${RING} ${RING} 0 1 0 ${-2 * RING} 0a${RING} ${RING} 0 1 0 ${2 * RING} 0`;
          if (e) {
            const len = Math.hypot(e.x - x, e.y - y);
            if (len > RING + 2) seg += `M${(x + ((e.x - x) * RING) / len).toFixed(1)} ${(y + ((e.y - y) * RING) / len).toFixed(1)}L${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
          }
          if (uid === hi) h += seg; else d += seg;
        }
        base.setAttribute('d', d);
        hot.setAttribute('d', h);
      }
      prof.add('hud', t0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, [hasPanels, book]);

  const drag = (uid: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const p = book.get(uid);
    if (!p) return;
    const head = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY }, from = { x: p.x, y: p.y };
    head.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => { book.drag(uid, { x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y }, view()); write(uid); };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  };

  return (
    <div ref={host} className="insp-layer">
      <svg ref={svg} className="insp-tethers" aria-hidden="true"><path /><path className="hot" /></svg>
      {items.map(({ uid, pinned, c }) => {
        return (
          <section key={uid} data-uid={uid} ref={el => { if (el) els.current.set(uid, el); else els.current.delete(uid); }}
            className={`insp-panel panel ${pinned ? 'pinned' : ''}`} aria-label={`${c.title} details`}
            onContextMenu={e => e.preventDefault()} onPointerDownCapture={() => raise(uid)} onFocusCapture={() => raise(uid)}>
            <header className="insp-head" onPointerDown={drag(uid)} title={c.subtitle}>
              <strong className="insp-title">{c.title}</strong>
              {c.badge && <span className="insp-badge">{c.badge}</span>}
              {c.partId && <Button className="insp-icon" title="Spacepedia article" aria-label={`${c.title} in Spacepedia`} onClick={() => setPedia(c.partId!)}><Icon name="book" size={14} /></Button>}
              <Button className={`insp-icon ${pinned ? 'on' : ''}`} title={pinned ? 'Pinned: stays open while you inspect other parts' : 'Pin: keep open while inspecting other parts'} aria-label="Pin" aria-pressed={pinned} onClick={() => onPin(uid)}>
                <PinGlyph />
              </Button>
              <Button className="insp-icon" title={closeOnEscape ? 'Close (Esc)' : 'Close'} aria-label="Close" onClick={() => onClose(uid)}><Icon name="close" size={14} /></Button>
            </header>
            <div className="insp-body"><Body sig={c.sig}>{c.body}</Body></div>
          </section>
        );
      })}
      {pedia && <Suspense fallback={null}><PediaQuickLook partId={pedia} onClose={() => setPedia(null)} /></Suspense>}
    </div>
  );
}

/** A state toggle as a button: lit and labelled On while on. */
export function OnOff({ label, on, disabled, onClick, onText = 'On', offText = 'Off' }: { label: string; on: boolean; disabled?: boolean; onClick: () => void; onText?: string; offText?: string }) {
  return <button type="button" className={`insp-onoff ${on ? 'on' : ''}`} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
    <i aria-hidden="true" />{on ? onText : offText}
  </button>;
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

/** One-line gauge: label, bar, value. `title` carries the full reading. */
export function Bar({ label, value, max, color, right, tone, title }: { label: string; value: number; max: number; color: string; right?: string; tone?: 'warn' | 'bad'; title?: string }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="insp-bar" title={title ?? `${label}: ${value.toFixed(0)} / ${max.toFixed(0)}`}>
      <span className="insp-bar-label">{label}</span>
      <div className="insp-bar-track"><div style={{ width: `${f * 100}%`, background: color }} /></div>
      <span className={`insp-bar-value mono ${tone ?? ''}`}>{right ?? value.toFixed(0)}</span>
    </div>
  );
}

/** Small state tags (engine flamed out, parachute armed, docked…). */
export function Chips({ chips }: { chips: { text: string; tone?: 'good' | 'warn' | 'bad'; title?: string }[] }) {
  return chips.length ? <div className="insp-chips">{chips.map(c => <span key={c.text} className={`insp-tag ${c.tone ?? ''}`} title={c.title}>{c.text}</span>)}</div> : null;
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
        return <div key={d.key} className="insp-row"><span>{d.label}</span><OnOff label={d.label} on={v} disabled={disabled} onClick={() => onChange({ [d.key]: !v })} /></div>;
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

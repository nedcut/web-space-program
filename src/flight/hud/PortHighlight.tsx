import { useEffect, useRef, useSyncExternalStore } from 'react';
import './station.css';

/** A part to mark on screen: the active vessel's unless `vesselId` is given. */
export interface PortMark {
  uid: number;
  vesselId?: string;
  tone: 'own' | 'target' | 'hover';
  label?: string;
}

/** Writes a part's screen position (CSS px) into `out`; false when hidden. Must not allocate (runs every frame). */
export type PartScreenInto = (uid: number, vesselId: string | undefined, out: { x: number; y: number }) => boolean;

// Hovered ports from the target / station panels. A tiny external store so hovering re-renders only the overlay.
let hovered: readonly PortMark[] = [];
const listeners = new Set<() => void>();
export const portHover = {
  set(marks: readonly PortMark[] | null) {
    const next = marks ?? [];
    if (next.length === 0 && hovered.length === 0) return;
    hovered = next;
    listeners.forEach(fn => fn());
  },
  get: () => hovered,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

/** Pointer handlers that mark ports while the pointer (or keyboard focus) is on a control. */
export function hoverPorts(marks: PortMark[]) {
  const on = () => portHover.set(marks);
  const off = () => portHover.set(null);
  return { onPointerEnter: on, onPointerLeave: off, onFocus: on, onBlur: off };
}

const markKey = (m: readonly PortMark[]) => m.map(x => `${x.vesselId ?? ''}:${x.uid}:${x.tone}:${x.label ?? ''}`).join('|');

/**
 * Screen-space rings (and short captions) on docking ports: the chosen pair while docking mode is on, plus whatever
 * port the pointer is over in a panel. DOM only (no scene or material change); the frame loop runs only while
 * something is marked, reuses one scratch point and writes transforms in place.
 */
export function PortHighlight({ marks, at, scale }: { marks: readonly PortMark[]; at: PartScreenInto; scale: number }) {
  const hover = useSyncExternalStore(portHover.subscribe, portHover.get);
  const all = hover.length ? [...hover, ...marks.filter(m => !hover.some(h => h.uid === m.uid && h.vesselId === m.vesselId))] : marks;
  const key = markKey(all);
  const host = useRef<HTMLDivElement>(null);
  const list = useRef(all);
  list.current = all;
  useEffect(() => {
    if (!key) return;
    const p = { x: 0, y: 0 };
    // Last written position per ring (NaN = hidden): styles are touched only when a ring moves by half a pixel.
    const last = new Float64Array(64).fill(NaN);
    for (const ring of host.current?.children ?? []) (ring as HTMLElement).style.display = 'none';
    let raf = 0;
    const loop = () => {
      const el = host.current;
      if (el) {
        const ms = list.current;
        for (let i = 0; i < el.children.length && i < ms.length && i < 32; i++) {
          const ring = el.children[i] as HTMLElement;
          const shown = at(ms[i].uid, ms[i].vesselId, p);
          if (!shown) {
            if (!Number.isNaN(last[2 * i])) { ring.style.display = 'none'; last[2 * i] = NaN; }
            continue;
          }
          const x = p.x / scale, y = p.y / scale;
          if (Number.isNaN(last[2 * i])) ring.style.display = '';
          else if (Math.abs(x - last[2 * i]) < 0.5 && Math.abs(y - last[2 * i + 1]) < 0.5) continue;
          last[2 * i] = x; last[2 * i + 1] = y;
          ring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key, at, scale]);
  if (!key) return null;
  return (
    <div ref={host} className="port-hl" aria-hidden>
      {all.map(m => (
        <div key={`${m.vesselId ?? ''}:${m.uid}`} className={`port-hl-ring ${m.tone}`} style={{ display: 'none' }}>
          {m.label && <span className="port-hl-label">{m.label}</span>}
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { game, useGame } from '../../game/store';
import type { SiteObjectId } from '../../render/site/LaunchSite';
import { MenuBackdrop } from '../MenuBackdrop';
import type { HubScene } from './HubScene';

/** What the hover label says about a building (null = not a facility). */
export interface BuildingLabel { title: string; detail: string; key?: string; closed?: boolean }

/**
 * Live 3D launch-complex backdrop for the Space Center (falls back to the 2D backdrop if WebGL fails).
 * Hovering a building names its facility next to the pointer; clicking it calls `onPick`. `highlight` rings a
 * building from the UI (tile hover/focus).
 */
export function HubBackdrop({ onPick, label, highlight = null }: {
  onPick?: (id: SiteObjectId) => void;
  label?: (id: SiteObjectId) => BuildingLabel | null;
  highlight?: SiteObjectId | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const hub = useRef<HubScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<SiteObjectId | null>(null);
  const quality = useGame((s) => s.settings.quality);
  const preset = useGame((s) => s.scalePreset);
  const craft = useGame((s) => s.craft);
  const latest = useRef({ onPick, label });
  latest.current = { onPick, label };
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  useEffect(() => {
    let disposed = false;
    import('./HubScene')
      .then(({ HubScene }) => {
        if (disposed || !host.current) return;
        const g = game.get();
        try {
          hub.current = new HubScene(host.current, {
            preset,
            quality,
            ut: g.ut,
            craft: g.craft,
            onReady: () => { if (!disposed) setReady(true); },
            onPick: (id) => latest.current.onPick?.(id),
            // Called at most every 50 ms while the pointer moves: position the label directly, re-render on change only.
            onHover: (id, x, y) => {
              const el = tip.current;
              if (el && id) el.style.transform = `translate(${Math.min(x + 18, window.innerWidth - 280)}px, ${y + 20}px)`;
              setHovered(id);
            },
          });
          hub.current.highlight(highlightRef.current);
        } catch (e) {
          console.warn('Hub 3D scene failed, using 2D backdrop', e);
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    setReady(false);
    return () => {
      disposed = true;
      hub.current?.dispose();
      hub.current = null;
    };
  }, [quality, preset]);

  useEffect(() => {
    hub.current?.setCraft(craft);
  }, [craft]);

  useEffect(() => { hub.current?.highlight(highlight); }, [highlight]);

  if (failed) return <MenuBackdrop />;
  const info = hovered ? latest.current.label?.(hovered) : null;
  return (
    <>
      <div ref={host} className="fullscreen" style={{ background: '#05070c' }} />
      {!ready && <div className="fullscreen hub-preparing label" role="status">Preparing the launch complex…</div>}
      <div ref={tip} className={`hub-hover photo-hide${info ? ' on' : ''}${info?.closed ? ' closed' : ''}`} aria-hidden="true">
        {info && <><strong>{info.title}</strong>{info.key && <span className="kbd">{info.key}</span>}<small>{info.detail}</small></>}
      </div>
    </>
  );
}

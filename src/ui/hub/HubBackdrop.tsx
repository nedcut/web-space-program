import { useEffect, useRef, useState } from 'react';
import { game, useGame } from '../../game/store';
import { MenuBackdrop } from '../MenuBackdrop';
import type { HubScene } from './HubScene';

/**
 * Live 3D launch-complex backdrop for the Space Center (falls back to the 2D backdrop if WebGL fails).
 * Clicking the assembly building opens the editor; clicking the pad launches the current craft.
 */
export function HubBackdrop() {
  const host = useRef<HTMLDivElement>(null);
  const hub = useRef<HubScene | null>(null);
  const [failed, setFailed] = useState(false);
  const quality = useGame((s) => s.settings.quality);
  const preset = useGame((s) => s.scalePreset);
  const craft = useGame((s) => s.craft);

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
            onPick: (id) => {
              const s = game.get();
              if (id === 'vab') game.set({ scene: 'editor' });
              else if (id === 'pad' && s.craft) game.set({ scene: 'flight', launchPending: true });
            },
          });
        } catch (e) {
          console.warn('Hub 3D scene failed, using 2D backdrop', e);
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      hub.current?.dispose();
      hub.current = null;
    };
  }, [quality, preset]);

  useEffect(() => {
    hub.current?.setCraft(craft);
  }, [craft]);

  if (failed) return <MenuBackdrop />;
  return <div ref={host} className="fullscreen" style={{ background: '#05070c' }} />;
}

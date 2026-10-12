import type { ReactNode } from 'react';
import { Button } from '../components';
import { Icon } from '../components/Icon';
import { game, useGame } from '../../game/store';
import { facilities, type FacilityScene } from './scenes';
import { useEscape } from './escape';
import './nav.css';

/**
 * Shared header for full-page Space Center facilities: a back control (also Esc) and a switcher that
 * jumps straight to another facility, so moving between buildings never needs a trip through the hub.
 * `onLeave` runs before any navigation (screens flush their program save there).
 */
export function SceneHeader({ scene, kicker, title, subtitle, aside, onLeave }: {
  scene: FacilityScene; kicker: ReactNode; title: string; subtitle?: ReactNode; aside?: ReactNode; onLeave?: () => void;
}) {
  const mode = useGame(s => s.mode);
  const go = (to: FacilityScene | 'spaceCenter') => { onLeave?.(); game.set({ scene: to }); };
  useEscape(() => go('spaceCenter'), true, 'screen');
  return <header className="scene-header">
    <div className="scene-header-bar">
      <Button className="btn ghost small scene-back" onClick={() => go('spaceCenter')} aria-keyshortcuts="Escape">
        <Icon name="arrow" size={14} /> Space Center <span className="kbd">Esc</span>
      </Button>
      <nav className="scene-switcher" aria-label="Space Center facilities">
        {facilities(mode).map(f => <Button key={f.scene} className={`btn ghost small ${f.scene === scene ? 'on' : ''}`}
          aria-current={f.scene === scene ? 'page' : undefined} onClick={() => f.scene !== scene && go(f.scene)}>
          <Icon name={f.icon} size={14} />{f.label}
        </Button>)}
      </nav>
    </div>
    <div className="scene-header-main">
      <div><div className="label">{kicker}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {aside}
    </div>
  </header>;
}

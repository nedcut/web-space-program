import type { ReactNode } from 'react';
import { Button } from '../components';
import { Icon } from '../components/Icon';
import { useEscape } from './escape';
import './nav.css';

/**
 * Header for library screens outside the Space Center (Training, Challenges, Spacepedia): the same back
 * control as `SceneHeader` in the same place (top left, also Esc), without the facility switcher.
 */
export function MenuScreenHeader({ backLabel = 'Main menu', onBack, kicker, title, subtitle, aside }: {
  backLabel?: string; onBack: () => void; kicker: ReactNode; title: string; subtitle?: ReactNode; aside?: ReactNode;
}) {
  useEscape(onBack, true, 'screen');
  return <header className="scene-header menu-screen-header">
    <div className="scene-header-bar">
      <Button className="btn ghost small scene-back" onClick={onBack} aria-keyshortcuts="Escape">
        <Icon name="arrow" size={14} /> {backLabel} <span className="kbd">Esc</span>
      </Button>
    </div>
    <div className="scene-header-main">
      <div><div className="label">{kicker}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {aside}
    </div>
  </header>;
}

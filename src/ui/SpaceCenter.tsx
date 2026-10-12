import { Icon } from './components/Icon';
import { Panel, Button, PromptModal } from './components';
import { photoMode } from '../game/photoMode';
import { openProgram } from '../game/program';
import { saveNamedWorld } from '../game/persistence';
import { saveErrorText } from '../game/storageErrors';
import { launchProblem } from '../data/technology';
import { PART_CATALOG } from '../data/parts';
import { newProgression } from '../sim/science/progression';
import { useEffect, useRef, useState } from 'react';
import { game, launchableCraft, useGame } from '../game/store';
import { HubBackdrop } from './hub/HubBackdrop';
import { SettingsPanel } from './MainMenu';
import { formatDate } from './format';
import { arrowNav } from './nav/arrowNav';
import { facilityLabel } from './nav/scenes';
import './nav/nav.css';

/** Hub screen over a live 3D view of the launch complex. */
export function SpaceCenter() {
  const mode = useGame(s => s.mode);
  const p = useGame(s => s.resumeWorld?.progression);
  const [notice, setNotice] = useState(() => game.get().notice ?? '');
  useEffect(() => { if (game.get().notice) game.set({ notice: null }); }, []);
  const ut = useGame((s) => s.ut);
  const craft = useGame((s) => launchableCraft(s.craft));
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  const tiles = [
    { id: 'editor', title: facilityLabel('editor'), desc: 'Design and build rockets', onClick: () => game.set({ scene: 'editor' }) },
    {
      id: 'launch',
      title: craft?.type === 'SPH' ? 'Runway' : 'Launch Pad',
      desc: craft ? `Ready: ${craft.name}` : 'Build a vehicle first',
      disabled: !craft,
      onClick: () => {
        if (!craft) return;
        const problem = launchProblem(craft, PART_CATALOG, mode, p ?? newProgression());
        if (problem) setNotice(problem);
        else game.set({ scene: 'flight', launchPending: true });
      },
    },
    { id: 'flightlog', title: facilityLabel('flightlog'), desc: 'Flight reports, history and achievements', onClick: () => game.set({ scene: 'flightlog' }) },
    { id: 'tracking', title: facilityLabel('tracking'), desc: 'Track vessels and explore the solar system', onClick: () => game.set({ scene: 'tracking' }) },
    ...(mode !== 'sandbox' ? [{ id: 'research', title: facilityLabel('research'), desc: `${(p?.science ?? 0).toFixed(1)} science · Explore the technology tree`, onClick: () => game.set({ scene: 'research' }) }] : []),
    ...(mode === 'career' ? [{ id: 'missions', title: facilityLabel('missions'), desc: 'Commission expeditions and track contracts', onClick: () => game.set({ scene: 'missions' }) }] : []),
  ];

  // Number keys enter the facility on the matching tile (shown on each tile).
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || photoMode.get().active || document.querySelector('[data-settings-modal], dialog[open]')) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
      const tile = /^Digit[1-9]$/.test(e.code) ? tilesRef.current[+e.code.slice(5) - 1] : undefined;
      if (!tile || tile.disabled) return;
      e.preventDefault();
      tile.onClick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fullscreen">
      <HubBackdrop />
      <div className="fullscreen photo-hide hub-composition">
        <div className="hub-header">
          <div>
            <div className="label">Coastal Launch Complex</div>
            <h2 style={{ fontWeight: 300, letterSpacing: '0.2em', margin: '6px 0 0' }}>SPACE CENTER</h2>
          </div>
          <div className="mono" style={{ color: 'var(--text)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>{formatDate(ut)}</div>
        </div>
        <div style={{ marginTop: 16, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }} className="mono">{mode.toUpperCase()}{mode === 'career' && ` · ${(p?.funds ?? 60000).toLocaleString()} cr · ${p?.reputation ?? 0} reputation`}</div>
        <div style={{ flex: 1 }} />
        {notice && <Panel role="status" className="panel" style={{ alignSelf: 'flex-start', padding: '8px 14px', marginBottom: 12, background: 'rgba(8, 13, 22, 0.85)' }}>{notice}</Panel>}
        <div className="hub-tiles" onKeyDown={e => arrowNav(e)}>
          {tiles.map((t, i) => (
            <Button
              key={t.id}
              className="panel btn hub-tile"
              disabled={t.disabled}
              onClick={t.onClick}
              aria-keyshortcuts={String(i + 1)}
            >
              <Icon name={t.id === 'editor' ? 'build' : t.id === 'launch' ? 'rocket' : t.id === 'tracking' ? 'orbit' : t.id === 'research' ? 'science' : 'log'} size={24} />
              <strong>{t.title}</strong><small>{t.desc}</small><span className="kbd hub-key" aria-hidden="true">{i + 1}</span>
            </Button>
          ))}
        </div>
        <div className="hub-actions">
          <Button className="btn small" onClick={() => setSaving(true)}>Save as…</Button>
          <Button className="btn small" onClick={() => game.set({ scene: 'menu' })}>Main menu</Button>
          <Button className="btn" onClick={() => void import('./Spacepedia').then(m => m.openPedia('spaceCenter'))}>Spacepedia</Button>
          <Button className="btn small" onClick={() => photoMode.open()}>Photo mode</Button>
          <Button className="btn small" onClick={() => setSettings((v) => !v)}>Settings</Button>
        </div>
        {settings && <SettingsPanel onClose={() => setSettings(false)} />}
        {saving && <PromptModal title="Save program" label="Save slot name" initial="Program save" onCancel={() => setSaving(false)}
          onSubmit={name => { setSaving(false); try { saveNamedWorld(name, openProgram()); setNotice('Program saved.'); } catch (e) { setNotice(saveErrorText(e)); } }} />}
      </div>
    </div>
  );
}

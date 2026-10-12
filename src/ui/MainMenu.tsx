import { Icon } from './components/Icon';
import { Button, Panel, Segmented } from './components';
import { SaveLoadDialog, readSaveSlots } from './SaveLoadDialog';
import { MultiplayerSetup } from '../net/MultiplayerPanel';
import { SettingsPanel } from './SettingsPanel';
export { SettingsPanel } from './SettingsPanel';
import type { GameMode } from '../sim/science/progression';
import { World } from '../game/world';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { saveProgram } from '../game/program';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape } from './nav/escape';
import { arrowNav, focusFirst } from './nav/arrowNav';
import { game, DEFAULT_START_UT } from '../game/store';
import { SCALE_PRESETS, type ScalePresetId } from '../sim/bodies/scale';
import { MenuBackdrop } from './MenuBackdrop';
import { UnsupportedNotice } from './Unsupported';
import { resumeSave } from '../game/persistence';
import { latestSaveSlot } from '../game/saveSlots';
import { programTitle, saveWhere, savedAgo } from './saveSummary';
import './menu.css';

const SCALE_INFO: Record<ScalePresetId, { label: string; blurb: string }> = {
  standard: { label: 'Standard', blurb: '1/10 scale. Forgiving and fun — orbit needs about 3.4 km/s.' },
  challenging: { label: 'Challenging', blurb: 'About 1/3 scale. Bigger rockets, longer burns.' },
  real: { label: 'Real Scale', blurb: 'The actual solar system. Orbit needs about 9.4 km/s. Good luck.' },
};
const MODES = ['Sandbox', 'Science', 'Career'] as const;
const MODE_INFO: Record<GameMode, string> = {
  sandbox: 'All parts available. Build freely, without costs.',
  science: 'Explore, collect science and unlock new technology. Unlimited construction.',
  career: 'Grow a funded program through research, contracts and expeditions. Starts with 60,000 cr.',
};

function startProgram(mode: GameMode, scale: ScalePresetId) {
  const world = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT, mode);
  // Program-scoped lookups isolate old quicksaves; retain them for legacy migration.
  // Clear the editor with the program switch so neither the first autosave nor the
  // new program's draft inherits the previous program's craft.
  game.set({ saveId: `${mode}-${Date.now()}`, craft: null });
  saveProgram(world);
  game.set({ mode, scalePreset: scale, craft: null, launchPending: false, ut: DEFAULT_START_UT, scene: 'spaceCenter' });
}

export function MainMenu() {
  const [panel, setPanel] = useState<'root' | 'new' | 'settings' | 'multiplayer' | 'load'>('root');
  const [mode, setMode] = useState<GameMode>('sandbox');
  const [scale, setScale] = useState<ScalePresetId>('standard');
  // Re-read on return to the root list (Load may have imported or deleted saves). Never per frame.
  const latest = useMemo(() => panel === 'root' || panel === 'new' ? latestSaveSlot(readSaveSlots()) : null, [panel]);
  // Esc steps back to the root list; keyboard focus follows the open panel and returns to its opener.
  const sub = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const opener = useRef('');
  const open = (next: typeof panel) => { opener.current = document.activeElement?.getAttribute('data-menu') ?? ''; setPanel(next); };
  useEscape(() => setPanel('root'), panel !== 'root' && panel !== 'settings', 'screen');
  useEffect(() => {
    if (panel !== 'root') return focusFirst(sub.current);
    // The root list re-mounts: focus the button that opened the panel, else the default action (Enter continues).
    const target = opener.current && actions.current?.querySelector<HTMLElement>(`[data-menu="${opener.current}"]`);
    (target || actions.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }, [panel]);

  return (
    <div className="fullscreen">
      <MenuBackdrop />
      <div className="fullscreen menu-composition">
        <div className="label menu-kicker"><Icon name="orbit" /> A solar system of possibilities</div>
        <h1 className="menu-title">WEB SPACE<span>PROGRAM</span></h1>
        <p className="menu-caption">Build with purpose. Fly with curiosity.</p>

        {panel === 'root' && (
          <div ref={actions} className="menu-actions" onKeyDown={e => arrowNav(e)}>
            {latest && <Button className="btn primary menu-continue" data-menu="continue" onClick={() => resumeSave(latest)}>
              <Icon name="launch" /><span className="menu-continue-text">Continue<small>{programTitle(latest.programId, latest.data.mode).split(' · ')[0]} · {saveWhere(latest)} · {savedAgo(latest.savedAt)}</small></span><span className="menu-go"><Icon name="arrow" /></span>
            </Button>}
            <Button className={`btn${latest ? '' : ' primary'}`} data-menu="new" onClick={() => open('new')}><Icon name="rocket" />New Game{!latest && <span className="menu-go"><Icon name="arrow" /></span>}</Button>
            <Button className="btn" data-menu="load" onClick={() => open('load')}><Icon name="load" />Load…</Button>
            <Button className="btn" data-menu="challenges" onClick={() => game.set({ scene: 'scenarios' })}><Icon name="orbit" />Challenges</Button>
            <Button className="btn" data-menu="training" onClick={() => game.set({ scene: 'training' })}><Icon name="science" />Training</Button>
            <Button className="btn" data-menu="pedia" onClick={() => void import('./Spacepedia').then(m => m.openPedia('menu'))}><Icon name="book" />Spacepedia</Button>
            <Button className="btn" data-menu="settings" onClick={() => open('settings')}><Icon name="settings" />Settings</Button>
            <Button className="btn menu-wide" data-menu="multiplayer" onClick={() => open('multiplayer')}><Icon name="orbit" />Multiplayer (experimental)</Button>
          </div>
        )}
        {panel === 'root' && <UnsupportedNotice />}

        {panel === 'new' && (
          <div ref={sub}><Panel className="menu-new">
            {/* A form: Enter anywhere (including on a scale choice) starts with the current choices. */}
            <form onSubmit={e => { e.preventDefault(); startProgram(mode, scale); }}>
              <h2 className="menu-panel-title">New program</h2>
              <div className="label menu-field-label">Program mode</div>
              <Segmented label="Program mode" options={MODES} value={MODES.find(m => m.toLowerCase() === mode)!} onChange={m => setMode(m.toLowerCase() as GameMode)} className="menu-mode" />
              <p className="menu-mode-blurb">{MODE_INFO[mode]}</p>
              <fieldset className="menu-scales">
                <legend className="label menu-field-label">Solar system scale</legend>
                {(Object.keys(SCALE_PRESETS) as ScalePresetId[]).map(id => (
                  <label key={id} className={`panel menu-scale${scale === id ? ' on' : ''}`}>
                    <input type="radio" name="scale" checked={scale === id} onChange={() => setScale(id)} className="scale-radio" />
                    <strong>{SCALE_INFO[id].label}</strong>
                    <span>{SCALE_INFO[id].blurb}</span>
                  </label>
                ))}
              </fieldset>
              {latest && <p className="menu-note">Your other programs stay available under Load.</p>}
              <div className="menu-panel-actions">
                <Button className="btn ghost" onClick={() => setPanel('root')}>Back</Button>
                <Button type="submit" className="btn primary">Start</Button>
              </div>
            </form>
          </Panel></div>
        )}

        {panel === 'load' && <div ref={sub} className="menu-load"><SaveLoadDialog onClose={() => setPanel('root')} /></div>}
        {panel === 'multiplayer' && <div ref={sub}><MultiplayerSetup onBack={() => setPanel('root')} /></div>}
        {panel === 'settings' && <SettingsPanel onClose={() => setPanel('root')} />}
      </div>
      <div className="label menu-version">v0.1 · pre-alpha</div>
    </div>
  );
}

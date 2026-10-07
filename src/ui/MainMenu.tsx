import { Icon } from './components/Icon';
import { Button, Panel } from './components';
import { SaveLoadDialog } from './SaveLoadDialog';
import { MultiplayerSetup } from '../net/MultiplayerPanel';
import { SettingsPanel } from './SettingsPanel';
export { SettingsPanel } from './SettingsPanel';
import type { GameMode } from '../sim/science/progression';
import { World } from '../game/world';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { saveProgram } from '../game/program';
import { useState } from 'react';
import { game, DEFAULT_START_UT } from '../game/store';
import { SCALE_PRESETS, type ScalePresetId } from '../sim/bodies/scale';
import { MenuBackdrop } from './MenuBackdrop';
import { UnsupportedNotice } from './Unsupported';
import { hasSave } from '../game/persistence';

const SCALE_INFO: Record<ScalePresetId, { label: string; blurb: string }> = {
  standard: { label: 'Standard', blurb: '1/10 scale. Forgiving and fun — orbit needs about 3.4 km/s.' },
  challenging: { label: 'Challenging', blurb: 'About 1/3 scale. Bigger rockets, longer burns.' },
  real: { label: 'Real Scale', blurb: 'The actual solar system. Orbit needs about 9.4 km/s. Good luck.' },
};

export function MainMenu() {
  const [panel, setPanel] = useState<'root' | 'new' | 'settings' | 'multiplayer' | 'load'>('root');
  const [mode, setMode] = useState<GameMode>('sandbox');
  const [scale, setScale] = useState<ScalePresetId>('standard');

  return (
    <div className="fullscreen">
      <MenuBackdrop />
      <div className="fullscreen menu-composition">
        <div className="label menu-kicker"><Icon name="orbit" /> A solar system of possibilities</div>
        <h1 className="menu-title">WEB SPACE<span>PROGRAM</span></h1>
        <p className="menu-caption">Build with purpose. Fly with curiosity.</p>

        {panel === 'root' && (
          <div className="menu-actions">
            <Button className="btn primary" onClick={() => setPanel('new')}><Icon name="rocket" />New Game<span className="menu-go"><Icon name="arrow" /></span></Button>
            <Button className="btn" onClick={() => setPanel('load')}><Icon name="log" />Continue</Button>
            <Button className="btn" onClick={() => setPanel('multiplayer')}><Icon name="orbit" />Multiplayer (experimental)</Button>
            <Button className="btn" onClick={() => game.set({ scene: 'scenarios' })}><Icon name="orbit" />Scenarios · Missions</Button>
            <Button className="btn" onClick={() => game.set({ scene: 'training' })}><Icon name="science" />Training</Button>
            <Button className="btn" onClick={() => void import('./Spacepedia').then(m => m.openPedia('menu'))}><Icon name="book" />Spacepedia</Button>
            <Button className="btn" onClick={() => setPanel('settings')}><Icon name="settings" />Settings</Button>
          </div>
        )}
        {panel === 'root' && <UnsupportedNotice />}

        {panel === 'new' && (
          <Panel className="menu-new">
            <div className="label" style={{ marginBottom: 8 }}>Program mode</div>
            <div className="seg" style={{ marginBottom: 8 }}>
              {(['sandbox', 'science', 'career'] as GameMode[]).map(id => <Button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{id[0].toUpperCase() + id.slice(1)}</Button>)}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', minHeight: 32 }}>{mode === 'sandbox' ? 'All parts available. Build freely, without costs.' : mode === 'science' ? 'Explore, collect science and unlock new technology. Unlimited construction.' : 'Grow a funded program through research, contracts and expeditions. Starts with 60,000 cr.'}</p>
            <div className="label" style={{ marginBottom: 12 }}>Solar system scale</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.keys(SCALE_PRESETS) as ScalePresetId[]).map((id) => (
                <label
                  key={id}
                  className="panel"
                  style={{
                    padding: 12,
                    cursor: 'pointer',
                    borderColor: scale === id ? 'var(--accent)' : undefined,
                    background: scale === id ? 'rgba(92,200,255,0.1)' : undefined,
                  }}
                >
                  <input type="radio" name="scale" checked={scale === id} onChange={() => setScale(id)} className="scale-radio" />
                  <div style={{ fontWeight: 600 }}>{SCALE_INFO[id].label}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{SCALE_INFO[id].blurb}</div>
                </label>
              ))}
            </div>
            {hasSave('autosave') && (
              <p style={{ fontSize: 12, color: 'var(--warn)', margin: '14px 0 0' }}>Previous programs remain available in Continue.</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Button className="btn ghost" onClick={() => setPanel('root')}>Back</Button>
              <Button
                className="btn primary"
                onClick={() => {
                  const world = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT, mode);
                  // Program-scoped lookups isolate old quicksaves; retain them for legacy migration.
                  // Clear the editor with the program switch so neither the first autosave nor the
                  // new program's draft inherits the previous program's craft.
                  game.set({ saveId: `${mode}-${Date.now()}`, craft: null });
                  saveProgram(world);
                  game.set({ mode, scalePreset: scale, craft: null, launchPending: false, ut: DEFAULT_START_UT, scene: 'spaceCenter' });
                }}
              >
                Start
              </Button>
            </div>
          </Panel>
        )}

        {panel === 'load' && <SaveLoadDialog onClose={() => setPanel('root')} />}
        {panel === 'multiplayer' && <MultiplayerSetup onBack={() => setPanel('root')} />}
        {panel === 'settings' && <SettingsPanel onClose={() => setPanel('root')} />}
      </div>
      <div style={{ position: 'absolute', bottom: 16, right: 20 }} className="label">v0.1 · pre-alpha</div>
    </div>
  );
}

import { MultiplayerSetup } from '../net/MultiplayerPanel';
import { SettingsPanel } from './SettingsPanel';
export { SettingsPanel } from './SettingsPanel';
import type { GameMode } from '../sim/science/progression';
import { World } from '../game/world';
import { Universe } from '../game/universe';
import { PART_CATALOG } from '../data/parts';
import { saveProgram } from '../game/program';
import { useState } from 'react';
import { game, DEFAULT_START_UT, loadLastCraft } from '../game/store';
import { SCALE_PRESETS, type ScalePresetId } from '../sim/bodies/scale';
import { MenuBackdrop } from './MenuBackdrop';
import { deleteSave, hasSave, loadWorldFromStorage } from '../game/persistence';

function continueGame() {
  const save = loadWorldFromStorage('autosave') ?? loadWorldFromStorage('quicksave');
  if (!save) return game.set({ scene: 'spaceCenter' });
  game.set({ resumeWorld: save.data, mode: save.data.mode ?? 'sandbox', scalePreset: save.data.preset, ut: save.data.ut, launchPending: false, craft: game.get().craft ?? loadLastCraft(), scene: 'spaceCenter' });
}

const SCALE_INFO: Record<ScalePresetId, { label: string; blurb: string }> = {
  standard: { label: 'Standard', blurb: '1/10 scale. Forgiving and fun — orbit needs about 3.4 km/s.' },
  challenging: { label: 'Challenging', blurb: 'About 1/3 scale. Bigger rockets, longer burns.' },
  real: { label: 'Real Scale', blurb: 'The actual solar system. Orbit needs about 9.4 km/s. Good luck.' },
};

export function MainMenu() {
  const [panel, setPanel] = useState<'root' | 'new' | 'settings' | 'multiplayer'>('root');
  const [mode, setMode] = useState<GameMode>('sandbox');
  const [scale, setScale] = useState<ScalePresetId>('standard');

  return (
    <div className="fullscreen">
      <MenuBackdrop />
      <div className="fullscreen" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 8vw', overflowY: 'auto' }}>
        <h1 className="title-xl">WEB SPACE</h1>
        <h1 className="title-xl" style={{ color: 'var(--accent)', marginBottom: 40 }}>PROGRAM</h1>

        {panel === 'root' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 260 }}>
            <button className="btn primary" onClick={() => setPanel('new')}>New Game</button>
            <button className="btn" onClick={continueGame} disabled={!hasSave('autosave') && !hasSave('quicksave')}>Continue</button>
            <button className="btn" onClick={() => setPanel('multiplayer')}>Multiplayer (experimental)</button>
            <button className="btn" onClick={() => game.set({ scene: 'training' })}>Training</button>
            <button className="btn" onClick={() => void import('./Spacepedia').then(m => m.openPedia('menu'))}>Spacepedia</button>
            <button className="btn" onClick={() => setPanel('settings')}>Settings</button>
          </div>
        )}

        {panel === 'new' && (
          <div className="panel" style={{ padding: 24, width: 440 }}>
            <div className="label" style={{ marginBottom: 8 }}>Program mode</div>
            <div className="seg" style={{ marginBottom: 8 }}>
              {(['sandbox', 'science', 'career'] as GameMode[]).map(id => <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{id[0].toUpperCase() + id.slice(1)}</button>)}
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
                  <input type="radio" name="scale" checked={scale === id} onChange={() => setScale(id)} style={{ display: 'none' }} />
                  <div style={{ fontWeight: 600 }}>{SCALE_INFO[id].label}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{SCALE_INFO[id].blurb}</div>
                </label>
              ))}
            </div>
            {hasSave('autosave') && (
              <p style={{ fontSize: 12, color: 'var(--warn)', margin: '14px 0 0' }}>Starting a new program replaces your current saved program.</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPanel('root')}>Back</button>
              <button
                className="btn primary"
                onClick={() => {
                  const world = new World(new Universe(scale), PART_CATALOG, DEFAULT_START_UT, mode);
                  // A quicksave from the previous program must not be quickloadable into the new one.
                  deleteSave('quicksave');
                  saveProgram(world);
                  game.set({ mode, scalePreset: scale, saveId: `${mode}-${Date.now()}`, craft: null, launchPending: false, ut: DEFAULT_START_UT, scene: 'spaceCenter' });
                }}
              >
                Start
              </button>
            </div>
          </div>
        )}

        {panel === 'multiplayer' && <MultiplayerSetup onBack={() => setPanel('root')} />}
        {panel === 'settings' && <SettingsPanel onClose={() => setPanel('root')} />}
      </div>
      <div style={{ position: 'absolute', bottom: 16, right: 20 }} className="label">v0.1 · pre-alpha</div>
    </div>
  );
}

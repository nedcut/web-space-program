import { useState } from 'react';
import { game, updateSettings, useGame, type QualityPreset } from '../game/store';
import { SCALE_PRESETS, type ScalePresetId } from '../sim/bodies/scale';
import { MenuBackdrop } from './MenuBackdrop';

const SCALE_INFO: Record<ScalePresetId, { label: string; blurb: string }> = {
  standard: { label: 'Standard', blurb: '1/10 scale. Forgiving and fun — orbit needs about 3.4 km/s.' },
  challenging: { label: 'Challenging', blurb: 'About 1/3 scale. Bigger rockets, longer burns.' },
  real: { label: 'Real Scale', blurb: 'The actual solar system. Orbit needs about 9.4 km/s. Good luck.' },
};

export function MainMenu() {
  const [panel, setPanel] = useState<'root' | 'new' | 'settings'>('root');
  const [scale, setScale] = useState<ScalePresetId>('standard');

  return (
    <div className="fullscreen">
      <MenuBackdrop />
      <div className="fullscreen" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8vw' }}>
        <h1 className="title-xl">WEB SPACE</h1>
        <h1 className="title-xl" style={{ color: 'var(--accent)', marginBottom: 40 }}>PROGRAM</h1>

        {panel === 'root' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 260 }}>
            <button className="btn primary" onClick={() => setPanel('new')}>New Sandbox</button>
            <button className="btn" onClick={() => game.set({ scene: 'spaceCenter' })}>Continue</button>
            <button className="btn" onClick={() => setPanel('settings')}>Settings</button>
          </div>
        )}

        {panel === 'new' && (
          <div className="panel" style={{ padding: 24, width: 440 }}>
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
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPanel('root')}>Back</button>
              <button
                className="btn primary"
                onClick={() => game.set({ scalePreset: scale, saveId: `sandbox-${Date.now()}`, scene: 'spaceCenter' })}
              >
                Start
              </button>
            </div>
          </div>
        )}

        {panel === 'settings' && <SettingsPanel onClose={() => setPanel('root')} />}
      </div>
      <div style={{ position: 'absolute', bottom: 16, right: 20 }} className="label">v0.1 · pre-alpha</div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useGame((s) => s.settings);
  return (
    <div className="panel" style={{ padding: 24, width: 440, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div className="label" style={{ marginBottom: 8 }}>Graphics quality</div>
        <div className="seg">
          {(['low', 'medium', 'high'] as QualityPreset[]).map((q) => (
            <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => updateSettings({ quality: q })}>
              {q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="label">Master volume</span>
        <input type="range" min={0} max={1} step={0.05} value={settings.masterVolume} onChange={(e) => updateSettings({ masterVolume: +e.target.value })} />
      </label>
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="label">Invert pitch</span>
        <input type="checkbox" checked={settings.invertPitch} onChange={(e) => updateSettings({ invertPitch: e.target.checked })} />
      </label>
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="label">Show FPS</span>
        <input type="checkbox" checked={settings.showFps} onChange={(e) => updateSettings({ showFps: e.target.checked })} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

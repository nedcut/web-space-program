import { useState } from 'react';
import { game, useGame } from '../game/store';
import { HubBackdrop } from './hub/HubBackdrop';
import { SettingsPanel } from './MainMenu';
import { formatDate } from './format';

/** Hub screen over a live 3D view of the launch complex. */
export function SpaceCenter() {
  const ut = useGame((s) => s.ut);
  const craft = useGame((s) => s.craft);
  const [settings, setSettings] = useState(false);

  const tiles = [
    { id: 'editor', title: 'Vehicle Assembly', desc: 'Design and build rockets', onClick: () => game.set({ scene: 'editor' }) },
    {
      id: 'launch',
      title: 'Launch Pad',
      desc: craft ? `Ready: ${craft.name}` : 'Build a vehicle first',
      disabled: !craft,
      onClick: () => game.set({ scene: 'flight', launchPending: true }),
    },
    { id: 'tracking', title: 'Tracking Station', desc: 'Track vessels and explore the solar system', onClick: () => game.set({ scene: 'tracking' }) },
  ];

  return (
    <div className="fullscreen">
      <HubBackdrop />
      <div className="fullscreen" style={{ padding: '6vh 6vw', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="label">Coastal Launch Complex</div>
            <h2 style={{ fontWeight: 300, letterSpacing: '0.2em', margin: '6px 0 0' }}>SPACE CENTER</h2>
          </div>
          <div className="mono" style={{ color: 'var(--text-dim)' }}>{formatDate(ut)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {tiles.map((t) => (
            <button
              key={t.id}
              className="panel btn"
              disabled={t.disabled}
              onClick={t.onClick}
              style={{ width: 240, height: 120, textAlign: 'left', padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
            >
              <div style={{ fontSize: 18, fontWeight: 600 }}>{t.title}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn small" onClick={() => game.set({ scene: 'menu' })}>Main menu</button>
          <button className="btn small" onClick={() => setSettings((v) => !v)}>Settings</button>
        </div>
        {settings && (
          <div style={{ position: 'absolute', top: '20vh', left: '50%', transform: 'translateX(-50%)' }}>
            <SettingsPanel onClose={() => setSettings(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

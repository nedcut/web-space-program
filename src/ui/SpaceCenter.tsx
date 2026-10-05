import { launchProblem } from '../data/technology';
import { PART_CATALOG } from '../data/parts';
import { newProgression } from '../sim/science/progression';
import { useEffect, useState } from 'react';
import { game, useGame } from '../game/store';
import { HubBackdrop } from './hub/HubBackdrop';
import { SettingsPanel } from './MainMenu';
import { formatDate } from './format';

/** Hub screen over a live 3D view of the launch complex. */
export function SpaceCenter() {
  const mode = useGame(s => s.mode);
  const p = useGame(s => s.resumeWorld?.progression);
  const [notice, setNotice] = useState(() => game.get().notice ?? '');
  useEffect(() => { if (game.get().notice) game.set({ notice: null }); }, []);
  const ut = useGame((s) => s.ut);
  const craft = useGame((s) => s.craft);
  const [settings, setSettings] = useState(false);

  const tiles = [
    { id: 'editor', title: 'Vehicle Assembly', desc: 'Design and build rockets', onClick: () => game.set({ scene: 'editor' }) },
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
    { id: 'tracking', title: 'Tracking Station', desc: 'Track vessels and explore the solar system', onClick: () => game.set({ scene: 'tracking' }) },
    ...(mode !== 'sandbox' ? [{ id: 'research', title: 'Research & Development', desc: `${(p?.science ?? 0).toFixed(1)} science · Explore the technology tree`, onClick: () => game.set({ scene: 'research' }) }] : []),
    ...(mode === 'career' ? [{ id: 'missions', title: 'Mission Control', desc: 'Commission expeditions and track contracts', onClick: () => game.set({ scene: 'missions' }) }] : []),
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
          <div className="mono" style={{ color: 'var(--text)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>{formatDate(ut)}</div>
        </div>
        <div style={{ marginTop: 16, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }} className="mono">{mode.toUpperCase()}{mode === 'career' && ` · ${(p?.funds ?? 60000).toLocaleString()} cr · ${p?.reputation ?? 0} reputation`}</div>
        <div style={{ flex: 1 }} />
        {notice && <div role="status" className="panel" style={{ alignSelf: 'flex-start', padding: '8px 14px', marginBottom: 12, background: 'rgba(8, 13, 22, 0.85)' }}>{notice}</div>}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {tiles.map((t) => (
            <button
              key={t.id}
              className="panel btn"
              disabled={t.disabled}
              onClick={t.onClick}
              style={{ width: 240, height: 120, textAlign: 'left', padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(8, 13, 22, 0.8)' }}
            >
              <div style={{ fontSize: 18, fontWeight: 600 }}>{t.title}</div>
              <div style={{ color: '#b4c0d2', fontSize: 13 }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn small" onClick={() => game.set({ scene: 'menu' })}>Main menu</button>
          <button className="btn small" onClick={() => setSettings((v) => !v)}>Settings</button>
        </div>
        {settings && <SettingsPanel onClose={() => setSettings(false)} />}
      </div>
    </div>
  );
}

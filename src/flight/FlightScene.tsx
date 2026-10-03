import { useCallback, useEffect, useRef, useState } from 'react';
import { game } from '../game/store';
import { FlightController } from './controller';
import { Hud, NavballView, type Telemetry } from './hud/Hud';
import { GameAudio } from '../audio';
import { ManeuverPanel } from './hud/ManeuverPanel';

export default function FlightScene() {
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<FlightController | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const g = game.get();
    if (!g.craft) {
      game.set({ scene: 'editor' });
      return;
    }
    const audio = new GameAudio();
    audio.setMasterVolume(g.settings.masterVolume);
    const resume = () => audio.resume();
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    const c = new FlightController(host.current!, g.craft, g.scalePreset, g.ut, g.settings.quality, audio);
    c.input.invertPitch = g.settings.invertPitch;
    c.onExit = () => setPaused((p) => !p);
    ctrl.current = c;
    const unsub = c.subscribe(setTele);
    (window as unknown as { __flight?: FlightController }).__flight = c;
    return () => {
      unsub();
      c.dispose();
      audio.dispose();
      ctrl.current = null;
    };
  }, []);

  useEffect(() => {
    if (ctrl.current) ctrl.current.paused = paused;
  }, [paused]);

  const navball = useCallback(() => ctrl.current?.navball() ?? null, []);

  const exitTo = (scene: 'spaceCenter' | 'editor') => {
    const c = ctrl.current;
    if (c) game.set({ ut: c.world.ut });
    game.set({ scene });
  };

  return (
    <div className="fullscreen" ref={host}>
      {tele && ctrl.current && (
        <Hud
          t={tele}
          navball={<NavballView getFrame={navball} />}
          cb={{
            onStage: () => ctrl.current?.stage(),
            onToggleSas: () => ctrl.current?.toggleSas(),
            onSasMode: (m) => ctrl.current?.setSasMode(m),
            onToggleRcs: () => ctrl.current && (ctrl.current.rcsOn = !ctrl.current.rcsOn),
            onWarp: (d) => ctrl.current?.world.changeWarp(d),
            onMap: () => ctrl.current?.toggleMap(),
            onMenu: () => setPaused(true),
            onSpeedMode: () => {
              const c = ctrl.current;
              if (c) c.speedMode = c.speedMode === 'surface' ? 'orbit' : 'surface';
            },
          }}
        />
      )}
      {tele?.mapMode && ctrl.current && <ManeuverPanel world={ctrl.current.world} />}
      {paused && (
        <div className="fullscreen" style={{ display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.4)' }}>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, width: 260 }}>
            <div className="label" style={{ textAlign: 'center' }}>Paused</div>
            <button className="btn primary" onClick={() => setPaused(false)}>Resume</button>
            <button className="btn" onClick={() => exitTo('editor')}>Revert to editor</button>
            <button className="btn" onClick={() => exitTo('spaceCenter')}>Space Center</button>
          </div>
        </div>
      )}
    </div>
  );
}

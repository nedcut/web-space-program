import { useCallback, useEffect, useRef, useState } from 'react';
import { game } from '../game/store';
import { FlightController } from './controller';
import { Hud, NavballView, type Telemetry } from './hud/Hud';
import { GameAudio } from '../audio';
import { ManeuverPanel } from './hud/ManeuverPanel';
import { AssistPanel } from './hud/AssistPanel';

export default function FlightScene() {
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<FlightController | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [paused, setPaused] = useState(false);

  const initial = useRef<ReturnType<typeof game.get>['resumeWorld']>(null);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    const g = game.get();
    const saved = g.resumeWorld;
    const craft = g.launchPending ? g.craft : null;
    if (!craft && !(saved && saved.activeId)) {
      game.set({ scene: g.craft ? 'editor' : 'spaceCenter' });
      return;
    }
    if (mountKey === 0) initial.current = saved;
    const audio = new GameAudio();
    audio.setMasterVolume(g.settings.masterVolume);
    const resume = () => audio.resume();
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    const c = new FlightController(host.current!, craft, g.scalePreset, g.ut, g.settings.quality, audio, saved);
    if (craft && saved) c.world.launch(craft);
    game.set({ launchPending: false });
    const scenario = new URLSearchParams(location.search).get('scenario');
    if (scenario && mountKey === 0) c.devScenario(scenario);
    c.input.invertPitch = g.settings.invertPitch;
    c.onExit = () => setPaused((p) => !p);
    c.onQuickload = () => {
      const data = FlightController.loadSlot('quicksave');
      if (!data) return c.world.message('No quicksave yet (F5 to save)', 'warn');
      game.set({ resumeWorld: data, scalePreset: data.preset, launchPending: false });
      setMountKey((k) => k + 1);
    };
    ctrl.current = c;
    const unsub = c.subscribe(setTele);
    (window as unknown as { __flight?: FlightController }).__flight = c;
    return () => {
      unsub();
      c.dispose();
      audio.dispose();
      ctrl.current = null;
    };
  }, [mountKey]);

  useEffect(() => {
    if (ctrl.current) ctrl.current.paused = paused;
  }, [paused]);

  const navball = useCallback(() => ctrl.current?.navball() ?? null, []);

  /** Leave flight: keep the universe (vessels stay where they are) and autosave. */
  const exitTo = (scene: 'spaceCenter' | 'editor') => {
    const c = ctrl.current;
    if (c) {
      c.quicksave('autosave');
      game.set({ ut: c.world.ut, resumeWorld: c.snapshot() });
    }
    game.set({ scene });
  };
  /** Revert: throw away this flight and return to the editor with the universe as it was before launch. */
  const revert = () => {
    game.set({ resumeWorld: initial.current, ut: initial.current?.ut ?? game.get().ut, scene: 'editor' });
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
      {tele && ctrl.current && !tele.mapMode && (
        <AssistPanel active={tele.assist} onStart={(id) => ctrl.current?.startAssist(id)} onCancel={() => ctrl.current?.cancelAssist()} />
      )}
      {tele?.mapMode && ctrl.current && <ManeuverPanel world={ctrl.current.world} />}
      {tele && game.get().settings.showFps && ctrl.current && (
        <div className="mono" style={{ position: 'absolute', left: 10, bottom: 10, fontSize: 11, color: 'var(--text-dim)' }}>
          {ctrl.current.fps.toFixed(0)} fps · {ctrl.current.world.vessels.size} vessels
        </div>
      )}
      {paused && (
        <div className="fullscreen" style={{ display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.4)' }}>
          <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, width: 260 }}>
            <div className="label" style={{ textAlign: 'center' }}>Paused</div>
            <button className="btn primary" onClick={() => setPaused(false)}>Resume</button>
            {ctrl.current?.world.active && ctrl.current.world.active.body === 'earth' && ctrl.current.world.active.state.situation !== 'flying' && ctrl.current.world.active.mode !== 'prelaunch' && (
              <button className="btn" onClick={() => { ctrl.current?.world.recoverActive(); exitTo('spaceCenter'); }}>Recover vessel</button>
            )}
            <button className="btn" onClick={revert}>Revert to editor</button>
            <button className="btn" onClick={() => ctrl.current?.quicksave()}>Quicksave (F5)</button>
            <button className="btn" onClick={() => exitTo('spaceCenter')}>Space Center</button>
          </div>
        </div>
      )}
    </div>
  );
}

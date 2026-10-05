import { tutorialContext, getTutorial, endTutorial, startLesson } from '../tutorial/runtime';
import { openProgram, saveProgram } from '../game/program';
import { SciencePanel } from './hud/SciencePanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { game, useGame } from '../game/store';
import { FlightController } from './controller';
import { Hud, NavballView, type Telemetry } from './hud/Hud';
import { GameAudio } from '../audio';
import { ManeuverPanel } from './hud/ManeuverPanel';
import { AssistPanel } from './hud/AssistPanel';
import { HelpOverlay, helpSeen, markHelpSeen } from './hud/HelpOverlay';
import { SettingsPanel } from '../ui/MainMenu';
import type { CraftDef } from '../sim/vessel/types';
import { hasSave } from '../game/persistence';

export default function FlightScene() {
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<FlightController | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [lost, setLost] = useState(false);
  const lostRef = useRef(false);
  lostRef.current = lost;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(false);
  const helpRef = useRef(false);
  helpRef.current = help;
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(false);
  settingsRef.current = showSettings;
  const settings = useGame((s) => s.settings);

  const initial = useRef<ReturnType<typeof game.get>['resumeWorld']>(null);
  /** Craft launched by this flight (null when resuming a saved flight): enables the revert options. */
  const launched = useRef<CraftDef | null>(null);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    const g = game.get();
    const saved = g.resumeWorld;
    const craft = g.launchPending ? g.craft : null;
    if (!craft && !(saved && saved.activeId)) {
      game.set({ scene: g.craft ? 'editor' : 'spaceCenter' });
      return;
    }
    if (mountKey === 0) {
      initial.current = saved;
      launched.current = craft;
    }
    setReady(false);
    let c: FlightController | null = null;
    let audio: GameAudio | null = null;
    let unsub: (() => void) | null = null;
    let disposed = false;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (getTutorial()) return;
      c?.quicksave('autosave');
      e.preventDefault();
    };
    const resume = () => audio?.resume();
    let readyTimer = 0;

    // Construction is heavy and synchronous: defer it a couple of frames so the loading screen paints first.
    const start = () => {
      if (disposed) return;
      audio = new GameAudio();
      audio.setMasterVolume(g.settings.masterVolume);
      audioRef.current = audio;
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
      try {
        c = new FlightController(host.current!, craft, g.scalePreset, g.ut, game.get().settings.quality, audio, saved, g.mode);
      } catch (e) {
        audio.dispose();
        audio = null;
        setError((e as Error).message);
        return;
      }
      if (!c.world.active) {
        c.dispose();
        audio.dispose();
        c = null;
        audio = null;
        game.set({ scene: 'spaceCenter' });
        return;
      }
      const cc = c;
      cc.paused = pausedRef.current;
      setLost(false);
      cc.onActiveLost = () => {
        setLost(true);
        setPaused(true);
      };
      game.set({ launchPending: false });
      const scenario = new URLSearchParams(location.search).get('scenario');
      if (scenario && mountKey === 0 && !getTutorial()) cc.devScenario(scenario);
      cc.input.invertPitch = game.get().settings.invertPitch;
      // Esc: close the help overlay first; never un-pause the "vessel lost" screen (there is nothing to fly).
      cc.onExit = () => {
        if (helpRef.current) return closeHelp();
        if (settingsRef.current) return setShowSettings(false);
        if (lostRef.current) return setPaused(true);
        setPaused((p) => !p);
      };
      cc.onQuickload = () => {
        if (getTutorial()) return;
        const data = FlightController.loadSlot('quicksave');
        if (!data) return cc.world.message('No quicksave yet (F5 to save)', 'warn');
        game.set({ resumeWorld: data, mode: data.mode ?? 'sandbox', scalePreset: data.preset, launchPending: false });
        setPaused(false);
        setMountKey((k) => k + 1);
      };
      ctrl.current = cc;
      tutorialContext.flight = cc;
      tutorialContext.world = cc.world;
      unsub = cc.subscribe(setTele);
      // Leaving the page mid-flight: autosave and ask for confirmation (Ctrl+W / Ctrl+R are throttle-adjacent).
      window.addEventListener('beforeunload', beforeUnload);
      (window as unknown as { __flight?: FlightController }).__flight = cc;
      readyTimer = window.setInterval(() => {
        if (!cc.sceneReady) return;
        window.clearInterval(readyTimer);
        setReady(true);
        if (!getTutorial() && !helpSeen()) setHelp(true);
      }, 200);
    };
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(start, 30);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearInterval(readyTimer);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      unsub?.();
      c?.dispose();
      audio?.dispose();
      if (audioRef.current === audio) audioRef.current = null;
      ctrl.current = null;
      if (tutorialContext.flight === c) { delete tutorialContext.flight; delete tutorialContext.world; }
      setTele(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountKey]);

  useEffect(() => {
    if (ctrl.current) ctrl.current.paused = paused;
  }, [paused, tele === null]);

  // Live settings: volume and pitch inversion apply immediately; quality re-creates the scene from a snapshot.
  useEffect(() => {
    audioRef.current?.setMasterVolume(settings.masterVolume);
    if (ctrl.current) ctrl.current.input.invertPitch = settings.invertPitch;
  }, [settings.masterVolume, settings.invertPitch]);
  const quality = useRef(settings.quality);
  useEffect(() => {
    if (quality.current === settings.quality) return;
    quality.current = settings.quality;
    const c = ctrl.current;
    if (!c || !c.world.active) return;
    game.set({ resumeWorld: c.snapshot(), ut: c.world.ut, launchPending: false });
    setMountKey((k) => k + 1);
  }, [settings.quality]);

  const closeHelp = () => {
    markHelpSeen();
    setHelp(false);
  };

  // F1 toggles the controls help (prevent the browser's own help page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F1') return;
      e.preventDefault();
      if (helpRef.current) closeHelp();
      else setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navball = useCallback(() => ctrl.current?.navball() ?? null, []);

  /** Leave flight: keep the universe (vessels stay where they are) and autosave. */
  const exitTo = (scene: 'spaceCenter' | 'editor') => {
    if (getTutorial()) return endTutorial();
    const c = ctrl.current;
    if (c) {
      c.quicksave('autosave');
      game.set({ ut: c.world.ut, mode: c.world.mode, resumeWorld: c.snapshot() });
    }
    game.set({ scene });
  };
  /** Recover the active vessel (on Earth, landed / on the pad) and summarise what it earned on the hub. */
  const recover = () => {
    const w = ctrl.current?.world;
    if (!w?.active) return;
    const name = w.active.state.name;
    const before = { funds: w.progression.funds, science: w.progression.science };
    if (!w.recoverActive()) return;
    const parts = [`${name} recovered`];
    if (w.mode === 'career' && w.progression.funds !== before.funds) parts.push(`${Math.round(w.progression.funds - before.funds).toLocaleString()} cr refunded`);
    if (w.progression.science > before.science + 1e-6) parts.push(`+${(w.progression.science - before.science).toFixed(1)} science`);
    game.set({ notice: parts.join(' · ') });
    exitTo('spaceCenter');
  };
  /** Revert: throw away this flight and return to the editor with the universe as it was before launch. */
  const revert = () => {
    if (getTutorial()) return endTutorial();
    game.set({ resumeWorld: initial.current, mode: initial.current?.mode ?? game.get().mode, ut: initial.current?.ut ?? game.get().ut, launchPending: false, craft: launched.current ?? game.get().craft });
    saveProgram(openProgram());
    game.set({ scene: 'editor' });
  };
  /** Revert to launch: restore the pre-launch universe and put the same craft back on the pad. */
  const revertToLaunch = () => {
    const tutorial = getTutorial();
    if (tutorial) return startLesson(tutorial.lesson.id);
    if (!launched.current) return;
    game.set({ resumeWorld: initial.current, mode: initial.current?.mode ?? game.get().mode, ut: initial.current?.ut ?? game.get().ut, craft: launched.current, launchPending: true });
    saveProgram(openProgram());
    game.set({ launchPending: true });
    setPaused(false);
    setLost(false);
    setMountKey((k) => k + 1);
  };

  if (error) {
    return (
      <div className="fullscreen" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ padding: 24, maxWidth: 420 }}>
          <div className="label" style={{ color: 'var(--bad)' }}>Could not start flight</div>
          <p style={{ color: 'var(--text-dim)' }}>{error}</p>
          <button className="btn" onClick={() => getTutorial() ? endTutorial() : game.set({ scene: 'spaceCenter', launchPending: false })}>Back to Space Center</button>
        </div>
      </div>
    );
  }

  const c = ctrl.current;
  const active = c?.world.active;
  const canRecover = !!active && active.body === 'earth' && (active.mode === 'prelaunch' || active.state.situation !== 'flying');
  return (
    <div className="fullscreen">
      {/* The controller appends its canvas here; React overlays are later siblings so they stay on top. */}
      <div className="fullscreen" ref={host} />
      {tele && c && (
        <Hud
          t={tele}
          navball={<NavballView getFrame={navball} />}
          dock={{
            assist: !tele.eva && !tele.noControl ? <AssistPanel active={tele.assist} onStart={(id) => ctrl.current?.startAssist(id)} onCancel={() => ctrl.current?.cancelAssist()} /> : undefined,
            assistActive: !!tele.assist,
            science: <SciencePanel world={c.world} paused={paused} />,
            maneuver: <ManeuverPanel world={c.world} />,
          }}
          cb={{
            onEva: (id) => ctrl.current?.goEva(id),
            onBoard: () => ctrl.current?.boardEva(),
            onPlantFlag: () => { if (!ctrl.current?.paused) ctrl.current?.world.plantFlag(); },
            onStage: () => ctrl.current?.stage(),
            onToggleSas: () => ctrl.current?.toggleSas(),
            onSasMode: (m) => ctrl.current?.setSasMode(m),
            onToggleRcs: () => ctrl.current && (ctrl.current.rcsOn = !ctrl.current.rcsOn),
            onWarp: (d) => ctrl.current?.world.changeWarp(d),
            onMap: () => ctrl.current?.toggleMap(),
            onMenu: () => setPaused(true),
            onSpeedMode: () => ctrl.current?.cycleSpeedMode(),
            onToggleGear: () => ctrl.current?.toggleGear(),
            onSetTarget: (id, port) => ctrl.current?.setTarget(id, port ?? null),
            onToggleDocking: () => ctrl.current?.toggleDockingMode(),
            onUndock: (uid) => ctrl.current?.undock(uid),
            onHelp: () => setHelp((h) => !h),
          }}
        />
      )}
      {tele && settings.showFps && c && (
        <div className="mono" style={{ position: 'absolute', right: 250, top: 14, fontSize: 11, color: 'var(--text-dim)', pointerEvents: 'none' }}>
          {c.fps.toFixed(0)} fps · {c.world.vessels.size} vessels
        </div>
      )}
      {help && ready && <HelpOverlay eva={!!tele?.eva} onClose={closeHelp} />}
      {paused && (
        <div className="modal-backdrop">
          {showSettings ? (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          ) : (
            <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, width: 280 }}>
              <div className="label" style={{ textAlign: 'center', color: lost ? 'var(--bad)' : undefined }}>{lost ? 'Vessel lost' : 'Paused'}</div>
              {!lost && <button className="btn primary" onClick={() => setPaused(false)}>Resume <span className="kbd" style={{ marginLeft: 6 }}>Esc</span></button>}
              {getTutorial() && <button className="btn" onClick={() => startLesson(getTutorial()!.lesson.id)}>Restart lesson</button>}
              {lost && !getTutorial() && hasSave('quicksave') && <button className="btn primary" onClick={() => ctrl.current?.onQuickload?.()}>Load quicksave</button>}
              {canRecover && (
                <button className="btn" onClick={recover}>Recover vessel</button>
              )}
              {launched.current && <button className="btn" onClick={revertToLaunch}>Revert to launch</button>}
              {launched.current && <button className="btn" onClick={revert}>Revert to editor</button>}
              {!lost && !getTutorial() && <button className="btn" onClick={() => ctrl.current?.quicksave()}>Quicksave <span className="kbd" style={{ marginLeft: 6 }}>F5</span></button>}
              {!lost && !getTutorial() && hasSave('quicksave') && <button className="btn" onClick={() => ctrl.current?.onQuickload?.()}>Quickload <span className="kbd" style={{ marginLeft: 6 }}>F9</span></button>}
              <button className="btn" onClick={() => { setPaused(false); setHelp(true); }}>Controls <span className="kbd" style={{ marginLeft: 6 }}>F1</span></button>
              <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
              <button className="btn" onClick={() => exitTo('spaceCenter')}>{getTutorial() ? 'Back to lessons' : 'Space Center'}</button>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>{getTutorial() ? 'Practice is separate from your saved program.' : 'Progress is autosaved when you leave flight.'}</div>
            </div>
          )}
        </div>
      )}
      {!ready && (
        <div className="loading-screen">
          <div style={{ textAlign: 'center' }}>
            <div className="label">Preparing flight</div>
            <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.2em', marginTop: 8 }}>{tele ? 'GENERATING TERRAIN' : 'LOADING'}</div>
            <div className="loading-bar"><div /></div>
          </div>
        </div>
      )}
    </div>
  );
}

import { attachScenarioWorld, endScenario, getScenarioRun, startScenario } from '../scenarios/runtime';
import { FlightReport } from '../ui/FlightLog';
import { photoMode, usePhotoMode } from '../game/photoMode';
import { SignalPanel } from './hud/SignalPanel';
import { MultiplayerPanel } from '../net/MultiplayerPanel';
import { ResourcePanel } from './hud/ResourcePanel';
import { tutorialContext, getTutorial, endTutorial, startLesson } from '../tutorial/runtime';
import { openProgram, saveProgram } from '../game/program';
import { SciencePanel } from './hud/SciencePanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { game, useGame } from '../game/store';
import { FlightController } from './controller';
import { Hud, NavballView, type Telemetry } from './hud/Hud';
import type { GameAudio } from '../audio';
import { getGameAudio } from '../audio/ui';
import { ManeuverPanel } from './hud/ManeuverPanel';
import { AssistPanel } from './hud/AssistPanel';
import { HelpOverlay, helpSeen, markHelpSeen } from './hud/HelpOverlay';
import { SettingsPanel } from '../ui/MainMenu';
import type { CraftDef } from '../sim/vessel/types';
import { isTyping, matches } from '../input/bindings';
import { hasSave, saveNamedWorld } from '../game/persistence';

export default function FlightScene() {
  const photo = usePhotoMode();
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<FlightController | null>(null);
  const multiplayer = game.get().multiplayer;
  const [networkReady, setNetworkReady] = useState(false);
  const audioRef = useRef<GameAudio | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [report, setReport] = useState(false);
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
    if (!g.multiplayer && !craft && !(saved && saved.activeId)) {
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
    let detachScenario: (() => void) | null = null;
    let unsub: (() => void) | null = null;
    let disposed = false;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (getTutorial() || getScenarioRun()) return;
      if (c && !c.network) { c.quicksave('autosave'); e.preventDefault(); }
    };
    const resume = () => audio?.resume();
    let readyTimer = 0;

    // Construction is heavy and synchronous: defer it a couple of frames so the loading screen paints first.
    const start = () => {
      if (disposed) return;
      audio = getGameAudio();
      audio.setMasterVolume(g.settings.masterVolume);
      audioRef.current = audio;
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
      try {
        c = new FlightController(host.current!, craft, g.scalePreset, g.ut, game.get().settings.quality, audio, saved, g.mode, g.multiplayer);
      } catch (e) {
        audio.silenceFlight();
        audio = null;
        setError((e as Error).message);
        return;
      }
      if (!g.multiplayer && !c.world.active) {
        c.dispose();
        audio.silenceFlight();
        c = null;
        audio = null;
        game.set({ scene: 'spaceCenter' });
        return;
      }
      const cc = c;
      cc.paused = pausedRef.current;
      setLost(false);
      setReport(false);
      cc.onActiveLost = () => {
        setLost(true);
        setReport(true);
        setPaused(true);
      };
      game.set({ launchPending: false });
      const scenario = new URLSearchParams(location.search).get('scenario');
      if (scenario && mountKey === 0 && !getTutorial() && !getScenarioRun()) cc.devScenario(scenario);
      // Esc: close the help overlay first; never un-pause the "vessel lost" screen (there is nothing to fly).
      cc.onExit = () => {
        if (getScenarioRun()?.result) return;
        if (helpRef.current) return closeHelp();
        if (settingsRef.current) return setShowSettings(false);
        if (lostRef.current) return setPaused(true);
        setPaused((p) => !p);
      };
      cc.onQuickload = () => {
        if (cc.network || getTutorial() || getScenarioRun()) return;
        const data = FlightController.loadSlot('quicksave');
        if (!data) return cc.world.message('No quicksave yet (F5 to save)', 'warn');
        game.set({ resumeWorld: data, mode: data.mode ?? 'sandbox', scalePreset: data.preset, launchPending: false });
        setPaused(false);
        setMountKey((k) => k + 1);
      };
      ctrl.current = cc;
      setNetworkReady(!!cc.network);
      tutorialContext.flight = cc;
      tutorialContext.world = cc.world;
      const mission = getScenarioRun();
      if (mission && mountKey === 0) {
        cc.cam.pitch = mission.scenario.id === 'ring-skimmer' ? 0.85 : 0.45;
        cc.cam.distance = Math.max(25, cc.world.active!.state.cache.boundingRadius * 4);
        if (mission.scenario.id === 'rendezvous') { cc.speedMode = 'target'; cc.dockingMode = true; }
      }
      detachScenario = attachScenarioWorld(cc.world, () => { cc.paused = true; });
      unsub = cc.subscribe(setTele);
      // Leaving the page mid-flight: autosave and ask for confirmation (Ctrl+W / Ctrl+R are throttle-adjacent).
      window.addEventListener('beforeunload', beforeUnload);
      (window as unknown as { __flight?: FlightController }).__flight = cc;
      readyTimer = window.setInterval(() => {
        if (!cc.network && !cc.sceneReady) return;
        window.clearInterval(readyTimer);
        setReady(true);
        if (!cc.network && !getTutorial() && !getScenarioRun() && !helpSeen()) setHelp(true);
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
      detachScenario?.();
      unsub?.();
      c?.dispose();
      audio?.silenceFlight();
      if (audioRef.current === audio) audioRef.current = null;
      ctrl.current = null;
      if (tutorialContext.flight === c) { delete tutorialContext.flight; delete tutorialContext.world; }
      setTele(null);
    };
  }, [mountKey]);

  const awaitingTelemetry = tele === null;
  const scenarioFinished = !!getScenarioRun()?.result;
  useEffect(() => {
    if (ctrl.current) ctrl.current.paused = paused || photo.active || scenarioFinished;
    if (paused || photo.active) audioRef.current?.silenceFlight();
  }, [paused, awaitingTelemetry, photo.active, scenarioFinished]);

  // Input reads settings each frame; planet quality, clouds and scattering rebuild from a snapshot.
  useEffect(() => {
    audioRef.current?.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume]);
  const sceneGraphics = JSON.stringify([settings.quality, settings.clouds, settings.scatter]);
  const quality = useRef(sceneGraphics);
  useEffect(() => {
    if (quality.current === sceneGraphics) return;
    quality.current = sceneGraphics;
    const c = ctrl.current;
    if (!c || c.network || !c.world.active) return;
    game.set({ resumeWorld: c.snapshot(), ut: c.world.ut, launchPending: false });
    setMountKey((k) => k + 1);
  }, [sceneGraphics]);

  const closeHelp = () => {
    markHelpSeen();
    setHelp(false);
  };

  // F1 toggles the controls help (prevent the browser's own help page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat || !matches('help', e)) return;
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
    if (getScenarioRun()) return endScenario();
    if (getTutorial()) return endTutorial();
    const c = ctrl.current;
    if (c) {
      if (scene === 'spaceCenter') {
        if (c.world.active) { c.world.recordFlight(c.world.active, c.world.ut, true); c.world.logFlightEvent(c.world.active, 'checkpoint', 'Returned to Space Center'); const r = c.world.flightlog.records.find(r => r.vesselId === c.world.activeId && !r.outcome); if (r) c.world.latestReportId = r.id; }
      }
      c.quicksave('autosave');
      game.set({ ut: c.world.ut, mode: c.world.mode, resumeWorld: c.snapshot() });
    }
    game.set({ scene: scene === 'spaceCenter' ? 'flightlog' : scene });
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
    if (getScenarioRun()) return endScenario();
    if (getTutorial()) return endTutorial();
    game.set({ resumeWorld: initial.current, mode: initial.current?.mode ?? game.get().mode, ut: initial.current?.ut ?? game.get().ut, launchPending: false, craft: launched.current ?? game.get().craft });
    saveProgram(openProgram());
    game.set({ scene: 'editor' });
  };
  /** Revert to launch: restore the pre-launch universe and put the same craft back on the pad. */
  const revertToLaunch = () => {
    const scenario = getScenarioRun();
    if (scenario) return startScenario(scenario.scenario.id);
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
          <button className="btn" onClick={() => getScenarioRun() ? endScenario() : getTutorial() ? endTutorial() : game.set({ scene: multiplayer ? 'menu' : 'spaceCenter', multiplayer: null, launchPending: false })}>{multiplayer ? 'Back to menu' : 'Back to Space Center'}</button>
        </div>
      </div>
    );
  }

  const c = ctrl.current;
  const active = c?.world.active;
  const canRecover = !getScenarioRun() && !!active && active.body === 'earth' && (active.mode === 'prelaunch' || active.state.situation !== 'flying');
  return (
    <div className="fullscreen">
      {/* The controller appends its canvas here; React overlays are later siblings so they stay on top. */}
      <div className="fullscreen" ref={host} />
      {tele && c && !photo.active && (
        <Hud
          shortcutsEnabled={ready && !paused && !help && !showSettings}
          precision={c.input.precisionActive}
          stageProgress={c.input.stageProgress}
          gamepadConnected={c.input.gamepadConnected}
          t={tele}
          navball={<NavballView getFrame={navball} />}
          dock={multiplayer ? undefined : {
            assist: !tele.eva && !tele.noControl ? <AssistPanel active={tele.assist} onStart={(id) => ctrl.current?.startAssist(id)} onCancel={() => ctrl.current?.cancelAssist()} /> : undefined,
            assistActive: !!tele.assist,
            signal: c.world.commsSettings.enabled ? <SignalPanel world={c.world} /> : undefined,
            resources: (tele.mapMode || active?.state.parts.some(p => p.def.modules.some(m => ['drill', 'converter', 'surfaceScanner', 'surveyScanner'].includes(m.type))))
              ? <ResourcePanel world={c.world} map={c.map} mapMode={tele.mapMode} paused={paused} /> : undefined,
            science: <SciencePanel world={c.world} paused={paused} />,
            maneuver: <ManeuverPanel world={c.world} />,
          }}
          cb={{
            onEva: (id) => ctrl.current?.goEva(id),
            onBoard: () => ctrl.current?.boardEva(),
            onPlantFlag: () => ctrl.current?.plantFlag(),
            onStage: () => ctrl.current?.stage(),
            onToggleSas: () => ctrl.current?.toggleSas(),
            onSasMode: (m) => ctrl.current?.setSasMode(m),
            onToggleRcs: () => ctrl.current && (ctrl.current.rcsOn = !ctrl.current.rcsOn),
            onWarp: (d) => ctrl.current?.changeWarp(d),
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
      {settings.showFps && c && !photo.active && <PerformanceReadout controller={c} />}
      {help && ready && !photo.active && <HelpOverlay eva={!!tele?.eva} onClose={closeHelp} />}
      {networkReady && c?.network && <MultiplayerPanel client={c.network} />}
      {paused && multiplayer && (
        <div className="modal-backdrop">
          <div className="panel" style={{ padding: 24, display: 'grid', gap: 10 }}>
            <p>Flight controls suspended. The shared clock continues.</p>
            <button className="btn" onClick={() => setPaused(false)}>Resume controls</button>
            <button className="btn" onClick={() => { setPaused(false); setHelp(true); }}>Controls (F1)</button>
            <button className="btn" onClick={() => game.set({ multiplayer: null, scene: 'menu' })}>Disconnect</button>
          </div>
        </div>
      )}
      {report && lost && !photo.active && ctrl.current && (() => {
        const r = ctrl.current.world.flightlog.records.find(r => r.id === ctrl.current!.world.latestReportId);
        return r ? <div className="modal-backdrop"><div className="panel report-modal"><button className="btn" onClick={() => setReport(false)}>Close report</button><FlightReport record={r} /></div></div> : null;
      })()}
      {paused && !multiplayer && !photo.active && !report && (
        <div className="modal-backdrop">
          {showSettings ? (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          ) : (
            <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, width: 280 }}>
              <div className="label" style={{ textAlign: 'center', color: lost ? 'var(--bad)' : undefined }}>{lost ? 'Vessel lost' : 'Paused'}</div>
              {!lost && <button className="btn" onClick={() => photoMode.open()}>Photo mode (P)</button>}
              {!lost && <button className="btn primary" onClick={() => setPaused(false)}>Resume <span className="kbd" style={{ marginLeft: 6 }}>Esc</span></button>}
              {getTutorial() && <button className="btn" onClick={() => startLesson(getTutorial()!.lesson.id)}>Restart lesson</button>}
              {lost && !getTutorial() && !getScenarioRun() && hasSave('quicksave') && <button className="btn primary" onClick={() => ctrl.current?.onQuickload?.()}>Load quicksave</button>}
              {canRecover && (
                <button className="btn" onClick={recover}>Recover vessel</button>
              )}
              {launched.current && <button className="btn" onClick={revertToLaunch}>Revert to launch</button>}
              {launched.current && <button className="btn" onClick={revert}>Revert to editor</button>}
              {!lost && !getTutorial() && !getScenarioRun() && <button className="btn" onClick={() => { const name = window.prompt('Save slot name', 'Mission save'); if (name?.trim() && ctrl.current) { try { saveNamedWorld(name, ctrl.current.world); ctrl.current.world.message('Mission saved.'); } catch (e) { ctrl.current.world.message((e as Error).message, 'bad'); } } }}>Save as…</button>}
              {!lost && !getTutorial() && !getScenarioRun() && <button className="btn" onClick={() => ctrl.current?.quicksave()}>Quicksave <span className="kbd" style={{ marginLeft: 6 }}>F5</span></button>}
              {!lost && !getTutorial() && !getScenarioRun() && hasSave('quicksave') && <button className="btn" onClick={() => ctrl.current?.onQuickload?.()}>Quickload <span className="kbd" style={{ marginLeft: 6 }}>F9</span></button>}
              <button className="btn" onClick={() => { setPaused(false); setHelp(true); }}>Controls <span className="kbd" style={{ marginLeft: 6 }}>F1</span></button>
              <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
              <button className="btn" onClick={() => exitTo('spaceCenter')}>{getScenarioRun() ? 'Back to scenarios' : getTutorial() ? 'Back to lessons' : 'Space Center'}</button>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>{(getTutorial() || getScenarioRun()) ? 'Practice is separate from your saved program.' : 'Progress is autosaved when you leave flight.'}</div>
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

function PerformanceReadout({ controller: c }: { controller: FlightController }) {
  const [, refresh] = useState(0);
  useEffect(() => { const id = window.setInterval(() => refresh(n => n + 1), 500); return () => window.clearInterval(id); }, []);
  return <div className="mono" style={{ position: 'absolute', bottom: 8, right: 12, color: '#9fb9c8', fontSize: 11, pointerEvents: 'none' }}>
    {c.fps.toFixed(0)} fps · {c.pipeline.stats.calls} calls · {c.pipeline.stats.triangles.toLocaleString()} tris · {(c.pipeline.effectiveRenderScale * 100).toFixed(0)}% scale · {c.world.vessels.size} vessels
  </div>;
}

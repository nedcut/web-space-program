import { ScenarioPanel } from '../scenarios/ScenarioPanel';
import { useScenarioRun } from '../scenarios/runtime';


import { PhotoPanel } from './PhotoPanel';
import { usePhotoMode } from '../game/photoMode';
import { useInterfaceAudio } from '../audio/ui';
import { Training } from '../tutorial/Training';
import { TutorialPanel } from '../tutorial/TutorialPanel';
import { useTutorial } from '../tutorial/runtime';
import './theme.css';
import { lazy, Suspense, useEffect } from 'react';
import { useGame } from '../game/store';
import { MainMenu } from './MainMenu';
import { SpaceCenter } from './SpaceCenter';
import { ErrorBoundary } from './ErrorBoundary';
import { SaveErrorNotice } from './SaveErrorNotice';
import { UnsupportedScreen } from './Unsupported';
import { browserSupport, SCENES_NEEDING_WEBGL2 } from './browserSupport';

// Heavy 3D scenes are code-split so the menu loads instantly.
const Scenarios = lazy(() => import('../scenarios/Scenarios'));
const FlightLog = lazy(() => import('./FlightLog'));
const Spacepedia = lazy(() => import('./Spacepedia'));
const loadEditor = () => import('../editor/EditorScene');
const loadFlight = () => import('../flight/FlightScene');
const EditorScene = lazy(loadEditor);
const TrackingStation = lazy(() => import('./tracking/TrackingStation'));
const Research = lazy(() => import('./Research'));
const Missions = lazy(() => import('./Missions'));
const FlightScene = lazy(loadFlight);

export function App() {
  const photo = usePhotoMode();
  useInterfaceAudio();
  const tutorial = useTutorial();
  const scenario = useScenarioRun();
  const settings = useGame(s => s.settings);
  useEffect(() => {
    document.documentElement.dataset.photoMode = String(photo.active);
    document.documentElement.dataset.highContrast = String(settings.highContrast);
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
  }, [settings.highContrast, settings.reduceMotion, photo.active]);
  const scene = useGame((s) => s.scene);
  // Warm the next scenes' code while the player is busy elsewhere (no work on the menu itself).
  useEffect(() => {
    const next = scene === 'spaceCenter' ? [loadEditor, loadFlight] : scene === 'editor' ? [loadFlight] : [];
    if (!next.length) return;
    const run = () => next.forEach((load) => void load().catch(() => undefined));
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const handle = hasIdle ? window.requestIdleCallback(run, { timeout: 4000 }) : window.setTimeout(run, 2000);
    return () => { if (hasIdle) window.cancelIdleCallback(handle); else window.clearTimeout(handle); };
  }, [scene]);
  return (
    <div className="fullscreen" style={{ width: `${100 / settings.uiScale}%`, height: `${100 / settings.uiScale}%`, transform: `scale(${settings.uiScale})`, transformOrigin: 'top left' }}>
      <ErrorBoundary>
      {SCENES_NEEDING_WEBGL2.has(scene) && !browserSupport().webgl2 ? <UnsupportedScreen /> : <Suspense fallback={<Loading />}>
        {scene === 'scenarios' && <Scenarios />}
        {scene === 'flightlog' && <FlightLog />}
        {scene === 'pedia' && <Spacepedia />}
        {scene === 'training' && <Training />}
        {scene === 'menu' && <MainMenu />}
        {scene === 'spaceCenter' && <SpaceCenter />}
        {scene === 'editor' && <EditorScene key={scenario ? `scenario-${scenario.epoch}` : tutorial?.epoch ?? 0} />}
        {scene === 'flight' && <FlightScene key={scenario ? `scenario-${scenario.epoch}` : tutorial?.epoch ?? 0} />}
        {scene === 'research' && <Research />}
        {scene === 'missions' && <Missions />}
        {scene === 'tracking' && <TrackingStation />}
      </Suspense>}
      {!photo.active && <TutorialPanel />}
      {!photo.active && scene === 'flight' && <ScenarioPanel />}
      <PhotoPanel />
      </ErrorBoundary>
      <SaveErrorNotice />
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-screen" role="status">
      <div><div className="label">Preparing your next frontier</div><p>Loading…</p><div className="loading-bar"><div /></div></div>
    </div>
  );
}

import './theme.css';
import { lazy, Suspense } from 'react';
import { useGame } from '../game/store';
import { MainMenu } from './MainMenu';
import { SpaceCenter } from './SpaceCenter';
import { ErrorBoundary } from './ErrorBoundary';

// Heavy 3D scenes are code-split so the menu loads instantly.
const EditorScene = lazy(() => import('../editor/EditorScene'));
const TrackingStation = lazy(() => import('./tracking/TrackingStation'));
const Research = lazy(() => import('./Research'));
const Missions = lazy(() => import('./Missions'));
const FlightScene = lazy(() => import('../flight/FlightScene'));

export function App() {
  const scene = useGame((s) => s.scene);
  return (
    <div className="fullscreen">
      <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        {scene === 'menu' && <MainMenu />}
        {scene === 'spaceCenter' && <SpaceCenter />}
        {scene === 'editor' && <EditorScene />}
        {scene === 'flight' && <FlightScene />}
        {scene === 'research' && <Research />}
        {scene === 'missions' && <Missions />}
        {scene === 'tracking' && <TrackingStation />}
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function Loading() {
  return (
    <div className="fullscreen" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="label">Loading…</div>
    </div>
  );
}

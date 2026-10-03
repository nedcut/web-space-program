import './theme.css';
import { lazy, Suspense } from 'react';
import { useGame } from '../game/store';
import { MainMenu } from './MainMenu';
import { SpaceCenter } from './SpaceCenter';

// Heavy 3D scenes are code-split so the menu loads instantly.
const EditorScene = lazy(() => import('../editor/EditorScene'));
const TrackingStation = lazy(() => import('./tracking/TrackingStation'));
const FlightScene = lazy(() => import('../flight/FlightScene'));

export function App() {
  const scene = useGame((s) => s.scene);
  return (
    <div className="fullscreen">
      <Suspense fallback={<Loading />}>
        {scene === 'menu' && <MainMenu />}
        {scene === 'spaceCenter' && <SpaceCenter />}
        {scene === 'editor' && <EditorScene />}
        {scene === 'flight' && <FlightScene />}
        {scene === 'tracking' && <TrackingStation />}
      </Suspense>
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

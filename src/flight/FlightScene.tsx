import { game } from '../game/store';

export default function FlightScene() {
  return (
    <div className="fullscreen" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="panel" style={{ padding: 24 }}>
        <div className="label">Flight — under construction</div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => game.set({ scene: 'spaceCenter' })}>Back</button>
      </div>
    </div>
  );
}

import { game } from '../game/store';

export default function EditorScene() {
  return (
    <div className="fullscreen" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="panel" style={{ padding: 24 }}>
        <div className="label">Vehicle Assembly — under construction</div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => game.set({ scene: 'spaceCenter' })}>Back</button>
      </div>
    </div>
  );
}

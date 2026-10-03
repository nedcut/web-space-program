import { Component, type ReactNode } from 'react';
import { game } from '../game/store';

/** Last-resort crash screen: never leave the player on a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Unhandled UI error', error);
  }

  private recover = () => {
    game.set({ scene: 'spaceCenter', launchPending: false });
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fullscreen" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ padding: 24, maxWidth: 520 }}>
          <div className="label" style={{ color: 'var(--bad)' }}>Something went wrong</div>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-dim)', maxHeight: 200, overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={this.recover}>Back to Space Center</button>
            <button className="btn" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

import { Component, type ReactNode } from 'react';
import { CrashOverlay } from './CrashOverlay';
import { reloadingForUpdate } from './staleBuild';

/** Unmounting a failed scene disposes its animation loops, inputs, audio and workers. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Unhandled UI error', error); }
  private fail = (reason: unknown) => {
    if (!this.state.error) this.setState({ error: reason instanceof Error ? reason : new Error(String(reason)) });
  };
  private onError = (event: ErrorEvent) => this.fail(event.error ?? event.message);
  private onRejection = (event: PromiseRejectionEvent) => this.fail(event.reason);
  private onWorkerError = (event: Event) => this.fail((event as CustomEvent<string>).detail);
  componentDidMount() {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    window.addEventListener('wsp:worker-error', this.onWorkerError);
  }
  componentWillUnmount() {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    window.removeEventListener('wsp:worker-error', this.onWorkerError);
  }
  render() {
    if (this.state.error && reloadingForUpdate) return null;
    return this.state.error ? <CrashOverlay error={this.state.error} onRecover={() => this.setState({ error: null })} /> : this.props.children;
  }
}

/**
 * Last line of defence around the whole app (hooks above the scene boundary, the boundary itself):
 * render a plain, store-free recovery page instead of leaving the player on a blank screen.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Unrecoverable UI error', error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <div role="alert" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#080e18', color: '#dce6f2', font: '15px system-ui, sans-serif' }}>
      <section style={{ maxWidth: 540, margin: 20, padding: 28, border: '1px solid #2a3a52', borderRadius: 10, background: '#0e1726' }}>
        <h2 style={{ marginTop: 0 }}>Web Space Program stopped</h2>
        <p>Something went wrong that the game could not recover from. Your saves are untouched; reloading usually fixes it.</p>
        <details><summary>Error details</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', fontSize: 12 }}>{`${navigator.userAgent}\n${error.stack ?? error.message}`}</pre></details>
        <button style={{ marginTop: 16, padding: '8px 16px' }} onClick={() => location.reload()}>Reload</button>
      </section>
    </div>;
  }
}

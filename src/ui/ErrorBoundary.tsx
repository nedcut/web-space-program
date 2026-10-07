import { Component, type ReactNode } from 'react';
import { CrashOverlay } from './CrashOverlay';

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
    return this.state.error ? <CrashOverlay error={this.state.error} onRecover={() => this.setState({ error: null })} /> : this.props.children;
  }
}

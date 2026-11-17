import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * What the recovery button does. Left out, the button reloads the page.
   * The model inspector passes its own way back, because a machine that
   * cannot give the inspector a graphics context can still show the city.
   */
  onRecover?: () => void;
  recoverLabel?: string;
  heading?: string;
  note?: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a failure inside the 3D canvas from taking the whole application
 * down with it. Without this, one bad subtree unmounts the entire tree and
 * the visitor is left with a blank page.
 */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The 3D scene failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const recover = this.props.onRecover ?? (() => window.location.reload());
    const label = this.props.recoverLabel ?? 'Reload';

    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink-950/90 px-6">
        <div className="max-w-md text-center">
          <span className="nb-label text-saffron/80">Namma Bengaluru</span>
          <h2 className="nb-display mt-3 text-2xl font-light text-mist-100">
            {this.props.heading ?? 'The scene could not be drawn'}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mist-400">
            {this.props.note ??
              'The 3D view stopped unexpectedly. Reloading usually clears it.'}
          </p>
          <pre className="nb-scroll mt-4 max-h-32 overflow-auto rounded border border-white/10 bg-white/5 p-3 text-left font-mono text-[11px] text-mist-400">
            {this.state.error.message}
          </pre>
          <button type="button" className="nb-btn nb-btn-primary mt-6" onClick={recover}>
            {label}
          </button>
        </div>
      </div>
    );
  }
}

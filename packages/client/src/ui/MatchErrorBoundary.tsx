import { Component, type ReactNode } from "react";

interface MatchErrorBoundaryProps {
  children: ReactNode;
  onRejoin: () => void;
  onLeave: () => void;
}

interface MatchErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches an error thrown anywhere in the match view, the 3D scene included.
 *
 * R3F re-throws scene errors out of `<Canvas>`, and with nothing above it React
 * unmounts the whole root: a blank page that reads as a crashed tab. Frame-loop
 * errors never reach React on their own; `useGuardedFrame` is what forwards them
 * here. The room connection lives above this boundary, so the seat survives, and
 * rejoining just remounts the match on it. A class because React offers error
 * boundaries in no other form.
 */
export class MatchErrorBoundary extends Component<
  MatchErrorBoundaryProps,
  MatchErrorBoundaryState
> {
  state: MatchErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MatchErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[morphy] match view crashed, offering a rejoin:", message);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pause">
        <div className="pause-card panel">
          <span className="eyebrow">Something went wrong</span>
          <h2>The match view crashed</h2>
          <span className="pause-hint">You are still in the room. Rejoin to reload the view.</span>
          <button type="button" onClick={this.props.onRejoin}>
            Rejoin
          </button>
          <button type="button" className="btn-ghost" onClick={this.props.onLeave}>
            Leave match
          </button>
        </div>
      </div>
    );
  }
}

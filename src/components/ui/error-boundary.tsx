import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './states';

interface Props {
  children: ReactNode;
  /** What failed, e.g. "your orders". */
  label?: string;
  /** Changing this resets the boundary, e.g. a route key. */
  resetKey?: string | number;
  onRetry?: () => void;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains a failing widget so one broken query cannot take down the page
 * around it.
 *
 * The root boundary already exists, but it unmounts the entire app when it
 * catches. On a dashboard with several independent panels that is the wrong
 * trade: a failed products query should not also blank the dispatch log. Wrap
 * each data region in one of these instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    // Navigating away from a broken screen should give it a clean slate.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[boundary] ${this.props.label ?? 'component'} failed`, error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    const { children, label, fallback } = this.props;

    if (!error) return children;
    if (fallback) return fallback(error, this.reset);

    return (
      <ErrorState
        title={label ? `Could not load ${label}` : 'Something went wrong'}
        message={
          // Postgres and network detail is noise to a shopper; keep it in the
          // console via componentDidCatch and show something actionable.
          'The connection may have dropped. This part of the page will not update until it recovers.'
        }
        onRetry={this.reset}
      />
    );
  }
}

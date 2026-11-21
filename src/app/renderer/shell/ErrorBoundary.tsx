import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../../ui/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[ErrorBoundary]',
      this.props.title ?? '此标签遇到错误',
      error,
      info.componentStack,
    );
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="text-ui-body text-ink-2">{this.props.title ?? '此标签遇到错误'}</p>
        <Button size="sm" variant="outline" onClick={this.retry}>
          重试
        </Button>
      </div>
    );
  }
}

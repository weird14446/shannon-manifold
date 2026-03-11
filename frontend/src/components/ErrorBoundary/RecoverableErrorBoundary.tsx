import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RecoverableErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode | ((errorMessage: string | null) => ReactNode);
  resetKey?: string | number;
}

interface RecoverableErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class RecoverableErrorBoundary extends Component<
  RecoverableErrorBoundaryProps,
  RecoverableErrorBoundaryState
> {
  state: RecoverableErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Recoverable UI error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: RecoverableErrorBoundaryProps) {
    if (
      this.state.hasError &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.errorMessage);
      }

      return this.props.fallback;
    }

    return this.props.children;
  }
}

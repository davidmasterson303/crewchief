/**
 * CrewChief - Error Boundary Component
 *
 * React error boundary that catches component errors and displays
 * a user-friendly fallback UI. Logs all errors for debugging.
 *
 * Usage:
 *   <ErrorBoundary context="DASHBOARD">
 *     <YourComponent />
 *   </ErrorBoundary>
 *
 * Or use the HOC:
 *   export default withErrorBoundary(MyComponent, 'MY_COMPONENT');
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  context?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorCount: number;
}

/**
 * Error Boundary component that catches React component errors
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const context = this.props.context || 'ERROR_BOUNDARY';

    // Log error with full details
    logger.error(context, error, {
      componentStack: errorInfo.componentStack,
      errorCount: this.state.errorCount + 1,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Update state with error details
    this.setState((prevState) => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // If error keeps happening, might need to escalate
    if (this.state.errorCount > 3) {
      logger.error(
        context,
        new Error('Multiple errors detected - possible infinite loop'),
        {
          errorCount: this.state.errorCount,
          originalError: error.message,
        }
      );
    }
  }

  handleReset = () => {
    logger.info(
      this.props.context || 'ERROR_BOUNDARY',
      'User reset error boundary'
    );
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
    });
  };

  handleRefresh = () => {
    logger.info(
      this.props.context || 'ERROR_BOUNDARY',
      'User refreshing page after error'
    );
    window.location.reload();
  };

  handleGoHome = () => {
    logger.info(
      this.props.context || 'ERROR_BOUNDARY',
      'User navigating home after error'
    );
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDevelopment = process.env.NODE_ENV === 'development';
      const showDetails = this.props.showDetails ?? isDevelopment;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Card className="w-full max-w-2xl border-red-500/50 bg-slate-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-6 w-6" />
                Something Went Wrong
              </CardTitle>
              <CardDescription className="text-slate-400">
                We encountered an unexpected error. Our team has been notified and
                is working on a fix.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-300">
                You can try refreshing the page or returning to the home page. If
                the problem persists, please contact support.
              </p>

              {showDetails && this.state.error && (
                <details className="text-xs space-y-2">
                  <summary className="cursor-pointer font-semibold text-slate-200 hover:text-white">
                    Error Details (Development Mode)
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="font-semibold text-red-400">Error:</p>
                      <pre className="mt-1 overflow-auto rounded bg-slate-900 p-3 text-red-300">
                        {this.state.error.name}: {this.state.error.message}
                      </pre>
                    </div>
                    {this.state.error.stack && (
                      <div>
                        <p className="font-semibold text-red-400">Stack Trace:</p>
                        <pre className="mt-1 overflow-auto rounded bg-slate-900 p-3 text-slate-400 text-xs max-h-40">
                          {this.state.error.stack}
                        </pre>
                      </div>
                    )}
                    {this.state.errorInfo?.componentStack && (
                      <div>
                        <p className="font-semibold text-red-400">
                          Component Stack:
                        </p>
                        <pre className="mt-1 overflow-auto rounded bg-slate-900 p-3 text-slate-400 text-xs max-h-40">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                    {this.state.errorCount > 1 && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
                        <p className="text-yellow-400 font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                          This error has occurred {this.state.errorCount} times
                        </p>
                        <p className="text-xs text-yellow-300 mt-1">
                          There may be an infinite error loop. Consider checking
                          your code logic.
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={this.handleReset}
                  variant="outline"
                  className="gap-2 border-info-border text-cyan-400 hover:bg-cyan-400/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
                <Button
                  onClick={this.handleRefresh}
                  className="gap-2 bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh Page
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="gap-2 border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  <Home className="h-4 w-4" />
                  Go Home
                </Button>
              </div>

              {!showDetails && (
                <p className="text-xs text-slate-500 mt-4">
                  Error ID: {this.state.error?.message?.substring(0, 16)}...
                  {Date.now()}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-Order Component (HOC) to wrap components with error boundary
 *
 * @param Component - The component to wrap
 * @param context - Context name for logging
 * @param options - Additional error boundary options
 */
export function withErrorBoundary<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  context: string,
  options?: {
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
  }
) {
  const WrappedComponent = (props: P) => {
    return (
      <ErrorBoundary context={context} {...options}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name || 'Component'
  })`;

  return WrappedComponent;
}

/**
 * Lightweight error boundary for specific sections
 * Shows minimal UI and focuses on recovery
 */
export function SectionErrorBoundary({
  children,
  sectionName,
}: {
  children: ReactNode;
  sectionName: string;
}) {
  return (
    <ErrorBoundary
      context={`SECTION:${sectionName}`}
      fallback={
        <div className="p-4 border border-red-500/50 rounded-lg bg-red-500/10">
          <p className="text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Error loading {sectionName}
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="sm"
            className="mt-2"
          >
            Refresh
          </Button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

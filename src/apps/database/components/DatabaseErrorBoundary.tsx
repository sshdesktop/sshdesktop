import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft, Bug } from 'lucide-react';

interface Props {
  children: ReactNode;
  onBackToHub?: () => void;
  engineName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class DatabaseErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[DatabaseStudio ErrorBoundary caught]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-[#181825] p-6 text-gray-200 select-none">
          <div className="max-w-md w-full bg-[#1e1e2e] border border-red-500/30 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center mb-4 shadow-inner">
              <AlertCircle className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-white mb-1">
              {this.props.engineName ? `${this.props.engineName} Studio Error` : 'Database Studio Render Error'}
            </h3>
            
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3 font-mono text-left w-full my-3 break-all">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>

            {this.state.errorInfo?.componentStack && (
              <details className="w-full text-left my-2">
                <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-white flex items-center gap-1">
                  <Bug className="w-3 h-3" /> View Component Stack
                </summary>
                <pre className="mt-2 text-[10px] text-gray-400 bg-black/40 p-2.5 rounded-lg overflow-x-auto max-h-36 font-mono whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="flex items-center gap-3 mt-4 w-full">
              {this.props.onBackToHub && (
                <button
                  onClick={this.props.onBackToHub}
                  className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Hub</span>
                </button>
              )}
              <button
                onClick={this.handleReset}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Studio</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

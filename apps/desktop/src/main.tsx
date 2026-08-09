import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LifeSim crash', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            background: '#1e1b4b',
            color: '#fecaca',
            fontFamily: 'ui-monospace, Consolas, monospace',
            whiteSpace: 'pre-wrap',
          }}
        >
          <h1 style={{ color: '#f87171' }}>LifeSim failed to start</h1>
          <p style={{ color: '#e2e8f0' }}>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const boot = document.getElementById('boot-status');
if (boot) boot.style.display = 'none';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element missing from index.html');
}

// StrictMode disabled: double-mount destroys Pixi mid-init and caused hard crashes in WebView.
createRoot(rootEl).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

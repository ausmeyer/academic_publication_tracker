import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>Something interrupted your workspace.</h1>
        <p>Your saved data stays on this computer. Reload to try again.</p>
        <button onClick={() => location.reload()}>Reload app</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

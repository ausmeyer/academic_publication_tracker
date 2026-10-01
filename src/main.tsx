import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { client } from './services/client';
import { backupFileName } from './library';
import './styles.css';

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: boolean; backup: string }
> {
  state = { error: false, backup: '' };
  static getDerivedStateFromError() {
    return { error: true };
  }
  /** Reads the workspace from storage, not from the crashed screen, so edits already saved are kept. */
  exportBackup = async () => {
    try {
      const workspace = await client.loadWorkspace();
      if (!workspace) {
        this.setState({ backup: 'There is no saved workspace to export.' });
        return;
      }
      const saved = await client.exportFile({
        name: backupFileName(),
        content: JSON.stringify(workspace),
      });
      this.setState({ backup: saved ? 'Workspace backup exported.' : '' });
    } catch (e) {
      this.setState({
        backup: `The backup could not be exported. ${e instanceof Error ? e.message : ''}`,
      });
    }
  };
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>Something interrupted your workspace.</h1>
        <p>Your saved data stays on this computer. Reload to try again.</p>
        <div className="fatal-actions">
          <button onClick={() => location.reload()}>Reload app</button>
          <button className="secondary" onClick={() => void this.exportBackup()}>
            Export workspace backup
          </button>
        </div>
        <p role="status">{this.state.backup}</p>
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

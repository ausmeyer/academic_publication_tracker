/**
 * Mounts the Research insights panel on its own so end-to-end tests can drive it with a save handler
 * they control (persisting, refusing, or returning nothing like an older app shell). Served by the
 * dev server only; the production build never includes it.
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import LocalInsights from '../../src/components/LocalInsights';
import { analyzeInsights } from '../../src/core/insights';
import type { InsightsSettings, SourceId, Snapshot, Work } from '../../src/types';
import '../../src/styles.css';

export interface HarnessInit {
  works: Work[];
  settings: InsightsSettings;
  source?: SourceId | 'all';
  snapshot?: Pick<Snapshot, 'name' | 'query' | 'searchedAt' | 'sourceResults'>;
}
declare global {
  interface Window {
    __init: HarnessInit;
    /** Every settings object the panel asked to save. */
    __calls: InsightsSettings[];
    /**
     * How the save handler answers: persisted, refused, nothing at all, a promise (as an
     * asynchronous shell would), or an exception.
     */
    __mode: 'ok' | 'reject' | 'silent' | 'promise' | 'throw';
  }
}

function Harness() {
  const { works, source = 'all', snapshot } = window.__init;
  const [settings, setSettings] = useState(window.__init.settings);
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <LocalInsights
        analysis={analyzeInsights(works, settings, source)}
        settings={settings}
        works={works}
        source={source}
        snapshot={snapshot}
        onChange={(next) => {
          window.__calls.push(next);
          if (window.__mode === 'throw') throw new Error('The storage layer failed.');
          if (window.__mode === 'reject') return false;
          setSettings(next);
          if (window.__mode === 'promise') return Promise.resolve(true) as unknown as boolean;
          return window.__mode === 'silent' ? (undefined as unknown as boolean) : true;
        }}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);

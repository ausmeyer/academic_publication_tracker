import { useState } from 'react';
import { Download, ExternalLink, ShieldCheck } from 'lucide-react';
import Modal from './Modal';
import { client } from '../services/client';
import type { Settings } from '../types';

export default function SettingsDialog({
  settings,
  onSave,
  onClose,
  onBackup,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onClose: () => void;
  onBackup: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Workspace settings"
      description="Your research stays on your computer."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave(draft);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save settings.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="privacy-note">
          <ShieldCheck size={23} />
          <div>
            <strong>Local by design</strong>
            <p>
              {window.desktop
                ? 'Saved searches live on this computer. API keys are encrypted using your operating system. No analytics or app account.'
                : 'Browser preview: searches are stored in this browser. API keys last only for this session. Install the desktop app for encrypted key storage.'}
            </p>
          </div>
        </div>
        <label className="field">
          Contact email <span className="optional">optional</span>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="you@university.edu"
          />
          <small>Sent to Crossref, OpenAlex, and NCBI to identify polite API requests.</small>
        </label>
        {(
          [
            ['openalexApiKey', 'OpenAlex', 'https://openalex.org/settings/api'],
            ['semanticApiKey', 'Semantic Scholar', 'https://www.semanticscholar.org/product/api'],
            ['ncbiApiKey', 'NCBI / PubMed', 'https://www.ncbi.nlm.nih.gov/account/'],
          ] as const
        ).map(([key, name, url]) => (
          <label className="field" key={key}>
            <span className="field-title">
              {name} API key{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => void client.openExternal(url)}
              >
                Get a key
                <ExternalLink size={12} />
              </button>
            </span>
            <input
              type="password"
              autoComplete="off"
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              placeholder="Optional personal API key"
            />
          </label>
        ))}
        <p className="field-help">
          Public endpoints can be rate limited. Free personal keys can improve access. Searches go
          directly to the sources you select; access terms are set by each provider.
        </p>
        <button type="button" className="button secondary full-width" onClick={onBackup}>
          <Download size={16} />
          Back up workspace as JSON
        </button>
        <p className="field-help">
          Includes saved searches, screening decisions, tags, and notes. API keys are excluded.
          Restore with Import publications.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

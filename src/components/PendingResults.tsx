import { useState } from 'react';
import Banner from './Banner';
import Modal from './Modal';
import { formatDate, formatDateTime } from '../catalog';
import { countText } from '../library';
import type { Snapshot } from '../types';

/** Results that were retrieved but could not be saved; they stay here until saved, exported or discarded. */
export interface PendingSave {
  snapshot: Snapshot;
  reason: string;
  message: string;
  origin: 'search' | 'refresh' | 'import';
}

export default function PendingResults({
  pending,
  snapshots,
  refreshSources,
  dialog,
  onDialog,
  onRetry,
  onExport,
  onRemove,
  onBackup,
  onDiscard,
}: {
  pending: PendingSave;
  snapshots: Snapshot[];
  /** Dates of the snapshots that other held refreshes copy notes, tags and exclusions from. */
  refreshSources: string[];
  /** Which of this banner's dialogs is open; the app keeps it with its other dialogs. */
  dialog: 'remove' | 'discard' | null;
  onDialog: (dialog: 'remove' | 'discard' | null) => void;
  onRetry: () => void;
  onExport: () => void;
  onRemove: (ids: string[]) => void;
  onBackup: () => void;
  onDiscard: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const { snapshot } = pending;
  const oldestFirst = [...snapshots].sort(
    (a, b) => Date.parse(a.searchedAt) - Date.parse(b.searchedAt),
  );
  return (
    <>
      <Banner title="These results have not been saved">
        <p>{pending.reason}</p>
        <p>
          “{snapshot.name}”: {countText(snapshot.works.length, 'publication', 'publications')}{' '}
          {pending.origin === 'import' ? 'imported' : 'retrieved'} {formatDate(snapshot.searchedAt)}
          . They are held in memory only and are lost if you quit.
        </p>
        <div className="banner-actions">
          <button className="button secondary compact" onClick={onRetry}>
            Retry save
          </button>
          <button className="button secondary compact" onClick={onExport}>
            Export these results as JSON
          </button>
          <button
            className="button secondary compact"
            onClick={() => {
              setChosen(new Set());
              onDialog('remove');
            }}
          >
            Remove older snapshots…
          </button>
          <button className="text-button danger-text" onClick={() => onDialog('discard')}>
            Discard results
          </button>
        </div>
      </Banner>
      {dialog === 'remove' && (
        <Modal
          title="Remove older snapshots"
          description="Choose the saved searches you no longer need. Your new results are saved right after."
          onClose={() => onDialog(null)}
          wide
        >
          <fieldset className="snapshot-choices">
            <legend className="sr-only">Snapshots to remove</legend>
            {oldestFirst.map((s) => (
              <label className="snapshot-choice" key={s.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(s.id)}
                  onChange={() =>
                    setChosen((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(s.id)) next.add(s.id);
                      return next;
                    })
                  }
                />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {formatDateTime(s.searchedAt)} · {countText(s.works.length, 'paper', 'papers')}
                  </small>
                  {refreshSources.includes(s.searchedAt) && (
                    <small className="choice-warning">
                      The unsaved refresh of this search copies its notes, tags and exclusions from
                      it.
                    </small>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="field-help">
            Removed snapshots cannot be restored unless you have a workspace backup.
          </p>
          <div className="modal-footer">
            <button className="button secondary" onClick={onBackup}>
              Back up workspace first
            </button>
            <button className="button secondary" onClick={() => onDialog(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              disabled={!chosen.size}
              onClick={() => {
                onRemove([...chosen]);
                onDialog(null);
              }}
            >
              Remove selected and save results
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'discard' && (
        <Modal
          title="Discard these results?"
          description={`“${snapshot.name}” (${countText(snapshot.works.length, 'publication', 'publications')}) has not been saved. Discarding deletes it for good.`}
          onClose={() => onDialog(null)}
        >
          <div className="modal-footer">
            <button className="button secondary" onClick={() => onDialog(null)}>
              Keep results
            </button>
            <button
              className="button danger"
              onClick={() => {
                onDialog(null);
                onDiscard();
              }}
            >
              Discard results
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

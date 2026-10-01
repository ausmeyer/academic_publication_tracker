import { useRef, useState } from 'react';
import { ArrowRight, Search, UserRound, Fingerprint, Check, ExternalLink } from 'lucide-react';
import Modal from './Modal';
import { SOURCES, sourceMark } from '../catalog';
import { RESULT_LIMITS, nearestLimit } from '../library';
import type { SearchQuery, SourceId } from '../types';

export default function SearchDialog({
  initial,
  failure,
  warning,
  onClose,
  onSearch,
}: {
  initial?: Partial<SearchQuery>;
  /** Why the previous attempt failed, when the dialog reopens with the same query. */
  failure?: string;
  /** Shown when the workspace is nearly full. */
  warning?: string;
  onClose: () => void;
  onSearch: (query: SearchQuery) => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [mode, setMode] = useState<SearchQuery['mode']>(initial?.mode ?? 'author');
  const [sources, setSources] = useState<SourceId[]>(
    initial?.sources
      ? [...new Set(initial.sources.map((source) => (source === 'arxiv' ? 'preprints' : source)))]
      : ['openalex', 'crossref', 'europepmc'],
  );
  const [from, setFrom] = useState(initial?.yearFrom?.toString() ?? '');
  const [to, setTo] = useState(initial?.yearTo?.toString() ?? '');
  const [limit, setLimit] = useState(nearestLimit(initial?.limit));
  const [error, setError] = useState(failure ?? '');
  const baseline = useRef(JSON.stringify([text, mode, sources, from, to, limit]));
  // Reopened after a failure, everything in it was typed by the person.
  const dirty =
    Boolean(failure) || baseline.current !== JSON.stringify([text, mode, sources, from, to, limit]);
  const scholarSelected = sources.includes('scholar');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setError('Enter a name, topic, or DOI to search.');
      return;
    }
    if (!sources.length) {
      setError('Select at least one source.');
      return;
    }
    if (from && to && Number(from) > Number(to)) {
      setError('The start year must be before the end year.');
      return;
    }
    onSearch({
      text: text.trim(),
      mode,
      sources,
      limit,
      ...(from ? { yearFrom: Number(from) } : {}),
      ...(to ? { yearTo: Number(to) } : {}),
    });
  }
  return (
    <Modal
      title="Start a new search"
      description="Find the literature. Keep the context."
      onClose={onClose}
      dirty={dirty}
      wide
    >
      <form onSubmit={submit}>
        {warning && (
          <p className="capacity-note" role="note">
            {warning}
          </p>
        )}
        <div className="search-modes" role="group" aria-label="Search type">
          {(
            [
              ['author', UserRound, 'Author'],
              ['topic', Search, 'Topic or title'],
              ['doi', Fingerprint, 'DOI'],
            ] as const
          ).map(([id, Icon, name]) => (
            <button
              type="button"
              className={mode === id ? 'active' : ''}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              key={id}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
        </div>
        <label className="field">
          {mode === 'author'
            ? 'Author name'
            : mode === 'doi'
              ? 'Digital object identifier'
              : 'Search terms'}
          <input
            autoFocus
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'author'
                ? 'Enter an author name'
                : mode === 'doi'
                  ? 'e.g. 10.1038/s41586-020-2649-2'
                  : 'e.g. epidemic forecasting'
            }
            required
          />
        </label>
        {mode === 'author' && (
          <p className="field-help">
            Names can refer to several people. Review affiliations and titles, then exclude
            unrelated publications before interpreting metrics.
          </p>
        )}
        <div className="form-row">
          <label className="field">
            From year
            <input
              type="number"
              min="1500"
              max={new Date().getFullYear() + 1}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="Any year"
            />
          </label>
          <label className="field">
            To year
            <input
              type="number"
              min="1500"
              max={new Date().getFullYear() + 1}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Present"
            />
          </label>
          <label className="field">
            Results per source
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {RESULT_LIMITS.map((option) => (
                <option value={option} key={option}>
                  {option} publications
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="section-label">
          <span>SEARCH SOURCES</span>
          <span>{sources.length} selected</span>
        </div>
        <div className="source-picker">
          {SOURCES.map((s) => (
            <label
              className={`source-option ${sources.includes(s.id) ? 'selected' : ''}`}
              key={s.id}
            >
              <input
                type="checkbox"
                checked={sources.includes(s.id)}
                onChange={() =>
                  setSources((prev) =>
                    prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                  )
                }
              />
              <span className={`source-logo source-${s.id}`}>{sourceMark(s.id)}</span>
              <span>
                <strong>{s.name}</strong>
                <small>{s.access}</small>
              </span>
              <span className="source-check">{sources.includes(s.id) && <Check size={12} />}</span>
            </label>
          ))}
        </div>
        {sources.includes('preprints') && (
          <p className="preprint-search-note">
            Preprints searches arXiv plus preprint records indexed by Europe PMC and Crossref,
            including bioRxiv, medRxiv, and other repositories. Results are limited to the selected
            collection size and available index coverage.
          </p>
        )}
        {scholarSelected ? (
          <div className="scholar-search-note">
            <ExternalLink size={18} />
            <div>
              <strong>
                {window.desktop ? 'Search directly in the app.' : 'Desktop search available.'}
              </strong>
              <p>
                {window.desktop
                  ? 'Results and citation counts are collected automatically, with a short pause between pages. A verification window opens only if Google needs your attention. You can stop and keep results at any time.'
                  : 'The installed desktop app collects Scholar results internally. This web preview opens Google Scholar in your browser; use Import to add exported BibTeX files.'}
              </p>
              <p>
                You can combine Scholar with PubMed or other sources. API searches run first, then
                Scholar; matching publications are merged into one saved search, preserving
                source-specific citation counts and preferring complete author lists. Each source is
                limited to the selected number of results.
              </p>
            </div>
          </div>
        ) : (
          <p className="field-help">
            Results are merged by DOI or a conservative title match. Each record keeps its source
            and retrieval date.
          </p>
        )}
        <div className="modal-footer">
          {/* In the footer, which stays in view, next to the button that was just pressed. */}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            {scholarSelected && !window.desktop
              ? sources.length === 1
                ? 'Open Google Scholar'
                : 'Search sources and open Scholar'
              : 'Search publications'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

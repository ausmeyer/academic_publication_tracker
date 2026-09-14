import {
  ExternalLink,
  X,
  LockKeyholeOpen,
  Check,
  Minus,
  Quote,
  Tag,
  FileText,
  Copy,
} from 'lucide-react';
import { client } from '../services/client';
import { formatDate, formatNumber, sourceName } from '../catalog';
import type { Work } from '../types';

export default function PaperDetails({
  work,
  onClose,
  onUpdate,
  onToast,
}: {
  work: Work;
  onClose: () => void;
  onUpdate: (update: Partial<Work>) => void;
  onToast: (message: string) => void;
}) {
  const open = async (url: string) => {
    try {
      await client.openExternal(url);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'This link could not be opened.');
    }
  };
  return (
    <aside className="paper-detail" aria-label="Publication details">
      <div className="detail-heading">
        <span>PUBLICATION DETAILS</span>
        <button className="icon-button" onClick={onClose} aria-label="Close publication details">
          <X size={18} />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-chips">
          <span className="tag">{work.type || 'Publication'}</span>
          {work.isOpenAccess && (
            <span className="tag oa">
              <LockKeyholeOpen size={12} />
              Open access
            </span>
          )}
        </div>
        <h2>{work.title}</h2>
        <p className="detail-authors">{work.authors.join(', ') || 'Authors not provided'}</p>
        <p className="detail-venue">
          {work.venue || 'Venue not provided'}
          {work.year ? ` · ${work.year}` : ''}
        </p>
        <button
          className={`screening-button ${work.included ? 'included' : ''}`}
          onClick={() => onUpdate({ included: !work.included })}
        >
          {work.included ? <Check size={17} /> : <Minus size={17} />}
          <span>{work.included ? 'Included in analysis' : 'Excluded from analysis'}</span>
          <span>{work.included ? 'Exclude' : 'Include'}</span>
        </button>
        <div className="detail-actions">
          {(work.doi || work.url) && (
            <button
              className="button secondary"
              onClick={() =>
                void open(work.doi ? `https://doi.org/${encodeURI(work.doi)}` : work.url)
              }
            >
              View publication
              <ExternalLink size={14} />
            </button>
          )}
          {work.openAccessUrl && (
            <button className="button secondary" onClick={() => void open(work.openAccessUrl)}>
              <LockKeyholeOpen size={14} />
              Open full text
              <ExternalLink size={14} />
            </button>
          )}
        </div>
        {work.doi && (
          <div className="doi-line">
            <span title={work.doi}>{work.doi}</span>
            <button
              className="icon-button"
              aria-label="Copy DOI"
              onClick={() =>
                client
                  .copyText(work.doi)
                  .then(() => onToast('DOI copied.'))
                  .catch(() => onToast('Clipboard access is unavailable.'))
              }
            >
              <Copy size={13} />
            </button>
          </div>
        )}
        <section className="detail-section">
          <h3>
            <Quote size={14} />
            Citation sources
          </h3>
          {work.provenance.length ? (
            work.provenance.map((p, i) => (
              <div className="provenance-row" key={`${p.source}-${p.sourceId}-${i}`}>
                <div>
                  <span>{sourceName(p.source)}</span>
                  <small>Retrieved {formatDate(p.retrievedAt)}</small>
                  {p.source === 'scholar' && p.url && (
                    <button
                      className="text-button captured-page-link"
                      onClick={() => void open(p.url)}
                    >
                      View captured page
                      <ExternalLink size={11} />
                    </button>
                  )}
                </div>
                <strong>{p.citations === null ? '—' : formatNumber(p.citations)}</strong>
              </div>
            ))
          ) : (
            <p className="muted">Imported record; original source not provided.</p>
          )}
          <p className="field-help">
            Counts vary by database. The combined view uses the highest available count per paper.
          </p>
        </section>
        <section className="detail-section">
          <h3>
            <FileText size={14} />
            {!work.abstract && work.snippet ? 'Search snippet' : 'Abstract'}
          </h3>
          <p className="abstract">
            {work.abstract ||
              work.snippet ||
              'This source did not provide an abstract. Open the publication to read more.'}
          </p>
        </section>
        <section className="detail-section">
          <h3>
            <Tag size={14} />
            Your organization
          </h3>
          <label className="field">
            Tags
            <input
              key={`${work.id}-tags`}
              defaultValue={work.tags.join(', ')}
              placeholder="e.g. methods, read next"
              maxLength={2000}
              onBlur={(e) => {
                const tags = [
                  ...new Set(
                    e.target.value
                      .split(',')
                      .map((t) => t.trim().slice(0, 200))
                      .filter(Boolean),
                  ),
                ].slice(0, 100);
                e.target.value = tags.join(', ');
                onUpdate({ tags });
              }}
            />
            <small>Separate tags with commas. Up to 200 characters per tag.</small>
          </label>
          <label className="field">
            Research notes
            <textarea
              key={`${work.id}-notes`}
              defaultValue={work.notes}
              placeholder="Why this paper matters, questions to revisit…"
              maxLength={100000}
              rows={5}
              onBlur={(e) => onUpdate({ notes: e.target.value })}
            />
            <small>Saved when you leave this field.</small>
          </label>
        </section>
      </div>
    </aside>
  );
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { doiUrl } from '../core/merge';
import { workKind, workKindLabel } from '../core/worktype';
import { addTypedTags } from '../library';
import type { Work } from '../types';

const SAVE_DELAY = 400;

/**
 * Text that is saved a moment after typing stops, and immediately on blur, when the panel closes
 * or the window is hidden or quit (the app reaches `flush` through `register`). Text the workspace
 * refuses (`commit` returns false) stays unsaved and is sent again at the next of these.
 */
function useAutosave(
  initial: string,
  commit: (text: string) => boolean,
  register: (flush: () => void) => () => void,
  stored = initial,
) {
  const [value, setValue] = useState(initial);
  // While refused, the text is sent even when it matches `saved` again: that drops the refusal.
  const live = useRef({ value: initial, saved: stored, refused: initial !== stored, commit });
  live.current.commit = commit;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const state = live.current;
    if (state.value === state.saved && !state.refused) return;
    state.refused = !state.commit(state.value);
    if (!state.refused) state.saved = state.value;
  }, []);
  useEffect(() => register(flush), [register, flush]);
  useEffect(() => flush, [flush]);
  const replace = (next: string) => {
    live.current.value = next;
    setValue(next);
  };
  const change = (next: string) => {
    replace(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };
  return { value, change, flush };
}

export default function PaperDetails({
  work,
  refused,
  onClose,
  onUpdate,
  onToast,
  registerFlush,
}: {
  work: Work;
  /** Notes and tags the workspace refused before the panel was last closed: shown again. */
  refused?: Partial<Pick<Work, 'notes' | 'tags'>>;
  onClose: () => void;
  /** False when the workspace refused the update. */
  onUpdate: (update: Partial<Work>) => boolean;
  onToast: (message: string) => void;
  /** `hiding`: the window is only hidden, so what is being typed may still be finished. */
  registerFlush: (flush: (hiding: boolean) => void) => () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const notes = useAutosave(
    refused?.notes ?? work.notes,
    (text) => onUpdate({ notes: text }),
    registerFlush,
    work.notes,
  );
  // Existing tags are kept verbatim (keywords such as "Influenza, Human" contain commas); only
  // newly typed text is split, and each change is saved at once.
  const tagInputId = useId();
  const tagInput = useRef<HTMLInputElement>(null);
  const [tagDraft, setTagDraft] = useState(
    () => refused?.tags?.filter((tag) => !work.tags.includes(tag)).join(', ') ?? '',
  );
  const [tagMessage, setTagMessage] = useState('');
  const latest = useRef({ tags: work.tags, onUpdate, draft: tagDraft });
  latest.current = { tags: work.tags, onUpdate, draft: tagDraft };
  // Refused tags stay in the field and are sent again, even once emptied, which drops them.
  const tagsRefused = useRef(refused?.tags !== undefined);
  /** Adds typed tags; returns what stays in the field (over the limit, or refused by the workspace). */
  const addTags = useCallback((text: string) => {
    const { tags, onUpdate } = latest.current;
    const { next, left, message } = addTypedTags(tags, text);
    setTagMessage(message);
    if (!next && !tagsRefused.current) return left;
    tagsRefused.current = !onUpdate({ tags: next ?? tags });
    return tagsRefused.current ? text : left;
  }, []);
  // Text typed without Enter is added on blur, when the panel closes and when the window closes or
  // the app quits; hiding the window or switching apps leaves a word being typed unfinished.
  const addDraft = useCallback(() => {
    const text = latest.current.draft;
    const left = text.trim() || tagsRefused.current ? addTags(text) : '';
    latest.current.draft = left;
    setTagDraft(left);
  }, [addTags]);
  useEffect(
    () =>
      registerFlush((hiding) => {
        if (!hiding) addDraft();
      }),
    [registerFlush, addDraft],
  );
  useEffect(() => addDraft, [addDraft]);
  const open = async (url: string) => {
    try {
      await client.openExternal(url);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'This link could not be opened.');
    }
  };
  return (
    <aside
      className="paper-detail"
      aria-label="Publication details"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="detail-heading">
        <span>PUBLICATION DETAILS</span>
        <button className="icon-button" onClick={onClose} aria-label="Close publication details">
          <X size={18} />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-chips">
          <span className="tag" title={work.type || undefined}>
            {work.type ? workKindLabel(workKind(work.type)) : 'Publication'}
          </span>
          {work.isOpenAccess && (
            <span className="tag oa">
              <LockKeyholeOpen size={12} />
              Open access
            </span>
          )}
        </div>
        <h2 ref={heading} tabIndex={-1}>
          {work.title}
        </h2>
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
              onClick={() => void open(work.doi ? doiUrl(work.doi) : work.url)}
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
          <div className="field">
            <label htmlFor={tagInputId}>Tags</label>
            {work.tags.length > 0 && (
              <ul className="tag-chips" aria-label="Tags">
                {work.tags.map((tag, i) => (
                  <li key={`${i}-${tag}`}>
                    <span>{tag}</span>
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => {
                        onUpdate({ tags: work.tags.filter((t) => t !== tag) });
                        tagInput.current?.focus();
                      }}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              id={tagInputId}
              ref={tagInput}
              value={tagDraft}
              placeholder="e.g. methods, read next"
              maxLength={2000}
              aria-describedby={`${tagInputId}-help`}
              onChange={(e) => {
                // Everything before the last comma becomes tags; the rest is still being typed.
                // What cannot be added yet stays in the field.
                const parts = e.target.value.split(',');
                const rest = parts.pop()!;
                setTagMessage('');
                const kept = parts.length ? addTags(parts.join(',')) : '';
                const draft = kept ? `${kept},${rest}` : rest;
                latest.current.draft = draft;
                setTagDraft(draft);
              }}
              onKeyDown={(e) => {
                // The Enter that confirms an input method's composition is not one for the tag.
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                addDraft();
              }}
              onBlur={() => {
                if (document.hasFocus()) addDraft();
              }}
            />
            <small id={`${tagInputId}-help`}>
              Press Enter or type a comma to add a tag; up to 200 characters each. Saved
              automatically.{' '}
              <span className="field-message" role="status">
                {tagMessage}
              </span>
            </small>
          </div>
          <label className="field">
            Research notes
            <textarea
              value={notes.value}
              placeholder="Why this paper matters, questions to revisit…"
              maxLength={100000}
              rows={5}
              onChange={(e) => notes.change(e.target.value)}
              onBlur={notes.flush}
            />
            <small>Saved automatically.</small>
          </label>
        </section>
      </div>
    </aside>
  );
}

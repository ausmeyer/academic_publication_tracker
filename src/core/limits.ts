import type { Work } from '../types.ts';

export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;

/**
 * Field limits enforced by the workspace validator. Search adapters and importers clamp to the
 * same numbers, so one unusual record can never make a whole result set unsaveable.
 */
export const LIMITS = {
  id: 1000,
  title: 20000,
  authors: 10000,
  authorName: 1000,
  venue: 20000,
  doi: 2000,
  abstract: 200000,
  snippet: 10000,
  type: 200,
  url: 8000,
  tags: 100,
  tag: 200,
  notes: 100000,
  provenance: 100,
  sourceId: 2000,
  citationHistory: 10000,
  snapshotName: 500,
  snapshots: 500,
  works: 20000,
  totalWorks: 100000,
} as const;

/** Shortens text to at most `max` UTF-16 units, marking the cut with an ellipsis. */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--; // never split a surrogate pair
  return `${value.slice(0, end)}…`;
}

const dropIfTooLong = (value: string, max: number) => (value.length > max ? '' : value);

/** Returns a copy of the record with every field inside the validator limits. */
export function clampWork(work: Work): Work {
  return {
    ...work,
    id: clampText(work.id, LIMITS.id),
    title: clampText(work.title, LIMITS.title),
    authors: work.authors
      .slice(0, LIMITS.authors)
      .map((author) => clampText(author, LIMITS.authorName)),
    ...(work.authors.length > LIMITS.authors ? { authorsComplete: false } : {}),
    ...(work.citationHistory
      ? { citationHistory: work.citationHistory.slice(0, LIMITS.citationHistory) }
      : {}),
    venue: clampText(work.venue, LIMITS.venue),
    doi: dropIfTooLong(work.doi, LIMITS.doi),
    abstract: clampText(work.abstract, LIMITS.abstract),
    ...(work.snippet === undefined ? {} : { snippet: clampText(work.snippet, LIMITS.snippet) }),
    type: clampText(work.type, LIMITS.type),
    url: dropIfTooLong(work.url, LIMITS.url),
    openAccessUrl: dropIfTooLong(work.openAccessUrl, LIMITS.url),
    tags: work.tags.slice(0, LIMITS.tags).map((tag) => clampText(tag, LIMITS.tag)),
    notes: clampText(work.notes, LIMITS.notes),
    provenance: work.provenance.slice(0, LIMITS.provenance).map((record) => ({
      ...record,
      sourceId: clampText(record.sourceId, LIMITS.sourceId),
      url: dropIfTooLong(record.url, LIMITS.url),
    })),
  };
}

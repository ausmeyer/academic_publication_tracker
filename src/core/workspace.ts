import type { Workspace, Snapshot, SourceId, Work, SearchQuery, SourceResult } from '../types';
import { validateInsights } from './insights-data';
import { LIMITS, MAX_WORKSPACE_BYTES } from './limits';
export { MAX_WORKSPACE_BYTES };
/** Version 1 workspaces are still read; everything is written as version 2. */
export const WORKSPACE_VERSION = 2 as const;
const sourceIds = new Set([
  'openalex',
  'crossref',
  'europepmc',
  'pubmed',
  'semantic',
  'arxiv',
  'scholar',
  'preprints',
  'datacite',
]);
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid workspace record.');
  return v as Record<string, unknown>;
};
const string = (v: unknown, max = 20000, label?: string): string => {
  if (typeof v !== 'string' || v.length > max)
    throw new Error(`Invalid or oversized text in workspace${label ? ` (${label})` : ''}.`);
  return v;
};
const number = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    throw new Error('Invalid number in workspace.');
  return v;
};
const nullableNumber = (v: unknown): number | null => (v === null ? null : number(v));
const boolean = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new Error('Invalid workspace flag.');
  return v;
};
const array = (v: unknown, max: number, label?: string): unknown[] => {
  if (!Array.isArray(v) || v.length > max)
    throw new Error(`Invalid or oversized workspace list${label ? ` (${label})` : ''}.`);
  return v;
};
const source = (v: unknown): SourceId => {
  if (typeof v !== 'string' || !sourceIds.has(v))
    throw new Error('Unknown data source in workspace.');
  return v as SourceId;
};
const date = (v: unknown): string => {
  const s = string(v, 100);
  if (Number.isNaN(Date.parse(s))) throw new Error('Invalid snapshot date.');
  return s;
};
const webUrl = (v: unknown): string => {
  const s = string(v, LIMITS.url, 'link');
  if (!s) return '';
  try {
    const url = new URL(s);
    if (['http:', 'https:'].includes(url.protocol)) return s;
  } catch {
    /* Invalid links are omitted. */
  }
  return '';
};
function work(value: unknown): Work {
  const v = object(value);
  return {
    id: string(v.id, LIMITS.id, 'id'),
    title: string(v.title, LIMITS.title, 'title'),
    authors: array(v.authors, LIMITS.authors, 'authors').map((a) =>
      string(a, LIMITS.authorName, 'author name'),
    ),
    ...(v.authorsComplete === undefined ? {} : { authorsComplete: boolean(v.authorsComplete) }),
    ...(v.citationHistory === undefined
      ? {}
      : {
          citationHistory: array(v.citationHistory, LIMITS.citationHistory).map((raw) => {
            const r = object(raw);
            const year = number(r.year);
            const citations = number(r.citations);
            if (
              !Number.isInteger(year) ||
              year < 1000 ||
              year > 3000 ||
              !Number.isSafeInteger(citations)
            )
              throw new Error('Invalid citation history.');
            return { year, citations, source: source(r.source) };
          }),
        }),
    year: nullableNumber(v.year),
    venue: string(v.venue, LIMITS.venue, 'venue'),
    doi: string(v.doi, LIMITS.doi, 'doi'),
    abstract: string(v.abstract, LIMITS.abstract, 'abstract'),
    ...(v.snippet === undefined ? {} : { snippet: string(v.snippet, LIMITS.snippet, 'snippet') }),
    type: string(v.type, LIMITS.type, 'type'),
    url: webUrl(v.url),
    openAccessUrl: webUrl(v.openAccessUrl),
    isOpenAccess: boolean(v.isOpenAccess),
    citations: nullableNumber(v.citations),
    included: boolean(v.included),
    tags: array(v.tags, LIMITS.tags, 'tags').map((t) => string(t, LIMITS.tag, 'tag')),
    notes: string(v.notes, LIMITS.notes, 'notes'),
    provenance: array(v.provenance, LIMITS.provenance, 'provenance').map((p) => {
      const x = object(p);
      return {
        source: source(x.source),
        sourceId: string(x.sourceId, LIMITS.sourceId, 'source id'),
        citations: nullableNumber(x.citations),
        retrievedAt: date(x.retrievedAt),
        url: webUrl(x.url),
      };
    }),
  };
}
function query(value: unknown): SearchQuery {
  const v = object(value);
  if (!['topic', 'author', 'doi'].includes(String(v.mode))) throw new Error('Invalid search mode.');
  return {
    text: string(v.text, 1000),
    mode: v.mode as SearchQuery['mode'],
    sources: array(v.sources, sourceIds.size).map(source),
    limit: number(v.limit),
    ...(v.yearFrom === undefined ? {} : { yearFrom: number(v.yearFrom) }),
    ...(v.yearTo === undefined ? {} : { yearTo: number(v.yearTo) }),
  };
}
/** UTF-8 size of the workspace as it is stored: compact JSON. */
export function workspaceBytes(workspace: Workspace): number {
  return new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
}
export function validateWorkspace(value: unknown): Workspace {
  const v = object(value);
  if (v.version !== 1 && v.version !== WORKSPACE_VERSION)
    throw new Error('This workspace version is not supported.');
  const snapshots: Snapshot[] = array(v.snapshots, LIMITS.snapshots).map((value) => {
    const s = object(value);
    const name = string(s.name, LIMITS.snapshotName);
    const results: Omit<SourceResult, 'works'>[] = array(s.sourceResults, sourceIds.size).map(
      (value) => {
        const r = object(value);
        return {
          source: source(r.source),
          total: nullableNumber(r.total),
          ...(r.error ? { error: string(r.error) } : {}),
          ...(r.warning ? { warning: string(r.warning) } : {}),
        };
      },
    );
    const snapshot: Snapshot = {
      id: string(s.id, 200),
      name,
      query: query(s.query),
      works: array(s.works, LIMITS.works).map((record, index) => {
        try {
          return work(record);
        } catch (error) {
          const reason =
            error instanceof Error ? error.message.replace(/\.$/, '') : 'Invalid record';
          throw new Error(`${reason} — search “${name}”, record ${index + 1}.`);
        }
      }),
      searchedAt: date(s.searchedAt),
      sourceResults: results,
    };
    if (s.isDemo !== undefined) snapshot.isDemo = boolean(s.isDemo);
    if (s.insights !== undefined) snapshot.insights = validateInsights(s.insights);
    if (s.previous) {
      const p = object(s.previous);
      snapshot.previous = {
        searchedAt: date(p.searchedAt),
        papers: number(p.papers),
        citations: number(p.citations),
      };
    }
    if (new Set(snapshot.works.map((w) => w.id)).size !== snapshot.works.length)
      throw new Error('Duplicate publication IDs in workspace.');
    return snapshot;
  });
  if (snapshots.reduce((sum, s) => sum + s.works.length, 0) > LIMITS.totalWorks)
    throw new Error('Workspace is too large (100,000 publication limit).');
  if (new Set(snapshots.map((s) => s.id)).size !== snapshots.length)
    throw new Error('Duplicate snapshot IDs in workspace.');
  const activeId = v.activeId === null ? null : string(v.activeId, 200);
  if (activeId && !snapshots.some((s) => s.id === activeId))
    throw new Error('The active search is missing from this workspace.');
  const workspace: Workspace = { version: WORKSPACE_VERSION, snapshots, activeId };
  if (workspaceBytes(workspace) > MAX_WORKSPACE_BYTES) {
    throw new Error(
      'The workspace would exceed 25 MB. Back up and remove older snapshots before adding more data.',
    );
  }
  return workspace;
}

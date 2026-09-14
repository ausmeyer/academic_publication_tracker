import type { Workspace, Snapshot, SourceId, Work, SearchQuery, SourceResult } from '../types';
export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
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
const string = (v: unknown, max = 20000): string => {
  if (typeof v !== 'string' || v.length > max)
    throw new Error('Invalid or oversized text in workspace.');
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
const array = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error('Invalid or oversized workspace list.');
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
  const s = string(v, 8000);
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
    id: string(v.id, 1000),
    title: string(v.title),
    authors: array(v.authors, 10000).map((a) => string(a, 1000)),
    year: nullableNumber(v.year),
    venue: string(v.venue),
    doi: string(v.doi, 2000),
    abstract: string(v.abstract, 200000),
    ...(v.snippet === undefined ? {} : { snippet: string(v.snippet, 10000) }),
    type: string(v.type, 200),
    url: webUrl(v.url),
    openAccessUrl: webUrl(v.openAccessUrl),
    isOpenAccess: boolean(v.isOpenAccess),
    citations: nullableNumber(v.citations),
    included: boolean(v.included),
    tags: array(v.tags, 100).map((t) => string(t, 200)),
    notes: string(v.notes, 100000),
    provenance: array(v.provenance, 100).map((p) => {
      const x = object(p);
      return {
        source: source(x.source),
        sourceId: string(x.sourceId, 2000),
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
export function validateWorkspace(value: unknown): Workspace {
  const v = object(value);
  if (v.version !== 1) throw new Error('This workspace version is not supported.');
  const snapshots: Snapshot[] = array(v.snapshots, 500).map((value) => {
    const s = object(value);
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
      name: string(s.name, 500),
      query: query(s.query),
      works: array(s.works, 20000).map(work),
      searchedAt: date(s.searchedAt),
      sourceResults: results,
    };
    if (s.isDemo !== undefined) snapshot.isDemo = boolean(s.isDemo);
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
  if (snapshots.reduce((sum, s) => sum + s.works.length, 0) > 100000)
    throw new Error('Workspace is too large (100,000 publication limit).');
  if (new Set(snapshots.map((s) => s.id)).size !== snapshots.length)
    throw new Error('Duplicate snapshot IDs in workspace.');
  const activeId = v.activeId === null ? null : string(v.activeId, 200);
  if (activeId && !snapshots.some((s) => s.id === activeId))
    throw new Error('The active search is missing from this workspace.');
  const workspace: Workspace = { version: 1, snapshots, activeId };
  if (
    new TextEncoder().encode(JSON.stringify(workspace, null, 2)).byteLength > MAX_WORKSPACE_BYTES
  ) {
    throw new Error(
      'The workspace would exceed 25 MB. Back up and remove older snapshots before adding more data.',
    );
  }
  return workspace;
}

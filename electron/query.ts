import type { SearchQuery, SourceId } from '../src/types';
import { normalizeDoi } from '../src/core/merge';

const API_SOURCES = new Set<SourceId>([
  'openalex',
  'crossref',
  'europepmc',
  'pubmed',
  'semantic',
  'arxiv',
  'preprints',
  'datacite',
]);

/**
 * Checks a provider search before any settings or network work happens. The rules and messages are
 * the ones searchSources applies, so people see one wording wherever a request is refused.
 */
export function validateQuery(value: unknown): SearchQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid search request.');
  const query = value as SearchQuery;
  if (typeof query.text !== 'string' || query.text.trim().length < 2 || query.text.length > 500)
    throw new Error('Enter a search between 2 and 500 characters.');
  if (!['topic', 'author', 'doi'].includes(query.mode))
    throw new Error('Choose topic, author, or DOI search.');
  if (
    !Array.isArray(query.sources) ||
    query.sources.length === 0 ||
    query.sources.length > API_SOURCES.size ||
    query.sources.some((source) => !API_SOURCES.has(source))
  )
    throw new Error('Choose at least one supported data source.');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)
    throw new Error('Choose between 1 and 200 results per source.');
  const latestYear = new Date().getFullYear() + 1;
  for (const year of [query.yearFrom, query.yearTo]) {
    if (year != null && (!Number.isInteger(year) || year < 1500 || year > latestYear))
      throw new Error(`Publication years must be between 1500 and ${latestYear}.`);
  }
  if (query.yearFrom != null && query.yearTo != null && query.yearFrom > query.yearTo)
    throw new Error('The start year must come before the end year.');
  const text = query.text.trim();
  if (query.mode === 'doi' && !normalizeDoi(text))
    throw new Error('Enter a complete DOI, such as 10.1038/nature12373.');
  return {
    text,
    mode: query.mode,
    sources: [...new Set(query.sources)],
    limit: query.limit,
    yearFrom: query.yearFrom ?? undefined,
    yearTo: query.yearTo ?? undefined,
  };
}

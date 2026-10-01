import type { DesktopBridge, SearchQuery, SearchResponse, SourceResult } from '../types';

/** Separate provider requests share one result set; desktop IPC permits only one active search. */
export async function searchSelectedSources(
  query: SearchQuery,
  client: Pick<DesktopBridge, 'search' | 'searchScholar'>,
  onPhase: (phase: 'api' | 'scholar') => void,
  scholarExternal: boolean,
): Promise<SearchResponse | null> {
  const apiSources = query.sources.filter((source) => source !== 'scholar');
  const results: SourceResult[] = [];
  if (apiSources.length) {
    onPhase('api');
    try {
      results.push(...(await client.search({ ...query, sources: apiSources })).results);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API search failed.';
      results.push(
        ...apiSources.map((source) => ({ source, works: [], total: null, error: message })),
      );
    }
  }
  if (query.sources.includes('scholar')) {
    onPhase('scholar');
    try {
      const scholar = await client.searchScholar({ ...query, sources: ['scholar'] });
      if (scholar) results.push(...scholar.results);
      else if (!scholarExternal || !apiSources.length) return null;
      else
        results.push({
          source: 'scholar',
          works: [],
          total: null,
          warning:
            'Scholar opened externally. No Scholar records were imported; API results are saved below. Use the desktop app to collect and merge Scholar results.',
        });
    } catch (error) {
      results.push({
        source: 'scholar',
        works: [],
        total: null,
        error: error instanceof Error ? error.message : 'Scholar search failed.',
      });
    }
  }
  return { results, searchedAt: new Date().toISOString() };
}

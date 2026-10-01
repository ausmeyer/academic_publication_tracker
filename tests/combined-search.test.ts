import { describe, expect, it, vi } from 'vitest';
import { searchSelectedSources } from '../src/services/combined-search';
import type { SearchQuery, SearchResponse } from '../src/types';

const query: SearchQuery = {
  text: 'Jane Scholar',
  mode: 'author',
  sources: ['scholar', 'pubmed'],
  limit: 100,
};
const response = (source: 'scholar' | 'pubmed'): SearchResponse => ({
  searchedAt: '2026-09-16T00:00:00Z',
  results: [{ source, works: [], total: 0 }],
});
describe('combined Scholar and API search', () => {
  it('runs isolated provider requests sequentially and combines provenance results', async () => {
    let apiFinished = false;
    const client = {
      search: vi.fn(async () => {
        await Promise.resolve();
        apiFinished = true;
        return response('pubmed');
      }),
      searchScholar: vi.fn(async () => {
        expect(apiFinished).toBe(true);
        return response('scholar');
      }),
    };
    const phase = vi.fn();
    const result = await searchSelectedSources(query, client, phase, false);
    expect(client.search).toHaveBeenCalledWith({ ...query, sources: ['pubmed'] });
    expect(client.searchScholar).toHaveBeenCalledWith({ ...query, sources: ['scholar'] });
    expect(phase.mock.calls).toEqual([['api'], ['scholar']]);
    expect(result?.results.map((r) => r.source)).toEqual(['pubmed', 'scholar']);
    expect(query.sources).toEqual(['scholar', 'pubmed']);
  });
  it.each(['api', 'scholar'])('keeps the other source when %s fails', async (failed) => {
    const client = {
      search: vi.fn(async () => {
        if (failed === 'api') throw new Error('API unavailable');
        return response('pubmed');
      }),
      searchScholar: vi.fn(async () => {
        if (failed === 'scholar') throw new Error('Scholar unavailable');
        return response('scholar');
      }),
    };
    const result = await searchSelectedSources(query, client, () => {}, false);
    expect(result?.results).toHaveLength(2);
    expect(result?.results.filter((r) => r.error)).toHaveLength(1);
    expect(result?.results.filter((r) => !r.error)).toHaveLength(1);
  });
  it('discards a canceled desktop search, but preserves API results for an external browser search', async () => {
    const client = {
      search: vi.fn(async () => response('pubmed')),
      searchScholar: vi.fn(async () => null),
    };
    expect(await searchSelectedSources(query, client, () => {}, false)).toBeNull();
    const external = await searchSelectedSources(query, client, () => {}, true);
    expect(external?.results).toMatchObject([
      { source: 'pubmed' },
      {
        source: 'scholar',
        works: [],
        warning: expect.stringContaining('No Scholar records were imported'),
      },
    ]);
    expect(
      await searchSelectedSources({ ...query, sources: ['scholar'] }, client, () => {}, true),
    ).toBeNull();
  });
  it('does not call providers that were not selected', async () => {
    const client = {
      search: vi.fn(async () => response('pubmed')),
      searchScholar: vi.fn(async () => response('scholar')),
    };
    await searchSelectedSources({ ...query, sources: ['pubmed'] }, client, () => {}, false);
    expect(client.searchScholar).not.toHaveBeenCalled();
    client.search.mockClear();
    await searchSelectedSources({ ...query, sources: ['scholar'] }, client, () => {}, false);
    expect(client.search).not.toHaveBeenCalled();
  });
});

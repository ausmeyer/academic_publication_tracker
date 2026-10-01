import { describe, expect, it, vi } from 'vitest';
import { runProviderSearch, withSettingsWarning } from '../electron/search';
import type { SearchQuery, SearchResponse, Settings } from '../src/types';

const query: SearchQuery = {
  text: 'epidemic forecasting',
  mode: 'topic',
  sources: ['crossref', 'pubmed'],
  limit: 20,
};
const keyless: Settings = { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
const configured: Settings = { ...keyless, email: 'me@example.org', ncbiApiKey: 'ncbi-key' };
const response = (
  warnings: (string | undefined)[] = [undefined, 'Existing note.'],
): SearchResponse => ({
  searchedAt: '2026-09-30T12:00:00.000Z',
  results: warnings.map((warning, index) => ({
    source: index === 0 ? 'crossref' : 'pubmed',
    works: [],
    total: null,
    ...(warning ? { warning } : {}),
  })),
});
const WARNING =
  'Saved API settings could not be read; searching without API keys. Open Settings to re-enter them.';

describe('provider searches in the main process', () => {
  it('passes the saved settings and the operating system network stack to the search', async () => {
    const search = vi.fn(async () => response());
    const networkFetch = vi.fn() as unknown as typeof fetch;
    const result = await runProviderSearch(query, {
      store: { loadSettingsLenient: async () => ({ settings: configured, warning: null }) },
      search,
      fetch: networkFetch,
    });
    expect(search).toHaveBeenCalledWith(query, configured, { fetch: networkFetch });
    expect(result).toEqual(response());
  });

  it('uses the default network stack when none is supplied', async () => {
    const search = vi.fn(async () => response());
    await runProviderSearch(query, {
      store: { loadSettingsLenient: async () => ({ settings: configured, warning: null }) },
      search,
    });
    expect(search).toHaveBeenCalledWith(query, configured, undefined);
  });

  it('searches without keys when saved settings cannot be read, and says so on every source', async () => {
    const search = vi.fn(async () => response());
    const result = await runProviderSearch(query, {
      store: { loadSettingsLenient: async () => ({ settings: keyless, warning: WARNING }) },
      search,
    });
    expect(search).toHaveBeenCalledWith(query, keyless, undefined);
    expect(result.results.map((entry) => entry.warning)).toEqual([
      WARNING,
      `Existing note. ${WARNING}`,
    ]);
  });

  it('does not touch the response when the settings were fine', async () => {
    const original = response();
    const result = await runProviderSearch(query, {
      store: { loadSettingsLenient: async () => ({ settings: configured, warning: null }) },
      search: async () => original,
    });
    expect(result).toBe(original);
  });

  it('does not swallow a failure of the search itself', async () => {
    await expect(
      runProviderSearch(query, {
        store: { loadSettingsLenient: async () => ({ settings: configured, warning: null }) },
        search: async () => {
          throw new Error('Enter a search between 2 and 500 characters.');
        },
      }),
    ).rejects.toThrow('Enter a search between 2 and 500 characters.');
  });

  it('appends the warning without mutating the original response', () => {
    const original = response();
    const warned = withSettingsWarning(original, WARNING);
    expect(warned).not.toBe(original);
    expect(original.results[0].warning).toBeUndefined();
    expect(warned.searchedAt).toBe(original.searchedAt);
  });
});

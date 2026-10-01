import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchResponse } from '../src/types';

// The adapters must build doi.org links with the one shared helper, so link encoding cannot drift.
vi.mock('../src/core/merge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/merge')>()),
  doiUrl: (doi: string) => `https://doi.org/shared-helper/${doi}`,
}));

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('doi.org links of provider records', () => {
  it('come from the shared doiUrl of core/merge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          message: {
            'total-results': 2,
            items: [
              { DOI: '10.1234/no-url', title: ['Without a URL'], type: 'journal-article' },
              {
                DOI: '10.1234/resolver',
                URL: 'http://dx.doi.org/10.1234/resolver',
                title: ['With a resolver URL'],
                type: 'journal-article',
              },
            ],
          },
        }),
      ),
    );
    const pending = searchSources(
      { text: 'influenza', mode: 'topic', sources: ['crossref'], limit: 5 },
      DEFAULT_SETTINGS,
    );
    await vi.runAllTimersAsync();
    const response: SearchResponse = await pending;
    expect(response.results[0].works.map((work) => work.url)).toEqual([
      'https://doi.org/shared-helper/10.1234/no-url',
      'https://doi.org/shared-helper/10.1234/resolver',
    ]);
  });
});

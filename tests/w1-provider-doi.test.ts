import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeWorks } from '../src/core/merge';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse } from '../src/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-06T12:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  clock += 300000;
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function finish(promise: Promise<SearchResponse>) {
  await vi.runAllTimersAsync();
  return promise;
}
async function run(changes: Partial<SearchQuery>, respond: (url: URL) => Response) {
  const fetcher = vi.fn(async (url: URL) => respond(url));
  vi.stubGlobal('fetch', fetcher);
  const response = await finish(
    searchSources(
      {
        text: 'organic light emitting',
        mode: 'topic',
        sources: ['openalex'],
        limit: 5,
        ...changes,
      },
      DEFAULT_SETTINGS,
    ),
  );
  return { response, fetcher };
}

// A real Wiley SICI DOI whose check character is "#"; OpenAlex reports DOIs as doi.org links.
const HASH = '10.1002/(sici)1521-4095(199808)10:12<931::aid-adma931>3.0.co;2-#';
const HASH_LINK =
  'https://doi.org/10.1002/(sici)1521-4095(199808)10:12%3C931::aid-adma931%3E3.0.co;2-%23';
const TITLE = 'Organic light-emitting devices with a very long descriptive title';
const openalexPage = () =>
  json({
    meta: { count: 1 },
    results: [
      {
        id: 'https://openalex.org/W42',
        display_name: TITLE,
        publication_year: 1998,
        doi: `https://doi.org/${HASH}`,
        type: 'article',
        authorships: [{ author: { display_name: 'Jane Smith' } }],
        primary_location: { landing_page_url: `https://doi.org/${HASH}` },
        cited_by_count: 10,
      },
    ],
  });
const crossrefPage = () =>
  json({
    message: {
      'total-results': 1,
      items: [
        {
          DOI: HASH,
          title: [TITLE],
          author: [{ given: 'Jane', family: 'Smith' }],
          published: { 'date-parts': [[1998]] },
          type: 'journal-article',
          'is-referenced-by-count': 12,
        },
      ],
    },
  });

describe('a provider DOI sent as a doi.org link keeps a trailing "#"', () => {
  it('keeps the OpenAlex DOI whole and links it without losing the "#"', async () => {
    const { response } = await run({}, openalexPage);
    const [record] = response.results[0].works;
    expect(record.doi).toBe(HASH);
    expect(record.url).toBe(HASH_LINK);
    expect(record.provenance[0].url).toBe(HASH_LINK);
  });

  it('merges the OpenAlex and Crossref copies of the paper into one record', async () => {
    const { response } = await run({ sources: ['openalex', 'crossref'] }, (url) =>
      url.hostname === 'api.openalex.org' ? openalexPage() : crossrefPage(),
    );
    const merged = mergeWorks(response.results.flatMap((result) => result.works));
    expect(merged).toHaveLength(1);
    expect(merged[0].doi).toBe(HASH);
    expect(merged[0].provenance.map((entry) => entry.source).sort()).toEqual([
      'crossref',
      'openalex',
    ]);
  });

  it('finds that DOI through OpenAlex in DOI mode', async () => {
    const { response } = await run({ mode: 'doi', text: HASH }, openalexPage);
    expect(response.results[0].error).toBeUndefined();
    expect(response.results[0].works.map((work) => work.doi)).toEqual([HASH]);
  });
});

describe('a typed or pasted doi.org link is still read as a link', () => {
  it.each(['https://doi.org/10.1234/abc?utm_source=feed', 'https://doi.org/10.1234/abc#section'])(
    'looks up %j without its query or fragment',
    async (text) => {
      const { fetcher } = await run({ mode: 'doi', text, sources: ['crossref'] }, () =>
        json({ message: { DOI: '10.1234/abc', title: ['A paper'], type: 'journal-article' } }),
      );
      expect(decodeURIComponent(fetcher.mock.calls[0][0].pathname)).toBe('/works/10.1234/abc');
    },
  );
});

describe('a provider DOI is the DOI, not a link with a query or fragment', () => {
  // Only the textual removal of the doi.org prefix keeps these: read as a link, everything from the
  // first "#" or "?" would be cut off.
  it.each(['10.1234/a#b', '10.1234/a?b=c#d'])('keeps the DOI %s whole', async (doi) => {
    const { response } = await run({}, () =>
      json({
        meta: { count: 1 },
        results: [
          {
            id: 'https://openalex.org/W43',
            display_name: TITLE,
            publication_year: 1998,
            doi: `https://doi.org/${doi}`,
            type: 'article',
            authorships: [{ author: { display_name: 'Jane Smith' } }],
            cited_by_count: 1,
          },
        ],
      }),
    );
    expect(response.results[0].works[0].doi).toBe(doi);
  });
});

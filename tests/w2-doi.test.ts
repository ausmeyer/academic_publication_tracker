import { afterEach, describe, expect, it, vi } from 'vitest';
import { doiUrl, mergeWorks, normalizeDoi } from '../src/core/merge';
import { normalizeScholarPage } from '../src/core/scholar';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';

// A real Wiley SICI DOI whose check character is "#".
const HASH = '10.1002/(sici)1521-4095(199808)10:12<931::aid-adma931>3.0.co;2-#';
const TITLE = 'Organic light-emitting devices with a very long descriptive title';

describe('W2-03 a doi.org link keeps a final "#" or "?" that has nothing after it', () => {
  it.each([
    [`https://doi.org/${HASH}`, HASH],
    [`https://doi.org/${HASH.toUpperCase()}`, HASH],
    [`http://dx.doi.org/${HASH}`, HASH],
    [`doi.org/${HASH}`, HASH],
    [`<https://doi.org/${HASH}>`, HASH],
    ['https://doi.org/10.1234/abc?', '10.1234/abc?'],
    ['https://doi.org/10.1234/abc#', '10.1234/abc#'],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
    expect(normalizeDoi(expected)).toBe(expected);
  });

  it.each([
    ['https://doi.org/10.1234/abc#section', '10.1234/abc'],
    ['https://doi.org/10.1234/abc?utm=x', '10.1234/abc'],
    ['https://doi.org/10.1234/abc?#', '10.1234/abc'],
  ])('still drops a real query or fragment: %j', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
  });

  it('reads the link it builds back as the same DOI', () => {
    expect(normalizeDoi(doiUrl(HASH))).toBe(HASH);
    expect(normalizeDoi(doiUrl('10.1234/abc?'))).toBe('10.1234/abc?');
  });

  it('keeps the "#" of a DOI taken from a Google Scholar result link', () => {
    const { works } = normalizeScholarPage(
      {
        version: 1,
        url: 'https://scholar.google.com/scholar?hl=en&q=organic',
        title: 'Google Scholar',
        status: 'results',
        records: [
          { sourceId: 'c1', title: TITLE, authors: ['J Smith'], url: `https://doi.org/${HASH}` },
        ],
        truncated: false,
        nextUrl: null,
      },
      '2026-09-14T15:30:00.000Z',
    );
    expect(works[0].doi).toBe(HASH);
  });
});

describe('W2-03 probe: OpenAlex reports DOIs as doi.org links', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a DOI that ends in "#" and merges the OpenAlex and Crossref copies', async () => {
    vi.useFakeTimers();
    const json = (data: unknown) => new Response(JSON.stringify(data));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) =>
        url.hostname === 'api.openalex.org'
          ? json({
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
            })
          : json({
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
            }),
      ),
    );
    const search = searchSources(
      {
        text: 'organic light emitting',
        mode: 'topic',
        sources: ['openalex', 'crossref'],
        limit: 5,
      },
      DEFAULT_SETTINGS,
    );
    await vi.runAllTimersAsync();
    const response = await search;
    const openalex = response.results.find((r) => r.source === 'openalex')!.works[0];
    expect(openalex.doi).toBe(HASH);
    const merged = mergeWorks(response.results.flatMap((r) => r.works));
    expect(merged).toHaveLength(1);
    expect(merged[0].doi).toBe(HASH);
  });
});

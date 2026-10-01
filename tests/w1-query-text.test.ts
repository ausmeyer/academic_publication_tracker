import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse } from '../src/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-08T12:00:00Z').getTime();
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
/** The URLs requested for a search whose providers all answer with `body`. */
async function requested(query: Partial<SearchQuery>, body: unknown): Promise<URL[]> {
  const fetcher = vi.fn(async (_url: URL) => json(body));
  vi.stubGlobal('fetch', fetcher);
  await finish(
    searchSources(
      { text: 'influenza', mode: 'topic', sources: ['semantic'], limit: 10, ...query },
      DEFAULT_SETTINGS,
    ),
  );
  return fetcher.mock.calls.map(([url]) => url);
}

describe('Semantic Scholar paper search gets hyphenated terms as separate words', () => {
  // The API documents that hyphenated query terms match nothing and should be written with spaces.
  it.each([
    ['COVID-19 vaccine effectiveness', 'COVID 19 vaccine effectiveness'],
    ['state-of-the-art forecasting', 'state of the art forecasting'],
    ['SARS-CoV-2 and Müller-Lyer', 'SARS CoV 2 and Müller Lyer'],
    ['drug - response', 'drug - response'],
    ['plain words', 'plain words'],
  ])('%j is sent as %j', async (text, sent) => {
    const [url] = await requested({ text }, { total: 0, data: [] });
    expect(url.pathname).toBe('/graph/v1/paper/search');
    expect(url.searchParams.get('query')).toBe(sent);
  });

  it('leaves author names and DOIs as typed', async () => {
    const [author] = await requested({ mode: 'author', text: 'Jean-Paul Sartre' }, { data: [] });
    expect(author.pathname).toBe('/graph/v1/author/search');
    expect(author.searchParams.get('query')).toBe('Jean-Paul Sartre');
    const [lookup] = await requested(
      { mode: 'doi', text: '10.1234/covid-19-2020' },
      { paperId: 'p1', title: 'A paper' },
    );
    expect(decodeURIComponent(lookup.pathname)).toBe('/graph/v1/paper/DOI:10.1234/covid-19-2020');
  });

  it('other providers still receive the hyphen', async () => {
    const [crossref] = await requested(
      { text: 'COVID-19 vaccine', sources: ['crossref'] },
      { message: { 'total-results': 0, items: [] } },
    );
    expect(crossref.searchParams.get('query.bibliographic')).toBe('COVID-19 vaccine');
    const [openalex] = await requested(
      { text: 'COVID-19 vaccine', sources: ['openalex'] },
      { meta: { count: 0 }, results: [] },
    );
    expect(openalex.searchParams.get('search')).toBe('COVID-19 vaccine');
  });
});

describe('DataCite topic text cannot start a range query or use the reserved "="', () => {
  // Elasticsearch query strings cannot escape "<" and ">" (they start range queries); "=" is reserved.
  it.each([
    ['IL-6 >10 pg/mL', '(IL\\-6  10 pg mL)'],
    ['children aged <18 months', '(children aged  18 months)'],
    ['x<y and y>z', '(x y and y z)'],
    ['BMI >= 30', '(BMI  \\= 30)'],
    ['R0 = 2.5', '(R0 \\= 2.5)'],
    ['He said "p<0.05', '(He said \\"p 0.05)'],
    ['"p < 0.05" threshold', '("p < 0.05" threshold)'],
  ])('%j is sent as %j', async (text, sent) => {
    const [url] = await requested(
      { text, sources: ['datacite'] },
      { meta: { total: 0 }, data: [] },
    );
    expect(url.searchParams.get('query')).toBe(sent);
  });
});

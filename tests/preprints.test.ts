import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import { mergeWorks } from '../src/core/merge';
import { validateWorkspace } from '../src/core/workspace';
import type { SearchQuery, SearchResponse } from '../src/types';

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'viral evolution',
  mode: 'topic',
  sources: ['preprints'],
  limit: 10,
  ...changes,
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const crossref = (id: string, extra = {}) => ({
  DOI: `10.1234/${id}`,
  title: [`Preprint about viral evolution ${id}`],
  author: [{ given: 'Jane', family: 'Smith' }],
  published: { 'date-parts': [[2023]] },
  publisher: 'bioRxiv',
  type: 'posted-content',
  subtype: 'preprint',
  'is-referenced-by-count': 4,
  ...extra,
});
const epmc = (id: string, extra = {}) => ({
  id,
  source: 'PPR',
  doi: `10.1234/${id}`,
  title: `Preprint about viral evolution ${id}`,
  authorString: 'Smith J',
  pubYear: '2023',
  bookOrReportDetails: { publisher: 'medRxiv' },
  pubTypeList: { pubType: ['Preprint'] },
  citedByCount: 8,
  ...extra,
});
const atom = (ids: string[]) =>
  new Response(
    `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><totalResults>${ids.length}</totalResults>${ids.map((id) => `<entry><id>https://arxiv.org/abs/${id}</id><title>Preprint about viral evolution ${id}</title><author><name>Jane Smith</name></author><published>2023-01-01</published><summary>A preprint.</summary><arxiv:doi>10.1234/${id}</arxiv:doi></entry>`).join('')}</feed>`,
  );
const datacite = (id: number, extra = {}) => ({
  id: `10.1234/data${id}`,
  type: 'dois',
  attributes: {
    doi: `10.1234/data${id}`,
    titles: [{ title: `Research dataset ${id}` }],
    creators: [{ name: 'Smith, Jane', givenName: 'Jane', familyName: 'Smith' }],
    publicationYear: 2023,
    publisher: 'Zenodo',
    types: { resourceTypeGeneral: 'Dataset' },
    url: `https://example.org/data${id}`,
    descriptions: [{ descriptionType: 'Abstract', description: 'Data description.' }],
    ...extra,
  },
});
let clock = new Date('2026-09-14T12:00:00Z').getTime();
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

describe('combined preprint search', () => {
  it('can save overlapping DOI-less records when Europe PMC is selected with Preprints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.hostname === 'export.arxiv.org') return atom([]);
        if (url.hostname === 'www.ebi.ac.uk')
          return json({
            hitCount: 1,
            resultList: {
              result: [
                epmc('short', {
                  doi: undefined,
                  title: 'Short',
                  authorString: '',
                  pubYear: undefined,
                }),
              ],
            },
          });
        return json({ message: { 'total-results': 0, items: [] } });
      }),
    );
    const search = query({ sources: ['preprints', 'europepmc'] });
    const response = await finish(searchSources(search, DEFAULT_SETTINGS));
    const works = mergeWorks(response.results.flatMap((result) => result.works));
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({
      id: 'europepmc:PPR:short',
      title: 'Short',
      doi: '',
      authors: [],
      year: null,
    });
    const workspace = validateWorkspace({
      version: 1,
      activeId: 'test',
      snapshots: [
        {
          id: 'test',
          name: 'Combined search',
          query: search,
          searchedAt: response.searchedAt,
          works,
          sourceResults: response.results.map(({ works: _works, ...result }) => result),
        },
      ],
    });
    expect(workspace.snapshots[0].works).toHaveLength(1);
  });

  it('samples all three indexes, merges duplicates, retains original citation provenance, and caps the union', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.hostname === 'export.arxiv.org') return atom(['shared', 'arxiv2', 'arxiv3']);
      if (url.hostname === 'www.ebi.ac.uk')
        return json({
          hitCount: 4,
          resultList: { result: [epmc('shared'), epmc('epmc2'), epmc('epmc3')] },
        });
      return json({
        message: {
          'total-results': 4,
          items: [
            crossref('shared'),
            crossref('crossref2'),
            crossref('poster', { subtype: 'poster' }),
            crossref('unspecified', { subtype: undefined }),
          ],
        },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(searchSources(query({ limit: 4 }), DEFAULT_SETTINGS));
    expect(result.error).toBeUndefined();
    expect(result.source).toBe('preprints');
    expect(result.total).toBeNull();
    expect(result.works.map((work) => work.doi)).toEqual([
      '10.1234/shared',
      '10.1234/arxiv2',
      '10.1234/epmc2',
      '10.1234/crossref2',
    ]);
    expect(result.works[0].citations).toBe(8);
    expect(result.works[0].provenance.map((record) => [record.source, record.citations])).toEqual([
      ['arxiv', null],
      ['europepmc', 8],
      ['crossref', 4],
    ]);
    expect(
      result.works.every((work) =>
        work.provenance.every((record) => record.source !== 'preprints'),
      ),
    ).toBe(true);
    expect(result.works[2].venue).toBe('medRxiv');
    expect(result.works[3].venue).toBe('bioRxiv');
    expect(result.warning).toContain('not exhaustive');
    expect(result.warning).toContain('omitted at the collection limit');
    const urls = fetcher.mock.calls.map(([url]) => url);
    expect(
      urls.find((url) => url.hostname === 'www.ebi.ac.uk')?.searchParams.get('query'),
    ).toContain('AND SRC:PPR');
    expect(
      urls.find((url) => url.hostname === 'api.crossref.org')?.searchParams.get('filter'),
    ).toBe('type:posted-content');
  });

  it('keeps successful indexes and reports an unavailable component without losing records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.hostname === 'export.arxiv.org') throw new Error('connection failed');
        if (url.hostname === 'www.ebi.ac.uk')
          return json({ hitCount: 1, resultList: { result: [epmc('paper')] } });
        return json({ message: { 'total-results': 1, items: [crossref('paper')] } });
      }),
    );
    const {
      results: [result],
    } = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(result.works).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain('arXiv: 0 retrieved. Could not connect');
    expect(result.works[0].provenance.map((record) => record.source)).toEqual([
      'europepmc',
      'crossref',
    ]);
  });

  it('reports all-component failures as an error rather than an empty successful collection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const {
      results: [result],
    } = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(result.works).toEqual([]);
    expect(result.error).toContain('All available preprint providers failed');
  });

  it('uses exact DOI lookups where supported and excludes non-preprints or mismatched DOI records', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.hostname === 'www.ebi.ac.uk')
        return json({
          hitCount: 2,
          resultList: { result: [epmc('wanted', { source: 'MED' }), epmc('other')] },
        });
      return json({ message: crossref('wanted', { type: 'journal-article', subtype: undefined }) });
    });
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(
      searchSources(
        query({ mode: 'doi', text: 'https://doi.org/10.1234/Wanted' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(result.works).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url.hostname !== 'export.arxiv.org')).toBe(true);
    expect(result.warning).toContain('does not support exact DOI lookup');
    const crossrefUrl = fetcher.mock.calls.find(([url]) => url.hostname === 'api.crossref.org')![0];
    expect(decodeURIComponent(crossrefUrl.pathname)).toBe('/works/10.1234/wanted');
  });

  it('shares component rate limits when Crossref is selected alongside preprints', async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.hostname === 'export.arxiv.org') return atom([]);
        if (url.hostname === 'www.ebi.ac.uk')
          return json({ hitCount: 0, resultList: { result: [] } });
        starts.push(Date.now());
        return json({ message: { 'total-results': 0, items: [] } });
      }),
    );
    await finish(searchSources(query({ sources: ['preprints', 'crossref'] }), DEFAULT_SETTINGS));
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(500);
  });
});

describe('DataCite public API', () => {
  it('decodes a DOI copied from an encoded URL before constructing the exact endpoint', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ data: datacite(1, { doi: '10.1234/data(1)' }) }));
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(
      searchSources(
        query({ sources: ['datacite'], mode: 'doi', text: 'https://doi.org/10.1234/Data%281%29' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(result.works[0].doi).toBe('10.1234/data(1)');
    expect(decodeURIComponent((fetcher.mock.calls[0][0] as URL).pathname)).toBe(
      '/dois/10.1234/data(1)',
    );
  });

  it('normalizes resource types, creator and publisher metadata, and zero versus unknown citations', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        meta: { total: 3 },
        data: [
          datacite(1, { citationCount: 0 }),
          datacite(2, {
            publisher: { name: 'Example Repository', publisherIdentifier: 'not a name' },
            rightsList: [{ rightsIdentifier: 'cc-by-4.0' }],
            citationCount: 2,
          }),
          datacite(3, { citationCount: undefined, url: 'javascript:alert(1)' }),
        ],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(
      searchSources(
        query({ sources: ['datacite'], yearFrom: 2020, yearTo: 2024 }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(result.total).toBe(3);
    expect(result.works.map((work) => work.citations)).toEqual([0, 2, null]);
    expect(result.works[0]).toMatchObject({
      type: 'Dataset',
      venue: 'Zenodo',
      authors: ['Jane Smith'],
      abstract: 'Data description.',
      isOpenAccess: false,
      openAccessUrl: '',
    });
    expect(result.works[1]).toMatchObject({
      venue: 'Example Repository',
      isOpenAccess: true,
      openAccessUrl: 'https://example.org/data2',
    });
    expect(result.works[2].url).toBe('https://doi.org/10.1234/data3');
    expect(result.works[1].provenance[0]).toMatchObject({
      source: 'datacite',
      sourceId: '10.1234/data2',
      citations: 2,
    });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.hostname).toBe('api.datacite.org');
    expect(url.searchParams.get('query')).toBe(
      '(viral evolution) AND publicationYear:[2020 TO 2024]',
    );
    expect(url.searchParams.get('sort')).toBe('relevance');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('uses fixed-size numbered pages and stops at the requested record limit', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      const start = url.searchParams.get('page[number]') === '1' ? 0 : 100;
      return json({
        meta: { total: 250 },
        data: Array.from({ length: 100 }, (_, index) => datacite(start + index)),
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(searchSources(query({ sources: ['datacite'], limit: 101 }), DEFAULT_SETTINGS));
    expect(result.works).toHaveLength(101);
    expect(result.works[100].doi).toBe('10.1234/data100');
    expect(
      fetcher.mock.calls.map(([url]) => [
        url.searchParams.get('page[size]'),
        url.searchParams.get('page[number]'),
      ]),
    ).toEqual([
      ['100', '1'],
      ['100', '2'],
    ]);
  });

  it('screens author candidates and caps scanning at 200 even if the provider repeats namesakes', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        meta: { total: 10000 },
        data: Array.from({ length: 100 }, (_, index) =>
          datacite(index, { creators: [{ name: 'Unrelated Person' }] }),
        ),
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const {
      results: [result],
    } = await finish(
      searchSources(
        query({ sources: ['datacite'], mode: 'author', text: 'Jane Smith' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(result.works).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('query')).toContain(
      'creators.name:"Jane Smith"',
    );
    expect(result.warning).toContain('at most 200 candidates');
  });

  it('normalizes exact DOI lookup and rejects mismatched records and out-of-range publication years', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: datacite(99) }))
      .mockResolvedValueOnce(json({ data: datacite(1, { publicationYear: 2019 }) }));
    vi.stubGlobal('fetch', fetcher);
    for (let index = 0; index < 2; index++) {
      const {
        results: [result],
      } = await finish(
        searchSources(
          query({
            sources: ['datacite'],
            mode: 'doi',
            text: 'https://doi.org/10.1234/Data1',
            yearFrom: 2020,
          }),
          DEFAULT_SETTINGS,
        ),
      );
      expect(result.works).toEqual([]);
    }
    expect(decodeURIComponent((fetcher.mock.calls[0][0] as URL).pathname)).toBe(
      '/dois/10.1234/data1',
    );
  });
});

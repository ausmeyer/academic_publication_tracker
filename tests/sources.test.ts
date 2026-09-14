import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources, SOURCES } from '../src/services/sources';
import type { SearchQuery, SearchResponse } from '../src/types';

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'viral evolution',
  mode: 'topic',
  sources: ['crossref'],
  limit: 10,
  ...changes,
});
const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const crossrefWork = (id: number, extra = {}) => ({
  DOI: `10.1234/paper${id}`,
  title: [`Paper ${id}`],
  author: [{ given: 'Jane', family: 'Smith' }],
  published: { 'date-parts': [[2023]] },
  'is-referenced-by-count': id,
  ...extra,
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

describe('source boundary', () => {
  it('lists the official API sources, including combined preprints and legacy arXiv, without default credentials', () => {
    expect(SOURCES).toHaveLength(8);
    expect(SOURCES.map((source) => source.id)).toEqual(
      expect.arrayContaining(['preprints', 'datacite', 'arxiv']),
    );
    expect(Object.values(DEFAULT_SETTINGS).every((value) => value === '')).toBe(true);
  });

  it.each([
    { text: '' },
    { text: 'a'.repeat(501) },
    { sources: [] },
    { sources: ['private'] as any },
    { mode: 'invalid' as any },
    { limit: 201 },
    { limit: 1.5 },
    { yearFrom: 2024, yearTo: 2020 },
    { yearFrom: 1499 },
    { yearTo: 3000 },
    { mode: 'doi' as const, text: 'not-a-doi' },
  ])('rejects invalid queries before making a network request: %j', async (changes) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(searchSources(query(changes), DEFAULT_SETTINGS)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('paginates Crossref, preserves provenance, and retains zero versus missing citations', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          message: {
            items: Array.from({ length: 100 }, (_, id) => crossrefWork(id)),
            'total-results': 104,
            'next-cursor': 'page-2',
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          message: {
            items: [crossrefWork(100, { 'is-referenced-by-count': undefined })],
            'total-results': 104,
          },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query({ limit: 104 }), DEFAULT_SETTINGS));
    expect(response.results[0].works).toHaveLength(101);
    expect(response.results[0].total).toBe(104);
    expect(response.results[0].works[0].citations).toBe(0);
    expect(response.results[0].works[100].citations).toBeNull();
    expect(response.results[0].works[0].provenance[0]).toMatchObject({
      source: 'crossref',
      sourceId: '10.1234/paper0',
      citations: 0,
      retrievedAt: response.searchedAt,
    });
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('offset')).toBe('100');
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('rows')).toBe('4');
  });

  it('keeps a completed source and partial pages when another request fails, without leaking keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.hostname.includes('openalex'))
          throw new Error('https://example.invalid/?api_key=SECRET');
        if (url.searchParams.get('offset') === '0')
          return json({
            message: {
              items: Array.from({ length: 100 }, (_, i) => crossrefWork(i)),
              'total-results': 110,
              'next-cursor': 'next',
            },
          });
        return json({}, 401);
      }),
    );
    const response = await finish(
      searchSources(query({ sources: ['crossref', 'openalex'], limit: 110 }), {
        ...DEFAULT_SETTINGS,
        openalexApiKey: 'SECRET',
      }),
    );
    expect(response.results[0].works).toHaveLength(100);
    expect(response.results[0].warning).toContain('before the error');
    expect(response.results[1].error).toContain('Could not connect');
    expect(JSON.stringify(response)).not.toContain('SECRET');
  });

  it('retries a rate limit once, then returns an actionable source error', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, 429, { 'retry-after': '1' }));
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(response.results[0].error).toContain('Rate limit');
  });

  it('does not violate a long Retry-After by retrying prematurely', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, 429, { 'retry-after': '120' }));
    vi.stubGlobal('fetch', fetcher);
    await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('closes denied requests instead of leaving their unread error bodies active', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: 'Denied' }, 401));
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(response.results[0].error).toContain('Access was denied');
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('bounds a stalled network request and reports timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    );
    const response = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(response.results[0].error).toContain('did not respond in time');
    expect(Date.now() - clock).toBe(15000);
  });

  it('ignores invalid credential types and header-injection strings', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ meta: { count: 0 }, results: [] }));
    vi.stubGlobal('fetch', fetcher);
    await finish(
      searchSources(query({ sources: ['openalex'] }), {
        email: 123,
        openalexApiKey: 'secret\r\nInjected: yes',
        semanticApiKey: {},
        ncbiApiKey: ['wrong'],
      } as any),
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.has('api_key')).toBe(false);
  });

  it('bounds repeated duplicate pages by the overall search deadline', async () => {
    let page = 0;
    const fetcher = vi.fn().mockImplementation(async () =>
      json({
        meta: { count: 1000, next_cursor: String(++page) },
        results: Array.from({ length: 100 }, () => ({
          id: 'https://openalex.org/W1',
          title: 'Duplicate record',
        })),
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(query({ sources: ['openalex'], limit: 101 }), DEFAULT_SETTINGS),
    );
    expect(response.results[0].works).toHaveLength(1);
    expect(response.results[0].error).toContain('timed out');
    expect(Date.now() - clock).toBeLessThanOrEqual(60000);
  });

  it('uses an exact DOI endpoint and filters mismatched provider records', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ message: crossrefWork(99) }));
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({ mode: 'doi', text: 'https://doi.org/10.1234/Paper1' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(response.results[0].works).toHaveLength(0);
    expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toBe(
      '/works/10.1234/paper1',
    );
  });

  it('encodes user search terms as parameters on a fixed official endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ message: { items: [], 'total-results': 0 } }));
    vi.stubGlobal('fetch', fetcher);
    const malicious = 'https://localhost:1234/?api_key=x&rows=999';
    await finish(
      searchSources(query({ text: malicious, yearFrom: 2020, yearTo: 2024 }), {
        ...DEFAULT_SETTINGS,
        email: 'researcher@example.com',
      }),
    );
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.hostname).toBe('api.crossref.org');
    expect(url.searchParams.get('query.bibliographic')).toBe(malicious);
    expect(url.searchParams.get('rows')).toBe('10');
    expect(url.searchParams.get('filter')).toBe(
      'from-pub-date:2020-01-01,until-pub-date:2024-12-31',
    );
  });
});

describe('provider normalization and search semantics', () => {
  it.each([
    ['LI MING', 'Li', 'Ming'],
    ['Elodie Dupre', 'Élodie', 'Dupré'],
    ['Austin G Meyer', 'AG', 'Meyer'],
  ])(
    'retains compatible uppercase, Unicode, and grouped-initial names: %s',
    async (name, given, family) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json({
            message: {
              'total-results': 1,
              items: [crossrefWork(1, { author: [{ given, family }] })],
            },
          }),
        ),
      );
      const response = await finish(
        searchSources(query({ mode: 'author', text: name }), DEFAULT_SETTINGS),
      );
      expect(response.results[0].works).toHaveLength(1);
    },
  );

  it('screens unrelated Crossref author token matches while retaining compatible initials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          message: {
            'total-results': 3,
            items: [
              crossrefWork(1, { author: [{ given: 'Michael R.', family: 'Albert' }] }),
              crossrefWork(2, { author: [{ given: 'A.', family: 'Einstein' }] }),
              crossrefWork(3, { author: [{ given: 'Albert', family: 'Einstein' }] }),
            ],
          },
        }),
      ),
    );
    const response = await finish(
      searchSources(query({ mode: 'author', text: 'Albert Einstein' }), DEFAULT_SETTINGS),
    );
    expect(response.results[0].works.map((work) => work.doi)).toEqual([
      '10.1234/paper2',
      '10.1234/paper3',
    ]);
    expect(response.results[0].warning).toContain('before screening');
  });

  it('resolves OpenAlex author candidates and retrieves their works using IDs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          results: [
            { id: 'https://openalex.org/A123', display_name: 'Jane Smith' },
            { id: 'https://openalex.org/A124', display_name: 'J. Smith' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          meta: { count: 1 },
          results: [
            {
              id: 'https://openalex.org/W123',
              display_name: 'An article',
              publication_year: 2024,
              authorships: [{ author: { display_name: 'Jane Smith' } }],
              cited_by_count: 0,
              abstract_inverted_index: { Hello: [0], world: [1] },
              open_access: { is_oa: true, oa_url: 'https://example.org/paper' },
              primary_location: { source: { display_name: 'A journal' } },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(query({ sources: ['openalex'], mode: 'author', text: 'Jane Smith' }), {
        ...DEFAULT_SETTINGS,
        openalexApiKey: 'PRIVATE',
      }),
    );
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('filter')).toBe(
      'authorships.author.id:A123|A124',
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer PRIVATE');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.has('api_key')).toBe(false);
    expect(response.results[0].warning).toContain('five matching author profiles');
    expect(response.results[0].works[0]).toMatchObject({
      abstract: 'Hello world',
      isOpenAccess: true,
      citations: 0,
      venue: 'A journal',
    });
  });

  it('normalizes Europe PMC core metadata and checks exact DOI and year filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        hitCount: 2,
        resultList: {
          result: [
            {
              source: 'MED',
              id: '1',
              title: '<i>Paper</i>',
              doi: '10.1234/target',
              pubYear: '2022',
              authorList: { author: [{ fullName: 'Smith J' }] },
              abstractText: 'A &amp; B',
              citedByCount: 5,
              isOpenAccess: 'Y',
              fullTextUrlList: {
                fullTextUrl: [{ availability: 'Open access', url: 'https://example.org/paper' }],
              },
            },
            { source: 'MED', id: '2', doi: '10.1234/unrelated', pubYear: '2022' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({
          sources: ['europepmc'],
          mode: 'doi',
          text: '10.1234/target',
          yearFrom: 2020,
          yearTo: 2023,
        }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(response.results[0].works).toHaveLength(1);
    expect(response.results[0].works[0]).toMatchObject({
      title: 'Paper',
      authors: ['Smith J'],
      abstract: 'A & B',
      citations: 5,
      year: 2022,
      isOpenAccess: true,
    });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('query')).toBe(
      'DOI:"10.1234/target" AND FIRST_PDATE:[2020-01-01 TO 2023-12-31]',
    );
  });

  it('uses the documented Europe PMC AUTH field and surname-initial variants', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ hitCount: 0, resultList: { result: [] } }));
    vi.stubGlobal('fetch', fetcher);
    await finish(
      searchSources(
        query({ sources: ['europepmc'], mode: 'author', text: 'Albert Einstein' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('query')).toBe(
      '(AUTH:"Albert Einstein" OR AUTH:"Einstein Albert" OR AUTH:"Einstein A")',
    );
  });

  it('preserves supplementary Unicode characters when constructing author initials', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ hitCount: 0, resultList: { result: [] } }));
    vi.stubGlobal('fetch', fetcher);
    await finish(
      searchSources(
        query({ sources: ['europepmc'], mode: 'author', text: '𠮷田 太郎' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('query')).toContain('AUTH:"太郎 𠮷"');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('query')).not.toContain('�');
  });

  it('retrieves PubMed abstracts and identifiers without inventing citation counts or OA license', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ esearchresult: { count: '1', idlist: ['123456'] } }))
      .mockResolvedValueOnce(
        new Response(
          `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">123456</PMID><Article><ArticleTitle>A <i>nested</i> title</ArticleTitle><Journal><Title>Medicine</Title><JournalIssue><PubDate><MedlineDate>2021 Jan-Feb</MedlineDate></PubDate></JournalIssue></Journal><AuthorList><Author><LastName>Smith</LastName><ForeName>Jane</ForeName></Author></AuthorList><Abstract><AbstractText Label="BACKGROUND">A <b>useful</b> finding.</AbstractText></Abstract><PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1234/paper</ArticleId><ArticleId IdType="pmc">PMC123</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`,
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({ sources: ['pubmed'], mode: 'author', text: 'Smith Jane' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(response.results[0].works[0]).toMatchObject({
      id: 'pubmed:123456',
      title: 'A nested title',
      abstract: 'A useful finding.',
      authors: ['Jane Smith'],
      year: 2021,
      doi: '10.1234/paper',
      citations: null,
      isOpenAccess: false,
      openAccessUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/',
    });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('term')).toBe(
      '("Smith Jane"[Author] OR "Jane Smith"[Author] OR "Jane S"[Author])',
    );
  });

  it('normalizes Semantic Scholar exact DOI lookup', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        paperId: 'abc',
        title: 'A paper',
        authors: [{ name: 'Jane Smith' }],
        externalIds: { DOI: '10.1234/Paper' },
        citationCount: 8,
        year: 2020,
        isOpenAccess: true,
        openAccessPdf: { url: 'javascript:alert(1)' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({ sources: ['semantic'], mode: 'doi', text: '10.1234/paper' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(response.results[0].works[0]).toMatchObject({
      citations: 8,
      doi: '10.1234/paper',
      openAccessUrl: '',
    });
    expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toBe(
      '/graph/v1/paper/DOI:10.1234/paper',
    );
  });

  it('uses Semantic Scholar author profiles instead of a paper keyword search', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ authorId: '12', name: 'Jane Smith' }] }))
      .mockResolvedValueOnce(
        json({
          data: [
            {
              paperId: 'abc',
              title: 'A paper',
              authors: [{ name: 'Jane Smith' }],
              citationCount: 3,
              year: 2020,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({ sources: ['semantic'], mode: 'author', text: 'Jane Smith' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe('/graph/v1/author/search');
    expect(new URL(fetcher.mock.calls[1][0]).pathname).toBe('/graph/v1/author/12/papers');
    expect(response.results[0].works).toHaveLength(1);
    expect(response.results[0].warning).toContain('verify identity');
  });

  it('parses an arXiv Atom feed and preserves unavailable citations', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/2401.12345v1</id><title>A preprint</title><published>2024-01-10T00:00:00Z</published><summary>Open science</summary><author><name>Jane Smith</name></author><link title="pdf" href="https://arxiv.org/pdf/2401.12345v1"/><arxiv:doi>10.1234/preprint</arxiv:doi></entry></feed>`,
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query({ sources: ['arxiv'] }), DEFAULT_SETTINGS));
    expect(response.results[0].works[0]).toMatchObject({
      title: 'A preprint',
      authors: ['Jane Smith'],
      year: 2024,
      doi: '10.1234/preprint',
      isOpenAccess: true,
      citations: null,
    });
    expect(response.results[0].total).toBe(1);
  });

  it('reports unsupported exact DOI lookup in arXiv without issuing a misleading query', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(
      searchSources(
        query({ sources: ['arxiv'], mode: 'doi', text: '10.1234/paper' }),
        DEFAULT_SETTINGS,
      ),
    );
    expect(response.results[0].warning).toContain('does not support exact DOI');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports arXiv Atom error entries as errors rather than papers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<feed><entry><id>http://arxiv.org/api/errors#bad-query</id><title>Error</title></entry></feed>',
          ),
        ),
    );
    const response = await finish(searchSources(query({ sources: ['arxiv'] }), DEFAULT_SETTINGS));
    expect(response.results[0].works).toHaveLength(0);
    expect(response.results[0].error).toContain('could not interpret');
  });

  it('does not expand XML entity declarations', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY hidden "SHOULD_NOT_EXPAND">]><feed><entry><id>https://arxiv.org/abs/2401.12345v1</id><title>&hidden;</title><published>2024-01-01</published></entry></feed>`,
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query({ sources: ['arxiv'] }), DEFAULT_SETTINGS));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response)).not.toContain('SHOULD_NOT_EXPAND');
    expect(response.results[0].works[0]?.title).toBe('&hidden;');
  });

  it('rejects XML external entities without following them', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY remote SYSTEM "https://example.invalid/private">]><feed><entry><title>&remote;</title></entry></feed>`,
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await finish(searchSources(query({ sources: ['arxiv'] }), DEFAULT_SETTINGS));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.results[0].works).toHaveLength(0);
    expect(response.results[0].error).toContain('unreadable response');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import { CROSSREF_PUBLICATION_TYPES } from '../src/core/worktype';
import { LIMITS } from '../src/core/limits';
import { validateWorkspace } from '../src/core/workspace';
import type { SearchQuery, SearchResponse, Settings } from '../src/types';

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'forecasting',
  mode: 'topic',
  sources: ['crossref'],
  limit: 50,
  ...changes,
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-02T12:00:00Z').getTime();
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
type Responder = (url: URL, init?: RequestInit) => Response | Promise<Response>;
async function run(
  changes: Partial<SearchQuery>,
  respond: Responder,
  settings: Settings = DEFAULT_SETTINGS,
) {
  const fetcher = vi.fn(async (url: URL, init?: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetcher);
  const response = await finish(searchSources(query(changes), settings));
  return { response, result: response.results[0], fetcher };
}
const crossrefItem = (id: string, extra: Record<string, unknown> = {}) => ({
  DOI: `10.1234/${id}`,
  title: [`Paper ${id} about forecasting`],
  author: [{ given: 'Jane', family: 'Smith' }],
  published: { 'date-parts': [[2020]] },
  type: 'journal-article',
  'is-referenced-by-count': 1,
  ...extra,
});
const crossrefPage = (...items: unknown[]) => json({ message: { 'total-results': 99, items } });
const pubmedXml = (articles: string) =>
  `<?xml version="1.0"?><PubmedArticleSet>${articles}</PubmedArticleSet>`;
const pubmedArticle = (pmid: string, title: string, types: string[]) =>
  `<PubmedArticle><MedlineCitation><PMID Version="1">${pmid}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Journal><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue><Title>Medicine</Title></Journal><PublicationTypeList>${types.map((type) => `<PublicationType UI="D000000">${type}</PublicationType>`).join('')}</PublicationTypeList></Article></MedlineCitation></PubmedArticle>`;
const pubmedResponder =
  (articles: string): Responder =>
  (url) =>
    url.pathname.endsWith('esearch.fcgi')
      ? json({ esearchresult: { count: '2', idlist: ['1', '2'] } })
      : new Response(pubmedXml(articles));
const worksOf = (result: { works: { doi: string; included: boolean }[] }) =>
  result.works.map((work) => [work.doi, work.included]);

describe('only publications are requested and counted as papers', () => {
  it.each(['topic', 'author'] as const)(
    'asks Crossref for publication types only in %s mode, next to the year filters',
    async (mode) => {
      const { fetcher } = await run(
        { mode, text: 'Jane Smith', yearFrom: 2020, yearTo: 2021 },
        () => crossrefPage(),
      );
      const filter = new URL(fetcher.mock.calls[0][0]).searchParams.get('filter')!.split(',');
      expect(filter.filter((part) => part.startsWith('type:'))).toEqual(
        CROSSREF_PUBLICATION_TYPES.map((type) => `type:${type}`),
      );
      expect(filter).toEqual(
        expect.arrayContaining(['from-pub-date:2020-01-01', 'until-pub-date:2021-12-31']),
      );
    },
  );

  it('does not filter a DOI lookup by type', async () => {
    const { fetcher } = await run({ mode: 'doi', text: '10.1234/issue' }, () =>
      json({ message: crossrefItem('issue', { type: 'journal-issue' }) }),
    );
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.has('filter')).toBe(false);
  });

  it.each(['topic', 'author'] as const)(
    'skips Crossref records that have no title in %s mode',
    async (mode) => {
      const { result } = await run({ mode, text: 'Jane Smith' }, () =>
        crossrefPage(
          {
            DOI: '10.1234/issue',
            type: 'journal-issue',
            author: [{ given: 'Jane', family: 'Smith' }],
          },
          crossrefItem('real'),
        ),
      );
      expect(result.works.map((work) => work.doi)).toEqual(['10.1234/real']);
    },
  );

  it('keeps an untitled record as a placeholder, excluded by default, when it was looked up by DOI', async () => {
    const { result } = await run({ mode: 'doi', text: '10.1234/issue' }, () =>
      json({ message: { DOI: '10.1234/issue', type: 'journal-issue' } }),
    );
    expect(result.works).toHaveLength(1);
    expect(result.works[0]).toMatchObject({ title: 'Untitled record', included: false });
    expect(result.warning).toContain('excluded by default');
  });

  it('stores Crossref issues, peer-review reports, grants and components as excluded and says so', async () => {
    const { result } = await run({}, () =>
      crossrefPage(
        crossrefItem('article'),
        crossrefItem('issue', { type: 'journal-issue' }),
        crossrefItem('review', { type: 'peer-review' }),
        crossrefItem('grant', { type: 'grant' }),
        crossrefItem('figure', { type: 'component' }),
        crossrefItem('chapter', { type: 'book-chapter' }),
      ),
    );
    expect(worksOf(result)).toEqual([
      ['10.1234/article', true],
      ['10.1234/issue', false],
      ['10.1234/review', false],
      ['10.1234/grant', false],
      ['10.1234/figure', false],
      ['10.1234/chapter', true],
    ]);
    expect(result.warning).toMatch(/^4 records \(.*\) were excluded by default\./);
    expect(result.warning).toContain('Excluded filter');
  });

  it('keeps the namesake warning when it adds the exclusion note in author mode', async () => {
    const { result } = await run({ mode: 'author', text: 'Jane Smith' }, () =>
      crossrefPage(crossrefItem('one', { type: 'peer-review' })),
    );
    expect(result.warning).toContain('before screening');
    expect(result.warning).toContain('1 record');
    expect(result.warning).toContain('was excluded by default');
  });

  it('adds no note when every record is a publication', async () => {
    const { result } = await run({}, () => crossrefPage(crossrefItem('one'), crossrefItem('two')));
    expect(result.warning).toBeUndefined();
    expect(result.works.every((work) => work.included)).toBe(true);
  });

  it('excludes OpenAlex errata, retractions, paratext, peer reviews, grants and supplements by default', async () => {
    const types = [
      'article',
      'review',
      'preprint',
      'book-chapter',
      'dataset',
      'erratum',
      'retraction',
      'paratext',
      'peer-review',
      'grant',
      'supplementary-materials',
    ];
    const { result } = await run({ sources: ['openalex'] }, () =>
      json({
        meta: { count: types.length },
        results: types.map((type, index) => ({
          id: `https://openalex.org/W${index + 1}`,
          display_name: `Record ${index + 1}`,
          doi: `https://doi.org/10.1234/${type}`,
          type,
        })),
      }),
    );
    expect(Object.fromEntries(result.works.map((work) => [work.type, work.included]))).toEqual({
      article: true,
      review: true,
      preprint: true,
      'book-chapter': true,
      dataset: true,
      erratum: false,
      retraction: false,
      paratext: false,
      'peer-review': false,
      grant: false,
      'supplementary-materials': false,
    });
    expect(result.warning).toContain('6 records');
  });

  it('excludes PubMed errata and keeps the article', async () => {
    const { result } = await run(
      { sources: ['pubmed'] },
      pubmedResponder(
        pubmedArticle('1', 'A real study of forecasting', ['Journal Article']) +
          pubmedArticle('2', 'Erratum: A real study of forecasting', ['Published Erratum']),
      ),
    );
    expect(result.works.map((work) => [work.id, work.included])).toEqual([
      ['pubmed:1', true],
      ['pubmed:2', false],
    ]);
    expect(result.works[1].type).toBe('Published Erratum');
    expect(result.warning).toContain('1 record');
  });

  it('excludes Europe PMC retraction notices and keeps the article', async () => {
    const { result } = await run({ sources: ['europepmc'] }, () =>
      json({
        hitCount: 2,
        resultList: {
          result: [
            {
              id: '1',
              source: 'MED',
              title: 'A study',
              pubTypeList: { pubType: ['Journal Article'] },
            },
            {
              id: '2',
              source: 'MED',
              title: 'Retraction: A study',
              pubTypeList: { pubType: ['Retraction of Publication'] },
            },
          ],
        },
      }),
    );
    expect(result.works.map((work) => work.included)).toEqual([true, false]);
  });
});

describe('Europe PMC author names', () => {
  it('builds "Given Family" names from the author list instead of storing Vancouver "Family INITIALS"', async () => {
    const { result } = await run({ sources: ['europepmc'] }, () =>
      json({
        hitCount: 1,
        resultList: {
          result: [
            {
              id: '1',
              source: 'MED',
              title: 'Forecasting study',
              authorList: {
                author: [
                  {
                    fullName: 'Reich NG',
                    firstName: 'Nicholas G',
                    lastName: 'Reich',
                    initials: 'NG',
                    authorId: { type: 'ORCID', value: '0000-0003-3503-9899' },
                  },
                  { fullName: 'Piwowar HA', firstName: 'Heather A', lastName: 'Piwowar' },
                  { fullName: 'Smith J' },
                  { collectiveName: 'The FluSight Consortium' },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(result.works[0].authors).toEqual([
      'Nicholas G Reich',
      'Heather A Piwowar',
      'Smith J',
      'The FluSight Consortium',
    ]);
  });

  it('falls back to the author string when there is no author list', async () => {
    const { result } = await run({ sources: ['europepmc'] }, () =>
      json({
        hitCount: 1,
        resultList: {
          result: [
            {
              id: '1',
              source: 'MED',
              title: 'Forecasting study',
              authorString: 'Smith J, Jones K.',
            },
          ],
        },
      }),
    );
    expect(result.works[0].authors).toEqual(['Smith J', 'Jones K.']);
  });
});

describe('field limits', () => {
  const fundingTypes = [
    'Journal Article',
    'Research Support, N.I.H., Extramural',
    "Research Support, Non-U.S. Gov't",
    "Research Support, U.S. Gov't, Non-P.H.S.",
    "Research Support, U.S. Gov't, P.H.S.",
    'Review',
    'Comparative Study',
    'Validation Study',
  ];
  const saveable = (works: unknown[], response: SearchResponse) =>
    validateWorkspace({
      version: 2,
      activeId: 's',
      snapshots: [
        {
          id: 's',
          name: 'Search',
          query: query(),
          searchedAt: response.searchedAt,
          works,
          sourceResults: [],
        },
      ],
    });

  it('keeps a PubMed record with eight publication types saveable and informative', async () => {
    const { response, result } = await run(
      { sources: ['pubmed'] },
      pubmedResponder(pubmedArticle('22198448', 'A heavily funded review', fundingTypes)),
    );
    const { type } = result.works[0];
    expect(type.length).toBeLessThanOrEqual(LIMITS.type);
    expect(type).toBe('Review, Journal Article, Comparative Study, Validation Study');
    expect(() => saveable(result.works, response)).not.toThrow();
  });

  it('cleans Europe PMC and Semantic Scholar type lists the same way', async () => {
    const epmc = await run({ sources: ['europepmc'] }, () =>
      json({
        hitCount: 1,
        resultList: {
          result: [
            { id: '1', source: 'MED', title: 'Funded', pubTypeList: { pubType: fundingTypes } },
          ],
        },
      }),
    );
    expect(epmc.result.works[0].type).toBe(
      'Review, Journal Article, Comparative Study, Validation Study',
    );
    const semantic = await run({ sources: ['semantic'] }, () =>
      json({
        total: 1,
        data: [
          {
            paperId: 'abc',
            title: 'Typed',
            publicationTypes: ['JournalArticle', 'Review', 'Review'],
          },
        ],
      }),
    );
    expect(semantic.result.works[0].type).toBe('Review, JournalArticle');
  });

  it('clamps oversized fields from any provider so one record cannot block saving the result', async () => {
    const { response, result } = await run({}, () =>
      crossrefPage(
        crossrefItem('huge', {
          title: ['T'.repeat(LIMITS.title + 500)],
          'container-title': ['V'.repeat(LIMITS.venue + 500)],
          abstract: 'A'.repeat(LIMITS.abstract + 500),
          author: [{ name: 'N'.repeat(LIMITS.authorName + 500) }],
          URL: `https://example.org/${'u'.repeat(LIMITS.url + 10)}`,
        }),
      ),
    );
    const [work] = result.works;
    expect(work.title).toHaveLength(LIMITS.title);
    expect(work.title.endsWith('…')).toBe(true);
    expect(work.venue).toHaveLength(LIMITS.venue);
    expect(work.abstract).toHaveLength(LIMITS.abstract);
    expect(work.authors[0]).toHaveLength(LIMITS.authorName);
    expect(work.url.length).toBeLessThanOrEqual(LIMITS.url);
    expect(() => saveable(result.works, response)).not.toThrow();
  });
});

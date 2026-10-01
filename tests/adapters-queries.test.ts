import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse, Settings } from '../src/types';

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'influenza',
  mode: 'topic',
  sources: ['crossref'],
  limit: 10,
  ...changes,
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-03T12:00:00Z').getTime();
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
  const urls = () => fetcher.mock.calls.map(([url]) => url);
  const param = (name: string, index = 0) => urls()[index].searchParams.get(name);
  return { response, result: response.results[0], fetcher, urls, param };
}
const emptyEpmc = () => json({ hitCount: 0, resultList: { result: [] } });
const emptyCrossref = () => json({ message: { 'total-results': 0, items: [] } });
const emptyDatacite = () => json({ meta: { total: 0 }, data: [] });
const emptyAtom = () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');

describe('year filters use each provider’s documented syntax', () => {
  it.each([
    [{ yearFrom: 2020, yearTo: 2023 }, '2020-2023'],
    [{ yearFrom: 2020 }, '2020-'],
    [{ yearTo: 2023 }, '-2023'],
    [{ yearFrom: 2021, yearTo: 2021 }, '2021'],
    [{}, null],
  ])('Semantic Scholar paper search %j -> year=%s', async (years, expected) => {
    const { param } = await run({ sources: ['semantic'], ...years }, () =>
      json({ total: 0, data: [] }),
    );
    expect(param('year')).toBe(expected);
  });

  it.each([
    [{ yearFrom: 2024, yearTo: 2025 }, '2024:2025'],
    [{ yearFrom: 2024 }, '2024:'],
    [{ yearTo: 2025 }, ':2025'],
    [{}, null],
  ])(
    'Semantic Scholar author papers %j -> publicationDateOrYear=%s, so old papers are never paged through',
    async (years, expected) => {
      const { urls } = await run(
        { sources: ['semantic'], mode: 'author', text: 'Jane Smith', ...years },
        (url) =>
          url.pathname.endsWith('/author/search')
            ? json({ data: [{ authorId: '12', name: 'Jane Smith' }] })
            : json({ data: [] }),
      );
      const papers = urls().find((url) => url.pathname === '/graph/v1/author/12/papers')!;
      expect(papers.searchParams.get('publicationDateOrYear')).toBe(expected);
    },
  );

  it('Europe PMC filters on publication year, the field it reports and the app filters by', async () => {
    const { param } = await run(
      { sources: ['europepmc'], yearFrom: 2020, yearTo: 2023 },
      emptyEpmc,
    );
    expect(param('query')).toBe('(influenza) AND PUB_YEAR:[2020 TO 2023]');
  });

  it('Europe PMC applies the year filter to author, DOI and preprint queries and supplies an open end', async () => {
    const author = await run(
      { sources: ['europepmc'], mode: 'author', text: 'Nicholas G Reich', yearTo: 2021 },
      emptyEpmc,
    );
    expect(author.param('query')).toBe(
      `(AUTH:"Nicholas G Reich" OR AUTH:"Reich Nicholas G" OR AUTH:"Reich NG") AND PUB_YEAR:[1500 TO 2021]`,
    );
    const doi = await run(
      { sources: ['europepmc'], mode: 'doi', text: '10.1234/abc', yearFrom: 2020, yearTo: 2020 },
      emptyEpmc,
    );
    expect(doi.param('query')).toBe('DOI:"10.1234/abc" AND PUB_YEAR:[2020 TO 2020]');
    const preprints = await run({ sources: ['preprints'], yearFrom: 2019, yearTo: 2020 }, (url) =>
      url.hostname === 'www.ebi.ac.uk'
        ? emptyEpmc()
        : url.hostname === 'export.arxiv.org'
          ? emptyAtom()
          : emptyCrossref(),
    );
    const epmcUrl = preprints.urls().find((url) => url.hostname === 'www.ebi.ac.uk')!;
    expect(epmcUrl.searchParams.get('query')).toBe(
      '((influenza)) AND SRC:PPR AND PUB_YEAR:[2019 TO 2020]',
    );
  });

  it('OpenAlex, PubMed, arXiv and DataCite send inclusive year ranges', async () => {
    const next = new Date().getFullYear() + 1;
    const openalex = await run({ sources: ['openalex'], yearFrom: 2020, yearTo: 2023 }, () =>
      json({ meta: { count: 0 }, results: [] }),
    );
    expect(openalex.param('filter')).toBe('publication_year:2020-2023');
    const openalexOpen = await run({ sources: ['openalex'], yearFrom: 2020 }, () =>
      json({ meta: { count: 0 }, results: [] }),
    );
    expect(openalexOpen.param('filter')).toBe(`publication_year:2020-${next}`);
    const pubmed = await run({ sources: ['pubmed'], yearFrom: 2020, yearTo: 2023 }, () =>
      json({ esearchresult: { count: '0', idlist: [] } }),
    );
    expect(pubmed.param('term')).toBe(
      '(influenza) AND ("2020/01/01"[Date - Publication] : "2023/12/31"[Date - Publication])',
    );
    const arxiv = await run({ sources: ['arxiv'], yearFrom: 2020, yearTo: 2023 }, emptyAtom);
    expect(arxiv.param('search_query')).toBe(
      '(all:"influenza") AND submittedDate:[202001010000 TO 202312312359]',
    );
    const datacite = await run(
      { sources: ['datacite'], yearFrom: 2020, yearTo: 2023 },
      emptyDatacite,
    );
    expect(datacite.param('query')).toBe('(influenza) AND publicationYear:[2020 TO 2023]');
  });
});

describe('OpenAlex author retrieval', () => {
  const authorFlow: Responder = (url) =>
    url.pathname === '/authors'
      ? json({ results: [{ id: 'https://openalex.org/A1', display_name: 'Nicholas G Reich' }] })
      : json({ meta: { count: 0 }, results: [] });

  it('asks for the most cited works first so a limited retrieval does not understate h-index', async () => {
    const { urls } = await run(
      { sources: ['openalex'], mode: 'author', text: 'Nicholas G Reich', limit: 50 },
      authorFlow,
    );
    const works = urls().find((url) => url.pathname === '/works')!;
    expect(works.searchParams.get('sort')).toBe('cited_by_count:desc');
    expect(works.searchParams.get('filter')).toBe('authorships.author.id:A1');
  });

  it('keeps relevance order for topic searches and does not sort a DOI lookup', async () => {
    const topic = await run({ sources: ['openalex'] }, () =>
      json({ meta: { count: 0 }, results: [] }),
    );
    expect(topic.param('sort')).toBeNull();
    const doi = await run({ sources: ['openalex'], mode: 'doi', text: '10.1234/abc' }, () =>
      json({ meta: { count: 0 }, results: [] }),
    );
    expect(doi.param('sort')).toBeNull();
  });
});

describe('author search names', () => {
  it.each([
    [
      'Meyer, Austin G',
      '(AUTH:"Meyer, Austin G" OR AUTH:"Meyer Austin G" OR AUTH:"Meyer AG")',
      '("Meyer, Austin G"[Author] OR "Meyer Austin G"[Author] OR "Meyer AG"[Author])',
    ],
    [
      'Austin G Meyer',
      '(AUTH:"Austin G Meyer" OR AUTH:"Meyer Austin G" OR AUTH:"Meyer AG")',
      '("Austin G Meyer"[Author] OR "Meyer Austin G"[Author] OR "Meyer AG"[Author])',
    ],
    ['Reich NG', '(AUTH:"Reich NG")', '("Reich NG"[Author])'],
    [
      'Jane Scholar',
      '(AUTH:"Jane Scholar" OR AUTH:"Scholar Jane" OR AUTH:"Scholar J")',
      '("Jane Scholar"[Author] OR "Scholar Jane"[Author] OR "Scholar J"[Author])',
    ],
    ['Einstein', '(AUTH:"Einstein")', '("Einstein"[Author])'],
  ])(
    'builds surname-first variants from %j for Europe PMC and PubMed',
    async (name, europepmc, pubmed) => {
      const epmc = await run({ sources: ['europepmc'], mode: 'author', text: name }, emptyEpmc);
      expect(epmc.param('query')).toBe(europepmc);
      const medline = await run({ sources: ['pubmed'], mode: 'author', text: name }, () =>
        json({ esearchresult: { count: '0', idlist: [] } }),
      );
      expect(medline.param('term')).toBe(pubmed);
    },
  );

  it('never queries initials that belong to another author (the "G MA" hits)', async () => {
    const { urls } = await run(
      { sources: ['preprints'], mode: 'author', text: 'Meyer, Austin G' },
      (url) =>
        url.hostname === 'www.ebi.ac.uk'
          ? emptyEpmc()
          : url.hostname === 'export.arxiv.org'
            ? emptyAtom()
            : emptyCrossref(),
    );
    const epmc = urls().find((url) => url.hostname === 'www.ebi.ac.uk')!;
    expect(epmc.searchParams.get('query')).toContain('AUTH:"Meyer AG"');
    expect(epmc.searchParams.get('query')).not.toContain('G MA');
  });

  it('uses the same variants for DataCite creators', async () => {
    const { param } = await run(
      { sources: ['datacite'], mode: 'author', text: 'Meyer, Austin G' },
      emptyDatacite,
    );
    expect(param('query')).toBe(
      '(creators.name:"Meyer, Austin G" OR creators.name:"Meyer Austin G" OR creators.name:"Meyer AG")',
    );
  });
});

describe('author screening of Crossref and DataCite candidates', () => {
  const byline = (id: string, given: string, family: string) => ({
    DOI: `10.1234/${id}`,
    title: [`Paper ${id}`],
    author: [{ given, family }],
    published: { 'date-parts': [[2021]] },
    type: 'journal-article',
  });
  const crossrefAuthors = async (text: string, bylines: [string, string][]) => {
    const { result } = await run({ mode: 'author', text, limit: 50 }, () =>
      json({
        message: {
          'total-results': bylines.length,
          items: bylines.map(([given, family], index) => byline(`p${index}`, given, family)),
        },
      }),
    );
    return result.works.map((work) => work.authors[0]);
  };

  it('keeps bylines that omit middle names or use initials, and drops other people', async () => {
    expect(
      await crossrefAuthors('Austin G Meyer', [
        ['Austin', 'Meyer'],
        ['A.', 'Meyer'],
        ['Austin G.', 'Meyer'],
        ['AG', 'Meyer'],
        ['Austin', 'Mayer'],
        ['Bob', 'Meyer'],
        ['Gregory', 'Meyer'],
      ]),
    ).toEqual(['Austin Meyer', 'A. Meyer', 'Austin G. Meyer', 'AG Meyer']);
  });

  it('matches across diacritics, particles and name order', async () => {
    expect(
      await crossrefAuthors('José Ángel Núñez', [
        ['Jose', 'Nunez'],
        ['J.', 'Núñez'],
        ['Jose', 'Nuñez-Ruiz'],
      ]),
    ).toEqual(['Jose Nunez', 'J. Núñez']);
    expect(
      await crossrefAuthors('Jan van der Berg', [
        ['J.', 'Berg'],
        ['Jan', 'van der Berg'],
        ['Jan', 'Bergen'],
      ]),
    ).toEqual(['J. Berg', 'Jan van der Berg']);
    expect(
      await crossrefAuthors('Meyer, Austin G', [
        ['Austin', 'Meyer'],
        ['Bob', 'Meyer'],
      ]),
    ).toEqual(['Austin Meyer']);
  });

  it('falls back to a surname match when only one name is typed', async () => {
    expect(
      await crossrefAuthors('Einstein', [
        ['Albert', 'Einstein'],
        ['A.', 'Einstein'],
        ['Bob', 'Smith'],
      ]),
    ).toEqual(['Albert Einstein', 'A. Einstein']);
  });

  it('accepts bylines in either order when the surname was typed first without a comma', async () => {
    expect(
      await crossrefAuthors('Wang Wei', [
        ['Wei', 'Wang'],
        ['W.', 'Wang'],
        ['Wang', 'Wei'],
        ['Wei', 'Zhang'],
      ]),
    ).toEqual(['Wei Wang', 'Wang Wei']);
    expect(
      await crossrefAuthors('Wang Xiao Ming', [
        ['Xiao Ming', 'Wang'],
        ['X. M.', 'Wang'],
        ['Xiao', 'Li'],
      ]),
    ).toEqual(['Xiao Ming Wang']);
  });

  it('treats a surname with particles as a lone surname', async () => {
    expect(
      await crossrefAuthors('van der Berg', [
        ['Jan', 'van der Berg'],
        ['J.', 'Berg'],
        ['Bob', 'Smith'],
      ]),
    ).toEqual(['Jan van der Berg', 'J. Berg']);
    expect(
      await crossrefAuthors('von Neumann', [
        ['John', 'von Neumann'],
        ['Bob', 'Smith'],
      ]),
    ).toEqual(['John von Neumann']);
  });

  it('applies the same screening to DataCite creators', async () => {
    const creator = (id: number, givenName: string, familyName: string) => ({
      id: `10.1234/d${id}`,
      attributes: {
        doi: `10.1234/d${id}`,
        titles: [{ title: `Dataset ${id}` }],
        creators: [{ name: `${familyName}, ${givenName}`, givenName, familyName }],
        publicationYear: 2021,
      },
    });
    const { result } = await run(
      { sources: ['datacite'], mode: 'author', text: 'Austin G Meyer' },
      () =>
        json({
          meta: { total: 4 },
          data: [
            creator(1, 'Austin', 'Meyer'),
            creator(2, 'A.', 'Meyer'),
            creator(3, 'Bob', 'Meyer'),
            creator(4, 'Austin', 'Mayer'),
          ],
        }),
    );
    expect(result.works.map((work) => work.doi)).toEqual(['10.1234/d1', '10.1234/d2']);
  });
});

describe('DataCite topic text is searched as text, not as Lucene syntax', () => {
  it.each([
    ['Deep learning: a review of methods', '(Deep learning\\: a review of methods)'],
    ['drug - response', '(drug \\- response)'],
    ['C++ and R & Python', '(C\\+\\+ and R \\& Python)'],
    ['a || b && c !d', '(a \\|\\| b \\&\\& c \\!d)'],
    ['f(x) [a] {b} ^c ~d *e ?f', '(f\\(x\\) \\[a\\] \\{b\\} \\^c \\~d \\*e \\?f)'],
    ['back\\slash', '(back\\\\slash)'],
    ['and/or review', '(and or review)'],
    ['He said "hello', '(He said \\"hello)'],
    ['"deep learning" review', '("deep learning" review)'],
    ['"drug - response" review', '("drug - response" review)'],
    ['plain words stay plain', '(plain words stay plain)'],
  ])('%j', async (text, expected) => {
    const { param } = await run({ sources: ['datacite'], text }, emptyDatacite);
    expect(param('query')).toBe(expected);
  });

  it('keeps the year clause outside the escaped text', async () => {
    const { param } = await run(
      { sources: ['datacite'], text: 'Deep learning: a review', yearFrom: 2020, yearTo: 2024 },
      emptyDatacite,
    );
    expect(param('query')).toBe('(Deep learning\\: a review) AND publicationYear:[2020 TO 2024]');
  });
});

describe('arXiv queries and identifiers', () => {
  const entry = (id: string, title = 'A preprint') =>
    `<entry><id>${id}</id><title>${title}</title><published>2023-04-05T00:00:00Z</published><author><name>Jane Smith</name></author><link title="pdf" href="${id.replace('/abs/', '/pdf/')}"/></entry>`;
  const feed = (...entries: string[]) =>
    new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`);

  it.each([
    ['deep & learning', 'all:"deep" AND all:"learning"'],
    ['neural - networks', 'all:"neural" AND all:"networks"'],
    ['  quantum   computing ', 'all:"quantum" AND all:"computing"'],
    ['C++ and 2D materials', 'all:"C++" AND all:"and" AND all:"2D" AND all:"materials"'],
  ])('drops words that contain no letter or digit: %j', async (text, expected) => {
    const { param } = await run({ sources: ['arxiv'], text }, emptyAtom);
    expect(param('search_query')).toBe(expected);
  });

  it('does not send a query that has no searchable word and explains why', async () => {
    const { result, fetcher } = await run({ sources: ['arxiv'], text: '& -' }, emptyAtom);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.works).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain('at least one word');
  });

  it('identifies a preprint without its version, so a refresh after v2 keeps the same record', async () => {
    const { result } = await run({ sources: ['arxiv'] }, () =>
      feed(
        entry('http://arxiv.org/abs/2304.02643v2'),
        entry('http://arxiv.org/abs/hep-th/9901001v1'),
        entry('http://arxiv.org/abs/2401.00001'),
      ),
    );
    expect(result.works.map((work) => work.id)).toEqual([
      'arxiv:2304.02643',
      'arxiv:hep-th/9901001',
      'arxiv:2401.00001',
    ]);
    expect(result.works.map((work) => work.provenance[0].sourceId)).toEqual([
      '2304.02643',
      'hep-th/9901001',
      '2401.00001',
    ]);
    expect(result.works.map((work) => work.url)).toEqual([
      'https://arxiv.org/abs/2304.02643',
      'https://arxiv.org/abs/hep-th/9901001',
      'https://arxiv.org/abs/2401.00001',
    ]);
    expect(result.works.map((work) => work.provenance[0].url)).toEqual(
      result.works.map((work) => work.url),
    );
  });
});

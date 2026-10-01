import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse, Settings } from '../src/types';

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'viral evolution',
  mode: 'topic',
  sources: ['crossref'],
  limit: 10,
  ...changes,
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-01T12:00:00Z').getTime();
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

// Wiley "SICI" DOIs contain < and > and are real: Statistics in Medicine, 1998 (Crossref payload).
const D1 = '10.1002/(sici)1097-0258(19980430)17:8<841::aid-sim781>3.0.co;2-d';
const D2 = '10.1002/(sici)1097-0258(19981030)17:20<2353::aid-sim923>3.0.co;2-y';
const D3 = '10.1002/(sici)1097-0258(19981230)17:24<2815::aid-sim110>3.0.co;2-8';
const T1 = 'Detecting and describing heterogeneity in meta-analysis';
const T2 =
  'Understanding and testing for heterogeneity across 2×2 tables: application to meta-analysis';
const T3 = 'Extracting summary statistics to perform meta-analyses of the published literature';
const sici = (doi: string, title: string, citations: number) => ({
  DOI: doi,
  URL: `https://doi.org/${doi}`,
  title: [title],
  type: 'journal-article',
  author: [{ given: 'R J', family: 'Hardy' }],
  published: { 'date-parts': [[1998, 4, 30]] },
  'is-referenced-by-count': citations,
});
const crossrefPage = (...items: unknown[]) => json({ message: { 'total-results': 99, items } });

describe('identifiers are never treated as markup (SICI-style DOIs)', () => {
  it('keeps every Crossref record whose DOI contains angle brackets, with distinct ids and live links', async () => {
    const { result } = await run({}, () =>
      crossrefPage(sici(D1, T1, 425), sici(D2, T2, 11), sici(D3, T3, 3257)),
    );
    expect(result.error).toBeUndefined();
    expect(result.works.map((work) => work.doi)).toEqual([D1, D2, D3]);
    expect(result.works.map((work) => work.id)).toEqual([D1, D2, D3].map((d) => `crossref:${d}`));
    expect(result.works.map((work) => work.provenance[0].sourceId)).toEqual([D1, D2, D3]);
    expect(result.works.map((work) => work.citations)).toEqual([425, 11, 3257]);
    expect(result.works[0].url).toBe(
      'https://doi.org/10.1002/(sici)1097-0258(19980430)17:8%3C841::aid-sim781%3E3.0.co;2-d',
    );
    expect(decodeURIComponent(new URL(result.works[0].url).pathname)).toBe(`/${D1}`);
  });

  it('builds a doi.org link for a SICI DOI when the provider sends no URL', async () => {
    const { result } = await run({}, () => crossrefPage({ ...sici(D1, T1, 1), URL: undefined }));
    expect(result.works[0].url).toBe(
      'https://doi.org/10.1002/(sici)1097-0258(19980430)17:8%3C841::aid-sim781%3E3.0.co;2-d',
    );
  });

  it('keeps real Wiley DOIs that end in "#" or contain "<>", and links them without losing the "#"', async () => {
    const hash = '10.1002/(sici)1521-4095(199808)10:12<931::aid-adma931>3.0.co;2-#';
    const angle = '10.1002/(sici)1099-0712(1998090)8:5<>1.0.co;2-t';
    const { result } = await run({}, () =>
      crossrefPage(sici(hash, T1, 1), sici(angle, T2, 2), sici(D1, T3, 3)),
    );
    expect(result.works.map((work) => work.doi)).toEqual([hash, angle, D1]);
    expect(result.works.map((work) => work.id)).toEqual(
      [hash, angle, D1].map((d) => `crossref:${d}`),
    );
    expect(result.works[0].url).toBe(
      'https://doi.org/10.1002/(sici)1521-4095(199808)10:12%3C931::aid-adma931%3E3.0.co;2-%23',
    );
    expect(result.works[1].url).toBe(
      'https://doi.org/10.1002/(sici)1099-0712(1998090)8:5%3C%3E1.0.co;2-t',
    );
  });

  it('looks up a DOI that ends in "#" exactly and keeps the record', async () => {
    const hash = '10.1002/(sici)1521-4095(199808)10:12<931::aid-adma931>3.0.co;2-#';
    const { result, fetcher } = await run({ mode: 'doi', text: hash }, () =>
      json({ message: sici(hash, T1, 1) }),
    );
    expect(result.error).toBeUndefined();
    expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toBe(`/works/${hash}`);
    expect(result.works[0].doi).toBe(hash);
  });

  it('accepts the raw SICI DOI in DOI mode, requests it exactly, and keeps the record', async () => {
    const { result, fetcher } = await run({ mode: 'doi', text: D2 }, () =>
      json({ message: sici(D2, T2, 11) }),
    );
    expect(result.error).toBeUndefined();
    expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toBe(`/works/${D2}`);
    expect(result.works).toHaveLength(1);
    expect(result.works[0]).toMatchObject({ doi: D2, title: T2 });
  });

  it('accepts a percent-encoded doi.org link for a SICI DOI and keeps the record', async () => {
    const link = `https://doi.org/${D2.replace(/</g, '%3C').replace(/>/g, '%3E')}`;
    const { result } = await run({ mode: 'doi', text: link }, () =>
      json({ message: sici(D2, T2, 11) }),
    );
    expect(result.error).toBeUndefined();
    expect(result.works).toHaveLength(1);
    expect(result.works[0].doi).toBe(D2);
  });

  it('keeps SICI DOIs from OpenAlex, Europe PMC, Semantic Scholar and PubMed', async () => {
    const pubmedXml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">9595615</PMID><Article><ArticleTitle>${T1}.</ArticleTitle><Journal><JournalIssue><PubDate><Year>1998</Year></PubDate></JournalIssue><Title>Statistics in medicine</Title></Journal></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">${D1.toUpperCase().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
    const seen: Record<string, unknown> = {};
    const fixtures: Record<string, Responder> = {
      openalex: () =>
        json({
          meta: { count: 1 },
          results: [
            {
              id: 'https://openalex.org/W1',
              display_name: T1,
              publication_year: 1998,
              doi: `https://doi.org/${D1}`,
              cited_by_count: 425,
            },
          ],
        }),
      europepmc: () =>
        json({
          hitCount: 1,
          resultList: {
            result: [{ id: '9595615', source: 'MED', title: T1, pubYear: '1998', doi: D1 }],
          },
        }),
      semantic: () =>
        json({
          total: 1,
          data: [{ paperId: 'abc', title: T1, year: 1998, externalIds: { DOI: D1 } }],
        }),
      pubmed: (url) =>
        url.pathname.endsWith('esearch.fcgi')
          ? json({ esearchresult: { count: '1', idlist: ['9595615'] } })
          : new Response(pubmedXml),
    };
    for (const [source, respond] of Object.entries(fixtures)) {
      const { result } = await run(
        { sources: [source as SearchQuery['sources'][number]] },
        respond,
      );
      seen[source] = result.works.map((work) => work.doi);
      expect(result.error, source).toBeUndefined();
    }
    expect(seen).toEqual({ openalex: [D1], europepmc: [D1], semantic: [D1], pubmed: [D1] });
  });

  it('never forms an empty provider id: records with no identifier are skipped, not merged into "crossref:"', async () => {
    const { result } = await run({}, () =>
      crossrefPage(
        { title: ['A record without any identifier'], type: 'journal-article' },
        { DOI: '', title: ['A record with an empty identifier'], type: 'journal-article' },
        sici(D1, T1, 1),
      ),
    );
    expect(result.works.map((work) => work.id)).toEqual([`crossref:${D1}`]);
  });

  it('skips OpenAlex records that carry no identifier', async () => {
    const { result } = await run({ sources: ['openalex'] }, () =>
      json({
        meta: { count: 2 },
        results: [
          { display_name: 'No id anywhere' },
          { id: 'https://openalex.org/W7', display_name: 'Has id' },
        ],
      }),
    );
    expect(result.works.map((work) => work.id)).toEqual(['openalex:W7']);
  });
});

describe('DOI input', () => {
  it.each(['not-a-doi', '10.12/short-prefix', 'https://example.org/10.1234/abc'])(
    'rejects %j with a message that says what is accepted',
    async (text) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      await expect(searchSources(query({ mode: 'doi', text }), DEFAULT_SETTINGS)).rejects.toThrow(
        /complete DOI.*doi\.org link/,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('provider text is decoded and cleaned without losing real characters', () => {
  const titleOf = async (raw: string) => {
    const { result } = await run({}, () =>
      crossrefPage({ DOI: '10.1234/t', title: [raw], type: 'journal-article' }),
    );
    return result.works[0].title;
  };

  it.each([
    [
      'entity-escaped italics (Crossref double escaping)',
      'Outbreak of &lt;i&gt;Escherichia coli &lt;/i&gt;K-12 in the UK',
      'Outbreak of Escherichia coli K-12 in the UK',
    ],
    [
      'an escaped non-breaking space',
      'Malaria cases in&amp;nbsp;Queensland',
      'Malaria cases in Queensland',
    ],
    [
      'named entities beyond amp/lt/gt/quot/apos/nbsp',
      '&beta;-lactamase &mdash; &alpha;&times;&eacute; &Omega; &le; &infin; &ndash; caf&eacute;',
      'β-lactamase — α×é Ω ≤ ∞ – café',
    ],
    [
      'numeric entities, decimal and hex',
      'Gene &#946; and &#x3b2; and &#8211;',
      'Gene β and β and –',
    ],
    [
      'a literal less-than sign before a digit',
      'Outcomes in children aged <18 months and >65 years',
      'Outcomes in children aged <18 months and >65 years',
    ],
    [
      'comparison signs with spaces',
      'IL-6 < 10 pg/mL and IL-8 > 20 pg/mL',
      'IL-6 < 10 pg/mL and IL-8 > 20 pg/mL',
    ],
    [
      'an escaped less-than sign',
      'Risk at p&lt;0.05 and &gt;65 years',
      'Risk at p<0.05 and >65 years',
    ],
    ['angle brackets around a non-markup word', 'Bounds for x<y and y>z', 'Bounds for x<y and y>z'],
    [
      'subscripts and superscripts without spaces',
      'CO<sub>2</sub> uptake and Fe<sup>3+</sup> binding',
      'CO2 uptake and Fe3+ binding',
    ],
    [
      'subscripts pretty-printed onto their own lines (real Crossref titles)',
      'A systematic review of urban road traffic CO\n                    <sub>2</sub>\n                    emission models',
      'A systematic review of urban road traffic CO2 emission models',
    ],
    [
      'a pretty-printed subscript decimal and superscript',
      'Atmospheric PM\n   <sub>2.5</sub>\n   exposure and Fe\n <sup>3+</sup>\n binding',
      'Atmospheric PM2.5 exposure and Fe3+ binding',
    ],
    [
      'spaces around inline tags are kept',
      'Levels of <i>E. coli</i> and <b>CO</b><sub>2</sub> in air',
      'Levels of E. coli and CO2 in air',
    ],
    [
      'italic tags next to punctuation',
      '<i>E. coli</i>: a model organism',
      'E. coli: a model organism',
    ],
    ['publisher small-caps tags', '<scp>COVID</scp>-19 response', 'COVID-19 response'],
    [
      'JATS and MathML inline markup',
      '<jats:italic>Vibrio</jats:italic> and <mml:math><mml:mi>x</mml:mi><mml:mo>=</mml:mo><mml:mn>5</mml:mn></mml:math>',
      'Vibrio and x=5',
    ],
    [
      'a tag with attributes and a line break',
      'Methods<br/>and <a href="https://example.org/?a=1&amp;b=2">results</a>',
      'Methods and results',
    ],
    [
      'unknown entities are left alone',
      'Tom &hidden; Jerry &amp; friends',
      'Tom &hidden; Jerry & friends',
    ],
  ])('title: %s', async (_label, raw, expected) => {
    expect(await titleOf(raw)).toBe(expected);
  });

  it('decodes entities in author names', async () => {
    const { result } = await run({}, () =>
      crossrefPage({
        DOI: '10.1234/a',
        title: ['Names'],
        type: 'journal-article',
        author: [
          { given: 'Se&#225;n', family: 'O&#39;Brien' },
          { name: 'Smith &amp; Sons Consortium' },
        ],
      }),
    );
    expect(result.works[0].authors).toEqual(["Seán O'Brien", 'Smith & Sons Consortium']);
  });

  it('drops the generic JATS "Abstract" heading and keeps paragraphs apart', async () => {
    const { result } = await run({}, () =>
      crossrefPage({
        DOI: '10.1234/b',
        title: ['Abstracts'],
        type: 'journal-article',
        abstract:
          '<jats:title>Abstract</jats:title><jats:p>Malaria is <jats:italic>common</jats:italic>.</jats:p><jats:p>A second paragraph.</jats:p>',
      }),
    );
    expect(result.works[0].abstract).toBe('Malaria is common.\n\nA second paragraph.');
  });

  it('does not leave a gap before subscripts in pretty-printed JATS abstracts', async () => {
    const { result } = await run({}, () =>
      crossrefPage({
        DOI: '10.1234/c',
        title: ['Particles'],
        type: 'journal-article',
        abstract:
          '<jats:p>\n  Fine particulate matter &lt;2.5 μm in diameter (PM\n  <jats:sub>2.5</jats:sub>\n  exposure) is linked to CO<jats:sub>2</jats:sub> sources.\n</jats:p>',
      }),
    );
    expect(result.works[0].abstract).toBe(
      'Fine particulate matter <2.5 μm in diameter (PM2.5 exposure) is linked to CO2 sources.',
    );
  });

  it('keeps Europe PMC section headings on their own lines', async () => {
    const { result } = await run({ sources: ['europepmc'] }, () =>
      json({
        hitCount: 1,
        resultList: {
          result: [
            {
              id: '1',
              source: 'MED',
              title: 'Sections',
              abstractText: '<h4>Background</h4>First text. <h4>Methods</h4>Second   text.',
            },
          ],
        },
      }),
    );
    expect(result.works[0].abstract).toBe('Background\n\nFirst text.\n\nMethods\n\nSecond text.');
  });

  it('flattens hard-wrapped arXiv summaries into one paragraph', async () => {
    const { result } = await run(
      { sources: ['arxiv'] },
      () =>
        new Response(
          `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v1</id><title>Wrapped</title><published>2024-01-10T00:00:00Z</published><summary>First line of the
  summary that continues here.</summary></entry></feed>`,
        ),
    );
    expect(result.works[0].abstract).toBe('First line of the summary that continues here.');
  });

  it('keeps PubMed structured-abstract labels and paragraph breaks', async () => {
    const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">33163380</PMID><Article><ArticleTitle>Structured</ArticleTitle><Abstract><AbstractText Label="OBJECTIVE" NlmCategory="OBJECTIVE">To study <i>P</i> &lt; 0.05 effects &amp; more.</AbstractText><AbstractText Label="METHODS" NlmCategory="METHODS">A cohort.</AbstractText><AbstractText Label="UNLABELLED" NlmCategory="UNASSIGNED">Loose text.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
    const { result } = await run({ sources: ['pubmed'] }, (url) =>
      url.pathname.endsWith('esearch.fcgi')
        ? json({ esearchresult: { count: '1', idlist: ['33163380'] } })
        : new Response(xml),
    );
    expect(result.works[0].abstract).toBe(
      'OBJECTIVE: To study P < 0.05 effects & more.\n\nMETHODS: A cohort.\n\nLoose text.',
    );
  });

  it('cleans pathological markup in linear time', async () => {
    const started = vi.getRealSystemTime();
    const hostile = `${'<a b=c '.repeat(40000)}${'<'.repeat(40000)}${'&amp;'.repeat(40000)}${'<i>x'.repeat(20000)}`;
    const { result } = await run({}, () =>
      crossrefPage({ DOI: '10.1234/p', title: [hostile], type: 'journal-article' }),
    );
    expect(result.works).toHaveLength(1);
    expect(vi.getRealSystemTime() - started).toBeLessThan(3000);
  });
});

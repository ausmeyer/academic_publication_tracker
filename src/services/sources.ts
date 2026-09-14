import { XMLParser } from 'fast-xml-parser';
import { mergeWorks, normalizeDoi } from '../core/merge.ts';
import type {
  SearchQuery,
  SearchResponse,
  Settings,
  SourceId,
  SourceInfo,
  SourceResult,
  Work,
  ApiSourceId,
} from '../types.ts';

export const DEFAULT_SETTINGS: Settings = {
  email: '',
  openalexApiKey: '',
  semanticApiKey: '',
  ncbiApiKey: '',
};
export const SOURCES: SourceInfo[] = [
  {
    id: 'openalex',
    name: 'OpenAlex',
    description: 'Multidisciplinary publications and citation graph',
    access: 'Public · free key recommended',
    url: 'https://help.openalex.org/api/authentication/',
    citationSupport: true,
  },
  {
    id: 'crossref',
    name: 'Crossref',
    description: 'Publisher-deposited DOI metadata',
    access: 'Public · contact email recommended',
    url: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
    citationSupport: true,
  },
  {
    id: 'europepmc',
    name: 'Europe PMC',
    description: 'Life sciences, preprints, and open full text',
    access: 'Public · no registration',
    url: 'https://europepmc.org/RestfulWebService',
    citationSupport: true,
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    description: 'Biomedical literature from the National Library of Medicine',
    access: 'Public · optional NCBI key',
    url: 'https://www.ncbi.nlm.nih.gov/books/NBK25497/',
    citationSupport: false,
  },
  {
    id: 'semantic',
    name: 'Semantic Scholar',
    description: 'Multidisciplinary papers and citation discovery',
    access: 'Public · free key recommended',
    url: 'https://www.semanticscholar.org/product/api',
    citationSupport: true,
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    description: 'Open preprints in physics, mathematics, and computing',
    access: 'Public · no registration',
    url: 'https://info.arxiv.org/help/api/user-manual.html',
    citationSupport: false,
  },
  {
    id: 'preprints',
    name: 'Preprints',
    description: 'Combined arXiv, Europe PMC preprints, and Crossref preprint metadata',
    access: 'Public · no registration',
    url: 'https://europepmc.org/Preprints',
    citationSupport: true,
  },
  {
    id: 'datacite',
    name: 'DataCite',
    description: 'Research datasets, software, preprints, and repository publications',
    access: 'Public · no registration',
    url: 'https://support.datacite.org/docs/rest-api',
    citationSupport: true,
  },
];

// Provider responses are heterogeneous; normalization below is the boundary to the typed app model.
type RecordData = Record<string, any>;
type Context = {
  query: SearchQuery;
  settings: Settings;
  result: SourceResult & { source: ApiSourceId };
  deadline: number;
  timestamp: string;
};
const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
  stopNodes: ['*.ArticleTitle', '*.AbstractText', '*.BookTitle'],
});
const nextRequest = new Map<SourceId, number>();
const intervals: Record<ApiSourceId, number> = {
  openalex: 250,
  crossref: 500,
  europepmc: 350,
  pubmed: 400,
  semantic: 1100,
  arxiv: 3100,
  // Combined searches use the underlying provider's pacing bucket.
  preprints: 0,
  datacite: 500,
};
const array = (value: any): any[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
const text = (value: any): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
  if (typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, item]) => text(item))
      .join(' ');
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name] ?? '',
    )
    .replace(/\s+/g, ' ')
    .trim();
};
const count = (value: any): number | null =>
  value === null ||
  value === undefined ||
  value === '' ||
  !Number.isFinite(Number(value)) ||
  Number(value) < 0
    ? null
    : Math.floor(Number(value));
const year = (value: any): number | null => {
  const found = text(value).match(/\b(1\d{3}|2\d{3})\b/);
  return found ? Number(found[0]) : null;
};
const doi = (value: any): string => normalizeDoi(text(value));
const safeUrl = (value: any): string => {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
};
const quoted = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function authorVariants(name: string): string[] {
  const parts = name.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [name];
  // Biomedical indexes conventionally use surname followed by initials. Retain the literal
  // input as well, so users can already supply that convention or a compound surname.
  return [
    ...new Set([
      name,
      `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`,
      `${parts.at(-1)} ${parts
        .slice(0, -1)
        .map((part) => [...part][0])
        .join('')}`,
    ]),
  ];
}

function compatibleAuthor(name: string, candidate: string): boolean {
  const tokens = (value: string) => {
    const plain = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    // Preserve the unexpanded form: capitalized short surnames (LI, NG, LEE) are not necessarily initials.
    return [
      plain,
      plain.replace(/\b[A-Z]{2,3}\b/g, (initials) => initials.split('').join(' ')),
    ].map((form) =>
      form
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  };
  return tokens(name).some((wantedTokens) =>
    tokens(candidate).some((actual) =>
      wantedTokens.every((wanted) =>
        actual.some(
          (found) =>
            wanted === found ||
            (([...wanted].length === 1 || [...found].length === 1) &&
              [...wanted][0] === [...found][0]),
        ),
      ),
    ),
  );
}

function validate(input: SearchQuery): Omit<SearchQuery, 'sources'> & { sources: ApiSourceId[] } {
  if (
    !input ||
    typeof input.text !== 'string' ||
    input.text.trim().length < 2 ||
    input.text.length > 500
  )
    throw new Error('Enter a search between 2 and 500 characters.');
  if (!['topic', 'author', 'doi'].includes(input.mode))
    throw new Error('Choose topic, author, or DOI search.');
  if (
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    input.sources.length > SOURCES.length ||
    input.sources.some((source) => !SOURCES.some((item) => item.id === source))
  )
    throw new Error('Choose at least one supported data source.');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)
    throw new Error('Choose between 1 and 200 results per source.');
  const maxYear = new Date().getFullYear() + 1;
  for (const value of [input.yearFrom, input.yearTo])
    if (value != null && (!Number.isInteger(value) || value < 1500 || value > maxYear))
      throw new Error(`Publication years must be between 1500 and ${maxYear}.`);
  if (input.yearFrom != null && input.yearTo != null && input.yearFrom > input.yearTo)
    throw new Error('The start year must come before the end year.');
  const normalized = input.mode === 'doi' ? doi(input.text) : input.text.trim();
  if (input.mode === 'doi' && !/^10\.\d{4,9}\/\S+$/i.test(normalized))
    throw new Error('Enter a complete DOI, such as 10.1038/nature12373.');
  return { ...input, text: normalized, sources: [...new Set(input.sources)] as ApiSourceId[] };
}

class SourceError extends Error {}
async function request(
  ctx: Context,
  endpoint: string,
  params: Record<string, string | number | undefined>,
  format: 'json' | 'xml' = 'json',
  headers: Record<string, string> = {},
): Promise<RecordData> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = ctx.result.source;
    const start = Math.max(Date.now(), nextRequest.get(source) ?? 0);
    if (start >= ctx.deadline)
      throw new SourceError('Search timed out. Narrow the query or retry this source.');
    nextRequest.set(source, start + intervals[source]);
    if (start > Date.now()) await delay(start - Date.now());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(15000, ctx.deadline - Date.now())),
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: format === 'xml' ? 'application/xml, application/atom+xml' : 'application/json',
          'User-Agent': 'AcademicPublicationTracker/0.4.2',
          ...headers,
        },
        redirect: 'error',
      });
      if (response.status === 404)
        throw new SourceError('No matching record was found in this source.');
      if (response.status === 429 || response.status >= 500) {
        const retryHeader = response.headers.get('retry-after');
        const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
        const retryMs = retryHeader
          ? Number.isFinite(retrySeconds)
            ? retrySeconds * 1000
            : Date.parse(retryHeader) - Date.now()
          : 1500;
        // A long server-requested wait is surfaced to the user instead of retrying early.
        if (
          attempt === 0 &&
          Number.isFinite(retryMs) &&
          retryMs <= 5000 &&
          Date.now() + Math.max(1500, retryMs) < ctx.deadline
        ) {
          await response.body?.cancel();
          clearTimeout(timer);
          await delay(Math.max(1500, retryMs));
          continue;
        }
        throw new SourceError(
          response.status === 429
            ? 'Rate limit reached. Try again later or add a free API key in Settings if supported.'
            : 'The source is temporarily unavailable. Try again later.',
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new SourceError(
          'Access was denied. Check the API key in Settings and the source’s access requirements.',
        );
      if (!response.ok)
        throw new SourceError(
          `The source rejected this query (HTTP ${response.status}). Try simpler search terms.`,
        );
      const body = await response.text();
      try {
        return format === 'xml' ? xml.parse(body) : JSON.parse(body);
      } catch {
        throw new SourceError('The source returned an unreadable response. Try again later.');
      }
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (controller.signal.aborted)
        throw new SourceError('The source did not respond in time. Try again later.');
      // Do not expose upstream errors or URLs: they can contain credentials and query text.
      throw new SourceError(
        'Could not connect to this source. Check your connection and try again.',
      );
    } finally {
      clearTimeout(timer);
      // Status failures can leave an unread response body; close that request as well.
      controller.abort();
    }
  }
  throw new SourceError('The source is temporarily unavailable.');
}

function work(ctx: Context, sourceId: string, fields: Partial<Work>): Work {
  const normalizedDoi = doi(fields.doi);
  const url = safeUrl(fields.url) || (normalizedDoi ? `https://doi.org/${normalizedDoi}` : '');
  const citations = count(fields.citations);
  return {
    id: `${ctx.result.source}:${sourceId}`,
    title: text(fields.title) || 'Untitled record',
    authors: (fields.authors ?? []).map(text).filter(Boolean),
    year: year(fields.year),
    venue: text(fields.venue),
    doi: normalizedDoi,
    abstract: text(fields.abstract),
    type: text(fields.type) || 'publication',
    url,
    openAccessUrl: safeUrl(fields.openAccessUrl),
    isOpenAccess: fields.isOpenAccess === true,
    citations,
    provenance: [
      { source: ctx.result.source, sourceId, citations, retrievedAt: ctx.timestamp, url },
    ],
    included: true,
    tags: [],
    notes: '',
  };
}

function add(ctx: Context, records: Work[]) {
  const { query, result } = ctx;
  for (const item of records) {
    if (result.works.length >= query.limit) break;
    if (query.mode === 'doi' && item.doi !== query.text) continue;
    if (query.yearFrom && (item.year == null || item.year < query.yearFrom)) continue;
    if (query.yearTo && (item.year == null || item.year > query.yearTo)) continue;
    if (!result.works.some((existing) => existing.id === item.id)) result.works.push(item);
  }
}

async function crossref(ctx: Context, preprintsOnly = false) {
  const { query: q, settings, result } = ctx;
  const normalize = (item: RecordData) =>
    work(ctx, doi(item.DOI), {
      title: array(item.title)[0],
      authors: array(item.author).map(
        (a) => text(a.name) || [a.given, a.family].filter(Boolean).join(' '),
      ),
      year: item.published?.['date-parts']?.[0]?.[0] ?? item.issued?.['date-parts']?.[0]?.[0],
      venue: array(item['container-title'])[0] || (preprintsOnly ? item.publisher : ''),
      doi: item.DOI,
      abstract: item.abstract,
      type: preprintsOnly ? 'preprint' : item.type,
      url: item.URL,
      citations: item['is-referenced-by-count'],
    });
  if (q.mode === 'doi') {
    const data = await request(
      ctx,
      `https://api.crossref.org/works/${encodeURIComponent(q.text)}`,
      { mailto: settings.email },
    );
    if (!data.message?.DOI) throw new SourceError('Crossref returned an incomplete record.');
    if (
      !preprintsOnly ||
      (data.message.type === 'posted-content' && data.message.subtype === 'preprint')
    )
      add(ctx, [normalize(data.message)]);
    result.total = result.works.length;
    return;
  }
  let scanned = 0;
  if (q.mode === 'author')
    result.warning +=
      ' Crossref candidates are screened for compatible name tokens; at most 200 candidate records are examined. The source total is before screening.';
  if (preprintsOnly)
    result.warning = [
      result.warning,
      'Only posted-content records explicitly marked as preprints are kept; at most 200 candidate records are examined.',
    ]
      .filter(Boolean)
      .join(' ');
  while (result.works.length < q.limit) {
    const rows =
      q.mode === 'author' || preprintsOnly
        ? Math.min(100, 200 - scanned)
        : Math.min(100, q.limit - result.works.length);
    const filter = [
      preprintsOnly && 'type:posted-content',
      q.yearFrom && `from-pub-date:${q.yearFrom}-01-01`,
      q.yearTo && `until-pub-date:${q.yearTo}-12-31`,
    ]
      .filter(Boolean)
      .join(',');
    // Bounded offset paging preserves query relevance; cursor search can return index order.
    const data = await request(ctx, 'https://api.crossref.org/works', {
      [q.mode === 'author' ? 'query.author' : 'query.bibliographic']: q.text,
      rows,
      offset: scanned,
      filter,
      mailto: settings.email,
    });
    if (!Array.isArray(data.message?.items))
      throw new SourceError('Crossref returned an unexpected response.');
    result.total = count(data.message['total-results']);
    const items = data.message.items;
    const normalized = items
      .filter(
        (item: RecordData) =>
          !preprintsOnly || (item.type === 'posted-content' && item.subtype === 'preprint'),
      )
      .map(normalize);
    add(
      ctx,
      q.mode === 'author'
        ? normalized.filter((item: Work) =>
            item.authors.some((author) => compatibleAuthor(q.text, author)),
          )
        : normalized,
    );
    scanned += items.length;
    if (items.length < rows || (result.total != null && scanned >= result.total) || scanned >= 200)
      break;
  }
}

function invertedAbstract(index: RecordData | null) {
  if (!index || typeof index !== 'object') return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index))
    for (const position of array(positions))
      if (Number.isInteger(position) && position >= 0 && position < 50000) words[position] = word;
  return words.join(' ');
}

async function openalex(ctx: Context) {
  const { query: q, settings, result } = ctx;
  const headers: Record<string, string> = settings.openalexApiKey
    ? { Authorization: `Bearer ${settings.openalexApiKey}` }
    : {};
  const filters = [
    q.yearFrom != null || q.yearTo != null
      ? `publication_year:${q.yearFrom ?? 1500}-${q.yearTo ?? new Date().getFullYear() + 1}`
      : '',
  ];
  if (q.mode === 'author') {
    const data = await request(
      ctx,
      'https://api.openalex.org/authors',
      { search: q.text, per_page: 5 },
      'json',
      headers,
    );
    if (!Array.isArray(data.results))
      throw new SourceError('OpenAlex returned an unexpected author response.');
    const ids = data.results
      .map((a: RecordData) => text(a.id).split('/').pop() ?? '')
      .filter((id: string) => /^A\d+$/.test(id));
    if (!ids.length) {
      result.total = 0;
      return;
    }
    filters.push(`authorships.author.id:${ids.join('|')}`);
    result.warning = `Candidate works from up to five matching author profiles (${data.results.map((a: RecordData) => text(a.display_name)).join('; ')}). Verify identity before using metrics.`;
  } else if (q.mode === 'doi') filters.push(`doi:${q.text}`);
  let cursor = '*';
  while (result.works.length < q.limit) {
    const perPage = Math.min(100, q.limit - result.works.length);
    const data = await request(
      ctx,
      'https://api.openalex.org/works',
      {
        search: q.mode === 'topic' ? q.text : undefined,
        filter: filters.filter(Boolean).join(','),
        per_page: perPage,
        cursor,
      },
      'json',
      headers,
    );
    if (!Array.isArray(data.results))
      throw new SourceError('OpenAlex returned an unexpected response.');
    result.total = count(data.meta?.count);
    add(
      ctx,
      data.results.map((item: RecordData) =>
        work(ctx, text(item.id).split('/').pop()!, {
          title: item.display_name,
          authors: array(item.authorships).map((a) => a.author?.display_name || a.raw_author_name),
          year: item.publication_year,
          venue: item.primary_location?.source?.display_name,
          doi: item.doi,
          abstract: invertedAbstract(item.abstract_inverted_index),
          type: item.type,
          url: item.primary_location?.landing_page_url || item.id,
          openAccessUrl: item.best_oa_location?.pdf_url || item.open_access?.oa_url,
          isOpenAccess: item.open_access?.is_oa === true,
          citations: item.cited_by_count,
        }),
      ),
    );
    const next = data.meta?.next_cursor;
    if (q.mode === 'doi' || data.results.length < perPage || !next || next === cursor) break;
    cursor = next;
  }
}

async function europepmc(ctx: Context, preprintsOnly = false) {
  const { query: q, result } = ctx;
  let search =
    q.mode === 'author'
      ? `(${authorVariants(q.text)
          .map((name) => `AUTH:${quoted(name)}`)
          .join(' OR ')})`
      : q.mode === 'doi'
        ? `DOI:${quoted(q.text)}`
        : `(${q.text})`;
  if (preprintsOnly) search = `(${search}) AND SRC:PPR`;
  if (q.yearFrom || q.yearTo)
    search += ` AND FIRST_PDATE:[${q.yearFrom ?? 1500}-01-01 TO ${q.yearTo ?? new Date().getFullYear() + 1}-12-31]`;
  let cursor = '*';
  while (result.works.length < q.limit) {
    const pageSize = Math.min(100, q.limit - result.works.length);
    const data = await request(ctx, 'https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
      query: search,
      format: 'json',
      resultType: 'core',
      pageSize,
      cursorMark: cursor,
    });
    if (!data.resultList || !Array.isArray(data.resultList.result))
      throw new SourceError('Europe PMC returned an unexpected response.');
    result.total = count(data.hitCount);
    const items = data.resultList.result;
    add(
      ctx,
      items
        .filter((item: RecordData) => !preprintsOnly || item.source === 'PPR')
        .map((item: RecordData) => {
          const fullText = array(item.fullTextUrlList?.fullTextUrl).find(
            (link) => link.availability === 'Open access' && safeUrl(link.url),
          );
          return work(ctx, `${text(item.source)}:${text(item.id)}`, {
            title: item.title,
            authors: item.authorList?.author
              ? array(item.authorList.author).map((a) => a.fullName || a.collectiveName)
              : text(item.authorString).split(', ').filter(Boolean),
            year: item.pubYear,
            venue: item.journalInfo?.journal?.title || item.bookOrReportDetails?.publisher,
            doi: item.doi,
            abstract: item.abstractText,
            type: array(item.pubTypeList?.pubType).join(', '),
            url: `https://europepmc.org/article/${encodeURIComponent(text(item.source))}/${encodeURIComponent(text(item.id))}`,
            openAccessUrl: fullText?.url,
            isOpenAccess: item.isOpenAccess === 'Y',
            citations: item.citedByCount,
          });
        }),
    );
    const next = data.nextCursorMark;
    if (q.mode === 'doi' || items.length < pageSize || !next || next === cursor) break;
    cursor = next;
  }
}

async function pubmed(ctx: Context) {
  const { query: q, result, settings } = ctx;
  let term =
    q.mode === 'author'
      ? `(${authorVariants(q.text)
          .map((name) => `${quoted(name)}[Author]`)
          .join(' OR ')})`
      : q.mode === 'doi'
        ? `${quoted(q.text)}[AID]`
        : `(${q.text})`;
  if (q.yearFrom || q.yearTo)
    term += ` AND ("${q.yearFrom ?? 1500}/01/01"[Date - Publication] : "${q.yearTo ?? new Date().getFullYear() + 1}/12/31"[Date - Publication])`;
  const common = { db: 'pubmed', tool: 'AcademicPublicationTracker', api_key: settings.ncbiApiKey };
  let offset = 0;
  while (result.works.length < q.limit) {
    const size = Math.min(100, q.limit - result.works.length);
    const found = await request(ctx, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      ...common,
      term,
      retmode: 'json',
      retmax: size,
      retstart: offset,
      sort: 'relevance',
    });
    if (!Array.isArray(found.esearchresult?.idlist))
      throw new SourceError('PubMed returned an unexpected search response.');
    result.total = count(found.esearchresult.count);
    const ids = found.esearchresult.idlist.filter((id: string) => /^\d+$/.test(id));
    if (!ids.length) break;
    const fetched = await request(
      ctx,
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi',
      { ...common, id: ids.join(','), retmode: 'xml' },
      'xml',
    );
    if (!fetched.PubmedArticleSet)
      throw new SourceError('PubMed returned an unexpected article response.');
    const items = [
      ...array(fetched.PubmedArticleSet.PubmedArticle),
      ...array(fetched.PubmedArticleSet.PubmedBookArticle),
    ];
    add(
      ctx,
      items.map((item: RecordData) => {
        const citation = item.MedlineCitation ?? item.BookDocument ?? {};
        const article = citation.Article ?? citation;
        const identifiers = array(
          (item.PubmedData ?? item.PubmedBookData)?.ArticleIdList?.ArticleId,
        );
        const doiId = identifiers.find((id) => id['@_IdType'] === 'doi');
        const pmcId = text(identifiers.find((id) => id['@_IdType'] === 'pmc'));
        const pmid = text(citation.PMID);
        return work(ctx, pmid, {
          title: article.ArticleTitle,
          authors: array(article.AuthorList?.Author).map(
            (a) =>
              a.CollectiveName || [a.ForeName || a.Initials, a.LastName].filter(Boolean).join(' '),
          ),
          year: year(
            article.Journal?.JournalIssue?.PubDate?.Year ??
              article.Journal?.JournalIssue?.PubDate?.MedlineDate ??
              array(article.ArticleDate)[0]?.Year ??
              article.Book?.PubDate?.Year,
          ),
          venue: article.Journal?.Title || article.Book?.BookTitle,
          doi:
            text(doiId) || text(array(article.ELocationID).find((id) => id['@_EIdType'] === 'doi')),
          abstract: array(article.Abstract?.AbstractText)
            .map((value) => text(value))
            .join('\n\n'),
          type: array(article.PublicationTypeList?.PublicationType).map(text).join(', '),
          url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`,
          // PMC availability does not by itself establish an open reuse license.
          openAccessUrl: pmcId
            ? `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(pmcId)}/`
            : '',
          isOpenAccess: false,
          citations: null,
        });
      }),
    );
    offset += ids.length;
    if (q.mode === 'doi' || ids.length < size || (result.total != null && offset >= result.total))
      break;
  }
}

async function semantic(ctx: Context) {
  const { query: q, settings, result } = ctx;
  const headers: Record<string, string> = settings.semanticApiKey
    ? { 'x-api-key': settings.semanticApiKey }
    : {};
  const fields =
    'paperId,title,authors,year,venue,externalIds,abstract,url,openAccessPdf,isOpenAccess,citationCount,publicationTypes';
  const normalize = (item: RecordData) =>
    work(ctx, text(item.paperId), {
      title: item.title,
      authors: array(item.authors).map((a) => a.name),
      year: item.year,
      venue: item.venue,
      doi: item.externalIds?.DOI,
      abstract: item.abstract,
      url: item.url,
      openAccessUrl: item.openAccessPdf?.url,
      isOpenAccess: item.isOpenAccess === true,
      citations: item.citationCount,
      type: array(item.publicationTypes).join(', '),
    });
  if (q.mode === 'doi') {
    const data = await request(
      ctx,
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(`DOI:${q.text}`)}`,
      { fields },
      'json',
      headers,
    );
    if (!data.paperId) throw new SourceError('Semantic Scholar returned an incomplete record.');
    add(ctx, [normalize(data)]);
    result.total = result.works.length;
    return;
  }
  if (q.mode === 'author') {
    const authors = await request(
      ctx,
      'https://api.semanticscholar.org/graph/v1/author/search',
      { query: q.text, limit: 5, fields: 'name,authorId' },
      'json',
      headers,
    );
    if (!Array.isArray(authors.data))
      throw new SourceError('Semantic Scholar returned an unexpected author response.');
    const candidates = authors.data.filter((a: RecordData) => /^\d+$/.test(text(a.authorId)));
    if (!candidates.length) {
      result.total = 0;
      return;
    }
    result.warning = `Candidate works from up to five matching author profiles (${candidates.map((a: RecordData) => text(a.name)).join('; ')}). Results are sampled across profiles; verify identity and refine the name if needed.`;
    // Round-robin profiles so the first namesake cannot consume the entire result budget.
    const profiles = candidates.map((author: RecordData) => ({
      id: author.authorId,
      offset: 0,
      done: false,
    }));
    while (result.works.length < q.limit && profiles.some((profile) => !profile.done)) {
      for (const profile of profiles) {
        if (profile.done || result.works.length >= q.limit) continue;
        const limit = Math.min(
          Math.ceil(q.limit / profiles.length),
          q.limit - result.works.length,
          100,
        );
        const data = await request(
          ctx,
          `https://api.semanticscholar.org/graph/v1/author/${profile.id}/papers`,
          { fields, limit, offset: profile.offset },
          'json',
          headers,
        );
        if (!Array.isArray(data.data))
          throw new SourceError('Semantic Scholar returned an unexpected paper response.');
        add(ctx, data.data.map(normalize));
        profile.done =
          data.next == null || data.data.length === 0 || Number(data.next) <= profile.offset;
        profile.offset = Number(data.next);
      }
    }
    // The endpoint does not provide a comparable total for a union of candidate profiles.
    return;
  }
  let offset = 0;
  while (result.works.length < q.limit) {
    const limit = Math.min(100, q.limit - result.works.length);
    const data = await request(
      ctx,
      'https://api.semanticscholar.org/graph/v1/paper/search',
      {
        query: q.text,
        fields,
        limit,
        offset,
        year: q.yearFrom || q.yearTo ? `${q.yearFrom ?? ''}:${q.yearTo ?? ''}` : undefined,
      },
      'json',
      headers,
    );
    if (!Array.isArray(data.data))
      throw new SourceError('Semantic Scholar returned an unexpected response.');
    result.total = count(data.total);
    add(ctx, data.data.map(normalize));
    if (data.next == null || data.data.length === 0 || Number(data.next) <= offset) break;
    offset = Number(data.next);
  }
}

async function arxiv(ctx: Context) {
  const { query: q, result } = ctx;
  if (q.mode === 'doi') {
    // The documented arXiv API has no DOI search field. Avoid pretending free-text matching is DOI lookup.
    result.warning =
      'arXiv’s documented API does not support exact DOI lookup. Search by topic or author instead.';
    return;
  }
  let search =
    q.mode === 'author'
      ? `au:${quoted(q.text)}`
      : q.text
          .split(/\s+/)
          .map((word) => `all:${quoted(word)}`)
          .join(' AND ');
  if (q.yearFrom || q.yearTo)
    search = `(${search}) AND submittedDate:[${q.yearFrom ?? 1500}01010000 TO ${q.yearTo ?? new Date().getFullYear() + 1}12312359]`;
  let start = 0;
  while (result.works.length < q.limit) {
    const maxResults = Math.min(100, q.limit - result.works.length);
    const data = await request(
      ctx,
      'https://export.arxiv.org/api/query',
      {
        search_query: search,
        start,
        max_results: maxResults,
        sortBy: 'relevance',
        sortOrder: 'descending',
      },
      'xml',
    );
    if (!data.feed) throw new SourceError('arXiv returned an unexpected response.');
    const entries = array(data.feed.entry);
    if (entries.some((item) => text(item.id).includes('/api/errors')))
      throw new SourceError('arXiv could not interpret this query. Try simpler search terms.');
    result.total = count(data.feed.totalResults);
    add(
      ctx,
      entries.map((item) =>
        work(ctx, text(item.id).replace(/^https?:\/\/arxiv\.org\/abs\//, ''), {
          title: item.title,
          authors: array(item.author).map((a) => a.name),
          year: year(item.published),
          venue: item.journal_ref || 'arXiv',
          doi: item.doi,
          abstract: item.summary,
          type: 'preprint',
          url: text(item.id).replace(/^http:/, 'https:'),
          openAccessUrl: array(item.link).find((link) => link['@_title'] === 'pdf')?.['@_href'],
          isOpenAccess: true,
          citations: null,
        }),
      ),
    );
    start += entries.length;
    if (entries.length < maxResults || (result.total != null && start >= result.total)) break;
  }
}

async function preprints(ctx: Context) {
  const providers: { source: ApiSourceId; name: string; run: (child: Context) => Promise<void> }[] =
    [
      { source: 'arxiv', name: 'arXiv', run: arxiv },
      { source: 'europepmc', name: 'Europe PMC preprints', run: (child) => europepmc(child, true) },
      { source: 'crossref', name: 'Crossref preprints', run: (child) => crossref(child, true) },
    ];
  const children = await Promise.all(
    providers.map(async (provider) => {
      const result: Context['result'] = {
        source: provider.source,
        works: [],
        total: null,
        warning: '',
      };
      try {
        // Preserve provider provenance and pacing, including when the same API is also selected directly.
        await provider.run({ ...ctx, query: { ...ctx.query, sources: [provider.source] }, result });
      } catch (error) {
        result.error =
          error instanceof SourceError
            ? error.message
            : 'This provider returned an unexpected response.';
      }
      return { ...provider, result };
    }),
  );
  const interleaved: Work[] = [];
  for (let index = 0; index < ctx.query.limit; index++) {
    for (const child of children) {
      const item = child.result.works[index];
      if (item) interleaved.push(item);
    }
  }
  // Merge the whole bounded candidate set first so selected works retain all retrieved provenance.
  const merged = mergeWorks(interleaved);
  ctx.result.works = merged.slice(0, ctx.query.limit);
  ctx.result.total = null;
  ctx.result.warning = [
    ctx.result.warning,
    `Combined preprint search samples arXiv, Europe PMC preprints, and Crossref preprints. Coverage depends on indexing and is not exhaustive. Up to ${ctx.query.limit} accepted records per provider are considered and at most ${ctx.query.limit} unique records are kept, alternating providers. Citation counts retain their original provider.`,
    ...children.map(({ name, result }) =>
      [
        `${name}: ${result.works.length} retrieved.`,
        result.error,
        result.error && result.works.length
          ? 'Only records retrieved before the error are available.'
          : '',
        result.warning,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    merged.length > ctx.query.limit
      ? 'Additional matching candidates were omitted at the collection limit.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const applicable = children.filter(
    (child) => !(ctx.query.mode === 'doi' && child.source === 'arxiv'),
  );
  if (applicable.every((child) => child.result.error) && !ctx.result.works.length)
    ctx.result.error =
      'All available preprint providers failed. See the provider messages and try again later.';
}

async function datacite(ctx: Context) {
  const { query: q, result } = ctx;
  result.warning = [
    result.warning,
    'DataCite includes datasets, software, and other research outputs. Citation counts reflect DataCite Event Data relationships; missing counts remain unknown.',
    q.mode === 'author'
      ? 'Creator names are screened for compatible name tokens; at most 200 candidates are examined. The source total is before screening.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const normalize = (record: RecordData) => {
    const item = record.attributes ?? {};
    // A repository landing page does not establish open access. Require an explicit open license.
    const openLicense = array(item.rightsList).some(
      (right) =>
        /^(?:cc0-1\.0|cc-by(?:-sa)?-[1-4]\.0)$/i.test(text(right.rightsIdentifier)) ||
        /^https?:\/\/creativecommons\.org\/(?:licenses\/by(?:-sa)?\/[1-4]\.0|publicdomain\/zero\/1\.0)(?:\/|$)/i.test(
          text(right.rightsUri),
        ),
    );
    const landingPage = safeUrl(item.url);
    return work(ctx, doi(item.doi || record.id), {
      title: array(item.titles)[0]?.title,
      authors: array(item.creators).map(
        (author) => [author.givenName, author.familyName].filter(Boolean).join(' ') || author.name,
      ),
      year: item.publicationYear,
      venue:
        item.container?.title ||
        (typeof item.publisher === 'object' ? item.publisher?.name : item.publisher),
      doi: item.doi || record.id,
      abstract: array(item.descriptions).find(
        (description) => description.descriptionType === 'Abstract',
      )?.description,
      type: item.types?.resourceType || item.types?.resourceTypeGeneral,
      url: landingPage,
      openAccessUrl: openLicense ? landingPage : '',
      isOpenAccess: openLicense,
      citations: item.citationCount,
    });
  };
  if (q.mode === 'doi') {
    const data = await request(
      ctx,
      `https://api.datacite.org/dois/${encodeURIComponent(q.text)}`,
      {},
    );
    if (!data.data?.attributes?.doi)
      throw new SourceError('DataCite returned an incomplete record.');
    add(ctx, [normalize(data.data)]);
    result.total = result.works.length;
    return;
  }
  let search =
    q.mode === 'author'
      ? `(${authorVariants(q.text)
          .map((name) => `creators.name:${quoted(name)}`)
          .join(' OR ')})`
      : `(${q.text})`;
  if (q.yearFrom || q.yearTo)
    search += ` AND publicationYear:[${q.yearFrom ?? 1500} TO ${q.yearTo ?? new Date().getFullYear() + 1}]`;
  // Keep page size fixed: changing it on numbered pages would skip or repeat records.
  const pageSize = q.mode === 'author' ? 100 : Math.min(100, q.limit);
  let scanned = 0;
  for (let page = 1; result.works.length < q.limit && scanned < 200; page++) {
    const data = await request(ctx, 'https://api.datacite.org/dois', {
      query: search,
      'page[size]': pageSize,
      'page[number]': page,
      sort: 'relevance',
    });
    if (!Array.isArray(data.data))
      throw new SourceError('DataCite returned an unexpected response.');
    result.total = count(data.meta?.total);
    const items = data.data;
    const records = items
      .filter((item: RecordData) =>
        /^10\.\d{4,9}\/\S+$/i.test(doi(item.attributes?.doi || item.id)),
      )
      .map(normalize);
    add(
      ctx,
      q.mode === 'author'
        ? records.filter((item: Work) =>
            item.authors.some((author) => compatibleAuthor(q.text, author)),
          )
        : records,
    );
    scanned += items.length;
    if (items.length < pageSize || (result.total != null && scanned >= result.total)) break;
  }
}

const connectors: Record<ApiSourceId, (ctx: Context) => Promise<void>> = {
  crossref,
  openalex,
  europepmc,
  pubmed,
  semantic,
  arxiv,
  preprints,
  datacite,
};

export async function searchSources(
  input: SearchQuery,
  suppliedSettings: Settings,
): Promise<SearchResponse> {
  const query = validate(input);
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const value = suppliedSettings?.[key];
    if (typeof value === 'string' && value.length <= 1000 && !/[\r\n]/.test(value))
      settings[key] = value.trim();
  }
  const searchedAt = new Date().toISOString();
  const deadline = Date.now() + 60000;
  const results = await Promise.all(
    query.sources.map(async (source) => {
      const result: SourceResult & { source: ApiSourceId } = { source, works: [], total: null };
      if (query.mode === 'author')
        result.warning =
          'Author-name matches can include namesakes and omit name variants. Review and exclude unrelated papers before interpreting metrics.';
      try {
        await connectors[source]({ query, settings, result, deadline, timestamp: searchedAt });
      } catch (error) {
        result.error =
          error instanceof SourceError
            ? error.message
            : 'This source returned an unexpected response. Try again later.';
      }
      if (result.error && result.works.length)
        result.warning = [result.warning, 'Only the records retrieved before the error are shown.']
          .filter(Boolean)
          .join(' ');
      return result;
    }),
  );
  return { results, searchedAt };
}

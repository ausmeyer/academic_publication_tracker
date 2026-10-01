import { XMLParser } from 'fast-xml-parser';
import { clampWork } from '../core/limits.ts';
import { doiUrl, mergeWorks, normalizeDoi } from '../core/merge.ts';
import {
  hasSurname,
  isParticle,
  nameKeys,
  nameMatch,
  nameVariants,
  sameFamily,
  surnameFirstMatch,
} from '../core/names.ts';
import {
  CROSSREF_PUBLICATION_TYPES,
  cleanPublicationTypes,
  isPublicationKind,
  workKind,
} from '../core/worktype.ts';
import { APP_VERSION } from '../version.ts';
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

/** Largest provider response body read into memory; the biggest real pages (100 works by huge collaborations) are about 16 MB. */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

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
  /** Milliseconds on the monotonic clock below, not wall-clock time. */
  deadline: number;
  timestamp: string;
  fetch: typeof fetch;
};
const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
  stopNodes: ['*.ArticleTitle', '*.AbstractText', '*.BookTitle'],
});
// Pacing and the search deadline must not follow the wall clock, which can be stepped (time sync,
// sleep, manual changes). This clock only ever moves forward, by the time that really passed.
let elapsed = 0;
let lastTick = performance.now();
const monotonic = (): number => {
  const tick = performance.now();
  elapsed += Math.max(0, tick - lastTick);
  lastTick = tick;
  return elapsed;
};
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
// Named character references that occur in scholarly metadata: the HTML 4 set (Latin-1, Greek,
// mathematical and typographic symbols) plus the Latin Extended-A letters used in names.
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
const defineEntities = (first: number, names: string[]) =>
  names
    .join(' ')
    .split(' ')
    .forEach((name, index) => NAMED_ENTITIES.set(name, String.fromCharCode(first + index)));
const defineEntityCodes = (pairs: string[]) =>
  pairs
    .join(' ')
    .split(' ')
    .forEach((pair) => {
      const [name, hex] = pair.split(':');
      NAMED_ENTITIES.set(name, String.fromCodePoint(parseInt(hex, 16)));
    });
defineEntities(0xa0, [
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn',
  'sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave',
  'Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml',
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN',
  'szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute',
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml',
  'yacute thorn yuml',
]);
defineEntities(0x391, [
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho',
]);
defineEntities(0x3a3, ['Sigma Tau Upsilon Phi Chi Psi Omega']);
defineEntities(0x3b1, [
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf',
  'sigma tau upsilon phi chi psi omega',
]);
defineEntityCodes([
  'OElig:152 oelig:153 Scaron:160 scaron:161 Yuml:178 fnof:192 circ:2C6 tilde:2DC thetasym:3D1',
  'upsih:3D2 piv:3D6 ensp:2002 emsp:2003 thinsp:2009 zwnj:200C zwj:200D lrm:200E rlm:200F',
  'ndash:2013 mdash:2014 lsquo:2018 rsquo:2019 sbquo:201A ldquo:201C rdquo:201D bdquo:201E',
  'dagger:2020 Dagger:2021 bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033 lsaquo:2039',
  'rsaquo:203A oline:203E frasl:2044 euro:20AC image:2111 weierp:2118 real:211C trade:2122',
  'alefsym:2135 larr:2190 uarr:2191 rarr:2192 darr:2193 harr:2194 crarr:21B5 lArr:21D0 uArr:21D1',
  'rArr:21D2 dArr:21D3 hArr:21D4 forall:2200 part:2202 exist:2203 empty:2205 nabla:2207 isin:2208',
  'notin:2209 ni:220B prod:220F sum:2211 minus:2212 lowast:2217 radic:221A prop:221D infin:221E',
  'ang:2220 and:2227 or:2228 cap:2229 cup:222A int:222B there4:2234 sim:223C cong:2245 asymp:2248',
  'ne:2260 equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286 supe:2287 oplus:2295',
  'otimes:2297 perp:22A5 sdot:22C5 lceil:2308 rceil:2309 lfloor:230A rfloor:230B lang:27E8',
  'rang:27E9 loz:25CA spades:2660 clubs:2663 hearts:2665 diams:2666',
  'Amacr:100 amacr:101 Abreve:102 abreve:103 Aogon:104 aogon:105 Cacute:106 cacute:107 Ccirc:108',
  'ccirc:109 Cdot:10A cdot:10B Ccaron:10C ccaron:10D Dcaron:10E dcaron:10F Dstrok:110 dstrok:111',
  'Emacr:112 emacr:113 Edot:116 edot:117 Eogon:118 eogon:119 Ecaron:11A ecaron:11B Gcirc:11C',
  'gcirc:11D Gbreve:11E gbreve:11F Gdot:120 gdot:121 Gcedil:122 Hcirc:124 hcirc:125 Hstrok:126',
  'hstrok:127 Itilde:128 itilde:129 Imacr:12A imacr:12B Iogon:12E iogon:12F Idot:130 imath:131',
  'Jcirc:134 jcirc:135 Kcedil:136 kcedil:137 Lacute:139 lacute:13A Lcedil:13B lcedil:13C',
  'Lcaron:13D lcaron:13E Lstrok:141 lstrok:142 Nacute:143 nacute:144 Ncedil:145 ncedil:146',
  'Ncaron:147 ncaron:148 Omacr:14C omacr:14D Odblac:150 odblac:151 Racute:154 racute:155',
  'Rcedil:156 rcedil:157 Rcaron:158 rcaron:159 Sacute:15A sacute:15B Scirc:15C scirc:15D',
  'Scedil:15E scedil:15F Tcedil:162 tcedil:163 Tcaron:164 tcaron:165 Tstrok:166 tstrok:167',
  'Utilde:168 utilde:169 Umacr:16A umacr:16B Ubreve:16C ubreve:16D Uring:16E uring:16F',
  'Udblac:170 udblac:171 Uogon:172 uogon:173 Wcirc:174 wcirc:175 Ycirc:176 ycirc:177 Zacute:179',
  'zacute:17A Zdot:17B zdot:17C Zcaron:17D zcaron:17E',
]);
const decodeEntities = (value: string): string =>
  value.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (match, decimal?: string, hex?: string, name?: string) => {
      if (name) return NAMED_ENTITIES.get(name) ?? match;
      const point = decimal ? Number(decimal) : parseInt(hex!, 16);
      return point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)
        ? String.fromCodePoint(point)
        : '';
    },
  );
// Only real markup is removed. A tag is an element name (HTML, JATS, MathML or a publisher's
// prefixed element) with optional attribute="value" pairs, so "aged <18 months", "x < y" and
// "x<y and y>z" keep their characters.
const INLINE_TAGS = new Set(
  (
    'i b u em strong sub sup inf scp sc small big tt code cite abbr mark del ins font span a ' +
    'italic bold underline monospace roman strike overline named-content styled-content ' +
    'inline-formula ext-link email uri xref abbrev'
  ).split(' '),
);
const BLOCK_TAGS = new Set(
  (
    'p div br hr li ul ol dl dt dd h1 h2 h3 h4 h5 h6 title sec section abstract blockquote pre ' +
    'table thead tbody tr td th caption fig label list list-item break disp-formula'
  ).split(' '),
);
const TAG =
  /<\/?(?:([A-Za-z][\w.-]*):)?([A-Za-z][\w-]*)(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))*\s*\/?>/g;
// Publishers often indent a subscript onto its own line ("CO\n    <sub>2</sub>"); it still belongs
// to the text before it, so whitespace ahead of an opening sub/sup tag is dropped.
const OPENING_SCRIPT = '\u0001';
const SCRIPT_TAGS = new Set(['sub', 'sup', 'inf']);
const stripTags = (value: string, gap: string): string => {
  const stripped = value.replace(TAG, (tag, prefix: string | undefined, name: string) => {
    const local = name.toLowerCase();
    if (BLOCK_TAGS.has(local)) return gap;
    if (!prefix && !INLINE_TAGS.has(local)) return tag;
    return SCRIPT_TAGS.has(local) && !tag.startsWith('</') ? OPENING_SCRIPT : '';
  });
  return stripped.includes(OPENING_SCRIPT)
    ? stripped
        .split(OPENING_SCRIPT)
        .map((part, index, parts) => (index < parts.length - 1 ? part.trimEnd() : part))
        .join('')
    : stripped;
};
/**
 * Providers deliver markup in every state: real tags, entity-escaped tags and, for some Crossref
 * records, entities escaped twice ("&amp;nbsp;"). Tags go first, then entities are decoded (at
 * most twice) and tags revealed by decoding go as well. Inline tags leave no gap ("CO<sub>2</sub>"
 * is "CO2"); block tags become `gap`.
 */
const markup = (value: string, gap: string): string => {
  let out = stripTags(value, gap);
  for (let level = 0; level < 2; level++) {
    const decoded = decodeEntities(out);
    if (decoded === out) break;
    out = decoded.includes('<') ? stripTags(decoded, gap) : decoded;
  }
  return out;
};
const text = (value: any): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
  if (typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, item]) => text(item))
      .join(' ');
  return markup(String(value), ' ').replace(/\s+/g, ' ').trim();
};
const GENERIC_HEADING =
  /^\s*<(?:[\w.-]+:)?(?:title|h[1-6])(?:\s[^<>]*)?>\s*abstract\s*:?\s*<\/(?:[\w.-]+:)?(?:title|h[1-6])>/i;
/** Abstracts keep paragraphs apart (block markup and blank lines); single line breaks are wrapping. */
const paragraphs = (value: any): string =>
  typeof value !== 'string'
    ? text(value)
    : markup(value.replace(GENERIC_HEADING, ''), '\n\n')
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
const raw = (value: any): string =>
  value == null
    ? ''
    : Array.isArray(value)
      ? raw(value.find((item) => raw(item)))
      : typeof value === 'object'
        ? raw(value['#text'])
        : String(value);
/** Identifiers (DOIs, URLs, provider ids) are decoded but never treated as markup: DOIs contain < and >. */
const ident = (value: any): string => decodeEntities(raw(value)).trim();
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
/**
 * A provider's DOI field. OpenAlex sends doi.org links; the resolver prefix is removed as text, not
 * read as a link, so a DOI that ends in "#" (Wiley "…;2-#") is not cut as a link fragment.
 */
const doi = (value: any): string => normalizeDoi(ident(value).replace(DOI_RESOLVER, ''));
const safeUrl = (value: any): string => {
  try {
    const url = new URL(ident(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
};
const DOI_RESOLVER = /^https?:\/\/(?:dx\.)?doi\.org\//i;
const quoted = (value: string) => `"${value.replace(/["\\]/g, ' ').trim()}"`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Screens candidate bylines against the typed name. A typed given name must agree with the
 * candidate's (initials and omitted middle names are fine); a lone surname matches any byline
 * with that surname. Without a comma the surname may have been typed first ("Wang Xiao Ming"), so
 * a byline with that surname and the same given names is kept too, however the syllables are
 * spaced, but never one that matches only through initials or a different given name. A surname
 * typed alone with a particle that can also be a given name ("Van Dijk", "Das Gupta") keeps the
 * bylines whose surname is exactly those words.
 */
function authorScreen(wanted: string): (candidate: string) => boolean {
  // "van der Berg" has no given name, but it parses as given "van" + family, so spot it by form.
  const surnameOnly =
    nameKeys(wanted).every((key) => !key.includes(':')) ||
    /^(?:\p{Ll}+\s+)+\p{Lu}\S*$/u.test(wanted.trim());
  const words = wanted.trim().split(/\s+/);
  const surnameFirst = !wanted.includes(',') && words.length > 1;
  const particleSurname = surnameFirst && words.length === 2 && isParticle(words[0]);
  return (candidate) =>
    surnameOnly
      ? sameFamily(wanted, candidate)
      : nameMatch(wanted, candidate) !== null ||
        (surnameFirst && surnameFirstMatch(wanted, candidate)) ||
        (particleSurname && hasSurname(candidate, wanted));
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
  const normalized = input.mode === 'doi' ? normalizeDoi(ident(input.text)) : input.text.trim();
  if (input.mode === 'doi' && !/^10\.\d{4,9}\/\S+$/i.test(normalized))
    throw new Error('Enter a complete DOI, such as 10.1038/nature12373, or paste a doi.org link.');
  return { ...input, text: normalized, sources: [...new Set(input.sources)] as ApiSourceId[] };
}

class SourceError extends Error {}
const tooLarge = () =>
  new SourceError(
    'The source response was too large to process. Lower the number of results or narrow the search.',
  );
/** Reads a provider body, refusing more than MAX_RESPONSE_BYTES instead of buffering it. */
async function readText(response: Response): Promise<string> {
  if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) throw tooLarge();
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    body += decoder.decode(value, { stream: true });
  }
}
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
  const send = ctx.fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = ctx.result.source;
    const now = monotonic();
    const start = Math.max(now, nextRequest.get(source) ?? 0);
    if (start >= ctx.deadline)
      throw new SourceError('Search timed out. Narrow the query or retry this source.');
    nextRequest.set(source, start + intervals[source]);
    if (start > now) await delay(start - now);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(15000, ctx.deadline - monotonic())),
    );
    try {
      const response = await send(url, {
        signal: controller.signal,
        headers: {
          Accept: format === 'xml' ? 'application/xml, application/atom+xml' : 'application/json',
          'User-Agent': `AcademicPublicationTracker/${APP_VERSION}`,
          ...headers,
        },
        redirect: 'error',
      });
      if (response.status === 404)
        throw new SourceError('No matching record was found in this source.');
      if (response.status === 429 || response.status >= 500) {
        const retryHeader = response.headers.get('retry-after');
        const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
        const requestedMs = Number.isFinite(retrySeconds)
          ? retrySeconds * 1000
          : Date.parse(retryHeader ?? '') - Date.now();
        // A missing or unparsable Retry-After still gets the single retry, after the default wait.
        const retryMs = Number.isFinite(requestedMs) ? requestedMs : 1500;
        // A long server-requested wait is surfaced to the user instead of retrying early.
        if (
          attempt === 0 &&
          retryMs <= 5000 &&
          monotonic() + Math.max(1500, retryMs) < ctx.deadline
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
      const body = await readText(response);
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

/**
 * Builds the stored record. Records that cannot be identified (no provider id) are dropped, and so
 * are untitled ones outside DOI lookups; everything else is clamped to the workspace limits.
 */
function work(ctx: Context, sourceId: string, fields: Partial<Work>): Work | null {
  const title = text(fields.title);
  if (!sourceId || (!title && ctx.query.mode !== 'doi')) return null;
  const normalizedDoi = doi(fields.doi);
  // DOI resolver links are rebuilt from the DOI: read as a URL, "…;2-#" silently loses its "#".
  const link = safeUrl(fields.url);
  const url = normalizedDoi && (!link || DOI_RESOLVER.test(link)) ? doiUrl(normalizedDoi) : link;
  const citations = count(fields.citations);
  const type = text(fields.type) || 'publication';
  return clampWork({
    id: `${ctx.result.source}:${sourceId}`,
    title: title || 'Untitled record',
    authors: (fields.authors ?? []).map(text).filter(Boolean),
    ...(fields.authorsComplete === undefined ? {} : { authorsComplete: fields.authorsComplete }),
    ...(fields.citationHistory ? { citationHistory: fields.citationHistory } : {}),
    year: year(fields.year),
    venue: text(fields.venue),
    doi: normalizedDoi,
    abstract: paragraphs(fields.abstract),
    type,
    url,
    openAccessUrl: safeUrl(fields.openAccessUrl),
    isOpenAccess: fields.isOpenAccess === true,
    citations,
    provenance: [
      { source: ctx.result.source, sourceId, citations, retrievedAt: ctx.timestamp, url },
    ],
    // Notices, peer-review reports, grants, journal issues and components are kept but not counted.
    included: isPublicationKind(workKind(type)),
    tags: [],
    notes: '',
  });
}

function add(ctx: Context, records: (Work | null)[], keep: (item: Work) => boolean = () => true) {
  const { query, result } = ctx;
  for (const item of records) {
    if (result.works.length >= query.limit) break;
    if (!item) continue;
    if (query.mode === 'doi' && item.doi !== query.text) continue;
    if (query.yearFrom && (item.year == null || item.year < query.yearFrom)) continue;
    if (query.yearTo && (item.year == null || item.year > query.yearTo)) continue;
    if (!keep(item)) continue;
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
  const screen = q.mode === 'author' ? authorScreen(q.text) : undefined;
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
    // Repeated type filters are OR-ed; without them issues, reviews and components eat the limit.
    const filter = [
      q.yearFrom && `from-pub-date:${q.yearFrom}-01-01`,
      q.yearTo && `until-pub-date:${q.yearTo}-12-31`,
      ...(preprintsOnly ? ['posted-content'] : CROSSREF_PUBLICATION_TYPES).map(
        (type) => `type:${type}`,
      ),
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
    add(ctx, normalized, screen && ((item) => item.authors.some(screen)));
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
      .map((a: RecordData) => ident(a.id).split('/').pop() ?? '')
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
        // Author IDs identify the person precisely, so take the most cited works first: a limited
        // retrieval then keeps the papers that define the h-index instead of an arbitrary subset.
        sort: q.mode === 'author' ? 'cited_by_count:desc' : undefined,
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
        work(ctx, ident(item.id).split('/').pop()!, {
          title: item.display_name,
          authors: array(item.authorships).map((a) => a.author?.display_name || a.raw_author_name),
          authorsComplete: array(item.authorships).length < 100,
          year: item.publication_year,
          venue: item.primary_location?.source?.display_name,
          doi: item.doi,
          abstract: invertedAbstract(item.abstract_inverted_index),
          type: item.type,
          url: item.primary_location?.landing_page_url || item.id,
          openAccessUrl: item.best_oa_location?.pdf_url || item.open_access?.oa_url,
          isOpenAccess: item.open_access?.is_oa === true,
          citations: item.cited_by_count,
          ...(Array.isArray(item.counts_by_year)
            ? {
                citationHistory: array(item.counts_by_year).flatMap((r) => {
                  const y = year(r.year);
                  const citations = count(r.cited_by_count);
                  return y !== null && citations !== null
                    ? [{ year: y, citations, source: 'openalex' as const }]
                    : [];
                }),
              }
            : {}),
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
      ? `(${nameVariants(q.text)
          .map((name) => `AUTH:${quoted(name)}`)
          .join(' OR ')})`
      : q.mode === 'doi'
        ? `DOI:${quoted(q.text)}`
        : `(${q.text})`;
  if (preprintsOnly) search = `(${search}) AND SRC:PPR`;
  // PUB_YEAR is the year the records report (`pubYear`) and the app filters by; FIRST_PDATE can
  // differ by a year at the boundaries, which dropped those records from every search.
  if (q.yearFrom || q.yearTo)
    search += ` AND PUB_YEAR:[${q.yearFrom ?? 1500} TO ${q.yearTo ?? new Date().getFullYear() + 1}]`;
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
          const source = ident(item.source);
          const id = ident(item.id);
          return work(ctx, source && id ? `${source}:${id}` : '', {
            title: item.title,
            // `fullName` is Vancouver style ("Reich NG"); build "Given Family" when both are known.
            authors: item.authorList?.author
              ? array(item.authorList.author).map((a) =>
                  a.firstName && a.lastName
                    ? `${a.firstName} ${a.lastName}`
                    : a.fullName || a.collectiveName,
                )
              : text(item.authorString).split(', ').filter(Boolean),
            year: item.pubYear,
            venue: item.journalInfo?.journal?.title || item.bookOrReportDetails?.publisher,
            doi: item.doi,
            abstract: item.abstractText,
            type: cleanPublicationTypes(array(item.pubTypeList?.pubType).map(text)),
            url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
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
      ? `(${nameVariants(q.text)
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
        const pmcId = ident(identifiers.find((id) => id['@_IdType'] === 'pmc'));
        const pmid = ident(citation.PMID);
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
            ident(doiId) ||
            ident(array(article.ELocationID).find((id) => id['@_EIdType'] === 'doi')),
          // Structured abstracts keep their section labels ("BACKGROUND: …") and paragraph breaks.
          abstract: array(article.Abstract?.AbstractText)
            .map((value) => {
              const label = text(value?.['@_Label']);
              return label && !/^unlabell?ed$/i.test(label)
                ? `${label}: ${text(value)}`
                : text(value);
            })
            .filter(Boolean)
            .join('\n\n'),
          type: cleanPublicationTypes(
            array(article.PublicationTypeList?.PublicationType).map(text),
          ),
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
    work(ctx, ident(item.paperId), {
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
      type: cleanPublicationTypes(array(item.publicationTypes).map(text)),
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
    const candidates = authors.data.filter((a: RecordData) => /^\d+$/.test(ident(a.authorId)));
    if (!candidates.length) {
      result.total = 0;
      return;
    }
    result.warning = `Candidate works from up to five matching author profiles (${candidates.map((a: RecordData) => text(a.name)).join('; ')}). Results are sampled across profiles; verify identity and refine the name if needed.`;
    // Ask the API for the year range: profiles hold hundreds of papers and pages are sequential.
    const years = q.yearFrom || q.yearTo ? `${q.yearFrom ?? ''}:${q.yearTo ?? ''}` : undefined;
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
          { fields, limit, offset: profile.offset, publicationDateOrYear: years },
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
        // The API documents that hyphenated terms match nothing: "COVID-19" is sent as "COVID 19".
        query: q.text.replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, ' '),
        fields,
        limit,
        offset,
        year:
          q.yearFrom || q.yearTo
            ? q.yearFrom === q.yearTo
              ? q.yearFrom
              : `${q.yearFrom ?? ''}-${q.yearTo ?? ''}`
            : undefined,
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

/** "2304.02643v2" and "2304.02643" are one preprint: identify it without the version. */
const arxivId = (item: RecordData): string =>
  ident(item.id)
    .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
    .replace(/v\d+$/, '');

async function arxiv(ctx: Context) {
  const { query: q, result } = ctx;
  if (q.mode === 'doi') {
    // The documented arXiv API has no DOI search field. Avoid pretending free-text matching is DOI lookup.
    result.warning =
      'arXiv’s documented API does not support exact DOI lookup. Search by topic or author instead.';
    return;
  }
  // Words without a letter or digit ("&", "-") match nothing and would empty the whole result.
  const words = q.text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (q.mode === 'topic' && !words.length) {
    result.total = 0;
    result.warning = 'arXiv needs at least one word or number to search for.';
    return;
  }
  let search =
    q.mode === 'author'
      ? `au:${quoted(q.text)}`
      : words.map((word) => `all:${quoted(word)}`).join(' AND ');
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
    if (entries.some((item) => ident(item.id).includes('/api/errors')))
      throw new SourceError('arXiv could not interpret this query. Try simpler search terms.');
    result.total = count(data.feed.totalResults);
    add(
      ctx,
      entries.map((item) =>
        work(ctx, arxivId(item), {
          title: item.title,
          authors: array(item.author).map((a) => a.name),
          year: year(item.published),
          venue: item.journal_ref || 'arXiv',
          doi: item.doi,
          abstract: item.summary,
          type: 'preprint',
          url: ident(item.id)
            .replace(/^http:/, 'https:')
            .replace(/v\d+$/, ''),
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

/**
 * DataCite searches with Lucene syntax, where ":" selects a field and "-", "(", "&&" … are
 * operators, so a title such as "Deep learning: a review" finds nothing and a stray quote is a
 * syntax error. Specials are escaped so punctuation is searched as text; a balanced "quoted
 * phrase" still works as a phrase. "/" is replaced by a space: it separates words in the index,
 * and the API rejects the escaped form. "<" and ">" start range queries and cannot be escaped, so
 * they become spaces too.
 */
function luceneText(value: string): string {
  const escape = (plain: string) =>
    plain.replace(/[/<>]/g, ' ').replace(/[\\+\-=!(){}[\]^"~*?:&|]/g, '\\$&');
  const parts = value.split('"');
  if (parts.length % 2 === 0) return parts.map(escape).join('\\"');
  return parts
    .map((part, index) => (index % 2 ? `"${part.replace(/\\/g, '\\\\')}"` : escape(part)))
    .join('');
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
      ? `(${nameVariants(q.text)
          .map((name) => `creators.name:${quoted(name)}`)
          .join(' OR ')})`
      : `(${luceneText(q.text)})`;
  if (q.yearFrom || q.yearTo)
    search += ` AND publicationYear:[${q.yearFrom ?? 1500} TO ${q.yearTo ?? new Date().getFullYear() + 1}]`;
  // Keep page size fixed: changing it on numbered pages would skip or repeat records.
  const pageSize = q.mode === 'author' ? 100 : Math.min(100, q.limit);
  let scanned = 0;
  const screen = q.mode === 'author' ? authorScreen(q.text) : undefined;
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
    add(ctx, records, screen && ((item) => item.authors.some(screen)));
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
  /** `fetch` lets the desktop app route provider calls through the operating system's network stack. */
  options: { fetch?: typeof fetch } = {},
): Promise<SearchResponse> {
  const query = validate(input);
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const value = suppliedSettings?.[key];
    if (typeof value === 'string' && value.length <= 1000 && !/[\r\n]/.test(value))
      settings[key] = value.trim();
  }
  const searchedAt = new Date().toISOString();
  const deadline = monotonic() + 60000;
  const send = options.fetch ?? globalThis.fetch;
  const results = await Promise.all(
    query.sources.map(async (source) => {
      const result: SourceResult & { source: ApiSourceId } = { source, works: [], total: null };
      if (query.mode === 'author')
        result.warning =
          'Author-name matches can include namesakes and omit name variants. Review and exclude unrelated papers before interpreting metrics.';
      try {
        await connectors[source]({
          query,
          settings,
          result,
          deadline,
          timestamp: searchedAt,
          fetch: send,
        });
      } catch (error) {
        result.error =
          error instanceof SourceError
            ? error.message
            : 'This source returned an unexpected response. Try again later.';
      }
      const excluded = result.works.filter((item) => !item.included).length;
      if (excluded)
        result.warning = [
          result.warning,
          `${excluded} ${excluded === 1 ? 'record' : 'records'} (errata and notices, peer-review reports, grants, journal issues or supplementary files) ${excluded === 1 ? 'was' : 'were'} excluded by default. They stay in this snapshot; review or include them with the Excluded filter.`,
        ]
          .filter(Boolean)
          .join(' ');
      if (result.error && result.works.length)
        result.warning = [result.warning, 'Only the records retrieved before the error are shown.']
          .filter(Boolean)
          .join(' ');
      return result;
    }),
  );
  return { results, searchedAt };
}

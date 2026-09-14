import type { SearchQuery, Work } from '../types';
import { normalizeDoi } from './merge';

export function buildScholarUrl(query: SearchQuery): string {
  if (!query || typeof query.text !== 'string' || !query.text.trim())
    throw new Error('Enter a Google Scholar search.');
  const text = query.text.trim();
  if (text.length > 500)
    throw new Error('Google Scholar searches must be 500 characters or fewer.');
  if (!['topic', 'author', 'doi'].includes(query.mode))
    throw new Error('Choose a supported Google Scholar search mode.');
  if (!Array.isArray(query.sources) || query.sources.length !== 1 || query.sources[0] !== 'scholar')
    throw new Error('Search Google Scholar separately from API sources.');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)
    throw new Error('Choose a result limit between 1 and 200.');
  const maxYear = new Date().getFullYear() + 1;
  for (const year of [query.yearFrom, query.yearTo]) {
    if (year !== undefined && (!Number.isInteger(year) || year < 1500 || year > maxYear))
      throw new Error(`Publication years must be whole numbers between 1500 and ${maxYear}.`);
  }
  if (query.yearFrom !== undefined && query.yearTo !== undefined && query.yearFrom > query.yearTo)
    throw new Error('The start year must be no later than the end year.');
  const url = new URL('https://scholar.google.com/scholar');
  url.searchParams.set('hl', 'en');
  let search = text;
  if (query.mode === 'author') {
    // Keep case-only variants identical at the provider boundary; the saved query
    // retains the user's spelling. Topic operators and DOI handling are unchanged.
    const author = text
      .normalize('NFC')
      .replace(/["\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!author) throw new Error('Enter an author name.');
    search = `author:"${author}"`;
  }
  if (query.mode === 'doi') {
    const doi = normalizeDoi(text);
    if (!doi) throw new Error('Enter a valid DOI, such as 10.1234/example.');
    search = `"${doi}"`;
  }
  url.searchParams.set('q', search);
  if (query.yearFrom !== undefined) url.searchParams.set('as_ylo', String(query.yearFrom));
  if (query.yearTo !== undefined) url.searchParams.set('as_yhi', String(query.yearTo));
  return url.href;
}

// Executed during a user-requested search in the isolated Scholar window.
// This script reads the rendered page; it makes no requests and never clicks or paginates.
export const SCHOLAR_CAPTURE_SCRIPT = String.raw`(() => {
  const clean = (value, max = 2000) => typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const visible = (node) => {
    if (!node || !node.getClientRects().length) return false;
    for (let element = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.hidden || style.display === 'none' || style.visibility === 'hidden'
        || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  };
  const content = (node, max = 2000) => node && visible(node) ? clean(node.innerText, max) : '';
  const href = (node) => {
    try {
      if (!node || !visible(node)) return '';
      const target = node.getAttribute('href');
      if (!target) return '';
      const url = new URL(target, location.href);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href.slice(0, 8000) : '';
    } catch { return ''; }
  };
  const displayed = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);
  const result = { version: 1, url: location.href, title: clean(document.title),
    status: 'unsupported', records: [], truncated: false, nextUrl: null, interactiveVerification: false, estimatedTotal: null };
  const pageText = content(document.body, 20000);
  const captchaControls = displayed('#captcha-form input:not([type="hidden"]), #gs_captcha_ccl input:not([type="hidden"]), .g-recaptcha, iframe[src*="recaptcha"], form[action*="/sorry/"] input:not([type="hidden"])').length > 0;
  if (displayed('#captcha-form, #gs_captcha_ccl, .g-recaptcha, iframe[src*="recaptcha"], form[action*="/sorry/"]').length
    || /our systems have detected unusual traffic|to continue, please type the characters below|please show you're not a robot/i.test(pageText)) {
    result.status = 'captcha'; result.interactiveVerification = captchaControls; return result;
  }
  if (/^sign in\b/i.test(document.title) || displayed('input[type="password"]').length
    || location.hostname === 'accounts.google.com') {
    result.status = 'login';
    const usable = (control) => visible(control) && !control.matches(':disabled') && !control.readOnly
      && !control.closest('[inert], [aria-disabled="true"]') && getComputedStyle(control).pointerEvents !== 'none';
    const loginInputs = displayed('input[type="password"], input[type="email"], input[name="identifier"], input[name="Passwd"], input[name="totpPin"], input[name="idvPin"]').some(usable);
    const accountChoices = location.hostname === 'accounts.google.com'
      && displayed('[role="link"][data-identifier], [role="button"][data-identifier], button[data-identifier], [role="link"][data-email], [role="button"][data-email], button[data-email]')
        .some((control) => usable(control) && clean(control.getAttribute('data-identifier') || control.getAttribute('data-email'), 300));
    // The accounts host also serves refusal/error pages; its hostname alone is not a usable challenge.
    result.interactiveVerification = loginInputs || accountChoices;
    return result;
  }
  if (location.origin !== 'https://scholar.google.com'
    || !['/scholar', '/citations'].includes(location.pathname)) return result;
  if (/service unavailable|too many requests|access denied|^error\b/i.test(document.title)
    || /sorry, we can't complete your request|your client does not have permission/i.test(pageText)) {
    result.status = 'unavailable'; return result;
  }
  const profile = location.pathname === '/citations';
  const rows = displayed(profile ? '.gsc_a_tr' : '.gs_r.gs_or');
  result.truncated = rows.length > 200;
  const year = (value) => {
    const match = value.match(/\b(1\d{3}|2\d{3})\b/);
    return match ? Number(match[1]) : null;
  };
  for (const row of rows.slice(0, 200)) {
    const heading = row.querySelector(profile ? '.gsc_a_at' : '.gs_rt');
    const link = profile ? heading : heading && heading.querySelector('a');
    const headingText = content(heading);
    const title = (content(link) || headingText).replace(/^\[(?:CITATION|BOOK|PDF|HTML)\]\s*/i, '');
    if (!title) continue;
    let authorsText = '', venue = '', publicationYear = null, citationText = null;
    let sourceId = clean(row.getAttribute('data-cid'), 256);
    if (profile) {
      const gray = Array.from(row.querySelectorAll('.gs_gray')).filter(visible);
      authorsText = content(gray[0]);
      venue = content(gray[1]);
      publicationYear = year(content(row.querySelector('.gsc_a_y')));
      citationText = content(row.querySelector('.gsc_a_c')) || null;
      try { sourceId = new URL(href(link)).searchParams.get('citation_for_view') || sourceId; } catch {}
    } else {
      const metadata = content(row.querySelector('.gs_a'));
      const parts = metadata.split(/\s+[-–−]\s+/);
      authorsText = parts[0] || '';
      const publication = parts[1] || '';
      publicationYear = year(publication);
      venue = publication.replace(/(?:,\s*)?\b(?:1\d{3}|2\d{3})\b.*$/, '').trim();
      const citation = Array.from(row.querySelectorAll('.gs_fl a[href]')).find((node) => {
        try { return visible(node) && new URL(href(node)).searchParams.has('cites'); } catch { return false; }
      });
      citationText = content(citation) || null;
      if (!sourceId && citation) {
        try { sourceId = new URL(href(citation)).searchParams.get('cites') || ''; } catch {}
      }
    }
    const authors = authorsText.split(/,\s*/).map((name) => clean(name.replace(/(?:\.{3}|…).*$/, '')
      .replace(/\bet al\.?\s*$/i, ''), 300)).filter(Boolean).slice(0, 100);
    result.records.push({ sourceId: clean(sourceId, 256), title, authors, year: publicationYear,
      venue, snippet: profile ? '' : content(row.querySelector('.gs_rs'), 10000),
      url: href(link), citationText,
      type: /^\[CITATION\]/i.test(headingText) ? 'citation' : /^\[BOOK\]/i.test(headingText) ? 'book' : 'publication' });
  }
  result.status = result.records.length ? (profile ? 'profile' : 'results')
    : /did not match any articles|no articles found|no publications|no results found|no articles to display/i.test(pageText) ? 'empty' : 'unsupported';
  if (result.status === 'results') {
    const estimate = content(document.querySelector('#gs_ab_md'), 300).match(/\b([\d,]+)\s+results?\b/i);
    if (estimate) {
      const total = Number(estimate[1].replace(/,/g, ''));
      if (Number.isSafeInteger(total) && total >= 0 && total <= 1000000000) result.estimatedTotal = total;
    }
    const next = displayed('#gs_n a[href], a[href][aria-label="Next"], a[href][rel~="next"]').find((link) =>
      link.matches('[aria-label="Next"], [rel~="next"]') || visible(link.querySelector('.gs_ico_nav_next'))
      || /^Next$/i.test(content(link, 100)));
    if (next) {
      const target = next.getAttribute('href');
      try {
        // Keep explicit authority spelling so validation can reject even default ports.
        result.nextUrl = target.startsWith('//') ? location.protocol + target
          : /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : new URL(target, location.href).href;
      }
      catch { result.nextUrl = target; }
    }
  }
  return result;
})()`;

// Navigation completion can precede result rendering. Read only the current page;
// allow initial rendering, then require stable records and navigation before returning.
export const SCHOLAR_SETTLED_CAPTURE_SCRIPT = `new Promise((resolve) => {
  const started = performance.now();
  let changedAt = started, previous = '';
  const read = () => {
    const page = ${SCHOLAR_CAPTURE_SCRIPT};
    const now = performance.now(), signature = JSON.stringify(page);
    if (signature !== previous) { previous = signature; changedAt = now; }
    const supported = ['results', 'empty', 'captcha', 'login', 'unavailable'].includes(page.status);
    const settled = document.readyState === 'complete' && supported
      && now - started >= 1500 && now - changedAt >= 500;
    if (settled || now - started >= 5000) resolve({ ...page, settled });
    else setTimeout(read, 100);
  };
  read();
})`;

/** Accept only the next link actually supplied by a results page from the same search. */
export function getScholarNextUrl(
  raw: unknown,
  currentUrl: string,
  initialUrl: string,
): string | null {
  const page = record(raw);
  // Profile lists have a different loading mechanism; never infer their navigation.
  if (page.status === 'profile') return null;
  const fail = (detail: string): never => {
    throw new Error(
      `Google Scholar pagination stopped: ${detail}. Already retrieved results can be kept.`,
    );
  };
  if (page.version !== 1 || !['results', 'empty'].includes(String(page.status)))
    return fail('the results page could not be verified');
  const parse = (value: unknown): URL => {
    if (
      typeof value !== 'string' ||
      value.length > 8000 ||
      value !== value.trim() ||
      !/^https:\/\/scholar\.google\.com\//i.test(value)
    )
      return fail('a page address is not an approved Google Scholar results URL');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fail('a page address is malformed');
    }
    if (
      url.origin !== 'https://scholar.google.com' ||
      url.pathname !== '/scholar' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return fail('a page address is not an approved Google Scholar results URL');
    for (const key of ['q', 'as_ylo', 'as_yhi', 'start']) {
      if (url.searchParams.getAll(key).length > 1)
        return fail('a page address contains ambiguous search parameters');
    }
    if (!url.searchParams.get('q')?.trim())
      return fail('a page address is missing the original query');
    return url;
  };
  const initial = parse(initialUrl);
  const current = parse(currentUrl);
  const displayed = parse(page.url);
  if (displayed.href !== current.href) return fail('the displayed page changed during retrieval');
  const sameSearch = (url: URL) => {
    for (const key of ['q', 'as_ylo', 'as_yhi']) {
      if ((url.searchParams.get(key) ?? '') !== (initial.searchParams.get(key) ?? ''))
        return fail('a page link changes the original query or publication-year filters');
    }
  };
  const offset = (url: URL) => {
    const value = url.searchParams.get('start') ?? '0';
    if (!/^(?:0|[1-9]\d{0,2})$/.test(value) || Number(value) >= 200)
      return fail('a page offset is invalid or exceeds the 200-result limit');
    return Number(value);
  };
  sameSearch(current);
  const currentStart = offset(current);
  if (currentStart < offset(initial)) return fail('a page link returns to an earlier page');
  if (page.nextUrl === null || page.nextUrl === undefined) return null;
  if (page.status !== 'results') return fail('an empty page unexpectedly offers another page');
  const next = parse(page.nextUrl);
  sameSearch(next);
  if (offset(next) <= currentStart) return fail('the next-page link does not advance the search');
  return next.href;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'Google Scholar returned an unreadable page. Open a results or author page and try again.',
    );
  return value as Record<string, unknown>;
}
const text = (value: unknown, max = 2000): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function safeUrl(value: unknown): string {
  try {
    const candidate = text(value, 8000);
    if (typeof value !== 'string' || value.length > 8000) return '';
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function citationCount(value: unknown): number | null {
  const count = text(value, 100).replace(/^Cited by\s+/i, '');
  if (!/^(?:\d+|\d{1,3}(?:[, ]\d{3})+)$/.test(count)) return null;
  const parsed = Number(count.replace(/[, ]/g, ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function fallbackId(title: string, year: number | null, authors: string[], url: string): string {
  let hash = 2166136261;
  for (const character of JSON.stringify([title.toLowerCase(), year, authors, url])) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `record-${(hash >>> 0).toString(16)}`;
}

export function normalizeScholarPage(
  value: unknown,
  retrievedAt = new Date().toISOString(),
): { works: Work[]; url: string; warning: string } {
  const page = record(value);
  if (page.status === 'login')
    throw new Error(
      'Google Scholar is showing a sign-in page. Complete sign-in in the Scholar window to continue retrieval.',
    );
  if (page.status === 'captcha')
    throw new Error(
      'Google Scholar is showing a CAPTCHA or unusual-traffic check. If a verification control is available, complete it yourself in the Scholar window to continue retrieval.',
    );
  const sourceUrl = safeUrl(page.url);
  const url = sourceUrl ? new URL(sourceUrl) : null;
  if (
    !url ||
    url.origin !== 'https://scholar.google.com' ||
    !['/scholar', '/citations'].includes(url.pathname)
  )
    throw new Error(
      'Retrieval is available only on public Google Scholar results or author pages at scholar.google.com.',
    );
  if (page.status === 'unavailable')
    throw new Error('Google Scholar is unavailable or has refused this request. Try again later.');
  if (page.status === 'empty')
    throw new Error(
      'There are no displayed publications to retrieve. Change the search or open an author profile.',
    );
  if (
    page.version !== 1 ||
    !['results', 'profile'].includes(String(page.status)) ||
    !Array.isArray(page.records) ||
    (page.status === 'profile') !== (url.pathname === '/citations')
  )
    throw new Error(
      'This Google Scholar page is not supported. Open a search results page or an author publication list.',
    );
  if (typeof retrievedAt !== 'string' || Number.isNaN(Date.parse(retrievedAt)))
    throw new Error('The capture time is invalid.');
  const works: Work[] = [];
  const identifiers = new Set<string>();
  for (const value of page.records.slice(0, 200)) {
    const item = record(value);
    const title = text(item.title);
    if (!title) continue;
    const authors = Array.isArray(item.authors)
      ? item.authors
          .slice(0, 100)
          .map((author) => text(author, 300))
          .filter(Boolean)
      : [];
    const year =
      typeof item.year === 'number' &&
      Number.isInteger(item.year) &&
      item.year >= 1500 &&
      item.year <= new Date().getFullYear() + 1
        ? item.year
        : null;
    const workUrl = safeUrl(item.url);
    const sourceId = text(item.sourceId, 256) || fallbackId(title, year, authors, workUrl);
    if (identifiers.has(sourceId)) continue;
    identifiers.add(sourceId);
    const citations = citationCount(item.citationText);
    let doi = '';
    if (workUrl) {
      const link = new URL(workUrl);
      if (['doi.org', 'dx.doi.org'].includes(link.hostname)) doi = normalizeDoi(workUrl);
    }
    works.push({
      id: `scholar:${sourceId}`,
      title,
      authors,
      year,
      venue: text(item.venue),
      doi,
      abstract: '',
      snippet: text(item.snippet, 10000),
      type: ['book', 'citation'].includes(String(item.type)) ? String(item.type) : 'publication',
      url: workUrl,
      openAccessUrl: '',
      isOpenAccess: false,
      citations,
      provenance: [{ source: 'scholar', sourceId, citations, retrievedAt, url: sourceUrl }],
      included: true,
      tags: [],
      notes: '',
    });
  }
  if (!works.length)
    throw new Error(
      'There are no displayed publications to retrieve. Open a search results page or an author publication list.',
    );
  const warning =
    (page.truncated || page.records.length > 200
      ? 'Only the first 200 displayed publications on this page were retrieved. '
      : 'Only publications on the retrieved pages are included; this may be an incomplete bibliography. ') +
    'Google Scholar may abbreviate author lists and snippets. Missing citation counts remain unknown.';
  return { works, url: sourceUrl, warning };
}

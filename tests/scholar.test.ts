import { describe, expect, it } from 'vitest';
import { buildScholarUrl, getScholarNextUrl, normalizeScholarPage } from '../src/core/scholar';
import { calculateMetrics } from '../src/core/metrics';
import type { SearchQuery } from '../src/types';

const query: SearchQuery = {
  text: 'epidemic forecasting',
  mode: 'topic',
  sources: ['scholar'],
  limit: 25,
};
const capturedAt = '2026-09-14T15:30:00.000Z';
const pageUrl = 'https://scholar.google.com/scholar?hl=en&q=epidemic+forecasting';
const publication = {
  sourceId: 'cluster123',
  title: 'Prospective evaluation of epidemic forecasts',
  authors: ['J Scholar', 'A Researcher'],
  year: 2023,
  venue: 'Forecasting Research',
  snippet: 'A displayed search snippet.',
  url: 'https://doi.org/10.1234/example',
  citationText: 'Cited by 1,234',
};
const capture = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  url: pageUrl,
  title: 'Google Scholar',
  status: 'results',
  records: [publication],
  truncated: false,
  nextUrl: null,
  ...overrides,
});

describe('Google Scholar next-page validation', () => {
  const nextUrl = `${pageUrl}&start=10`;
  const advance = (next: unknown, current = pageUrl, initial = pageUrl) =>
    getScholarNextUrl(capture({ url: current, nextUrl: next }), current, initial);

  it('accepts the actual forward link and preserves harmless provider navigation parameters', () => {
    expect(advance(`${nextUrl}&as_sdt=0,44&scisbd=1`)).toBe(`${nextUrl}&as_sdt=0,44&scisbd=1`);
    const current = `${pageUrl}&start=180`;
    expect(advance(`${pageUrl}&start=190`, current)).toBe(`${pageUrl}&start=190`);
  });

  it('returns null without an actual next link and never infers profile pagination', () => {
    expect(advance(null)).toBeNull();
    expect(advance(undefined)).toBeNull();
    expect(
      getScholarNextUrl(
        capture({
          status: 'profile',
          url: 'https://scholar.google.com/citations?user=author',
          nextUrl,
        }),
        'https://scholar.google.com/citations?user=author',
        pageUrl,
      ),
    ).toBeNull();
    expect(getScholarNextUrl(capture({ status: 'empty' }), pageUrl, pageUrl)).toBeNull();
  });

  it.each([
    'http://scholar.google.com/scholar?q=epidemic+forecasting&start=10',
    'https://scholar.google.com.evil.example/scholar?q=epidemic+forecasting&start=10',
    'https://scholar.google.com:443/scholar?q=epidemic+forecasting&start=10',
    'https://scholar.google.com:8443/scholar?q=epidemic+forecasting&start=10',
    'https://user:password@scholar.google.com/scholar?q=epidemic+forecasting&start=10',
    'https://scholar.google.com/citations?q=epidemic+forecasting&start=10',
    'https://scholar.google.com/sorry/?q=epidemic+forecasting&start=10',
    '/scholar?q=epidemic+forecasting&start=10',
    'javascript:alert(1)',
    '',
    `${nextUrl}#changed`,
    { href: nextUrl },
  ])('rejects malformed or unapproved navigation %j', (next) => {
    expect(() => advance(next)).toThrow(/pagination stopped/);
  });

  it.each([
    `${pageUrl}&start=0`,
    pageUrl,
    `${pageUrl}&start=-10`,
    `${pageUrl}&start=10.5`,
    `${pageUrl}&start=1e2`,
    `${pageUrl}&start=010`,
    `${pageUrl}&start=200`,
    `${pageUrl}&start=9999999`,
    `${pageUrl}&start=10&start=20`,
  ])('rejects non-forward, ambiguous, or unbounded offsets %s', (next) => {
    expect(() => advance(next)).toThrow(/pagination stopped/);
  });

  it('rejects changed or duplicate queries and publication-year filters', () => {
    const initial = `${pageUrl}&as_ylo=2020&as_yhi=2025`;
    expect(advance(`${initial}&start=10`, initial, initial)).toBe(`${initial}&start=10`);
    for (const next of [
      nextUrl,
      `${pageUrl}&as_ylo=2019&as_yhi=2025&start=10`,
      `${initial}&q=different&start=10`,
      `${initial}&as_ylo=2020&start=10`,
      `${initial.replace('epidemic+forecasting', 'other')}&start=10`,
    ])
      expect(() => advance(next, initial, initial)).toThrow(/query|parameters|filters/);
  });

  it('rejects a changed current page, backward traversal, and invalid page status', () => {
    expect(() =>
      getScholarNextUrl(
        capture({ url: `${pageUrl}&start=10`, nextUrl: `${pageUrl}&start=20` }),
        pageUrl,
        pageUrl,
      ),
    ).toThrow(/displayed page changed/);
    expect(() => advance(nextUrl, `${pageUrl}&start=20`)).toThrow(/does not advance/);
    expect(() => advance(`${pageUrl}&start=20`, pageUrl, `${pageUrl}&start=10`)).toThrow(
      /earlier page/,
    );
    expect(() =>
      getScholarNextUrl(capture({ status: 'captcha', nextUrl }), pageUrl, pageUrl),
    ).toThrow(/could not be verified/);
    expect(() =>
      getScholarNextUrl(capture({ status: 'empty', nextUrl }), pageUrl, pageUrl),
    ).toThrow(/empty page/);
    expect(() => advance(null, pageUrl, 'https://example.org/')).toThrow(/approved Google Scholar/);
  });
});

describe('Google Scholar search links', () => {
  it('encodes a topic and inclusive year filters without injecting query parameters', () => {
    const url = new URL(
      buildScholarUrl({ ...query, text: 'climate & health', yearFrom: 2000, yearTo: 2026 }),
    );
    expect(url.origin + url.pathname).toBe('https://scholar.google.com/scholar');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hl: 'en',
      q: 'climate & health',
      as_ylo: '2000',
      as_yhi: '2026',
    });
  });

  it('uses the author field and quotes a normalized DOI', () => {
    expect(
      new URL(buildScholarUrl({ ...query, mode: 'author', text: 'Jane Scholar' })).searchParams.get(
        'q',
      ),
    ).toBe('author:"jane scholar"');
    expect(
      new URL(
        buildScholarUrl({ ...query, mode: 'doi', text: 'https://doi.org/10.1234/EXAMPLE' }),
      ).searchParams.get('q'),
    ).toBe('"10.1234/example"');
  });

  it('sends identical author queries for capitalization and spacing variants without changing the saved input', () => {
    const variants = ['austin g meyer', 'Austin G Meyer', 'AUSTIN G MEYER', ' Austin  G\tMeyer '];
    const urls = variants.map((text) => {
      const input = { ...query, mode: 'author' as const, text, yearFrom: 2020, yearTo: 2026 };
      const url = buildScholarUrl(input);
      expect(input.text).toBe(text);
      return url;
    });
    expect(new Set(urls).size).toBe(1);
    expect(new URL(urls[0]).searchParams.get('q')).toBe('author:"austin g meyer"');
    expect(new URL(buildScholarUrl({ ...query, text: 'RNA OR DNA' })).searchParams.get('q')).toBe(
      'RNA OR DNA',
    );
  });

  it.each([
    { text: '' },
    { text: ' ' },
    { text: 'x'.repeat(501) },
    { mode: 'other' },
    { sources: [] },
    { sources: ['scholar', 'pubmed'] },
    { sources: ['pubmed'] },
    { yearFrom: 1499 },
    { yearTo: new Date().getFullYear() + 2 },
    { yearFrom: 2020.5 },
    { yearFrom: 2023, yearTo: 2022 },
    { mode: 'doi', text: 'not a DOI' },
    { mode: 'author', text: '"\\' },
    { limit: 0 },
    { limit: 201 },
    { limit: 2.5 },
  ])('rejects invalid search input %j', (invalid) => {
    expect(() => buildScholarUrl({ ...query, ...invalid } as SearchQuery)).toThrow();
  });
});

describe('Google Scholar captured page normalization', () => {
  it('preserves the actual page and retrieval time and does not infer open access', () => {
    const { works, url, warning } = normalizeScholarPage(capture(), capturedAt);
    expect(url).toBe(pageUrl);
    expect(works[0]).toMatchObject({
      id: 'scholar:cluster123',
      doi: '10.1234/example',
      citations: 1234,
      authors: ['J Scholar', 'A Researcher'],
      abstract: '',
      snippet: 'A displayed search snippet.',
      isOpenAccess: false,
      openAccessUrl: '',
      provenance: [
        {
          source: 'scholar',
          sourceId: 'cluster123',
          citations: 1234,
          retrievedAt: capturedAt,
          url: pageUrl,
        },
      ],
    });
    expect(warning).toMatch(/incomplete bibliography/);
    expect(warning).toMatch(/abbreviate author lists/);
  });

  it('keeps missing or malformed counts unknown and known zero distinct in metrics', () => {
    const records = [
      'Cited by 1,234',
      '0',
      null,
      '',
      'Cited by many',
      '1,2,3',
      '9007199254740992',
    ].map((citationText, i) => ({ ...publication, sourceId: `id${i}`, citationText }));
    const { works } = normalizeScholarPage(capture({ records }), capturedAt);
    expect(works.map((work) => work.citations)).toEqual([1234, 0, null, null, null, null, null]);
    expect(calculateMetrics(works, 'scholar')).toMatchObject({
      papers: 7,
      citations: 1234,
      citationCoverage: 2,
    });
  });

  it('does not create unsafe URLs or execute text supplied by a page', () => {
    const title = '<img src=x onerror=alert(1)> Literal title';
    const { works } = normalizeScholarPage(
      capture({
        records: [
          { ...publication, title, url: 'javascript:alert(1)' },
          {
            ...publication,
            sourceId: 'credentials',
            url: 'https://person:secret@example.org/paper',
          },
        ],
      }),
    );
    expect(works[0].title).toBe(title);
    expect(works.map((work) => work.url)).toEqual(['', '']);
    expect(works.map((work) => work.doi)).toEqual(['', '']);
  });

  it('gives citation-only records stable IDs without requiring a publisher link', () => {
    const records = [{ ...publication, sourceId: '', url: '', type: 'citation' }];
    const first = normalizeScholarPage(capture({ records }), capturedAt).works[0];
    const second = normalizeScholarPage(capture({ records }), '2026-09-15T00:00:00Z').works[0];
    expect(first.id).toBe(second.id);
    expect(first.url).toBe('');
    expect(first.type).toBe('citation');
  });

  it('caps data and keeps duplicate page records from producing duplicate workspace IDs', () => {
    const records = Array.from({ length: 205 }, (_, index) => ({
      ...publication,
      sourceId: String(index),
      title: 'x'.repeat(2500),
    }));
    const normalized = normalizeScholarPage(capture({ records }));
    expect(normalized.works).toHaveLength(200);
    expect(normalized.works[0].title).toHaveLength(2000);
    expect(normalized.warning).toMatch(/first 200/);
    expect(
      normalizeScholarPage(capture({ records: [publication, publication] })).works,
    ).toHaveLength(1);
  });

  it.each([
    'http://scholar.google.com/scholar',
    'https://scholar.google.com.evil.example/scholar',
    'https://scholar.google.com:8443/scholar',
    'https://person:secret@scholar.google.com/scholar',
    'https://accounts.google.com/scholar',
    'https://scholar.google.com/scholar_settings',
    'https://scholar.google.com/sorry/',
    'javascript:alert(1)',
  ])('rejects capture from unsupported URL %s', (url) => {
    expect(() => normalizeScholarPage(capture({ url }))).toThrow(/public Google Scholar/);
  });

  it.each([
    ['login', /sign-in page/],
    ['captcha', /CAPTCHA/],
    ['unavailable', /unavailable/],
    ['empty', /no displayed publications/],
    ['unsupported', /not supported/],
  ])('explains why a %s page cannot be captured', (status, message) => {
    expect(() => normalizeScholarPage(capture({ status }))).toThrow(message as RegExp);
  });

  it('rejects missing records, mismatched layouts, and invalid retrieval dates', () => {
    expect(() => normalizeScholarPage(null)).toThrow(/unreadable page/);
    expect(() => normalizeScholarPage(capture({ records: [] }))).toThrow(
      /no displayed publications/,
    );
    expect(() => normalizeScholarPage(capture({ status: 'profile' }))).toThrow(/not supported/);
    expect(() => normalizeScholarPage(capture(), 'invalid')).toThrow(/capture time/);
  });
});

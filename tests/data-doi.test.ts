import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { doiUrl, mergeWorks, normalizeDoi } from '../src/core/merge';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'work-1',
  title: 'A longitudinal study of scientific collaboration',
  authors: ['Austin Meyer'],
  year: 2020,
  venue: 'Journal of Research',
  doi: '',
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...overrides,
});

const SICI = '10.1002/(sici)1097-0258(19981215)17:23<2804::aid-sim964>3.0.co;2-a';
const WILEY_HASH = '10.1002/(sici)1097-0258(19981215)17:23<2804::aid-sim964>3.0.co;2-#';
const WILEY_EMPTY = '10.1002/(sici)1097-0258(1998)17:5<>1.0.co;2-t';

describe('P2-12 normalizeDoi accepts the forms people actually paste', () => {
  it.each([
    ['10.1234/ABC', '10.1234/abc'],
    ['  10.1234/abc  ', '10.1234/abc'],
    ['doi:10.1234/ABC', '10.1234/abc'],
    ['DOI: 10.1234/abc', '10.1234/abc'],
    ['https://doi.org/10.1234/abc', '10.1234/abc'],
    ['http://doi.org/10.1234/abc', '10.1234/abc'],
    ['https://dx.doi.org/10.1234/abc', '10.1234/abc'],
    ['https://www.doi.org/10.1234/abc', '10.1234/abc'],
    ['www.doi.org/10.1234/abc', '10.1234/abc'],
    ['doi.org/10.1234/abc', '10.1234/abc'],
    ['dx.doi.org/10.1234/abc', '10.1234/abc'],
    ['info:doi/10.1234/abc', '10.1234/abc'],
    ['urn:doi:10.1234/abc', '10.1234/abc'],
    ['https://doi.org/doi:10.1234/abc', '10.1234/abc'],
    ['https://doi.org/10.1234%2Fabc', '10.1234/abc'],
    ['(10.1234/abc)', '10.1234/abc'],
    ['[10.1234/abc]', '10.1234/abc'],
    ['<https://doi.org/10.1234/abc>', '10.1234/abc'],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
  });

  it.each([
    ['10.1234/abc.', '10.1234/abc'],
    ['10.1234/abc,', '10.1234/abc'],
    ['10.1234/abc)', '10.1234/abc'],
    ['10.1234/abc).', '10.1234/abc'],
    ['https://doi.org/10.1234/abc/', '10.1234/abc'],
    ['https://doi.org/10.1234/abc?utm_source=newsletter', '10.1234/abc'],
    ['https://doi.org/10.1234/abc#sec2', '10.1234/abc'],
    ['https://doi.org/10.1234/abc?utm=x#frag', '10.1234/abc'],
    ['https://doi.org/10.1234/abc%2E', '10.1234/abc'],
  ])(
    'drops sentence punctuation and the tracking query or fragment of a link: %j',
    (input, expected) => {
      expect(normalizeDoi(input)).toBe(expected);
    },
  );

  // Real Wiley DOIs end in "#" or ";", and one contains an empty "<>" pair; a bare DOI is taken whole.
  it.each([
    [WILEY_HASH, WILEY_HASH],
    [WILEY_HASH.toUpperCase(), WILEY_HASH],
    [WILEY_EMPTY, WILEY_EMPTY],
    ['10.1234/abc;', '10.1234/abc;'],
    ['10.1234/abc:', '10.1234/abc:'],
    ['10.1234/abc>', '10.1234/abc>'],
    ['10.1234/abc#', '10.1234/abc#'],
    ['10.1234/abc#frag', '10.1234/abc#frag'],
    ['10.1234/abc?x=1', '10.1234/abc?x=1'],
    ['10.1234/abc/', '10.1234/abc/'],
    ['doi:10.1002/abc#frag', '10.1002/abc#frag'],
    [`doi:${WILEY_HASH}`, WILEY_HASH],
    [`  ${WILEY_HASH}  `, WILEY_HASH],
  ])('keeps everything of a bare DOI except sentence punctuation: %j', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
    expect(normalizeDoi(expected)).toBe(expected);
  });

  it('reads the percent-encoded and link forms of DOIs that end in "#" or contain "<>"', () => {
    expect(normalizeDoi(`https://doi.org/${encodeURIComponent(WILEY_HASH)}`)).toBe(WILEY_HASH);
    expect(normalizeDoi(encodeURIComponent(WILEY_HASH))).toBe(WILEY_HASH);
    expect(normalizeDoi(`https://doi.org/${WILEY_EMPTY}`)).toBe(WILEY_EMPTY);
    expect(normalizeDoi(`https://doi.org/${encodeURIComponent(WILEY_EMPTY)}`)).toBe(WILEY_EMPTY);
    // A raw "#" in a link starts the fragment, as it does in a browser.
    expect(normalizeDoi('https://doi.org/10.1002/abc#frag')).toBe('10.1002/abc');
    expect(normalizeDoi('doi.org/10.1002/abc?x=1#y')).toBe('10.1002/abc');
  });

  it('keeps parentheses that belong to the DOI', () => {
    expect(normalizeDoi('10.1016/S0140-6736(05)67122-2')).toBe('10.1016/s0140-6736(05)67122-2');
    expect(normalizeDoi('10.1234/abc(def)')).toBe('10.1234/abc(def)');
    expect(normalizeDoi('(10.1234/abc(def))')).toBe('10.1234/abc(def)');
    expect(normalizeDoi('https://dx.doi.org/10.1234/ABC%28DEF%29')).toBe('10.1234/abc(def)');
  });

  it('keeps SICI DOIs whole: angle brackets, colons and semicolons belong to them', () => {
    expect(normalizeDoi(SICI.toUpperCase())).toBe(SICI);
    expect(normalizeDoi(`https://doi.org/${SICI}`)).toBe(SICI);
    expect(normalizeDoi(`doi:${SICI}`)).toBe(SICI);
    expect(normalizeDoi(encodeURIComponent(SICI))).toBe(SICI);
    expect(normalizeDoi(`https://doi.org/${encodeURIComponent(SICI)}`)).toBe(SICI);
    expect(normalizeDoi(`(${SICI})`)).toBe(SICI);
    // A trailing sentence period is not part of the DOI, but the final "2-a" is.
    expect(normalizeDoi(`${SICI}.`)).toBe(SICI);
    expect(normalizeDoi('10.1002/(SICI)1521-3951(199911)216:1<B5::AID-PSSB5>3.0.CO;2-#')).toBe(
      '10.1002/(sici)1521-3951(199911)216:1<b5::aid-pssb5>3.0.co;2-#',
    );
  });

  it('keeps a literal percent sign or %20 instead of discarding the whole DOI', () => {
    expect(normalizeDoi('10.1234/a%20b')).toBe('10.1234/a%20b');
    expect(normalizeDoi('10.1234/100%')).toBe('10.1234/100%');
    expect(normalizeDoi('10.1234/100%25')).toBe('10.1234/100%');
  });

  it('removes invisible characters', () => {
    expect(normalizeDoi('10.1234/abc\u{200b}')).toBe('10.1234/abc');
    expect(normalizeDoi('\u{200b}10.1234/abc')).toBe('10.1234/abc');
    expect(normalizeDoi('\u{feff}10.1234/abc')).toBe('10.1234/abc');
  });

  it.each([
    '',
    '   ',
    'javascript:bad',
    'not a doi',
    '10.123/abc',
    '10.1234/',
    '10.1234/has space',
    'https://example.org/10.1234/abc',
    'ftp://doi.org/10.1234/abc',
    `10.1234/${'a'.repeat(2001)}`,
  ])('rejects %j', (input) => {
    expect(normalizeDoi(input)).toBe('');
  });

  it('accepts registrant sub-codes and long numeric prefixes', () => {
    expect(normalizeDoi('10.1000.10/123456')).toBe('10.1000.10/123456');
    expect(normalizeDoi('10.123456789/abc')).toBe('10.123456789/abc');
  });

  it('is idempotent on every accepted form', () => {
    for (const input of [
      '10.1234/ABC',
      'https://doi.org/10.1234/abc?utm=1',
      '10.1234/a%20b',
      '10.1234/100%25',
      '10.1234/a%2520b',
      SICI,
      encodeURIComponent(SICI),
      '(10.1234/abc(def))',
      '10.1234/abc%2E',
    ]) {
      const once = normalizeDoi(input);
      expect(normalizeDoi(once)).toBe(once);
    }
  });

  it('stays linear on long hostile input', () => {
    const started = performance.now();
    normalizeDoi(`10.1234/${'.'.repeat(200_000)}`);
    normalizeDoi(`10.1234/${'('.repeat(200_000)}`);
    normalizeDoi(`${' '.repeat(200_000)}10.1234/abc`);
    normalizeDoi(`10.1234/abc${')'.repeat(200_000)}`);
    normalizeDoi(`10.1234/abc${'.,'.repeat(100_000)}`);
    normalizeDoi(`10.1234/abc${'.)'.repeat(100_000)}`);
    normalizeDoi(`https://doi.org/${'?'.repeat(200_000)}`);
    normalizeDoi(`https://doi.org/10.1234/abc${'/'.repeat(200_000)}`);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('P2-12 doiUrl builds a link that resolves to the same DOI', () => {
  // Same form as the source adapters build: only what cannot stand in a URL path is encoded.
  it.each([
    ['10.1234/abc', 'https://doi.org/10.1234/abc'],
    ['10.1016/s0140-6736(05)67122-2', 'https://doi.org/10.1016/s0140-6736(05)67122-2'],
    ['10.1000/abc#frag', 'https://doi.org/10.1000/abc%23frag'],
    ['10.1000/a?b=c', 'https://doi.org/10.1000/a%3Fb=c'],
    ['10.1000/100%', 'https://doi.org/10.1000/100%25'],
    [
      SICI,
      'https://doi.org/10.1002/(sici)1097-0258(19981215)17:23%3C2804::aid-sim964%3E3.0.co;2-a',
    ],
    [
      WILEY_HASH,
      'https://doi.org/10.1002/(sici)1097-0258(19981215)17:23%3C2804::aid-sim964%3E3.0.co;2-%23',
    ],
  ])('links %j', (doi, url) => {
    expect(doiUrl(doi)).toBe(url);
    const link = new URL(url);
    expect(decodeURIComponent(link.pathname)).toBe(`/${doi}`);
    expect(link.hash).toBe('');
    expect(link.search).toBe('');
    expect(normalizeDoi(url)).toBe(doi);
  });
});

describe('P2-12 mergeWorks and unparseable DOI text', () => {
  it('does not rewrite an unreadable DOI to an empty string', () => {
    const [merged] = mergeWorks([work({ doi: 'pending assignment' })]);
    expect(merged.doi).toBe('pending assignment');
  });

  it('never uses unreadable DOI text as an identity', () => {
    const merged = mergeWorks([
      work({ id: 'a', title: 'First paper with an odd DOI field', doi: 'N/A' }),
      work({ id: 'b', title: 'Second paper with an odd DOI field', doi: 'N/A' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('lets a readable DOI win over unreadable text when records merge', () => {
    const provenance = (id: string): Work['provenance'] => [
      { source: 'pubmed', sourceId: id, citations: null, retrievedAt: '', url: '' },
    ];
    for (const order of [0, 1]) {
      const odd = work({ id: 'odd', doi: 'N/A', provenance: provenance('9') });
      const real = work({
        id: 'real',
        doi: 'https://doi.org/10.1234/ABC.',
        provenance: provenance('9'),
      });
      const merged = mergeWorks(order ? [real, odd] : [odd, real]);
      expect(merged).toHaveLength(1);
      expect(merged[0].doi).toBe('10.1234/abc');
    }
  });

  it('merges records whose DOIs differ only by the forms that normalizeDoi now accepts', () => {
    const merged = mergeWorks([
      work({ id: 'a', doi: '10.1234/abc.' }),
      work({ id: 'b', doi: 'www.doi.org/10.1234/ABC' }),
      work({ id: 'c', doi: 'https://doi.org/10.1234/abc?utm=1' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].doi).toBe('10.1234/abc');
  });

  it('keeps two different SICI DOIs apart', () => {
    const other = SICI.replace('964', '965');
    const merged = mergeWorks([work({ id: 'a', doi: SICI }), work({ id: 'b', doi: other })]);
    expect(merged.map((w) => w.doi)).toEqual([SICI, other]);
  });
});

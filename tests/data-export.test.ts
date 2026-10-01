import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { csvCell, exportWorks, importWorks, parseCsv } from '../src/core/formats';
import { workKind } from '../src/core/worktype';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'x:1',
  title: 'A multicenter randomized trial of something in critically ill children',
  authors: ['Austin G Meyer', 'Jane Doe'],
  year: 2020,
  venue: 'New England Journal of Medicine',
  doi: '10.1056/x',
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

describe('P2-04 BibTeX and RIS entry types follow the kind of work', () => {
  // [provider type, BibTeX entry, BibTeX venue field, RIS type, RIS venue tag]
  const table: Array<[string, string, string, string, string]> = [
    ['journal-article', 'article', 'journal', 'JOUR', 'JO'],
    ['article', 'article', 'journal', 'JOUR', 'JO'],
    ['research-article, Journal Article', 'article', 'journal', 'JOUR', 'JO'],
    ["Journal Article, Research Support, Non-U.S. Gov't", 'article', 'journal', 'JOUR', 'JO'],
    ['JournalArticle', 'article', 'journal', 'JOUR', 'JO'],
    ['publication', 'article', 'journal', 'JOUR', 'JO'],
    ['review', 'article', 'journal', 'JOUR', 'JO'],
    ['editorial', 'article', 'journal', 'JOUR', 'JO'],
    ['proceedings-article', 'inproceedings', 'booktitle', 'CONF', 'T2'],
    ['conference-paper', 'inproceedings', 'booktitle', 'CONF', 'T2'],
    ['inproceedings', 'inproceedings', 'booktitle', 'CONF', 'T2'],
    ['book-chapter', 'incollection', 'booktitle', 'CHAP', 'T2'],
    ['incollection', 'incollection', 'booktitle', 'CHAP', 'T2'],
    ['book', 'book', 'publisher', 'BOOK', 'PB'],
    ['monograph', 'book', 'publisher', 'BOOK', 'PB'],
    ['dissertation', 'phdthesis', 'school', 'THES', 'PB'],
    ['phdthesis', 'phdthesis', 'school', 'THES', 'PB'],
    ['mastersthesis', 'mastersthesis', 'school', 'THES', 'PB'],
    ['report', 'techreport', 'institution', 'RPRT', 'PB'],
    ['techreport', 'techreport', 'institution', 'RPRT', 'PB'],
    ['posted-content', 'misc', 'howpublished', 'GEN', 'T2'],
    ['preprint', 'misc', 'howpublished', 'GEN', 'T2'],
    ['dataset', 'misc', 'howpublished', 'GEN', 'T2'],
    ['software', 'misc', 'howpublished', 'GEN', 'T2'],
    ['peer-review', 'misc', 'howpublished', 'GEN', 'T2'],
    ['something the provider invented', 'misc', 'howpublished', 'GEN', 'T2'],
  ];

  it.each(table)(
    'exports type %j as @%s (venue in %s) and RIS %s (venue in %s)',
    (type, entry, field, ris, tag) => {
      const paper = work({ type });
      const bib = exportWorks([paper], 'bibtex');
      expect(bib).toMatch(new RegExp(`^@${entry}\\{`));
      expect(bib).toContain(`  ${field} = {New England Journal of Medicine}`);
      if (entry !== 'article') expect(bib).not.toContain('  journal = ');
      const text = exportWorks([paper], 'ris');
      expect(text.startsWith(`TY  - ${ris}\r\n`)).toBe(true);
      expect(text).toContain(`\r\n${tag}  - New England Journal of Medicine\r\n`);
    },
  );

  it('reads the exported entry types back as the same kind of work, with the venue', () => {
    for (const [type] of table) {
      const paper = work({ type });
      for (const format of ['bibtex', 'ris'] as const) {
        const [back] = importWorks(
          exportWorks([paper], format),
          `x.${format === 'ris' ? 'ris' : 'bib'}`,
        );
        expect(back.venue).toBe(paper.venue);
        const kind = workKind(type);
        if (
          [
            'article',
            'review',
            'editorial',
            'conference',
            'chapter',
            'book',
            'thesis',
            'report',
          ].includes(kind)
        ) {
          const expected = ['review', 'editorial'].includes(kind) ? 'article' : kind;
          expect(workKind(back.type)).toBe(expected);
        } else expect(workKind(back.type)).toBe('other');
      }
    }
  });

  it('keeps pinned behaviour: article/book records and unique stable keys', () => {
    const bib = exportWorks([work(), work()], 'bibtex');
    const keys = [...bib.matchAll(/@article\{([^,]+)/g)].map((match) => match[1]);
    expect(new Set(keys).size).toBe(2);
    expect(exportWorks([work({ type: 'book' })], 'ris').startsWith('TY  - BOOK')).toBe(true);
  });

  it('reads the standard RIS and BibTeX types of other tools', () => {
    const ris = (code: string) =>
      importWorks(`TY  - ${code}\nTI  - A paper\nER  -\n`, 'x.ris')[0].type;
    expect(workKind(ris('JOUR'))).toBe('article');
    expect(workKind(ris('EJOUR'))).toBe('article');
    expect(workKind(ris('CONF'))).toBe('conference');
    expect(workKind(ris('CPAPER'))).toBe('conference');
    expect(workKind(ris('CHAP'))).toBe('chapter');
    expect(workKind(ris('BOOK'))).toBe('book');
    expect(workKind(ris('THES'))).toBe('thesis');
    expect(workKind(ris('RPRT'))).toBe('report');
    expect(workKind(ris('DATA'))).toBe('dataset');
    expect(workKind(ris('COMP'))).toBe('software');
    expect(ris('JOUR')).toBe('article');
    expect(workKind(ris('GEN'))).toBe('other');
    const bib = (entry: string) => importWorks(`@${entry}{k, title={A paper}}`, 'x.bib')[0].type;
    expect(workKind(bib('inproceedings'))).toBe('conference');
    expect(workKind(bib('conference'))).toBe('conference');
    expect(workKind(bib('incollection'))).toBe('chapter');
    expect(workKind(bib('inbook'))).toBe('chapter');
    expect(workKind(bib('phdthesis'))).toBe('thesis');
    expect(workKind(bib('mastersthesis'))).toBe('thesis');
    expect(workKind(bib('techreport'))).toBe('report');
    expect(bib('article')).toBe('article');
    expect(bib('book')).toBe('book');
  });
});

describe('P2-09 a leading apostrophe survives CSV export and import', () => {
  const texts = [
    "'=x",
    "' -x a title that is long",
    "'+1 is fine",
    "''=x",
    "'\t=1",
    "'  =x",
    "'@mention",
    "'80s music",
    "'quoted'",
    "'",
    "''",
    '=x',
    '  =x',
    '@SUM(A1)',
    '\t=1',
  ];

  it.each(texts)('round-trips %j through a cell', (text) => {
    const [row] = parseCsv(`a\r\n${csvCell(text)}`, ',', false);
    expect(row.a).toBe(text);
  });

  it('writes the guard apostrophe only where an importer would otherwise misread the text', () => {
    expect(csvCell("'=x")).toBe(`"''=x"`);
    expect(csvCell('=x')).toBe(`"'=x"`);
    expect(csvCell("'80s")).toBe(`"'80s"`);
    expect(csvCell('plain')).toBe('"plain"');
  });

  it('round-trips titles, notes, venues, tags and authors that start with an apostrophe', () => {
    const paper = work({
      title: "' -x a title that starts with an apostrophe",
      notes: "'=x",
      venue: "'+1 Journal",
      abstract: "'@abstract",
      snippet: "'-snippet",
      authors: ["'=cmd", "'Connor, Sean"],
      tags: ["'=x", "'-y"],
    });
    const [back] = importWorks(exportWorks([paper], 'csv'), 'x.csv');
    expect(back).toMatchObject({
      title: paper.title,
      notes: paper.notes,
      venue: paper.venue,
      abstract: paper.abstract,
      snippet: paper.snippet,
      authors: paper.authors,
      tags: paper.tags,
    });
  });

  it('still neutralises real formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1+1')).toBe(`"'-1+1"`);
  });
});

describe('P2-11 author lists survive CSV export whatever their punctuation', () => {
  it.each([
    [['AG Meyer, J Smith, K Doe']],
    [['Smith Group, University of X, Dept of Y']],
    [['Jane Smith, John Doe, Ali Jones']],
    [['Doe, Jane', 'Smith, John']],
    [['Research and Development Group']],
    [['a; b', 'c']],
    [['  padded ', 'other']],
  ])('round-trips %j', (authors) => {
    const [back] = importWorks(exportWorks([work({ authors })], 'csv'), 'x.csv');
    expect(back.authors).toEqual(authors.map((author) => author.trim()));
  });
});

describe('round trips of random records (CSV and JSON)', () => {
  let seed = 987654;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];
  const pieces = [
    'a',
    'B',
    'hello',
    'World',
    ' ',
    '  ',
    '\t',
    '\n',
    '\r\n',
    '\r',
    '"',
    "'",
    '""',
    ',',
    ';',
    ' and ',
    ' AND ',
    '[',
    ']',
    '{',
    '}',
    '=',
    '+',
    '-',
    '@',
    '&',
    '%',
    '$',
    '#',
    '_',
    '~',
    '^',
    '\\',
    '/',
    ':',
    '.',
    'é',
    '中',
    '🚀',
    '\u{202e}',
    '\u{200b}',
    '\u{feff}',
    '\u0000',
    '\u001f',
    '<b>',
    '&amp;',
    '10.1234/abc',
    'http://x.org/a?b=c&d=e',
    '[1]',
    '["x"]',
    "'=1",
    "'-2",
    '=cmd',
    '@SUM(A1)',
    "'",
    "''",
    "'\t=",
  ];
  const text = (max = 6) =>
    Array.from({ length: Math.floor(rnd() * max) }, () => pick(pieces)).join('');
  const thisYear = new Date().getFullYear();
  const randomWork = (i: number): Work => ({
    id: rnd() < 0.2 ? '' : `id-${i}-${text(2)}`,
    title: rnd() < 0.05 ? '' : `T${text(8)}`,
    authors: Array.from({ length: Math.floor(rnd() * 4) }, () => text(4)),
    ...(rnd() < 0.3 ? { authorsComplete: rnd() < 0.5 } : {}),
    year: rnd() < 0.2 ? null : 1000 + Math.floor(rnd() * 2000),
    venue: text(3),
    doi: rnd() < 0.5 ? '' : pick(['10.1234/abc', '10.1234/ABC-def', '10.5555/x(y)z']),
    abstract: text(8),
    ...(rnd() < 0.3 ? { snippet: text(3) } : {}),
    type: pick(['article', 'book', 'dataset', 'preprint', 'publication']),
    url: rnd() < 0.5 ? '' : pick(['https://example.org/a', 'http://x.org/a?b=c&d=e#f']),
    openAccessUrl: rnd() < 0.7 ? '' : 'https://example.org/oa.pdf',
    isOpenAccess: rnd() < 0.5,
    citations: rnd() < 0.3 ? null : Math.floor(rnd() * 1000),
    provenance: [],
    included: rnd() < 0.5,
    tags: Array.from({ length: Math.floor(rnd() * 3) }, () => text(3)),
    notes: text(6),
  });
  const clean = (value: string) => value.replace(/\u0000/g, '').trim();

  it.each(['csv', 'json'] as const)(
    '%s export followed by import changes nothing but documented cleanup',
    { timeout: 300_000 },
    (format) => {
      const mismatches: string[] = [];
      for (let i = 0; i < 6000; i++) {
        const original = randomWork(i);
        if (!clean(original.title)) continue;
        const [back] = importWorks(exportWorks([original], format), `x.${format}`);
        const expected = {
          title: clean(original.title),
          authors: original.authors.map(clean).filter(Boolean),
          year:
            original.year !== null && original.year >= 1500 && original.year <= thisYear + 1
              ? original.year
              : null,
          venue: clean(original.venue),
          abstract: clean(original.abstract),
          snippet: original.snippet ? clean(original.snippet) : undefined,
          type: clean(original.type) || 'article',
          isOpenAccess: original.isOpenAccess,
          included: original.included,
          tags: original.tags.map(clean).filter(Boolean),
          notes: clean(original.notes),
          doi: original.doi.toLowerCase(),
          citations: original.citations,
        };
        for (const [key, value] of Object.entries(expected))
          if (
            JSON.stringify((back as unknown as Record<string, unknown>)[key]) !==
            JSON.stringify(value)
          )
            mismatches.push(
              `${key}: ${JSON.stringify(original[key as keyof Work])} -> ${JSON.stringify((back as unknown as Record<string, unknown>)[key])}`,
            );
      }
      expect(mismatches.slice(0, 5)).toEqual([]);
    },
  );
});

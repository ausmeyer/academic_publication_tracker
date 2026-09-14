import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { calculateMetrics, citationsForSource } from '../src/core/metrics';
import { mergeWorks, normalizeDoi } from '../src/core/merge';
import { exportWorks, importWorks } from '../src/core/formats';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'work-1',
  title: 'A longitudinal study of scientific collaboration',
  authors: ['Austin Meyer'],
  year: 2020,
  venue: 'Journal of Research',
  doi: '10.1234/example',
  abstract: '',
  type: 'article',
  url: 'https://doi.org/10.1234/example',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...overrides,
});

describe('bibliometric calculations', () => {
  it('calculates a known h/g/i10 vector without mutating input', () => {
    const counts = [25, 8, 5, 3, 3, 2, 1, 0];
    const papers = counts.map((citations, index) => work({ id: String(index), citations }));
    const metrics = calculateMetrics(papers, 'all', 2026);
    expect(metrics).toMatchObject({
      papers: 8,
      citations: 47,
      hIndex: 3,
      gIndex: 6,
      i10Index: 1,
      citationCoverage: 8,
      citationsPerPaper: 47 / 8,
      citationsPerYear: 47 / 7,
      annualizedH: 3 / 7,
      medianCitations: 3,
      firstYear: 2020,
      lastYear: 2020,
    });
    expect(papers.map((paper) => paper.citations)).toEqual(counts);
  });

  it('caps g at actual included paper count', () => {
    expect(calculateMetrics([work({ citations: 10_000 })]).gIndex).toBe(1);
    expect(calculateMetrics([work({ citations: 10_000 }), work({ citations: null })]).gIndex).toBe(
      2,
    );
  });

  it('distinguishes a missing count from a known zero and excludes unchecked works', () => {
    const metrics = calculateMetrics(
      [
        work({ citations: 10 }),
        work({ citations: 0 }),
        work({ citations: null }),
        work({ citations: 100, included: false, year: 1900 }),
      ],
      'all',
      2026,
    );
    expect(metrics).toMatchObject({
      papers: 3,
      citations: 10,
      citationCoverage: 2,
      hIndex: 1,
      gIndex: 3,
      citationsPerPaper: 5,
      medianCitations: 5,
      firstYear: 2020,
    });
  });

  it('uses source-specific counts and does not add counts for the same paper', () => {
    const paper = work({
      citations: 900,
      provenance: [
        { source: 'openalex', sourceId: 'W1', citations: 11, retrievedAt: '2026-09-14', url: '' },
        {
          source: 'crossref',
          sourceId: '10.1234/example',
          citations: 7,
          retrievedAt: '2026-09-14',
          url: '',
        },
        { source: 'pubmed', sourceId: '1', citations: null, retrievedAt: '2026-09-14', url: '' },
      ],
    });
    expect(citationsForSource(paper)).toBe(11);
    expect(citationsForSource(paper, 'crossref')).toBe(7);
    expect(citationsForSource(paper, 'pubmed')).toBeNull();
    expect(calculateMetrics([paper], 'pubmed')).toMatchObject({
      citationCoverage: 0,
      citations: 0,
    });
  });

  it('groups lifetime citations by publication year, and counts open works and venues', () => {
    const metrics = calculateMetrics([
      work({ year: 2022, citations: 4, isOpenAccess: true }),
      work({ year: 2020, citations: 8 }),
      work({ year: 2022, citations: null }),
      work({ year: null, venue: '' }),
    ]);
    expect(metrics.years).toEqual([
      { year: 2020, papers: 1, citations: 8 },
      { year: 2022, papers: 2, citations: 4 },
    ]);
    expect(metrics.topVenues).toEqual([{ name: 'Journal of Research', count: 3 }]);
    expect(metrics.openAccess).toBe(1);
  });

  it('has defined empty, all-missing, and future-year behavior', () => {
    expect(calculateMetrics([], 'all', 2026)).toMatchObject({
      papers: 0,
      citations: 0,
      citationCoverage: 0,
      citationsPerPaper: 0,
      citationsPerYear: 0,
      hIndex: 0,
      gIndex: 0,
      medianCitations: 0,
      firstYear: null,
      lastYear: null,
    });
    expect(
      calculateMetrics([work({ year: 2027, citations: 2 })], 'all', 2026).citationsPerYear,
    ).toBe(0);
    expect(calculateMetrics([work({ year: null, citations: 2 })], 'all', 2026).annualizedH).toBe(0);
  });
});

describe('conservative publication merging', () => {
  it('normalizes DOI URLs and encoded DOI text', () => {
    expect(normalizeDoi(' https://DX.DOI.ORG/10.1234/ABC%28DEF%29 ')).toBe('10.1234/abc(def)');
    expect(normalizeDoi('doi:10.1234/ABC')).toBe('10.1234/abc');
    expect(normalizeDoi('javascript:bad')).toBe('');
  });

  it('merges identical DOIs, retains provenance, and preserves first curation', () => {
    const first = work({
      citations: 5,
      included: false,
      tags: ['keep'],
      notes: 'my note',
      provenance: [
        { source: 'openalex', sourceId: 'W1', citations: 5, retrievedAt: '2026-09-14', url: '' },
      ],
    });
    const second = work({
      id: 'other',
      title: 'Different metadata',
      doi: 'https://doi.org/10.1234/EXAMPLE',
      citations: 8,
      tags: ['other'],
      notes: 'other note',
      provenance: [
        {
          source: 'crossref',
          sourceId: '10.1234/example',
          citations: 8,
          retrievedAt: '2026-09-14',
          url: '',
        },
      ],
    });
    const merged = mergeWorks([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: first.id,
      citations: 8,
      included: false,
      tags: ['keep'],
      notes: 'my note',
    });
    expect(merged[0].provenance).toHaveLength(2);
    expect(first.citations).toBe(5);
  });

  it('merges a long identical title only with same year and overlapping authors', () => {
    expect(
      mergeWorks([work({ doi: '' }), work({ id: 'other', authors: ['Meyer, A.'] })]),
    ).toHaveLength(1);
    expect(mergeWorks([work({ doi: '' }), work({ authors: ['Alice Smith'] })])).toHaveLength(2);
    expect(mergeWorks([work({ doi: '' }), work({ year: 2021 })])).toHaveLength(2);
    expect(
      mergeWorks([work({ doi: '', title: 'Editorial' }), work({ title: 'Editorial' })]),
    ).toHaveLength(2);
    expect(mergeWorks([work({ doi: '', year: null }), work({ year: null })])).toHaveLength(2);
  });

  it('merges repeated provider records with sparse metadata while retaining counts and first curation', () => {
    const first = work({
      id: 'europepmc:PPR1',
      doi: '',
      title: 'Brief report',
      year: null,
      authors: [],
      included: false,
      notes: 'Already screened',
      tags: ['reviewed'],
      citations: 2,
      provenance: [
        { source: 'europepmc', sourceId: 'PPR1', citations: 2, retrievedAt: '2026-09-14', url: '' },
      ],
    });
    const second = work({
      ...first,
      included: true,
      notes: '',
      tags: [],
      citations: 4,
      provenance: [
        { source: 'europepmc', sourceId: 'PPR1', citations: 4, retrievedAt: '2026-09-15', url: '' },
      ],
    });
    const merged = mergeWorks([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: first.id,
      citations: 4,
      included: false,
      notes: 'Already screened',
      tags: ['reviewed'],
    });
    expect(merged[0].provenance).toEqual([...first.provenance, ...second.provenance]);
    expect(first.citations).toBe(2);
  });

  it('requires a nonempty matching provider identity instead of a shared imported work ID', () => {
    const sparse = work({ doi: '', title: 'Brief report', year: null, authors: [] });
    expect(mergeWorks([sparse, sparse])).toHaveLength(2);
    expect(
      mergeWorks([
        {
          ...sparse,
          provenance: [
            { source: 'europepmc', sourceId: '1', citations: null, retrievedAt: '', url: '' },
          ],
        },
        {
          ...sparse,
          provenance: [
            { source: 'pubmed', sourceId: '1', citations: null, retrievedAt: '', url: '' },
          ],
        },
      ]),
    ).toHaveLength(2);
    expect(
      mergeWorks([
        {
          ...sparse,
          provenance: [
            { source: 'europepmc', sourceId: '', citations: null, retrievedAt: '', url: '' },
          ],
        },
        {
          ...sparse,
          provenance: [
            { source: 'europepmc', sourceId: '', citations: null, retrievedAt: '', url: '' },
          ],
        },
      ]),
    ).toHaveLength(2);
  });

  it('resolves provider chains before merging and leaves conflicting DOI bridges separate in any order', () => {
    const record = (sourceId: string): Work['provenance'][number] => ({
      source: 'europepmc',
      sourceId,
      citations: null,
      retrievedAt: '',
      url: '',
    });
    const first = work({ id: 'A', doi: '10.1234/a', title: 'Report A', provenance: [record('A')] });
    const bridge = work({
      id: 'bridge',
      doi: '',
      title: 'Bridge',
      provenance: [record('A'), record('B')],
    });
    const second = work({
      id: 'B',
      doi: '10.1234/b',
      title: 'Report B',
      provenance: [record('B')],
    });
    for (const input of [
      [first, bridge, second],
      [first, second, bridge],
      [bridge, first, second],
      [bridge, second, first],
      [second, first, bridge],
      [second, bridge, first],
    ]) {
      expect(mergeWorks(input)).toHaveLength(3);
      expect(
        mergeWorks(input.map((paper) => ({ ...paper, doi: paper === second ? '' : paper.doi }))),
      ).toHaveLength(1);
    }
    expect(mergeWorks([first, { ...second, provenance: [record('A')] }])).toHaveLength(2);
  });

  it('does not merge different DOIs, even through an ambiguous title-only bridge', () => {
    const first = work({ id: 'A', doi: '10.1234/a' });
    const bridge = work({ id: 'bridge', doi: '' });
    const second = work({ id: 'B', doi: '10.1234/b' });
    for (const input of [
      [first, bridge, second],
      [bridge, first, second],
      [second, bridge, first],
    ]) {
      expect(mergeWorks(input)).toHaveLength(3);
    }
  });

  it('finds title duplicates against all metadata variants in a DOI group', () => {
    const papers = [
      work({ id: 'first', title: 'Earlier version of a different publication title' }),
      work({ id: 'second' }),
      work({ id: 'third', doi: '' }),
    ];
    expect(mergeWorks(papers)).toHaveLength(1);
  });

  it('keeps the earliest title-only record curation when subsequently matched to a DOI', () => {
    const merged = mergeWorks([
      work({ id: 'earliest', doi: '', included: false, notes: 'reviewed' }),
      work({ id: 'later' }),
    ]);
    expect(merged[0]).toMatchObject({
      id: 'earliest',
      doi: '10.1234/example',
      included: false,
      notes: 'reviewed',
    });
  });
});

describe('publication import and export', () => {
  const paper = work({
    title: 'Trials, "evidence" & equity: a résumé',
    authors: ['Meyer, Austin', 'García, María'],
    citations: 18,
    abstract: 'One line.\nA second line.',
    notes: 'Useful, with "quotes".',
    tags: ['review', 'méthodes'],
    isOpenAccess: true,
    openAccessUrl: 'https://example.org/paper.pdf',
    included: false,
    provenance: [
      {
        source: 'openalex',
        sourceId: 'W1',
        citations: 18,
        retrievedAt: '2026-09-14',
        url: 'https://openalex.org/W1',
      },
    ],
  });

  it('round-trips JSON without losing curation or provenance', () => {
    expect(importWorks(exportWorks([paper], 'json'), 'works.json')).toEqual([paper]);
  });

  it('round-trips CSV with a BOM, embedded quotes, Unicode and embedded newlines', () => {
    const csv = exportWorks([paper, work({ id: 'second' })], 'csv');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(importWorks(csv, 'works.csv')).toEqual([paper, work({ id: 'second' })]);
  });

  it('exports the displayed combined count even when an imported cached count differs', () => {
    const input = { ...paper, citations: 0 };
    for (const format of ['csv', 'json'] as const) {
      const restored = importWorks(exportWorks([input], format), `works.${format}`)[0];
      expect(restored.citations).toBe(18);
      expect(restored.provenance).toEqual(paper.provenance);
    }
    expect(input.citations).toBe(0);
    const missing = work({
      citations: 99,
      provenance: [
        { source: 'pubmed', sourceId: '1', citations: null, retrievedAt: '2026-09-14', url: '' },
      ],
    });
    expect(importWorks(exportWorks([missing], 'json'), 'works.json')[0].citations).toBeNull();
  });

  it('imports conventional publication CSV headers and null missing counts', () => {
    const papers = importWorks(
      'Title,Authors,Year,Publication,Cites,DOI\r\n"A study, with commas",Jane Smith; Ali Jones,2024,Science,,10.1234/ABC\r\n',
      'pop.csv',
    );
    expect(papers[0]).toMatchObject({
      title: 'A study, with commas',
      authors: ['Jane Smith', 'Ali Jones'],
      year: 2024,
      venue: 'Science',
      citations: null,
      doi: '10.1234/abc',
      included: true,
    });
  });

  it('neutralizes formula-leading CSV fields including whitespace prefixes', () => {
    for (const title of [
      '=WEBSERVICE("https://example.org")',
      '+123',
      '-123',
      '@SUM(A1)',
      ' \t=1+1',
    ]) {
      const csv = exportWorks([work({ title })], 'csv');
      expect(csv).toContain(`"'${title.replace(/"/g, '""')}"`);
      expect(importWorks(csv, 'works.csv')[0].title).toBe(title.trim());
    }
  });

  it('imports nested BibTeX braces, quoted titles, comma names and corporate authors', () => {
    const bib =
      '@article{one, title = {The {DNA} of {Open} Science}, author = {Meyer, Austin and {Research and Development Group}}, year = 2024, journal = "Research", doi = {10.1234/ONE}}\n@book{two, title = "Quoted {Title}", author={García, María}, year={2020}}';
    const papers = importWorks(bib, 'references.bib');
    expect(papers).toHaveLength(2);
    expect(papers[0]).toMatchObject({
      title: 'The DNA of Open Science',
      authors: ['Meyer, Austin', 'Research and Development Group'],
      year: 2024,
    });
    expect(papers[1].title).toBe('Quoted Title');
  });

  it('round-trips standard bibliographic data through escaped BibTeX with stable keys', () => {
    const input = work({
      title: '50% {certainty} & costs_$ # ~ ^ \\ DNA',
      authors: paper.authors,
      abstract: 'évidence',
    });
    const bib = exportWorks([input], 'bibtex');
    expect(bib).toBe(exportWorks([input], 'bibtex'));
    const restored = importWorks(bib, 'works.bib')[0];
    expect(restored).toMatchObject({
      title: input.title,
      authors: input.authors,
      year: input.year,
      doi: input.doi,
      abstract: input.abstract,
    });
  });

  it('makes BibTeX keys unique for multiple records with the same identity', () => {
    const bib = exportWorks([paper, paper], 'bibtex');
    const keys = [...bib.matchAll(/@article\{([^,]+)/g)].map((match) => match[1]);
    expect(new Set(keys).size).toBe(2);
  });

  it('preserves corporate authors containing the author separator in CSV and BibTeX', () => {
    const input = work({ authors: ['Research and Development Group'] });
    expect(importWorks(exportWorks([input], 'bibtex'), 'works.bib')[0].authors).toEqual(
      input.authors,
    );
    expect(importWorks(exportWorks([input], 'csv'), 'works.csv')[0].authors).toEqual(input.authors);
  });

  it('round-trips RIS metadata and flattens newline tag injection', () => {
    const ris = exportWorks(
      [paper, work({ id: 'second', title: 'Ordinary title\nER  - \nTY  - BOOK' })],
      'ris',
    );
    const papers = importWorks(ris, 'works.ris');
    expect(papers).toHaveLength(2);
    expect(papers[0]).toMatchObject({
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      doi: paper.doi,
      venue: paper.venue,
      abstract: 'One line. A second line.',
      tags: paper.tags,
      citations: null,
    });
  });

  it('imports RIS continuation lines and alternative metadata tags', () => {
    const papers = importWorks(
      'TY  - JOUR\nT1  - A paper\nA1  - Smith, Jane\nY1  - 2023/01/01\nJF  - Journal\nN2  - First line\n      continuation\nER  -',
      'references.ris',
    );
    expect(papers[0]).toMatchObject({
      title: 'A paper',
      authors: ['Smith, Jane'],
      year: 2023,
      venue: 'Journal',
      abstract: 'First line\ncontinuation',
    });
  });

  it('validates untrusted values and rejects executable URL schemes', () => {
    const papers = importWorks(
      JSON.stringify([
        {
          ...paper,
          year: -1,
          citations: 'NaN',
          url: 'javascript:alert(1)',
          doi: '',
          openAccessUrl: 'file:///private/file',
          included: 'false',
          authors: ['Valid', { name: 'invalid' }],
          provenance: [
            { source: 'made-up', citations: 100 },
            { source: 'pubmed', citations: -1, url: 'data:text/html,x' },
          ],
        },
      ]),
      'works.json',
    );
    expect(papers[0]).toMatchObject({
      year: null,
      citations: null,
      url: '',
      openAccessUrl: '',
      included: false,
      authors: ['Valid'],
      provenance: [{ source: 'pubmed', sourceId: '', citations: null, url: '', retrievedAt: '' }],
    });
  });

  it('disambiguates duplicate imported IDs for reliable selection', () => {
    const papers = importWorks(JSON.stringify([paper, paper]), 'works.json');
    expect(papers[0].id).not.toBe(papers[1].id);
  });

  it('rejects broken and unsupported input with useful errors', () => {
    expect(() => importWorks('', 'empty.csv')).toThrow('empty');
    expect(() => importWorks('{}', 'backup.json')).toThrow('Restore backup');
    expect(() => importWorks('[null]', 'works.json')).toThrow('publication object');
    expect(() => importWorks('[{}]', 'works.json')).toThrow('title');
    expect(() => importWorks('Title,Year\n"open quote,2020', 'works.csv')).toThrow('not closed');
    expect(() => importWorks('Title,Year\nOne,2020,Extra', 'works.csv')).toThrow('fields');
    expect(() => importWorks('@article{one,title={unclosed}', 'works.bib')).toThrow('not closed');
    expect(() => importWorks('TY  - JOUR\nTI  - Missing ending', 'works.ris')).toThrow(
      'missing ER',
    );
    expect(() => importWorks('x'.repeat(25 * 1024 * 1024 + 1), 'large.csv')).toThrow('25 MB');
    expect(() =>
      importWorks(JSON.stringify(Array(20_001).fill({ title: 'Title' })), 'large.json'),
    ).toThrow('20,000');
  });
});

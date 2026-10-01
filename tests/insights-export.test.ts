import { describe, expect, it } from 'vitest';
import { analyzeInsights, exportInsights } from '../src/core/insights';
import { parseCsv } from '../src/core/formats';
import { APP_VERSION } from '../src/version';
import type { Work } from '../src/types';
import { settings, snapshot, work } from './insights-helpers';

const provenance = (source: 'openalex' | 'crossref', citations: number, retrievedAt: string) => ({
  source,
  sourceId: `${source}-id`,
  citations,
  retrievedAt,
  url: '',
});

describe('Insights CSV and TSV exports', () => {
  const big = ['A', 'B', 'Jane Scholar', 'D', 'E', 'F', 'G'];
  const works = [
    work('noisy', { authors: big, citations: 544 }),
    work('noisy2', { authors: big, citations: 247 }),
    work('noisy3', { authors: big, citations: 117 }),
    work('first', { authors: ['Jane Scholar', 'B'], citations: 62 }),
  ];
  const analysis = analyzeInsights(works, settings(), 'all');

  it.each(['csv', 'tsv'] as const)('starts the %s with a UTF-8 byte-order mark', (format) => {
    expect(exportInsights(analysis, settings(), 'all', format).charCodeAt(0)).toBe(0xfeff);
  });

  it('round-trips names with diacritics through the CSV reader', () => {
    const accented = analyzeInsights(
      [work('x', { title: 'Étude sur Łódź', authors: ['Łukasz Nowak', 'Bjørn Dæhlen'] })],
      settings({ author: 'Łukasz Nowak' }),
      'all',
    );
    const text = exportInsights(accented, settings({ author: 'Łukasz Nowak' }), 'all', 'csv');
    const [row] = parseCsv(text.replace(/^\uFEFF/, ''), ',', false);
    expect(row.author).toBe('Łukasz Nowak');
    expect(row.title).toBe('Étude sur Łódź');
  });

  it('writes weights and weighted citations without floating-point noise', () => {
    // 544 x 0.1, 247 x 0.1 and 117 x 0.1 are 54.400000000000006, 24.700000000000003, ...
    expect(analysis.rows[0].adjusted).not.toBe(54.4);
    const rows = parseCsv(
      exportInsights(analysis, settings(), 'all', 'csv').replace(/^\uFEFF/, ''),
      ',',
      false,
    );
    expect(rows.map((r) => r.adjustedcitations)).toEqual(['54.4', '24.7', '11.7', '55.8']);
    expect(rows.map((r) => r.weight)).toEqual(['0.1', '0.1', '0.1', '0.9']);
  });

  it('still escapes spreadsheet formulas', () => {
    const risky = analyzeInsights([work('x', { title: '=HYPERLINK("bad")' })], settings(), 'all');
    expect(exportInsights(risky, settings(), 'all', 'tsv')).toContain('"\'=HYPERLINK');
  });
});

describe('Insights JSON export', () => {
  const secret: Partial<Work> = {
    notes: 'PRIVATE NOTE about a reviewer',
    tags: ['private-tag'],
    abstract: 'A long abstract. '.repeat(200),
    snippet: 'a snippet',
    url: 'https://example.org/private',
  };
  const works = [
    work('one', {
      ...secret,
      authors: ['Jane Scholar', 'Alex Other'],
      citations: 12,
      venue: 'Journal of Research',
      provenance: [provenance('openalex', 12, '2026-03-01T10:00:00Z')],
    }),
    work('two', {
      ...secret,
      authors: ['A', 'B', 'Jane Scholar', 'D', 'E', 'F', 'G'],
      citations: 544,
      provenance: [
        provenance('crossref', 544, '2026-09-14T08:30:00Z'),
        provenance('openalex', 500, '2026-03-02T10:00:00Z'),
      ],
    }),
  ];
  const config = settings({ yearFrom: 2019, yearTo: 2024, lensConvention: true });
  const analysis = analyzeInsights(works, config, 'all');
  const context = {
    snapshot: {
      name: 'Jane Scholar',
      query: {
        text: 'Jane Scholar',
        mode: 'author' as const,
        sources: ['openalex' as const, 'crossref' as const],
        yearFrom: 2019,
        yearTo: 2024,
        limit: 50,
      },
      searchedAt: '2026-09-14T08:30:00Z',
      sourceResults: [
        { source: 'openalex' as const, total: 40 },
        { source: 'crossref' as const, total: 12, warning: 'One record was skipped.' },
      ],
    },
  };
  const exported = JSON.parse(exportInsights(analysis, config, 'all', 'json', context));

  it('carries a reproducibility header', () => {
    expect(exported.header).toMatchObject({
      application: 'Academic Publication Tracker',
      appVersion: APP_VERSION,
      citationSource: 'all',
      author: 'Jane Scholar',
      yearRange: { from: 2019, to: 2024 },
      snapshot: {
        name: 'Jane Scholar',
        searchedAt: '2026-09-14T08:30:00Z',
        query: {
          text: 'Jane Scholar',
          mode: 'author',
          sources: ['openalex', 'crossref'],
          limit: 50,
        },
        sourceResults: [
          { source: 'openalex', total: 40 },
          { source: 'crossref', total: 12, warning: 'One record was skipped.' },
        ],
      },
      retrieval: {
        earliest: '2026-03-01T10:00:00Z',
        latest: '2026-09-14T08:30:00Z',
        sources: ['crossref', 'openalex'],
      },
    });
    expect(Date.parse(exported.header.exportedAt)).not.toBeNaN();
  });

  it('states the weighting convention, including the last-author setting', () => {
    expect(exported.header.weighting).toMatchObject({
      lastAuthorConvention: true,
      weights: {
        soleOrCorresponding: 1,
        first: 0.9,
        second: 0.5,
        otherSmallTeam: 0.25,
        otherLargeTeam: 0.1,
      },
    });
    expect(JSON.stringify(exported.header.weighting)).toMatch(/six/i);
  });

  it('lists per-paper summaries and no private or bulky record fields', () => {
    expect(exported.analysis.rows).toHaveLength(2);
    expect(exported.analysis.rows[1]).toMatchObject({
      key: '10.1234/two',
      title: 'Research paper two',
      year: 2020,
      role: 'middle',
      weight: 0.1,
      citations: 544,
      adjusted: 54.4,
      authorCount: 7,
      authorsComplete: true,
    });
    const text = JSON.stringify(exported);
    for (const leaked of [
      'PRIVATE NOTE',
      'private-tag',
      'A long abstract',
      'a snippet',
      'example.org/private',
    ])
      expect(text).not.toContain(leaked);
    expect(exported.analysis.rows[0]).not.toHaveProperty('work');
    expect(exported.settings).toMatchObject({ author: 'Jane Scholar', lensConvention: true });
    expect(exported.source).toBe('all');
  });

  it('keeps the summary statistics and rounds them', () => {
    expect(exported.analysis).toMatchObject({ papers: 2, classified: 2, hIndex: 2 });
    expect(exported.analysis.groups.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported)).not.toMatch(/\d\.\d{7,}/);
  });

  it('omits the snapshot when the caller does not know it and still names the data sources', () => {
    const bare = JSON.parse(exportInsights(analysis, config, 'all', 'json'));
    expect(bare.header.snapshot).toBeNull();
    expect(bare.header.retrieval.sources).toEqual(['crossref', 'openalex']);
  });

  it('stays far below the export size limit for 20,000 papers with abstracts and notes', () => {
    const many = Array.from({ length: 20000 }, (_, i) =>
      work(`p${i}`, {
        ...secret,
        title: `A reasonably long paper title about something ${i}`,
        authors: ['Jane Scholar', 'B C', 'D E', 'F G'],
        provenance: [provenance('openalex', 5, '2026-01-01T00:00:00Z')],
      }),
    );
    const big = analyzeInsights(many, settings(), 'all');
    const text = exportInsights(big, settings(), 'all', 'json', { snapshot: snapshot });
    expect(text.length).toBeLessThan(15 * 1024 * 1024);
    expect(JSON.parse(text).analysis.rows).toHaveLength(20000);
  });

  it('still reports retractions in the summary', () => {
    const notice = {
      doi: '10.1234/one',
      status: 'Retraction',
      reason: 'Error',
      date: '2025-01-01',
      source: 'Test',
    };
    const flagged = analyzeInsights([works[0]], settings({ retractions: [notice] }), 'all');
    const parsed = JSON.parse(
      exportInsights(flagged, settings({ retractions: [notice] }), 'all', 'json'),
    );
    expect(parsed.analysis.retracted).toBe(1);
    expect(parsed.settings.retractions).toEqual([notice]);
  });
});

import { describe, expect, it } from 'vitest';
import type { InsightsSettings, Snapshot, Work } from '../src/types';
import { analyzeInsights, exportInsights, hIndex } from '../src/core/insights';
import { defaultInsights, importInsightsData, validateInsights } from '../src/core/insights-data';
import { exportWorks, importWorks } from '../src/core/formats';
import { validateWorkspace } from '../src/core/workspace';
import { mergeWorks } from '../src/core/merge';

const work = (id: string, extra: Partial<Work> = {}): Work => ({
  id,
  title: `Research paper ${id}`,
  authors: ['Jane Scholar', 'Alex Other'],
  year: 2020,
  venue: 'Research',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 10,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...extra,
});
const snapshot: Snapshot = {
  id: 'snapshot',
  name: 'Imported',
  query: { text: 'papers.csv', mode: 'topic', sources: [], limit: 10 },
  searchedAt: '2026-09-16T00:00:00Z',
  sourceResults: [],
  works: [work('one')],
};
const settings = (extra: Partial<InsightsSettings> = {}): InsightsSettings => ({
  ...defaultInsights(snapshot),
  author: 'Jane Scholar',
  ...extra,
});

describe('local research insights', () => {
  it('imports tab-separated publication data for local analysis', () => {
    const records = importWorks(
      'Title\tAuthors\tYear\tCitations\nA saved publication\tJane Scholar; Alex Other\t2024\t3',
      'publications.tsv',
    );
    expect(analyzeInsights(records, settings(), 'all')).toMatchObject({
      papers: 1,
      classified: 1,
      totalCitations: 3,
    });
  });
  it('computes disjoint roles, raw and weighted h indices, and share denominators including unmatched papers', () => {
    const works = [
      work('sole', { authors: ['Scholar, Jane'], citations: 4 }),
      work('first', { citations: 10 }),
      work('second', { authors: ['A', 'Jane Scholar', 'C'], citations: 8 }),
      work('middle', { authors: ['A', 'B', 'Jane Scholar', 'D', 'E', 'F'], citations: 8 }),
      work('large', { authors: ['A', 'B', 'Jane Scholar', 'D', 'E', 'F', 'G'], citations: 10 }),
      work('last', { authors: ['A', 'Jane Scholar'], citations: 8 }),
      work('missing', { authors: ['Someone Else'], citations: 12 }),
      work('unknown', { citations: null }),
      work('zero', { citations: 0 }),
      work('excluded', { included: false, citations: 900 }),
    ];
    const result = analyzeInsights(works, settings(), 'all');
    expect(result).toMatchObject({
      papers: 9,
      classified: 8,
      citationCoverage: 8,
      totalCitations: 60,
      shIndex: 3,
      zeroCitations: 1,
    });
    expect(result.rows.map((r) => r.adjusted)).toEqual([4, 9, 4, 2, 1, 2, null, null, 0]);
    expect(result.groups.reduce((sum, g) => sum + g.publicationShare, 0)).toBeCloseTo(100);
    expect(result.groups.reduce((sum, g) => sum + (g.citationShare ?? 0), 0)).toBeCloseTo(100);
    expect(result.groups.find((g) => g.role === 'middle')).toMatchObject({
      papers: 2,
      median: 9,
      q1: 8.5,
      q3: 9.5,
      hIndex: 2,
      weightedH: 1,
    });
    expect(
      analyzeInsights(works, settings({ lensConvention: true }), 'all').rows.find(
        (r) => r.work.id === 'last',
      )?.adjusted,
    ).toBe(8);
    expect(hIndex([1.8, 1.8, 1.8])).toBe(1);
  });
  it('matches compatible initials, uses known early positions and rejects ambiguous names', () => {
    const works = [
      work('initial', { authors: ['J. Scholar', 'Other Person'] }),
      work('ambiguous', { authors: ['Jane Scholar', 'J. Scholar'] }),
      work('truncated', { authors: ['Jane Scholar', 'Other …'] }),
      work('legacy', {
        provenance: [
          { source: 'scholar', sourceId: 'x', citations: 10, retrievedAt: '2026-09-16', url: '' },
        ],
      }),
      work('accent', { authors: ['Schólar, Jane'] }),
    ];
    const first = analyzeInsights(works, settings(), 'all');
    expect(first.rows.map((r) => r.role)).toEqual([
      'first',
      'unclassified',
      'first',
      'first',
      'sole',
    ]);
    const confirmed = analyzeInsights(
      works,
      settings({
        aliases: ['J Scholar'],
        annotations: [
          {
            key: '10.1234/legacy',
            authors: ['Jane Scholar', 'Other Person'],
            complete: true,
            role: 'corresponding',
          },
        ],
      }),
      'all',
    );
    expect(confirmed.rows.map((r) => r.role)).toEqual([
      'first',
      'unclassified',
      'first',
      'corresponding',
      'sole',
    ]);
    expect(confirmed.rows[3].weight).toBe(1);
  });
  it('matches compact Scholar initials without confusing conflicting names or guessing last position', () => {
    const config = settings({ author: 'austin g meyer' });
    const papers = [
      work('full', { authors: ['AG Meyer', 'Other Author'] }),
      work('partial-first', { authors: ['AG Meyer', 'Other Author'], authorsComplete: false }),
      work('partial-second', { authors: ['Other Author', 'AG Meyer'], authorsComplete: false }),
      work('partial-later', {
        authors: ['Other Author', 'Another Author', 'AG Meyer'],
        authorsComplete: false,
      }),
      work('conflict', { authors: ['AB Meyer', 'Other Author'] }),
      work('different-full', { authors: ['Alex George Meyer', 'Other Author'] }),
      work('ambiguous', { authors: ['AG Meyer', 'Austin G Meyer'] }),
    ];
    const analysis = analyzeInsights(papers, config, 'all');
    expect(analysis.rows.map((r) => r.role)).toEqual([
      'first',
      'first',
      'second',
      'unclassified',
      'unclassified',
      'unclassified',
      'unclassified',
    ]);
    expect(analysis.initialMatches).toBe(3);
    expect(analysis.rows[2].weight).toBe(0.5);
    expect(analysis.rows[3].weight).toBeNull();
    expect(
      analyzeInsights(
        [papers[0]],
        settings({ author: 'Austin G Meyer', aliases: ['AG Meyer'] }),
        'all',
      ).initialMatches,
    ).toBe(0);
  });
  it('keeps unknown citation values distinct from zero and respects source and publication-year filters', () => {
    const works = [
      work('one', {
        provenance: [
          { source: 'crossref', sourceId: 'one', citations: 0, retrievedAt: '2026-09-16', url: '' },
        ],
      }),
      work('two', { year: 2024 }),
      work('undated', { year: null }),
    ];
    const result = analyzeInsights(works, settings({ yearFrom: 2020, yearTo: 2021 }), 'crossref');
    expect(result).toMatchObject({ papers: 1, citationCoverage: 1, zeroCitations: 1, median: 0 });
    expect(result.groups.find((g) => g.role === 'first')?.citationShare).toBeNull();
    const missing = analyzeInsights(works, settings(), 'pubmed');
    expect(missing).toMatchObject({
      citationCoverage: 0,
      zeroCitations: 0,
      median: null,
      weightedCoverage: 0,
    });
  });
  it('aggregates actual annual history per source without summing overlapping database counts', () => {
    const works = [
      work('one', {
        citationHistory: [
          { year: 2024, citations: 3, source: 'openalex' },
          { year: 2025, citations: 4, source: 'openalex' },
        ],
      }),
      work('two'),
    ];
    const config = settings({
      annualCitations: [
        { key: '10.1234/one', year: 2024, citations: 7, source: 'scholar' },
        { key: '10.1234/two', year: 2024, citations: 0, source: 'scholar' },
        { key: '10.1234/one', year: 2025, citations: 2, source: 'openalex' },
      ],
    });
    expect(analyzeInsights(works, config, 'all').annual).toEqual([
      { year: 2024, citations: 7, coverage: 2, papers: 2 },
      { year: 2025, citations: 2, coverage: 1, papers: 2 },
    ]);
    expect(analyzeInsights(works, config, 'openalex').annual[0]).toMatchObject({
      citations: 3,
      coverage: 1,
    });
    expect(analyzeInsights(works, config, 'pubmed').annual).toEqual([]);
    expect(
      analyzeInsights(
        works.map((w) => ({ ...w, included: false })),
        config,
        'all',
      ).annual,
    ).toEqual([]);
  });
  it('uses exact year/venue quartiles and keeps conflicting categories unknown', () => {
    const ranks: InsightsSettings['journalRanks'] = [
      { venue: 'Research', year: 2020, category: 'Medicine', quartile: 'Q1', source: 'Test' },
    ];
    expect(
      analyzeInsights([work('one')], settings({ journalRanks: ranks }), 'all').rows[0].quartile,
    ).toBe('Q1');
    expect(
      analyzeInsights([work('one', { year: 2021 })], settings({ journalRanks: ranks }), 'all')
        .rows[0].quartile,
    ).toBe('Unknown');
    ranks.push({ ...ranks[0], category: 'Biology', quartile: 'Q2' });
    expect(
      analyzeInsights([work('one')], settings({ journalRanks: ranks }), 'all').rows[0],
    ).toMatchObject({ quartile: 'Unknown', rankConflict: true });
  });
  it('imports all four datasets, updates keyed records and matches Retraction Watch by original DOI', () => {
    let config = settings();
    const works = [work('one')];
    config = importInsightsData(
      config,
      'authors',
      'key,authors,complete,role\none,Jane Scholar; Other Person,true,corresponding',
      works,
    ).settings;
    config = importInsightsData(
      config,
      'annual',
      'key\tyear\tcitations\tsource\none\t2025\t4\tscholar',
      works,
    ).settings;
    config = importInsightsData(
      config,
      'annual',
      'key,year,citations,source\none,2025,5,scholar',
      works,
    ).settings;
    config = importInsightsData(
      config,
      'rankings',
      'venue,year,category,quartile,source\nResearch,2020,Medicine,Q1,Test',
      works,
    ).settings;
    const imported = importInsightsData(
      config,
      'retractions',
      'OriginalPaperDOI,RetractionNature,Reason,RetractionDate\nhttps://doi.org/10.1234/ONE,Retraction,Error,2025-01-01\n10.1234/unmatched,Retraction,Error,2025-01-01',
      works,
    );
    expect(imported).toMatchObject({ count: 1, skipped: 1 });
    config = imported.settings;
    expect(config.annualCitations).toHaveLength(1);
    const analysis = analyzeInsights(works, config, 'all');
    expect(analysis.rows[0]).toMatchObject({ role: 'corresponding', quartile: 'Q1' });
    expect(analysis).toMatchObject({ retracted: 1, annual: [{ citations: 5 }] });
    const backup = { ...snapshot, insights: config };
    expect(
      validateWorkspace(
        JSON.parse(JSON.stringify({ version: 1, activeId: backup.id, snapshots: [backup] })),
      ).snapshots[0].insights,
    ).toEqual(config);
    expect(JSON.parse(exportInsights(analysis, config, 'all', 'json')).analysis.retracted).toBe(1);
    expect(exportInsights(analysis, config, 'all', 'tsv')).toContain('"corresponding"');
  });
  it('does not call a correction or an expression of concern a retraction', () => {
    const config = settings({
      retractions: [
        { doi: '10.1234/one', status: 'Correction', reason: '', date: '', source: 'Test' },
      ],
    });
    expect(analyzeInsights([work('one')], config, 'all')).toMatchObject({
      retracted: 0,
      rows: [{ notices: [{ status: 'Correction' }] }],
    });
  });
  it('rejects malformed, duplicate and unmatched imports without changing saved data', () => {
    const config = settings();
    for (const content of [
      'key,year,citations,source\none,2025,-1,scholar',
      'key,year,citations,source\none,2025,2,unknown',
      'key,year,citations,source\none,2025,2,scholar\none,2025,3,scholar',
      'key,year,citations,source\nmissing,2025,2,scholar',
    ])
      expect(() => importInsightsData(config, 'annual', content, [work('one')])).toThrow();
    expect(() => validateInsights({ ...config, yearFrom: 2025, yearTo: 2020 })).toThrow();
    expect(config.annualCitations).toEqual([]);
  });
  it('preserves completeness and native history through CSV/JSON exports and merges', () => {
    const paper = work('one', {
      authorsComplete: false,
      citationHistory: [{ year: 2025, citations: 4, source: 'openalex' }],
    });
    for (const format of ['csv', 'json'] as const)
      expect(importWorks(exportWorks([paper], format), `papers.${format}`)[0]).toMatchObject({
        authorsComplete: false,
        citationHistory: paper.citationHistory,
      });
    expect(
      mergeWorks([paper, work('two', { doi: paper.doi, authors: ['Jane Scholar'] })])[0],
    ).toMatchObject({ authorsComplete: true, citationHistory: paper.citationHistory });
  });
  it('escapes spreadsheet formulas in analysis exports', () => {
    const data = analyzeInsights([work('one', { title: '=HYPERLINK("bad")' })], settings(), 'all');
    expect(exportInsights(data, settings(), 'all', 'csv')).toContain('"\'=HYPERLINK');
  });
});

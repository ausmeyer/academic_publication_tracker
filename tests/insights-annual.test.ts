import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { importInsightsData } from '../src/core/insights-data';
import type { InsightsSettings } from '../src/types';
import { settings, work } from './insights-helpers';

const annual = (key: string, year: number, citations: number, source = 'scholar') =>
  ({ key, year, citations, source }) as InsightsSettings['annualCitations'][number];

describe('annual citation coverage', () => {
  const works = [
    work('old', { year: 2010 }),
    work('mid', { year: 2015 }),
    work('new', { year: 2020 }),
  ];

  it('counts only papers already published in a calendar year as that year’s denominator', () => {
    const result = analyzeInsights(
      works,
      settings({
        annualCitations: [
          annual('10.1234/old', 2012, 4),
          annual('10.1234/old', 2016, 3),
          annual('10.1234/mid', 2016, 2),
          annual('10.1234/old', 2022, 1),
          annual('10.1234/mid', 2022, 1),
          annual('10.1234/new', 2022, 1),
        ],
      }),
      'all',
      2026,
    );
    expect(result.annual).toEqual([
      { year: 2012, citations: 4, coverage: 1, papers: 1 },
      { year: 2016, citations: 5, coverage: 2, papers: 2 },
      { year: 2022, citations: 3, coverage: 3, papers: 3 },
    ]);
    expect(result.annualIgnored).toBe(0);
  });

  it('applies the publication-year range to the denominators', () => {
    const result = analyzeInsights(
      works,
      settings({
        yearFrom: 2015,
        annualCitations: [annual('10.1234/mid', 2016, 2), annual('10.1234/old', 2016, 9)],
      }),
      'all',
      2026,
    );
    expect(result.annual).toEqual([{ year: 2016, citations: 2, coverage: 1, papers: 1 }]);
  });

  it('keeps undated papers out of the annual series and counts them', () => {
    const undated = work('undated', { year: null });
    const result = analyzeInsights(
      [...works, undated],
      settings({
        annualCitations: [annual('10.1234/old', 2012, 4), annual('10.1234/undated', 2012, 7)],
      }),
      'all',
      2026,
    );
    expect(result.annual).toEqual([{ year: 2012, citations: 4, coverage: 1, papers: 1 }]);
    expect(result.undatedPapers).toBe(1);
  });

  it('ignores rows before a paper existed or after the current year', () => {
    const result = analyzeInsights(
      [work('p', { year: 2020 })],
      settings({
        annualCitations: [
          annual('10.1234/p', 2016, 9),
          annual('10.1234/p', 2021, 3),
          annual('10.1234/p', 2999, 5),
        ],
      }),
      'all',
      2026,
    );
    expect(result.annual).toEqual([{ year: 2021, citations: 3, coverage: 1, papers: 1 }]);
    expect(result.annualIgnored).toBe(2);
  });

  it('accepts a row for the current year, which is a year to date', () => {
    const result = analyzeInsights(
      [work('p', { year: 2020 })],
      settings({ annualCitations: [annual('10.1234/p', 2026, 3)] }),
      'all',
      2026,
    );
    expect(result.annual).toEqual([{ year: 2026, citations: 3, coverage: 1, papers: 1 }]);
  });

  it('applies the same rules to a source’s own citation history', () => {
    const result = analyzeInsights(
      [
        work('p', {
          year: 2020,
          citationHistory: [
            { year: 2015, citations: 50, source: 'openalex' },
            { year: 2023, citations: 6, source: 'openalex' },
          ],
        }),
      ],
      settings(),
      'openalex',
      2026,
    );
    expect(result.annual).toEqual([{ year: 2023, citations: 6, coverage: 1, papers: 1 }]);
  });
});

describe('the year range and undated papers', () => {
  const works = [
    work('dated', { year: 2021 }),
    work('undated-1', { year: null }),
    work('undated-2', { year: null }),
    work('hidden', { year: null, included: false }),
  ];

  it('reports the undated papers a year bound removes', () => {
    expect(analyzeInsights(works, settings({ yearFrom: 2020 }), 'all').undatedExcluded).toBe(2);
    expect(analyzeInsights(works, settings({ yearTo: 2030 }), 'all').undatedExcluded).toBe(2);
    expect(analyzeInsights(works, settings({ yearFrom: 2020 }), 'all').papers).toBe(1);
  });

  it('reports nothing when no year bound is set and keeps the undated papers', () => {
    const result = analyzeInsights(works, settings(), 'all');
    expect(result.undatedExcluded).toBe(0);
    expect(result.papers).toBe(3);
    expect(result.undatedPapers).toBe(2);
  });
});

describe('importing annual citation counts', () => {
  const works = [work('p', { year: 2020 }), work('undated', { year: null })];
  const csv = (rows: string[]) => ['key,year,citations,source', ...rows].join('\n');

  it('rejects a year after the current year and names it', () => {
    expect(() =>
      importInsightsData(settings(), 'annual', csv(['p,2999,5,scholar']), works, 2026),
    ).toThrow(/2999.*after 2026|after 2026.*2999/);
  });

  it('accepts the current year', () => {
    const result = importInsightsData(settings(), 'annual', csv(['p,2026,5,scholar']), works, 2026);
    expect(result.settings.annualCitations).toHaveLength(1);
  });

  it('ignores rows dated before the paper’s publication year and counts them', () => {
    const result = importInsightsData(
      settings(),
      'annual',
      csv(['p,2016,9,scholar', 'p,2021,3,scholar']),
      works,
      2026,
    );
    expect(result.settings.annualCitations).toEqual([annual('10.1234/p', 2021, 3)]);
    expect(result).toMatchObject({ count: 1, ignored: 1, skipped: 0 });
  });

  it('keeps rows for papers without a year, which cannot be checked', () => {
    const result = importInsightsData(
      settings(),
      'annual',
      csv(['undated,2001,1,scholar']),
      works,
      2026,
    );
    expect(result.settings.annualCitations).toHaveLength(1);
    expect(result.ignored).toBe(0);
  });

  it('does not fail when every row was dated before publication', () => {
    const result = importInsightsData(settings(), 'annual', csv(['p,2010,1,scholar']), works, 2026);
    expect(result).toMatchObject({ count: 0, ignored: 1 });
    expect(result.settings.annualCitations).toEqual([]);
  });

  it('still fails when no row matches the snapshot', () => {
    expect(() =>
      importInsightsData(settings(), 'annual', csv(['zzz,2021,1,scholar']), works, 2026),
    ).toThrow(/No records match/);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeInsights, exportInsights } from '../src/core/insights';
import { calculateMetrics } from '../src/core/metrics';
import { settings, work } from './insights-helpers';

describe('the publication-year range', () => {
  const works = [2018, 2019, 2020, 2021, 2022].map((year) =>
    work(`y${year}`, { year, venue: `Journal ${year}`, citations: year - 2000 }),
  );
  const ranks = works.map((w) => ({
    venue: w.venue,
    year: w.year as number,
    category: 'Medicine',
    quartile: 'Q1' as const,
    source: 'SJR',
  }));
  const history = works.map((w) => ({
    key: `10.1234/y${w.year}`,
    year: 2025,
    citations: 3,
    source: 'scholar' as const,
  }));
  const config = settings({
    yearFrom: 2020,
    yearTo: 2021,
    journalRanks: ranks,
    annualCitations: history,
  });
  const analysis = analyzeInsights(works, config, 'all', 2026);

  it('is inclusive at both ends', () => {
    expect(analysis.rows.map((r) => r.work.year)).toEqual([2020, 2021]);
    expect(analyzeInsights(works, settings({ yearFrom: 2020, yearTo: 2020 }), 'all').papers).toBe(
      1,
    );
  });

  it('applies to the statistics, role groups, quartiles, annual series and exports alike', () => {
    expect(analysis).toMatchObject({ papers: 2, totalCitations: 20 + 21, citationCoverage: 2 });
    expect(analysis.groups.reduce((sum, g) => sum + g.papers, 0)).toBe(2);
    expect(analysis.groups.flatMap((g) => g.quartiles).reduce((sum, q) => sum + q.papers, 0)).toBe(
      2,
    );
    expect(analysis.annual).toEqual([{ year: 2025, citations: 6, coverage: 2, papers: 2 }]);
    const csv = exportInsights(analysis, config, 'all', 'csv').split('\r\n');
    expect(csv).toHaveLength(3);
    expect(JSON.parse(exportInsights(analysis, config, 'all', 'json')).analysis.rows).toHaveLength(
      2,
    );
  });

  it('gives the charts the same papers as the statistics', () => {
    const metrics = calculateMetrics(
      analysis.rows.map((r) => r.work),
      'all',
      2026,
    );
    expect(metrics.years.map((y) => y.year)).toEqual([2020, 2021]);
    expect(metrics.papers).toBe(analysis.papers);
  });
});

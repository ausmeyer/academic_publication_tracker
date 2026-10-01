import { describe, expect, it } from 'vitest';
import { calculateMetrics, chartYears } from '../src/core/metrics';
import { work } from './insights-helpers';

const papers = (years: number[]) => years.map((year, i) => work(`w${i}`, { year, citations: 12 }));
const span = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const drawn = (metrics: ReturnType<typeof calculateMetrics>) =>
  chartYears(metrics.years, (year) => ({ year, papers: 0, citations: 0, coverage: 0 }), 2026).years;

describe('the per-year metrics and the timeline use the same years', () => {
  it('a year the timeline leaves out as mistyped does not stretch citations per year', () => {
    const m = calculateMetrics(papers([1004, 2999, ...span(2008, 2019)]), 'all', 2026);
    expect(drawn(m)[0].year).toBe(2008);
    // 168 citations since 2008 (19 years), not over the 1,023 years since 1004.
    expect({ firstYear: m.firstYear, lastYear: m.lastYear }).toEqual({
      firstYear: 2008,
      lastYear: 2019,
    });
    expect(m.citationsPerYear).toBeCloseTo(168 / 19, 12);
    expect(m.annualizedH).toBeCloseTo(12 / 19, 12);
  });

  it('keeps a real publication record that ended long ago', () => {
    // The timeline draws 1850-1900, so the span starts in 1850.
    const m = calculateMetrics(papers([1850, 1875, 1900]), 'all', 2026);
    expect(drawn(m)[0].year).toBe(1850);
    expect(m.firstYear).toBe(1850);
    expect(m.citationsPerYear).toBeCloseTo(36 / (2026 - 1850 + 1), 12);
  });

  it('has no span when every year lies beyond next year', () => {
    const m = calculateMetrics(papers([2999]), 'all', 2026);
    expect({ firstYear: m.firstYear, perYear: m.citationsPerYear }).toEqual({
      firstYear: null,
      perYear: 0,
    });
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Charts from '../src/components/Charts';
import { calculateMetrics, chartYears } from '../src/core/metrics';
import { work } from './insights-helpers';

const row = (year: number) => ({ year, papers: 1, citations: 2, coverage: 1 });
const empty = (year: number) => ({ year, papers: 0, citations: 0, coverage: 0 });
const span = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const drawn = (years: number[], currentYear = 2026) => {
  const { years: columns, omitted } = chartYears(years.map(row), empty, currentYear);
  return { columns: columns.map((y) => y.year), omitted: omitted.map((y) => y.year) };
};

describe('the chart year axis around mistyped years', () => {
  it('draws only the real years when one year is far in the past and one far in the future', () => {
    expect(drawn([1004, 2999, ...span(2008, 2019)])).toEqual({
      columns: span(2008, 2019),
      omitted: [1004, 2999],
    });
  });

  it('starts at the earliest year with data inside the widest axis', () => {
    expect(drawn([1004, 1990, 2025])).toEqual({ columns: span(1990, 2025), omitted: [1004] });
    expect(drawn([1900, 2025])).toEqual({ columns: [2025], omitted: [1900] });
  });

  it('still ends next year for papers dated ahead of publication', () => {
    expect(drawn([2024, 2027])).toEqual({ columns: span(2024, 2027), omitted: [] });
  });

  it('draws nothing when every year lies beyond next year', () => {
    expect(drawn([2999, 3000])).toEqual({ columns: [], omitted: [2999, 3000] });
  });

  it('names the years it leaves out, under a chart of the real years only', () => {
    const metrics = calculateMetrics(
      [1004, 2999, ...span(2008, 2019)].map((year, i) => work(`w${i}`, { year })),
      'all',
      2026,
    );
    const html = renderToStaticMarkup(createElement(Charts, { metrics, currentYear: 2026 }));
    expect([...html.matchAll(/class="year-column/g)]).toHaveLength(12);
    expect(html).toContain(
      '2 years with data (1004, 2999) fall outside the drawn range 2008–2019 and are not drawn.',
    );
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Charts from '../src/components/Charts';
import { calculateMetrics, chartYears, yearLabelStep } from '../src/core/metrics';
import { work } from './insights-helpers';

const row = (year: number, papers = 1) => ({
  year,
  papers,
  citations: papers * 2,
  coverage: papers,
});
const empty = (year: number) => ({ year, papers: 0, citations: 0, coverage: 0 });

describe('chart year axis', () => {
  it('fills the years without papers so a gap is drawn as a gap', () => {
    const { years, omitted } = chartYears(
      [2002, 2008, 2009, 2010, 2011, 2015].map((y) => row(y)),
      empty,
      2026,
    );
    expect(years.map((y) => y.year)).toEqual(Array.from({ length: 14 }, (_, i) => 2002 + i));
    expect(years.filter((y) => y.papers === 0).map((y) => y.year)).toEqual([
      2003, 2004, 2005, 2006, 2007, 2012, 2013, 2014,
    ]);
    expect(omitted).toEqual([]);
  });

  it('sorts rows and ignores years that are not calendar years', () => {
    const { years } = chartYears(
      [row(2012), row(0), row(-4), row(NaN), row(2010.5), row(2010)],
      empty,
      2026,
    );
    expect(years.map((y) => y.year)).toEqual([2010, 2011, 2012]);
    expect(chartYears([], empty, 2026)).toEqual({ years: [], omitted: [] });
  });

  it('does not stretch the axis across centuries for one mistyped year', () => {
    const { years, omitted } = chartYears([row(1018), row(2020), row(2021)], empty, 2026);
    expect(years.map((y) => y.year)).toEqual([2020, 2021]);
    expect(omitted.map((r) => r.year)).toEqual([1018]);
  });

  it('does not let a future year hide the real data', () => {
    const { years, omitted } = chartYears([row(2020), row(2021), row(2999)], empty, 2026);
    expect(years[0].year).toBe(2020);
    expect(years.at(-1)?.year).toBe(2021);
    expect(omitted.map((r) => r.year)).toEqual([2999]);
  });

  it('labels every year for short spans and thins out long spans by year value', () => {
    expect(yearLabelStep(1)).toBe(1);
    expect(yearLabelStep(12)).toBe(1);
    expect(yearLabelStep(14)).toBe(2);
    expect(yearLabelStep(40)).toBe(5);
    expect(yearLabelStep(100)).toBe(10);
    expect(yearLabelStep(120)).toBe(20);
    for (const count of [13, 25, 41, 77, 120])
      expect(count / yearLabelStep(count)).toBeLessThanOrEqual(10.5);
  });
});

describe('the publication timeline', () => {
  const render = (years: number[], extra: Record<string, unknown> = {}) => {
    const metrics = calculateMetrics(
      years.map((year, i) => work(`w${i}`, { year, citations: 3 })),
      'all',
      2026,
    );
    return renderToStaticMarkup(createElement(Charts, { metrics, currentYear: 2026, ...extra }));
  };
  const columns = (html: string) => [...html.matchAll(/class="year-column"/g)].length;
  const labels = (html: string) =>
    [...html.matchAll(/class="year-label"[^>]*>([^<]*)</g)].map((m) => m[1].trim()).filter(Boolean);

  it('draws one column per calendar year, including years with no papers', () => {
    const html = render([2002, 2008, 2009, 2010, 2011, 2015]);
    expect(columns(html)).toBe(14);
    expect(html).toContain('title="2003: 0 papers"');
    expect(html).toContain('title="2008: 1 paper"');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('chooses axis labels by year value, not by position', () => {
    const years = labels(render([2002, 2008, 2009, 2010, 2011, 2015])).map(Number);
    expect(years.every((y) => y % 2 === 0)).toBe(true);
    expect(years[0]).toBe(2002);
  });

  it('keeps the labels of a 40-year span readable', () => {
    const years = labels(render([1986, 2025])).map(Number);
    expect(years.length).toBeLessThanOrEqual(10);
    expect(years.every((y) => y % 5 === 0)).toBe(true);
  });

  it('keeps every bar on the page for a long span', () => {
    const html = render([1906, 2025]);
    expect(columns(html)).toBe(120);
    expect(html).toMatch(/class="year-chart"[^>]*style="[^"]*gap:\s*0/);
  });

  it('tells the reader when papers fall outside the drawn years', () => {
    expect(render([1018, 2020, 2021])).toMatch(/1 year with data \(1018\)[^<]*not drawn/i);
  });

  it('lists only real years in the accessible description', () => {
    const html = render([2002, 2008]);
    expect(html).toContain('aria-label="Papers by publication year: 2002: 1, 2008: 1"');
  });

  it('still says when there are no publication years', () => {
    expect(render([])).toContain('Publication years will appear here.');
  });
});

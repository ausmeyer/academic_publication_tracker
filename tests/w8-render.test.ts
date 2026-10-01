import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import type { InsightsSettings, SourceId, Work } from '../src/types';
import { settings, work } from './insights-helpers';

type Props = {
  analysis: ReturnType<typeof analyzeInsights>;
  settings: InsightsSettings;
  works: Work[];
  source: SourceId | 'all';
  onChange: (next: InsightsSettings) => boolean;
};
let LocalInsights: ComponentType<Props>;
beforeAll(async () => {
  // The bridge module looks at `window` when it is first imported.
  vi.stubGlobal('window', {});
  LocalInsights = (await import('../src/components/LocalInsights')).default as ComponentType<Props>;
});
const render = (works: Work[], config: InsightsSettings) =>
  renderToStaticMarkup(
    createElement(LocalInsights, {
      analysis: analyzeInsights(works, config, 'all'),
      settings: config,
      works,
      source: 'all',
      onChange: () => true,
    }),
  );
/** The visible text of the role chart, row by row (the chart's accessible name left out). */
const chartRows = (html: string) => {
  const chart = html.slice(html.indexOf('<div class="authorship-chart"'));
  return chart
    .slice(0, chart.indexOf('<p>'))
    .split('<div class="authorship-row">')
    .slice(1)
    .map((row) =>
      row
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    );
};

describe('the role and journal-quartile chart on screen', () => {
  const works = [
    work('a', { venue: 'Nature', authors: ['Jane Scholar', 'B One'] }),
    work('b', { venue: 'Cell', authors: ['Jane Scholar', 'B One'] }),
    work('c', { venue: 'Obscure', authors: ['Jane Scholar', 'B One'] }),
    work('d', { venue: 'Nature', authors: ['B One', 'C Two', 'Jane Scholar'] }),
    work('e', { venue: 'Cell', authors: ['B One', 'Jane Scholar'] }),
  ];
  const ranked = settings({
    journalRanks: [
      { venue: 'Nature', year: 2020, category: 'Multidisciplinary', quartile: 'Q1', source: 'SJR' },
      { venue: 'Cell', year: 2020, category: 'Biology', quartile: 'Q4', source: 'SJR' },
    ],
  });

  it('writes each bar’s split by quartile under it, so no quartile is told by colour alone', () => {
    expect(chartRows(render(works, ranked))).toEqual([
      'First author 3 publications · 30 citations 3 Q1 1 · Q4 1 · Unknown 1',
      'Last author 2 publications · 20 citations 2 Q1 1 · Q4 1',
    ]);
  });

  it('adds no split while no paper has a journal quartile', () => {
    expect(chartRows(render(works, settings()))).toEqual([
      'First author 3 publications · 30 citations 3',
      'Last author 2 publications · 20 citations 2',
    ]);
  });
});

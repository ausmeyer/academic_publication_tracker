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
const decode = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe('the role and journal-quartile chart', () => {
  const works = [
    work('a', { venue: 'Nature', authors: ['Jane Scholar', 'B One'] }),
    work('b', { venue: 'Cell', authors: ['Jane Scholar', 'B One'] }),
    work('c', { venue: 'Obscure', authors: ['Jane Scholar', 'B One'] }),
    work('d', { venue: 'Nature', authors: ['B One', 'C Two', 'Jane Scholar'] }),
  ];
  const ranked = settings({
    journalRanks: [
      { venue: 'Nature', year: 2020, category: 'Multidisciplinary', quartile: 'Q1', source: 'SJR' },
      { venue: 'Cell', year: 2020, category: 'Biology', quartile: 'Q4', source: 'SJR' },
    ],
  });

  it('describes every role and its quartile counts in words', () => {
    const label = decode(
      render(works, ranked).match(/class="authorship-chart[^"]*"[^>]*aria-label="([^"]*)"/)![1],
    );
    expect(label).toBe(
      'Publications by authorship role and journal quartile. First author: 3 publications (Q1 1, Q4 1, Unknown 1); Last author: 1 publication (Q1 1).',
    );
  });

  it('separates the quartile segments of a bar', () => {
    expect(render(works, ranked)).toContain('class="role-stack quartile-stack"');
  });
});

describe('the name-variant field', () => {
  it('does not suggest an initials-only variant, which would make namesakes exact matches', () => {
    const placeholder = render([work('a')], settings()).match(
      /placeholder="([^"]*)"[^>]*name="aliases"/,
    )![1];
    for (const example of placeholder.split(';'))
      expect(example.trim()).toMatch(/\p{L}{2,}.*\s.*\p{L}{2,}/u);
  });
});

describe('the headline metric cards', () => {
  const values = async (works: Work[]) => {
    const { default: Metrics } = await import('../src/components/Metrics');
    const { calculateMetrics } = await import('../src/core/metrics');
    const html = renderToStaticMarkup(
      createElement(Metrics, { metrics: calculateMetrics(works), excluded: 0, onHelp: () => {} }),
    );
    return [...html.matchAll(/class="metric-value">(.*?)<\/(?:div|span)>/g)].map((m) =>
      m[1].replace(/<span class="metric-unit">/, ' '),
    );
  };

  it('shows citation measures as unknown, not zero, while no paper has a count', async () => {
    const unknown = [work('a', { citations: null }), work('b', { citations: null })];
    expect(await values(unknown)).toEqual(['2', '—', '—', '—']);
    expect(await values([])).toEqual(['0', '—', '—', '—']);
  });

  it('still shows real zeros once a count is known', async () => {
    expect(await values([work('a', { citations: 0 }), work('b', { citations: null })])).toEqual([
      '2',
      '0',
      '0 h',
      '0 g',
    ]);
  });
});

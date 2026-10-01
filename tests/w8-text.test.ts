import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Charts from '../src/components/Charts';
import { analyzeInsights } from '../src/core/insights';
import { calculateMetrics } from '../src/core/metrics';
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
/** The panel as text, the first work selected for review. */
const text = (works: Work[], config: InsightsSettings) =>
  renderToStaticMarkup(
    createElement(LocalInsights, {
      analysis: analyzeInsights(works, config, 'all'),
      settings: config,
      works,
      source: 'all',
      onChange: () => true,
    }),
  )
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

describe('the note on a confirmed role that is not applied', () => {
  const paper = work('x', { authors: ['Alex Other', 'Kim Lee', 'Jane Scholar'] });
  const note = (review: { authors: string[]; complete: boolean }) =>
    /Your confirmed role, Last author, is not applied: .*?(?= Full author list)/.exec(
      text([paper], settings({ annotations: [{ key: '10.1234/x', ...review, role: 'last' }] })),
    )?.[0];

  it('names the entry that marks a list confirmed complete as shortened', () => {
    expect(note({ authors: ['Alex Other', 'Kim Lee', 'Jane Scholar', '…'], complete: true })).toBe(
      'Your confirmed role, Last author, is not applied: sole, middle and last positions need a complete author list. The saved list still contains “…”, which marks it as shortened: replace it with the missing authors to apply the role.',
    );
    expect(note({ authors: ['Alex Other', 'Jane Scholar et al.'], complete: false })).toContain(
      'The saved list still contains “Jane Scholar et al.”, which marks it as shortened',
    );
  });

  it('says when the saved list is empty', () => {
    expect(note({ authors: [], complete: true })).toBe(
      'Your confirmed role, Last author, is not applied: sole, middle and last positions need a complete author list. The saved list is empty: enter the full author list to apply the role.',
    );
  });

  it('still asks to confirm a list that is only unconfirmed', () => {
    expect(note({ authors: ['Alex Other', 'Kim Lee', 'Jane Scholar'], complete: false })).toBe(
      'Your confirmed role, Last author, is not applied: sole, middle and last positions need a complete author list. Confirm the list is complete to apply it.',
    );
  });
});

describe('counts of one in the Insights panel', () => {
  // One paper, matched only through compatible initials, with one citation and one saved row of
  // each kind.
  const one = work('a', { authors: ['J Scholar', 'B One'], citations: 1 });
  const config = settings({
    annotations: [{ key: '10.1234/a', authors: ['J Scholar', 'B One'], complete: true }],
    annualCitations: [{ key: '10.1234/a', year: 2021, citations: 1, source: 'scholar' }],
    journalRanks: [{ venue: 'Research', year: 2020, category: 'M', quartile: 'Q1', source: 'SJR' }],
  });
  const panel = () => text([one], config);

  it('are written in the singular', () => {
    expect(panel()).toContain(' 1 paper matched compatible initials; verify author identity');
    expect(panel()).toContain('First author 1 publication · 1 citation ');
    expect(panel()).toContain(' 1 paper has both a classified role and a known count.');
    expect(panel()).toContain('Saved: 1 author review · 1 annual count · 1 ranking record.');
  });

  it('in the timeline bars as well', () => {
    const html = renderToStaticMarkup(
      createElement(Charts, {
        metrics: calculateMetrics([work('a', { year: 2020, citations: 1 })], 'all', 2026),
        currentYear: 2026,
      }),
    );
    expect(html).toContain('title="2020: 1 paper"');
  });
});

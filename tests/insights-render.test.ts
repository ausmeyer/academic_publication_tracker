import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

const render = (
  works: Work[],
  config: InsightsSettings = settings(),
  source: SourceId | 'all' = 'all',
) =>
  renderToStaticMarkup(
    createElement(LocalInsights, {
      analysis: analyzeInsights(works, config, source),
      settings: config,
      works,
      source,
      onChange: () => true,
    }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
const card = (html: string, label: string) =>
  html.match(new RegExp(`<span>${label}</span><strong>([^<]*)</strong>`))?.[1];

describe('headline numbers without any known citation count', () => {
  const unknown = [work('a', { citations: null }), work('b', { citations: null })];

  it('shows an unknown value, not zero, for count-derived cards', () => {
    const html = render(unknown);
    expect(card(html, 'Raw h-index')).toBe('—');
    expect(card(html, 'Zero-citation papers')).toBe('—');
    expect(card(html, 'Median citations')).toBe('—');
    expect(card(html, 'Experimental Sh-index')).toBe('—');
  });

  it('still shows real zeros when counts are known', () => {
    const html = render([work('a', { citations: 0 }), work('b', { citations: 0 })]);
    expect(card(html, 'Raw h-index')).toBe('0');
    expect(card(html, 'Zero-citation papers')).toBe('2');
  });

  it('counts preprints whether or not citation counts are known', () => {
    const html = render([work('a', { citations: null, type: 'posted-content' })]);
    expect(card(html, 'Preprints identified')).toBe('1');
  });
});

describe('weights and interpretation', () => {
  const html = () => text(render([work('a')]));

  it('explains how two-author papers and six-author teams are weighted', () => {
    expect(html()).toMatch(/two-author papers/i);
    expect(html()).toMatch(/second author is classified as last author/i);
    expect(html()).toMatch(/exactly six/i);
    expect(html()).toMatch(/leaves exactly six unspecified/i);
  });

  it('keeps the published weights', () => {
    expect(html()).toMatch(/sole or confirmed corresponding 100%, first 90%, second 50%/);
    expect(html()).toMatch(/25% for teams of six or fewer and 10% for larger teams/);
  });
});

describe('the no-match hint', () => {
  const works = [
    work('a', { authors: ['Someone Else', 'Alex Other'] }),
    work('b', { authors: ['X Y', 'Z W'] }),
  ];

  it('explains the accepted name forms when no byline matched the author', () => {
    const html = text(render(works));
    expect(html).toContain('No byline matched this name.');
    expect(html).toContain('“Given Family”, “Family, Given” or “Family INITIALS”');
    expect(html).toContain('add name variants above');
  });

  it('is absent while an author is not chosen', () => {
    expect(text(render(works, settings({ author: '' })))).not.toContain('No byline matched');
  });

  it('is absent once some byline matches, and when there are no papers', () => {
    expect(text(render([...works, work('c')]))).not.toContain('No byline matched');
    expect(text(render([]))).not.toContain('No byline matched');
  });

  it('is absent when papers matched but need review, which is a different problem', () => {
    const html = text(
      render([work('x', { authors: ['Jane Scholar', 'A', 'B'], authorsComplete: false })]),
    );
    expect(html).not.toContain('No byline matched');
  });
});

describe('the year-range note', () => {
  const works = [
    work('dated', { year: 2021 }),
    work('u1', { year: null }),
    work('u2', { year: null }),
  ];

  it('says how many undated papers a year range leaves out', () => {
    expect(text(render(works, settings({ yearFrom: 2020 })))).toContain(
      '2 undated papers are excluded by the year range.',
    );
    expect(text(render([works[0], works[1]], settings({ yearTo: 2030 })))).toContain(
      '1 undated paper is excluded by the year range.',
    );
  });

  it('is silent without a year range or without undated papers', () => {
    expect(text(render(works))).not.toContain('excluded by the year range');
    expect(text(render([works[0]], settings({ yearFrom: 2020 })))).not.toContain(
      'excluded by the year range',
    );
  });
});

describe('the author review list', () => {
  const works = [
    work('exact', { title: 'Exact match paper', authors: ['Jane Scholar', 'Alex Other'] }),
    work('initial', { title: 'Initial only paper', authors: ['J Scholar', 'Alex Other'] }),
    work('none', { title: 'Nobody here paper', authors: ['Someone Else', 'Alex Other'] }),
  ];

  it('lists initial-only matches, labelled, and unclassified papers, but not exact matches', () => {
    const html = render(works);
    const table = html.slice(html.indexOf('Review author lists and roles'));
    expect(table).toContain('Initial only paper');
    expect(table).toContain('Nobody here paper');
    expect(table).not.toMatch(/<button[^>]*>Exact match paper<\/button>/);
    expect(table).toMatch(
      /Initial only paper<\/button><\/td><td>First author<\/td><td>Initial-compatible name; verify identity/,
    );
  });

  it('says how many papers are waiting for review', () => {
    expect(text(render(works))).toContain('Showing up to 50 of 2 papers to review');
  });
});

describe('the publication picker', () => {
  const many = Array.from({ length: 1000 }, (_, i) =>
    work(`p${i}`, { title: `Paper number ${i}` }),
  );

  it('offers at most 200 matching publications and says how to narrow the list', () => {
    const html = render(many);
    const picker = html.slice(html.indexOf('Publication to review'));
    const options = picker.slice(0, picker.indexOf('</select>')).match(/<option/g) ?? [];
    expect(options.length).toBeLessThanOrEqual(201);
    expect(text(html)).toContain('Showing 200 of 1,000 matching publications');
  });

  it('shows the whole list when it is short', () => {
    const html = render(many.slice(0, 5));
    expect(text(html)).not.toContain('matching publications');
  });
});

describe('links and saved-data summary', () => {
  it('no longer asks the window for a new tab (the desktop app blocks those)', () => {
    const html = render([work('a')]);
    expect(html).toContain('href="https://arxiv.org/abs/2509.04124"');
    expect(html).not.toContain('target="_blank"');
  });

  it('reports annual rows that were ignored as implausible', () => {
    const config = settings({
      annualCitations: [{ key: '10.1234/a', year: 2010, citations: 4, source: 'scholar' }],
    });
    expect(text(render([work('a', { year: 2020 })], config))).toMatch(
      /1 annual count is ignored because it falls before the paper’s publication year or after the current year/,
    );
  });
});

describe('degenerate data never reaches the page as NaN or Infinity', () => {
  const many = (counts: Array<number | null>) =>
    counts.map((citations, i) => work(`p${i}`, { citations, provenance: [] }));
  it.each([
    ['no papers', []],
    ['one paper', many([5])],
    ['two zeros', many([0, 0])],
    ['three zeros (a flat violin)', many([0, 0, 0])],
    ['three identical counts', many([7, 7, 7])],
    ['no known count', many([null, null, null])],
    ['huge counts', many([9e15, 1, 2])],
    ['a mix of known and unknown counts', many([1, 2, 3, 400, 0, 12, null, 55])],
  ])('renders %s cleanly', async (_label, works) => {
    const { default: Charts } = await import('../src/components/Charts');
    const { default: Metrics } = await import('../src/components/Metrics');
    const config = settings();
    const analysis = analyzeInsights(works, config, 'all');
    const metrics = calculateMetrics(
      analysis.rows.map((r) => r.work),
      'all',
    );
    const html =
      render(works) +
      renderToStaticMarkup(
        createElement(Charts, { metrics, annual: analysis.annual, expanded: true }),
      ) +
      renderToStaticMarkup(createElement(Metrics, { metrics, excluded: 0, onHelp: () => {} }));
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('renders with no author chosen', () => {
    expect(render(many([1, 2, 3]), settings({ author: '' }))).not.toMatch(/NaN|Infinity|undefined/);
  });
});

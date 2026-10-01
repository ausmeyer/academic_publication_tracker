import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeInsights, type Role } from '../src/core/insights';
import type { InsightsSettings, SourceId, Work } from '../src/types';
import { settings, work } from './insights-helpers';

// A Scholar byline that ended with "…": the list is not known to be complete.
const shortened = work('x', {
  authors: ['Alex Other', 'Jane Scholar', 'Kim Lee'],
  authorsComplete: false,
  citations: 100,
});
const reviewed = (role: Role, complete = false) =>
  settings({
    annotations: [{ key: '10.1234/x', authors: shortened.authors, complete, role }],
  });
const row = (config: InsightsSettings) => analyzeInsights([shortened], config, 'all').rows[0];

describe('a confirmed role on an author list that is not confirmed complete', () => {
  it.each([
    ['corresponding', 1],
    ['first', 0.9],
    ['second', 0.5],
  ] as const)(
    'applies a %s-author override, which does not depend on the rest of the list',
    (role, weight) => {
      expect(row(reviewed(role))).toMatchObject({
        role,
        reason: 'Manually confirmed role',
        weight,
      });
    },
  );

  it.each(['sole', 'middle', 'last'] as const)(
    'does not apply a %s-author override, which needs the complete list',
    (role) => {
      expect(row(reviewed(role))).toMatchObject({
        role: 'second',
        reason: expect.not.stringMatching(/confirmed/),
      });
      expect(row(reviewed(role, true))).toMatchObject({ role, reason: 'Manually confirmed role' });
    },
  );
});

describe('the author review form', () => {
  let LocalInsights: ComponentType<{
    analysis: ReturnType<typeof analyzeInsights>;
    settings: InsightsSettings;
    works: Work[];
    source: SourceId | 'all';
    onChange: (next: InsightsSettings) => boolean;
  }>;
  beforeAll(async () => {
    vi.stubGlobal('window', {});
    LocalInsights = (await import('../src/components/LocalInsights')).default;
  });
  const form = (config: InsightsSettings) => {
    const html = renderToStaticMarkup(
      createElement(LocalInsights, {
        analysis: analyzeInsights([shortened], config, 'all'),
        settings: config,
        works: [shortened],
        source: 'all',
        onChange: () => true,
      }),
    );
    return html.slice(
      html.indexOf('class="author-review"'),
      html.indexOf('</form>', html.indexOf('class="author-review"')),
    );
  };

  it('says when a saved role is not applied, and why', () => {
    expect(form(reviewed('last'))).toContain(
      'Your confirmed role, Last author, is not applied: sole, middle and last positions need a complete author list. Confirm the list is complete to apply it.',
    );
  });

  it('says nothing when the saved role is applied', () => {
    expect(form(reviewed('corresponding'))).not.toContain('is not applied');
    expect(form(reviewed('last', true))).not.toContain('is not applied');
  });
});

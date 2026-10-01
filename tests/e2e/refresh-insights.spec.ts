import { expect, test } from '@playwright/test';
import type { InsightsSettings } from '../../src/types';
import {
  at,
  aptLast,
  installDesktop,
  searchResponse,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

test.describe('Insights data follows a paper through a refresh', () => {
  test('an author review and annual counts move to the paper whose key changed', async ({
    page,
  }) => {
    // v0.4.3 stored arXiv ids with their version; a refresh now stores the id without it.
    const authors = ['A Smith', 'Jane Scholar', 'C Third'];
    const arxiv = (id: string) => ({
      source: 'arxiv' as const,
      sourceId: id,
      citations: null,
      retrievedAt: at,
      url: `https://arxiv.org/abs/${id}`,
    });
    const old = work('arxiv:2304.02643v1', 'Transparent forecasting of dengue', null, 2023, {
      doi: '',
      authors,
      provenance: [arxiv('2304.02643v1')],
    });
    const insights: InsightsSettings = {
      author: 'Jane Scholar',
      aliases: [],
      lensConvention: false,
      annotations: [{ key: old.id, authors, complete: true, role: 'corresponding' }],
      annualCitations: [{ key: old.id, year: 2024, citations: 3, source: 'arxiv' }],
      journalRanks: [],
      retractions: [],
    };
    const original = snapshotOf('s1', 'Preprint search', [old], {
      query: { text: 'transparent forecasting', mode: 'topic', sources: ['arxiv'], limit: 25 },
      insights,
    });
    await installDesktop(page, { workspace: workspaceOf([original]) });
    const fresh = work('arxiv:2304.02643', 'Transparent forecasting of dengue', null, 2023, {
      doi: '',
      authors,
      provenance: [arxiv('2304.02643')],
    });
    await page.addInitScript(
      (response) => {
        (window as unknown as { __apt: Apt }).__apt.onSearch = async () => response;
      },
      searchResponse([fresh]),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('1 publication saved');
    await expect.poll(async () => (await aptLast(page))?.snapshots.length).toBe(2);
    const saved = (await aptLast(page))!.snapshots[0].insights!;
    expect(saved.annotations).toEqual([
      { key: 'arxiv:2304.02643', authors, complete: true, role: 'corresponding' },
    ]);
    expect(saved.annualCitations).toEqual([
      { key: 'arxiv:2304.02643', year: 2024, citations: 3, source: 'arxiv' },
    ]);
  });
});

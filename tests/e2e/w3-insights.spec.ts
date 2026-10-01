import { test, expect, type Page } from '@playwright/test';
import type { InsightsSettings, Work, Workspace } from '../../src/types';

const at = '2026-09-14T15:00:00.000Z';
const work = (id: string, extra: Partial<Work> = {}): Work => ({
  id,
  title: `Paper ${id}`,
  authors: ['Jane Scholar', 'B One'],
  year: 2020,
  venue: 'Journal',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 12,
  provenance: [{ source: 'openalex', sourceId: id, citations: 12, retrievedAt: at, url: '' }],
  included: true,
  tags: [],
  notes: '',
  ...extra,
});
const insights = (extra: Partial<InsightsSettings> = {}): InsightsSettings => ({
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
  ...extra,
});
async function openInsights(page: Page, works: Work[], settings: InsightsSettings = insights()) {
  const data: Workspace = {
    version: 2,
    activeId: 's',
    snapshots: [
      {
        id: 's',
        name: 'Jane Scholar',
        query: { text: 'Jane Scholar', mode: 'author', sources: ['openalex'], limit: 25 },
        searchedAt: at,
        sourceResults: [{ source: 'openalex', total: works.length }],
        works,
        insights: settings,
      },
    ],
  };
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    data,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authorship roles', exact: true })).toBeVisible();
}

test('the role and quartile chart can be read without telling colours apart', async ({ page }) => {
  await openInsights(
    page,
    [
      work('a', { venue: 'Nature' }),
      work('b', { venue: 'Cell' }),
      work('c', { venue: 'Obscure' }),
      work('d', { venue: 'Nature', authors: ['B One', 'C Two', 'Jane Scholar'] }),
    ],
    insights({
      journalRanks: [
        {
          venue: 'Nature',
          year: 2020,
          category: 'Multidisciplinary',
          quartile: 'Q1',
          source: 'SJR',
        },
        { venue: 'Cell', year: 2020, category: 'Biology', quartile: 'Q4', source: 'SJR' },
      ],
    }),
  );
  await expect(
    page.getByRole('img', {
      name: 'Publications by authorship role and journal quartile. First author: 3 publications (Q1 1, Q4 1, Unknown 1); Last author: 1 publication (Q1 1).',
    }),
  ).toBeVisible();
  await page.getByLabel('Role chart measure').selectOption('citations');
  await expect(
    page.getByRole('img', {
      name: 'Citations by authorship role and journal quartile. First author: 36 citations (Q1 12, Q4 12, Unknown 12); Last author: 12 citations (Q1 12).',
    }),
  ).toBeVisible();
  // Every drawn segment after the first starts with a separating line.
  const separators = await page
    .locator('.authorship-chart .authorship-row')
    .first()
    .locator('i')
    .evaluateAll((segments) =>
      segments
        .filter((segment, i) => i > 0 && segment.getBoundingClientRect().width > 0)
        .map((segment) => getComputedStyle(segment).boxShadow),
    );
  expect(separators).toHaveLength(2);
  for (const shadow of separators)
    expect(shadow).toMatch(/rgb\(255, 255, 255\) 2px 0px 0px 0px inset/);
});

test('"Find a publication" ignores accents and word order, like the library filter', async ({
  page,
}) => {
  await openInsights(page, [
    work('b', { title: 'Unrelated title', authors: ['C Two'] }),
    work('a', { title: 'Epidemic forecasting in Spain', authors: ['María González', 'B One'] }),
  ]);
  await page.getByText('Review author lists and roles', { exact: true }).click();
  const options = page.getByLabel('Publication to review').locator('option');
  for (const query of ['gonzalez', 'GONZÁLEZ', 'forecasting epidemic', 'spain maria'])
    await test.step(query, async () => {
      await page.getByLabel('Find a publication').fill(query);
      // The paper already selected stays listed as well.
      await expect(options).toHaveText(['Unrelated title', 'Epidemic forecasting in Spain']);
    });
  await page.getByLabel('Find a publication').fill('forecasting zebra');
  await expect(options).toHaveText(['Unrelated title']);
});

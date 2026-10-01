import { test, expect, type Page } from '@playwright/test';
import type { InsightsSettings, Work } from '../../src/types';
import type { HarnessInit } from './insights-harness';

const at = '2026-09-14T15:00:00.000Z';
const work = (id: string, extra: Partial<Work> = {}): Work => ({
  id,
  title: `Paper ${id}`,
  authors: ['Jane Scholar', 'Alex Researcher'],
  year: 2022,
  venue: 'Journal of Research Methods',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 1,
  provenance: [{ source: 'openalex', sourceId: id, citations: 1, retrievedAt: at, url: '' }],
  included: true,
  tags: [],
  notes: '',
  ...extra,
});
const base: InsightsSettings = {
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
};

/** Mounts the panel alone (see insights-harness.tsx) with a save handler that answers as `mode`. */
async function open(
  page: Page,
  mode: 'ok' | 'promise',
  nextImport: { name: string; content: string } | null = null,
) {
  const init: HarnessInit = { works: [work('one')], settings: base };
  await page.addInitScript(
    ({ init, mode, nextImport }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__init = init;
      w.__calls = [];
      w.__mode = mode;
      w.desktop = { importFile: async () => nextImport };
    },
    { init, mode, nextImport },
  );
  await page.goto('/tests/e2e/insights-harness.html');
  await expect(page.getByRole('heading', { name: 'Authorship roles' })).toBeVisible();
}

test('a save answered with a promise, as an asynchronous shell would, is not reported as saved', async ({
  page,
}) => {
  // Only `true` means saved: a promise may still fail, so the panel must not claim success.
  await open(page, 'promise');
  await page.getByText('Review author lists and roles', { exact: true }).click();
  await page.getByLabel('I confirm this is the complete author list in publication order').check();
  await page.getByRole('button', { name: 'Save author review', exact: true }).click();
  await expect(page.locator('.insight-error')).toContainText('was not saved');
  await expect(page.getByText('Saved author review.')).toHaveCount(0);
});

test('counts of one are written in the singular', async ({ page }) => {
  await open(page, 'ok', {
    name: 'annual.csv',
    content: [
      'key,year,citations,source',
      '10.1234/one,2024,1,scholar',
      '10.1234/elsewhere,2024,3,scholar',
    ].join('\n'),
  });
  await page.getByLabel('Role chart measure').selectOption('citations');
  await expect(
    page.getByRole('img', {
      name: 'Citations by authorship role and journal quartile. First author: 1 citation (Unknown 1).',
    }),
  ).toBeVisible();
  await page.getByText('Import local analysis data', { exact: true }).click();
  await page.getByLabel('Analysis data type').selectOption('annual');
  await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Imported 1 record; 1 unmatched record skipped.',
  );
});

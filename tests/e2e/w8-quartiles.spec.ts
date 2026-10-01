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
const insights: InsightsSettings = {
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [
    { venue: 'Nature', year: 2020, category: 'M', quartile: 'Q1', source: 'SJR' },
    { venue: 'Cell', year: 2020, category: 'B', quartile: 'Q3', source: 'SJR' },
    { venue: 'Lancet', year: 2020, category: 'B', quartile: 'Q4', source: 'SJR' },
  ],
  retractions: [],
};
async function open(page: Page, width: number) {
  const data: Workspace = {
    version: 2,
    activeId: 's',
    snapshots: [
      {
        id: 's',
        name: 'Jane Scholar',
        query: { text: 'Jane Scholar', mode: 'author', sources: ['openalex'], limit: 25 },
        searchedAt: at,
        sourceResults: [{ source: 'openalex', total: 5 }],
        works: [
          work('a', { venue: 'Nature' }),
          work('b', { venue: 'Cell' }),
          work('c', { venue: 'Lancet' }),
          work('d', { venue: 'Obscure' }),
          work('e', { venue: 'Nature', authors: ['B One', 'Jane Scholar'] }),
        ],
        insights,
      },
    ],
  };
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    data,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.locator('.authorship-chart')).toBeVisible();
}
/** Where each row's split line sits, relative to its bar, its row and the panel. */
const splitLayout = (page: Page) =>
  page.locator('.authorship-chart .authorship-row').evaluateAll((rows) =>
    rows.map((row) => {
      const split = row.querySelector<HTMLElement>('.quartile-split')!;
      const bar = row.querySelector('.quartile-stack')!.getBoundingClientRect();
      const box = split.getBoundingClientRect();
      const panel = row.closest('.authorship-panel')!.getBoundingClientRect();
      const style = getComputedStyle(split);
      return {
        text: split.textContent,
        belowBar: box.top >= bar.bottom,
        closeToBar: box.top - bar.bottom < 24,
        alignedWithBar: Math.abs(box.left - bar.left) < 1,
        inRow: box.bottom <= row.getBoundingClientRect().bottom + 0.5,
        inPanel: box.left >= panel.left && box.right <= panel.right,
        oneLine: box.height < 2 * parseFloat(style.fontSize),
        visible: style.visibility === 'visible' && box.width > 0,
      };
    }),
  );

for (const width of [1060, 1440])
  test(`each quartile bar lists its quartiles in words at ${width} px`, async ({ page }) => {
    await open(page, width);
    const expected = { belowBar: true, closeToBar: true, alignedWithBar: true, inRow: true };
    const rest = { inPanel: true, oneLine: true, visible: true };
    expect(await splitLayout(page)).toEqual([
      { text: 'Q1 1 · Q3 1 · Q4 1 · Unknown 1', ...expected, ...rest },
      { text: 'Q1 1', ...expected, ...rest },
    ]);
    await page.getByLabel('Role chart measure').selectOption('citations');
    expect((await splitLayout(page)).map((row) => row.text)).toEqual([
      'Q1 12 · Q3 12 · Q4 12 · Unknown 12',
      'Q1 12',
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

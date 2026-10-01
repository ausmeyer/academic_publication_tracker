import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { InsightsSettings } from '../../src/types';
import { installDesktop, seedOnce, snapshotOf, work, workspaceOf, aptExports } from './ui-helpers';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

const insights = (over: Partial<InsightsSettings>): InsightsSettings => ({
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
  ...over,
});

// Nine included papers: five from 2021, three from 2023 and one undated.
const mixed = [
  ...Array.from({ length: 5 }, (_, i) => work(`old${i}`, `Older paper ${i}`, 10, 2021)),
  ...Array.from({ length: 3 }, (_, i) => work(`new${i}`, `Newer paper ${i}`, 20, 2023)),
  work('undated', 'Undated paper', 5, null),
];

test.describe('Insights range does not change overview counts (P5-02)', () => {
  test('the export dialog counts every included paper, not the Insights year range', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: workspaceOf([
        snapshotOf('s1', 'Mixed', mixed, { insights: insights({ yearFrom: 2023 }) }),
      ]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Research insights', exact: true }).click();
    // The Insights metrics honour the range ...
    await expect(page.locator('.metric-value').first()).toHaveText('3');
    // ... but the file the export writes does not.
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('9 publications.');
    await page.getByText('JSON records', { exact: true }).click();
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect.poll(async () => (await aptExports(page)).length).toBe(1);
    expect(JSON.parse((await aptExports(page))[0].content)).toHaveLength(9);
  });

  test('export stays available when the Insights range excludes every included paper', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: workspaceOf([
        snapshotOf('s1', 'Mixed', mixed, { insights: insights({ yearFrom: 2030 }) }),
      ]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Research insights', exact: true }).click();
    await expect(page.locator('.metric-value').first()).toHaveText('0');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('9 publications.');
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
  });

  const previous = { searchedAt: '2026-09-01T10:00:00.000Z', papers: 8, citations: 100 };

  test('the refresh note shows paper and citation changes and ignores the Insights range', async ({
    page,
  }) => {
    const base = snapshotOf('s1', 'Mixed', mixed, {
      previous,
      insights: insights({ yearFrom: 2023 }),
    });
    // The snapshot it was refreshed from is still in the library.
    const earlier = snapshotOf('s0', 'Mixed', [], { searchedAt: previous.searchedAt });
    await seedOnce(page, workspaceOf([base, earlier]));
    await page.goto('/');
    const note = page.locator('.refresh-note');
    // 9 included papers vs 8 before; 5*10 + 3*20 + 5 = 115 citations vs 100 before.
    await expect(note).toContainText('+1 included paper');
    await expect(note).toContainText('+15 citations');
    await expect(note).toContainText('Earlier snapshot retained in your library');
    await page.getByRole('button', { name: 'Research insights', exact: true }).click();
    await expect(note).toContainText('+1 included paper');
    await expect(note).toContainText('+15 citations');
  });

  test('the refresh note reports decreases with a minus sign', async ({ page }) => {
    await seedOnce(
      page,
      workspaceOf([
        snapshotOf('s1', 'Mixed', mixed, {
          previous: { searchedAt: '2026-09-01T10:00:00.000Z', papers: 12, citations: 500 },
        }),
      ]),
    );
    await page.goto('/');
    await expect(page.locator('.refresh-note')).toContainText('−3 included papers');
    await expect(page.locator('.refresh-note')).toContainText('−385 citations');
  });
});

test.describe('details panel and version text', () => {
  test('the type chip shows a readable kind and keeps the raw provider string in its tooltip', async ({
    page,
  }) => {
    const raw =
      "Research Support, Non-U.S. Gov't, research-article, Research Support, U.S. Gov't, Non-P.H.S., Journal Article, Research Support, N.I.H., Extramural";
    await seedOnce(
      page,
      workspaceOf([
        snapshotOf('s1', 'Types', [work('a', 'A typed paper', 3, 2022, { type: raw })]),
      ]),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'A typed paper', exact: true }).click();
    const chip = page.locator('.detail-chips .tag').first();
    await expect(chip).toHaveText('Article');
    await expect(chip).toHaveAttribute('title', raw);
  });

  test('About and the footer show the version from package.json', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.footer-version')).toHaveText(`v${version}`);
    await page.getByRole('button', { name: /About & metric guide/ }).click();
    await expect(page.getByRole('dialog')).toContainText(`Version ${version}`);
  });

  test('the DOI link keeps "#" and "?" inside the DOI', async ({ page }) => {
    await installDesktop(page, {
      workspace: workspaceOf([
        snapshotOf('s1', 'Links', [
          work('a', 'Odd DOI paper', 3, 2022, { doi: '10.1000/abc#frag' }),
        ]),
      ]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Odd DOI paper', exact: true }).click();
    await page.getByRole('button', { name: /View publication/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __apt: { opened: string[] } }).__apt.opened),
      )
      .toEqual(['https://doi.org/10.1000/abc%23frag']);
  });

  test('a date-only retrieval date shows the same day west of UTC', async ({ page }) => {
    const dated = work('a', 'Imported paper', 3, 2022, {
      provenance: [
        { source: 'crossref', sourceId: 'a', citations: 3, retrievedAt: '2026-09-30', url: '' },
      ],
    });
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Dates', [dated])]));
    await page.goto('/');
    await page.getByRole('button', { name: 'Imported paper', exact: true }).click();
    await expect(page.locator('.provenance-row small')).toHaveText('Retrieved Sep 30, 2026');
  });

  test('the workspace backup is named by the local date', async ({ page }) => {
    // 01:30 UTC on 1 October is 8:30 pm on 30 September in Chicago.
    await page.clock.setFixedTime(new Date('2026-10-01T01:30:00Z'));
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Backup', [work('a', 'Paper')])]));
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Back up workspace as JSON/ }).click();
    expect((await download).suggestedFilename()).toBe(
      'academic-publication-tracker-2026-09-30.json',
    );
  });

  test('the workspace backup is compact JSON so it cannot outgrow the export limit', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: workspaceOf([snapshotOf('s1', 'Backup', [work('a', 'Paper')])]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Back up workspace as JSON/ }).click();
    await expect.poll(async () => (await aptExports(page)).length).toBe(1);
    const [file] = await aptExports(page);
    expect(file.content).not.toContain('\n');
    expect(JSON.parse(file.content).version).toBe(2);
  });

  test('the contact email text names only Crossref', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Sent only to Crossref');
    await expect(dialog).not.toContainText('Crossref, OpenAlex, and NCBI');
  });
});

test.describe('table scrolling (P5-11)', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    work(`p${i}`, `Paper number ${String(i).padStart(3, '0')}`, 500 - i, 2000 + (i % 20)),
  );

  test('paging, sorting and filtering return to the top of the table', async ({ page }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Many', many)]));
    await page.goto('/');
    const scroller = page.locator('.table-scroll');
    const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
    const scrollDown = () => scroller.evaluate((el) => (el.scrollTop = 400));
    await scrollDown();
    expect(await scrollTop()).toBeGreaterThan(300);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(scrollTop).toBe(0);
    await scrollDown();
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect.poll(scrollTop).toBe(0);
    await scrollDown();
    await page.getByLabel('Filter publications').fill('Paper number 01');
    await expect.poll(scrollTop).toBe(0);
  });
});

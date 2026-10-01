import { test, expect, type Page } from '@playwright/test';
import { doiUrl } from '../../src/core/merge';
import {
  aptExports,
  installDesktop,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

const fullOf = (count: number) =>
  workspaceOf(
    Array.from({ length: count }, (_, i) => ({
      ...snapshotOf(`s${i}`, `Saved search ${i}`, []),
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    })),
  );
async function runSearch(page: Page, text: string) {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}

test.describe('one paper, one publication (W4-15)', () => {
  test('the sidebar, rename, delete and export name a single paper in the singular', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: workspaceOf([
        snapshotOf('s1', 'Single', [work('a', 'Paper A')]),
        snapshotOf('s2', 'Other', [work('b', 'Paper B'), work('c', 'Paper C')]),
      ]),
    });
    await page.goto('/');
    await expect(page.locator('.saved-search').nth(0)).toContainText('1 paper');
    await expect(page.locator('.saved-search').nth(0)).not.toContainText('1 papers');
    await page.locator('.saved-search').nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename search' }).click();
    await expect(page.getByRole('dialog')).toContainText('· 1 publication');
    await expect(page.getByRole('dialog')).not.toContainText('1 publications');
    await page.keyboard.press('Escape');
    await page.locator('.saved-search').nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await expect(page.getByRole('dialog')).toContainText(', 1 publication)');
    await page.getByRole('button', { name: 'Keep snapshot', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('1 publication.');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Exported 1 publication.');
    expect(await aptExports(page)).toHaveLength(1);
  });

  test('a single saved or held result is one publication', async ({ page }) => {
    await seedOnce(page, fullOf(500));
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('n1', 'New paper one')]) }),
    );
    await page.goto('/');
    await runSearch(page, 'Jane Scholar');
    const banner = page.getByRole('alert').filter({ hasText: 'have not been saved' });
    await expect(banner).toContainText('“Jane Scholar”: 1 publication retrieved');
    await banner.getByRole('button', { name: 'Remove older snapshots…' }).click();
    await expect(page.getByRole('dialog').locator('.snapshot-choice').first()).toContainText(
      '· 0 papers',
    );
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(page.locator('.toast')).toContainText('1 publication saved.');
  });
});

test('"View publication" opens the same DOI link as the exports use (W4-16)', async ({ page }) => {
  const doi = '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-#';
  await installDesktop(page, {
    workspace: workspaceOf([snapshotOf('s1', 'Wiley', [work('a', 'Paper A', 10, 2022, { doi })])]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Paper A', exact: true }).click();
  await page.getByRole('button', { name: /View publication/ }).click();
  const opened = () =>
    page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.opened.slice());
  await expect.poll(opened).toEqual([doiUrl(doi)]);
  // "#", "?", "<" and ">" stay in the DOI instead of ending the link.
  const link = new URL((await opened())[0]);
  expect(link.hash).toBe('');
  expect(link.search).toBe('');
  expect(decodeURIComponent(link.pathname.slice(1))).toBe(doi);
});

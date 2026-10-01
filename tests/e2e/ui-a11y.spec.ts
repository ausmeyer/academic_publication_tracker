import { test, expect, type Page } from '@playwright/test';
import { searchResponse, seedOnce, snapshotOf, work, workspaceOf } from './ui-helpers';

const two = workspaceOf([
  snapshotOf('s1', 'First search', [
    work('a', 'Paper A', 30, 2020),
    work('b', 'Paper B', 20, 2022),
  ]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const attr = (page: Page, selector: string, name: string) =>
  page.locator(selector).first().getAttribute(name);

test.describe('state is exposed to assistive technology, not only by class (P5-12)', () => {
  test('the search-type buttons say which one is pressed', async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-search').click();
    const author = page.getByRole('button', { name: 'Author', exact: true });
    const topic = page.getByRole('button', { name: 'Topic or title', exact: true });
    await expect(author).toHaveAttribute('aria-pressed', 'true');
    await expect(topic).toHaveAttribute('aria-pressed', 'false');
    await topic.click();
    await expect(topic).toHaveAttribute('aria-pressed', 'true');
    await expect(author).toHaveAttribute('aria-pressed', 'false');
  });

  test('the current page and the open saved search are marked', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('button', { name: /Search library/ })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(page.locator('.saved-search').nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.saved-search').nth(1)).not.toHaveAttribute('aria-current');
    await nav.getByRole('button', { name: /Search library/ }).click();
    await expect(nav.getByRole('button', { name: /Search library/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    await page.getByRole('button', { name: /Data sources/ }).click();
    await expect(page.getByRole('button', { name: /Data sources/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the sorted column is announced and the others are not', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    const head = (name: string) => page.locator('th').filter({ hasText: name });
    await expect(head('Citations')).toHaveAttribute('aria-sort', 'descending');
    await expect(head('Year')).not.toHaveAttribute('aria-sort');
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(head('Year')).toHaveAttribute('aria-sort', 'descending');
    await expect(head('Citations')).not.toHaveAttribute('aria-sort');
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(head('Year')).toHaveAttribute('aria-sort', 'ascending');
    await page.getByRole('button', { name: 'Publication', exact: true }).click();
    await expect(head('Publication')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('the row whose details are open is marked selected', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper B', exact: true }).click();
    await expect(page.getByRole('row', { name: /Paper B/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('row', { name: /Paper A/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('saved searches do not claim to open a menu when activated', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    expect(await attr(page, '.saved-search', 'aria-haspopup')).toBeNull();
    await page.getByRole('button', { name: /Search library/ }).click();
    expect(await attr(page, '.library-card', 'aria-haspopup')).toBeNull();
  });

  test('live regions are in the page before anything is announced', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    // A region that is added together with its text is often not read out, so it must already exist.
    const toastRegion = await page.locator('body > [role="status"]').elementHandle();
    const progressRegion = await page.locator('main [role="status"]').elementHandle();
    expect(toastRegion).not.toBeNull();
    expect(progressRegion).not.toBeNull();
    await page.locator('.saved-search').nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
    await expect(page.locator('.toast')).toHaveText('Snapshot deleted.');
    expect(await toastRegion!.textContent()).toContain('Snapshot deleted.');
    expect(await toastRegion!.evaluate((el) => el.isConnected)).toBe(true);
    // The same holds for search progress.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/search', async (route) => {
      await gate;
      await route.fulfill({ json: searchResponse([work('n', 'New')]) });
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    expect(
      await progressRegion!.evaluate((el) =>
        el.contains(document.querySelector('.search-progress')),
      ),
    ).toBe(true);
    release();
    await expect(page.locator('.search-progress')).toHaveCount(0);
  });

  test('the "Search actions" menu closes on Escape, on an outside click and after use', async ({
    page,
  }) => {
    await seedOnce(page, two);
    await page.goto('/');
    const summary = page.getByLabel('Search actions', { exact: true });
    const isOpen = () =>
      page.locator('details.action-menu').evaluate((el) => (el as HTMLDetailsElement).open);
    await summary.click();
    expect(await isOpen()).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(isOpen).toBe(false);
    await expect(summary).toBeFocused();
    await summary.click();
    await page.getByRole('heading', { name: 'First search', exact: true }).click();
    await expect.poll(isOpen).toBe(false);
    await summary.click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    await expect.poll(isOpen).toBe(false);
  });

  test('buttons in the overview, the library and on the welcome screen hold only text-level content', async ({
    page,
  }) => {
    const blocks = 'button h1, button h2, button h3, button h4, button p, button div, button ul';
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your research/ })).toBeVisible();
    expect(await page.locator(blocks).count()).toBe(0);
    await seedOnce(page, two);
    await page.reload();
    await expect(page.locator('.metric-button')).toHaveCount(2);
    expect(await page.locator(blocks).count()).toBe(0);
    await page.getByRole('button', { name: /Search library/ }).click();
    await expect(page.locator('.library-card')).toHaveCount(2);
    expect(await page.locator(blocks).count()).toBe(0);
  });
});

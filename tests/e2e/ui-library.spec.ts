import { test, expect, type Page } from '@playwright/test';
import {
  aptLast,
  installDesktop,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

const rows = (page: Page) => page.locator('.publication-table tbody tr');
const openMenu = (page: Page) => page.getByLabel('Search actions', { exact: true }).click();

test.describe('Edit & run new search (P5-06)', () => {
  for (const [saved, shown] of [
    [60, '50'],
    [3, '25'],
    [500, '200'],
  ] as const) {
    test(`a saved limit of ${saved} shows and submits the nearest choice, ${shown}`, async ({
      page,
    }) => {
      const query = {
        text: 'epidemic forecasting',
        mode: 'topic' as const,
        sources: ['europepmc' as const],
        limit: saved,
      };
      await seedOnce(
        page,
        workspaceOf([snapshotOf('s1', 'Forecasting', [work('a', 'Paper A')], { query })]),
      );
      let submitted: number | undefined;
      await page.route('**/api/search', (route) => {
        submitted = route.request().postDataJSON().query.limit;
        return route.fulfill({ json: searchResponse([work('n', 'New one')]) });
      });
      await page.goto('/');
      await openMenu(page);
      await page.getByRole('button', { name: 'Edit & run new search' }).click();
      await expect(page.getByLabel('Results per source')).toHaveValue(shown);
      await page.getByRole('button', { name: 'Search publications', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'epidemic forecasting', exact: true }),
      ).toBeVisible();
      expect(submitted).toBe(Number(shown));
    });
  }

  test('an imported snapshot has no search to repeat, and says so', async ({ page }) => {
    const imported = snapshotOf('s1', 'my-list', [work('a', 'Paper A')], {
      query: { text: 'my-list.csv', mode: 'topic', sources: [], limit: 1 },
      sourceResults: [],
    });
    await seedOnce(page, workspaceOf([imported]));
    await page.goto('/');
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toBeDisabled();
    await expect(refresh).toHaveAttribute('title', /Imported publications .* refreshed/);
    await openMenu(page);
    const edit = page.getByRole('button', { name: 'Edit & run new search' });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute('title', /Imported publications have no search to edit/);
  });
});

test.describe('the filter box (P5-07)', () => {
  const people = [
    work('a', 'Transparent forecasting of dengue', 10, 2021, {
      authors: ['María González', 'Bjørn Dæhlen'],
      venue: 'Nature Methods',
      tags: ['read next'],
      notes: 'good figure',
    }),
    work('b', 'Epidemic forecasting with uncertainty', 5, 2019, { authors: ['Jane Scholar'] }),
    work('c', 'Image analysis of tumours', 3, 2020, { authors: ['Li Wei'] }),
  ];
  const filter = (page: Page, text: string) => page.getByLabel('Filter publications').fill(text);

  test.beforeEach(async ({ page }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Filters', people)]));
    await page.goto('/');
  });

  test('finds accented names typed without accents', async ({ page }) => {
    await filter(page, 'gonzalez');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'bjorn daehlen');
    await expect(rows(page)).toHaveCount(1);
  });

  test('finds words in any order', async ({ page }) => {
    await filter(page, 'forecasting epidemic');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Epidemic forecasting with uncertainty');
  });

  test('finds words that sit in different fields', async ({ page }) => {
    await filter(page, 'nature methods 2021');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'gonzalez figure next');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'gonzalez 2019');
    await expect(rows(page)).toHaveCount(0);
  });

  test('typing characters that mean something in a pattern does no harm', async ({ page }) => {
    await filter(page, '( [ * \\ +');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('.table-empty')).toBeVisible();
  });

  test('does not depend on the language rules of the viewer (Turkish dotless i)', async ({
    page,
  }) => {
    // Chromium under emulation keeps English case rules, so make a Turkish runtime explicit:
    // with them, "Image".toLocaleLowerCase() is "ımage" and never contains "image".
    await page.addInitScript(() => {
      const original = String.prototype.toLocaleLowerCase;
      String.prototype.toLocaleLowerCase = function (this: string, locales?: string | string[]) {
        return original.call(this, locales ?? 'tr');
      };
    });
    await page.goto('/');
    await filter(page, 'image');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Image analysis of tumours');
  });
});

test.describe('saved searches that share a name (P5-10)', () => {
  const morning = snapshotOf(
    's1',
    'Nicholas G Reich',
    [work('a', 'Paper A'), work('b', 'Paper B')],
    {
      searchedAt: '2026-09-30T14:00:00.000Z',
    },
  );
  const afternoon = snapshotOf('s2', 'Nicholas G Reich', [work('c', 'Paper C')], {
    searchedAt: '2026-09-30T21:05:00.000Z',
  });

  test('the sidebar, the library, rename and delete show the time and paper count', async ({
    page,
  }) => {
    await seedOnce(page, workspaceOf([afternoon, morning]));
    await page.goto('/');
    const side = page.locator('.saved-search');
    await expect(side.nth(0)).toContainText('1 paper');
    await expect(side.nth(0)).toContainText('Sep 30, 2026, 4:05 PM');
    await expect(side.nth(1)).toContainText('2 papers');
    await expect(side.nth(1)).toContainText('Sep 30, 2026, 9:00 AM');
    await page.getByRole('button', { name: /Search library/ }).click();
    const cards = page.locator('.library-card');
    await expect(cards.nth(0)).toContainText('Sep 30, 2026, 4:05 PM');
    await expect(cards.nth(1)).toContainText('Sep 30, 2026, 9:00 AM');
    await cards.nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename search' }).click();
    await expect(page.getByRole('dialog')).toContainText('Sep 30, 2026, 9:00 AM · 2 publications');
    await page.keyboard.press('Escape');
    await cards.nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await expect(page.getByRole('dialog')).toContainText(
      '“Nicholas G Reich” (Sep 30, 2026, 4:05 PM, 1 publication)',
    );
  });
});

test.describe('deleting a snapshot while it refreshes (P5-10)', () => {
  test('the new results are saved without anything carried over from the deleted snapshot', async ({
    page,
  }) => {
    const curated = work('a', 'Curated paper', 10, 2022, {
      notes: 'my private note',
      tags: ['keep'],
      included: false,
    });
    const original = snapshotOf('s1', 'My named search', [curated], {
      query: { text: 'epidemic forecasting', mode: 'topic', sources: ['europepmc'], limit: 25 },
    });
    const other = snapshotOf('s2', 'Another search', [work('z', 'Zed')]);
    await installDesktop(page, { workspace: workspaceOf([original, other]) });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    // While the refresh runs, the snapshot it was started from is deleted.
    await page
      .locator('.saved-search')
      .filter({ hasText: 'My named search' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
    await page.evaluate(
      (response) => {
        (window as unknown as { __apt: Apt }).__apt.releaseSearch!(response);
      },
      searchResponse([work('a', 'Curated paper', 12, 2022)]),
    );
    await expect(page.locator('.toast')).toContainText('was deleted meanwhile');
    await expect(page.locator('.toast')).not.toContainText('Earlier snapshot kept');
    await expect.poll(async () => (await aptLast(page))?.snapshots.length).toBe(2);
    const saved = (await aptLast(page))!;
    expect(saved.snapshots.map((s) => s.name)).toEqual(['epidemic forecasting', 'Another search']);
    const fresh = saved.snapshots[0];
    expect(fresh.previous).toBeUndefined();
    expect(fresh.works[0]).toMatchObject({ notes: '', tags: [], included: true });
  });
});

import { test, expect, type Page } from '@playwright/test';
import {
  installDesktop,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

const held = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
async function runSearch(page: Page, text: string) {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}
async function removeInChooser(page: Page, entry: ReturnType<typeof held>, names: string[]) {
  await entry.getByRole('button', { name: 'Remove older snapshots…' }).click();
  for (const name of names)
    await page
      .getByRole('dialog')
      .locator('.snapshot-choice', { hasText: name })
      .first()
      .getByRole('checkbox')
      .check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove selected and save results' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('after a removal that is not enough, the reason describes the workspace as it still is (W6-05)', async ({
  page,
}) => {
  await installDesktop(page, { memoryOnly: true });
  await page.addInitScript(() => {
    const record = (id: string, chars: number) => ({
      id,
      title: `Result ${id}`,
      authors: ['Jane Scholar'],
      year: 2024,
      venue: 'Journal',
      doi: `10.1234/${id}`,
      abstract: 'x'.repeat(chars),
      type: 'journal-article',
      url: '',
      openAccessUrl: '',
      isOpenAccess: false,
      citations: 1,
      provenance: [],
      included: true,
      notes: '',
      tags: [],
    });
    const snapshot = (id: string, name: string, minute: number, works: unknown[]) => ({
      id,
      name,
      query: { text: name, mode: 'topic', sources: ['europepmc'], limit: 25 },
      works,
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString(),
      sourceResults: [],
    });
    // 500 saved searches of about 24 MB: the oldest holds about 1.9 MB, the others about 46 KB.
    const snapshots = [
      snapshot(
        'big',
        'Big old search',
        0,
        Array.from({ length: 10 }, (_, i) => record(`big${i}`, 200_000)),
      ),
      ...Array.from({ length: 499 }, (_, i) =>
        snapshot(`s${i}`, `Search ${i}`, i + 1, [record(`s${i}`, 46_000)]),
      ),
    ];
    const desktop = window.desktop!;
    const load = desktop.loadWorkspace.bind(desktop);
    let first = true;
    desktop.loadWorkspace = async () => {
      if (!first) return load();
      first = false;
      return { version: 2, snapshots, activeId: 's0' } as never;
    };
    // New results of about 3.6 MB.
    (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
      searchedAt: '2026-09-20T12:00:00.000Z',
      results: [
        {
          source: 'europepmc',
          total: 25,
          works: Array.from({ length: 25 }, (_, i) => record(`new${i}`, 150_000)),
        },
      ],
    });
  });
  await page.goto('/');
  await runSearch(page, 'Jane Scholar');
  const reason = held(page).locator('p').first();
  const before = await reason.innerText();
  expect(before).toContain('maximum of 500 saved searches');
  expect(before).toMatch(/it uses 2\d\.\d MB now/);
  await removeInChooser(page, held(page), ['Big old search']);
  await expect(page.locator('.nav-count')).toHaveText('500');
  // Nothing was removed, so the same limits and the same room are still needed.
  await expect(reason).toHaveText(before);
});

test.describe('a held refresh and the snapshot it was made from (W6-08)', () => {
  /** 500 saved searches; the oldest, "My author", has a note, a tag and an exclusion. */
  async function heldRefresh(page: Page) {
    const base = workspaceOf(
      Array.from({ length: 500 }, (_, i) => ({
        ...snapshotOf(`s${i}`, `Saved search ${i}`, []),
        searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
      })),
    );
    base.snapshots[0] = {
      ...snapshotOf('s0', 'My author', [
        work('a', 'Paper A', 10, 2022, { notes: 'Years of notes', tags: ['core'] }),
        work('b', 'Paper B', 3, 2020, { included: false }),
      ]),
      searchedAt: base.snapshots[0].searchedAt,
    };
    base.activeId = 's0';
    await seedOnce(page, base);
    await page.route('**/api/search', (route) => {
      const text: string = route.request().postDataJSON().query.text;
      return route.fulfill({
        json: searchResponse(
          text === 'My author'
            ? [work('a', 'Paper A', 12), work('b', 'Paper B', 4)]
            : [work('x', 'Other paper')],
        ),
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Continue anyway', exact: true }).click();
    await expect(held(page)).toHaveCount(1);
  }
  const warning =
    'The unsaved refresh of this search copies its notes, tags and exclusions from it.';

  test('the chooser of other held results warns that a snapshot is the source of a held refresh', async ({
    page,
  }) => {
    await heldRefresh(page);
    await runSearch(page, 'Other query');
    await expect(held(page)).toHaveCount(2);
    await held(page)
      .filter({ hasText: '“Other query”' })
      .getByRole('button', { name: 'Remove older snapshots…' })
      .click();
    const choices = page.getByRole('dialog').locator('.snapshot-choice');
    await expect(choices.filter({ hasText: 'My author' })).toContainText(warning);
    await expect(page.getByRole('dialog').getByText(warning)).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Removing it for the refresh itself is safe: its notes are carried first.
    await held(page)
      .filter({ hasText: '“My author”' })
      .getByRole('button', { name: 'Remove older snapshots…' })
      .click();
    await expect(page.getByRole('dialog').getByText(warning)).toHaveCount(0);
  });

  test('once its source is removed, the refresh note no longer says it is kept', async ({
    page,
  }) => {
    await heldRefresh(page);
    await removeInChooser(page, held(page), ['My author']);
    await expect(held(page)).toHaveCount(0);
    await expect(page.locator('.refresh-note')).not.toContainText('retained in your library');
    await expect(page.locator('.refresh-note')).toContainText(
      'The earlier snapshot is no longer in your library.',
    );
  });

  test('while its source is kept, the refresh note still says so', async ({ page }) => {
    await heldRefresh(page);
    await removeInChooser(page, held(page), ['Saved search 1 ']);
    await expect(held(page)).toHaveCount(0);
    await expect(page.locator('.refresh-note')).toContainText(
      'Earlier snapshot retained in your library.',
    );
  });
});

test('results held a moment before the shell asks to flush are reported to it (W6-11)', async ({
  page,
}) => {
  await installDesktop(page, {
    workspace: workspaceOf(
      Array.from({ length: 500 }, (_, i) => snapshotOf(`s${i}`, `Saved search ${i}`, [])),
    ),
  });
  await page.addInitScript(() => {
    (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
  });
  await page.goto('/');
  await runSearch(page, 'Jane Scholar');
  await expect(page.locator('.search-progress')).toBeVisible();
  const reported = await page.evaluate(
    async (response) => {
      const apt = (window as unknown as { __apt: Apt }).__apt;
      apt.releaseSearch!(response);
      // The search finishes and its results are held; the page has not been drawn again yet.
      for (let i = 0; i < 50; i++) await Promise.resolve();
      await apt.requestFlush();
      return apt.unsaved.at(-1);
    },
    searchResponse([work('n1', 'New paper')]),
  );
  expect(reported).toBe('Search results that could not be saved: “Jane Scholar”.');
});

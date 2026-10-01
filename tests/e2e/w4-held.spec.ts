import { test, expect, type Page } from '@playwright/test';
import {
  aptLast,
  installDesktop,
  readStored,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

/** `count` saved searches with no papers: cheap to store, and they fill the 500-search limit. */
const fullOf = (count: number) =>
  workspaceOf(
    Array.from({ length: count }, (_, i) => ({
      ...snapshotOf(`s${i}`, `Saved search ${i}`, []),
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    })),
  );
const held = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
const heldFor = (page: Page, name: string) => held(page).filter({ hasText: `“${name}”` });

/** Answers each /api/search with results named after the query text; `bad` queries add a record that cannot be saved. */
async function routeByQuery(page: Page, bad = new Set<string>()) {
  await page.route('**/api/search', (route) => {
    const text: string = route.request().postDataJSON().query.text;
    const slug = text.replace(/\W+/g, '-').toLowerCase();
    const works = [work(`${slug}-1`, `${text} paper one`), work(`${slug}-2`, `${text} paper two`)];
    if (bad.has(text)) works.push(work(`${slug}-bad`, 'T'.repeat(25_000), 1, 2020));
    return route.fulfill({ json: searchResponse(works) });
  });
}
async function runSearch(page: Page, text: string) {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}

/** A record with a large abstract, built inside the page. */
const bigRecord = `(id, abstract) => ({
  id, title: 'Result ' + id, authors: ['Jane Scholar'], year: 2024, venue: 'Journal',
  doi: '10.1234/' + id, abstract: 'y'.repeat(abstract), type: 'journal-article', url: '',
  openAccessUrl: '', isOpenAccess: false, citations: 1, provenance: [], included: true,
  notes: '', tags: [],
})`;

test.describe('held results are never dropped without a choice (W4-01)', () => {
  test('a second search that cannot be saved either keeps the first held results', async ({
    page,
  }) => {
    await seedOnce(page, fullOf(500));
    await routeByQuery(page);
    await page.goto('/');
    await runSearch(page, 'First query');
    await expect(heldFor(page, 'First query')).toBeVisible();
    await runSearch(page, 'Second query');
    await expect(heldFor(page, 'Second query')).toBeVisible();
    await expect(heldFor(page, 'First query')).toBeVisible();
    await expect(held(page)).toHaveCount(2);
  });

  test('a later search that saves does not discard the results already held', async ({ page }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Existing', [work('a', 'Paper A')])]));
    await routeByQuery(page, new Set(['Long record query']));
    await page.goto('/');
    await runSearch(page, 'Long record query');
    await expect(heldFor(page, 'Long record query')).toBeVisible();
    await runSearch(page, 'Small query');
    await expect(page.getByRole('heading', { name: 'Small query', exact: true })).toBeVisible();
    await expect(heldFor(page, 'Long record query')).toBeVisible();
    expect((await readStored(page)).snapshots.map((s) => s.name)).toEqual([
      'Small query',
      'Existing',
    ]);
  });

  test('near the 25 MB limit, a small search that saves keeps a held long Scholar run', async ({
    page,
  }) => {
    await installDesktop(page, {
      bulk: { snapshots: 1, worksPerSnapshot: 128, abstractChars: 200_000 },
      memoryOnly: true,
    });
    await page.addInitScript(`{
      const record = ${bigRecord};
      window.__apt.onSearch = async (query) => {
        const works = query.text === 'Long Scholar run'
          ? [record('big1', 200000), record('big2', 200000), record('big3', 200000), record('big4', 200000)]
          : [record('small1', 100)];
        return { searchedAt: '2026-09-20T12:00:00.000Z', results: [{ source: 'europepmc', total: works.length, works }] };
      };
    }`);
    await page.goto('/');
    await runSearch(page, 'Long Scholar run');
    await expect(heldFor(page, 'Long Scholar run')).toContainText('25 MB');
    await runSearch(page, 'Quick check');
    await expect(page.getByRole('heading', { name: 'Quick check', exact: true })).toBeVisible();
    await expect(heldFor(page, 'Long Scholar run')).toBeVisible();
    expect((await aptLast(page))!.snapshots.map((s) => s.name)).toEqual([
      'Quick check',
      'Bulk snapshot 1',
    ]);
  });

  test('each held result set is discarded or saved on its own', async ({ page }) => {
    await seedOnce(page, fullOf(500));
    await routeByQuery(page);
    await page.goto('/');
    await runSearch(page, 'First query');
    await runSearch(page, 'Second query');
    await heldFor(page, 'First query').getByRole('button', { name: 'Discard results' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard results' }).click();
    await expect(heldFor(page, 'First query')).toHaveCount(0);
    await expect(heldFor(page, 'Second query')).toBeVisible();
    await heldFor(page, 'Second query')
      .getByRole('button', { name: 'Remove older snapshots…' })
      .click();
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(held(page)).toHaveCount(0);
    const stored = await readStored(page);
    expect(stored.snapshots[0].name).toBe('Second query');
    expect(stored.snapshots.map((s) => s.name)).not.toContain('Saved search 0');
  });
});

test.describe('making room deletes nothing unless the results then fit (W4-02)', () => {
  test('removing a snapshot that is not enough deletes nothing and names every limit', async ({
    page,
  }) => {
    // 500 saved searches of about 51 KB each: about 24.6 MiB, at the saved-search limit.
    await installDesktop(page, {
      bulk: { snapshots: 500, worksPerSnapshot: 1, abstractChars: 51_000 },
      memoryOnly: true,
    });
    await page.addInitScript(`{
      const record = ${bigRecord};
      window.__apt.onSearch = async () => ({
        searchedAt: '2026-09-20T12:00:00.000Z',
        results: [{ source: 'europepmc', total: 4, works: [record('big1', 150000), record('big2', 150000), record('big3', 150000), record('big4', 150000)] }],
      });
    }`);
    await page.goto('/');
    await runSearch(page, 'Jane Scholar');
    // Both limits are named at once, with the room still needed.
    await expect(held(page)).toContainText('maximum of 500 saved searches');
    await expect(held(page)).toContainText('Remove at least 1 older snapshot');
    await expect(held(page)).toContainText('25 MB');
    await expect(held(page)).toContainText(/at least 0\.\d MB/);
    await held(page).getByRole('button', { name: 'Remove older snapshots…' }).click();
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(held(page)).toContainText('25 MB');
    // Nothing was written and the chosen snapshot is still in the library.
    expect(await aptLast(page)).toBeNull();
    await expect(page.locator('.nav-count')).toHaveText('500');
  });

  test('a record that can never be saved is named next to the saved-search limit', async ({
    page,
  }) => {
    await seedOnce(page, fullOf(500));
    await routeByQuery(page, new Set(['Long record query']));
    await page.goto('/');
    await runSearch(page, 'Long record query');
    await expect(held(page)).toContainText('maximum of 500 saved searches');
    await expect(held(page)).toContainText('record 3');
    await held(page).getByRole('button', { name: 'Remove older snapshots…' }).click();
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(held(page)).toContainText('record 3');
    await expect(page.locator('.nav-count')).toHaveText('500');
    expect((await readStored(page)).snapshots).toHaveLength(500);
  });
});

test.describe('a held refresh is built when it is saved (W4-10)', () => {
  const base = () => {
    const workspace = fullOf(500);
    workspace.snapshots[0] = {
      ...snapshotOf('s0', 'My author', [work('a', 'Paper A'), work('b', 'Paper B')]),
      searchedAt: workspace.snapshots[0].searchedAt,
    };
    workspace.activeId = 's0';
    return workspace;
  };
  async function heldRefresh(page: Page) {
    await seedOnce(page, base());
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('a', 'Paper A', 12), work('b', 'Paper B', 3)]) }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Continue anyway', exact: true }).click();
    await expect(held(page)).toBeVisible();
  }

  test('notes written after the refresh finished are carried into the saved refresh', async ({
    page,
  }) => {
    await heldRefresh(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await page.getByLabel('Research notes').fill('Important note written after the refresh');
    await page.getByRole('button', { name: 'Close publication details' }).click();
    await held(page).getByRole('button', { name: 'Remove older snapshots…' }).click();
    // The oldest is the snapshot being refreshed; remove the next one.
    await page.getByRole('dialog').getByRole('checkbox').nth(1).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(held(page)).toHaveCount(0);
    const stored = await readStored(page);
    const fresh = stored.snapshots[0];
    expect(stored.activeId).toBe(fresh.id);
    expect(fresh.works.find((w) => w.id === 'a')?.notes).toBe(
      'Important note written after the refresh',
    );
    await expect(page.locator('.toast')).toContainText('Earlier snapshot kept in your library.');
  });

  test('removing the refreshed snapshot itself carries its notes and does not claim it was kept', async ({
    page,
  }) => {
    await heldRefresh(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await page.getByLabel('Research notes').fill('Keep this note');
    await page.getByRole('button', { name: 'Close publication details' }).click();
    await held(page).getByRole('button', { name: 'Remove older snapshots…' }).click();
    await expect(page.getByRole('dialog').locator('.snapshot-choice').first()).toContainText(
      'My author',
    );
    await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Remove selected and save results' })
      .click();
    await expect(page.locator('.toast')).toContainText('The earlier snapshot was removed');
    await expect(page.locator('.toast')).not.toContainText('kept');
    const stored = await readStored(page);
    expect(stored.snapshots.some((s) => s.id === 's0')).toBe(false);
    expect(stored.snapshots[0].works.find((w) => w.id === 'a')?.notes).toBe('Keep this note');
  });
});

test('restoring a backup that passes the saved-search limit says how many to remove (W4-13)', async ({
  page,
}) => {
  const many = (prefix: string, n: number) =>
    workspaceOf(
      Array.from({ length: n }, (_, i) => snapshotOf(`${prefix}${i}`, `${prefix} ${i}`, [])),
    );
  await seedOnce(page, many('mine', 300));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'academic-publication-tracker-2026-09-01.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(many('backup', 300))),
  });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('maximum of 500 saved searches');
  await expect(alert).toContainText('Remove at least 100 older snapshots');
  expect((await readStored(page)).snapshots).toHaveLength(300);
});

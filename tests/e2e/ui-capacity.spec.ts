import { test, expect, type Page } from '@playwright/test';
import {
  aptExports,
  aptLast,
  installDesktop,
  readStored,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
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

const results = [work('n1', 'New paper one', 5, 2023), work('n2', 'New paper two', 7, 2024)];

async function routeSearch(page: Page, works = results) {
  let requests = 0;
  await page.route('**/api/search', (route) => {
    requests++;
    return route.fulfill({ json: searchResponse(works) });
  });
  return () => requests;
}
async function runSearch(page: Page, text = 'Jane Scholar') {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}

test.describe('results that do not fit are kept, not dropped (P5-01)', () => {
  test('a search that hits the saved-search limit keeps its results pending and offers export', async ({
    page,
  }) => {
    await seedOnce(page, fullOf(500));
    await routeSearch(page);
    await page.goto('/');
    await runSearch(page);
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('maximum of 500 saved searches');
    await expect(banner).toContainText('“Jane Scholar”');
    await expect(banner).toContainText('2 publications');
    // The workspace itself is untouched.
    expect((await readStored(page)).snapshots).toHaveLength(500);
    // The retrieved records can still be taken out.
    const download = page.waitForEvent('download');
    await banner.getByRole('button', { name: 'Export these results as JSON' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Jane-Scholar.json');
    const stream = await file.createReadStream();
    let text = '';
    for await (const chunk of stream!) text += chunk;
    expect(JSON.parse(text).map((w: { title: string }) => w.title)).toEqual([
      'New paper one',
      'New paper two',
    ]);
    await expect(banner).toBeVisible();
  });

  test('removing older snapshots makes room and the pending results are then saved', async ({
    page,
  }) => {
    await seedOnce(page, fullOf(500));
    await routeSearch(page);
    await page.goto('/');
    await runSearch(page);
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    // Retrying without making room explains the problem again and keeps the results.
    await banner.getByRole('button', { name: 'Retry save' }).click();
    await expect(banner).toContainText('maximum of 500 saved searches');
    await banner.getByRole('button', { name: 'Remove older snapshots…' }).click();
    const dialog = page.getByRole('dialog');
    const choices = dialog.getByRole('checkbox');
    await expect(choices).toHaveCount(500);
    // Oldest first, with date and time to tell them apart.
    await expect(choices.first()).toHaveAccessibleName(/Saved search 0/);
    await expect(dialog.locator('.snapshot-choice').first()).toContainText('Jan 1, 2026');
    const removeButton = dialog.getByRole('button', { name: 'Remove selected and save results' });
    await expect(removeButton).toBeDisabled();
    await choices.nth(0).check();
    await choices.nth(1).check();
    await removeButton.click();
    await expect(page.getByRole('alert').filter({ hasText: 'have not been saved' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Jane Scholar', exact: true })).toBeVisible();
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    await expect.poll(async () => (await readStored(page)).snapshots.length).toBe(499);
    const stored = await readStored(page);
    expect(stored.snapshots[0].name).toBe('Jane Scholar');
    expect(stored.snapshots.map((s) => s.name)).not.toContain('Saved search 0');
    expect(stored.activeId).toBe(stored.snapshots[0].id);
  });

  test('discarding pending results asks first', async ({ page }) => {
    await seedOnce(page, fullOf(500));
    await routeSearch(page);
    await page.goto('/');
    await runSearch(page);
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await banner.getByRole('button', { name: 'Discard results' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep results' }).click();
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Discard results' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard results' }).click();
    await expect(banner).toHaveCount(0);
  });

  test('a file import that does not fit is held the same way', async ({ page }) => {
    await seedOnce(page, fullOf(500));
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Continue anyway', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'my list.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'title,year,doi\nA study of things,2021,10.1/a\nAnother study,2022,10.1/b\n',
      ),
    });
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await expect(banner).toContainText('“my list”');
    await expect(banner).toContainText('2 publications');
  });

  test('a record that is too large is named, with the search and record number', async ({
    page,
  }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Existing', [work('a', 'Paper A')])]));
    await routeSearch(page, [work('ok', 'Fine paper'), work('bad', 'T'.repeat(25_000), 1, 2020)]);
    await page.goto('/');
    await runSearch(page, 'Big titles');
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await expect(banner).toContainText('title');
    await expect(banner).toContainText('“Big titles”');
    await expect(banner).toContainText('record 2');
  });

  test('a search that would exceed the size limit says how large everything is', async ({
    page,
  }) => {
    // About 24.9 MB of a 25 MB workspace already.
    await installDesktop(page, {
      bulk: { snapshots: 1, worksPerSnapshot: 130, abstractChars: 200_000 },
      memoryOnly: true,
    });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
        searchedAt: '2026-09-20T12:00:00.000Z',
        results: [
          {
            source: 'europepmc',
            total: 1,
            works: [
              {
                id: 'big1',
                title: 'A very long abstract',
                authors: ['Jane Scholar'],
                year: 2024,
                venue: 'Journal',
                doi: '10.1/big1',
                abstract: 'y'.repeat(200_000),
                type: 'journal-article',
                url: '',
                openAccessUrl: '',
                isOpenAccess: false,
                citations: 1,
                provenance: [],
                included: true,
                notes: '',
                tags: [],
              },
            ],
          },
        ],
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    // The nearly full workspace is mentioned before anything is typed.
    await expect(page.getByRole('dialog')).toContainText('% full');
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    const banner = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await expect(banner).toContainText('25 MB');
    await expect(banner).toContainText(/uses 24\.\d MB now and these results add about 0\.2 MB/);
    expect(await aptLast(page)).toBeNull();
    expect(await aptExports(page)).toHaveLength(0);
  });
});

test.describe('a nearly full workspace warns before adding more (P5-01)', () => {
  test('New search, Refresh and Import each warn above 90% of a limit', async ({ page }) => {
    await seedOnce(page, fullOf(460));
    const requests = await routeSearch(page);
    await page.goto('/');
    // New search: a note inside the dialog.
    await page.getByRole('button', { name: /New search/ }).click();
    await expect(page.getByRole('dialog').getByRole('note')).toContainText(
      '92% full (460 of 500 saved searches)',
    );
    await page.keyboard.press('Escape');
    // Refresh: a confirmation first.
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const gate = page.getByRole('dialog', { name: 'Your workspace is almost full' });
    await expect(gate).toContainText('92% full');
    await gate.getByRole('button', { name: 'Cancel' }).click();
    expect(requests()).toBe(0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await gate.getByRole('button', { name: 'Continue anyway' }).click();
    await expect.poll(requests).toBe(1);
    // Import: the same confirmation, before the file dialog opens.
    let chosen = 0;
    page.on('filechooser', () => chosen++);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(gate).toBeVisible();
    await gate.getByRole('button', { name: 'Cancel' }).click();
    // Continuing the next time opens the file dialog once: the cancelled attempt opened none.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await gate.getByRole('button', { name: 'Continue anyway' }).click();
    await chooser;
    expect(chosen).toBe(1);
  });

  test('a workspace with room does not warn', async ({ page }) => {
    await seedOnce(page, fullOf(3));
    const requests = await routeSearch(page);
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await expect(page.getByRole('dialog').getByRole('note')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(requests).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

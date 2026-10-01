import { test, expect, type Page } from '@playwright/test';
import {
  aptExports,
  aptLast,
  installDesktop,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

const fullOf = (count: number) =>
  workspaceOf(
    Array.from({ length: count }, (_, i) => ({
      ...snapshotOf(`s${i}`, `Saved search ${i}`, []),
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    })),
  );
const two = workspaceOf([
  snapshotOf('s1', 'First search', [work('a', 'Paper A'), work('b', 'Paper B')]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const held = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
const lastUnsaved = (page: Page) =>
  page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.unsaved.at(-1) ?? null);
async function runSearch(page: Page, text: string) {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}
/** True when a beforeunload listener would make the browser ask before leaving. */
const guardsUnload = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
async function holdResults(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
      searchedAt: '2026-09-20T12:00:00.000Z',
      results: [
        {
          source: 'europepmc',
          total: 2,
          works: [
            {
              id: 'n1',
              title: 'Minutes of Scholar work',
              authors: ['Jane Scholar'],
              year: 2024,
              venue: 'Journal',
              doi: '10.1/n1',
              abstract: 'An abstract.',
              type: 'journal-article',
              url: '',
              openAccessUrl: '',
              isOpenAccess: false,
              citations: 1,
              provenance: [],
              included: true,
              notes: '',
              tags: ['read next'],
            },
          ],
        },
      ],
    });
  });
  await page.goto('/');
  await runSearch(page, 'Jane Scholar');
  await expect(held(page)).toBeVisible();
}

test.describe('the desktop shell is told about unsaved work (W4-09)', () => {
  test('held results are reported by name until they are discarded', async ({ page }) => {
    await installDesktop(page, { workspace: fullOf(500) });
    await holdResults(page);
    await expect.poll(() => lastUnsaved(page)).toContain('“Jane Scholar”');
    // The desktop app never blocks closing with beforeunload; the shell asks instead.
    expect(await guardsUnload(page)).toBe(false);
    await held(page).getByRole('button', { name: 'Discard results' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard results' }).click();
    await expect.poll(() => lastUnsaved(page)).toBeNull();
  });

  test('a failed save is reported until a later save succeeds', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    await page.evaluate(() => ((window as unknown as { __apt: Apt }).__apt.failSaves = 1));
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    await expect.poll(() => lastUnsaved(page)).toBe('Changes that could not be saved.');
    await page.getByRole('checkbox', { name: 'Include Paper B', exact: true }).uncheck();
    await expect.poll(() => lastUnsaved(page)).toBeNull();
  });

  test('a flush whose save fails reports it before answering the shell', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await page.getByLabel('Research notes').fill('Typed just before quitting');
    const reported = await page.evaluate(async () => {
      const apt = (window as unknown as { __apt: Apt }).__apt;
      apt.failSaves = 1;
      await apt.requestFlush();
      return apt.unsaved.at(-1);
    });
    expect(reported).toBe('Changes that could not be saved.');
  });

  test('a flush waits for a save that is still running, and reports its failure', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    // Saves now take a moment, and the next one fails.
    await page.evaluate(() => {
      const desktop = window.desktop!;
      const original = desktop.saveWorkspace.bind(desktop);
      desktop.saveWorkspace = (workspace) =>
        new Promise((resolve, reject) =>
          setTimeout(() => original(workspace).then(resolve, reject), 300),
        );
      (window as unknown as { __apt: Apt }).__apt.failSaves = 1;
    });
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    const reported = await page.evaluate(async () => {
      const apt = (window as unknown as { __apt: Apt }).__apt;
      await apt.requestFlush();
      return apt.unsaved.at(-1);
    });
    expect(reported).toBe('Changes that could not be saved.');
  });

  test('held results are exported as compact JSON', async ({ page }) => {
    await installDesktop(page, { workspace: fullOf(500) });
    await holdResults(page);
    await held(page).getByRole('button', { name: 'Export these results as JSON' }).click();
    await expect.poll(async () => (await aptExports(page)).length).toBe(1);
    const [file] = await aptExports(page);
    expect(file.content).not.toContain('\n');
    expect(JSON.parse(file.content)).toMatchObject([
      { id: 'n1', title: 'Minutes of Scholar work', tags: ['read next'], citations: 1 },
    ]);
  });
});

test.describe('unsaved work in the browser preview (W4-09)', () => {
  test('the browser asks before leaving while results are held, and not after', async ({
    page,
  }) => {
    await seedOnce(page, fullOf(500));
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('n1', 'New paper one')]) }),
    );
    await page.goto('/');
    expect(await guardsUnload(page)).toBe(false);
    await runSearch(page, 'Jane Scholar');
    await expect(held(page)).toBeVisible();
    await expect.poll(() => guardsUnload(page)).toBe(true);
    await held(page).getByRole('button', { name: 'Discard results' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard results' }).click();
    await expect.poll(() => guardsUnload(page)).toBe(false);
  });

  test('closing the tab with held results shows the browser question', async ({ page }) => {
    await seedOnce(page, fullOf(500));
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('n1', 'New paper one')]) }),
    );
    await page.goto('/');
    await runSearch(page, 'Jane Scholar');
    await expect(held(page)).toBeVisible();
    await expect.poll(() => guardsUnload(page)).toBe(true);
    const question = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const dialog = await question;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  });
});

test('dismissing the save error does not claim the changes are stored (W4-11)', async ({
  page,
}) => {
  await installDesktop(page, { workspace: two });
  await page.goto('/');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
  await page.evaluate(() => ((window as unknown as { __apt: Apt }).__apt.failSaves = 1));
  await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
  await expect(page.locator('.local-status')).toContainText('Changes not saved');
  await page.getByRole('button', { name: 'Dismiss save error' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Changes could not be saved' }),
  ).toHaveCount(0);
  await expect(page.locator('.local-status')).toContainText('Changes not saved');
  expect(await aptLast(page)).toBeNull();
});

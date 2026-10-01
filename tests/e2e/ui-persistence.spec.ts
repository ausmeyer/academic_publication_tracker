import { test, expect } from '@playwright/test';
import {
  aptLast,
  aptSaves,
  countCalls,
  installDesktop,
  readStored,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

const two = workspaceOf([
  snapshotOf('s1', 'First search', [work('a', 'Paper A'), work('b', 'Paper B')]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const notes = (page: import('@playwright/test').Page) => page.getByLabel('Research notes');
const open = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('button', { name: title, exact: true }).click();

test.describe('notes and tags are saved without leaving the field (P5-03)', () => {
  test('a note typed and then reloaded without a blur is kept', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await open(page, 'Paper A');
    await notes(page).fill('Typed and never blurred');
    await page.reload();
    await open(page, 'Paper A');
    await expect(notes(page)).toHaveValue('Typed and never blurred');
  });

  test('tags typed and then reloaded without a blur are kept', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await open(page, 'Paper A');
    await page.getByRole('textbox', { name: /Tags/ }).fill('methods, read next');
    await page.reload();
    await open(page, 'Paper A');
    await expect(page.getByRole('button', { name: 'Remove tag methods' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove tag read next' })).toBeVisible();
  });

  test('a note is saved a moment after typing stops', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await open(page, 'Paper A');
    await notes(page).fill('Saved after a pause');
    await expect(notes(page)).toBeFocused();
    await expect
      .poll(async () => (await readStored(page)).snapshots[0].works[0].notes, { timeout: 3000 })
      .toBe('Saved after a pause');
  });

  test('the help text says the note is saved automatically', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await open(page, 'Paper A');
    await expect(page.locator('.paper-detail')).toContainText('Saved automatically');
    await expect(page.locator('.paper-detail')).not.toContainText(
      'Saved when you leave this field',
    );
  });

  test('leaving the field without changing it does not write the workspace', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await open(page, 'Paper A');
    await notes(page).focus();
    await page.getByRole('heading', { name: 'Citation sources' }).click();
    // A later edit is the first thing written: leaving the field wrote nothing before it.
    await page.getByRole('checkbox', { name: 'Include Paper B', exact: true }).uncheck();
    await expect.poll(async () => (await aptSaves(page)).length).toBeGreaterThan(0);
    expect(await aptSaves(page)).toHaveLength(1);
    expect((await aptLast(page))!.snapshots[0].works.map((w) => w.included)).toEqual([true, false]);
  });

  test('the desktop shell can flush a note that is still being typed before it quits', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await open(page, 'Paper A');
    await notes(page).fill('Typed just before quitting');
    await page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.requestFlush());
    const saved = await aptLast(page);
    expect(saved?.snapshots[0].works.find((w) => w.id === 'a')?.notes).toBe(
      'Typed just before quitting',
    );
  });

  test('a search that finishes while typing saves the note on the snapshot being edited', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    await open(page, 'Paper A');
    await notes(page).fill('Typed while the search ran');
    await page.evaluate(
      (response) => {
        (window as unknown as { __apt: Apt }).__apt.releaseSearch!(response);
      },
      searchResponse([work('n1', 'Brand new paper')]),
    );
    await expect(page.getByRole('heading', { name: 'Jane Scholar', exact: true })).toBeVisible();
    await expect.poll(async () => (await aptSaves(page)).length).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const saved = await aptLast(page);
        return saved?.snapshots.find((s) => s.id === 's1')?.works.find((w) => w.id === 'a')?.notes;
      })
      .toBe('Typed while the search ran');
    const saved = (await aptLast(page))!;
    expect(saved.snapshots).toHaveLength(3);
    expect(saved.snapshots[0].works.map((w) => w.notes)).toEqual(['']);
  });
});

test.describe('saving only when something changed (P5-08)', () => {
  test('opening the app does not rewrite an unchanged workspace', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    // A first edit is the first thing written: opening the app wrote nothing before it.
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    await expect.poll(async () => (await aptSaves(page)).length).toBeGreaterThan(0);
    expect(await aptSaves(page)).toHaveLength(1);
    expect((await aptLast(page))!.snapshots[0].works[0].included).toBe(false);
  });

  test('opening another saved search does not rewrite the workspace, but the choice survives a restart', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await page.locator('.saved-search').filter({ hasText: 'Second search' }).click();
    await expect(page.getByRole('heading', { name: 'Second search', exact: true })).toBeVisible();
    // Leaving the page stores which search was open; nothing was written before that.
    const before = await page.evaluate(() => {
      const count = (window as unknown as { __apt: Apt }).__apt.saves.length;
      window.dispatchEvent(new Event('pagehide'));
      return count;
    });
    expect(before).toBe(0);
    await expect.poll(async () => (await aptSaves(page)).length).toBe(1);
    expect((await aptSaves(page))[0].activeId).toBe('s2');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Second search', exact: true })).toBeVisible();
  });

  test('the expensive author analysis only runs in the Insights view', async ({ page }) => {
    const calls = await countCalls(page, 'src/core/insights.ts', 'analyzeInsights');
    await seedOnce(page, two);
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    await expect(page.locator('.metric-value').first()).toHaveText('1');
    expect(await calls()).toBe(0);
    await page.getByRole('button', { name: 'Research insights', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Authorship roles', exact: true }),
    ).toBeVisible();
    expect(await calls()).toBeGreaterThan(0);
  });
});

test.describe('save errors (P5-09)', () => {
  /** Makes the next save fail; set after the app has loaded so a startup save cannot absorb it. */
  const failNextSave = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      (window as unknown as { __apt: Apt }).__apt.failSaves = 1;
    });

  test('the "not saved" message disappears once a later save succeeds', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    await failNextSave(page);
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    await expect(page.getByRole('alert')).toContainText('Changes could not be saved');
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    await page.getByRole('checkbox', { name: 'Include Paper B', exact: true }).uncheck();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    const saved = (await aptLast(page))!;
    expect(saved.snapshots[0].works.map((w) => w.included)).toEqual([false, false]);
  });

  test('a failed save is tried again when the window closes', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
    await failNextSave(page);
    await page.getByRole('checkbox', { name: 'Include Paper A', exact: true }).uncheck();
    await expect(page.getByRole('alert')).toContainText('Changes could not be saved');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(async () => (await aptLast(page))?.snapshots[0].works[0].included)
      .toBe(false);
  });
});

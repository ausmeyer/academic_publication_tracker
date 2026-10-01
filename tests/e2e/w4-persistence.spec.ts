import { test, expect, type Page } from '@playwright/test';
import type { Workspace } from '../../src/types';
import {
  aptLast,
  installDesktop,
  searchResponse,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

const two = workspaceOf([
  snapshotOf('s1', 'First search', [work('a', 'Paper A'), work('b', 'Paper B')]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const notes = (page: Page) => page.getByLabel('Research notes');
const noteOn = async (page: Page, snapshotId: string, workId = 'a') =>
  (await aptLast(page))?.snapshots
    .find((s) => s.id === snapshotId)
    ?.works.find((w) => w.id === workId)?.notes;
const saveCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.saves.length);

/**
 * Loads the app and then stops the clock, so a note is never saved by its 400 ms pause: only the
 * flush under test can save it.
 */
async function openWithStoppedClock(page: Page) {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.goto('/');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
  await page.clock.pauseAt(new Date('2026-09-30T13:00:00Z'));
}

test.describe('notes typed while other work finishes (W4-18)', () => {
  test('a refresh that finishes while a note is typed keeps the note in both snapshots', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
    });
    await openWithStoppedClock(page);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('typed during refresh');
    await page.evaluate(
      (response) => (window as unknown as { __apt: Apt }).__apt.releaseSearch!(response),
      searchResponse([work('a', 'Paper A', 20), work('b', 'Paper B', 30)]),
    );
    await expect.poll(async () => (await aptLast(page))?.snapshots.length).toBe(3);
    const saved = (await aptLast(page))!;
    expect(saved.snapshots.find((s) => s.id === 's1')?.works[0].notes).toBe('typed during refresh');
    expect(saved.snapshots[0].works.find((w) => w.id === 'a')?.notes).toBe('typed during refresh');
  });

  test('a new search that finishes while a note is typed saves the note with its results', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
    });
    await openWithStoppedClock(page);
    // Keep a copy of the first workspace written from here on.
    await page.evaluate(() => {
      const desktop = window.desktop!;
      const original = desktop.saveWorkspace.bind(desktop);
      const w = window as unknown as { firstSave: string | null };
      w.firstSave = null;
      desktop.saveWorkspace = (workspace) => {
        w.firstSave ??= JSON.stringify(workspace);
        return original(workspace);
      };
    });
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('Typed while the search ran');
    await page.evaluate(
      (response) => (window as unknown as { __apt: Apt }).__apt.releaseSearch!(response),
      searchResponse([work('n1', 'Brand new paper')]),
    );
    const first = () =>
      page.evaluate(() => (window as unknown as { firstSave: string | null }).firstSave);
    await expect.poll(first).not.toBeNull();
    // The first write that holds the new results already holds the note.
    const saved = JSON.parse((await first())!) as Workspace;
    expect(saved.snapshots).toHaveLength(3);
    expect(saved.snapshots.find((s) => s.id === 's1')?.works[0].notes).toBe(
      'Typed while the search ran',
    );
  });

  test('an import that finishes while a note is typed keeps the note on its own paper', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await openWithStoppedClock(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('Typed while importing');
    // The import finishes while the field still has focus and unsaved text (a click would blur it
    // and save first), so the new snapshot becomes active before the note is saved.
    await page.evaluate(() => {
      (window as unknown as { __apt: Apt }).__apt.imports.push({
        name: 'list.csv',
        content: 'title,year,doi\nAn imported study,2021,10.9/imported\n',
      });
      [...document.querySelectorAll<HTMLButtonElement>('.topbar-actions button')]
        .find((button) => button.textContent?.trim() === 'Import')!
        .click();
    });
    await expect(page.getByRole('heading', { name: 'list', exact: true })).toBeVisible();
    await expect.poll(() => noteOn(page, 's1')).toBe('Typed while importing');
  });
});

test.describe('each way of leaving saves a note on its own (W4-18)', () => {
  test('with the clock stopped, only the pause after typing saves a note by itself', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await openWithStoppedClock(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('Waiting for its pause');
    expect(await saveCount(page)).toBe(0);
    await page.clock.runFor(500);
    await expect.poll(() => noteOn(page, 's1')).toBe('Waiting for its pause');
  });

  test('the page being hidden saves the note', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await openWithStoppedClock(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('Saved when hidden');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => noteOn(page, 's1')).toBe('Saved when hidden');
  });

  test('pagehide saves the note', async ({ page }) => {
    await installDesktop(page, { workspace: two });
    await openWithStoppedClock(page);
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await notes(page).fill('Saved on pagehide');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => noteOn(page, 's1')).toBe('Saved on pagehide');
  });
});

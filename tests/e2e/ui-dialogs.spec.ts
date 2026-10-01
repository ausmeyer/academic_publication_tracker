import { test, expect, type Page } from '@playwright/test';
import { aptExports, installDesktop, seedOnce, snapshotOf, work, workspaceOf } from './ui-helpers';

const two = workspaceOf([
  snapshotOf('s1', 'First search', [work('a', 'Paper A'), work('b', 'Paper B')]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const newSearch = (page: Page) => page.locator('.new-search');
const savedSearch = (page: Page, name: string) =>
  page.locator('.saved-search').filter({ hasText: name });
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('focus goes back to the opener (P5-04)', () => {
  test.beforeEach(async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
  });

  test('Escape from New search returns focus to the New search button', async ({ page }) => {
    await newSearch(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(newSearch(page)).toBeFocused();
  });

  test('Cancel and the close button also return focus', async ({ page }) => {
    await newSearch(page).click();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(newSearch(page)).toBeFocused();
    await newSearch(page).click();
    await dialog(page).getByRole('button', { name: 'Close dialog' }).click();
    await expect(newSearch(page)).toBeFocused();
  });

  test('Settings, Export and About return focus to their own buttons', async ({ page }) => {
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click();
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await exportButton.click();
    await page.keyboard.press('Escape');
    await expect(exportButton).toBeFocused();
    const about = page.getByRole('button', { name: /About & metric guide/ });
    await about.click();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(about).toBeFocused();
  });

  test('Rename from the context menu returns focus to the saved search', async ({ page }) => {
    const second = savedSearch(page, 'Second search');
    await second.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename search' }).click();
    await expect(page.getByRole('textbox', { name: 'Search name' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(second).toBeFocused();
  });

  test('Delete from the context menu returns focus when kept, and lands in the page when deleted', async ({
    page,
  }) => {
    const second = savedSearch(page, 'Second search');
    await second.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await dialog(page).getByRole('button', { name: 'Keep snapshot' }).click();
    await expect(second).toBeFocused();
    await second.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete search' }).click();
    await dialog(page).getByRole('button', { name: 'Delete snapshot' }).click();
    await expect(second).toHaveCount(0);
    await expect(page.locator('main')).toBeFocused();
  });

  test('actions from the "Search actions" menu return focus to that menu', async ({ page }) => {
    const summary = page.getByLabel('Search actions', { exact: true });
    await summary.click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    await page.keyboard.press('Escape');
    await expect(summary).toBeFocused();
  });

  test('keyboard focus cannot leave an open dialog, even after clicking its title', async ({
    page,
  }) => {
    const inDialog = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
    await newSearch(page).click();
    await expect(dialog(page)).toBeVisible();
    // The page behind the dialog is out of reach while it is open ...
    expect(await page.evaluate(() => document.getElementById('root')!.hasAttribute('inert'))).toBe(
      true,
    );
    await dialog(page).getByRole('heading', { name: 'Start a new search' }).click();
    await page.keyboard.press('Shift+Tab');
    expect(await inDialog()).toBe(true);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await inDialog()).toBe(true);
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inDialog()).toBe(true);
    }
    // ... and reachable again once it is closed.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('root')!.hasAttribute('inert'))).toBe(
      false,
    );
  });

  test('opening a paper moves focus into its details; closing returns it to the row', async ({
    page,
  }) => {
    const title = page.getByRole('button', { name: 'Paper B', exact: true });
    await title.click();
    await expect(page.getByRole('heading', { name: 'Paper B', level: 2 })).toBeFocused();
    await page.getByRole('button', { name: 'Close publication details' }).click();
    await expect(title).toBeFocused();
    await title.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Publication details' })).toHaveCount(0);
    await expect(title).toBeFocused();
  });
});

test.describe('shortcuts and guards (P5-09)', () => {
  test('Ctrl+K does not replace a dialog that is already open', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.keyboard.press('Control+k');
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText('Workspace settings');
  });

  test('Ctrl+K explains instead of opening a dead dialog while the workspace is unreadable', async ({
    page,
  }) => {
    await installDesktop(page, { failLoad: true });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('alert')).toContainText('Restore a workspace backup');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('both load failures are shown, not just the last one', async ({ page }) => {
    await installDesktop(page, { failLoad: true, failSettings: true });
    await page.goto('/');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Your saved workspace could not be loaded');
    await expect(alert).toContainText('Saved API settings could not be read');
  });

  test('the notice that the workspace was restored from its backup stays on screen until dismissed', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: two,
      recoveryNotice:
        'Your workspace file could not be read; the automatic backup from Sep 29, 2026 was loaded.',
    });
    await page.clock.install();
    await page.goto('/');
    const notice = page.getByRole('status').filter({ hasText: 'automatic backup from Sep 29' });
    await expect(notice).toBeVisible();
    // A minute passes: longer than any notification stays on screen.
    await page.clock.fastForward('01:00');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss notice' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('a backup is not offered while the saved workspace is unreadable', async ({ page }) => {
    await installDesktop(page, { failLoad: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const backup = page.getByRole('button', { name: /Back up workspace as JSON/ });
    await expect(backup).toBeDisabled();
    await expect(dialog(page)).toContainText('unreadable');
    expect(await aptExports(page)).toHaveLength(0);
  });

  test('a rename that is only spaces says so instead of doing nothing', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await savedSearch(page, 'Second search').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename search' }).click();
    await page.getByRole('textbox', { name: 'Search name' }).fill('    ');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Enter a name');
    await expect(dialog(page)).toBeVisible();
    await page.getByRole('textbox', { name: 'Search name' }).fill('Renamed');
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(savedSearch(page, 'Renamed')).toBeVisible();
  });
});

test.describe('typed input is not lost by accident (P5-09)', () => {
  test('Escape and a click outside ask before discarding a typed search', async ({ page }) => {
    await page.goto('/');
    await newSearch(page).click();
    const author = page.getByRole('textbox', { name: 'Author name' });
    await author.fill('Jane Scholar');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toContainText('Discard what you entered?');
    await expect(author).toHaveValue('Jane Scholar');
    await dialog(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog(page)).not.toContainText('Discard what you entered?');
    await expect(author).toHaveValue('Jane Scholar');
    // A click on the dimmed backdrop asks too.
    await page.mouse.click(8, 8);
    await expect(dialog(page)).toContainText('Discard what you entered?');
    await dialog(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(newSearch(page)).toBeFocused();
  });

  test('a search dialog with nothing typed closes at once', async ({ page }) => {
    await page.goto('/');
    await newSearch(page).click();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await newSearch(page).click();
    await page.mouse.click(8, 8);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Settings asks before discarding a typed key or email', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel(/Contact email/).fill('me@university.edu');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toContainText('Discard what you entered?');
    await dialog(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel(/Contact email/)).toHaveValue('me@university.edu');
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('a failed search reopens the dialog with the same query and the reason', async ({
    page,
  }) => {
    await page.route('**/api/search', (route) =>
      route.fulfill({ status: 400, json: { error: 'Rate limited. Try again later.' } }),
    );
    await page.goto('/');
    await newSearch(page).click();
    await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search terms' }).fill('my failing topic');
    await page.getByLabel('From year').fill('2019');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search terms' })).toHaveValue(
      'my failing topic',
    );
    await expect(page.getByLabel('From year')).toHaveValue('2019');
    await expect(dialog(page).getByRole('alert')).toContainText('Rate limited');
  });
});

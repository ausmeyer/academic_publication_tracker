import { test, expect, type Page } from '@playwright/test';
import { aptLast, installDesktop, type Apt } from './ui-helpers';

/** Two saved searches of about 13 MB each, 5 bytes below the 25 MB limit: no edit that adds text fits. */
const nearlyFull = {
  bulk: { snapshots: 2, worksPerSnapshot: 66, abstractChars: 198_000, headroom: 5 },
  memoryOnly: true,
};
const notes = (page: Page) => page.getByLabel('Research notes');
const tagField = (page: Page) => page.getByRole('textbox', { name: /Tags/ });
const refusedBanner = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'This edit was not saved' });
const lastUnsaved = (page: Page) =>
  page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.unsaved.at(-1) ?? null);
/** What the renderer reports when the desktop shell asks it to flush before quitting. */
const reportedAtQuit = (page: Page) =>
  page.evaluate(async () => {
    const apt = (window as unknown as { __apt: Apt }).__apt;
    await apt.requestFlush();
    return apt.unsaved.at(-1) ?? null;
  });
const storedPaper = async (page: Page) =>
  (await aptLast(page))?.snapshots
    .find((s) => s.id === 'bulk-0')
    ?.works.find((w) => w.id === 'bulk-0-0');
const openPaper = (page: Page) =>
  page.getByRole('button', { name: 'Bulk paper 0-0', exact: true }).click();
const closePaper = (page: Page) =>
  page.getByRole('button', { name: 'Close publication details' }).click();
/** Deletes the other saved search, as the error advises, which frees about 13 MB. */
async function makeRoom(page: Page) {
  await page
    .locator('.saved-search')
    .filter({ hasText: 'Bulk snapshot 2' })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete search' }).click();
  await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
  await expect(page.locator('.nav-count')).toHaveText('1');
}
const reported = 'Edits that could not be saved: “Bulk paper 0-0”.';

test.describe('an edit the workspace refuses is kept and reported, not dropped (W6-01)', () => {
  test.beforeEach(async ({ page }) => {
    await installDesktop(page, nearlyFull);
    await page.goto('/');
    await openPaper(page);
  });

  test('a refused note stays, counts as unsaved, survives closing the panel and is saved once there is room', async ({
    page,
  }) => {
    const note = 'Why this paper matters: a note the full workspace cannot take.';
    await notes(page).fill(note);
    await notes(page).blur();
    await expect(refusedBanner(page)).toBeVisible();
    await expect(notes(page)).toHaveValue(note);
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    await expect.poll(() => lastUnsaved(page)).toBe(reported);
    expect(await reportedAtQuit(page)).toBe(reported);
    // Closing the panel does not drop it: the paper opens with the note again.
    await closePaper(page);
    await openPaper(page);
    await expect(notes(page)).toHaveValue(note);
    await closePaper(page);
    expect(await reportedAtQuit(page)).toBe(reported);
    await makeRoom(page);
    await expect.poll(async () => (await storedPaper(page))?.notes).toBe(note);
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    await expect.poll(() => lastUnsaved(page)).toBeNull();
    await expect(refusedBanner(page)).toHaveCount(0);
  });

  test('a note typed just before quitting that is refused is reported before the shell is answered', async ({
    page,
  }) => {
    await notes(page).fill('Typed just before quitting');
    expect(await reportedAtQuit(page)).toBe(reported);
    await expect(notes(page)).toHaveValue('Typed just before quitting');
  });

  test('a refused note that is emptied again is dropped, and nothing is left unsaved', async ({
    page,
  }) => {
    await notes(page).fill('A note that will be taken back');
    await notes(page).blur();
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    await notes(page).fill('');
    await notes(page).blur();
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    await expect.poll(() => lastUnsaved(page)).toBeNull();
    expect(await reportedAtQuit(page)).toBeNull();
    expect((await storedPaper(page))?.notes ?? '').toBe('');
  });

  test('a refused tag stays in the field, survives closing the panel and is saved once there is room', async ({
    page,
  }) => {
    await tagField(page).fill('read next');
    await tagField(page).press('Enter');
    await expect(refusedBanner(page)).toBeVisible();
    await expect(tagField(page)).toHaveValue('read next');
    await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(0);
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    expect(await reportedAtQuit(page)).toBe(reported);
    await closePaper(page);
    await openPaper(page);
    await expect(tagField(page)).toHaveValue('read next');
    await closePaper(page);
    await makeRoom(page);
    await expect.poll(async () => (await storedPaper(page))?.tags).toEqual(['read next']);
    await expect.poll(() => lastUnsaved(page)).toBeNull();
    await openPaper(page);
    await expect(page.getByRole('button', { name: 'Remove tag read next' })).toBeVisible();
    await expect(tagField(page)).toHaveValue('');
  });

  test('a refused rename keeps the dialog and the typed name, and counts as unsaved until it is closed', async ({
    page,
  }) => {
    await closePaper(page);
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Search name' })
      .fill('Influenza forecasting, reviewed');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog.getByRole('alert')).toContainText('not saved');
    await expect(dialog.getByRole('textbox', { name: 'Search name' })).toHaveValue(
      'Influenza forecasting, reviewed',
    );
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    expect(await reportedAtQuit(page)).toBe(
      'Edits that could not be saved: “Influenza forecasting, reviewed”.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    await expect.poll(() => lastUnsaved(page)).toBeNull();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk snapshot 1');
  });

  test('a shorter name typed after a refused one is saved, and nothing is left unsaved', async ({
    page,
  }) => {
    await closePaper(page);
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    const dialog = page.getByRole('dialog');
    const field = dialog.getByRole('textbox', { name: 'Search name' });
    await field.fill('Influenza forecasting, reviewed');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog.getByRole('alert')).toContainText('not saved');
    // One character longer than before: it fits in the 5 bytes left.
    await field.fill('Bulk snapshot 1b');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bulk snapshot 1b');
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    await expect.poll(() => lastUnsaved(page)).toBeNull();
  });

  test('the panel sends a refused note again when it closes, so it is saved once room is made', async ({
    page,
  }) => {
    await notes(page).fill('Short note');
    await notes(page).blur();
    await expect(page.locator('.local-status')).toContainText('Changes not saved');
    // A shorter search name frees 14 bytes while the panel stays open.
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Search name' }).fill('B');
    await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('B');
    await expect(notes(page)).toHaveValue('Short note');
    await closePaper(page);
    await expect.poll(async () => (await storedPaper(page))?.notes).toBe('Short note');
    await expect(page.locator('.local-status')).toContainText('Stored on this device');
    await expect.poll(() => lastUnsaved(page)).toBeNull();
  });
});

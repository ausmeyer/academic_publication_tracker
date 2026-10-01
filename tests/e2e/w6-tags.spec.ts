import { test, expect, type Page } from '@playwright/test';
import {
  aptLast,
  auditPage,
  installDesktop,
  readStored,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

const storedTags = async (page: Page) => (await readStored(page)).snapshots[0].works[0].tags;
const tagField = (page: Page) => page.getByRole('textbox', { name: /Tags/ });
const tagMessage = (page: Page) => page.locator('.paper-detail').getByRole('status');
async function openPaperWithTags(page: Page, tags: string[]) {
  await seedOnce(
    page,
    workspaceOf([snapshotOf('s1', 'First', [work('a', 'Paper A', 10, 2022, { tags })])]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Paper A', exact: true }).click();
}

test.describe('a typed tag is added, or the person is told why not (W6-04)', () => {
  test('a tag typed on a paper whose imported keywords repeat one is added and shown', async ({
    page,
  }) => {
    await page.goto('/');
    const ris = [
      'TY  - JOUR',
      'TI  - Forecasting seasonal influenza',
      'PY  - 2019',
      'KW  - Influenza, Human',
      'KW  - methods',
      'KW  - methods',
      'ER  - ',
      '',
    ].join('\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'pubmed.ris', mimeType: 'text/plain', buffer: Buffer.from(ris) });
    await page.getByRole('button', { name: 'Forecasting seasonal influenza', exact: true }).click();
    await expect.poll(() => storedTags(page)).toEqual(['Influenza, Human', 'methods', 'methods']);
    await tagField(page).fill('read next');
    await tagField(page).press('Enter');
    await expect.poll(() => storedTags(page)).toEqual(['Influenza, Human', 'methods', 'read next']);
    await expect(page.getByRole('button', { name: 'Remove tag read next' })).toBeVisible();
    await expect(tagField(page)).toHaveValue('');
  });

  test('at 100 tags a typed tag stays in the field, the person is told, and it is added once there is room', async ({
    page,
  }) => {
    await openPaperWithTags(
      page,
      Array.from({ length: 100 }, (_, i) => `tag ${i}`),
    );
    await tagField(page).fill('one more');
    await tagField(page).press('Enter');
    await expect(tagField(page)).toHaveValue('one more');
    await expect(tagMessage(page)).toHaveText(
      'A paper can have at most 100 tags. Remove one to add another.',
    );
    await expect(tagField(page)).toHaveAccessibleDescription(/at most 100 tags/);
    await page.getByRole('button', { name: 'Remove tag tag 0', exact: true }).click();
    await tagField(page).press('Enter');
    await expect.poll(async () => (await storedTags(page)).includes('one more')).toBe(true);
    await expect(tagField(page)).toHaveValue('');
    await expect(tagMessage(page)).toHaveText('');
  });

  test('a tag that is already there is not added again, and the person is told', async ({
    page,
  }) => {
    await openPaperWithTags(page, ['methods']);
    await tagField(page).fill('methods');
    await tagField(page).press('Enter');
    await expect(tagMessage(page)).toHaveText('“methods” is already a tag.');
    const audit = await page.evaluate(auditPage);
    expect(audit.contrast.filter((c) => c.text.includes('already a tag'))).toEqual([]);
    expect(audit.small.filter((c) => c.text.includes('already a tag'))).toEqual([]);
    await expect(tagField(page)).toHaveValue('');
    await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(1);
    await tagField(page).pressSequentially('rev', { delay: 5 });
    await expect(tagMessage(page)).toHaveText('');
  });
});

test('the tag field is described by its instructions (W6-10)', async ({ page }) => {
  await openPaperWithTags(page, []);
  await expect(tagField(page)).toHaveAccessibleDescription(
    /Press Enter or type a comma to add a tag/,
  );
});

test('the Enter that confirms an input-method composition does not add a tag (W6-06)', async ({
  page,
}) => {
  await openPaperWithTags(page, []);
  await tagField(page).click();
  // The input method holds the reading "とうきょう" and waits for it to be converted.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'とうきょう',
    selectionStart: 5,
    selectionEnd: 5,
  });
  await page.keyboard.press('Enter');
  await expect(tagField(page)).toHaveValue('とうきょう');
  await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(0);
  expect(await storedTags(page)).toEqual([]);
});

test.describe('a word being typed is not cut into a tag when the window is left (W6-07)', () => {
  test('hiding the window and coming back', async ({ page }) => {
    await openPaperWithTags(page, []);
    await tagField(page).pressSequentially('epidem', { delay: 5 });
    await page.evaluate(() => {
      for (const state of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => state,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await expect(tagField(page)).toHaveValue('epidem');
    await tagField(page).pressSequentially('iology', { delay: 5 });
    await tagField(page).press('Enter');
    await expect.poll(() => storedTags(page)).toEqual(['epidemiology']);
  });

  test('switching to another app and back, while leaving the field for the page still adds it', async ({
    page,
  }) => {
    await openPaperWithTags(page, []);
    await tagField(page).pressSequentially('epidem', { delay: 5 });
    // The window loses focus: the field is blurred while the document has none.
    await page.evaluate(() => {
      const hasFocus = document.hasFocus;
      document.hasFocus = () => false;
      document.activeElement!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      document.hasFocus = hasFocus;
    });
    await expect(tagField(page)).toHaveValue('epidem');
    expect(await storedTags(page)).toEqual([]);
    await page.getByLabel('Research notes').click();
    await expect.poll(() => storedTags(page)).toEqual(['epidem']);
  });

  test('closing the window adds it', async ({ page }) => {
    await openPaperWithTags(page, []);
    await tagField(page).fill('to read');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => storedTags(page)).toEqual(['to read']);
  });

  test('a flush request from the desktop shell adds it', async ({ page }) => {
    await installDesktop(page, {
      workspace: workspaceOf([snapshotOf('s1', 'First', [work('a', 'Paper A')])]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await tagField(page).fill('to read');
    await page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.requestFlush());
    expect((await aptLast(page))?.snapshots[0].works[0].tags).toEqual(['to read']);
  });
});

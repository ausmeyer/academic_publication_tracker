import { test, expect, type Page } from '@playwright/test';
import { readStored, seedOnce, snapshotOf, work, workspaceOf } from './ui-helpers';

const storedTags = async (page: Page) => (await readStored(page)).snapshots[0].works[0].tags;
const addField = (page: Page) => page.getByRole('textbox', { name: /Tags/ });

test.describe('tags are edited one at a time (W4-03)', () => {
  test('adding a tag keeps imported keywords that contain commas', async ({ page }) => {
    await page.goto('/');
    const ris = [
      'TY  - JOUR',
      'TI  - Forecasting seasonal influenza in the United States',
      'PY  - 2019',
      'KW  - Influenza, Human',
      'KW  - Models, Theoretical',
      'ER  - ',
      '',
    ].join('\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'pubmed.ris', mimeType: 'text/plain', buffer: Buffer.from(ris) });
    await page
      .getByRole('button', {
        name: 'Forecasting seasonal influenza in the United States',
        exact: true,
      })
      .click();
    // Each keyword is shown whole, with its own remove button.
    await expect(page.getByRole('button', { name: 'Remove tag Influenza, Human' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove tag Models, Theoretical' }),
    ).toBeVisible();
    await addField(page).fill('read next');
    await addField(page).press('Enter');
    // Saved at once, without leaving the field.
    await expect
      .poll(() => storedTags(page))
      .toEqual(['Influenza, Human', 'Models, Theoretical', 'read next']);
    await expect(addField(page)).toHaveValue('');
    await expect(addField(page)).toBeFocused();
  });

  test('a comma in the field adds what was typed before it', async ({ page }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'First', [work('a', 'Paper A')])]));
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await addField(page).pressSequentially('methods, review,', { delay: 5 });
    await expect.poll(() => storedTags(page)).toEqual(['methods', 'review']);
    await expect(addField(page)).toHaveValue('');
    // A tag that is already there is not added twice.
    await addField(page).fill('methods');
    await addField(page).press('Enter');
    await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(2);
  });

  test('a remove button removes only its own tag', async ({ page }) => {
    await seedOnce(
      page,
      workspaceOf([
        snapshotOf('s1', 'First', [
          work('a', 'Paper A', 10, 2022, { tags: ['Influenza, Human', 'methods', 'review'] }),
        ]),
      ]),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await page.getByRole('button', { name: 'Remove tag methods' }).click();
    await expect.poll(() => storedTags(page)).toEqual(['Influenza, Human', 'review']);
    await expect(page.getByRole('button', { name: 'Remove tag methods' })).toHaveCount(0);
  });

  test('a tag typed without Enter is kept when the field loses focus', async ({ page }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'First', [work('a', 'Paper A')])]));
    await page.goto('/');
    await page.getByRole('button', { name: 'Paper A', exact: true }).click();
    await addField(page).fill('to read');
    await page.getByLabel('Research notes').click();
    await expect.poll(() => storedTags(page)).toEqual(['to read']);
    await expect(page.getByRole('button', { name: 'Remove tag to read' })).toBeVisible();
  });
});

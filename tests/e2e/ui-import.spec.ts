import { test, expect, type Page } from '@playwright/test';

async function importFile(page: Page, name: string, buffer: Buffer, mimeType = 'text/csv') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

test.describe('imported files are decoded and summarised (P5-15)', () => {
  test('a Windows-1252 CSV keeps its accents', async ({ page }) => {
    await page.goto('/');
    await importFile(
      page,
      'cafe.csv',
      Buffer.from('title,year,doi\nCafé society,2021,10.1234/cafe\n', 'latin1'),
    );
    await expect(page.getByRole('button', { name: 'Café society', exact: true })).toBeVisible();
  });

  test('a UTF-16 CSV with a byte-order mark is read', async ({ page }) => {
    await page.goto('/');
    const text = 'title,year,doi\nNaïve Bayes revisited,2020,10.1234/naive\n';
    await importFile(
      page,
      'utf16.csv',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
    );
    await expect(
      page.getByRole('button', { name: 'Naïve Bayes revisited', exact: true }),
    ).toBeVisible();
  });

  test('the import message says how many duplicates were merged', async ({ page }) => {
    await page.goto('/');
    await importFile(
      page,
      'dupes.csv',
      Buffer.from(
        'title,year,doi\nA study of things,2021,10.1234/a\nA study of things,2021,10.1234/a\nAnother study,2022,10.1234/b\n',
      ),
    );
    await expect(page.locator('.toast')).toContainText(
      'Imported 2 publications (1 duplicate merged).',
    );
    await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
  });

  test('the import message names the columns it did not recognise', async ({ page }) => {
    await page.goto('/');
    await importFile(
      page,
      'extra.csv',
      Buffer.from('title,year,doi,Funding\nA study of things,2021,10.1234/a,NIH\n'),
    );
    await expect(page.locator('.toast')).toContainText(
      'Imported 1 publication. Ignored columns: Funding.',
    );
  });

  test('the import message is plain when nothing was merged', async ({ page }) => {
    await page.goto('/');
    await importFile(
      page,
      'plain.csv',
      Buffer.from('title,year,doi\nA study of things,2021,10.1234/a\n'),
    );
    await expect(page.locator('.toast')).toHaveText('Imported 1 publication.');
  });
});

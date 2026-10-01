import { test, expect } from '@playwright/test';
import { seedOnce, snapshotOf, work, workspaceOf } from './ui-helpers';

test('the crash screen can export the saved workspace before reloading (P5-09)', async ({
  page,
}) => {
  const saved = workspaceOf([
    snapshotOf('s1', 'First search', [work('a', 'Paper A'), work('b', 'Paper B')]),
    snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
  ]);
  await seedOnce(page, saved);
  await page.goto('/');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(2);
  // Make the next render fail: formatNumber builds an Intl.NumberFormat.
  await page.evaluate(() => {
    (Intl as unknown as { NumberFormat: unknown }).NumberFormat = function () {
      throw new Error('simulated render failure');
    };
  });
  await page.getByLabel('Filter publications').fill('Paper');
  await expect(
    page.getByRole('heading', { name: 'Something interrupted your workspace.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload app' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^academic-publication-tracker-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const stream = await file.createReadStream();
  let text = '';
  for await (const chunk of stream!) text += chunk;
  const exported = JSON.parse(text);
  expect(exported.snapshots.map((s: { name: string }) => s.name)).toEqual([
    'First search',
    'Second search',
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'backup exported' })).toBeVisible();
});

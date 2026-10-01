import { test, expect } from '@playwright/test';
import { countCalls, seedOnce, snapshotOf, work, workspaceOf } from './ui-helpers';

test('the search library does not recompute every snapshot on each render (W4-19)', async ({
  page,
}) => {
  // Measured: 500 snapshots of 200 publications cost 240-940 ms per library render in Node.
  const calls = await countCalls(page, 'src/core/metrics.ts', 'calculateMetrics');
  await seedOnce(
    page,
    workspaceOf(
      Array.from({ length: 30 }, (_, i) =>
        snapshotOf(`s${i}`, `Search ${i}`, [work(`a${i}`, `Paper ${i}`)]),
      ),
    ),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Search library/ }).click();
  await expect(page.locator('.library-card')).toHaveCount(30);
  const shown = await calls();
  // Anything that re-renders the app, such as opening a menu or a progress update.
  await page.locator('.library-card').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect((await calls()) - shown).toBeLessThan(30);
});

import { test, expect, type Page } from '@playwright/test';
import { installDesktop, settled, snapshotOf, work, workspaceOf, type Apt } from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });

const one = workspaceOf([snapshotOf('s1', 'Existing', [work('a', 'Paper A')])]);
/** The open dialog's footer buttons and close button that the toast overlaps. */
const coveredButtons = (page: Page) =>
  page.evaluate(() => {
    const toast = document.querySelector('.toast')!.getBoundingClientRect();
    return [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"] .modal-footer button, [role="dialog"] .modal-header button',
      ),
    ]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return (
          Math.min(box.right, toast.right) - Math.max(box.left, toast.left) > 0 &&
          Math.min(box.bottom, toast.bottom) - Math.max(box.top, toast.top) > 0
        );
      })
      .map((button) => button.getAttribute('aria-label') || (button.textContent ?? '').trim());
  });

test.describe('a notification does not cover the buttons of an open dialog (W6-09)', () => {
  for (const size of [
    { width: 1060, height: 700 },
    { width: 1440, height: 900 },
  ])
    test(`a backup made from Settings at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await installDesktop(page, { workspace: one });
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Back up workspace as JSON' }).click();
      await expect(page.locator('.toast')).toContainText('Workspace backup exported.');
      await settled(page);
      expect(await coveredButtons(page)).toEqual([]);
      await expect(page.locator('.toast')).toBeInViewport({ ratio: 1 });
    });

  test('a backup made from the chooser of held results, zoomed in', async ({ page }) => {
    await page.setViewportSize({ width: 848, height: 560 });
    await installDesktop(page, {
      workspace: workspaceOf(
        Array.from({ length: 500 }, (_, i) => snapshotOf(`s${i}`, `Saved search ${i}`, [])),
      ),
    });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
        searchedAt: '2026-09-20T12:00:00.000Z',
        results: [{ source: 'europepmc', total: 0, works: [] }],
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Held query');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await page.getByRole('button', { name: 'Remove older snapshots…' }).click();
    await page.getByRole('button', { name: 'Back up workspace first' }).click();
    await expect(page.locator('.toast')).toContainText('Workspace backup exported.');
    await settled(page);
    expect(await coveredButtons(page)).toEqual([]);
  });
});

test.describe('accessibility of round-two markup (W6-10)', () => {
  test('each "Get a key" button names its provider', async ({ page }) => {
    await installDesktop(page, { workspace: one });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const provider of ['OpenAlex', 'Semantic Scholar', 'NCBI / PubMed'])
      await expect(
        page.getByRole('button', { name: `Get a key for ${provider}`, exact: true }),
      ).toHaveCount(1);
  });

  test('in forced colours an excluded row still looks different from an included one', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await installDesktop(page, {
      workspace: workspaceOf([
        snapshotOf('s1', 'Existing', [
          work('a', 'Included paper'),
          work('b', 'Excluded paper', 3, 2020, { included: false }),
        ]),
      ]),
    });
    await page.goto('/');
    const look = (name: string) =>
      page.getByRole('button', { name, exact: true }).evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.fontStyle, style.textDecorationLine, style.borderStyle].join(' ');
      });
    expect(await look('Excluded paper')).not.toBe(await look('Included paper'));
  });

  test('after "Retry save" from the keyboard saves the results, focus is in the page', async ({
    page,
  }) => {
    await installDesktop(page, {
      workspace: workspaceOf(
        Array.from({ length: 500 }, (_, i) =>
          snapshotOf(`s${i}`, `Saved search ${i}`, i ? [] : [work('a', 'Paper A')]),
        ),
      ),
    });
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
        searchedAt: '2026-09-20T12:00:00.000Z',
        results: [{ source: 'europepmc', total: 0, works: [] }],
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Held query');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    const held = page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
    await expect(held).toHaveCount(1);
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete this snapshot' }).click();
    await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
    await held.getByRole('button', { name: 'Retry save' }).focus();
    await page.keyboard.press('Enter');
    await expect(held).toHaveCount(0);
    await expect(page.locator('main')).toBeFocused();
  });
});

test.describe('a message raised while a dialog is open is announced from the dialog (W6-11)', () => {
  /** Starts a search that waits, opens Settings, then lets the search finish with `outcome`. */
  async function finishBehindSettings(page: Page, outcome: () => Promise<unknown>) {
    await page.addInitScript(() => {
      (window as unknown as { __apt: Apt }).__apt.holdSearches = true;
    });
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await outcome();
  }

  test('a search that fails', async ({ page }) => {
    await installDesktop(page, { workspace: one });
    await finishBehindSettings(page, () =>
      page.evaluate(() =>
        (window as unknown as { __apt: Apt }).__apt.releaseSearch!(
          Promise.reject(new Error('Rate limited. Try again later.')),
        ),
      ),
    );
    await expect(
      page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Rate limited' }),
    ).toHaveCount(1);
    // The next dialog does not repeat it.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  });

  test('results that cannot be saved', async ({ page }) => {
    await installDesktop(page, {
      workspace: workspaceOf(
        Array.from({ length: 500 }, (_, i) => snapshotOf(`s${i}`, `Saved search ${i}`, [])),
      ),
    });
    await finishBehindSettings(page, () =>
      page.evaluate(() =>
        (window as unknown as { __apt: Apt }).__apt.releaseSearch!({
          searchedAt: '2026-09-20T12:00:00.000Z',
          results: [{ source: 'europepmc', total: 0, works: [] }],
        }),
      ),
    );
    await expect(
      page
        .getByRole('dialog')
        .getByRole('alert')
        .filter({ hasText: 'These results have not been saved' }),
    ).toContainText('maximum of 500 saved searches');
  });
});

test('with reduced motion a focus ring is drawn at once, not through a transition (W6-12)', async ({
  page,
}) => {
  // ui-visual's focus-ring test measured a moment after focus moved and failed now and then.
  await installDesktop(page, { workspace: one });
  await page.goto('/');
  const ring = await page.getByLabel('Filter publications').evaluate((input) => {
    (input as HTMLElement).focus();
    // Read in the same task, before any frame is drawn.
    return getComputedStyle(input.closest('.filter-input')!).boxShadow;
  });
  expect(ring).toBe('rgb(29, 111, 100) 0px 0px 0px 2px');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

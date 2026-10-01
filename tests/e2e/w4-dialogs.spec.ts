import { test, expect, type Page } from '@playwright/test';
import {
  installDesktop,
  searchResponse,
  seedOnce,
  snapshotOf,
  work,
  workspaceOf,
  type Apt,
} from './ui-helpers';

const fullOf = (count: number) =>
  workspaceOf(
    Array.from({ length: count }, (_, i) => ({
      ...snapshotOf(`s${i}`, `Saved search ${i}`, []),
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    })),
  );
const two = workspaceOf([
  snapshotOf('s1', 'First search', [work('a', 'Paper A')]),
  snapshotOf('s2', 'Second search', [work('c', 'Paper C')]),
]);
const held = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'These results have not been saved' });
const dialog = (page: Page) => page.getByRole('dialog');
async function runSearch(page: Page, text: string) {
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('textbox', { name: 'Author name' }).fill(text);
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
}
const inert = (page: Page) =>
  page.evaluate(() => document.getElementById('root')!.hasAttribute('inert'));

test.describe('one dialog at a time (W4-04)', () => {
  async function heldResults(page: Page, errors: string[]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await seedOnce(page, fullOf(500));
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('n1', 'New paper one')]) }),
    );
    await page.goto('/');
    await runSearch(page, 'First query');
    await expect(held(page)).toBeVisible();
  }

  test('Ctrl+K does not open a second dialog over the discard question', async ({ page }) => {
    const errors: string[] = [];
    await heldResults(page, errors);
    await held(page).getByRole('button', { name: 'Discard results' }).click();
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Tab');
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText('Discard these results?');
    expect(errors).toEqual([]);
  });

  test('Ctrl+K does not open a second dialog over the snapshot chooser; Escape closes one', async ({
    page,
  }) => {
    const errors: string[] = [];
    await heldResults(page, errors);
    await held(page).getByRole('button', { name: 'Remove older snapshots…' }).click();
    await dialog(page).getByRole('checkbox').nth(0).check();
    await page.keyboard.press('Control+k');
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText('Remove older snapshots');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await inert(page)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('a search that fails while Settings is open keeps Settings and what was typed', async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/search', async (route) => {
      await gate;
      await route.fulfill({ status: 400, json: { error: 'Rate limited. Try again later.' } });
    });
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Existing', [work('a', 'Paper A')])]));
    await page.goto('/');
    await runSearch(page, 'Jane Scholar');
    await expect(page.locator('.search-progress')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const key = page.locator('input[type="password"]').first();
    await key.fill('my-secret-key');
    release();
    // The failure is reported on the page (behind the dialog) instead of replacing the dialog.
    await expect(page.locator('.error-banner').filter({ hasText: 'Rate limited' })).toBeAttached();
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toContainText('Workspace settings');
    await expect(key).toHaveValue('my-secret-key');
  });

  test('a saved-search menu closes when a dialog opens with the keyboard shortcut', async ({
    page,
  }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await page
      .locator('.saved-search')
      .filter({ hasText: 'Second search' })
      .click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test.describe('API key fields (W4-07)', () => {
  test('each key field is named after its provider, and its caption does not open a website', async ({
    page,
  }) => {
    await installDesktop(page, { workspace: two });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const name of ['OpenAlex API key', 'Semantic Scholar API key', 'NCBI / PubMed API key'])
      await expect(page.getByRole('textbox', { name, exact: true })).toHaveCount(1);
    // Clicking the caption goes to the field, as a label does.
    await page.getByText('OpenAlex API key', { exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'OpenAlex API key', exact: true }),
    ).toBeFocused();
    const opened = () =>
      page.evaluate(() => (window as unknown as { __apt: Apt }).__apt.opened.slice());
    expect(await opened()).toEqual([]);
    // The link to get a key is a button of its own.
    await page
      .getByRole('button', { name: /Get a key/ })
      .first()
      .click();
    await expect.poll(opened).toEqual(['https://openalex.org/settings/api']);
  });
});

test.describe('the New search shortcut follows the platform (W4-08)', () => {
  test.describe('on macOS', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });

    test('Cmd+K opens New search and Ctrl+K is left to text fields', async ({ page }) => {
      await seedOnce(page, two);
      await page.goto('/');
      await expect(page.locator('.new-search .shortcut')).toHaveText('⌘ K');
      await page.getByRole('button', { name: 'Paper A', exact: true }).click();
      await page.getByLabel('Research notes').focus();
      const prevented = await page.evaluate(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.activeElement!.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(prevented).toBe(false);
      await page.keyboard.press('Control+k');
      await expect(dialog(page)).toHaveCount(0);
      await page.keyboard.press('Meta+k');
      await expect(dialog(page)).toContainText('Start a new search');
    });
  });

  test('elsewhere Ctrl+K opens New search and the Windows key does not', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await expect(page.locator('.new-search .shortcut')).toHaveText('Ctrl K');
    await page.keyboard.press('Meta+k');
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(dialog(page)).toContainText('Start a new search');
  });
});

test.describe('focus after a dialog starts work (W4-12)', () => {
  const inPage = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      return Boolean(el && el !== document.body && document.getElementById('root')!.contains(el));
    });

  test('submitting New search leaves focus in the page, not on the document body', async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/search', async (route) => {
      await gate;
      await route.fulfill({ json: searchResponse([work('n', 'New paper')]) });
    });
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'Existing', [work('a', 'Paper A')])]));
    await page.goto('/');
    await page.locator('.new-search').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.keyboard.press('Enter');
    await expect(page.locator('.search-progress')).toBeVisible();
    await expect.poll(() => inPage(page)).toBe(true);
    release();
    await expect(page.getByRole('heading', { name: 'Jane Scholar', exact: true })).toBeVisible();
    expect(await inPage(page)).toBe(true);
  });

  test('"Continue anyway" on the capacity question leaves focus in the page', async ({ page }) => {
    await seedOnce(page, fullOf(460));
    await page.route('**/api/search', () => new Promise(() => {}));
    await page.goto('/');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Continue anyway', exact: true }).click();
    await expect(page.locator('.search-progress')).toBeVisible();
    await expect.poll(() => inPage(page)).toBe(true);
  });
});

test.describe('typed text is not dropped without asking (W4-14)', () => {
  test('the dialog reopened after a failed search asks before Escape discards it', async ({
    page,
  }) => {
    await page.route('**/api/search', (route) =>
      route.fulfill({ status: 400, json: { error: 'Rate limited. Try again later.' } }),
    );
    await page.goto('/');
    await page.locator('.new-search').click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('María José González-Rodríguez');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Rate limited');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toContainText('Discard what you entered?');
    await expect(page.getByRole('textbox', { name: 'Author name' })).toHaveValue(
      'María José González-Rodríguez',
    );
  });

  test('a new name typed in Rename is not dropped by Escape without asking', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    await page.getByRole('textbox', { name: 'Search name' }).fill('A carefully typed new name');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toContainText('Discard what you entered?');
    await dialog(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('textbox', { name: 'Search name' })).toHaveValue(
      'A carefully typed new name',
    );
  });

  test('an unchanged Rename dialog still closes at once', async ({ page }) => {
    await seedOnce(page, two);
    await page.goto('/');
    await page.getByLabel('Search actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Rename search' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });
});

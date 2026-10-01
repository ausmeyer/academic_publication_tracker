import { test, expect, type Page } from '@playwright/test';
import { installDesktop, settled, snapshotOf, work, workspaceOf, type Apt } from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });

/** `count` saved searches; the first holds two papers, one excluded with a tag. */
const workspaceWith = (count: number) =>
  workspaceOf([
    snapshotOf('s0', 'Proceedings of the National Academy of Sciences author search', [
      work('a', 'Paper A'),
      work('b', 'Paper B', 3, 2020, { included: false, tags: ['Influenza, Human'] }),
    ]),
    ...Array.from({ length: count - 1 }, (_, i) => ({
      ...snapshotOf(`s${i + 1}`, `Saved search ${i + 1}`, []),
      searchedAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    })),
  ]);

const dialogs: Record<string, { count: number; open: (page: Page) => Promise<void> }> = {
  'New search (author)': { count: 30, open: (page) => page.locator('.new-search').click() },
  'New search (topic)': {
    count: 30,
    open: async (page) => {
      await page.locator('.new-search').click();
      await page.getByRole('button', { name: 'Topic or title' }).click();
    },
  },
  'New search (DOI)': {
    count: 30,
    open: async (page) => {
      await page.locator('.new-search').click();
      await page.getByRole('button', { name: 'DOI', exact: true }).click();
    },
  },
  'New search with Scholar and Preprints': {
    count: 30,
    open: async (page) => {
      await page.locator('.new-search').click();
      await page.locator('.source-option', { hasText: 'Google Scholar' }).click();
      await page.locator('.source-option', { hasText: 'Preprints' }).click();
    },
  },
  Settings: {
    count: 30,
    open: (page) => page.getByRole('button', { name: 'Settings', exact: true }).click(),
  },
  Export: {
    count: 30,
    open: (page) => page.getByRole('button', { name: 'Export', exact: true }).click(),
  },
  Rename: {
    count: 30,
    open: async (page) => {
      await page.getByLabel('Search actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Rename search' }).click();
    },
  },
  Delete: {
    count: 30,
    open: async (page) => {
      await page.getByLabel('Search actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Delete this snapshot' }).click();
    },
  },
  'Almost full': {
    count: 460,
    open: (page) => page.getByRole('button', { name: 'Refresh', exact: true }).click(),
  },
  About: {
    count: 30,
    open: (page) => page.getByRole('button', { name: 'About & metric guide' }).click(),
  },
  'Remove older snapshots': {
    count: 500,
    open: (page) => page.getByRole('button', { name: 'Remove older snapshots…' }).click(),
  },
  'Discard results': {
    count: 500,
    open: (page) => page.getByRole('button', { name: 'Discard results' }).click(),
  },
};

/** Holds the results of a search, so the held-results dialogs can be opened. */
async function holdResults(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __apt: Apt }).__apt.onSearch = async () => ({
      searchedAt: '2026-09-20T12:00:00.000Z',
      results: [{ source: 'europepmc', total: 0, works: [] }],
    });
  });
  await page.locator('.new-search').click();
  await page.getByRole('textbox', { name: 'Author name' }).fill('Held query');
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.getByText('These results have not been saved')).toBeVisible();
}

/**
 * Tabs once around the open dialog from its top and lists every focused control that is not fully
 * in view: covered by the sticky footer, or clipped by the dialog or a list that scrolls inside it.
 * A checkbox or radio button is drawn by its label, so the label is what must be seen.
 */
async function hiddenStops(page: Page) {
  await page.getByRole('dialog').evaluate((dialog: HTMLElement) => {
    dialog.scrollTop = 0;
    dialog.focus();
  });
  const hidden: string[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const dialog = el.closest<HTMLElement>('[role="dialog"]')!;
      const footer = dialog.querySelector('.modal-footer')!;
      const index = [...dialog.querySelectorAll('*')].indexOf(el);
      if (footer.contains(el)) return { index, text: '', hiddenPx: 0 };
      const drawn =
        el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)
          ? (el.closest('label') ?? el)
          : el;
      const box = drawn.getBoundingClientRect();
      let top = box.top;
      let bottom = box.bottom;
      for (let node = drawn.parentElement; node; node = node.parentElement) {
        if (getComputedStyle(node).overflowY !== 'visible') {
          const frame = node.getBoundingClientRect();
          top = Math.max(top, frame.top + node.clientTop);
          bottom = Math.min(bottom, frame.top + node.clientTop + node.clientHeight);
        }
        if (node === dialog) break;
      }
      bottom = Math.min(bottom, footer.getBoundingClientRect().top);
      const text = (
        el.getAttribute('aria-label') ||
        el.closest('label')?.textContent ||
        el.textContent ||
        el.tagName
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      return { index, text, hiddenPx: Math.round(box.height - Math.max(0, bottom - top)) };
    });
    if (seen.has(stop.index)) break;
    seen.add(stop.index);
    if (stop.hiddenPx > 1) hidden.push(`${stop.text}: ${stop.hiddenPx}px hidden`);
  }
  return hidden;
}

// The smallest desktop window, a narrow tall one, and the smallest zoomed in to 125, 150 and 200%.
for (const size of [
  { width: 1060, height: 700 },
  { width: 820, height: 900 },
  { width: 848, height: 560 },
  { width: 707, height: 467 },
  { width: 530, height: 350 },
])
  test.describe(`at ${size.width}x${size.height} no focused control is hidden (W6-02)`, () => {
    for (const [name, { count, open }] of Object.entries(dialogs))
      test(name, async ({ page }) => {
        await page.setViewportSize(size);
        await installDesktop(page, { workspace: workspaceWith(count), memoryOnly: true });
        await page.goto('/');
        await expect(page.locator('.publication-table')).toBeVisible();
        if (count === 500) await holdResults(page);
        await open(page);
        await expect(page.getByRole('dialog')).toBeVisible();
        await settled(page);
        expect(await hiddenStops(page)).toEqual([]);
      });
  });

/** Whether all of the open dialog's message is painted where it can be seen. */
const messageInView = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('alert')
    .evaluate((message) => {
      const box = message.getBoundingClientRect();
      return [box.top + 2, (box.top + box.bottom) / 2, box.bottom - 2].every((y) => {
        const hit = document.elementFromPoint(box.left + 10, y);
        return y >= 0 && y <= innerHeight && Boolean(hit && message.contains(hit));
      });
    });

test.describe('a message about the form is shown where it can be seen (W6-03)', () => {
  async function yearError(page: Page, size: { width: number; height: number }, scholar = false) {
    await page.setViewportSize(size);
    await installDesktop(page, { workspace: workspaceWith(1), memoryOnly: true });
    await page.goto('/');
    await page.locator('.new-search').click();
    if (scholar) {
      await page.locator('.source-option', { hasText: 'Google Scholar' }).click();
      await page.locator('.source-option', { hasText: 'Preprints' }).click();
    }
    await page.getByRole('dialog').evaluate((el) => (el.scrollTop = 0));
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByLabel('From year').fill('2020');
    await page.getByLabel('To year').fill('2010');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      'The start year must be before the end year.',
    );
    await settled(page);
    expect(await messageInView(page)).toBe(true);
  }

  test('a year-range error in the smallest window, and no control is hidden once it shows', async ({
    page,
  }) => {
    await yearError(page, { width: 1060, height: 700 });
    expect(await hiddenStops(page)).toEqual([]);
  });

  test('a year-range error on a laptop screen with Google Scholar selected', async ({ page }) => {
    await yearError(page, { width: 1440, height: 900 }, true);
  });

  test('the reason a search failed, when the dialog opens again', async ({ page }) => {
    await page.setViewportSize({ width: 1060, height: 700 });
    await installDesktop(page, { workspace: workspaceWith(1), memoryOnly: true });
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __apt: Apt }).__apt.onSearch = async () => {
        throw new Error('The service is busy. Try again in a minute.');
      };
    });
    await page.locator('.new-search').click();
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('The service is busy');
    await settled(page);
    expect(await messageInView(page)).toBe(true);
  });

  test('a Settings save that fails', async ({ page }) => {
    await page.setViewportSize({ width: 1060, height: 700 });
    await installDesktop(page, { workspace: workspaceWith(1), memoryOnly: true });
    await page.goto('/');
    await page.evaluate(() => {
      window.desktop!.saveSettings = async () => {
        throw new Error('The system keychain is locked.');
      };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: /Contact email/ }).fill('me@example.org');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      'The system keychain is locked.',
    );
    await settled(page);
    expect(await messageInView(page)).toBe(true);
  });
});

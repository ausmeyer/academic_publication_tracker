import { expect, test, type Page } from '@playwright/test';
import { seedOnce, settled, snapshotOf, work, workspaceOf } from './ui-helpers';

// The smallest window the desktop app allows (electron/main.ts minWidth/minHeight).
const minimum = { width: 1060, height: 700 };

/** How far the lowest edge of a dialog button sits below the window's bottom edge (<= 0: visible). */
const overflow = (page: Page, name: RegExp) =>
  page.evaluate((source) => {
    const pattern = new RegExp(source);
    const button = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(
      (element) => pattern.test(element.textContent ?? ''),
    );
    return button ? Math.round(button.getBoundingClientRect().bottom - window.innerHeight) : NaN;
  }, name.source);

/**
 * How the footer sits against the open dialog's bottom edge (inside its border): `gap` is the space
 * below the footer (0: at the edge), `belowButtons` the space below its lowest button.
 */
const footerFit = (page: Page) =>
  page.getByRole('dialog').evaluate((dialog: HTMLElement) => {
    const footer = dialog.querySelector<HTMLElement>('.modal-footer')!;
    const style = getComputedStyle(dialog);
    const edge = dialog.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth);
    const buttons = Math.max(
      ...[...footer.querySelectorAll('button')].map((b) => b.getBoundingClientRect().bottom),
    );
    return {
      overflows: dialog.scrollHeight > dialog.clientHeight,
      padding: parseFloat(style.getPropertyValue('--modal-padding')),
      gap: Math.round(edge - footer.getBoundingClientRect().bottom),
      belowButtons: Math.round(edge - buttons),
    };
  });

test.describe('dialog buttons stay reachable at the smallest window size', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(minimum);
    await page.goto('/');
  });

  test('New search with every source selected keeps "Search publications" in view', async ({
    page,
  }) => {
    await page
      .getByRole('button', { name: /New search/ })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await settled(page); // measure after the enter animation, not during it
    expect(
      await overflow(page, /Search publications|Open Google Scholar|open Scholar/),
    ).toBeLessThanOrEqual(0);
  });

  test('Settings keeps "Save settings" in view', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('dialog').waitFor();
    await settled(page); // measure after the enter animation, not during it
    expect(await overflow(page, /Save settings/)).toBeLessThanOrEqual(0);
  });

  test('the footer follows the scroll and sits at the end of a short dialog as before', async ({
    page,
  }) => {
    await seedOnce(page, workspaceOf([snapshotOf('s1', 'A search', [work('a', 'Paper A')])]));
    await page.reload();
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await settled(page); // measure after the enter animation, not during it
    const footer = dialog.locator('.modal-footer');
    const box = await footer.boundingBox();
    const panel = await dialog.boundingBox();
    // Padding below the buttons stays inside the dialog: the footer does not poke out of it.
    expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    // At rest the layout is the one before the footer was sticky: the buttons, then the dialog's
    // own padding, and nothing below the footer.
    const fit = await footerFit(page);
    expect(fit.overflows).toBe(false);
    expect(Math.abs(fit.gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(fit.belowButtons - fit.padding)).toBeLessThanOrEqual(1);
  });

  test('while a tall dialog scrolls, the footer sits on its bottom edge with the padding below the buttons', async ({
    page,
  }) => {
    await page
      .getByRole('button', { name: /New search/ })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await settled(page); // measure after the enter animation, not during it
    for (const scrollTop of [0, 120]) {
      await page.getByRole('dialog').evaluate((el, top) => (el.scrollTop = top), scrollTop);
      const fit = await footerFit(page);
      expect(fit.overflows).toBe(true);
      // No strip of scrolling content shows below the footer.
      expect(Math.abs(fit.gap)).toBeLessThanOrEqual(1);
      expect(Math.abs(fit.belowButtons - fit.padding)).toBeLessThanOrEqual(1);
    }
  });
});

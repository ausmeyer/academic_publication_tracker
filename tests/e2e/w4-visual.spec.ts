import { test, expect, type Page } from '@playwright/test';
import {
  auditPage,
  seedOnce,
  settled,
  snapshotOf,
  work,
  workspaceOf,
  type Audit,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });

/** Contrast of an element's text as drawn: its colour faded by its own and its ancestors' opacity. */
const drawnContrast = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number);
      const lum = (rgb: number[]) =>
        rgb
          .slice(0, 3)
          .map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      // The first opaque background behind the text.
      let background = [255, 255, 255];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg.length === 3 || (bg.length === 4 && bg[3] === 1)) {
          background = bg.slice(0, 3);
          break;
        }
      }
      const fg = parse(getComputedStyle(el).color);
      const alpha = (fg.length === 4 ? fg[3] : 1) * opacity;
      const shown = fg.slice(0, 3).map((v, i) => v * alpha + background[i] * (1 - alpha));
      const [a, b] = [lum(shown), lum(background)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });

test('no horizontal scroll at the minimum window size with a long venue name (W4-05)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1060, height: 700 });
  const venue = 'Proceedings of the National Academy of Sciences of the United States of America';
  await seedOnce(
    page,
    workspaceOf([
      snapshotOf(
        's1',
        'PNAS author',
        Array.from({ length: 6 }, (_, i) => work(`w${i}`, `Paper ${i}`, 10, 2020, { venue })),
      ),
    ]),
  );
  await page.goto('/');
  await expect(page.locator('.venue-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1060);
  // The count next to the venue stays on screen.
  const count = await page.locator('.venue-row strong').first().boundingBox();
  expect(count!.x + count!.width).toBeLessThanOrEqual(1060);
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.locator('.venue-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1060);
});

test.describe('muted text still reads at 4.5:1 (W4-06)', () => {
  test('the title and authors of an excluded row', async ({ page }) => {
    await seedOnce(
      page,
      workspaceOf([
        snapshotOf('s1', 'Screened', [
          work('x', 'Excluded paper', 5, 2020, { included: false }),
          work('y', 'Included paper', 5, 2020),
        ]),
      ]),
    );
    await page.goto('/');
    expect(await drawnContrast(page, '.excluded-row .paper-title')).toBeGreaterThanOrEqual(4.5);
    expect(await drawnContrast(page, '.excluded-row .paper-authors')).toBeGreaterThanOrEqual(4.5);
    // Still visibly muted next to an included row.
    const color = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    expect(await color('.excluded-row .paper-title')).not.toBe(
      await color('tr:not(.excluded-row) .paper-title'),
    );
  });

  test('the Google Scholar note in New search', async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-search').click();
    await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
    await expect(page.locator('.scholar-search-note')).toBeVisible();
    await settled(page);
    expect(await drawnContrast(page, '.scholar-search-note p')).toBeGreaterThanOrEqual(4.5);
  });

  test('the page audit sees faded text and SVG text colours', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML =
        '<p id="faded" style="opacity:.45;color:#314c42;font-size:13px">Faded words</p>' +
        '<svg width="200" height="40"><text id="pale" x="5" y="20" style="fill:#c0c8c0;font-size:13px">Pale label</text></svg>';
      document.querySelector('main')!.prepend(box);
    });
    const audit: Audit = await page.evaluate(auditPage);
    const flagged = audit.contrast.map((r) => r.text);
    expect(flagged).toContain('Faded words');
    expect(flagged).toContain('Pale label');
  });
});

test('secondary cards show a dash when no included paper has a citation count (W4-17)', async ({
  page,
}) => {
  await seedOnce(
    page,
    workspaceOf([
      snapshotOf('s1', 'No counts', [work('a', 'Paper A', null), work('b', 'Paper B', null)]),
    ]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  const card = (label: string) =>
    page.locator('.secondary-metrics > div').filter({ hasText: label }).locator('strong');
  await expect(card('i10-index')).toHaveText('—');
  await expect(card('Average citations')).toHaveText('—');
  await expect(card('Citations per year')).toHaveText('—');
});

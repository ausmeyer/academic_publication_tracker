import { test, expect, type Page } from '@playwright/test';
import {
  auditPage,
  contrast,
  searchResponse,
  seedOnce,
  settled,
  snapshotOf,
  work,
  workspaceOf,
  type Audit,
} from './ui-helpers';

test.use({ locale: 'en-US', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });

const many = Array.from({ length: 60 }, (_, i) =>
  work(
    `w${i}`,
    `Evaluating epidemic forecasts across changing conditions number ${i}`,
    i % 7 === 0 ? null : 120 - i,
    2005 + (i % 18),
    {
      authors: ['Jane Scholar', 'Alex Researcher', 'Maria Gonzalez'],
      tags: ['methods', 'review'],
      notes: 'A private note',
      included: i % 9 !== 0,
      provenance: [
        {
          source: 'europepmc',
          sourceId: `w${i}`,
          citations: i % 7 === 0 ? null : 120 - i,
          retrievedAt: '2026-09-14T15:00:00.000Z',
          url: 'https://europepmc.org/',
        },
        {
          source: 'openalex',
          sourceId: `w${i}`,
          citations: 123 - i,
          retrievedAt: '2026-09-14T15:00:00.000Z',
          url: 'https://openalex.org/',
        },
      ],
    },
  ),
);
const workspace = workspaceOf([
  snapshotOf('s1', 'Jane Scholar', many, {
    query: { text: 'Jane Scholar', mode: 'author', sources: ['europepmc', 'openalex'], limit: 100 },
    previous: { searchedAt: '2026-09-01T10:00:00.000Z', papers: 50, citations: 3000 },
    sourceResults: [
      { source: 'europepmc', total: 60, warning: 'Some notice about coverage.' },
      { source: 'openalex', total: 60 },
    ],
  }),
  snapshotOf('s2', 'Epidemic forecasting', many.slice(0, 5)),
]);

async function invalidImport(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 9, snapshots: [], activeId: null })),
  });
  await expect(page.getByRole('alert')).toBeVisible();
}

const views: Array<[name: string, prepare: (page: Page) => Promise<void>]> = [
  ['overview', async () => {}],
  ['overview with a paper open', (page) => page.locator('.paper-title').first().click()],
  ['search library', (page) => page.getByRole('button', { name: /Search library/ }).click()],
  [
    'research insights',
    async (page) => {
      await page.getByRole('button', { name: 'Research insights', exact: true }).click();
      await page.getByLabel('Author to analyze', { exact: true }).fill('Jane Scholar');
      await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    },
  ],
  ['data sources', (page) => page.getByRole('button', { name: /Data sources/ }).click()],
  ['search dialog', (page) => page.locator('.new-search').click()],
  [
    'search dialog with Google Scholar selected',
    async (page) => {
      await page.locator('.new-search').click();
      await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
      await expect(page.locator('.scholar-search-note')).toBeVisible();
    },
  ],
  [
    'settings dialog',
    (page) => page.getByRole('button', { name: 'Settings', exact: true }).click(),
  ],
  ['export dialog', (page) => page.getByRole('button', { name: 'Export', exact: true }).click()],
  ['about dialog', (page) => page.getByRole('button', { name: /About & metric guide/ }).click()],
  [
    'rename dialog',
    async (page) => {
      await page.locator('.saved-search').nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename search' }).click();
    },
  ],
  [
    'discard prompt',
    async (page) => {
      await page.locator('.new-search').click();
      await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
      await page.keyboard.press('Escape');
    },
  ],
  ['error banner', invalidImport],
  [
    'search progress',
    async (page) => {
      await page.route('**/api/search', () => new Promise(() => {}));
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(page.locator('.search-progress')).toBeVisible();
    },
  ],
  [
    'notification',
    async (page) => {
      await page.locator('.saved-search').nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete search' }).click();
      await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
      await expect(page.locator('.toast')).toBeVisible();
    },
  ],
];

const label = (rows: Array<{ el: string; text: string }>) =>
  rows.map((r) => `${r.el} ${JSON.stringify(r.text)}`);

for (const viewport of [
  { width: 1440, height: 1050 },
  { width: 1060, height: 700 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height} (P5-05)`, () => {
    test.use({ viewport });
    for (const [name, prepare] of views) {
      test(`${name}: nothing below 11px, text contrast of 4.5:1, targets of 24px, no spill`, async ({
        page,
      }) => {
        await seedOnce(page, workspace);
        await page.goto('/');
        await expect(page.locator('.publication-table tbody tr').first()).toBeVisible();
        await prepare(page);
        await settled(page);
        const audit: Audit = await page.evaluate(auditPage);
        expect(label(audit.small).slice(0, 12), 'text below 11px').toEqual([]);
        expect(
          audit.contrast
            .map((r) => `${r.ratio} ${r.el} ${r.fg} on ${r.bg} ${JSON.stringify(r.text)}`)
            .slice(0, 12),
          'text below 4.5:1',
        ).toEqual([]);
        // The Insights panel and links inside a sentence are judged on their own terms.
        expect(
          audit.targets
            .filter((t) => !t.inside)
            .map((t) => `${t.w}x${t.h} ${t.el} ${JSON.stringify(t.text)}`)
            .slice(0, 12),
          'targets below 24px',
        ).toEqual([]);
        expect(audit.horizontalScroll).toBe(false);
        expect(
          audit.overflow
            .filter((o) => !/year-(chart|column)/.test(o.el))
            .map((o) => `${o.sw}>${o.cw} ${o.el} ${JSON.stringify(o.text)}`)
            .slice(0, 12),
          'boxes whose content spills out',
        ).toEqual([]);
      });
    }
  });
}

test.describe('the workspace-limit notices are readable too (P5-01, P5-05)', () => {
  const full = workspaceOf(
    Array.from({ length: 500 }, (_, i) => snapshotOf(`s${i}`, `Saved search ${i}`, [])),
  );
  test('the nearly-full note, the confirmation and the held-results banner', async ({ page }) => {
    await seedOnce(page, full);
    await page.route('**/api/search', (route) =>
      route.fulfill({ json: searchResponse([work('n1', 'New paper one')]) }),
    );
    await page.goto('/');
    await page.locator('.new-search').click();
    await expect(page.getByRole('note')).toBeVisible();
    await settled(page);
    let audit = await page.evaluate(auditPage);
    expect(audit.small.map((r) => r.el)).toEqual([]);
    expect(audit.contrast.map((r) => `${r.ratio} ${r.el}`)).toEqual([]);
    await page.getByRole('textbox', { name: 'Author name' }).fill('Jane Scholar');
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'have not been saved' })).toBeVisible();
    await settled(page);
    audit = await page.evaluate(auditPage);
    expect(audit.small.map((r) => r.el)).toEqual([]);
    expect(audit.contrast.map((r) => `${r.ratio} ${r.el}`)).toEqual([]);
    await page.getByRole('button', { name: 'Remove older snapshots…' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await settled(page);
    audit = await page.evaluate(auditPage);
    expect(audit.small.map((r) => r.el)).toEqual([]);
    expect(audit.contrast.map((r) => `${r.ratio} ${r.el}`)).toEqual([]);
  });
});

/** Rings drawn around an element, or around the field frame that holds it: outlines and solid shadows. */
const ring = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const candidates = [el, el.closest('.filter-input, .filter-select')].filter(
        Boolean,
      ) as Element[];
      const rings: Array<{ width: number; color: string; alpha: number }> = [];
      const parse = (css: string) => (css.match(/[\d.]+/g) ?? []).map(Number);
      for (const node of candidates) {
        const cs = getComputedStyle(node);
        const outline = parse(cs.outlineColor);
        if (cs.outlineStyle !== 'none')
          rings.push({
            width: parseFloat(cs.outlineWidth),
            color: cs.outlineColor,
            alpha: outline.length === 4 ? outline[3] : 1,
          });
        for (const shadow of cs.boxShadow.match(
          /rgba?\([^)]+\)\s+-?\d+px\s+-?\d+px\s+\d+px\s+\d+px/g,
        ) ?? []) {
          const color = shadow.match(/rgba?\([^)]+\)/)![0];
          const [, , blur, spread] = (shadow.replace(color, '').match(/-?\d+/g) ?? []).map(Number);
          const channels = parse(color);
          if (blur === 0)
            rings.push({ width: spread, color, alpha: channels.length === 4 ? channels[3] : 1 });
        }
      }
      return rings;
    });
const strongRing = (rings: Awaited<ReturnType<typeof ring>>) =>
  rings.some((r) => r.width >= 2 && r.alpha >= 0.9 && contrast(r.color, 'rgb(255, 255, 255)') >= 3);

test.describe('focus is visible (P5-05)', () => {
  test('the library filter and its status menu show a ring for keyboard users', async ({
    page,
  }) => {
    await seedOnce(page, workspace);
    await page.goto('/');
    await page.getByLabel('Filter publications').focus();
    expect(strongRing(await ring(page, '[aria-label="Filter publications"]'))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Publication filter')).toBeFocused();
    expect(strongRing(await ring(page, '[aria-label="Publication filter"]'))).toBe(true);
  });

  test('dialog fields show a strong ring, not a faint tint', async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-search').click();
    await page.getByRole('textbox', { name: 'Author name' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('From year')).toBeFocused();
    expect(strongRing(await ring(page, '.modal [type="number"]'))).toBe(true);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Results per source')).toBeFocused();
    expect(strongRing(await ring(page, '.modal select'))).toBe(true);
  });

  test('the notes and tags fields show a strong ring', async ({ page }) => {
    await seedOnce(page, workspace);
    await page.goto('/');
    await page.locator('.paper-title').first().click();
    await page.getByRole('textbox', { name: /Tags/ }).focus();
    await expect(page.getByRole('textbox', { name: /Tags/ })).toBeFocused();
    expect(strongRing(await ring(page, '.paper-detail input'))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Research notes')).toBeFocused();
    expect(strongRing(await ring(page, '.paper-detail textarea'))).toBe(true);
  });
});

test.describe('targets and forced colors (P5-05)', () => {
  test('a row checkbox has a hit area of at least 24 by 24 px that toggles it', async ({
    page,
  }) => {
    await seedOnce(page, workspace);
    await page.goto('/');
    const box = page.getByRole('checkbox', {
      name: /^Include Evaluating epidemic forecasts across changing conditions number 1$/,
    });
    const area = await box.evaluate((el) => {
      const r = (el.closest('label') ?? el).getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(area.w).toBeGreaterThanOrEqual(24);
    expect(area.h).toBeGreaterThanOrEqual(24);
    await box.locator('xpath=ancestor::label').click({ position: { x: 2, y: 2 } });
    await expect(box).not.toBeChecked();
  });

  test.describe('in Windows High Contrast (forced colors)', () => {
    test.use({ forcedColors: 'active' });

    test('chart bars are drawn', async ({ page }) => {
      await seedOnce(page, workspace);
      await page.goto('/');
      const bar = page.locator('.year-bar').first();
      await expect(bar).toBeVisible();
      // Backgrounds are replaced by the system in this mode, so a bar needs an outline of its own.
      const outlined = await bar.evaluate((el) => {
        const cs = getComputedStyle(el);
        return parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
      });
      expect(outlined).toBe(true);
    });

    test('selected states differ from unselected ones without relying on colour or shadow', async ({
      page,
    }) => {
      await seedOnce(page, workspace);
      await page.goto('/');
      await page.locator('.paper-title').first().click();
      const signature = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((el) => {
            const cs = getComputedStyle(el);
            return [
              cs.outlineStyle,
              cs.outlineWidth,
              cs.borderLeftStyle,
              cs.borderLeftWidth,
              cs.borderBottomStyle,
              cs.borderBottomWidth,
              cs.textDecorationLine,
              cs.fontWeight,
            ].join('|');
          });
      // [selected, unselected]
      const pairs: Array<[string, string]> = [
        [
          '.publication-table tr.selected-row td.check-cell',
          '.publication-table tr:not(.selected-row) td.check-cell',
        ],
        ['.nav-item.active', '.nav-item:not(.active)'],
        ['.saved-search.selected', '.saved-search:not(.selected)'],
      ];
      for (const [selected, plain] of pairs)
        expect(await signature(selected), `${selected} looks like ${plain}`).not.toBe(
          await signature(plain),
        );
      await page.locator('.new-search').click();
      const modes = await page.locator('.search-modes > button').evaluateAll((buttons) =>
        buttons.map((b) => {
          const cs = getComputedStyle(b);
          return [
            cs.outlineStyle,
            cs.outlineWidth,
            cs.borderLeftStyle,
            cs.borderLeftWidth,
            cs.borderBottomStyle,
          ].join('|');
        }),
      );
      expect(modes[0]).not.toBe(modes[1]);
    });
  });
});

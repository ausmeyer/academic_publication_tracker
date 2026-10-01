import { test, expect, type Page } from '@playwright/test';
import type { InsightsSettings, Work } from '../../src/types';
import type { HarnessInit } from './insights-harness';

const at = '2026-09-14T15:00:00.000Z';
const work = (id: string, title: string, extra: Partial<Work> = {}): Work => ({
  id,
  title,
  authors: ['Jane Scholar', 'Alex Researcher'],
  year: 2022,
  venue: 'Journal of Research Methods',
  doi: `10.1234/${id}`,
  abstract: 'A study of methods.',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 12,
  provenance: [{ source: 'openalex', sourceId: id, citations: 12, retrievedAt: at, url: '' }],
  included: true,
  tags: [],
  notes: '',
  ...extra,
});
const base: InsightsSettings = {
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
};
const works = [
  work('one', 'Evaluating epidemic forecasts', { notes: 'PRIVATE NOTE about this paper' }),
  work('two', 'Reliable research needs uncertainty', {
    authors: ['Alex Researcher', 'Jane Scholar'],
  }),
];

type Mode = 'ok' | 'reject' | 'silent' | 'throw';
/** Mounts the panel with a desktop bridge that records exports, imports and external links. */
async function open(
  page: Page,
  init: Partial<HarnessInit> = {},
  mode: Mode = 'ok',
  nextImport: { name: string; content: string } | null = null,
) {
  await page.addInitScript(
    ({ init, mode, nextImport }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__init = init;
      w.__calls = [];
      w.__mode = mode;
      w.__exports = [];
      w.__opened = [];
      w.desktop = {
        exportFile: async (file: unknown) => {
          (w.__exports as unknown[]).push(file);
          return true;
        },
        importFile: async () => nextImport,
        openExternal: async (url: string) => {
          (w.__opened as string[]).push(url);
        },
      };
    },
    { init: { works, settings: base, ...init }, mode, nextImport },
  );
  await page.goto('/tests/e2e/insights-harness.html');
  await expect(page.getByRole('heading', { name: 'Authorship roles' })).toBeVisible();
}
const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
const setMode = (page: Page, mode: Mode) =>
  page.evaluate((m) => void ((window as unknown as { __mode: string }).__mode = m), mode);
const exported = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __exports: Array<{ name: string; content: string }> }).__exports,
  );

test.describe('saving from the Insights panel', () => {
  test('a save the workspace refuses is reported as a failure, never as success', async ({
    page,
  }) => {
    await open(page, {}, 'reject');
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await page
      .getByLabel('I confirm this is the complete author list in publication order')
      .check();
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('was not saved');
    await expect(page.getByText('Saved author review.')).toHaveCount(0);
    expect(await calls(page)).toHaveLength(1);

    await setMode(page, 'ok');
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved author review.');
    await expect(page.locator('.insight-error')).toHaveCount(0);
  });

  test('applying the controls and importing data report a refusal as well', async ({ page }) => {
    await open(page, {}, 'reject', {
      name: 'annual.csv',
      content: 'key,year,citations,source\n10.1234/one,2025,4,scholar',
    });
    await page.getByLabel('Publication year from').fill('2021');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('was not saved');
    await expect(page.getByText('Analysis updated from saved publications')).toHaveCount(0);

    await page.getByText('Import local analysis data', { exact: true }).click();
    await page.getByLabel('Analysis data type').selectOption('annual');
    await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('was not saved');
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveCount(0);

    await page.getByText('Weights and interpretation', { exact: true }).click();
    // The box keeps showing the saved setting, so it is clicked rather than "checked".
    await page.getByLabel('Use GScholarLENS convention').click();
    await expect(page.locator('.insight-error')).toContainText('was not saved');
  });

  test('a save handler that throws is reported as a failure with its message', async ({ page }) => {
    await open(page, {}, 'throw');
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('The storage layer failed.');
    await expect(page.getByText('Saved author review.')).toHaveCount(0);
  });

  test('a save handler that answers anything but true is reported as a failure', async ({
    page,
  }) => {
    await open(page, {}, 'silent');
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await page
      .getByLabel('I confirm this is the complete author list in publication order')
      .check();
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('was not saved');
    await expect(page.getByText('Saved author review.')).toHaveCount(0);
  });

  test('an author review saves before any author is applied, without inventing a role', async ({
    page,
  }) => {
    await open(page, { settings: { ...base, author: '' } });
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await expect(page.getByLabel('Confirmed role override')).toBeDisabled();
    await page
      .getByLabel('I confirm this is the complete author list in publication order')
      .check();
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved author review.');
    const saved = (await calls(page)) as InsightsSettings[];
    expect(saved).toHaveLength(1);
    expect(saved[0].annotations).toEqual([
      { key: '10.1234/one', authors: ['Jane Scholar', 'Alex Researcher'], complete: true },
    ]);
  });

  test('an invalid author review is explained in the panel and never reaches the app', async ({
    page,
  }) => {
    await open(page);
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await page.getByLabel('Full author list').fill('x'.repeat(1001));
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(page.locator('.insight-error')).toContainText('Invalid or oversized text');
    await expect(page.getByText('Saved author review.')).toHaveCount(0);
    expect(await calls(page)).toHaveLength(0);
  });
});

test.describe('changing the analysed author', () => {
  const confirmed: InsightsSettings = {
    ...base,
    annotations: [
      {
        key: '10.1234/one',
        authors: ['Jane Scholar', 'Alex Researcher'],
        complete: true,
        role: 'corresponding',
      },
    ],
  };
  const lastCall = async (page: Page) => ((await calls(page)) as InsightsSettings[]).at(-1)!;

  test('respelling the same name keeps the confirmed roles without asking', async ({ page }) => {
    await open(page, { settings: confirmed });
    await page.getByLabel('Author to analyze', { exact: true }).fill('  jane   SCHOLAR ');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Analysis updated');
    await expect(page.locator('.insight-confirm')).toHaveCount(0);
    const saved = await lastCall(page);
    expect(saved.author).toBe('jane   SCHOLAR');
    expect(saved.annotations[0].role).toBe('corresponding');
  });

  test('a different author asks before clearing the confirmed roles', async ({ page }) => {
    await open(page, { settings: confirmed });
    await page.getByLabel('Author to analyze', { exact: true }).fill('Alex Researcher');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    const prompt = page.locator('.insight-confirm');
    await expect(prompt).toContainText('clears 1 confirmed role override');
    expect(await calls(page)).toHaveLength(0);
    await expect(
      prompt.getByRole('button', { name: 'Clear role overrides and apply' }),
    ).toBeFocused();

    await prompt.getByRole('button', { name: 'Keep the current author' }).click();
    await expect(prompt).toHaveCount(0);
    expect(await calls(page)).toHaveLength(0);

    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await page.getByRole('button', { name: 'Clear role overrides and apply' }).click();
    await expect(page.getByRole('status')).toContainText('Analysis updated');
    const saved = await lastCall(page);
    expect(saved.author).toBe('Alex Researcher');
    expect(saved.annotations).toEqual([
      { key: '10.1234/one', authors: ['Jane Scholar', 'Alex Researcher'], complete: true },
    ]);
  });

  test('nothing is asked when no role override exists', async ({ page }) => {
    await open(page);
    await page.getByLabel('Author to analyze', { exact: true }).fill('Alex Researcher');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.locator('.insight-confirm')).toHaveCount(0);
    expect((await lastCall(page)).author).toBe('Alex Researcher');
  });

  test('the question is withdrawn when other settings change underneath it', async ({ page }) => {
    await open(page, { settings: confirmed });
    await page.getByLabel('Author to analyze', { exact: true }).fill('Alex Researcher');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.locator('.insight-confirm')).toBeVisible();
    await page.getByText('Weights and interpretation', { exact: true }).click();
    await page.getByLabel('Use GScholarLENS convention').check();
    await expect(page.locator('.insight-confirm')).toHaveCount(0);
    // Applying again asks again, and confirming keeps the convention that was just saved.
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await page.getByRole('button', { name: 'Clear role overrides and apply' }).click();
    const saved = await lastCall(page);
    expect(saved).toMatchObject({ author: 'Alex Researcher', lensConvention: true });
  });

  test('editing the name withdraws the question', async ({ page }) => {
    await open(page, { settings: confirmed });
    await page.getByLabel('Author to analyze', { exact: true }).fill('Alex Researcher');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.locator('.insight-confirm')).toBeVisible();
    await page.getByLabel('Author to analyze', { exact: true }).fill('Alex Researcher Jr');
    await expect(page.locator('.insight-confirm')).toHaveCount(0);
  });
});

test.describe('keyboard focus and large lists', () => {
  test('applying the controls leaves focus where it was', async ({ page }) => {
    await open(page);
    const apply = page.getByRole('button', { name: 'Apply analysis', exact: true });
    await page.getByLabel('Publication year from').fill('2020');
    await apply.click();
    await expect(page.getByRole('status')).toContainText('Analysis updated');
    await expect(apply).toBeFocused();

    const author = page.getByLabel('Author to analyze', { exact: true });
    await author.fill('Jane A Scholar');
    await author.press('Enter');
    await expect(page.getByRole('status')).toContainText('Analysis updated');
    await expect(author).toBeFocused();
    await expect(author).toHaveValue('Jane A Scholar');
  });

  test('saving an author review leaves focus on the save button', async ({ page }) => {
    await open(page);
    await page.getByText('Review author lists and roles', { exact: true }).click();
    const save = page.getByRole('button', { name: 'Save author review', exact: true });
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Saved author review.');
    await expect(save).toBeFocused();
  });

  test('the publication picker offers a short list however large the snapshot is', async ({
    page,
  }) => {
    const many = Array.from({ length: 5000 }, (_, i) => work(`p${i}`, `Paper number ${i}`));
    await open(page, { works: many });
    await page.getByText('Review author lists and roles', { exact: true }).click();
    const options = page.getByLabel('Publication to review').locator('option');
    expect(await options.count()).toBeLessThanOrEqual(201);
    await expect(page.getByText('Showing 200 of 5,000 matching publications')).toBeVisible();
    // The paper already selected stays listed, even when the search no longer matches it.
    await page.getByLabel('Find a publication').fill('number 4999');
    await expect(options).toHaveCount(2);
    await expect(page.getByText(/matching publications/)).toHaveCount(0);
    await page.getByLabel('Find a publication').fill('number 499');
    await expect(options).toHaveCount(16);
  });
});

test.describe('exports and links', () => {
  test('the JSON export carries the snapshot details and leaves private notes out', async ({
    page,
  }) => {
    await open(page, {
      snapshot: {
        name: 'Jane Scholar',
        query: { text: 'Jane Scholar', mode: 'author', sources: ['openalex'], limit: 50 },
        searchedAt: at,
        sourceResults: [{ source: 'openalex', total: 2 }],
      },
    });
    await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect.poll(async () => (await exported(page)).length).toBe(1);
    const [file] = await exported(page);
    expect(file.name).toBe('research-insights.json');
    const json = JSON.parse(file.content);
    expect(json.header).toMatchObject({
      application: 'Academic Publication Tracker',
      author: 'Jane Scholar',
      snapshot: { name: 'Jane Scholar', searchedAt: at },
      retrieval: { earliest: at, latest: at, sources: ['openalex'] },
    });
    expect(json.header.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(file.content).not.toContain('PRIVATE NOTE');
    expect(json.analysis.rows).toHaveLength(2);
  });

  test('the CSV export starts with a byte-order mark', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await expect.poll(async () => (await exported(page)).length).toBe(1);
    expect((await exported(page))[0].content.charCodeAt(0)).toBe(0xfeff);
  });

  test('the method link opens through the app bridge and does not navigate', async ({ page }) => {
    await open(page);
    let popup = false;
    page.on('popup', () => (popup = true));
    await page.getByText('Weights and interpretation', { exact: true }).click();
    const url = page.url();
    await page.getByRole('link', { name: 'Sh-index method' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toEqual(['https://arxiv.org/abs/2509.04124']);
    expect(page.url()).toBe(url);
    expect(popup).toBe(false);
  });

  test('the method link opens a new tab in the browser preview', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __opens: string[] }).__opens = [];
      window.open = ((target?: string | URL) => {
        (window as unknown as { __opens: string[] }).__opens.push(String(target));
        return null;
      }) as typeof window.open;
    });
    // No desktop bridge: the preview client is used.
    await page.addInitScript(
      ({ init }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__init = init;
        w.__calls = [];
        w.__mode = 'ok';
      },
      { init: { works, settings: base } },
    );
    await page.goto('/tests/e2e/insights-harness.html');
    await page.getByText('Weights and interpretation', { exact: true }).click();
    await page.getByRole('link', { name: 'Sh-index method' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opens: string[] }).__opens))
      .toEqual(['https://arxiv.org/abs/2509.04124']);
  });
});

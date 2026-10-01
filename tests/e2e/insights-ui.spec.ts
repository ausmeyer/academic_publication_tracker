import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type { InsightsSettings, Snapshot, Work, Workspace } from '../../src/types';

const at = '2026-09-14T15:00:00.000Z';
function work(id: string, title: string, extra: Partial<Work> = {}): Work {
  return {
    id,
    title,
    authors: ['Jane Scholar', 'Alex Researcher'],
    year: 2022,
    venue: 'Journal of Research Methods',
    doi: `10.1234/${id}`,
    abstract: '',
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
  };
}
const snapshotOf = (
  works: Work[],
  extra: Partial<Snapshot> = {},
  mode: 'topic' | 'author' = 'topic',
): Snapshot => ({
  id: 'snapshot-1',
  name: 'Saved search',
  query: {
    text: mode === 'author' ? 'Jane Scholar' : 'methods',
    mode,
    sources: ['openalex'],
    limit: 25,
  },
  works,
  searchedAt: at,
  sourceResults: [{ source: 'openalex', total: works.length }],
  ...extra,
});
const workspaceOf = (snapshot: Snapshot): Workspace => ({
  version: 2,
  snapshots: [snapshot],
  activeId: snapshot.id,
});
async function seed(page: Page, data: Workspace | unknown) {
  await page.addInitScript(
    (data) => localStorage.setItem('apt-workspace-v1', JSON.stringify(data)),
    data,
  );
}
/** Opens the Research insights view of a saved workspace, with today's date fixed. */
async function openInsights(page: Page, data: Workspace | unknown, today = '2026-09-30T12:00:00Z') {
  await page.clock.setFixedTime(new Date(today));
  await seed(page, data);
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authorship roles', exact: true })).toBeVisible();
}
async function importFile(page: Page, name: string, content: string | Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
}
const blank: InsightsSettings = {
  author: '',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
};

test.describe('author names from different sources', () => {
  test('Europe PMC "Surname Initials" bylines are classified for a given-first author search', async ({
    page,
  }) => {
    const europePmc = ['Reich NG', 'Smith J', 'Lee K'];
    const data = workspaceOf(
      snapshotOf(
        [
          work('a', 'First paper', { authors: europePmc }),
          work('b', 'Second paper', { authors: ['Lee K', 'Reich NG'] }),
          work('c', 'Third paper', { authors: ['Nicholas G Reich', 'Lee K'] }),
        ],
        { query: { text: 'Nicholas G Reich', mode: 'author', sources: ['europepmc'], limit: 25 } },
      ),
    );
    await openInsights(page, data);
    await expect(page.getByLabel('Author to analyze', { exact: true })).toHaveValue(
      'Nicholas G Reich',
    );
    await expect(
      page.getByText('3 of 3 included publications classified.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText('2 papers matched compatible initials', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('No byline matched this name.')).toHaveCount(0);
  });

  test('the review list shows the initial-only matches for verification', async ({ page }) => {
    const data = workspaceOf(
      snapshotOf(
        [
          work('a', 'Exact paper', { authors: ['Jane Scholar', 'Alex Researcher'] }),
          work('b', 'Initial paper', { authors: ['J Scholar', 'Alex Researcher'] }),
          work('c', 'Somebody else paper', { authors: ['Sam Nobody', 'Alex Researcher'] }),
        ],
        { insights: { ...blank, author: 'Jane Scholar' } },
      ),
    );
    await openInsights(page, data);
    await page.getByText('Review author lists and roles', { exact: true }).click();
    const table = page.locator('.insight-table').last();
    await expect(
      table.getByRole('row', {
        name: /Initial paper.*First author.*Initial-compatible name; verify identity/,
      }),
    ).toBeVisible();
    await expect(
      table.getByRole('row', { name: /Somebody else paper.*Unclassified/ }),
    ).toBeVisible();
    await expect(table.getByRole('row', { name: /Exact paper/ })).toHaveCount(0);
    await expect(
      page.getByText('Showing up to 50 of 2 papers to review', { exact: false }),
    ).toBeVisible();
    await table.getByRole('button', { name: 'Initial paper' }).click();
    await expect(page.getByLabel('Publication to review')).toHaveValue('b');
  });

  test('says so when no byline matched the author at all', async ({ page }) => {
    const data = workspaceOf(
      snapshotOf([work('a', 'Only paper', { authors: ['Sam Nobody', 'Alex Researcher'] })], {
        insights: { ...blank, author: 'Jane Scholar' },
      }),
    );
    await openInsights(page, data);
    await expect(
      page.getByText(/No byline matched this name\. Names are matched as/),
    ).toBeVisible();
    await page.getByLabel('Confirmed name variants').fill('Nobody S');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.getByText('No byline matched this name.')).toHaveCount(0);
  });
});

test.describe('saving and loading', () => {
  test('an author review is saved before any author is applied', async ({ page }) => {
    await openInsights(page, workspaceOf(snapshotOf([work('one', 'Only paper')])));
    await page.getByText('Review author lists and roles', { exact: true }).click();
    await page
      .getByLabel('I confirm this is the complete author list in publication order')
      .check();
    await page.getByRole('button', { name: 'Save author review', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved author review.' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[0].insights.annotations,
        ),
      )
      .toEqual([
        { key: '10.1234/one', authors: ['Jane Scholar', 'Alex Researcher'], complete: true },
      ]);
  });

  test('a workspace whose Insights block lacks newer lists still opens', async ({ page }) => {
    const { retractions: _retractions, ...older } = { ...blank, author: 'Jane Scholar' };
    const data = workspaceOf(
      snapshotOf([work('one', 'Only paper')], { insights: older as InsightsSettings }),
    );
    await openInsights(page, data);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByLabel('Author to analyze', { exact: true })).toHaveValue('Jane Scholar');
  });

  test('leading venues count spellings that differ only by case as one venue', async ({ page }) => {
    const venues = [
      'PLoS Computational Biology',
      'PLoS computational biology',
      'PLOS COMPUTATIONAL BIOLOGY ',
    ];
    const data = workspaceOf(
      snapshotOf(venues.map((venue, i) => work(`v${i}`, `Paper ${i}`, { venue }))),
    );
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    await seed(page, data);
    await page.goto('/');
    await expect(page.locator('.venue-row')).toHaveCount(1);
    await expect(page.locator('.venue-row strong')).toHaveText('3');
  });
});

test.describe('the timelines', () => {
  test('a gap between publication years is drawn as a gap', async ({ page }) => {
    const years = [2002, 2008, 2009, 2010, 2011, 2015];
    await openInsights(
      page,
      workspaceOf(snapshotOf(years.map((year, i) => work(`y${i}`, `Paper ${i}`, { year })))),
    );
    await expect(page.locator('.year-column')).toHaveCount(14);
    await expect(page.locator('.year-bar[title="2003: 0 papers"]')).toBeAttached();
    const labels = await page
      .locator('.year-label')
      .evaluateAll((els) => els.map((el) => el.textContent?.trim()).filter(Boolean));
    expect(labels).toEqual(['2002', '2004', '2006', '2008', '2010', '2012', '2014']);
  });

  test('a long record does not crowd the year labels or overflow the chart', async ({ page }) => {
    const years = Array.from({ length: 46 }, (_, i) => 1980 + i);
    await openInsights(
      page,
      workspaceOf(snapshotOf(years.map((year, i) => work(`y${i}`, `Paper ${i}`, { year })))),
    );
    await expect(page.locator('.year-column')).toHaveCount(46);
    const boxes = await page.locator('.year-label').evaluateAll((els) =>
      els
        .filter((el) => el.textContent?.trim())
        .map((el) => {
          const box = el.getBoundingClientRect();
          return [box.left, box.right, el.textContent!.trim()] as [number, number, string];
        }),
    );
    expect(boxes.length).toBeLessThanOrEqual(10);
    expect(boxes.every(([, , year]) => Number(year) % 5 === 0)).toBe(true);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i][0]).toBeGreaterThan(boxes[i - 1][1]);
    // Every bar stays inside the chart, and the page does not scroll sideways.
    const inside = await page.locator('.year-chart').evaluate((chart) => {
      const frame = chart.getBoundingClientRect();
      return [...chart.querySelectorAll('.year-bar')].every((bar) => {
        const box = bar.getBoundingClientRect();
        return box.left >= frame.left - 1 && box.right <= frame.right + 1;
      });
    });
    expect(inside).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('annual citations mark the current year as year to date and keep unknown years unknown', async ({
    page,
  }) => {
    const works = [
      work('old', 'Old paper', { year: 2018 }),
      work('new', 'New paper', { year: 2022 }),
      work('undated', 'Undated paper', { year: null }),
    ];
    const data = workspaceOf(
      snapshotOf(works, {
        insights: {
          ...blank,
          author: 'Jane Scholar',
          annualCitations: [
            { key: '10.1234/old', year: 2022, citations: 5, source: 'scholar' },
            { key: '10.1234/old', year: 2024, citations: 7, source: 'scholar' },
            { key: '10.1234/new', year: 2024, citations: 2, source: 'scholar' },
            { key: '10.1234/old', year: 2026, citations: 3, source: 'scholar' },
            { key: '10.1234/undated', year: 2024, citations: 9, source: 'scholar' },
            { key: '10.1234/new', year: 2016, citations: 4, source: 'scholar' },
          ],
        },
      }),
    );
    await openInsights(page, data);
    await page.getByLabel('Timeline measure').selectOption('annual');
    await expect(page.locator('.year-column')).toHaveCount(5);
    const current = page.locator('.year-bar.insight-year-to-date');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('title', /^2026: 3 citations.*\(year to date\)$/);
    await expect(page.locator('.year-bar[title="2023: no annual counts"]')).toBeAttached();
    await expect(page.getByText(/2026\* is year to date and will keep rising/)).toBeVisible();
    await expect(page.locator('.year-label').filter({ hasText: '2026*' })).toHaveCount(1);
    // Only the papers published by 2022 could have been cited that year: 2 of 2, not 2 of 3.
    await expect(page.getByText('2022: 1/2 papers', { exact: false })).toBeVisible();
    await expect(page.getByText('2024: 2/2 papers', { exact: false })).toBeVisible();
    await expect(page.getByText(/1 undated paper is not counted here/)).toBeVisible();
    await expect(
      page.getByRole('img', { name: /Citations received per calendar year: 2022: 5/ }),
    ).toBeVisible();
    // The 2016 row predates its 2022 paper, so it is left out of the chart.
    await expect(page.locator('.year-bar[title^="2016:"]')).toHaveCount(0);
    await expect(
      page.getByText(/1 annual count is ignored because it falls before/),
    ).toBeAttached();
  });
});

test.describe('the headline numbers', () => {
  test('show "—" instead of zero while no citation count is known', async ({ page }) => {
    const data = workspaceOf(
      snapshotOf(
        [
          work('a', 'One', { citations: null, provenance: [] }),
          work('b', 'Two', { citations: null, provenance: [] }),
        ],
        { insights: { ...blank, author: 'Jane Scholar' } },
      ),
    );
    await openInsights(page, data);
    for (const label of ['Raw h-index', 'Zero-citation papers', 'Median citations'])
      await expect(page.locator('.insight-cards > div').filter({ hasText: label })).toContainText(
        '—',
      );
  });

  test('explain the two-author and six-author weighting conventions', async ({ page }) => {
    await openInsights(page, workspaceOf(snapshotOf([work('a', 'One')])));
    await page.getByText('Weights and interpretation', { exact: true }).click();
    await expect(page.getByText(/second author is classified as last author/)).toBeVisible();
    await expect(page.getByText(/leaves exactly six unspecified/)).toBeVisible();
  });

  test('say how many undated papers a year range removes', async ({ page }) => {
    const data = workspaceOf(
      snapshotOf([work('a', 'Dated', { year: 2021 }), work('b', 'Undated', { year: null })], {
        insights: { ...blank, author: 'Jane Scholar' },
      }),
    );
    await openInsights(page, data);
    await expect(page.getByText('excluded by the year range')).toHaveCount(0);
    await page.getByLabel('Publication year from').fill('2020');
    await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
    await expect(page.getByText('1 undated paper is excluded by the year range.')).toBeVisible();
  });
});

test.describe('importing analysis data', () => {
  const data = () =>
    workspaceOf(
      snapshotOf(
        [
          work('p', 'Nature paper', { year: 2020, venue: 'Nature' }),
          work('q', 'Methods paper', { year: 2022, venue: 'PLoS ONE' }),
        ],
        { insights: { ...blank, author: 'Jane Scholar' } },
      ),
    );

  test('rankings keep only the journals in the snapshot and say how many rows were skipped', async ({
    page,
  }) => {
    await openInsights(page, data());
    await page.getByText('Import local analysis data', { exact: true }).click();
    await page.getByLabel('Analysis data type').selectOption('rankings');
    await importFile(
      page,
      'ranks.csv',
      [
        'venue,year,category,quartile,source',
        'Nature,2020,Multidisciplinary,Q1,SJR',
        'PLOS One,2022,Multidisciplinary,Q2,SJR',
        'Science,2020,Multidisciplinary,Q1,SJR',
        'Cell,2020,Biochemistry,Q1,SJR',
      ].join('\n'),
    );
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
      'Imported 2 records; 2 for journals not in this snapshot skipped.',
    );
    await expect(
      page.getByText('Saved: 0 author reviews · 0 annual counts · 2 ranking records.'),
    ).toBeAttached();
  });

  test('annual counts reject a future year and report rows dated before publication', async ({
    page,
  }) => {
    await openInsights(page, data());
    await page.getByText('Import local analysis data', { exact: true }).click();
    await page.getByLabel('Analysis data type').selectOption('annual');
    await importFile(page, 'future.csv', 'key,year,citations,source\n10.1234/p,2999,5,scholar');
    await expect(page.locator('.insight-error')).toContainText('cannot be after 2026');
    await importFile(
      page,
      'early.csv',
      'key,year,citations,source\n10.1234/p,2016,9,scholar\n10.1234/p,2021,3,scholar',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
      "Imported 1 record; 1 dated before their paper's publication year ignored.",
    );
  });

  test('the authors template can be imported untouched without changing anything', async ({
    page,
  }) => {
    await openInsights(page, data());
    await page.getByText('Import local analysis data', { exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download data template', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('insights-authors-template.csv');
    const template = await readFile((await file.path())!, 'utf8');
    expect(template.charCodeAt(0)).toBe(0xfeff);
    expect(template).toContain('"true"');
    await importFile(page, 'authors.csv', template);
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
      'Imported 0 records; 2 unchanged (already in effect).',
    );
    await expect(page.getByText('Saved: 0 author reviews', { exact: false })).toBeAttached();
  });
});

test.describe('focus and large lists in the app', () => {
  test('applying the analysis leaves focus on the button', async ({ page }) => {
    await openInsights(page, workspaceOf(snapshotOf([work('a', 'One')])));
    const apply = page.getByRole('button', { name: 'Apply analysis', exact: true });
    await page.getByLabel('Author to analyze', { exact: true }).fill('Jane Scholar');
    await apply.click();
    await expect(page.getByText('Analysis updated from saved publications.')).toBeVisible();
    await expect(apply).toBeFocused();
  });

  test('the publication picker stays short for a 3,000-paper snapshot', async ({ page }) => {
    const many = Array.from({ length: 3000 }, (_, i) => work(`m${i}`, `Paper number ${i}`));
    await openInsights(page, workspaceOf(snapshotOf(many)));
    await page.getByText('Review author lists and roles', { exact: true }).click();
    expect(
      await page.getByLabel('Publication to review').locator('option').count(),
    ).toBeLessThanOrEqual(201);
    await expect(page.getByText('Showing 200 of 3,000 matching publications')).toBeVisible();
  });
});

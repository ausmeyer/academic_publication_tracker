import { test, expect, type Page } from '@playwright/test';
import type {
  Work,
  Workspace,
  SearchResponse,
  SearchQuery,
  Snapshot,
  ScholarProgress,
} from '../../src/types';
const at = '2026-09-14T15:00:00.000Z';
function work(id: string, title: string, citations: number | null, year = 2022): Work {
  return {
    id,
    title,
    authors: ['Jane Scholar', 'Alex Researcher'],
    year,
    venue: 'Journal of Research Methods',
    doi: `10.1234/${id}`,
    abstract: 'A study of methods for academic research and reproducible evidence synthesis.',
    type: 'journal-article',
    url: `https://doi.org/10.1234/${id}`,
    openAccessUrl: 'https://europepmc.org/',
    isOpenAccess: true,
    citations,
    provenance: [
      {
        source: 'europepmc',
        sourceId: id,
        citations,
        retrievedAt: at,
        url: 'https://europepmc.org/',
      },
    ],
    included: true,
    notes: '',
    tags: [],
  };
}
const works = [
  work('one', 'Evaluating epidemic forecasts across changing conditions', 42, 2021),
  work('two', 'Reliable research needs transparent uncertainty', 12, 2023),
  work('three', 'Prospective validation of predictive models', null, 2024),
];
const snapshot: Snapshot = {
  id: 'snapshot-1',
  name: 'Epidemic forecasting',
  query: { text: 'epidemic forecasting', mode: 'topic', sources: ['europepmc'], limit: 25 },
  works,
  searchedAt: at,
  sourceResults: [{ source: 'europepmc', total: 3 }],
};
const workspace: Workspace = { version: 2, snapshots: [snapshot], activeId: snapshot.id };
async function seed(page: Page, data: Workspace = workspace) {
  await page.addInitScript(
    (data) => localStorage.setItem('apt-workspace-v1', JSON.stringify(data)),
    data,
  );
}
async function importJson(page: Page, content: string, name = 'backup.json', nearlyFull = false) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  // A workspace above 90% of a limit asks before adding more.
  if (nearlyFull) await page.getByRole('button', { name: 'Continue anyway', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
}

test('welcomes without fabricated data and can search a public source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/search', (route) =>
    route.fulfill({
      json: {
        results: [{ source: 'europepmc', works, total: 3 }],
        searchedAt: at,
      } satisfies SearchResponse,
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your research/ })).toBeVisible();
  await page.getByRole('button', { name: /Try “epidemic forecasting”/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search terms' })).toHaveValue(
    'epidemic forecasting',
  );
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'epidemic forecasting', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.metric-value').first()).toHaveText('3');
  await expect(page.locator('.metric-value').nth(1)).toHaveText('54');
  await expect(page.locator('.metric-caption').nth(1)).toContainText('2 of 3');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.local-status')).toBeVisible();
  await page.reload();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('screening, filtering, sorting, notes and tags persist', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: works[0].title, exact: true }).click();
  await page.getByLabel('Research notes').fill('Keep for the methods chapter.');
  await page.getByRole('textbox', { name: /Tags/ }).fill('methods, review');
  await page.getByRole('heading', { name: 'Citation sources', exact: true }).click();
  await page.getByRole('checkbox', { name: `Include ${works[0].title}`, exact: true }).uncheck();
  await expect(page.locator('.metric-value').first()).toHaveText('2');
  await expect(page.locator('.metric-value').nth(1)).toHaveText('12');
  await page.getByLabel('Filter publications').fill('methods');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
  await page.getByLabel('Filter publications').fill('chapter');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Clear filter', { exact: true }).click();
  await page.getByLabel('Publication filter').selectOption('excluded');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
  await page.getByLabel('Publication filter').selectOption('all');
  await page.getByRole('button', { name: 'Year', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr').first()).toContainText(
    'Prospective validation',
  );
  // Remove the init script by using a new document navigation with session data checked directly.
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[0].works[0].notes,
      ),
    )
    .toBe('Keep for the methods chapter.');
});

test('refresh preserves earlier snapshot and curation', async ({ page }) => {
  const data = structuredClone(workspace);
  data.snapshots[0].works[0].notes = 'Previously screened';
  data.snapshots[0].insights = {
    author: 'Jane Scholar',
    aliases: [],
    lensConvention: false,
    annotations: [],
    annualCitations: [{ key: '10.1234/one', year: 2025, citations: 4, source: 'scholar' }],
    journalRanks: [],
    retractions: [],
  };
  data.snapshots[0].works[0].included = false;
  await seed(page, data);
  await page.route('**/api/search', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            source: 'europepmc',
            works: works.map((w) => ({
              ...w,
              citations: 70,
              provenance: w.provenance.map((p) => ({ ...p, citations: 70 })),
            })),
            total: 3,
          },
        ],
        searchedAt: '2026-09-15T12:00:00Z',
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Earlier snapshot retained in your library/)).toBeVisible();
  await expect(page.locator('.metric-value').first()).toHaveText('2');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!));
  expect(stored.snapshots).toHaveLength(2);
  expect(stored.snapshots[0].works[0].notes).toBe('Previously screened');
  expect(stored.snapshots[1].works[0].citations).toBe(42);
  expect(stored.snapshots[0].insights).toEqual(data.snapshots[0].insights);
  expect(stored.snapshots[1].insights).toEqual(data.snapshots[0].insights);
});

test('export included publications then import JSON and backup', async ({ page }) => {
  const data = structuredClone(workspace);
  data.snapshots[0].works[2].included = false;
  await seed(page, data);
  await page.goto('/');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByText('JSON records', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream!) content += chunk;
  expect(JSON.parse(content)).toHaveLength(2);
  await importJson(page, '\uFEFF' + content, 'imported-records.json');
  await expect(page.getByRole('heading', { name: 'imported-records', exact: true })).toBeVisible();
  await importJson(page, '\uFEFF' + JSON.stringify(workspace));
  await expect(page.getByRole('heading', { name: /Search library/ })).toBeVisible();
  await expect(page.locator('.library-card')).toHaveCount(3);
});

test('source errors remain visible alongside partial results', async ({ page }) => {
  await page.route('**/api/search', (route) =>
    route.fulfill({
      json: {
        results: [
          { source: 'europepmc', works, total: 3 },
          { source: 'openalex', works: [], total: null, error: 'Rate limited. Try again later.' },
        ],
        searchedAt: at,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search terms' }).fill('research methods');
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
  await expect(page.getByText(/OpenAlex:.*Rate limited/)).toBeVisible();
});

test('invalid import reports an error without losing the workspace', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await importJson(page, JSON.stringify({ version: 9, snapshots: [], activeId: null }));
  await expect(page.getByRole('alert')).toContainText('version is not supported');
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
});

test('oversized combined restore fails safely rather than crashing', async ({ page }) => {
  const data: Workspace = {
    version: 2,
    activeId: 's0',
    snapshots: Array.from({ length: 500 }, (_, i) => ({ ...snapshot, works: [], id: `s${i}` })),
  };
  await seed(page, data);
  await page.goto('/');
  await importJson(page, JSON.stringify(workspace), 'backup.json', true);
  await expect(page.getByRole('alert')).toContainText('maximum of 500 saved searches');
  await expect(page.getByRole('button', { name: /New search/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots.length,
    ),
  ).toBe(500);
});

test('backup import recovers corrupt local storage and saves restored data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('apt-workspace-v1', '{bad json'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await importJson(page, JSON.stringify(workspace));
  await expect(page.locator('.library-card')).toHaveCount(1);
  await expect
    .poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots.length),
    )
    .toBe(1);
});

test('insights switch between publication and citation timelines without open-access tracking', async ({
  page,
}) => {
  const data = structuredClone(workspace);
  data.snapshots[0].query = {
    text: 'Jane Scholar',
    mode: 'author',
    sources: ['europepmc'],
    limit: 25,
  };
  await seed(page, data);
  await page.goto('/');
  await expect(page.getByRole('columnheader', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(page.locator('option[value="oa"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Publication timeline', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Open access', { exact: true })).toHaveCount(0);
  await page.getByLabel('Timeline measure').selectOption('citations');
  await expect(page.getByRole('heading', { name: 'Citation timeline', exact: true })).toBeVisible();
  await expect(
    page.locator('.chart-title span').filter({ hasText: 'Lifetime citations by publication year' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authorship roles', exact: true })).toBeVisible();
  await expect(
    page.getByText(/This panel never opens or requests Google Scholar pages/),
  ).toBeVisible();
});

test('navigation, search shortcut and narrow layout remain usable', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.getByText('Average citations', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Data sources/ }).click();
  await expect(page.locator('.source-card')).toHaveCount(8);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 820, height: 950 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: works[0].title, exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Publication details' })).toBeVisible();
  await page.screenshot({ path: 'test-results/narrow-workspace.png', fullPage: true });
});

test('local insights analyze imported sets, import reference data, export and persist without network searches', async ({
  page,
}) => {
  await page.addInitScript((data) => {
    if (!sessionStorage.getItem('insights-seeded')) {
      localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
      sessionStorage.setItem('insights-seeded', 'true');
    }
  }, workspace);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/scholar\.google|\/api\/search/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await page.getByLabel('Author to analyze', { exact: true }).fill('Jane Scholar');
  await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
  await expect(
    page.getByText('3 of 3 included publications classified.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Citation distributions by role', exact: true }),
  ).toBeVisible();
  await page.getByText('Import local analysis data', { exact: true }).click();
  const imports = [
    ['authors', 'key,authors,complete,role\none,Jane Scholar; Alex Researcher,true,corresponding'],
    ['annual', 'key,year,citations,source\none,2025,9,scholar\ntwo,2025,0,scholar'],
    [
      'rankings',
      'venue,year,category,quartile,source\nJournal of Research Methods,2021,Medicine,Q1,Test ranks',
    ],
  ];
  for (const [kind, content] of imports) {
    await page.getByLabel('Analysis data type').selectOption(kind);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: `${kind}.csv`, mimeType: 'text/csv', buffer: Buffer.from(content) });
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  }
  await expect(
    page.getByRole('heading', { name: 'Retractions and other notices', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Retraction matches', { exact: true })).toHaveCount(0);
  await expect(page.locator('option[value="retractions"]')).toHaveCount(0);
  await page.getByLabel('Timeline measure').selectOption('annual');
  await expect(
    page.getByRole('img', { name: /Citations received per calendar year: 2025: 9/ }),
  ).toBeVisible();
  await page.getByLabel('Citation source', { exact: true }).selectOption('scholar');
  await expect(
    page.getByRole('img', { name: /Citations received per calendar year: 2025: 9/ }),
  ).toBeVisible();
  await page.getByLabel('Citation source', { exact: true }).selectOption('all');
  await page.getByLabel('Role chart measure').selectOption('citations');
  await expect(page.locator('[title="Corresponding author, Q1: 42 citations"]')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('research-insights.json');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[0].insights?.journalRanks
            .length,
      ),
    )
    .toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(page.getByLabel('Author to analyze', { exact: true })).toHaveValue('Jane Scholar');
  await expect(
    page.getByText('1 of 3 papers have a unique matching quartile.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Publication year from').fill('2023');
  await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
  await expect(page.locator('.metric-value').first()).toHaveText('2');
  await expect(
    page.getByText('0 of 2 papers have a unique matching quartile.', { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/local-insights-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 650, height: 1000 });
  await expect(page.getByLabel('Author to analyze', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/local-insights-narrow.png', fullPage: true });
});

test('incomplete Scholar author lists require local review and bad imports leave saved analysis intact', async ({
  page,
}) => {
  const data = structuredClone(workspace);
  data.snapshots[0].works[0].authorsComplete = false;
  data.snapshots[0].works[0].authors = ['Alex Researcher', 'Another Person', 'Jane Scholar'];
  await seed(page, data);
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await page.getByLabel('Author to analyze', { exact: true }).fill('Jane Scholar');
  await page.getByRole('button', { name: 'Apply analysis', exact: true }).click();
  await expect(
    page.getByText('2 of 3 included publications classified.', { exact: false }),
  ).toBeVisible();
  await page.getByText('Review author lists and roles', { exact: true }).click();
  await page.getByLabel('I confirm this is the complete author list in publication order').check();
  await page.getByLabel('Confirmed role override').selectOption('corresponding');
  await page.getByRole('button', { name: 'Save author review', exact: true }).click();
  await expect(
    page.getByText('3 of 3 included publications classified.', { exact: false }),
  ).toBeVisible();
  await page.getByText('Import local analysis data', { exact: true }).click();
  await page.getByLabel('Analysis data type').selectOption('annual');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('key,year,citations,source\none,2025,-1,scholar'),
  });
  await expect(page.getByRole('alert')).toContainText(
    'Row 2, citations: "-1" is not a whole number of citations.',
  );
  await expect(
    page.getByText('3 of 3 included publications classified.', { exact: false }),
  ).toBeVisible();
});

test('retains partial pages when the only selected source later fails', async ({ page }) => {
  await page.route('**/api/search', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            source: 'europepmc',
            works,
            total: 150,
            error: 'The next page was rate limited.',
            warning: 'Only partial results were retrieved.',
          },
        ],
        searchedAt: at,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Try “epidemic forecasting”/ }).click();
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.retrieval-details')).toContainText('next page was rate limited');
  await expect(page.locator('.retrieval-details')).toContainText(
    'Only partial results were retrieved',
  );
  await expect(page.locator('.metric-value').first()).toHaveText('3');
});

test('new searches default to an empty author search with a neutral placeholder', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  const author = page.getByRole('textbox', { name: 'Author name' });
  await expect(author).toHaveValue('');
  await expect(author).toHaveAttribute('placeholder', 'Enter an author name');
  await expect(page.getByRole('dialog')).not.toContainText(/Austin|Meyer/i);
  const sources = page.getByRole('dialog').getByRole('checkbox');
  await expect(sources).toHaveCount(8);
  for (const source of ['Google Scholar', 'Preprints', 'DataCite']) {
    await expect(page.getByRole('checkbox', { name: new RegExp(source) })).toHaveCount(1);
  }
  const positions = await page.locator('.source-option').evaluateAll((options) =>
    options.map((option) => {
      const { x, y } = option.getBoundingClientRect();
      return { x: Math.round(x), y: Math.round(y) };
    }),
  );
  expect(new Set(positions.map((position) => position.x)).size).toBe(2);
  expect(new Set(positions.map((position) => position.y)).size).toBe(4);
  await page.screenshot({ path: 'test-results/eight-source-author-search.png', fullPage: true });
  await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search terms' }).fill('temporary topic');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // The test browser reports Windows, where the shortcut is Ctrl+K (Cmd+K only on macOS).
  await page.keyboard.press('Control+k');
  await expect(author).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /Explore a research topic/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search terms' })).toHaveValue('');
});

test('combined preprints and DataCite preserve the query and actual record providers', async ({
  page,
}) => {
  const preprints = [
    { source: 'arxiv', venue: 'arXiv', id: 'preprint-arxiv' },
    { source: 'europepmc', venue: 'medRxiv', id: 'preprint-medrxiv' },
    { source: 'crossref', venue: 'bioRxiv', id: 'preprint-biorxiv' },
  ].map(({ source, venue, id }, index) => ({
    ...work(id, `${venue}: transparent evidence ${index + 1}`, null, 2025),
    venue,
    type: 'preprint',
    provenance: [
      {
        source,
        sourceId: id,
        citations: null,
        retrievedAt: at,
        url: `https://doi.org/10.1234/${id}`,
      },
    ],
  })) as Work[];
  const dataset: Work = {
    ...work('dataset', 'A dataset for prospective research', 3, 2025),
    type: 'dataset',
    venue: 'Zenodo',
    provenance: [
      {
        source: 'datacite',
        sourceId: '10.1234/dataset',
        citations: 3,
        retrievedAt: at,
        url: 'https://doi.org/10.1234/dataset',
      },
    ],
  };
  let submitted: SearchQuery | undefined;
  await page.route('**/api/search', (route) => {
    submitted = route.request().postDataJSON().query;
    return route.fulfill({
      json: {
        results: [
          {
            source: 'preprints',
            works: preprints,
            total: null,
            warning: 'Coverage varies by index.',
          },
          { source: 'datacite', works: [dataset], total: 1 },
        ],
        searchedAt: at,
      } satisfies SearchResponse,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search terms' }).fill('transparent evidence');
  for (const source of ['OpenAlex', 'Crossref', 'Europe PMC']) {
    await page.getByRole('checkbox', { name: new RegExp(source) }).uncheck();
  }
  await page.getByRole('checkbox', { name: /Preprints/ }).check();
  const explanation = page.locator('.preprint-search-note');
  await expect(explanation).toContainText('arXiv');
  await expect(explanation).toContainText('bioRxiv');
  await expect(explanation).toContainText('medRxiv');
  await expect(explanation).toContainText('other repositories');
  await expect(explanation).toContainText('index coverage');
  await page.getByRole('checkbox', { name: /DataCite/ }).check();
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(4);
  expect(submitted?.sources).toEqual(['preprints', 'datacite']);
  const saved = (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apt-workspace-v1')!),
  )) as Workspace;
  expect(saved.snapshots[0].query.sources).toEqual(['preprints', 'datacite']);
  expect(saved.snapshots[0].sourceResults.map((result) => result.source)).toEqual([
    'preprints',
    'datacite',
  ]);
  for (const expected of [...preprints, dataset]) {
    expect(
      saved.snapshots[0].works.find((record) => record.doi === expected.doi)?.provenance,
    ).toEqual(expected.provenance);
  }
  await page.reload();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: dataset.title, exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Publication details' })).toContainText(
    'DataCite',
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Earlier snapshot retained in your library/)).toBeVisible();
  expect(submitted?.sources).toEqual(['preprints', 'datacite']);
});

test('web preview allows Scholar and API sources together and explains collection limits', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
  await expect(page.getByRole('checkbox', { name: /Google Scholar/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /OpenAlex/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Crossref/ })).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Search sources and open Scholar', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/The installed desktop app collects Scholar results internally/),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /PubMed/ }).check();
  await expect(page.getByRole('checkbox', { name: /Google Scholar/ })).toBeChecked();
  for (const name of [/OpenAlex/, /Crossref/, /Europe PMC/, /PubMed/])
    await page.getByRole('checkbox', { name }).uncheck();
  await expect(
    page.getByRole('button', { name: 'Open Google Scholar', exact: true }),
  ).toBeVisible();
});

test('Scholar and PubMed produce one saved paper with complete authors and Scholar citations', async ({
  page,
}) => {
  const pubmed: Work = {
    ...works[0],
    id: 'pubmed:one',
    authors: ['Alex Researcher', 'Second Person', 'Jane Scholar', 'Last Person'],
    citations: null,
    provenance: [
      {
        source: 'pubmed',
        sourceId: 'one',
        citations: null,
        retrievedAt: at,
        url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      },
    ],
  };
  const scholar: Work = {
    ...works[0],
    id: 'scholar:one',
    authors: ['A Researcher', 'S Person'],
    authorsComplete: false,
    citations: 55,
    abstract: '',
    provenance: [
      {
        source: 'scholar',
        sourceId: 'one',
        citations: 55,
        retrievedAt: at,
        url: 'https://scholar.google.com/scholar?q=test',
      },
    ],
  };
  await page.addInitScript(
    ({ pubmed, scholar, at }) => {
      window.desktop = {
        async search(query) {
          if (query.sources.length !== 1 || query.sources[0] !== 'pubmed')
            throw new Error('Expected a PubMed-only API request');
          localStorage.setItem('api-finished', 'true');
          return { searchedAt: at, results: [{ source: 'pubmed', works: [pubmed], total: 1 }] };
        },
        async searchScholar(query) {
          if (
            !localStorage.getItem('api-finished') ||
            query.sources.length !== 1 ||
            query.sources[0] !== 'scholar'
          )
            throw new Error('Provider searches were not sequenced correctly');
          return { searchedAt: at, results: [{ source: 'scholar', works: [scholar], total: 1 }] };
        },
        onScholarProgress: () => () => {},
        async controlScholar() {},
        async loadWorkspace() {
          return JSON.parse(localStorage.getItem('apt-workspace-v1') || 'null');
        },
        async saveWorkspace(data) {
          localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
        },
        async loadSettings() {
          return { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
        },
        async saveSettings() {},
        async exportFile() {
          return false;
        },
        async importFile() {
          return null;
        },
        async openExternal() {},
        async copyText() {},
      };
    },
    { pubmed, scholar, at },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByLabel('Author name', { exact: true }).fill('Jane Scholar');
  for (const name of [/OpenAlex/, /Crossref/, /Europe PMC/])
    await page.getByRole('checkbox', { name }).uncheck();
  await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
  await page.getByRole('checkbox', { name: /PubMed/ }).check();
  await expect(page.getByRole('checkbox', { name: /Google Scholar/ })).toBeChecked();
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.metric-value').nth(1)).toHaveText('55');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await expect(
    page.getByText('1 of 1 included publications classified.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.authorship-chart')).toContainText('Middle author');
  await page.getByLabel('Citation source', { exact: true }).selectOption('scholar');
  await expect(page.locator('.metric-value').nth(1)).toHaveText('55');
  await page.getByLabel('Citation source', { exact: true }).selectOption('pubmed');
  await expect(page.locator('.metric-caption').nth(1)).toContainText('0 of 1');
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[0].works[0].authors,
      ),
    )
    .toEqual(pubmed.authors);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!));
  expect(saved.snapshots[0].query.sources).toEqual(['scholar', 'pubmed']);
  expect(saved.snapshots[0].works[0].authorsComplete).toBe(true);
  expect(saved.snapshots[0].works[0].provenance).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Earlier snapshot retained in your library/)).toBeVisible();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
});

test('Scholar collection saves citation metrics and captured-page provenance across restart', async ({
  page,
}) => {
  const scholarWork: Work = {
    ...works[0],
    abstract: '',
    snippet: 'A displayed search snippet.',
    citations: 17,
    isOpenAccess: false,
    openAccessUrl: '',
    provenance: [
      {
        source: 'scholar',
        sourceId: 'scholar-one',
        citations: 17,
        retrievedAt: at,
        url: 'https://scholar.google.com/scholar?hl=en&q=research&start=10',
      },
    ],
  };
  await page.addInitScript(
    (response: SearchResponse) => {
      window.desktop = {
        onScholarProgress: () => () => {},
        async controlScholar() {},
        async searchScholar() {
          return response;
        },
        async search() {
          throw new Error('Scholar must use its desktop search bridge.');
        },
        async loadWorkspace() {
          return JSON.parse(localStorage.getItem('apt-workspace-v1') || 'null');
        },
        async saveWorkspace(data) {
          localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
        },
        async loadSettings() {
          return { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
        },
        async saveSettings() {},
        async exportFile() {
          return false;
        },
        async importFile() {
          return null;
        },
        async openExternal() {},
        async copyText() {},
      };
    },
    {
      results: [
        {
          source: 'scholar',
          works: [scholarWork],
          total: null,
          warning: 'Retrieved pages only.',
        },
      ],
      searchedAt: at,
    } satisfies SearchResponse,
  );
  await page.goto('/');
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search terms' }).fill('research');
  for (const name of [/OpenAlex/, /Crossref/, /Europe PMC/])
    await page.getByRole('checkbox', { name }).uncheck();
  await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.locator('.publication-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.metric-value').nth(1)).toHaveText('17');
  await page.getByRole('button', { name: scholarWork.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Search snippet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View captured page' })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('apt-workspace-v1') || '{}').snapshots?.[0]
            .sourceResults[0].source,
      ),
    )
    .toBe('scholar');
  await page.reload();
  await expect(page.locator('.metric-value').nth(1)).toHaveText('17');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!));
  expect(saved.snapshots[0].works[0].provenance).toEqual(scholarWork.provenance);
  expect(saved.snapshots[0].query.sources).toEqual(['scholar']);
  expect(saved.snapshots[0].sourceResults[0].total).toBeNull();
  await page.evaluate(() => {
    window.desktop!.searchScholar = async () => null;
  });
  await page.getByRole('button', { name: /New search/ }).click();
  await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search terms' }).fill('canceled search');
  for (const name of [/OpenAlex/, /Crossref/, /Europe PMC/])
    await page.getByRole('checkbox', { name }).uncheck();
  await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
  await page.getByRole('button', { name: 'Search publications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'research', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots),
  ).toEqual(saved.snapshots);
});

for (const outcome of ['stop', 'cancel'] as const) {
  test(`internal Scholar progress and verification can ${outcome} without losing saved searches`, async ({
    page,
  }) => {
    await seed(page);
    await page.addInitScript(
      (response: SearchResponse) => {
        let listener: ((state: ScholarProgress) => void) | undefined;
        let finish: ((value: SearchResponse | null) => void) | undefined;
        const progress: ScholarProgress = {
          phase: 'searching',
          count: 1,
          limit: 100,
          pages: 1,
          message: 'Reading Google Scholar results.',
        };
        window.desktop = {
          onScholarProgress(callback) {
            listener = callback;
            return () => {
              listener = undefined;
            };
          },
          async controlScholar(action) {
            if (action === 'show') {
              listener?.({ ...progress, message: 'Complete verification in the Scholar window.' });
            } else if (action === 'stop' || action === 'cancel') {
              // Completion may beat the cancel IPC. The UI must still honor the user's cancellation.
              finish?.(response);
            }
          },
          searchScholar() {
            listener?.(progress);
            setTimeout(
              () =>
                listener?.({
                  ...progress,
                  phase: 'verification',
                  message: 'Google requested verification.',
                }),
              100,
            );
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
          async search() {
            throw new Error('Unexpected API request');
          },
          async loadWorkspace() {
            return JSON.parse(localStorage.getItem('apt-workspace-v1') || 'null');
          },
          async saveWorkspace(data) {
            localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
          },
          async loadSettings() {
            return { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
          },
          async saveSettings() {},
          async exportFile() {
            return false;
          },
          async importFile() {
            return null;
          },
          async openExternal() {},
          async copyText() {},
        };
      },
      {
        searchedAt: at,
        results: [
          {
            source: 'scholar',
            works: [
              { ...works[0], provenance: [{ ...works[0].provenance[0], source: 'scholar' }] },
            ],
            total: null,
            warning: 'Search stopped. Partial results retained.',
          },
        ],
      } satisfies SearchResponse,
    );
    await page.goto('/');
    await page.getByRole('button', { name: /New search/ }).click();
    await page.getByRole('button', { name: 'Topic or title', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search terms' }).fill('Internal search');
    for (const name of [/OpenAlex/, /Crossref/, /Europe PMC/])
      await page.getByRole('checkbox', { name }).uncheck();
    await page.getByRole('checkbox', { name: /Google Scholar/ }).check();
    await expect(page.getByText('Search directly in the app.')).toBeVisible();
    await page.getByRole('button', { name: 'Search publications', exact: true }).click();
    await expect(page.getByText('1 of 100 publications · 1 page read')).toBeVisible();
    await expect(page.getByText('Google Scholar needs your attention')).toBeVisible();
    await page.getByRole('button', { name: 'Open verification', exact: true }).click();
    await expect(page.getByText('Complete verification in the Scholar window.')).toBeVisible();
    await page
      .getByRole('button', {
        name: outcome === 'stop' ? 'Stop and keep results' : 'Cancel search',
        exact: true,
      })
      .click();
    await expect(page.locator('.search-progress')).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        name: outcome === 'stop' ? 'Internal search' : snapshot.name,
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots.length),
      )
      .toBe(outcome === 'stop' ? 2 : 1);
    const saved: Workspace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('apt-workspace-v1')!),
    );
    expect(saved.snapshots.find((s) => s.id === snapshot.id)).toEqual(snapshot);
    if (outcome === 'stop')
      expect(saved.snapshots[0].sourceResults[0].warning).toContain('Partial results retained');
  });
}

test('saved-search right-click deletes the targeted search only after confirmation and persists', async ({
  page,
}) => {
  const second: Snapshot = {
    ...snapshot,
    id: 'second-search',
    name: 'Second saved search',
    works: [works[1]],
  };
  await page.addInitScript(
    (data) => {
      if (!localStorage.getItem('apt-workspace-v1'))
        localStorage.setItem('apt-workspace-v1', JSON.stringify(data));
    },
    { ...workspace, snapshots: [snapshot, second] },
  );
  await page.goto('/');
  const secondButton = page.locator('.saved-search').filter({ hasText: second.name });
  await secondButton.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `Actions for ${second.name}` });
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  await menu.getByRole('menuitem', { name: 'Delete search', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(`“${second.name}”`);
  await page.getByRole('button', { name: 'Keep snapshot', exact: true }).click();
  await expect(secondButton).toBeVisible();
  await expect(page.getByRole('heading', { name: snapshot.name, exact: true })).toBeVisible();
  await secondButton.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete search', exact: true }).click();
  await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
  await expect(secondButton).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots.length),
    )
    .toBe(1);
  await page.reload();
  await expect(page.locator('.saved-search')).toHaveCount(1);
  const saved: Workspace = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apt-workspace-v1')!),
  );
  expect(saved).toEqual(workspace);
  await page.getByLabel('Search actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete this snapshot', exact: true }).click();
  await page.getByRole('button', { name: 'Delete snapshot', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Your research/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).activeId))
    .toBeNull();
});

test('library context menu supports keyboard rename, opening, escape, and outside dismissal', async ({
  page,
}) => {
  const second: Snapshot = { ...snapshot, id: 'second-search', name: 'Second saved search' };
  await seed(page, { ...workspace, snapshots: [snapshot, second] });
  await page.goto('/');
  await page.getByRole('button', { name: /Search library/ }).click();
  const card = page.locator('.library-card').filter({ hasText: second.name });
  await card.focus();
  await card.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Open search' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Rename search' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Search name' }).fill('Renamed search');
  await page.getByRole('button', { name: 'Save name' }).click();
  const renamed = page.locator('.library-card').filter({ hasText: 'Renamed search' });
  await expect(renamed).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[1].name),
    )
    .toBe('Renamed search');
  const saved: Workspace = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apt-workspace-v1')!),
  );
  expect(saved.activeId).toBe(snapshot.id);
  expect(saved.snapshots[0]).toEqual(snapshot);
  expect(saved.snapshots[1]).toEqual({ ...second, name: 'Renamed search' });
  await renamed.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(renamed).toBeFocused();
  await renamed.click({ button: 'right' });
  await page.getByRole('heading', { name: /Search library/ }).click();
  await expect(menu).toHaveCount(0);
  await renamed.click({ button: 'right' });
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await menu.getByRole('menuitem', { name: 'Open search' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed search', exact: true })).toBeVisible();
});

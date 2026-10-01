import { test, expect, type Page } from '@playwright/test';
import type { Work, Workspace } from '../../src/types';

const at = '2026-09-14T15:00:00.000Z';
const work = (id: string, year: number, citations: number): Work => ({
  id,
  title: `Paper ${id}`,
  authors: ['Jane Scholar', 'B One'],
  year,
  venue: 'Journal',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations,
  provenance: [{ source: 'openalex', sourceId: id, citations, retrievedAt: at, url: '' }],
  included: true,
  tags: [],
  notes: '',
});
const workspace = (works: Work[]): Workspace => ({
  version: 2,
  activeId: 's',
  snapshots: [
    {
      id: 's',
      name: 'Topic',
      query: { text: 'topic', mode: 'topic', sources: ['openalex'], limit: 25 },
      searchedAt: at,
      sourceResults: [{ source: 'openalex', total: works.length }],
      works,
    },
  ],
});
async function open(page: Page, works: Work[], width = 1060, height = 700) {
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    workspace(works),
  );
  await page.goto('/');
  await expect(page.locator('.year-chart')).toBeVisible();
}
/** The value labels a reader can see, measured on their text, and how the chart sits on the page. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('.year-chart .bar-value')].filter(
      (el) => getComputedStyle(el).visibility !== 'hidden' && el.textContent?.trim(),
    );
    const text = labels.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = range.getBoundingClientRect();
      const own = el.getBoundingClientRect();
      return {
        label: el.textContent,
        left: box.left,
        right: box.right,
        clipped: box.left < own.left - 0.5 || box.right > own.right + 0.5,
      };
    });
    const chart = document.querySelector('.year-chart')!.getBoundingClientRect();
    const [timeline, venues] = [...document.querySelectorAll('.chart-panel')].map((panel) =>
      panel.getBoundingClientRect(),
    );
    return {
      columns: document.querySelectorAll('.year-chart .year-column').length,
      text,
      chartInside: chart.left >= timeline.left && chart.right <= timeline.right,
      venuePanel: venues.width,
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
function expectReadable(facts: Awaited<ReturnType<typeof layout>>) {
  for (let i = 1; i < facts.text.length; i++)
    expect(
      facts.text[i].left,
      JSON.stringify(facts.text.slice(i - 1, i + 1)),
    ).toBeGreaterThanOrEqual(facts.text[i - 1].right);
  expect(facts.text.filter((t) => t.clipped)).toEqual([]);
  expect(facts.chartInside).toBe(true);
  expect(facts.pageWidth).toBeLessThanOrEqual(facts.viewport);
  expect(facts.venuePanel).toBeGreaterThan(250);
}

test.describe('bar values at the minimum window width', () => {
  test('a gap-filled 22-year citation chart keeps its values apart', async ({ page }) => {
    const years = [2005, 2007, 2008, 2011, 2013, 2014, 2016, 2018, 2019, 2021, 2023, 2026];
    await open(
      page,
      years.map((year, i) => work(`p${i}`, year, 350 + i * 250)),
    );
    await page.getByLabel('Timeline measure').selectOption('citations');
    const facts = await layout(page);
    expect(facts.columns).toBe(22);
    expectReadable(facts);
  });

  test('24 years of five-digit values do not widen the page', async ({ page }) => {
    await open(
      page,
      Array.from({ length: 24 }, (_, i) => work(`p${i}`, 2003 + i, 10000 + i * 1234)),
    );
    for (const view of ['Overview', 'Research insights']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await page.getByLabel('Timeline measure').selectOption('citations');
      const facts = await layout(page);
      expect(facts.columns).toBe(24);
      expectReadable(facts);
    }
  });

  test('values that fit are still shown', async ({ page }) => {
    await open(
      page,
      Array.from({ length: 12 }, (_, i) => work(`p${i}`, 2010 + i, 10 + i)),
      1440,
      1050,
    );
    await page.getByLabel('Timeline measure').selectOption('citations');
    const facts = await layout(page);
    expect(facts.text.map((t) => t.label)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${10 + i}`),
    );
    expectReadable(facts);
  });
});

test('one mistyped year does not stretch the timeline', async ({ page }) => {
  const years = [1004, 2999, ...Array.from({ length: 12 }, (_, i) => 2008 + i)];
  await open(
    page,
    years.map((year, i) => work(`y${i}`, year, 5)),
    1440,
    1050,
  );
  await expect(page.locator('.year-column')).toHaveCount(12);
  await expect(page.locator('.insight-chart-note')).toHaveText(
    '2 years with data (1004, 2999) fall outside the drawn range 2008–2019 and are not drawn.',
  );
});

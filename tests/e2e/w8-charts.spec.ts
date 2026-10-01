import { test, expect } from '@playwright/test';
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

test('a bar value adds nothing to the width the timeline asks for, so it cannot widen it', async ({
  page,
}) => {
  const data: Workspace = {
    version: 2,
    activeId: 's',
    snapshots: [
      {
        id: 's',
        name: 'Topic',
        query: { text: 'topic', mode: 'topic', sources: ['openalex'], limit: 25 },
        searchedAt: at,
        sourceResults: [{ source: 'openalex', total: 12 }],
        // Six-character values ("10,000") under four-character year labels.
        works: Array.from({ length: 12 }, (_, i) => work(`p${i}`, 2010 + i, 10000 + i * 1234)),
      },
    ],
  };
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    data,
  );
  await page.goto('/');
  await page.getByLabel('Timeline measure').selectOption('citations');
  await expect(page.locator('.year-chart .chart-value').first()).toHaveText('10,000');
  // The chart's narrowest layout (its min-content width), with the values and without them.
  const widths = await page.evaluate(() => {
    const chart = document.querySelector<HTMLElement>('.year-chart')!;
    chart.style.width = 'min-content';
    const withValues = chart.getBoundingClientRect().width;
    for (const value of chart.querySelectorAll<HTMLElement>('.chart-value'))
      value.style.display = 'none';
    return { withValues, without: chart.getBoundingClientRect().width };
  });
  expect(widths.withValues).toBe(widths.without);
});

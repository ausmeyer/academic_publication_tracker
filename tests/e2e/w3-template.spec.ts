import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { Work, Workspace } from '../../src/types';

const at = '2026-09-14T15:00:00.000Z';
const work = (id: string, title: string): Work => ({
  id,
  title,
  authors: ['Alex Researcher', 'Kim Lee', 'Jane Scholar'],
  year: 2022,
  venue: 'Journal of Research Methods',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 12,
  provenance: [{ source: 'scholar', sourceId: id, citations: 12, retrievedAt: at, url: '' }],
  included: true,
  tags: [],
  notes: '',
});
const annotations = [
  // Confirmed complete: a Scholar list is not trusted until someone confirms it.
  { key: '10.1234/p', authors: ['Alex Researcher', 'Kim Lee', 'Jane Scholar'], complete: true },
  // A missing co-author added and Jane confirmed as corresponding author.
  {
    key: '10.1234/q',
    authors: ['Alex Researcher', 'Kim Lee', 'Jane Scholar', 'Sam New'],
    complete: true,
    role: 'corresponding' as const,
  },
];
const data: Workspace = {
  version: 2,
  activeId: 's',
  snapshots: [
    {
      id: 's',
      name: 'Jane Scholar',
      query: { text: 'Jane Scholar', mode: 'author', sources: ['scholar'], limit: 25 },
      searchedAt: at,
      sourceResults: [{ source: 'scholar', total: 2 }],
      works: [work('p', 'Reviewed Scholar paper'), work('q', 'Paper with a corrected list')],
      insights: {
        author: 'Jane Scholar',
        aliases: [],
        lensConvention: false,
        annotations,
        annualCitations: [],
        journalRanks: [],
        retractions: [],
      },
    },
  ],
};

test('re-importing the downloaded authors template keeps the saved author reviews', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    data,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  const summary = page.locator('.authorship-summary');
  await expect(summary).toContainText('2 of 2 included publications classified.');
  await page.getByText('Import local analysis data', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download data template', exact: true }).click();
  const template = await readFile((await (await download).path())!, 'utf8');
  expect(template).toContain(
    '"Alex Researcher; Kim Lee; Jane Scholar; Sam New","true","corresponding"',
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'authors.csv', mimeType: 'text/csv', buffer: Buffer.from(template) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
    'Imported 0 records; 2 unchanged (already in effect).',
  );
  await expect(summary).toContainText('2 of 2 included publications classified.');
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('apt-workspace-v1')!).snapshots[0].insights.annotations,
  );
  expect(stored).toEqual(annotations);
});

test('an annual-counts template with one row filled in imports that row and counts the rest', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
  await page.addInitScript(
    (d) => localStorage.setItem('apt-workspace-v1', JSON.stringify(d)),
    data,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await page.getByText('Import local analysis data', { exact: true }).click();
  await page.getByLabel('Analysis data type').selectOption('annual');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download data template', exact: true }).click();
  const template = await readFile((await (await download).path())!, 'utf8');
  const filled = template.replace('"10.1234/p","",""', '"10.1234/p","2024","7"');
  expect(filled).not.toBe(template);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import analysis data', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'annual.csv', mimeType: 'text/csv', buffer: Buffer.from(filled) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
    'Imported 1 record; 1 blank row skipped.',
  );
  await expect(
    page.getByText('Saved: 2 author reviews · 1 annual count ·', { exact: false }),
  ).toBeAttached();
});

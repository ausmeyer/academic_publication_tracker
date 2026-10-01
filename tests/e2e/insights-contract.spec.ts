import { test, expect } from '@playwright/test';

/**
 * Integration check for the save-result contract between the app shell and the Insights panel:
 * the shell's insights handler must return whether the workspace accepted the change (the panel
 * itself is covered without a shell by insights-harness.spec.ts).
 */
test('a change the workspace cannot hold is reported once, as a failure, and never as saved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const cap = 25 * 1024 * 1024;
    const at = '2026-09-14T15:00:00.000Z';
    const work = (i: number, abstract: string) => ({
      id: `w${i}`,
      title: `Paper ${i}`,
      authors: ['Jane Scholar', 'Alex Researcher'],
      year: 2022,
      venue: 'Journal of Research Methods',
      doi: `10.1234/w${i}`,
      abstract,
      type: 'journal-article',
      url: '',
      openAccessUrl: '',
      isOpenAccess: false,
      citations: 3,
      provenance: [
        { source: 'openalex', sourceId: `w${i}`, citations: 3, retrievedAt: at, url: '' },
      ],
      included: true,
      tags: [],
      notes: '',
    });
    const build = (abstracts: string[]) => ({
      version: 2,
      activeId: 's',
      snapshots: [
        {
          id: 's',
          name: 'A nearly full workspace',
          query: { text: 'methods', mode: 'topic', sources: ['openalex'], limit: 25 },
          works: abstracts.map((abstract, i) => work(i, abstract)),
          searchedAt: at,
          sourceResults: [{ source: 'openalex', total: abstracts.length }],
        },
      ],
    });
    // Fill the workspace to 40 bytes below the 25 MB cap, so any saved review overflows it.
    const abstracts = [''];
    let size = JSON.stringify(build(abstracts)).length;
    while (cap - 40 - size > 199000) {
      abstracts.push('x'.repeat(200000));
      size = JSON.stringify(build(abstracts)).length;
    }
    const overhead = JSON.stringify(build([...abstracts, ''])).length - size;
    abstracts.push('x'.repeat(cap - 40 - size - overhead));
    const workspace = build(abstracts);
    (window as unknown as { desktop: unknown }).desktop = {
      search: async () => {
        throw new Error('No search in this test');
      },
      searchScholar: async () => null,
      onScholarProgress: () => () => {},
      controlScholar: async () => {},
      loadWorkspace: async () => workspace,
      saveWorkspace: async () => {},
      loadSettings: async () => ({
        email: '',
        openalexApiKey: '',
        semanticApiKey: '',
        ncbiApiKey: '',
      }),
      saveSettings: async () => {},
      exportFile: async () => false,
      importFile: async () => null,
      openExternal: async () => {},
      copyText: async () => {},
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Research insights', exact: true }).click();
  await page.getByText('Review author lists and roles', { exact: true }).click();
  await page.getByLabel('I confirm this is the complete author list in publication order').check();
  await page.getByRole('button', { name: 'Save author review', exact: true }).click();
  await expect(page.locator('.insight-error')).toContainText('was not saved');
  await expect(page.getByRole('alert').filter({ hasText: 'exceed 25 MB' })).toBeVisible();
  await expect(page.getByText('Saved author review.')).toHaveCount(0);
});

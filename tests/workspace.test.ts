import { describe, expect, it } from 'vitest';
import { validateWorkspace } from '../src/core/workspace';
import { exportWorks, importWorks } from '../src/core/formats';
import type { Work, Workspace } from '../src/types';

const work: Work = {
  id: 'one',
  title: 'A publication with research notes',
  authors: ['A Researcher'],
  year: 2024,
  venue: 'Research',
  doi: '',
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  notes: '',
  tags: [],
};
const workspace = (works: Work[]): Workspace => ({
  version: 1,
  activeId: 'search',
  snapshots: [
    {
      id: 'search',
      name: 'Research',
      query: { text: 'Research', mode: 'topic', sources: [], limit: 100 },
      works,
      searchedAt: '2026-09-14T00:00:00Z',
      sourceResults: [],
    },
  ],
});

describe('workspace boundaries', () => {
  it.each(['preprints', 'datacite', 'arxiv'] as const)(
    'preserves %s queries and original citation provenance',
    (source) => {
      const provider = source === 'preprints' ? 'europepmc' : source;
      const paper: Work = {
        ...work,
        citations: provider === 'arxiv' ? null : 7,
        provenance: [
          {
            source: provider,
            sourceId: 'record-1',
            citations: provider === 'arxiv' ? null : 7,
            retrievedAt: '2026-09-14T00:00:00Z',
            url: 'https://example.org/research',
          },
        ],
      };
      const data = workspace([paper]);
      data.snapshots[0].query.sources = [source];
      data.snapshots[0].sourceResults = [{ source, total: null }];
      expect(validateWorkspace(JSON.parse(JSON.stringify(data)))).toEqual(data);
      for (const format of ['csv', 'json'] as const)
        expect(
          importWorks(exportWorks([paper], format), `records.${format}`)[0].provenance,
        ).toEqual(paper.provenance);
    },
  );
  it('preserves Scholar counts and captured-page provenance in backups and record exports', () => {
    const paper: Work = {
      ...work,
      citations: 23,
      snippet: 'A displayed search snippet.',
      provenance: [
        {
          source: 'scholar',
          sourceId: 'abc',
          citations: 23,
          retrievedAt: '2026-09-14T00:00:00Z',
          url: 'https://scholar.google.com/scholar?hl=en&q=research&start=10',
        },
      ],
    };
    const data = workspace([paper]);
    data.snapshots[0].query.sources = ['scholar'];
    data.snapshots[0].sourceResults = [
      { source: 'scholar', total: null, warning: 'User-imported pages only.' },
    ];
    expect(validateWorkspace(JSON.parse(JSON.stringify(data)))).toEqual(data);
    for (const format of ['json', 'csv'] as const) {
      const imported = importWorks(exportWorks([paper], format), `records.${format}`);
      expect(imported[0].provenance).toEqual(paper.provenance);
      expect(imported[0].citations).toBe(23);
      expect(imported[0].snippet).toBe(paper.snippet);
      expect(imported[0].abstract).toBe('');
    }
    for (const format of ['bibtex', 'ris'] as const) {
      const imported = importWorks(exportWorks([paper], format), `records.${format}`);
      expect(imported[0].abstract).toBe('');
      expect(imported[0].notes).toContain(`Search snippet: ${paper.snippet}`);
    }
  });
  it('rejects a serialized workspace exceeding the save and backup limit', () => {
    const notes = 'é'.repeat(100000);
    const data = workspace(
      Array.from({ length: 135 }, (_, i) => ({ ...work, id: String(i), notes })),
    );
    expect(() => validateWorkspace(data)).toThrow('exceed 25 MB');
    expect(data.snapshots[0].works).toHaveLength(135);
  });
  it('accepts Unicode content under the byte limit and preserves metadata', () => {
    expect(
      validateWorkspace(workspace([{ ...work, notes: '研究のメモ', tags: ['méthodes'] }]))
        .snapshots[0].works[0].notes,
    ).toBe('研究のメモ');
  });
  it('strips non-web links and rejects duplicate identities', () => {
    expect(
      validateWorkspace(workspace([{ ...work, url: 'javascript:alert(1)' }])).snapshots[0].works[0]
        .url,
    ).toBe('');
    expect(() => validateWorkspace(workspace([work, work]))).toThrow('Duplicate publication IDs');
  });
});

it('reimports a publication export between 10 and 25 MB', () => {
  const works = Array.from({ length: 110 }, (_, i) => ({
    ...work,
    id: String(i),
    notes: 'a'.repeat(100000),
  }));
  const text = exportWorks(works, 'json');
  expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(10 * 1024 * 1024);
  expect(importWorks(text, 'publications.json')).toHaveLength(110);
});

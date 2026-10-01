import type { InsightsSettings, Snapshot, Work } from '../src/types';

/** A minimal included publication; override any field. */
export const work = (id: string, extra: Partial<Work> = {}): Work => ({
  id,
  title: `Research paper ${id}`,
  authors: ['Jane Scholar', 'Alex Other'],
  year: 2020,
  venue: 'Research',
  doi: `10.1234/${id}`,
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 10,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...extra,
});

export const snapshot: Snapshot = {
  id: 'snapshot',
  name: 'Imported',
  query: { text: 'papers.csv', mode: 'topic', sources: [], limit: 10 },
  searchedAt: '2026-09-16T00:00:00Z',
  sourceResults: [],
  works: [work('one')],
};

export const settings = (extra: Partial<InsightsSettings> = {}): InsightsSettings => ({
  author: 'Jane Scholar',
  aliases: [],
  lensConvention: false,
  annotations: [],
  annualCitations: [],
  journalRanks: [],
  retractions: [],
  ...extra,
});

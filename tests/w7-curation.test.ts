import { describe, expect, it } from 'vitest';
import type { Provenance, Work } from '../src/types';
import { carryForwardCuration } from '../src/core/curation';
import { mergeWorks } from '../src/core/merge';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w',
  title: 'Forecasting seasonal influenza with an ensemble of mechanistic models',
  authors: ['Nicholas G Reich'],
  year: 2020,
  venue: '',
  doi: '',
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...overrides,
});
const prov = (source: Provenance['source'], sourceId: string): Provenance[] => [
  { source, sourceId, citations: null, retrievedAt: '2026-09-01T00:00:00Z', url: '' },
];
const journal = (overrides: Partial<Work> = {}) =>
  work({
    id: 'crossref:10.1234/journal',
    doi: '10.1234/journal',
    provenance: prov('crossref', '10.1234/journal'),
    ...overrides,
  });
const preprint = (overrides: Partial<Work> = {}) =>
  work({
    id: 'crossref:10.1101/preprint',
    doi: '10.1101/preprint',
    type: 'posted-content',
    provenance: prov('crossref', '10.1101/preprint'),
    ...overrides,
  });
const scholar = (cluster = 'abc', overrides: Partial<Work> = {}) =>
  work({
    id: `scholar:${cluster}`,
    authors: ['NG Reich'],
    provenance: prov('scholar', cluster),
    ...overrides,
  });
const curation = ({ id, included, notes, tags }: Work) => ({ id, included, notes, tags });

describe('W7-01 a title-only match does not void an identifier match on refresh', () => {
  const previous = [
    journal({ included: false, notes: 'Namesake, not our Reich' }),
    preprint(),
    scholar('abc', { tags: ['cited'] }),
  ];

  it('keeps the exclusion, note and tag when a journal article, its preprint and a Scholar copy come back unchanged', () => {
    // The Scholar copy has no DOI and could be either version, so it stays a record of its own.
    const fresh = mergeWorks([journal(), preprint(), scholar()]);
    expect(fresh.map((record) => record.id)).toEqual([
      'crossref:10.1234/journal',
      'crossref:10.1101/preprint',
      'scholar:abc',
    ]);
    expect(carryForwardCuration(fresh, previous).map(curation)).toEqual([
      {
        id: 'crossref:10.1234/journal',
        included: false,
        notes: 'Namesake, not our Reich',
        tags: [],
      },
      { id: 'crossref:10.1101/preprint', included: true, notes: '', tags: [] },
      { id: 'scholar:abc', included: true, notes: '', tags: ['cited'] },
    ]);
  });

  it('drops an old record that another fresh record claims by identifier from a title-only claim', () => {
    // Google Scholar re-clustered the paper, so its fresh copy shares no identifier with the old one.
    const fresh = mergeWorks([journal(), preprint(), scholar('xyz')]);
    expect(fresh).toHaveLength(3);
    expect(carryForwardCuration(fresh, previous).map(curation)).toEqual([
      {
        id: 'crossref:10.1234/journal',
        included: false,
        notes: 'Namesake, not our Reich',
        tags: [],
      },
      { id: 'crossref:10.1101/preprint', included: true, notes: '', tags: [] },
      { id: 'scholar:xyz', included: true, notes: '', tags: ['cited'] },
    ]);
  });

  it('still carries nothing from an old record that two fresh records match only by title', () => {
    // The old Scholar copy could be either version of the paper.
    const fresh = mergeWorks([journal(), preprint()]);
    expect(fresh).toHaveLength(2);
    expect(carryForwardCuration(fresh, [scholar('abc', { tags: ['cited'] })])).toEqual(fresh);
  });
});

describe('W7-01 a record with an identifier match also takes an old copy only it matches by title', () => {
  it('adds the note and tag of an old Scholar duplicate to the fresh DOI record', () => {
    // v0.4.3 kept the Scholar copy apart; this time the results hold no Scholar copy.
    const old = [
      journal({ notes: 'Checked the affiliation' }),
      scholar('abc', { notes: 'Cited in the grant', tags: ['grant'] }),
    ];
    expect(carryForwardCuration([journal()], old).map(curation)).toEqual([
      {
        id: 'crossref:10.1234/journal',
        included: true,
        notes: 'Checked the affiliation\n\nCited in the grant',
        tags: ['grant'],
      },
    ]);
  });

  it('does not add an old copy that another fresh record also matches by title', () => {
    const fresh = mergeWorks([journal(), preprint()]);
    const old = [
      journal({ notes: 'Journal' }),
      preprint({ notes: 'Preprint' }),
      scholar('abc', { tags: ['cited'] }),
    ];
    expect(carryForwardCuration(fresh, old).map(curation)).toEqual([
      { id: 'crossref:10.1234/journal', included: true, notes: 'Journal', tags: [] },
      { id: 'crossref:10.1101/preprint', included: true, notes: 'Preprint', tags: [] },
    ]);
  });

  it('adds only the old copies that merge with the identified ones', () => {
    // The fresh record lists a second author that the old journal copy does not.
    const fresh = journal({ authors: ['Nicholas G Reich', 'Evan L Ray'] });
    const old = [
      journal({ notes: 'Journal' }),
      scholar('abc', { notes: 'Same authors' }),
      scholar('def', { authors: ['EL Ray'], notes: 'Only the new author' }),
    ];
    expect(mergeWorks([old[2], fresh])).toHaveLength(1);
    expect(mergeWorks([old[0], old[2]])).toHaveLength(2);
    expect(carryForwardCuration([fresh], old)[0].notes).toBe('Journal\n\nSame authors');
  });
});

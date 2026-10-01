import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { carryForwardCuration } from '../src/core/curation';
import { mergeWorks } from '../src/core/merge';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'new',
  title: 'A longitudinal study of scientific collaboration',
  authors: ['Austin Meyer'],
  year: 2020,
  venue: 'Journal',
  doi: '',
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 5,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...overrides,
});
const reviewed = (overrides: Partial<Work> = {}) =>
  work({ id: 'old', included: false, notes: 'Read carefully', tags: ['methods'], ...overrides });
const provenance = (source: Work['provenance'][number]['source'], sourceId: string) => [
  { source, sourceId, citations: null, retrievedAt: '2026-09-14T00:00:00Z', url: '' },
];

describe('P2-08 refresh curation is carried one-to-one', () => {
  it('does not copy one DOI-less record into two fresh records that stay separate', () => {
    const old = reviewed({ notes: 'Screened: exclude' });
    const f1 = work({ id: 'f1', doi: '10.1234/a' });
    const f2 = work({ id: 'f2', doi: '10.1234/b' });
    expect(mergeWorks([old, f1, f2])).toHaveLength(3);
    const result = carryForwardCuration([f1, f2], [old]);
    expect(result).toEqual([f1, f2]);
  });

  it('gives the curation to the fresh record that shares the old DOI, not to a title-only lookalike', () => {
    const old = reviewed({ doi: '10.1234/a', notes: 'Screened: exclude' });
    const sameDoi = work({ id: 'f1', doi: '10.1234/a' });
    const lookalike = work({ id: 'f2', doi: '' });
    const [first, second] = carryForwardCuration([lookalike, sameDoi], [old]);
    expect(first).toEqual(lookalike);
    expect(second).toMatchObject({ id: 'f1', included: false, notes: 'Screened: exclude' });
  });

  it('carries nothing when two fresh records both claim the same old record by identity', () => {
    const old = reviewed({ doi: '10.1234/a' });
    const a = work({ id: 'f1', doi: '10.1234/a' });
    const b = work({ id: 'f2', doi: '10.1234/a' });
    expect(carryForwardCuration([a, b], [old])).toEqual([a, b]);
  });

  it('still carries each old record to its own fresh record', () => {
    const olds = [
      reviewed({ id: 'o1', doi: '10.1234/a', notes: 'one' }),
      reviewed({ id: 'o2', doi: '10.1234/b', notes: 'two' }),
    ];
    const fresh = [work({ id: 'f1', doi: '10.1234/a' }), work({ id: 'f2', doi: '10.1234/b' })];
    expect(carryForwardCuration(fresh, olds).map((w) => w.notes)).toEqual(['one', 'two']);
  });

  it('does not consume an old record for a fresh record it only resembles', () => {
    const old = reviewed({ doi: '10.1234/a' });
    const lookalikes = [work({ id: 'f1' }), work({ id: 'f2', authors: ['Meyer, A.'] })];
    expect(carryForwardCuration(lookalikes, [old])).toEqual(lookalikes);
  });
});

describe('P2-07 curation follows the same identity rules as merging', () => {
  it('treats Europe PMC "MED:<pmid>" and PubMed "<pmid>" as the same provider record', () => {
    const old = reviewed({
      title: 'Earlier title',
      year: 2019,
      provenance: provenance('pubmed', '123'),
    });
    const fresh = work({ title: 'Revised title', provenance: provenance('europepmc', 'MED:123') });
    expect(carryForwardCuration([fresh], [old])[0]).toMatchObject({
      notes: 'Read carefully',
      included: false,
    });
    const other = work({ provenance: provenance('europepmc', 'PPR:123') });
    expect(carryForwardCuration([other], [old])[0]).toEqual(other);
  });

  it('carries curation from an arXiv record saved with a version suffix to its unversioned successor', () => {
    const old = reviewed({
      title: 'Short note',
      year: 2023,
      provenance: provenance('arxiv', '2304.02643v1'),
    });
    const fresh = work({
      title: 'Short note',
      year: 2023,
      provenance: provenance('arxiv', '2304.02643'),
    });
    expect(carryForwardCuration([fresh], [old])[0]).toMatchObject({
      notes: 'Read carefully',
      included: false,
      tags: ['methods'],
    });
    const newer = work({
      title: 'Short note',
      year: 2023,
      provenance: provenance('arxiv', '2304.02643v2'),
    });
    expect(carryForwardCuration([newer], [old])[0].notes).toBe('Read carefully');
    const different = work({
      title: 'Short note',
      year: 2023,
      provenance: provenance('arxiv', '2304.02644'),
    });
    expect(carryForwardCuration([different], [old])[0]).toEqual(different);
  });

  it('matches titles that differ only by diacritics', () => {
    const old = reviewed({ title: 'Étude longitudinale de la collaboration scientifique' });
    const fresh = work({
      title: 'Etude longitudinale de la collaboration scientifique',
      doi: '10.1234/gained',
    });
    expect(carryForwardCuration([fresh], [old])[0]).toMatchObject({ notes: 'Read carefully' });
  });

  it('matches authors written in a different name format', () => {
    const old = reviewed({ authors: ['Meyer AG', 'Smith J'] });
    const fresh = work({ authors: ['Austin G Meyer', 'John Smith'], doi: '10.1234/gained' });
    expect(carryForwardCuration([fresh], [old])[0]).toMatchObject({ notes: 'Read carefully' });
  });
});

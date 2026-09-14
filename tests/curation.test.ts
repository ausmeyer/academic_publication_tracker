import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { carryForwardCuration } from '../src/core/curation';

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

describe('refresh curation', () => {
  it('carries curation across normalized DOI identity while retaining all fresh metadata', () => {
    const old = reviewed({ doi: 'https://doi.org/10.1234/ABC', citations: 2 });
    const fresh = work({ doi: '10.1234/abc', title: 'Corrected title', year: 2021, citations: 20 });
    const result = carryForwardCuration([fresh], [old])[0];
    expect(result).toEqual({ ...fresh, included: false, notes: old.notes, tags: old.tags });
    expect(result.tags).not.toBe(old.tags);
    expect(fresh.included).toBe(true);
    expect(old.citations).toBe(2);
  });

  it('carries curation when a DOI is newly supplied for a conservative title match', () => {
    const old = reviewed();
    const fresh = work({ doi: '10.1234/gained', authors: ['Meyer, A.'] });
    expect(carryForwardCuration([fresh], [old])[0]).toMatchObject({
      doi: '10.1234/gained',
      notes: old.notes,
      included: false,
    });
  });

  it('matches the same provider record even when its title or year changes', () => {
    const provenance: Work['provenance'] = [
      { source: 'pubmed', sourceId: '123', citations: null, retrievedAt: '2026-09-14', url: '' },
    ];
    const fresh = work({ title: 'Updated title', year: 2021, provenance });
    expect(carryForwardCuration([fresh], [reviewed({ provenance })])[0].notes).toBe(
      'Read carefully',
    );
  });

  it('does not treat empty provider IDs or IDs from different sources as identities', () => {
    const old = reviewed({
      title: 'Editorial',
      provenance: [
        { source: 'pubmed', sourceId: '123', citations: null, retrievedAt: '', url: '' },
      ],
    });
    const fresh = work({
      title: 'Editorial',
      provenance: [
        { source: 'europepmc', sourceId: '123', citations: null, retrievedAt: '', url: '' },
      ],
    });
    expect(carryForwardCuration([fresh], [old])[0]).toEqual(fresh);
    const blank = [
      { source: 'pubmed' as const, sourceId: '', citations: null, retrievedAt: '', url: '' },
    ];
    expect(
      carryForwardCuration([{ ...fresh, provenance: blank }], [{ ...old, provenance: blank }])[0]
        .notes,
    ).toBe('');
  });

  it('keeps unrelated short-title and author-mismatched records separate', () => {
    const editorial = work({ title: 'Editorial' });
    expect(
      carryForwardCuration(
        [editorial],
        [reviewed({ title: 'Editorial', authors: ['Alice Smith'] })],
      )[0],
    ).toEqual(editorial);
    const fresh = work({ authors: ['Alice Smith'] });
    expect(carryForwardCuration([fresh], [reviewed()])[0]).toEqual(fresh);
    const undated = work({ year: null });
    expect(carryForwardCuration([undated], [reviewed({ year: null })])[0]).toEqual(undated);
  });

  it('never carries curation between conflicting DOIs, even with shared provider IDs', () => {
    const provenance: Work['provenance'] = [
      { source: 'pubmed', sourceId: '123', citations: null, retrievedAt: '', url: '' },
    ];
    const fresh = work({ doi: '10.1234/b', provenance });
    expect(carryForwardCuration([fresh], [reviewed({ doi: '10.1234/a', provenance })])[0]).toEqual(
      fresh,
    );
  });

  it('leaves duplicate old identity and title candidates ambiguous rather than picking the last', () => {
    const fresh = work({ doi: '10.1234/a' });
    const old = reviewed({ doi: '10.1234/a' });
    expect(
      carryForwardCuration([fresh], [old, { ...old, id: 'other', notes: 'Different decision' }])[0],
    ).toEqual(fresh);
    const withoutDoi = work();
    expect(
      carryForwardCuration(
        [withoutDoi],
        [reviewed({ doi: '10.1234/a' }), reviewed({ id: 'other', doi: '10.1234/b' })],
      )[0],
    ).toEqual(withoutDoi);
  });

  it('counts one old record once when DOI, provider and title all match', () => {
    const provenance: Work['provenance'] = [
      { source: 'pubmed', sourceId: '123', citations: null, retrievedAt: '', url: '' },
    ];
    const fresh = work({ doi: '10.1234/a', provenance });
    const old = reviewed({ doi: '10.1234/a', provenance });
    expect(carryForwardCuration([fresh], [old])[0].notes).toBe(old.notes);
  });

  it('indexes a large prior bibliography and transfers only matching records', () => {
    const previous = Array.from({ length: 20_000 }, (_, i) =>
      reviewed({
        id: `old-${i}`,
        doi: `10.1234/${i}`,
        title: `A distinct research publication with index ${i}`,
      }),
    );
    const fresh = [
      work({ doi: '10.1234/19000', title: 'Updated metadata' }),
      work({ doi: '10.1234/new', title: 'An unrelated new publication' }),
    ];
    const result = carryForwardCuration(fresh, previous);
    expect(result[0].notes).toBe('Read carefully');
    expect(result[1].notes).toBe('');
  });
});

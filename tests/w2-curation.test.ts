import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provenance, Work } from '../src/types';
import { carryForwardCuration } from '../src/core/curation';
import { mergeWorks } from '../src/core/merge';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w',
  title: 'Forecasting seasonal influenza with an ensemble of mechanistic models',
  authors: ['Nicholas G Reich'],
  year: 2020,
  venue: '',
  doi: '',
  abstract: '',
  type: 'article',
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
const curation = ({ included, notes, tags }: Work) => ({ included, notes, tags });

describe('W2-01 a refresh that merges old duplicates keeps their curation', () => {
  // Saved by v0.4.3: Europe PMC "MED:123" and PubMed "123" were not recognised as one paper.
  const oldEpmc = work({
    id: 'europepmc:MED:123',
    authors: ['Reich NG'],
    provenance: prov('europepmc', 'MED:123'),
    included: false,
    notes: 'Namesake - not our Reich',
    tags: ['namesake'],
  });
  const oldPubmed = work({ id: 'pubmed:123', provenance: prov('pubmed', '123') });
  const freshPair = () =>
    mergeWorks([
      work({ id: 'europepmc:MED:123', provenance: prov('europepmc', 'MED:123') }),
      work({ id: 'pubmed:123', provenance: prov('pubmed', '123') }),
    ]);

  it('carries the exclusion, note and tag of one of two old duplicates to the merged record', () => {
    expect(mergeWorks([oldEpmc, oldPubmed])).toHaveLength(1);
    const fresh = freshPair();
    expect(fresh).toHaveLength(1);
    for (const previous of [
      [oldEpmc, oldPubmed],
      [oldPubmed, oldEpmc],
    ]) {
      const [after] = carryForwardCuration(fresh, previous);
      expect(curation(after)).toEqual({
        included: false,
        notes: 'Namesake - not our Reich',
        tags: ['namesake'],
      });
      expect(after.provenance).toEqual(fresh[0].provenance);
    }
  });

  it('combines the curation of every old duplicate the way merging does', () => {
    const olds = [
      { ...oldPubmed, notes: 'Checked the affiliation', tags: ['methods', 'namesake'] },
      oldEpmc,
    ];
    const [after] = carryForwardCuration(freshPair(), olds);
    expect(curation(after)).toEqual(curation(mergeWorks(olds)[0]));
    expect(curation(after)).toEqual({
      included: false,
      notes: 'Checked the affiliation\n\nNamesake - not our Reich',
      tags: ['methods', 'namesake'],
    });
  });

  it('joins a Scholar copy and a Crossref copy that the old merge kept apart', () => {
    const oldScholar = work({
      id: 'scholar:abc',
      authors: ['NG Reich'],
      authorsComplete: false,
      provenance: prov('scholar', 'abc'),
      notes: 'Cited in the review',
    });
    const oldCrossref = work({
      id: 'crossref:10.1234/flu',
      doi: '10.1234/flu',
      provenance: prov('crossref', '10.1234/flu'),
      tags: ['ensembles'],
    });
    const fresh = mergeWorks([
      work({
        id: 'crossref:10.1234/flu',
        doi: '10.1234/flu',
        provenance: prov('crossref', '10.1234/flu'),
      }),
      work({ id: 'scholar:abc', authors: ['NG Reich'], provenance: prov('scholar', 'abc') }),
    ]);
    expect(fresh).toHaveLength(1);
    const [after] = carryForwardCuration(fresh, [oldScholar, oldCrossref]);
    expect(curation(after)).toEqual({
      included: true,
      notes: 'Cited in the review',
      tags: ['ensembles'],
    });
  });

  it('carries nothing when another fresh record also claims one of the old duplicates', () => {
    const fresh = [
      ...freshPair(),
      work({ id: 'pubmed:123-copy', title: 'Another record', provenance: prov('pubmed', '123') }),
    ];
    expect(carryForwardCuration(fresh, [oldEpmc, oldPubmed])).toEqual(fresh);
  });

  it('still carries nothing from two old records that are different papers', () => {
    const oldA = work({ id: 'a', doi: '10.1234/a', notes: 'A', included: false });
    const oldB = work({ id: 'b', doi: '10.1234/b', notes: 'B' });
    expect(mergeWorks([oldA, oldB])).toHaveLength(2);
    const fresh = [work({ id: 'fresh' })];
    expect(carryForwardCuration(fresh, [oldA, oldB])).toEqual(fresh);
  });

  it('combines at most 20 old copies of one paper (a bound on the work per record)', () => {
    const copies = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        work({ id: `c${i}`, doi: '10.1234/x', tags: [`t${i}`] }),
      );
    const fresh = [work({ id: 'fresh', doi: '10.1234/x' })];
    expect(carryForwardCuration(fresh, copies(20))[0].tags).toHaveLength(20);
    expect(carryForwardCuration(fresh, copies(21))).toEqual(fresh);
  });
});

describe('W2-02 a refresh does not re-include records that were only included by default (D11)', () => {
  // v0.4.3 stored every record included; the current adapters exclude these kinds by default (D4).
  const erratum = (overrides: Partial<Work> = {}) =>
    work({
      id: 'pubmed:111',
      title: 'Erratum: Forecasting seasonal influenza with an ensemble of mechanistic models',
      type: 'Published Erratum',
      provenance: prov('pubmed', '111'),
      ...overrides,
    });
  const refresh = (old: Work, fresh: Work) => carryForwardCuration([fresh], [old])[0];

  it('keeps a fresh erratum excluded when the old copy was included but never curated', () => {
    expect(refresh(erratum({ included: true }), erratum({ included: false })).included).toBe(false);
  });

  it('keeps the old inclusion when the user added a note or a tag', () => {
    expect(
      curation(refresh(erratum({ notes: 'Counts for the grant' }), erratum({ included: false }))),
    ).toEqual({ included: true, notes: 'Counts for the grant', tags: [] });
    expect(curation(refresh(erratum({ tags: ['keep'] }), erratum({ included: false })))).toEqual({
      included: true,
      notes: '',
      tags: ['keep'],
    });
  });

  it('carries the inclusion of an old publication-kind record as before', () => {
    const old = erratum({ type: 'journal-article' });
    expect(refresh(old, erratum({ included: false })).included).toBe(true);
  });

  it('always carries an old exclusion', () => {
    expect(refresh(erratum({ included: false }), erratum({ included: false })).included).toBe(
      false,
    );
    const article = erratum({ type: 'journal-article' });
    expect(refresh({ ...article, included: false }, article).included).toBe(false);
  });

  it('treats old duplicates as a default only when every one of them is a default', () => {
    const fresh = mergeWorks([
      erratum({ included: false }),
      erratum({
        id: 'europepmc:MED:111',
        provenance: prov('europepmc', 'MED:111'),
        included: false,
      }),
    ]);
    const plain = erratum({ id: 'europepmc:MED:111', provenance: prov('europepmc', 'MED:111') });
    expect(carryForwardCuration(fresh, [erratum(), plain])[0].included).toBe(false);
    const noted = { ...plain, notes: 'Keep' };
    expect(curation(carryForwardCuration(fresh, [erratum(), noted])[0])).toEqual({
      included: true,
      notes: 'Keep',
      tags: [],
    });
  });
});

describe('W2-02 probe: refreshing a Crossref search saved before default exclusion', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a peer-review report excluded when the old copy was never curated', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: {
                'total-results': 2,
                items: [
                  {
                    DOI: '10.1234/article',
                    title: ['Forecasting influenza with ensembles of models'],
                    author: [{ given: 'Jane', family: 'Smith' }],
                    published: { 'date-parts': [[2021]] },
                    type: 'journal-article',
                  },
                  {
                    DOI: '10.1234/review-report',
                    title: ['Review of: Forecasting influenza with ensembles of models'],
                    author: [{ given: 'Bob', family: 'Referee' }],
                    published: { 'date-parts': [[2021]] },
                    type: 'peer-review',
                  },
                ],
              },
            }),
          ),
      ),
    );
    const search = searchSources(
      { text: 'forecasting influenza', mode: 'topic', sources: ['crossref'], limit: 10 },
      DEFAULT_SETTINGS,
    );
    await vi.runAllTimersAsync();
    const fresh = mergeWorks((await search).results.flatMap((r) => r.works));
    const report = (list: Work[]) => list.find((w) => w.doi === '10.1234/review-report')!;
    expect(report(fresh).included).toBe(false);
    // The same search saved by v0.4.3: every record included, no notes, no tags.
    const previous = fresh.map((w) => ({ ...w, id: `old-${w.id}`, included: true }));
    const refreshed = carryForwardCuration(fresh, previous);
    expect(report(refreshed).included).toBe(false);
    expect(refreshed.find((w) => w.doi === '10.1234/article')!.included).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { Provenance, Work } from '../src/types';
import { mergeWorks } from '../src/core/merge';
import { nameKeys, nameMatch } from '../src/core/names';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w',
  title: 'Response to the letter to the editor on influenza vaccination',
  authors: ['Austin Meyer'],
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
const both = (a: Work, b: Work) => [mergeWorks([a, b]), mergeWorks([b, a])];

describe('W2-06 title + year duplicates need an author who is really the same person', () => {
  it('keeps papers by John Smith and Jane Smith apart', () => {
    expect(nameKeys('John Smith')).toEqual(nameKeys('Jane Smith'));
    expect(nameMatch('John Smith', 'Jane Smith')).toBeNull();
    for (const merged of both(
      work({ id: 'c1', authors: ['John Smith'] }),
      work({ id: 'c2', authors: ['Jane Smith'] }),
    ))
      expect(merged).toHaveLength(2);
  });

  it('does not attach a DOI-less record to a DOI group through a namesake', () => {
    for (const merged of both(
      work({ id: 'd', doi: '10.1234/d', authors: ['Jane Smith', 'Ann Lee'] }),
      work({ id: 'n', authors: ['John Smith'] }),
    ))
      expect(merged).toHaveLength(2);
  });

  it('still merges the same person written in different forms', () => {
    for (const [a, b] of [
      ['John Smith', 'Smith J'],
      ['Smith, Jane A.', 'J. A. Smith'],
      ['Nicholas G Reich', 'Reich NG'],
    ])
      for (const merged of both(work({ id: 'a', authors: [a] }), work({ id: 'b', authors: [b] })))
        expect(merged).toHaveLength(1);
  });

  it('merges through another shared author when two co-authors are namesakes', () => {
    const a = work({ id: 'a', authors: ['John Smith', 'Ann Lee'] });
    const b = work({ id: 'b', authors: ['Jane Smith', 'Lee A'] });
    for (const merged of both(a, b)) expect(merged).toHaveLength(1);
  });

  it('compares every spelling of a merged group, not only the first record', () => {
    // The DOI group lists "John Smith" in one copy and "Jane Smith" in the other.
    const d1 = work({ id: 'd1', doi: '10.1234/d', authors: ['Jane Smith'] });
    const d2 = work({ id: 'd2', doi: '10.1234/d', authors: ['John Smith'] });
    const n = work({ id: 'n', authors: ['Smith, John'] });
    for (const input of [
      [d1, d2, n],
      [n, d2, d1],
      [d2, n, d1],
    ])
      expect(mergeWorks(input)).toHaveLength(1);
  });
});

describe('W2-07 a record typed as a notice does not exclude the publication it merges with', () => {
  const article = work({
    id: 'crossref:1',
    doi: '10.1234/paper',
    type: 'journal-article',
    provenance: prov('crossref', '10.1234/paper'),
  });
  // Excluded by default (D4) because of its kind; nothing added by the user.
  const erratum = work({
    id: 'openalex:W1',
    doi: '10.1234/paper',
    type: 'erratum',
    provenance: prov('openalex', 'W1'),
    included: false,
  });

  it('keeps the merged publication included, with the publication type, in any order', () => {
    for (const [merged, ...rest] of both(article, erratum)) {
      expect(rest).toHaveLength(0);
      expect(merged).toMatchObject({ included: true, type: 'journal-article' });
    }
  });

  it('keeps an article included when a PubMed erratum carries its DOI', () => {
    const pubmedErratum = work({
      id: 'pubmed:9',
      doi: '10.1234/paper',
      type: 'Published Erratum',
      provenance: prov('pubmed', '9'),
      included: false,
    });
    for (const [merged] of both(pubmedErratum, article))
      expect(merged).toMatchObject({ included: true, type: 'journal-article' });
  });

  it('still excludes the merged record when the user excluded a member', () => {
    const noted = { ...erratum, notes: 'Only the correction notice' };
    const tagged = { ...erratum, tags: ['notice'] };
    const excludedArticle = { ...article, included: false };
    for (const [a, b] of [
      [article, noted],
      [article, tagged],
      [excludedArticle, erratum],
    ])
      for (const [merged] of both(a, b)) expect(merged.included).toBe(false);
  });

  it('keeps records that are all notices excluded; a placeholder or unknown type is no evidence', () => {
    const notice = { ...erratum, id: 'crossref:2', type: 'retraction', provenance: [] };
    for (const [merged] of both(erratum, notice)) expect(merged.included).toBe(false);
    const scholar = work({
      id: 'scholar:x',
      doi: '10.1234/paper',
      type: 'publication',
      provenance: prov('scholar', 'x'),
    });
    for (const [merged] of both(erratum, scholar))
      expect(merged).toMatchObject({ included: false, type: 'erratum' });
    const unknown = { ...scholar, id: 'datacite:y', type: 'Text', provenance: [] };
    for (const [merged] of both(erratum, unknown)) expect(merged.included).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Provenance, Work } from '../src/types';
import { mergeWorks } from '../src/core/merge';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w',
  title: 'Forecasting influenza with ensembles of mechanistic models',
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

describe('W7-02 a publication merged with an erratum is described by the publication', () => {
  // A PubMed erratum that carries the corrected article's DOI (excluded by default, D4).
  const erratum = work({
    id: 'pubmed:9',
    doi: '10.1234/paper',
    title: 'Erratum: Forecasting influenza with ensembles of mechanistic models',
    year: 2022,
    venue: 'Erratum venue',
    abstract: 'This corrects the article.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9/',
    type: 'Published Erratum',
    provenance: prov('pubmed', '9'),
    included: false,
  });
  const article = work({
    id: 'crossref:1',
    doi: '10.1234/paper',
    venue: 'Journal of Tests',
    abstract: 'We forecast influenza.',
    url: 'https://example.org/paper',
    provenance: prov('crossref', '10.1234/paper'),
  });

  it('takes the title, year, venue, abstract and link of the article in either order', () => {
    for (const input of [
      [erratum, article],
      [article, erratum],
    ]) {
      const merged = mergeWorks(input);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        type: 'journal-article',
        included: true,
        title: article.title,
        year: 2020,
        venue: 'Journal of Tests',
        abstract: 'We forecast influenza.',
        url: 'https://example.org/paper',
      });
    }
  });

  it('still fills a field the article lacks from the erratum', () => {
    const [merged] = mergeWorks([erratum, { ...article, venue: '', year: null }]);
    expect(merged).toMatchObject({ title: article.title, venue: 'Erratum venue', year: 2022 });
  });
});

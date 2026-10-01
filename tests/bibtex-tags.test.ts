import { describe, expect, it } from 'vitest';
import { exportWorks, importWorks } from '../src/core/formats';
import type { Work } from '../src/types';

const paper = (tags: string[]): Work => ({
  id: 'w1',
  title: 'A study of influenza forecasting in children',
  authors: ['Jane Scholar'],
  year: 2021,
  venue: 'Journal of Research Methods',
  doi: '10.1234/w1',
  abstract: '',
  type: 'journal-article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  tags,
  notes: '',
});
const roundTrip = (tags: string[]) =>
  importWorks(exportWorks([paper(tags)], 'bibtex'), 'tags.bib')[0].tags;

describe('BibTeX keywords', () => {
  it.each([
    [['Influenza, Human', 'Models, Theoretical']],
    [['Influenza, Human']],
    [['read next', 'Influenza, Human', 'cohort']],
    [['read next', 'cohort']],
    [['single']],
  ])('round-trips the tags %j, commas included', (tags) => {
    expect(roundTrip(tags)).toEqual(tags);
  });

  it('keeps the conventional separator when no tag holds a comma', () => {
    expect(exportWorks([paper(['read next', 'cohort'])], 'bibtex')).toContain(
      'keywords = {read next; cohort}',
    );
  });

  it("splits other tools' keywords on commas, or on semicolons when any are present", () => {
    const bib = (keywords: string) =>
      `@article{a, title={A study of influenza forecasting in children}, year={2021}, keywords={${keywords}}}`;
    expect(importWorks(bib('alpha, beta, gamma'), 'x.bib')[0].tags).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(importWorks(bib('alpha; beta, gamma'), 'x.bib')[0].tags).toEqual([
      'alpha',
      'beta, gamma',
    ]);
  });
});

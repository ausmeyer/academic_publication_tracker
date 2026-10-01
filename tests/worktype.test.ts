import { describe, expect, it } from 'vitest';
import {
  CROSSREF_PUBLICATION_TYPES,
  cleanPublicationTypes,
  isPublicationKind,
  workKind,
  workKindLabel,
  type WorkKind,
} from '../src/core/worktype';

describe('workKind', () => {
  it.each<[string, WorkKind]>([
    // Crossref
    ['journal-article', 'article'],
    ['proceedings-article', 'conference'],
    ['book-chapter', 'chapter'],
    ['book-part', 'chapter'],
    ['reference-entry', 'chapter'],
    ['book', 'book'],
    ['monograph', 'book'],
    ['edited-book', 'book'],
    ['posted-content', 'preprint'],
    ['dissertation', 'thesis'],
    ['report', 'report'],
    ['dataset', 'dataset'],
    ['peer-review', 'peer-review'],
    ['grant', 'grant'],
    ['journal-issue', 'issue'],
    ['journal-volume', 'issue'],
    ['journal', 'issue'],
    ['proceedings', 'issue'],
    ['book-series', 'issue'],
    ['component', 'component'],
    ['other', 'other'],
    // OpenAlex
    ['article', 'article'],
    ['preprint', 'preprint'],
    ['review', 'review'],
    ['letter', 'editorial'],
    ['editorial', 'editorial'],
    ['erratum', 'notice'],
    ['retraction', 'notice'],
    ['paratext', 'notice'],
    ['supplementary-materials', 'component'],
    ['standard', 'other'],
    // PubMed / Europe PMC (comma-joined publication types)
    ['Journal Article', 'article'],
    ['research-article', 'article'],
    ['Journal Article, Review', 'review'],
    ['Journal Article, Systematic Review', 'review'],
    ['Meta-Analysis, Journal Article', 'review'],
    ['Preprint, Journal Article', 'preprint'],
    ['Journal Article, Preprint', 'preprint'],
    ['Comment, Journal Article', 'editorial'],
    ['Letter', 'editorial'],
    ['Published Erratum', 'notice'],
    ['Journal Article, Published Erratum', 'notice'],
    ['Retraction of Publication', 'notice'],
    ['Retraction Notice', 'notice'],
    ['Expression of Concern', 'notice'],
    ['Congress', 'conference'],
    [
      "Comparative Study, Research Support, Non-U.S. Gov't, research-article, Journal Article",
      'article',
    ],
    [
      'Clinical Trial, Phase III, Comparative Study, Journal Article, Multicenter Study, Randomized Controlled Trial, Research Support, N.I.H., Extramural',
      'article',
    ],
    // a retracted paper is still a paper; only the notice is a notice
    ['Retracted Publication, Journal Article', 'article'],
    // Semantic Scholar / DataCite / Scholar / imports
    ['JournalArticle', 'article'],
    ['Conference', 'conference'],
    ['ConferencePaper', 'conference'],
    ['BookSection', 'chapter'],
    ['BookChapter', 'chapter'],
    ['LettersAndComments', 'editorial'],
    ['MetaAnalysis', 'review'],
    ['Dataset', 'dataset'],
    ['Software', 'software'],
    ['Dissertation', 'thesis'],
    ['PeerReview', 'peer-review'],
    ['publication', 'article'],
    ['book', 'book'],
    ['citation', 'other'],
    ['inproceedings', 'conference'],
    ['incollection', 'chapter'],
    ['phdthesis', 'thesis'],
    ['techreport', 'report'],
    ['misc', 'other'],
    ['gen', 'other'],
    ['', 'other'],
    ['Research Support, N.I.H., Extramural', 'other'],
  ])('classifies %j as %s', (type, kind) => {
    expect(workKind(type)).toBe(kind);
  });
});

describe('isPublicationKind', () => {
  it('rejects records that are not publications', () => {
    for (const kind of ['notice', 'peer-review', 'grant', 'issue', 'component'] as const)
      expect(isPublicationKind(kind)).toBe(false);
    for (const kind of [
      'article',
      'review',
      'preprint',
      'conference',
      'book',
      'chapter',
      'thesis',
      'report',
      'dataset',
      'software',
      'editorial',
      'other',
    ] as const)
      expect(isPublicationKind(kind)).toBe(true);
  });
});

describe('workKindLabel', () => {
  it('gives every kind a short readable label', () => {
    expect(workKindLabel('article')).toBe('Article');
    expect(workKindLabel('notice')).toBe('Notice');
    expect(workKindLabel('issue')).toBe('Journal issue');
    for (const kind of [
      'article',
      'review',
      'preprint',
      'conference',
      'book',
      'chapter',
      'thesis',
      'report',
      'dataset',
      'software',
      'editorial',
      'notice',
      'peer-review',
      'grant',
      'issue',
      'component',
      'other',
    ] as const)
      expect(workKindLabel(kind).length).toBeGreaterThan(2);
  });
});

describe('cleanPublicationTypes', () => {
  it('drops funding tags and duplicates but keeps document and study types', () => {
    expect(
      cleanPublicationTypes([
        'Journal Article',
        'Research Support, N.I.H., Extramural',
        "Research Support, Non-U.S. Gov't",
        'Multicenter Study',
        'journal article',
        'Randomized Controlled Trial',
        "Research Support, U.S. Gov't, Non-P.H.S.",
      ]),
    ).toBe('Journal Article, Multicenter Study, Randomized Controlled Trial');
  });

  it('returns an empty string when only funding tags are present', () => {
    expect(cleanPublicationTypes(['Research Support, N.I.H., Extramural'])).toBe('');
    expect(cleanPublicationTypes([])).toBe('');
  });

  it('stays within the limit on whole entries and never drops the type that classifies the record', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Clinical Study Variant Number ${i}`);
    const cleaned = cleanPublicationTypes([...many, 'Published Erratum'], 120);
    expect(cleaned.length).toBeLessThanOrEqual(120);
    expect(workKind(cleaned)).toBe('notice');
    expect(cleaned.endsWith(',')).toBe(false);
  });
});

describe('CROSSREF_PUBLICATION_TYPES', () => {
  it('requests publications and leaves out issues, peer-review reports, grants and components', () => {
    expect(CROSSREF_PUBLICATION_TYPES).toEqual(
      expect.arrayContaining([
        'journal-article',
        'proceedings-article',
        'book',
        'book-chapter',
        'posted-content',
        'dissertation',
      ]),
    );
    for (const excluded of ['journal-issue', 'journal-volume', 'peer-review', 'grant', 'component'])
      expect(CROSSREF_PUBLICATION_TYPES).not.toContain(excluded);
    for (const type of CROSSREF_PUBLICATION_TYPES)
      expect(isPublicationKind(workKind(type))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { datasetTemplate, importInsightsData, type Dataset } from '../src/core/insights-data';
import { settings, work } from './insights-helpers';

const works = [
  work('one', { year: 2018, venue: 'Research' }),
  work('two', { year: 2020, venue: 'Methods' }),
  work('three', { year: 2021, venue: 'Nature' }),
];
const run = (kind: Dataset, content: string, base = settings()) =>
  importInsightsData(base, kind, content, works, 2026);
const csv = (header: string, rows: string[]) => [header, ...rows].join('\n');

describe('importing a partly filled template', () => {
  it('skips annual rows whose year and citations were left empty, and counts them', () => {
    const lines = datasetTemplate('annual', works).split('\r\n');
    lines[2] = lines[2].replace('"10.1234/two","",""', '"10.1234/two","2024","7"');
    const result = run('annual', lines.join('\r\n'));
    expect(result.settings.annualCitations).toEqual([
      { key: '10.1234/two', year: 2024, citations: 7, source: 'scholar' },
    ]);
    expect(result).toMatchObject({ count: 1, blank: 2, skipped: 0 });
  });

  it('skips ranking rows whose category, quartile and source were left empty', () => {
    const lines = datasetTemplate('rankings', works).split('\r\n');
    lines[1] = '"Research","2018","Medicine","Q1","SJR"';
    const result = run('rankings', lines.join('\r\n'));
    expect(result.settings.journalRanks).toEqual([
      { venue: 'Research', year: 2018, category: 'Medicine', quartile: 'Q1', source: 'SJR' },
    ]);
    expect(result).toMatchObject({ count: 1, blank: 2, skipped: 0 });
  });

  it('imports nothing, without an error, when the template is returned empty', () => {
    expect(run('annual', datasetTemplate('annual', works))).toMatchObject({ count: 0, blank: 3 });
  });

  it('accepts an annual source written in capitals', () => {
    const result = run('annual', csv('key,year,citations,source', ['10.1234/one,2024,5,Scholar']));
    expect(result.settings.annualCitations[0].source).toBe('scholar');
  });
});

describe('import errors name the row and the column', () => {
  const annual = (row: string) => () => run('annual', csv('key,year,citations,source', [row]));
  it.each([
    ['a missing count', '10.1234/one,2024,,scholar', /^Row 2, citations: /],
    ['a missing year', '10.1234/one,,5,scholar', /^Row 2, year: /],
    ['a decimal count', '10.1234/one,2024,5.0,scholar', /^Row 2, citations: "5\.0"/],
    ['a negative count', '10.1234/one,2024,-1,scholar', /^Row 2, citations: "-1"/],
    ['a year that is not a year', '10.1234/one,20x4,5,scholar', /^Row 2, year: "20x4"/],
    ['an unknown source', '10.1234/one,2024,5,google', /^Row 2, source: "google"/],
    ['a future year', '10.1234/one,2999,5,scholar', /^Row 2, year: .*after 2026.*2999/],
  ])('for %s in annual counts', (_label, row, message) => {
    expect(annual(row)).toThrow(message);
  });

  it('names both rows of a duplicate annual count, however the paper is identified', () => {
    const rows = ['10.1234/one,2024,5,scholar', 'one,2024,6,scholar'];
    expect(() => run('annual', csv('key,year,citations,source', rows))).toThrow(/^Rows 2 and 3 /);
  });

  it.each([
    ['a missing category', 'Research,2018,,Q1,SJR', /^Row 2, category: .*venue, year, category/],
    ['a quartile that is not one', 'Research,2018,Medicine,Q5,SJR', /^Row 2, quartile: "Q5"/],
    ['a year that is not a year', 'Research,soon,Medicine,Q1,SJR', /^Row 2, year: "soon"/],
  ])('for %s in rankings', (_label, row, message) => {
    expect(() => run('rankings', csv('venue,year,category,quartile,source', [row]))).toThrow(
      message,
    );
  });

  it('names both rows of a duplicate ranking', () => {
    const rows = ['Research,2018,Medicine,Q1,SJR', 'research,2018,Medicine,Q2,SJR'];
    expect(() => run('rankings', csv('venue,year,category,quartile,source', rows))).toThrow(
      /^Rows 2 and 3 /,
    );
  });

  it.each([
    [
      'a completeness that is not true or false',
      '10.1234/one,A One,yes,',
      /^Row 2, complete: "yes"/,
    ],
    ['an unknown role', '10.1234/one,A One,true,boss', /^Row 2, role: "boss"/],
  ])('for %s in author reviews', (_label, row, message) => {
    expect(() => run('authors', csv('key,authors,complete,role', [row]))).toThrow(message);
  });

  it('names both rows of a duplicate author review', () => {
    const rows = ['10.1234/one,A One,true,', 'one,A One; B Two,true,'];
    expect(() => run('authors', csv('key,authors,complete,role', rows))).toThrow(/^Rows 2 and 3 /);
  });

  it('counts records, not spreadsheet rows, in a JSON array', () => {
    const records = JSON.stringify([
      { key: '10.1234/one', year: 2024, citations: 5, source: 'scholar' },
      { key: '10.1234/two', year: 2024, citations: 5.5, source: 'scholar' },
    ]);
    expect(() => run('annual', records)).toThrow(/^Record 2, citations: "5\.5"/);
  });

  it('still leaves the saved data alone when an import is rejected', () => {
    const saved = settings({
      annualCitations: [{ key: '10.1234/one', year: 2023, citations: 1, source: 'scholar' }],
    });
    const before = JSON.stringify(saved);
    expect(() =>
      run('annual', csv('key,year,citations,source', ['10.1234/one,2024,x,scholar']), saved),
    ).toThrow();
    expect(JSON.stringify(saved)).toBe(before);
  });
});

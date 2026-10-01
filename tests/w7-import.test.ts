import { describe, expect, it } from 'vitest';
import { importWorks, parseCsv, parseCsvTable } from '../src/core/formats';

describe('W7-03 a quote in a Web of Science file never spans cells', () => {
  const header = ['PT', 'AU', 'TI', 'AB', 'PY'].join('\t');
  const file = (...rows: string[][]) =>
    [header, ...rows.map((cells) => cells.join('\t'))].join('\n');

  it('does not swallow the rows between a title that opens a quote and a later inch mark', () => {
    const works = importWorks(
      file(
        ['J', 'Meyer, AG', '"Unbalanced title start', 'Plain.', '2019'],
        ['J', 'Smith, J', 'Second paper', 'Plain.', '2020'],
        ['J', 'Doe, A', 'Flat panel displays of 12"', 'Plain.', '2021'],
      ),
      'savedrecs.txt',
    );
    expect(works.map((work) => [work.title, work.year])).toEqual([
      ['"Unbalanced title start', 2019],
      ['Second paper', 2020],
      ['Flat panel displays of 12"', 2021],
    ]);
  });

  it('does not pair a quote with one in a later cell of the same row', () => {
    const [work] = importWorks(
      file(['J', 'Meyer, AG', '"Quoted start of a title', 'Screens of 12"', '2019']),
      'savedrecs.txt',
    );
    expect(work).toMatchObject({
      title: '"Quoted start of a title',
      abstract: 'Screens of 12"',
      year: 2019,
    });
  });

  it('still reads a Web of Science cell that is quoted as a whole', () => {
    const [work] = importWorks(
      file(['J', 'Meyer, AG', '"A quoted title"', 'Plain.', '2019']),
      'x.txt',
    );
    expect(work).toMatchObject({ title: 'A quoted title', abstract: 'Plain.' });
  });
});

describe('W7-05 import errors name the spreadsheet row after cleared or empty rows', () => {
  it('gives the source row of every record next to the records', () => {
    const content = ['key,year', '10.1234/one,2024', ',', '', '10.1234/two,2025'].join('\r\n');
    const table = parseCsvTable(content, ',', false);
    expect(table.records).toEqual([
      { key: '10.1234/one', year: '2024' },
      { key: '10.1234/two', year: '2025' },
    ]);
    expect(table.rows).toEqual([2, 5]);
    expect(parseCsv(content, ',', false)).toEqual(table.records);
  });

  it('counts a quoted line break as part of its row, and blank rows above the header', () => {
    const content = '\nTitle,Notes\n"A","line one\nline two"\n"B",x';
    expect(parseCsvTable(content, ',', true).rows).toEqual([3, 4]);
  });

  it('names the spreadsheet row in a field-count error', () => {
    expect(() => importWorks('Title,Year\nA,2020\n,\nB,2021,extra\n', 'x.csv')).toThrow(
      'CSV row 4 has 3 fields; expected 2.',
    );
    expect(() => importWorks('Title\tYear\nA\t2020\n\nB\t2021\textra\n', 'x.tsv')).toThrow(
      'TSV row 4 has 3 fields; expected 2.',
    );
  });

  it('counts the Dimensions line above the header as a row', () => {
    const file = '"About the data: Exported on Sep 30, 2026"\nTitle,Year\nA,2020\nB,2021,extra\n';
    expect(() => importWorks(file, 'dimensions.csv')).toThrow(
      'CSV row 4 has 3 fields; expected 2.',
    );
  });
});

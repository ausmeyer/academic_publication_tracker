import { describe, expect, it } from 'vitest';
import { datasetTemplate, importInsightsData } from '../src/core/insights-data';
import { settings, work } from './insights-helpers';

const works = [work('one', { year: 2018 }), work('two', { year: 2020 }), work('three')];
const error = (kind: 'annual' | 'authors' | 'rankings', content: string) => {
  try {
    importInsightsData(settings(), kind, content, works, 2026);
    return 'imported';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('Insights import errors name the spreadsheet row', () => {
  it('after a row whose cells were cleared (Excel writes ",,,")', () => {
    const csv = [
      'key,year,citations,source',
      '10.1234/one,2024,5,scholar', // row 2
      ',,,', // row 3: contents cleared in the spreadsheet
      '10.1234/two,2024,five,scholar', // row 4: the mistake
    ].join('\r\n');
    expect(error('annual', csv)).toBe(
      'Row 4, citations: "five" is not a whole number of citations.',
    );
  });

  it('after an empty line', () => {
    const csv = [
      'key,authors,complete,role',
      '10.1234/one,Jane Scholar; Alex Other,true,', // row 2
      '', // row 3
      '10.1234/two,Jane Scholar; Alex Other,yes,', // row 4: the mistake
    ].join('\r\n');
    expect(error('authors', csv)).toBe('Row 4, complete: "yes" is not true or false.');
  });

  it('the authors template filled in by a spreadsheet that drops a cleared row', () => {
    const lines = datasetTemplate('authors', works).split('\r\n');
    lines[2] = ',,,'; // row 3 cleared
    lines[3] = lines[3].replace('"true"', '"maybe"'); // row 4
    expect(error('authors', lines.join('\r\n'))).toBe(
      'Row 4, complete: "maybe" is not true or false.',
    );
  });
});

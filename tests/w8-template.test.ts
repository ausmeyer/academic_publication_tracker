import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { datasetTemplate, importInsightsData } from '../src/core/insights-data';
import type { InsightsSettings, Work } from '../src/types';
import { settings, work } from './insights-helpers';

/** Downloads the authors template as the panel does and imports it again untouched. */
const roundTrip = (saved: InsightsSettings, works: Work[]) =>
  importInsightsData(saved, 'authors', datasetTemplate('authors', works, saved), works);
/** The authors cell of the template's first paper row, as a spreadsheet shows it. */
const authorsCell = (works: Work[], saved = settings()) =>
  datasetTemplate('authors', works, saved)
    .split('\r\n')[1]
    .match(/^"[^"]*","((?:[^"]|"")*)"/)![1]
    .replace(/""/g, '"');

describe('the authors template keeps author names that ";" would split', () => {
  it('an untouched row for an author containing ";" changes nothing', () => {
    const works = [work('p', { authors: ['Consortium A; B', 'Jane Scholar', 'Alex Other'] })];
    const before = analyzeInsights(works, settings(), 'all');
    const result = roundTrip(settings(), works);
    expect({ count: result.count, unchanged: result.unchanged }).toEqual({
      count: 0,
      unchanged: 1,
    });
    expect(result.settings.annotations).toEqual([]);
    expect(analyzeInsights(works, result.settings, 'all').rows[0].role).toBe(before.rows[0].role);
  });

  it('an untouched row for an author written with spaces around the name changes nothing', () => {
    const works = [work('p', { authors: ['Jane Scholar ', 'Alex Other'] })];
    const result = roundTrip(settings(), works);
    expect({ count: result.count, annotations: result.settings.annotations }).toEqual({
      count: 0,
      annotations: [],
    });
  });

  it('an untouched row for a saved review with such a name changes nothing', () => {
    const works = [work('p')];
    const saved = settings({
      annotations: [
        {
          key: '10.1234/p',
          authors: ['Consortium A; B', 'Jane Scholar'],
          complete: true,
          role: 'last',
        },
      ],
    });
    const result = roundTrip(saved, works);
    expect(result.count).toBe(0);
    expect(result.settings.annotations).toEqual(saved.annotations);
  });

  it('writes such a list as a JSON list and ordinary lists as names separated by ";"', () => {
    expect(authorsCell([work('p', { authors: ['Consortium A; B', 'Jane Scholar'] })])).toBe(
      '["Consortium A; B","Jane Scholar"]',
    );
    expect(authorsCell([work('p', { authors: ['Jane Scholar', 'Alex Other'] })])).toBe(
      'Jane Scholar; Alex Other',
    );
  });

  it('imports a JSON list edited in the template as that list', () => {
    const works = [work('p', { authors: ['Consortium A; B', 'Jane Scholar'] })];
    const csv = [
      'key,authors,complete,role',
      '10.1234/p,"[""Consortium A; B"",""Jane Scholar"",""Kim Lee""]",true,',
    ].join('\r\n');
    const result = importInsightsData(settings(), 'authors', csv, works);
    expect(result.count).toBe(1);
    expect(result.settings.annotations).toEqual([
      { key: '10.1234/p', authors: ['Consortium A; B', 'Jane Scholar', 'Kim Lee'], complete: true },
    ]);
  });

  it('changes nothing for random records, reviews and awkward names (fuzz)', () => {
    let seed = 11;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
    const names = [
      'Jane Scholar',
      'Consortium A; B',
      ' Padded Name ',
      'María José García',
      "O'Brien, Pat",
      'Smith J',
      'et al.',
      '…',
      '=Formula Name',
      "'Quoted",
      'Name "Nick" Real',
      '[Bracketed]',
      '["Not", "a list"]',
    ];
    const list = () => Array.from({ length: Math.floor(random() * 5) }, () => pick(names));
    const failures: string[] = [];
    for (let trial = 0; trial < 300; trial++) {
      const works = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) =>
        work(`t${trial}p${i}`, { authors: list() }),
      );
      const saved = settings({
        annotations: works
          .filter(() => random() < 0.5)
          // Saved reviews hold trimmed names (validateInsights trims them).
          .map((w) => ({
            key: `10.1234/${w.id}`,
            authors: list().map((a) => a.trim()),
            complete: random() < 0.5,
          })),
      });
      const result = roundTrip(saved, works);
      if (result.count !== 0 || JSON.stringify(result.settings) !== JSON.stringify(saved))
        failures.push(JSON.stringify({ works: works.map((w) => w.authors), saved }));
    }
    expect(failures.slice(0, 2)).toEqual([]);
  });

  it('still reads a cell that only starts with "[" as names separated by ";"', () => {
    const works = [work('p')];
    const csv = ['key,authors,complete,role', '10.1234/p,[Anonymous]; Jane Scholar,true,'].join(
      '\r\n',
    );
    expect(importInsightsData(settings(), 'authors', csv, works).settings.annotations).toEqual([
      { key: '10.1234/p', authors: ['[Anonymous]', 'Jane Scholar'], complete: true },
    ]);
  });
});

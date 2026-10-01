import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { datasetTemplate, importInsightsData } from '../src/core/insights-data';
import { parseCsv } from '../src/core/formats';
import { settings, work } from './insights-helpers';

const scholar = [
  { source: 'scholar' as const, sourceId: 's1', citations: 40, retrievedAt: '2026-09-01', url: '' },
];
// A Scholar record whose list the user confirmed complete, a record whose list the user corrected
// (a co-author added) with a confirmed role, and a record nobody has reviewed yet.
const works = [
  work('confirmed', {
    id: 'scholar:confirmed',
    doi: '',
    authors: ['Alex Other', 'Jane Scholar', 'Kim Lee'],
    provenance: scholar,
  }),
  work('corrected', { authors: ['Jane Scholar', 'Alex Other'] }),
  work('untouched', { authors: ['Alex Other', 'Jane Scholar'], authorsComplete: false }),
];
const reviewed = settings({
  annotations: [
    {
      key: 'scholar:confirmed',
      authors: ['Alex Other', 'Jane Scholar', 'Kim Lee'],
      complete: true,
    },
    {
      key: '10.1234/corrected',
      authors: ['Jane Scholar', 'Alex Other', 'Sam New'],
      complete: true,
      role: 'corresponding',
    },
  ],
});
const rowsOf = (template: string) => parseCsv(template.replace(/^﻿/, ''), ',', false);

describe('the authors template after author reviews were saved', () => {
  it('is prefilled with each saved review, and with the record itself where there is none', () => {
    expect(rowsOf(datasetTemplate('authors', works, reviewed))).toEqual([
      {
        key: 'scholar:confirmed',
        authors: 'Alex Other; Jane Scholar; Kim Lee',
        complete: 'true',
        role: '',
      },
      {
        key: '10.1234/corrected',
        authors: 'Jane Scholar; Alex Other; Sam New',
        complete: 'true',
        role: 'corresponding',
      },
      {
        key: '10.1234/untouched',
        authors: 'Alex Other; Jane Scholar',
        complete: 'false',
        role: '',
      },
    ]);
  });

  it('changes nothing and imports nothing when it is imported untouched', () => {
    const before = analyzeInsights(works, reviewed, 'all');
    const result = importInsightsData(
      reviewed,
      'authors',
      datasetTemplate('authors', works, reviewed),
      works,
    );
    expect(result.settings.annotations).toEqual(reviewed.annotations);
    expect(result).toMatchObject({ count: 0, unchanged: 3, skipped: 0 });
    const after = analyzeInsights(works, result.settings, 'all');
    expect(after.rows.map((r) => [r.role, r.reason, r.complete])).toEqual(
      before.rows.map((r) => [r.role, r.reason, r.complete]),
    );
    expect(after.classified).toBe(before.classified);
  });

  it('applies only the row that was edited', () => {
    const lines = datasetTemplate('authors', works, reviewed).split('\r\n');
    lines[3] = lines[3].replace('"false"', '"true"'); // the unreviewed paper is now confirmed complete
    const result = importInsightsData(reviewed, 'authors', lines.join('\r\n'), works);
    expect(result).toMatchObject({ count: 1, unchanged: 2 });
    expect(result.settings.annotations).toEqual([
      ...reviewed.annotations,
      { key: '10.1234/untouched', authors: ['Alex Other', 'Jane Scholar'], complete: true },
    ]);
  });

  it('clears a saved role only when its cell is emptied', () => {
    const lines = datasetTemplate('authors', works, reviewed).split('\r\n');
    lines[2] = lines[2].replace('"corresponding"', '""');
    const result = importInsightsData(reviewed, 'authors', lines.join('\r\n'), works);
    expect(result).toMatchObject({ count: 1, unchanged: 2 });
    expect(result.settings.annotations).toEqual([
      reviewed.annotations[0],
      {
        key: '10.1234/corrected',
        authors: ['Jane Scholar', 'Alex Other', 'Sam New'],
        complete: true,
      },
    ]);
  });

  it('keeps a saved review that completed a truncated Scholar list', () => {
    const truncated = work('cut', {
      id: 'scholar:1',
      doi: '',
      authors: ['A Smith', 'Jane Scholar', '…'],
      provenance: scholar,
    });
    const review = {
      key: 'scholar:1',
      authors: ['A Smith', 'Jane Scholar', 'C Third', 'D Fourth'],
      complete: true,
    };
    const saved = settings({ annotations: [review] });
    const result = importInsightsData(
      saved,
      'authors',
      datasetTemplate('authors', [truncated], saved),
      [truncated],
    );
    expect(result.settings.annotations).toEqual([review]);
    expect(result).toMatchObject({ count: 0, unchanged: 1 });
  });
});

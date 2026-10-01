import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import {
  datasetTemplate,
  importInsightsData,
  validateInsights,
  type Dataset,
} from '../src/core/insights-data';
import { validateWorkspace } from '../src/core/workspace';
import { settings, snapshot, work } from './insights-helpers';

describe('importing tab-separated and spreadsheet files', () => {
  // Not yet confirmed complete, so the confirmation in the file is a real change.
  const works = [
    work('abc', {
      id: 'scholar:abc',
      doi: '',
      authors: ['A One', 'Jane Scholar', 'C Three'],
      authorsComplete: false,
    }),
  ];
  const header = 'key\tauthors\tcomplete\trole';
  const row = 'scholar:abc\tA One; Jane Scholar; C Three\ttrue\t';

  it.each([
    ['no final newline', `${header}\n${row}`],
    ['a final LF', `${header}\n${row}\n`],
    ['Excel CRLF line endings', `${header}\r\n${row}\r\n`],
    ['a byte-order mark', `\uFEFF${header}\r\n${row}\r\n`],
  ])('keeps an empty last cell with %s', (_label, content) => {
    const result = importInsightsData(settings(), 'authors', content, works);
    expect(result.settings.annotations).toEqual([
      { key: 'scholar:abc', authors: ['A One', 'Jane Scholar', 'C Three'], complete: true },
    ]);
  });

  it('accepts a header that starts with an empty spreadsheet index cell', () => {
    const result = importInsightsData(settings(), 'authors', `\t${header}\n0\t${row}`, works);
    expect(result.settings.annotations).toHaveLength(1);
  });

  it('still reads a CSV whose role is empty on the last row', () => {
    const result = importInsightsData(
      settings(),
      'authors',
      'key,authors,complete,role\r\nscholar:abc,A One; Jane Scholar; C Three,true,\r\n',
      works,
    );
    expect(result.settings.annotations).toHaveLength(1);
  });
});

describe('matching imported rows to papers', () => {
  const works = [
    work('abc', { id: 'scholar:abc', doi: '' }),
    work('def', { id: 'scholar:def', doi: '' }),
    work('one'),
  ];
  const annual = (content: string) => importInsightsData(settings(), 'annual', content, works);

  it('falls back to the id column when the doi column is blank for DOI-less papers', () => {
    const result = annual(
      'id,doi,year,citations,source\nscholar:abc,,2024,5,scholar\nscholar:def,,2024,3,scholar',
    );
    expect(result.count).toBe(2);
    expect(result.settings.annualCitations.map((r) => r.key)).toEqual([
      'scholar:abc',
      'scholar:def',
    ]);
  });

  it('uses the doi column when the key column is blank', () => {
    const result = annual('key,doi,year,citations,source\n,10.1234/one,2024,5,scholar');
    expect(result.settings.annualCitations[0].key).toBe('10.1234/one');
  });

  it('tries the next identifier column when the first one matches nothing', () => {
    const result = annual(
      'key,id,year,citations,source\nnot-in-this-snapshot,scholar:abc,2024,5,scholar',
    );
    expect(result.settings.annualCitations[0].key).toBe('scholar:abc');
  });

  it('keeps the first non-blank value for other aliased columns too', () => {
    const result = importInsightsData(
      settings(),
      'rankings',
      'venue,journal,year,category,quartile,source\n,Research,2020,Medicine,Q1,SJR',
      [work('one')],
    );
    expect(result.settings.journalRanks[0].venue).toBe('Research');
  });
});

describe('the authors template', () => {
  const complete = work('complete', { authors: ['A One', 'B Two', 'Jane Scholar'] });
  const flagged = work('flagged', { authorsComplete: false, authors: ['A One', 'B Two …'] });
  const legacy = work('legacy', {
    authors: ['A One', 'B Two'],
    provenance: [
      { source: 'scholar', sourceId: 'x', citations: 1, retrievedAt: '2026-01-01', url: '' },
    ],
  });
  const confirmed = work('confirmed', {
    authors: ['A One', 'B Two'],
    authorsComplete: true,
    provenance: [
      { source: 'scholar', sourceId: 'y', citations: 1, retrievedAt: '2026-01-01', url: '' },
    ],
  });
  const works = [complete, flagged, legacy, confirmed];

  it('is prefilled with each paper’s actual completeness', () => {
    const rows = datasetTemplate('authors', works)
      .replace(/^\uFEFF/, '')
      .split('\r\n');
    expect(rows.slice(1).map((line) => line.split(',').slice(-2)[0])).toEqual([
      '"true"',
      '"false"',
      '"false"',
      '"true"',
    ]);
  });

  it('does not change anything when it is imported untouched', () => {
    const config = settings({ author: 'Jane Scholar' });
    const before = analyzeInsights(works, config, 'all');
    const result = importInsightsData(config, 'authors', datasetTemplate('authors', works), works);
    expect(result.settings.annotations).toEqual([]);
    expect(result).toMatchObject({ count: 0, unchanged: 4, skipped: 0 });
    const after = analyzeInsights(works, result.settings, 'all');
    expect(after.rows.map((r) => [r.role, r.complete])).toEqual(
      before.rows.map((r) => [r.role, r.complete]),
    );
  });

  it('applies only the rows that were edited', () => {
    const lines = datasetTemplate('authors', works).split('\r\n');
    lines[2] = lines[2].replace('"false"', '"true"'); // the flagged paper is now confirmed complete
    const result = importInsightsData(settings(), 'authors', lines.join('\r\n'), works);
    expect(result.settings.annotations.map((a) => [a.key, a.complete])).toEqual([
      ['10.1234/flagged', true],
    ]);
    expect(result).toMatchObject({ count: 1, unchanged: 3 });
  });

  it('does not treat a row identical to a saved review as a change', () => {
    const saved = settings({
      annotations: [{ key: '10.1234/complete', authors: ['A One', 'B Two'], complete: true }],
    });
    const content =
      'key,authors,complete,role\n10.1234/complete,A One; B Two,true,\n10.1234/flagged,A One; B Two …,false,';
    const result = importInsightsData(saved, 'authors', content, works);
    expect(result).toMatchObject({ count: 0, unchanged: 2 });
    expect(result.settings.annotations).toEqual(saved.annotations);
  });

  it('applies a changed role, author list or completeness', () => {
    const content = [
      'key,authors,complete,role',
      '10.1234/complete,A One; B Two; C Three,true,corresponding',
      '10.1234/flagged,A One; B Two,true,',
    ].join('\n');
    const result = importInsightsData(
      settings({ author: 'Jane Scholar' }),
      'authors',
      content,
      works,
    );
    expect(result.count).toBe(2);
    expect(result.settings.annotations).toHaveLength(2);
  });

  it.each(['authors', 'annual', 'rankings', 'retractions'] as Dataset[])(
    'starts the %s template with a UTF-8 byte-order mark so spreadsheets read names correctly',
    (kind) => {
      expect(datasetTemplate(kind, [work('one', { authors: ['Łukasz Nowak'] })])).toMatch(
        /^\uFEFF/,
      );
    },
  );

  it('round-trips a template that carries a byte-order mark', () => {
    const only = [work('one', { authors: ['Łukasz Nowak', 'Bjørn Dæhlen'] })];
    const edited = datasetTemplate('authors', only)
      .replace('"false"', '"true"')
      .replace('""', '"first"');
    const result = importInsightsData(
      settings({ author: 'Łukasz Nowak' }),
      'authors',
      edited,
      only,
    );
    expect(result.settings.annotations[0]).toMatchObject({
      authors: ['Łukasz Nowak', 'Bjørn Dæhlen'],
      role: 'first',
    });
  });
});

describe('journal quartile imports', () => {
  const works = [
    work('a', { venue: 'PLoS ONE' }),
    work('b', { venue: 'Nature' }),
    work('c', { venue: '' }),
  ];
  const header = 'venue,year,category,quartile,source';

  it('keeps only rankings for journals in the snapshot and reports the rest', () => {
    const result = importInsightsData(
      settings(),
      'rankings',
      [
        header,
        'PLOS One,2020,Multidisciplinary,Q1,SJR',
        'Nature,2020,Multidisciplinary,Q1,SJR',
        'Science,2020,Multidisciplinary,Q1,SJR',
        'Cell,2020,Biochemistry,Q1,SJR',
      ].join('\n'),
      works,
    );
    expect(result.settings.journalRanks.map((r) => r.venue)).toEqual(['PLOS One', 'Nature']);
    expect(result).toMatchObject({ count: 2, skipped: 2 });
  });

  it('applies a kept ranking to papers whose journal is spelled differently', () => {
    const result = importInsightsData(
      settings(),
      'rankings',
      `${header}\nplos one,2020,Multidisciplinary,Q2,SJR`,
      works,
    );
    expect(analyzeInsights(works, result.settings, 'all').rows[0].quartile).toBe('Q2');
  });

  it('says so when no journal in the file is in the snapshot', () => {
    expect(() =>
      importInsightsData(
        settings(),
        'rankings',
        `${header}\nScience,2020,Multidisciplinary,Q1,SJR`,
        works,
      ),
    ).toThrow(/journals? in this snapshot/i);
  });

  it('still requires the venue, category and source columns', () => {
    expect(() =>
      importInsightsData(settings(), 'rankings', `${header}\nNature,2020,,Q1,SJR`, works),
    ).toThrow(/venue, year, category, quartile and source/);
  });

  it('names the limit when the saved rankings would exceed it', () => {
    const rows = Array.from(
      { length: 20001 },
      (_, i) => `Nature,${1500 + (i % 1500)},Category ${Math.floor(i / 1500)},Q1,SJR`,
    );
    expect(() =>
      importInsightsData(settings(), 'rankings', [header, ...rows].join('\n'), works),
    ).toThrow(/20,000/);
  });

  it('names the row limit of an import file', () => {
    const rows = Array.from({ length: 100001 }, (_, i) => ({
      venue: 'Nature',
      year: 2000,
      category: `c${i}`,
      quartile: 'Q1',
      source: 'SJR',
    }));
    expect(() => importInsightsData(settings(), 'rankings', JSON.stringify(rows), works)).toThrow(
      /100,000/,
    );
  });

  it('names the limit on annual counts when the saved list would exceed it', () => {
    const saved = settings({
      annualCitations: Array.from({ length: 99999 }, (_, i) => ({
        key: `10.1234/x${i}`,
        year: 2020,
        citations: 1,
        source: 'scholar' as const,
      })),
    });
    const content = 'key,year,citations,source\none,2021,1,scholar\none,2022,1,scholar';
    expect(() => importInsightsData(saved, 'annual', content, [work('one')], 2026)).toThrow(
      /100,000/,
    );
  });
});

describe('loading older or partial Insights settings', () => {
  const complete = settings({ author: 'Jane Scholar' });
  const { retractions: _retractions, ...withoutRetractions } = complete;

  it('defaults lists and flags an earlier version did not save', () => {
    expect(validateInsights(withoutRetractions)).toEqual({ ...complete, retractions: [] });
    expect(validateInsights({})).toEqual({
      author: '',
      aliases: [],
      lensConvention: false,
      annotations: [],
      annualCitations: [],
      journalRanks: [],
      retractions: [],
    });
  });

  it('defaults the parts of an author review an earlier version did not save', () => {
    const loaded = validateInsights({ ...complete, annotations: [{ key: '10.1234/one' }] });
    expect(loaded.annotations).toEqual([{ key: '10.1234/one', authors: [], complete: false }]);
  });

  it('opens a workspace where one snapshot has an older Insights block', () => {
    const { retractions: _dropped, ...partial } = complete;
    const json = JSON.parse(
      JSON.stringify({
        version: 2,
        activeId: 'old',
        snapshots: [
          { ...snapshot, id: 'current', insights: complete },
          { ...snapshot, id: 'old', insights: partial },
        ],
      }),
    );
    const loaded = validateWorkspace(json);
    expect(loaded.snapshots).toHaveLength(2);
    expect(loaded.snapshots[1].insights?.retractions).toEqual([]);
  });

  it('keeps accepting saved retraction notices', () => {
    const notice = {
      doi: '10.1234/one',
      status: 'Retraction',
      reason: 'Error',
      date: '2025-01-01',
      source: 'RW',
    };
    expect(validateInsights({ ...complete, retractions: [notice] }).retractions).toEqual([notice]);
  });

  it.each([
    ['an unknown role', { annotations: [{ key: 'k', authors: [], complete: true, role: 'null' }] }],
    ['a non-list', { aliases: 'Jane' }],
    ['a non-boolean flag', { lensConvention: 'yes' }],
    ['a bad year', { yearFrom: 'soon' }],
    [
      'an oversized author list',
      { annotations: [{ key: 'k', authors: ['x'.repeat(1001)], complete: true }] },
    ],
    [
      'a retraction without a valid DOI',
      { retractions: [{ doi: '', status: 'r', reason: '', date: '', source: 's' }] },
    ],
    [
      'an annual row with an unknown source',
      { annualCitations: [{ key: 'k', year: 2020, citations: 1, source: 'nope' }] },
    ],
  ])('still rejects %s', (_label, bad) => {
    expect(() => validateInsights({ ...complete, ...bad })).toThrow();
  });

  it('names the limit when a list is too long', () => {
    const rows = Array.from({ length: 20001 }, (_, i) => ({
      venue: `V${i}`,
      year: 2020,
      category: 'c',
      quartile: 'Q1',
      source: 's',
    }));
    expect(() => validateInsights({ ...complete, journalRanks: rows })).toThrow(/20,000/);
  });
});

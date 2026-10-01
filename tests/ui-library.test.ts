import { afterEach, describe, expect, it } from 'vitest';
import {
  NEARLY_FULL,
  capacityWarning,
  describeSaveFailure,
  exportFileName,
  filterTokens,
  importSummary,
  matchesFilter,
  nearestLimit,
  workspaceUsage,
} from '../src/library';
import { validateWorkspace } from '../src/core/workspace';
import type { Snapshot, Work, Workspace } from '../src/types';

const at = '2026-09-14T15:00:00.000Z';
function work(over: Partial<Work> = {}): Work {
  return {
    id: 'w1',
    title: 'Evaluating epidemic forecasts',
    authors: ['Jane Scholar'],
    year: 2021,
    venue: 'Journal of Research Methods',
    doi: '10.1234/one',
    abstract: '',
    type: 'journal-article',
    url: '',
    openAccessUrl: '',
    isOpenAccess: false,
    citations: 1,
    provenance: [],
    included: true,
    tags: [],
    notes: '',
    ...over,
  };
}
const match = (w: Work, text: string) => matchesFilter(w, filterTokens(text));

describe('publication filter (P5-07)', () => {
  it('finds accented names typed without accents', () => {
    expect(match(work({ authors: ['María González'] }), 'gonzalez')).toBe(true);
    expect(match(work({ authors: ['Bjørn Dæhlen'] }), 'bjorn daehlen')).toBe(true);
  });

  it('finds words in any order', () => {
    const w = work({ title: 'Epidemic forecasting with transparent uncertainty' });
    expect(match(w, 'forecasting epidemic')).toBe(true);
  });

  it('finds words spread across fields', () => {
    const w = work({
      title: 'Something else entirely',
      authors: ['Jane Scholar'],
      venue: 'Nature Methods',
      year: 2021,
      doi: '10.1038/xyz',
      tags: ['read next'],
      notes: 'good figure',
    });
    expect(match(w, 'nature methods 2021')).toBe(true);
    expect(match(w, 'scholar 2021')).toBe(true);
    expect(match(w, 'scholar figure next')).toBe(true);
  });

  it('requires every word to be present', () => {
    expect(match(work(), 'epidemic nonexistent')).toBe(false);
  });

  it('matches everything for an empty or blank filter', () => {
    expect(match(work(), '')).toBe(true);
    expect(match(work(), '   ')).toBe(true);
  });

  it('treats regular-expression characters literally', () => {
    const w = work({ title: 'IL-6 (n=10) [pilot] a.b*c' });
    expect(match(w, '(n=10)')).toBe(true);
    expect(match(w, '[pilot]')).toBe(true);
    expect(match(w, 'a.b*c')).toBe(true);
    expect(match(w, 'a.b*d')).toBe(false);
    expect(() => match(w, '( [ * \\')).not.toThrow();
  });

  describe('with a Turkish default locale', () => {
    const original = String.prototype.toLocaleLowerCase;
    afterEach(() => {
      String.prototype.toLocaleLowerCase = original;
    });
    it('still finds "Image" when typing "image"', () => {
      // In tr-TR, "I".toLocaleLowerCase() is "ı" (dotless), so "Image" becomes "ımage".
      String.prototype.toLocaleLowerCase = function (this: string) {
        return String(this).replace(/I/g, 'ı').toLowerCase();
      };
      expect(match(work({ title: 'Image analysis of tumours' }), 'image')).toBe(true);
    });
  });
});

describe('result limit choices (P5-06)', () => {
  it('snaps to the nearest available option', () => {
    expect(nearestLimit(3)).toBe(25);
    expect(nearestLimit(25)).toBe(25);
    expect(nearestLimit(60)).toBe(50);
    expect(nearestLimit(75)).toBe(100);
    expect(nearestLimit(150)).toBe(200);
    expect(nearestLimit(500)).toBe(200);
  });

  it('falls back to 100 when there is no usable limit', () => {
    expect(nearestLimit(undefined)).toBe(100);
    expect(nearestLimit(Number.NaN)).toBe(100);
  });
});

function snapshot(id: string, works: Work[] = [], name = id): Snapshot {
  return {
    id,
    name,
    query: { text: name, mode: 'topic', sources: ['europepmc'], limit: 25 },
    works,
    searchedAt: at,
    sourceResults: [],
  };
}
const workspaceWith = (snapshots: Snapshot[]): Workspace => ({
  version: 2,
  snapshots,
  activeId: snapshots[0]?.id ?? null,
});

describe('workspace capacity (P5-01)', () => {
  it('measures the fullest of storage, saved searches and publications', () => {
    const usage = workspaceUsage(
      workspaceWith(Array.from({ length: 460 }, (_, i) => snapshot(`s${i}`))),
    );
    expect(usage.fullest).toBe('snapshots');
    expect(usage.fraction).toBeCloseTo(0.92, 5);
    expect(usage.message).toContain('460 of 500');
    expect(usage.fraction).toBeGreaterThan(NEARLY_FULL);
  });

  it('is nowhere near full for a small workspace', () => {
    const usage = workspaceUsage(workspaceWith([snapshot('a', [work()])]));
    expect(usage.fraction).toBeLessThan(0.01);
  });

  it('warns only above 90% and says what to do', () => {
    const roomy = workspaceWith(Array.from({ length: 450 }, (_, i) => snapshot(`s${i}`)));
    expect(workspaceUsage(roomy).fraction).toBe(0.9);
    expect(capacityWarning(roomy)).toBeNull();
    const tight = workspaceWith(Array.from({ length: 451 }, (_, i) => snapshot(`s${i}`)));
    const warning = capacityWarning(tight)!;
    expect(warning).toContain('90% full (451 of 500 saved searches)');
    expect(warning).toMatch(/Back up your workspace/);
    expect(warning).toMatch(/export them/);
  });

  it('explains a full set of saved searches', () => {
    const full = workspaceWith(Array.from({ length: 500 }, (_, i) => snapshot(`s${i}`)));
    const extra = snapshot('new', [work()], 'New results');
    let error: unknown;
    try {
      validateWorkspace({ ...full, snapshots: [extra, ...full.snapshots] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const text = describeSaveFailure(error, full, extra);
    expect(text).toMatch(/500/);
    expect(text).toMatch(/saved searches|snapshots/i);
  });

  it('explains the publication total', () => {
    const tiny = work();
    const big = workspaceWith(
      Array.from({ length: 5 }, (_, i) => snapshot(`s${i}`, new Array<Work>(20_000).fill(tiny))),
    );
    const extra = snapshot('new', [work({ id: 'z' })], 'New results');
    const text = describeSaveFailure(new Error('Workspace is too large.'), big, extra);
    expect(text).toMatch(/100,000/);
    expect(text).toMatch(/100,001/);
  });

  it('explains the size limit with the sizes involved', () => {
    const existing = workspaceWith([
      snapshot('a', [work({ abstract: 'x'.repeat(3 * 1024 * 1024) })]),
    ]);
    const extra = snapshot(
      'new',
      [work({ id: 'b', abstract: 'y'.repeat(2 * 1024 * 1024) })],
      'New',
    );
    const text = describeSaveFailure(
      new Error('The workspace would exceed 25 MB. Back up and remove older snapshots.'),
      existing,
      extra,
    );
    expect(text).toMatch(/25 MB/);
    expect(text).toMatch(/3\.0 MB/);
    expect(text).toMatch(/2\.0 MB/);
  });

  it('keeps the record context of a field-level error', () => {
    const current = workspaceWith([snapshot('a', [work()])]);
    const extra = snapshot(
      'new',
      [work({ id: 'ok' }), work({ id: 'bad', title: 'T'.repeat(25_000) })],
      'Big title',
    );
    let error: unknown;
    try {
      validateWorkspace({ ...current, snapshots: [extra, ...current.snapshots] });
    } catch (e) {
      error = e;
    }
    const text = describeSaveFailure(error, current, extra);
    expect(text).toContain('Big title');
    expect(text).toContain('record 2');
  });
});

describe('import summary (P5-15)', () => {
  it('reports plain imports', () => {
    expect(importSummary({ kept: 3, merged: 0, ignoredColumns: [], warnings: [] })).toBe(
      'Imported 3 publications.',
    );
  });

  it('reports merged duplicates', () => {
    expect(importSummary({ kept: 5, merged: 2, ignoredColumns: [], warnings: [] })).toBe(
      'Imported 5 publications (2 duplicates merged).',
    );
    expect(importSummary({ kept: 1, merged: 1, ignoredColumns: [], warnings: [] })).toBe(
      'Imported 1 publication (1 duplicate merged).',
    );
  });

  it('lists ignored columns and warnings', () => {
    expect(
      importSummary({
        kept: 4,
        merged: 0,
        ignoredColumns: ['Funding', 'Rank'],
        warnings: ['2 values in “included” were not recognised.'],
      }),
    ).toBe(
      'Imported 4 publications. Ignored columns: Funding, Rank. 2 values in “included” were not recognised.',
    );
  });
});

describe('export file names (P5-01)', () => {
  it('builds a safe name from the snapshot name', () => {
    expect(exportFileName('Nicholas G Reich', 'json')).toBe('Nicholas-G-Reich.json');
    expect(exportFileName('a/b:c?', 'csv')).toBe('a-b-c-.csv');
    expect(exportFileName('', 'bib')).toBe('publications.bib');
  });
});

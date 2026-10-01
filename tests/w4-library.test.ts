import { describe, expect, it } from 'vitest';
import { describeSaveFailure, unsavedWork } from '../src/library';
import { MAX_WORKSPACE_BYTES, validateWorkspace, workspaceBytes } from '../src/core/workspace';
import type { Snapshot, Work, Workspace } from '../src/types';

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
function snapshot(id: string, works: Work[] = [], name = id): Snapshot {
  return {
    id,
    name,
    query: { text: name, mode: 'topic', sources: ['europepmc'], limit: 25 },
    works,
    searchedAt: '2026-09-14T15:00:00.000Z',
    sourceResults: [],
  };
}
const workspaceWith = (snapshots: Snapshot[]): Workspace => ({
  version: 2,
  snapshots,
  activeId: snapshots[0]?.id ?? null,
});
function failure(current: Workspace, added: Snapshot[]): unknown {
  try {
    validateWorkspace({ ...current, snapshots: [...added, ...current.snapshots] });
  } catch (e) {
    return e;
  }
  throw new Error('expected the workspace to be rejected');
}

describe('a failed save names every limit that blocks it (W4-02)', () => {
  it('names the saved-search limit, the size limit with the room needed, and a bad record together', () => {
    // 500 saved searches of about 51 KB: at the saved-search limit and near the 25 MB limit.
    const full = workspaceWith(
      Array.from({ length: 500 }, (_, i) =>
        snapshot(`s${i}`, [work({ id: `w${i}`, abstract: 'x'.repeat(51_000) })]),
      ),
    );
    const extra = snapshot(
      'new',
      [
        work({ id: 'a', abstract: 'y'.repeat(190_000) }),
        work({ id: 'b', abstract: 'y'.repeat(190_000) }),
        work({ id: 'c', abstract: 'y'.repeat(190_000) }),
        work({ id: 'bad', title: 'T'.repeat(25_000) }),
      ],
      'New results',
    );
    const text = describeSaveFailure(failure(full, [extra]), full, extra);
    expect(text).toContain('maximum of 500 saved searches');
    expect(text).toContain('Remove at least 1 older snapshot to make room');
    expect(text).toMatch(/25 MB/);
    expect(text).toMatch(/at least \d+\.\d MB/);
    expect(text).toContain('record 4');
    expect(text).toContain('New results');
  });

  it('says how much room is still needed', () => {
    const records = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        work({ id: `${prefix}${i}`, abstract: 'x'.repeat(200_000) }),
      );
    const nearlyFull = workspaceWith([snapshot('a', records('a', 125))]);
    const extra = snapshot('new', records('n', 11));
    const text = describeSaveFailure(failure(nearlyFull, [extra]), nearlyFull, extra);
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    const over =
      workspaceBytes({ ...nearlyFull, snapshots: [extra, ...nearlyFull.snapshots] }) -
      MAX_WORKSPACE_BYTES;
    expect(text).toContain(
      `uses ${mb(workspaceBytes(nearlyFull))} MB now and these results add about 2.1 MB`,
    );
    expect(text).toContain(`at least ${(Math.ceil((over / 1024 / 1024) * 10) / 10).toFixed(1)} MB`);
    expect(text).not.toMatch(/saved searches|record/);
  });

  it('counts several added snapshots at once, as a restored backup adds them', () => {
    const mine = workspaceWith(Array.from({ length: 300 }, (_, i) => snapshot(`m${i}`)));
    const backup = Array.from({ length: 300 }, (_, i) => snapshot(`b${i}`));
    const text = describeSaveFailure(failure(mine, backup), mine, backup);
    expect(text).toContain('maximum of 500 saved searches');
    expect(text).toContain('Remove at least 100 older snapshots to make room');
  });

  it('names the publication total with the number to remove', () => {
    const tiny = work();
    const big = workspaceWith(
      Array.from({ length: 5 }, (_, i) => snapshot(`s${i}`, new Array<Work>(20_000).fill(tiny))),
    );
    const extra = snapshot('new', [work({ id: 'z' }), work({ id: 'zz' })], 'New results');
    const text = describeSaveFailure(new Error('Workspace is too large.'), big, extra);
    expect(text).toMatch(/100,002 publications; the limit is 100,000/);
    expect(text).toMatch(/at least 2 publications/);
  });
});

describe('the description of unsaved work for the desktop shell (W4-09)', () => {
  it('is null when everything is saved', () => {
    expect(unsavedWork([], false)).toBeNull();
  });

  it('names held results and failed saves', () => {
    expect(unsavedWork(['First query'], false)).toBe(
      'Search results that could not be saved: “First query”.',
    );
    expect(unsavedWork([], true)).toBe('Changes that could not be saved.');
    expect(unsavedWork(['A', 'B'], true)).toBe(
      'Search results that could not be saved: “A”, “B”. Changes that could not be saved.',
    );
  });

  it('stays within the 500 characters the shell accepts, whatever the names', () => {
    const names = Array.from(
      { length: 40 },
      (_, i) => `${'Very long search name '.repeat(20)}${i}`,
    );
    const text = unsavedWork(names, true)!;
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toContain('and 37 more');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addTypedTags,
  describeSaveFailure,
  settleEdit,
  unsavedWork,
  type RefusedEdit,
} from '../src/library';
import { validateWorkspace } from '../src/core/workspace';
import type { Snapshot, Work, Workspace } from '../src/types';

describe('a typed tag is added or the person is told why not (W6-04)', () => {
  it('is added when the imported tags repeat one, which is kept once', () => {
    expect(addTypedTags(['Influenza, Human', 'methods', 'methods'], 'read next')).toEqual({
      next: ['Influenza, Human', 'methods', 'read next'],
      left: '',
      message: '',
    });
  });

  it('says a tag is already there instead of dropping it silently', () => {
    expect(addTypedTags(['methods', 'methods'], 'methods')).toEqual({
      next: null,
      left: '',
      message: '“methods” is already a tag.',
    });
    expect(addTypedTags(['a', 'b'], 'a, b, c')).toEqual({
      next: ['a', 'b', 'c'],
      left: '',
      message: '“a”, “b” are already tags.',
    });
  });

  it('keeps what does not fit under the 100-tag limit, and says so', () => {
    const full = Array.from({ length: 100 }, (_, i) => `tag ${i}`);
    expect(addTypedTags(full, 'one more')).toEqual({
      next: null,
      left: 'one more',
      message: 'A paper can have at most 100 tags. Remove one to add another.',
    });
    expect(addTypedTags(full.slice(1), 'x, y, z')).toEqual({
      next: [...full.slice(1), 'x'],
      left: 'y, z',
      message: 'A paper can have at most 100 tags. Remove one to add another.',
    });
  });

  it('splits on commas, trims, drops empty parts and repeats, and cuts a tag at 200 characters', () => {
    expect(addTypedTags([], ' a ,, b, a ,').next).toEqual(['a', 'b']);
    expect(addTypedTags([], 'x'.repeat(250)).next).toEqual(['x'.repeat(200)]);
    expect(addTypedTags(['a'], '  ')).toEqual({ next: null, left: '', message: '' });
  });
});

const note = (text: string): RefusedEdit => ({
  key: 's1/a',
  label: 'Paper A',
  snapshotId: 's1',
  workId: 'a',
  fields: { notes: text },
});

describe('edits the workspace refused count as unsaved work (W6-01)', () => {
  it('names them for the desktop shell', () => {
    expect(unsavedWork([], false, ['Paper A'])).toBe('Edits that could not be saved: “Paper A”.');
    expect(unsavedWork(['First query'], true, ['Paper A', 'Paper B'])).toBe(
      'Search results that could not be saved: “First query”. Edits that could not be saved: “Paper A”, “Paper B”. Changes that could not be saved.',
    );
    expect(unsavedWork([], false, [])).toBeNull();
  });

  it('stays within the 500 characters the shell accepts with every kind at once', () => {
    const names = Array.from({ length: 40 }, (_, i) => `${'Very long name '.repeat(30)}${i}`);
    const text = unsavedWork(names, true, names)!;
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toContain('Edits that could not be saved');
    expect(text).toContain('Changes that could not be saved.');
  });

  it('keeps a refused edit, merged with an earlier one for the same paper', () => {
    const tags: RefusedEdit = { ...note(''), fields: { tags: ['read next'] } };
    const list = settleEdit(settleEdit([], note('first'), false), tags, false);
    expect(list).toEqual([{ ...note(''), fields: { notes: 'first', tags: ['read next'] } }]);
    expect(settleEdit(list, note('second'), false)[0].fields).toEqual({
      notes: 'second',
      tags: ['read next'],
    });
  });

  it('clears only what a stored edit covered, and the entry once nothing is left', () => {
    const list = settleEdit(
      [],
      { ...note('long note'), fields: { notes: 'x', tags: ['y'] } },
      false,
    );
    const afterNotes = settleEdit(list, note('shorter note'), true);
    expect(afterNotes).toEqual([{ ...note(''), fields: { tags: ['y'] } }]);
    expect(settleEdit(afterNotes, { ...note(''), fields: { tags: [] } }, true)).toEqual([]);
  });

  it('drops a whole entry when an edit without fields is settled (a name, or a paper that is gone)', () => {
    const name: RefusedEdit = { key: 'name/s1', label: 'New name', snapshotId: 's1', fields: {} };
    const list = settleEdit(settleEdit([], name, false), note('kept'), false);
    expect(list.map((e) => e.key)).toEqual(['name/s1', 's1/a']);
    expect(settleEdit(list, name, true).map((e) => e.key)).toEqual(['s1/a']);
    expect(settleEdit(list, { ...note(''), fields: {} }, true).map((e) => e.key)).toEqual([
      'name/s1',
    ]);
  });

  it('returns the same list when a stored edit had nothing refused, so nothing re-renders', () => {
    const list = settleEdit([], note('kept'), false);
    expect(settleEdit(list, { ...note('x'), key: 's1/b', workId: 'b' }, true)).toBe(list);
  });
});

describe('an import too large for one saved search is told to split the file (W6-11)', () => {
  const record = (id: string): Work => ({
    id,
    title: 'T',
    authors: [],
    year: 2020,
    venue: '',
    doi: '',
    abstract: '',
    type: 'journal-article',
    url: '',
    openAccessUrl: '',
    isOpenAccess: false,
    citations: 1,
    provenance: [],
    included: true,
    notes: '',
    tags: [],
  });
  const snapshot = (
    id: string,
    works: Work[],
    sources: Snapshot['query']['sources'],
  ): Snapshot => ({
    id,
    name: id,
    query: { text: id, mode: 'topic', sources, limit: works.length },
    works,
    searchedAt: '2026-01-01T00:00:00.000Z',
    sourceResults: [],
  });
  const current: Workspace = {
    version: 2,
    snapshots: [snapshot('old', [record('o')], ['europepmc'])],
    activeId: 'old',
  };
  const reason = (added: Snapshot) => {
    let error: unknown;
    try {
      validateWorkspace({ ...current, snapshots: [added, ...current.snapshots] });
    } catch (e) {
      error = e;
    }
    return describeSaveFailure(error, current, added);
  };
  const many = Array.from({ length: 20_001 }, (_, i) => record(`w${i}`));

  it('an imported file: the limit once, and advice about the file', () => {
    const text = reason(snapshot('imported', many, []));
    expect(text.split('20,000').length - 1).toBe(1);
    expect(text).toContain('Split the file');
    expect(text).not.toContain('result limit');
  });

  it('a search keeps its advice about the result limit', () => {
    expect(reason(snapshot('searched', many, ['europepmc']))).toContain(
      'Choose a smaller result limit or a narrower search.',
    );
  });
});

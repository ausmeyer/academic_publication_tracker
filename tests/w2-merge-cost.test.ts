import { describe, expect, it, vi } from 'vitest';
import type { Work } from '../src/types';
import { mergeWorks } from '../src/core/merge';
import { nameMatch } from '../src/core/names';

// Counts the name comparisons that merging makes (the real function still answers).
vi.mock('../src/core/names', async (original) => {
  const names = await original<typeof import('../src/core/names')>();
  return { ...names, nameMatch: vi.fn(names.nameMatch) };
});

const work = (id: string, author: string): Work => ({
  id,
  title: 'Response to the letter to the editor on influenza vaccination',
  authors: [author],
  year: 2020,
  venue: '',
  doi: '',
  abstract: '',
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: null,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
});
const letters = 'abcdefghijklmnopqrstuvwxyz';

describe('W2-06 comparing author names keeps merging near-linear', () => {
  it('does not compare every pair of 1,000 different spellings that share one author key', () => {
    // "Jaa Smith", "Jab Smith" …: one key ("smith:j"), 1,000 different people.
    const records = Array.from({ length: 1000 }, (_, i) =>
      work(
        `w${i}`,
        `J${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}${'x'.repeat(Math.floor(i / 676))} Smith`,
      ),
    );
    vi.mocked(nameMatch).mockClear();
    expect(mergeWorks(records)).toHaveLength(1000);
    expect(vi.mocked(nameMatch).mock.calls.length).toBeLessThan(10_000);
  });

  it('still compares the few spellings of an ordinary duplicate', () => {
    vi.mocked(nameMatch).mockClear();
    expect(mergeWorks([work('a', 'John Smith'), work('b', 'Smith J')])).toHaveLength(1);
    expect(vi.mocked(nameMatch)).toHaveBeenCalledWith('John Smith', 'Smith J');
  });
});

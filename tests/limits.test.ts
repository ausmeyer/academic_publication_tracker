import { describe, expect, it } from 'vitest';
import { LIMITS, clampText, clampWork } from '../src/core/limits';
import { validateWorkspace } from '../src/core/workspace';
import type { Work } from '../src/types';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w1',
  title: 'A title',
  authors: ['Jane Scholar'],
  year: 2020,
  venue: 'Journal',
  doi: '10.1000/x',
  abstract: '',
  type: 'article',
  url: 'https://doi.org/10.1000/x',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 1,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
  ...overrides,
});
const workspaceWith = (works: Work[]) =>
  validateWorkspace({
    version: 2,
    activeId: 's1',
    snapshots: [
      {
        id: 's1',
        name: 'Saved search',
        query: { text: 'q', mode: 'topic', sources: ['crossref'], limit: 10 },
        works,
        searchedAt: '2026-09-30T00:00:00.000Z',
        sourceResults: [],
      },
    ],
  });

describe('clampText', () => {
  it('leaves short text alone and marks truncation with an ellipsis within the limit', () => {
    expect(clampText('abc', 5)).toBe('abc');
    expect(clampText('abcdef', 4)).toBe('abc…');
    expect(clampText('abcdef', 4)).toHaveLength(4);
  });

  it('does not split a surrogate pair', () => {
    const clamped = clampText('ab😀cd', 4);
    expect(clamped).toBe('ab…');
    expect(() => encodeURIComponent(clamped)).not.toThrow();
  });
});

describe('clampWork', () => {
  it('returns an equal record when nothing exceeds a limit', () => {
    const original = work({
      tags: ['a'],
      notes: 'n',
      citationHistory: [{ year: 2020, citations: 1, source: 'openalex' }],
    });
    expect(clampWork(original)).toEqual(original);
  });

  it('brings every oversized field inside the workspace validator limits', () => {
    const oversized = work({
      id: 'x'.repeat(LIMITS.id + 50),
      title: 't'.repeat(LIMITS.title + 50),
      authors: Array.from({ length: LIMITS.authors + 5 }, (_, i) => `Author ${i}`),
      venue: 'v'.repeat(LIMITS.venue + 50),
      abstract: 'a'.repeat(LIMITS.abstract + 50),
      snippet: 's'.repeat(LIMITS.snippet + 50),
      type: 'Journal Article, '.repeat(40),
      url: `https://example.org/${'u'.repeat(LIMITS.url)}`,
      openAccessUrl: `https://example.org/${'o'.repeat(LIMITS.url)}`,
      doi: `10.1000/${'d'.repeat(LIMITS.doi)}`,
      tags: Array.from({ length: LIMITS.tags + 5 }, (_, i) => 'tag'.repeat(100) + i),
      notes: 'n'.repeat(LIMITS.notes + 50),
      provenance: Array.from({ length: LIMITS.provenance + 5 }, (_, i) => ({
        source: 'crossref' as const,
        sourceId: `id-${i}`.padEnd(LIMITS.sourceId + 10, 'x'),
        citations: 1,
        retrievedAt: '2026-09-30T00:00:00.000Z',
        url: `https://example.org/${'p'.repeat(LIMITS.url)}`,
      })),
    });
    const clamped = clampWork(oversized);
    expect(() => workspaceWith([clamped])).not.toThrow();
    expect(clamped.type.length).toBeLessThanOrEqual(LIMITS.type);
    expect(clamped.authors).toHaveLength(LIMITS.authors);
    expect(clamped.authorsComplete).toBe(false);
    expect(clamped.url).toBe('');
    expect(clamped.doi).toBe('');
    expect(clamped.provenance).toHaveLength(LIMITS.provenance);
  });

  it('keeps authorsComplete untouched when authors are not truncated', () => {
    expect(clampWork(work({ authorsComplete: true })).authorsComplete).toBe(true);
    expect('authorsComplete' in clampWork(work())).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Count the calls of the expensive name parser/matcher instead of timing them.
vi.mock('../src/core/names', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/names')>();
  return { ...actual, nameMatch: vi.fn(actual.nameMatch) };
});
const { nameMatch } = await import('../src/core/names');
const { analyzeInsights } = await import('../src/core/insights');
const { settings, work } = await import('./insights-helpers');
const calls = () => vi.mocked(nameMatch).mock.calls.length;

describe('author-name matching work', () => {
  let seed = 1;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  // 200,000 bylines, nearly all different strings, which defeats any per-name cache.
  const works = Array.from({ length: 20000 }, (_, i) =>
    work(`p${i}`, {
      authors: Array.from(
        { length: 10 },
        (_, k) =>
          `Name${Math.floor(random() * 500)} ${String.fromCharCode(65 + k)} Surname${Math.floor(random() * 500)}`,
      ),
    }),
  );
  works[17].authors[4] = 'Austin G Meyer';
  const config = settings({
    author: 'Austin G Meyer',
    aliases: ['AG Meyer', 'Meyer AG', 'A Meyer'],
  });
  beforeEach(() => {
    vi.mocked(nameMatch).mockClear();
  });

  it('compares only the bylines that could name the author', () => {
    const result = analyzeInsights(works, config, 'all');
    expect(result.classified).toBe(1);
    expect(calls()).toBeGreaterThan(0);
    expect(calls()).toBeLessThanOrEqual(4);
  });

  it('does not compare a byline again when the analysis is repeated', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      work(`m${i}`, { authors: [`Coauthor ${i}`, i % 2 ? 'Meyer AG' : `A G Meyer ${i}`] }),
    );
    analyzeInsights(many, config, 'all');
    expect(calls()).toBeGreaterThan(250);
    vi.mocked(nameMatch).mockClear();
    analyzeInsights(many, { ...config, lensConvention: true, yearFrom: 2000 }, 'all');
    expect(calls()).toBe(0);
  });

  it('does no name work at all while no author is chosen', () => {
    const result = analyzeInsights(works, settings({ author: '', aliases: ['AG Meyer'] }), 'all');
    expect(result.classified).toBe(0);
    expect(calls()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { settings, work } from './insights-helpers';

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Coauthor ${String.fromCharCode(65 + i)}`);
const at = (position: number, total: number) => {
  const authors = filler(total);
  authors[position] = 'Jane Scholar';
  return authors;
};
const row = (authors: string[], extra: Record<string, unknown> = {}, lens = false) =>
  analyzeInsights(
    [work('x', { authors, citations: 100, ...extra })],
    settings({ lensConvention: lens }),
    'all',
  ).rows[0];

describe('authorship weights (docs/LOCAL_INSIGHTS.md)', () => {
  it.each([
    ['a sole author', ['Jane Scholar'], 'sole', 1],
    ['a first author', at(0, 4), 'first', 0.9],
    ['a second author of three', at(1, 3), 'second', 0.5],
    ['a middle author of four', at(2, 4), 'middle', 0.25],
    ['a last author of three', at(2, 3), 'last', 0.25],
    ['a middle author of six', at(2, 6), 'middle', 0.25],
    ['a middle author of seven', at(2, 7), 'middle', 0.1],
    ['a last author of seven', at(6, 7), 'last', 0.1],
  ])('gives %s its published weight', (_label, authors, role, weight) => {
    const result = row(authors);
    expect(result.role).toBe(role);
    expect(result.weight).toBe(weight);
    expect(result.adjusted).toBe(100 * weight);
  });

  it('weights a last author fully only under the last-author convention', () => {
    expect(row(at(3, 4), {}, true)).toMatchObject({ role: 'last', weight: 1 });
    expect(row(at(3, 4))).toMatchObject({ role: 'last', weight: 0.25 });
    expect(row(at(1, 4), {}, true)).toMatchObject({ role: 'second', weight: 0.5 });
  });

  it('weights a confirmed corresponding author fully', () => {
    const annotated = analyzeInsights(
      [work('x', { authors: at(2, 8), citations: 100 })],
      settings({
        annotations: [
          { key: '10.1234/x', authors: at(2, 8), complete: true, role: 'corresponding' },
        ],
      }),
      'all',
    ).rows[0];
    expect(annotated).toMatchObject({ role: 'corresponding', weight: 1 });
  });

  // Decision D7: the weights are not changed; these two rules are documented instead.
  it('classifies the second author of a complete two-author paper as last, with the other-role weight', () => {
    expect(row(at(1, 2))).toMatchObject({ role: 'last', weight: 0.25 });
    expect(row(at(1, 2), {}, true)).toMatchObject({ role: 'last', weight: 1 });
  });

  it('puts a team of exactly six authors in the 25% tier', () => {
    expect(row(at(3, 6)).weight).toBe(0.25);
    expect(row(at(3, 7)).weight).toBe(0.1);
  });

  it('keeps a known second position in a shortened list as a second author', () => {
    expect(row(at(1, 2), { authorsComplete: false })).toMatchObject({
      role: 'second',
      weight: 0.5,
    });
  });
});

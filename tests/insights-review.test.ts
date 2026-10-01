import { describe, expect, it } from 'vitest';
import { analyzeInsights, reviewRows } from '../src/core/insights';
import { settings, work } from './insights-helpers';

describe('papers that need an author-identity review', () => {
  const works = [
    work('unmatched', { authors: ['Someone Else', 'Alex Other'] }),
    work('exact', { authors: ['Jane Scholar', 'Alex Other'] }),
    work('initial', { authors: ['J Scholar', 'Alex Other'] }),
    work('confirmed', { authors: ['J. Scholar', 'Alex Other'] }),
    work('ambiguous', { authors: ['Jane Scholar', 'J Scholar'] }),
  ];
  const config = settings({
    annotations: [
      {
        key: '10.1234/confirmed',
        authors: ['J. Scholar', 'Alex Other'],
        complete: true,
        role: 'first',
      },
    ],
  });
  const analysis = analyzeInsights(works, config, 'all');

  it('lists initial-only matches before unclassified papers and leaves the rest out', () => {
    expect(reviewRows(analysis).map((r) => r.work.id)).toEqual([
      'initial',
      'unmatched',
      'ambiguous',
    ]);
  });

  it('agrees with the count of initial-only matches shown in the summary', () => {
    expect(analysis.initialMatches).toBe(1);
    expect(reviewRows(analysis).filter((r) => r.role !== 'unclassified')).toHaveLength(
      analysis.initialMatches,
    );
  });

  it('is empty when nothing needs review', () => {
    const clean = analyzeInsights([works[1]], config, 'all');
    expect(reviewRows(clean)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateMetrics } from '../src/core/metrics';
import { work } from './insights-helpers';

const venues = (names: string[]) =>
  calculateMetrics(
    names.map((venue, i) => work(`v${i}`, { venue })),
    'all',
    2026,
  ).topVenues;

describe('leading venues', () => {
  it('counts venue spellings that differ only by case or spacing together', () => {
    const top = venues(['PLoS ONE', 'PLOS ONE', 'PLoS One', 'Plos One ', 'PLoS  ONE']);
    expect(top).toHaveLength(1);
    expect(top[0].count).toBe(5);
  });

  it('shows the most frequent spelling of a venue', () => {
    expect(venues(['Nature', 'nature', 'nature'])).toEqual([{ name: 'nature', count: 3 }]);
  });

  it('picks the same spelling whatever the input order when counts tie', () => {
    const a = venues(['PLoS computational biology', 'PLoS Computational Biology']);
    const b = venues(['PLoS Computational Biology', 'PLoS computational biology']);
    expect(a).toEqual([{ name: 'PLoS Computational Biology', count: 2 }]);
    expect(b).toEqual(a);
  });

  it('merges the case variants of a real result set into one row of six', () => {
    const top = venues([
      ...Array<string>(3).fill('PLoS computational biology'),
      ...Array<string>(3).fill('PLoS Computational Biology'),
      'Bioinformatics',
    ]);
    expect(top).toEqual([
      { name: 'PLoS Computational Biology', count: 6 },
      { name: 'Bioinformatics', count: 1 },
    ]);
  });

  it('merges compatibility forms such as ligatures and non-breaking spaces', () => {
    const top = venues(['Scientific Reports', 'Scienti\uFB01c Reports', 'Scientific\u00A0Reports']);
    expect(top).toHaveLength(1);
    expect(top[0].count).toBe(3);
  });

  it('keeps ranking by count, then name, and ignores blank venues', () => {
    const top = venues(['B', 'B', 'A', 'A', 'C', 'C', 'C', '', '   ']);
    expect(top).toEqual([
      { name: 'C', count: 3 },
      { name: 'A', count: 2 },
      { name: 'B', count: 2 },
    ]);
  });

  it('still returns the eight leading venues', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Journal ${String.fromCharCode(65 + i)}`);
    expect(venues(many)).toHaveLength(8);
  });
});

describe('headline metrics against their definitions', () => {
  // Reference implementations written straight from the definitions.
  const refH = (c: number[]) => {
    let best = 0;
    for (let h = 1; h <= c.length; h++) if (c.filter((x) => x >= h).length >= h) best = h;
    return best;
  };
  const refG = (c: number[]) => {
    const sorted = [...c].sort((a, b) => b - a);
    let best = 0;
    for (let g = 1; g <= sorted.length; g++)
      if (sorted.slice(0, g).reduce((a, b) => a + b, 0) >= g * g) best = g;
    return best;
  };
  const refMedian = (c: number[]) => {
    if (!c.length) return 0;
    const sorted = [...c].sort((a, b) => a - b);
    const n = sorted.length;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  };
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const int = (n: number) => Math.floor(random() * n);

  it('matches h, g, i10, median, citations per year and annualised h on random sets', () => {
    for (let trial = 0; trial < 1500; trial++) {
      const works = Array.from({ length: int(25) }, (_, i) =>
        work(`p${i}`, {
          citations: random() < 0.25 ? null : random() < 0.3 ? 0 : int(random() < 0.2 ? 500 : 15),
          year: random() < 0.15 ? null : 2000 + int(30),
          included: random() < 0.9,
        }),
      );
      const included = works.filter((w) => w.included);
      const known = included.flatMap((w) => (w.citations === null ? [] : [w.citations]));
      const padded = [...known, ...Array<number>(included.length - known.length).fill(0)];
      const dated = included.flatMap((w) => (w.year === null ? [] : [w.year]));
      const span = dated.length && Math.min(...dated) <= 2026 ? 2026 - Math.min(...dated) + 1 : 0;
      const citations = known.reduce((a, b) => a + b, 0);
      const m = calculateMetrics(works, 'all', 2026);
      expect(m).toMatchObject({
        papers: included.length,
        citations,
        citationCoverage: known.length,
        hIndex: refH(padded),
        gIndex: refG(padded),
        i10Index: known.filter((x) => x >= 10).length,
        medianCitations: refMedian(known),
      });
      expect(m.citationsPerYear).toBeCloseTo(span ? citations / span : 0, 12);
      expect(m.annualizedH).toBeCloseTo(span ? refH(padded) / span : 0, 12);
    }
  });
});

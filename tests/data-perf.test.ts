import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { carryForwardCuration } from '../src/core/curation';
import { importWorks } from '../src/core/formats';
import { mergeWorks } from '../src/core/merge';

// Thresholds are generous so that a busy machine does not make these flaky: the fixed code needs a
// few milliseconds to ~150 ms, while the original needed tens of seconds (or minutes) for the same
// inputs. A synchronous run cannot be interrupted, so each test also gets a long timeout.
const SLOW = { timeout: 300_000 };
const LIMIT = 10_000;
const elapsed = (run: () => unknown) => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe('P2-02 a long run of whitespace is scanned once, not once per position', () => {
  const RUN = 200_000;
  const spaces = ' '.repeat(RUN);

  it(
    'splits author and tag text containing a 200,000-space run in JSON, CSV and TSV fields',
    SLOW,
    () => {
      expect(
        elapsed(() =>
          importWorks(JSON.stringify([{ title: 'T', authors: `A${spaces}B` }]), 'x.json'),
        ),
      ).toBeLessThan(LIMIT);
      expect(
        elapsed(() => importWorks(JSON.stringify([{ title: 'T', tags: `A${spaces}B` }]), 'x.json')),
      ).toBeLessThan(LIMIT);
      expect(
        elapsed(() => importWorks(`Title,Authors\n"T","A${spaces}B"\n`, 'x.csv')),
      ).toBeLessThan(500);
      expect(
        elapsed(() => importWorks(`Title\tAuthors\tNotes\nT\tA${spaces}B\t${spaces}\n`, 'x.tsv')),
      ).toBeLessThan(LIMIT);
    },
  );

  it(
    'reads BibTeX author, keyword, title and abstract fields containing huge runs of whitespace',
    SLOW,
    () => {
      const entry = (field: string, value: string) => `@article{a, title={T}, ${field}={${value}}}`;
      for (const [field, value] of [
        ['author', `Doe, Jane${spaces}x`],
        ['author', `Doe, Jane${spaces}and${spaces}Roe, Rick`],
        ['keywords', `A${spaces}B`],
        ['title', `A${spaces}B`],
        ['abstract', `A${'\n  '.repeat(300_000)}B`],
        ['abstract', `A${'\n'.repeat(RUN)}B`],
      ])
        expect(elapsed(() => importWorks(entry(field, value), 'x.bib'))).toBeLessThan(LIMIT);
    },
  );

  it('still splits authors on "and" and semicolons around long runs of spaces', SLOW, () => {
    const gap = ' '.repeat(50_000);
    const [paper] = importWorks(
      JSON.stringify([{ title: 'T', authors: `Jane Doe${gap}and${gap}Rick Roe;${gap}Sam Poe` }]),
      'x.json',
    );
    expect(paper.authors).toEqual(['Jane Doe', 'Rick Roe', 'Sam Poe']);
    const [bib] = importWorks(
      `@article{a, title={T}, author={Doe, Jane${gap}and${gap}Roe, Rick}}`,
      'x.bib',
    );
    expect(bib.authors).toEqual(['Doe, Jane', 'Roe, Rick']);
  });

  it('drops hundreds of thousands of trailing line breaks without rescanning them', SLOW, () => {
    const csv = `Title,Year\nA paper,2020${'\n'.repeat(RUN)}`;
    expect(elapsed(() => expect(importWorks(csv, 'x.csv')).toHaveLength(1))).toBeLessThan(LIMIT);
    const blank = `Title,Year\n${'\n'.repeat(RUN)}A paper,2020\n`;
    expect(elapsed(() => importWorks(blank, 'x.csv'))).toBeLessThan(LIMIT);
  });
});

describe('P2-13 merging degenerate input stays near-linear', () => {
  const work = (overrides: Partial<Work> = {}): Work => ({
    id: 'w',
    title: 'A longitudinal study of scientific collaboration',
    authors: ['Austin Meyer'],
    year: 2020,
    venue: 'J',
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
    ...overrides,
  });

  it('merges 4,000 DOI-less records with one title into one record', SLOW, () => {
    const records = Array.from({ length: 4000 }, (_, i) => work({ id: `c${i}` }));
    let merged: Work[] = [];
    expect(elapsed(() => (merged = mergeWorks(records)))).toBeLessThan(LIMIT);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('c0');
  });

  it(
    'keeps 4,000 different DOIs with one title apart, and 2,000 DOI-less lookalikes apart too',
    SLOW,
    () => {
      const records = [
        ...Array.from({ length: 4000 }, (_, i) => work({ id: `c${i}`, doi: `10.1234/${i}` })),
        ...Array.from({ length: 2000 }, (_, i) => work({ id: `n${i}` })),
      ];
      let merged: Work[] = [];
      expect(elapsed(() => (merged = mergeWorks(records)))).toBeLessThan(LIMIT);
      // The lookalikes could belong to any of the 4,000 DOIs, so they only merge with each other.
      expect(merged).toHaveLength(4001);
    },
  );

  it('merges 20,000 records of one DOI with different provenance', SLOW, () => {
    const records = Array.from({ length: 20_000 }, (_, i) =>
      work({
        id: `d${i}`,
        doi: '10.1234/same',
        citations: i,
        provenance: [
          { source: 'openalex', sourceId: `W${i}`, citations: i, retrievedAt: `t${i}`, url: '' },
        ],
      }),
    );
    let merged: Work[] = [];
    expect(elapsed(() => (merged = mergeWorks(records)))).toBeLessThan(LIMIT);
    expect(merged).toHaveLength(1);
    expect(merged[0].citations).toBe(19_999);
    expect(merged[0].provenance.length).toBeLessThanOrEqual(100);
    expect(merged[0].provenance.some((p) => p.citations === 19_999)).toBe(true);
  });

  it('merges a 20,000-record chain of shared provider records', SLOW, () => {
    const records = Array.from({ length: 20_000 }, (_, i) =>
      work({
        id: `e${i}`,
        title: `Chain title ${i} with padding text`,
        provenance: [
          { source: 'europepmc', sourceId: `P${i}`, citations: null, retrievedAt: '', url: '' },
          { source: 'europepmc', sourceId: `P${i + 1}`, citations: null, retrievedAt: '', url: '' },
        ],
      }),
    );
    let merged: Work[] = [];
    expect(elapsed(() => (merged = mergeWorks(records)))).toBeLessThan(LIMIT);
    expect(merged).toHaveLength(1);
  });

  it('merges 300 records that each list the same 1,000 authors', SLOW, () => {
    const authors = Array.from({ length: 1000 }, (_, i) => `First${i} Last${i}`);
    const records = Array.from({ length: 300 }, (_, i) => work({ id: `w${i}`, authors }));
    let merged: Work[] = [];
    expect(elapsed(() => (merged = mergeWorks(records)))).toBeLessThan(LIMIT);
    expect(merged).toHaveLength(1);
    expect(merged[0].authors).toHaveLength(1000);
  });

  it(
    'is still fast for ordinary data: 20,000 distinct DOIs and 20,000 distinct titles',
    SLOW,
    () => {
      const byDoi = Array.from({ length: 20_000 }, (_, i) =>
        work({ id: `a${i}`, doi: `10.1234/${i}`, title: `Distinct title number ${i} about topic` }),
      );
      const byTitle = Array.from({ length: 20_000 }, (_, i) =>
        work({
          id: `b${i}`,
          title: `Distinct title number ${i} about topic`,
          authors: [`Author${i} Name${i}`],
        }),
      );
      let first: Work[] = [];
      let second: Work[] = [];
      expect(elapsed(() => (first = mergeWorks(byDoi)))).toBeLessThan(LIMIT);
      expect(elapsed(() => (second = mergeWorks(byTitle)))).toBeLessThan(LIMIT);
      expect(first.map((w) => w.id)).toEqual(byDoi.map((w) => w.id));
      expect(second).toHaveLength(20_000);
    },
  );

  it('carries curation across 2,000 identical-title records without blowing up', SLOW, () => {
    const previous = Array.from({ length: 2000 }, (_, i) => work({ id: `p${i}`, included: false }));
    const fresh = Array.from({ length: 2000 }, (_, i) => work({ id: `f${i}` }));
    let result: Work[] = [];
    expect(elapsed(() => (result = carryForwardCuration(fresh, previous)))).toBeLessThan(LIMIT);
    // Every fresh record matches every old one: nothing can be carried unambiguously.
    expect(result.every((w) => w.included)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { exportWorks, importWorksWithReport } from '../src/core/formats';
import { LIMITS } from '../src/core/limits';
import { validateWorkspace } from '../src/core/workspace';
import { cleanPublicationTypes } from '../src/core/worktype';

const retrievedAt = '2026-09-01T00:00:00.000Z';
const link = (letter: string) => `https://example.org/${letter.repeat(LIMITS.url - 20)}`;

/** A record with every field at the workspace limit. */
const atLimits = (): Work => ({
  id: 'i'.repeat(LIMITS.id),
  title: 'T'.repeat(LIMITS.title),
  authors: Array.from({ length: LIMITS.authors }, (_, i) =>
    i === 0 ? 'A'.repeat(LIMITS.authorName) : `Author ${i}`,
  ),
  authorsComplete: true,
  citationHistory: Array.from({ length: LIMITS.citationHistory }, (_, i) => ({
    year: 1000 + (i % 2000),
    citations: i,
    source: 'openalex' as const,
  })),
  year: 2020,
  venue: 'V'.repeat(LIMITS.venue),
  doi: `10.1234/${'d'.repeat(LIMITS.doi - 8)}`,
  abstract: 'B'.repeat(LIMITS.abstract),
  snippet: 'S'.repeat(LIMITS.snippet),
  type: 'Y'.repeat(LIMITS.type),
  url: link('u'),
  openAccessUrl: link('o'),
  isOpenAccess: true,
  citations: 7,
  provenance: Array.from({ length: LIMITS.provenance }, (_, i) => ({
    source: 'openalex' as const,
    sourceId: `${i}`.padEnd(LIMITS.sourceId, 'W'),
    citations: 7,
    retrievedAt,
    url: link('p'),
  })),
  included: false,
  tags: Array.from({ length: LIMITS.tags }, (_, i) => `${i}`.padEnd(LIMITS.tag, 'g')),
  notes: 'N'.repeat(LIMITS.notes),
});

describe('W2-09 import keeps every value the workspace accepts', () => {
  it('the record at the limits is a valid workspace record', () => {
    const snapshot = {
      id: 's',
      name: 's',
      query: { text: 'x', mode: 'topic' as const, sources: [], limit: 1 },
      works: [atLimits()],
      searchedAt: retrievedAt,
      sourceResults: [],
    };
    expect(() =>
      validateWorkspace({ version: 2, activeId: 's', snapshots: [snapshot] }),
    ).not.toThrow();
  });

  it.each(['json', 'csv'] as const)(
    'returns a record at the limits unchanged from %s',
    (format) => {
      const work = atLimits();
      const report = importWorksWithReport(exportWorks([work], format), `x.${format}`);
      expect(report.warnings).toEqual([]);
      expect(report.works).toHaveLength(1);
      const [back] = report.works;
      for (const field of Object.keys(work) as Array<keyof Work>)
        expect({ field, value: back[field] }).toEqual({ field, value: work[field] });
      expect(back).toEqual(work);
    },
  );

  it('keeps the long publication types built for PubMed records and long abstracts', () => {
    const type = cleanPublicationTypes([
      'Review',
      'Journal Article',
      'Comparative Study',
      'Validation Study',
      'Multicenter Study',
      'Randomized Controlled Trial',
      'Observational Study',
      'Systematic Review',
    ]);
    expect(type.length).toBeGreaterThan(100);
    const work = { ...atLimits(), type, abstract: 'x'.repeat(150_000), title: 'T'.repeat(15_000) };
    const [back] = importWorksWithReport(exportWorks([work], 'json'), 'x.json').works;
    expect(back.type).toBe(type);
    expect(back.abstract).toBe(work.abstract);
    expect(back.title).toBe(work.title);
  });
});

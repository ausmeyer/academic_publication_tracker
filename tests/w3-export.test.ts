import { describe, expect, it } from 'vitest';
import { analyzeInsights, exportInsights } from '../src/core/insights';
import { INSIGHTS_LIMITS } from '../src/core/insights-data';
import { MAX_WORKSPACE_BYTES, validateWorkspace, workspaceBytes } from '../src/core/workspace';
import type { InsightsSettings, Snapshot } from '../src/types';
import { settings, work } from './insights-helpers';

const bytes = (text: string) => new TextEncoder().encode(text).length;
const authors = [
  'Nicholas G Reich',
  'Evan L Ray',
  'Johannes Bracher',
  'Tilmann Gneiting',
  'Sasi Kandula',
];
const works = Array.from({ length: 20000 }, (_, i) =>
  work(`p${i}`, {
    title: `A reasonably long publication title about forecasting number ${i}`,
    authors,
    year: 1990 + (i % 36),
    venue: `Journal ${i % 500}`,
    citations: i % 300,
    provenance: [
      {
        source: 'openalex',
        sourceId: `W${i}`,
        citations: i % 300,
        retrievedAt: '2026-01-01',
        url: '',
      },
    ],
  }),
);
const annualCitations = Array.from({ length: INSIGHTS_LIMITS.annualCitations }, (_, k) => ({
  key: `10.1234/p${k % 20000}`,
  year: 1990 + Math.floor(k / 20000),
  citations: k % 50,
  source: 'scholar' as const,
}));
const journalRanks = Array.from({ length: INSIGHTS_LIMITS.journalRanks }, (_, k) => ({
  venue: `Journal ${k % 500}`,
  year: 1980 + Math.floor(k / 500),
  category: 'Medicine',
  quartile: 'Q1' as const,
  source: 'SJR',
}));
const exported = (config: InsightsSettings) => {
  const snapshot: Snapshot = {
    id: 's',
    name: 'Nicholas G Reich',
    query: { text: 'Nicholas G Reich', mode: 'author', sources: ['openalex'], limit: 200 },
    works,
    searchedAt: '2026-09-01T00:00:00Z',
    sourceResults: [{ source: 'openalex', total: works.length }],
    insights: config,
  };
  const saved = workspaceBytes(
    validateWorkspace({ version: 2, snapshots: [snapshot], activeId: 's' }),
  );
  const text = exportInsights(analyzeInsights(works, config, 'all', 2026), config, 'all', 'json', {
    snapshot,
  });
  return { saved, size: bytes(text), text };
};

describe('the size of the Insights JSON export', () => {
  it('stays clearly below the 25 MB export limit for 20,000 papers, 100,000 annual counts and 20,000 rankings', () => {
    const { size } = exported(
      settings({ author: 'Nicholas G Reich', annualCitations, journalRanks }),
    );
    expect(size).toBeLessThan(0.6 * MAX_WORKSPACE_BYTES);
  });

  it('fits whenever the workspace itself can be saved, with every Insights list at its limit', () => {
    const config = settings({
      author: 'Nicholas G Reich',
      aliases: Array.from({ length: INSIGHTS_LIMITS.aliases }, (_, k) => `Reich N ${k}`),
      annualCitations,
      journalRanks,
      annotations: works.map((w) => ({ key: w.doi, authors, complete: true })),
      retractions: Array.from({ length: INSIGHTS_LIMITS.retractions }, (_, k) => ({
        doi: `10.1234/p${k}`,
        status: 'Retraction',
        reason: 'Error in analysis; duplicated image',
        date: '2025-01-01',
        source: `Retraction Watch ${k}`,
      })),
    });
    const { saved, size, text } = exported(config);
    expect(saved).toBeLessThanOrEqual(MAX_WORKSPACE_BYTES);
    expect(size).toBeLessThan(saved);
    expect(JSON.parse(text).analysis.rows).toHaveLength(20000);
    // It builds and parses a 20,000-paper export: give it room when the machine is busy.
  }, 60_000);
});

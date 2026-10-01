import { describe, expect, it } from 'vitest';
import { analyzeInsights, exportInsights } from '../src/core/insights';
import { MAX_WORKSPACE_BYTES, validateWorkspace, workspaceBytes } from '../src/core/workspace';
import type { Snapshot } from '../src/types';
import { settings, work } from './insights-helpers';

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('retraction notices in the Insights JSON export', () => {
  it('are written once, in the settings, and still counted in the summary', () => {
    const notice = {
      doi: '10.1234/one',
      status: 'Retraction',
      reason: 'A reason written only once',
      date: '2025-01-01',
      source: 'Test',
    };
    const config = settings({ retractions: [notice] });
    const text = exportInsights(
      analyzeInsights([work('one')], config, 'all'),
      config,
      'all',
      'json',
    );
    expect(text.split('A reason written only once')).toHaveLength(2);
    const parsed = JSON.parse(text);
    expect(parsed.settings.retractions).toEqual([notice]);
    expect(parsed.analysis.retracted).toBe(1);
  });

  it('keep the export within the limit whenever the workspace itself can be saved', () => {
    // 3,000 long notices: a workspace of about 15 MB, which wrote an export of 30 MB.
    const works = Array.from({ length: 3000 }, (_, i) => work(`p${i}`));
    const config = settings({
      retractions: works.map((w, k) => ({
        doi: w.doi,
        status: 'Retraction',
        reason: `Reason ${k}: ${'x'.repeat(4990)}`,
        date: '2025-01-01',
        source: 'Retraction Watch',
      })),
    });
    const snapshot: Snapshot = {
      id: 's',
      name: 'Big',
      query: { text: 'x', mode: 'topic', sources: [], limit: 10 },
      works,
      searchedAt: '2026-09-01T00:00:00Z',
      sourceResults: [],
      insights: config,
    };
    const saved = workspaceBytes(
      validateWorkspace({ version: 2, snapshots: [snapshot], activeId: 's' }),
    );
    const size = bytes(
      exportInsights(analyzeInsights(works, config, 'all', 2026), config, 'all', 'json', {
        snapshot,
      }),
    );
    expect(saved).toBeLessThanOrEqual(MAX_WORKSPACE_BYTES);
    expect(size).toBeLessThan(saved);
  });
});

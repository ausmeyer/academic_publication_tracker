import { beforeEach, describe, expect, it, vi } from 'vitest';

// Count the title work instead of timing it.
vi.mock('../src/core/merge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/merge')>();
  return { ...actual, titleKey: vi.fn(actual.titleKey), mergeWorks: vi.fn(actual.mergeWorks) };
});
const { mergeWorks, titleKey } = await import('../src/core/merge');
const { carryInsights, paperKey } = await import('../src/core/insights-data');
const { settings, work } = await import('./insights-helpers');

const prov = (source: 'arxiv' | 'scholar' | 'crossref', sourceId: string) => ({
  source,
  sourceId,
  citations: 5,
  retrievedAt: '2026-09-01T00:00:00Z',
  url: '',
});
const reviews = (works: ReturnType<typeof work>[]) =>
  settings({
    annotations: works.map((w) => ({
      key: paperKey(w),
      authors: ['Jane Scholar'],
      complete: true,
    })),
  });

describe('the title fallback of carryInsights', () => {
  beforeEach(() => {
    vi.mocked(titleKey).mockClear();
    vi.mocked(mergeWorks).mockClear();
  });

  it('does no title work while every paper is found by an identifier', () => {
    const previous = Array.from({ length: 2000 }, (_, i) =>
      work(`p${i}`, { id: `arxiv:${i}v1`, doi: '', provenance: [prov('arxiv', `${i}v1`)] }),
    );
    const fresh = previous.map((w, i) => ({
      ...w,
      id: `arxiv:${i}`,
      provenance: [prov('arxiv', `${i}v2`)],
    }));
    carryInsights(reviews(previous), previous, fresh);
    expect(vi.mocked(titleKey)).not.toHaveBeenCalled();
    expect(vi.mocked(mergeWorks)).not.toHaveBeenCalled();
  });

  it('merges each paper found only by its title once, with its one candidate', () => {
    const previous = Array.from({ length: 2000 }, (_, i) =>
      work(`s${i}`, {
        id: `scholar:${i}`,
        doi: '',
        title: `A study of seasonal influenza forecasting number ${i}`,
        provenance: [prov('scholar', `${i}`)],
      }),
    );
    const fresh = previous.map((w, i) => ({
      ...w,
      id: `crossref:10.8888/${i}`,
      doi: `10.8888/${i}`,
      provenance: [prov('crossref', `10.8888/${i}`)],
    }));
    const carried = carryInsights(reviews(previous), previous, fresh);
    expect(carried.annotations.map((r) => r.key)).toEqual(fresh.map(paperKey));
    expect(vi.mocked(mergeWorks)).toHaveBeenCalledTimes(2000);
    for (const [records] of vi.mocked(mergeWorks).mock.calls) expect(records).toHaveLength(2);
    // One key per fresh record for the index, one per previous record to look it up.
    expect(vi.mocked(titleKey)).toHaveBeenCalledTimes(4000);
  });
});

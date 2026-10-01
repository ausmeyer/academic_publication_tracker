import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, MAX_RESPONSE_BYTES, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse } from '../src/types';

// A sentinel instead of the real version, so a User-Agent with a hard-coded version fails below.
vi.mock('../src/version', () => ({ APP_VERSION: '0.0.0-sentinel' }));

const query = (changes: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'viral evolution',
  mode: 'topic',
  sources: ['crossref'],
  limit: 10,
  ...changes,
});
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const item = (id: number) => ({
  DOI: `10.1234/paper${id}`,
  title: [`Paper ${id}`],
  type: 'journal-article',
  published: { 'date-parts': [[2023]] },
});
const page = (from: number, count: number) =>
  json({
    message: {
      'total-results': 1000,
      items: Array.from({ length: count }, (_, i) => item(from + i)),
    },
  });
const empty = () => json({ message: { 'total-results': 0, items: [] } });
let clock = new Date('2026-10-04T12:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  clock += 300000;
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function finish(promise: Promise<SearchResponse>) {
  await vi.runAllTimersAsync();
  return promise;
}

describe('transport', () => {
  it('uses an injected fetch for every provider request, including combined searches', async () => {
    const injected = vi.fn(async (url: URL | string) => {
      const host = new URL(String(url)).hostname;
      if (host === 'export.arxiv.org')
        return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
      if (host === 'www.ebi.ac.uk') return json({ hitCount: 0, resultList: { result: [] } });
      if (host === 'api.datacite.org') return json({ meta: { total: 0 }, data: [] });
      return empty();
    });
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const response = await finish(
      searchSources(query({ sources: ['preprints', 'datacite'] }), DEFAULT_SETTINGS, {
        fetch: injected as unknown as typeof fetch,
      }),
    );
    expect(response.results.every((result) => !result.error)).toBe(true);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(new Set(injected.mock.calls.map(([url]) => new URL(String(url)).hostname))).toEqual(
      new Set(['export.arxiv.org', 'www.ebi.ac.uk', 'api.crossref.org', 'api.datacite.org']),
    );
    const init = injected.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init[1].redirect).toBe('error');
    expect(init[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to the global fetch when none is injected', async () => {
    const globalFetch = vi.fn(async () => empty());
    vi.stubGlobal('fetch', globalFetch);
    await finish(searchSources(query(), DEFAULT_SETTINGS, {}));
    await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(globalFetch).toHaveBeenCalledTimes(2);
  });

  it('identifies itself with the current application version', async () => {
    const fetcher = vi.fn(async () => empty());
    vi.stubGlobal('fetch', fetcher);
    await finish(searchSources(query(), DEFAULT_SETTINGS));
    const init = fetcher.mock.calls[0] as unknown as [unknown, { headers: Record<string, string> }];
    expect(init[1].headers['User-Agent']).toBe('AcademicPublicationTracker/0.0.0-sentinel');
  });

  it.each(['soon', 'Thu, not a date', ''])(
    'retries a 503 once after the default wait when Retry-After is unusable (%j)',
    async (retryAfter) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(json({}, 503, retryAfter ? { 'retry-after': retryAfter } : {}))
        .mockResolvedValueOnce(page(0, 2));
      vi.stubGlobal('fetch', fetcher);
      const { results } = await finish(searchSources(query(), DEFAULT_SETTINGS));
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(results[0].error).toBeUndefined();
      expect(results[0].works).toHaveLength(2);
    },
  );

  it('does not retry a 503 that asks for a long wait', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, 503, { 'retry-after': '120' }));
    vi.stubGlobal('fetch', fetcher);
    const { results } = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results[0].error).toContain('temporarily unavailable');
  });
});

describe('response size cap', () => {
  const oversized = (bytes: number, onCancel: () => void) => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let sent = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= bytes) return controller.close();
          controller.enqueue(chunk);
          sent += chunk.byteLength;
        },
        cancel: onCancel,
      }),
    );
  };

  it('rejects a provider body that is declared larger than the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 200, { 'content-length': String(MAX_RESPONSE_BYTES + 1) })),
    );
    const { results } = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(results[0].error).toMatch(/too large/);
    expect(results[0].works).toEqual([]);
  });

  it('stops reading a streamed body once it passes the cap', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        oversized(MAX_RESPONSE_BYTES + 2 * 1024 * 1024, () => {
          cancelled = true;
        }),
      ),
    );
    const { results } = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(results[0].error).toMatch(/too large/);
    expect(cancelled).toBe(true);
  });

  it('allows the largest pages real providers send (tens of megabytes of authors and references)', () => {
    expect(MAX_RESPONSE_BYTES).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  });
});

describe('pacing and deadlines follow a monotonic clock', () => {
  it('keeps searching after the wall clock is stepped back ten minutes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => empty()),
    );
    const first = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(first.results[0].error).toBeUndefined();
    vi.setSystemTime(Date.now() - 10 * 60_000);
    const second = await finish(searchSources(query(), DEFAULT_SETTINGS));
    expect(second.results[0].error).toBeUndefined();
  });

  it('is not cut short when the wall clock jumps forward during a search', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) {
          const response = page(0, 100);
          vi.setSystemTime(Date.now() + 3_600_000);
          return response;
        }
        return page(100, 50);
      }),
    );
    const { results } = await finish(searchSources(query({ limit: 150 }), DEFAULT_SETTINGS));
    expect(results[0].error).toBeUndefined();
    expect(results[0].works).toHaveLength(150);
  });

  it('still spaces requests to one source by its interval', async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(performance.now());
        return page(starts.length * 100, 100);
      }),
    );
    const { results } = await finish(searchSources(query({ limit: 200 }), DEFAULT_SETTINGS));
    expect(results[0].works).toHaveLength(200);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(500);
  });
});

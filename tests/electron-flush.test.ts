import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlushCoordinator } from '../electron/flush';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(timeoutMs = 2000, alive = true) {
  const sent: number[] = [];
  const flush = createFlushCoordinator({
    timeoutMs,
    send: (id) => {
      sent.push(id);
      return alive;
    },
  });
  return { flush, sent };
}

describe('asking the interface to save pending edits before the window closes or the app quits', () => {
  it('finishes as soon as the interface acknowledges the request', async () => {
    const { flush, sent } = setup();
    const result = flush.request();
    expect(sent).toHaveLength(1);
    expect(flush.acknowledge(sent[0])).toBe(true);
    await expect(result).resolves.toBe('flushed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting after the timeout when the interface never answers', async () => {
    const { flush } = setup(2000);
    const result = flush.request();
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('timeout');
  });

  it('does not wait when there is no live interface to ask', async () => {
    const { flush } = setup(2000, false);
    await expect(flush.request()).resolves.toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an acknowledgement that is not for a request that is waiting', async () => {
    const { flush, sent } = setup();
    const result = flush.request();
    for (const bogus of [sent[0] + 1, 0, -1, '1', null, undefined, {}, NaN]) {
      expect(flush.acknowledge(bogus)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(1999);
    expect(flush.acknowledge(sent[0])).toBe(true);
    await expect(result).resolves.toBe('flushed');
  });

  it('answers each overlapping request on its own', async () => {
    const { flush, sent } = setup();
    const first = flush.request();
    const second = flush.request();
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toBe(sent[1]);
    flush.acknowledge(sent[1]);
    await expect(second).resolves.toBe('flushed');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(first).resolves.toBe('timeout');
  });

  it('does not count an acknowledgement that arrives after the timeout', async () => {
    const { flush, sent } = setup();
    const result = flush.request();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe('timeout');
    expect(flush.acknowledge(sent[0])).toBe(false);
  });
});

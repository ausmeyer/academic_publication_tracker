export type FlushResult = 'flushed' | 'timeout' | 'unavailable';

/**
 * Asks the interface to save edits it is still holding (notes and tags are saved shortly after
 * typing, and immediately when they lose focus) and waits for its answer, but never for long.
 */
export function createFlushCoordinator(options: {
  timeoutMs: number;
  /** Delivers a request to the interface; false when there is no live interface to ask. */
  send(id: number): boolean;
}) {
  let nextId = 1;
  const waiting = new Map<number, (result: FlushResult) => void>();
  return {
    request(): Promise<FlushResult> {
      const id = nextId++;
      return new Promise<FlushResult>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve('timeout');
        }, options.timeoutMs);
        waiting.set(id, (result) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(result);
        });
        if (!options.send(id)) waiting.get(id)?.('unavailable');
      });
    },
    /** Returns true when the answer belongs to a request that was still waiting. */
    acknowledge(id: unknown): boolean {
      if (typeof id !== 'number') return false;
      const answer = waiting.get(id);
      if (!answer) return false;
      answer('flushed');
      return true;
    },
  };
}

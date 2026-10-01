import { describe, expect, it, vi } from 'vitest';

describe('browser-preview bridge (P5-15)', () => {
  it('provides no-op flush and recovery hooks so the app can call them on every platform', async () => {
    vi.stubGlobal('window', {});
    const { client } = await import('../src/services/client');
    expect(typeof client.onFlushRequest).toBe('function');
    const unsubscribe = client.onFlushRequest!(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    await expect(client.recoveryNotice!()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});

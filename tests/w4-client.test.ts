import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('unsaved work in the browser preview (W4-09)', () => {
  it('asks before the tab closes or reloads while work exists only in memory', async () => {
    const window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('window', window);
    const { client } = await import('../src/services/client');
    client.setUnsavedWork!('Search results that could not be saved: “First query”.');
    expect(window.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const guard = window.addEventListener.mock.calls[0][1] as (event: Event) => void;
    const event = { preventDefault: vi.fn() };
    guard(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalled();
    client.setUnsavedWork!(null);
    expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', guard);
  });

  it('leaves the question to the desktop shell: no beforeunload guard in the app', async () => {
    const setUnsavedWork = vi.fn();
    const window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      desktop: { setUnsavedWork },
    };
    vi.stubGlobal('window', window);
    const { client } = await import('../src/services/client');
    client.setUnsavedWork!('Changes that could not be saved.');
    expect(setUnsavedWork).toHaveBeenCalledWith('Changes that could not be saved.');
    expect(window.addEventListener).not.toHaveBeenCalled();
  });
});

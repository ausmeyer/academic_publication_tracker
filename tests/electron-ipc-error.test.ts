import { describe, expect, it } from 'vitest';
import { cleanIpcError, createInvoker } from '../electron/ipc-error';

describe('IPC error cleanup', () => {
  it.each([
    [
      "Error invoking remote method 'apt:search': Error: Enter a search between 2 and 500 characters.",
      'Enter a search between 2 and 500 characters.',
    ],
    [
      "Error invoking remote method 'apt:workspace:save': Error: Invalid or oversized text in workspace (title) — search “x”, record 3.",
      'Invalid or oversized text in workspace (title) — search “x”, record 3.',
    ],
    ["Error invoking remote method 'apt:external': TypeError: Invalid URL", 'Invalid URL'],
    ["Error invoking remote method 'apt:search': RangeError: too deep", 'too deep'],
    [
      "Error invoking remote method 'apt:clipboard:write': plain text failure",
      'plain text failure',
    ],
    ['A message that was never wrapped.', 'A message that was never wrapped.'],
    ["Error invoking remote method 'apt:search': Error: line one\nline two", 'line one\nline two'],
  ])('turns %j into a message a person can read', (raw, friendly) => {
    const cleaned = cleanIpcError(new Error(raw));
    expect(cleaned).toBeInstanceOf(Error);
    expect(cleaned.message).toBe(friendly);
  });

  it('gives a generic message when nothing readable is left', () => {
    expect(
      cleanIpcError(new Error("Error invoking remote method 'apt:search': Error: ")).message,
    ).toBe('The request failed. Try again.');
    expect(cleanIpcError(undefined).message).toBe('The request failed. Try again.');
    expect(cleanIpcError({ code: 1 }).message).toBe('The request failed. Try again.');
    expect(cleanIpcError("Error invoking remote method 'x': Error: from a string").message).toBe(
      'from a string',
    );
  });

  it('wraps every invoke so rejections reach the interface without the Electron prefix', async () => {
    const calls: unknown[][] = [];
    const invoke = createInvoker({
      async invoke(channel, ...args) {
        calls.push([channel, ...args]);
        if (channel === 'apt:search')
          throw new Error("Error invoking remote method 'apt:search': Error: Friendly message");
        return { channel, args };
      },
    });
    await expect(invoke('apt:search', { text: 'x' })).rejects.toHaveProperty(
      'message',
      'Friendly message',
    );
    await expect(invoke('apt:workspace:load')).resolves.toEqual({
      channel: 'apt:workspace:load',
      args: [],
    });
    expect(calls).toEqual([['apt:search', { text: 'x' }], ['apt:workspace:load']]);
  });
});

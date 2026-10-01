// Electron rejects a failed handler with "Error invoking remote method 'channel': Error: message".
// The interface shows error messages to people, so only the message itself should reach it.
const WRAPPER = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;
const FALLBACK = 'The request failed. Try again.';

export function cleanIpcError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return new Error(raw.replace(WRAPPER, '').trim() || FALLBACK);
}

/** One `invoke` for every bridge method, so no channel can leak the wrapper text. */
export function createInvoker(ipc: {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}) {
  return async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    try {
      return (await ipc.invoke(channel, ...args)) as T;
    } catch (error) {
      throw cleanIpcError(error);
    }
  };
}

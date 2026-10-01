import { describe, expect, it } from 'vitest';
import { configureSpellchecker } from '../electron/session-policy';

function fakeSession() {
  const calls: boolean[] = [];
  return { calls, setSpellCheckerEnabled: (enabled: boolean) => calls.push(enabled) };
}

describe('spell checking', () => {
  // Chromium downloads dictionaries from a Google server on Windows and Linux; the README promises
  // that the app contacts nothing but the search providers. macOS uses its own local spell checker.
  it.each(['win32', 'linux', 'freebsd'] as const)(
    'is turned off on %s so no dictionaries are downloaded',
    (platform) => {
      const session = fakeSession();
      configureSpellchecker(session, platform);
      expect(session.calls).toEqual([false]);
    },
  );

  it('is left to the operating system on macOS', () => {
    const session = fakeSession();
    configureSpellchecker(session, 'darwin');
    expect(session.calls).toEqual([]);
  });
});

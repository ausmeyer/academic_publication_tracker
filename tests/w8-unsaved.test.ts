import { describe, expect, it } from 'vitest';
import { createUnsavedWorkGuard } from '../electron/unsaved';

describe('what the unsaved-work guard can tell other questions', () => {
  it('is the description the interface last reported, until that work is saved or gone', () => {
    const APP = {};
    const guard = createUnsavedWorkGuard<object>({
      fromApplication: (sender) => sender === APP,
      confirm: async () => true,
    });
    expect(guard.reported()).toBeNull();
    guard.report(APP, 'Changes that could not be saved.');
    guard.report({}, 'A report from another window.');
    guard.report(APP, 'x'.repeat(501));
    expect(guard.reported()).toBe('Changes that could not be saved.');
    guard.forget();
    expect(guard.reported()).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { createUnsavedWorkGuard } from '../electron/unsaved';

// Stand-ins for the senders of IPC messages: only the application's own page is listened to.
const APP = { page: 'application' };
const STRANGER = { page: 'another window' };
const HELD =
  'Search results for “Jane Scholar” (120 papers) could not be saved: the workspace is full.';

function setup(answer: () => Promise<boolean> = async () => false) {
  const asked: { description: string; action: 'close' | 'quit' }[] = [];
  const unsaved = createUnsavedWorkGuard<object>({
    fromApplication: (sender) => sender === APP,
    confirm: (description, action) => {
      asked.push({ description, action });
      return answer();
    },
  });
  return { unsaved, asked };
}

describe('work that exists only in the interface (search results or edits that could not be saved)', () => {
  it('asks before closing or quitting only while the interface reports unsaved work', async () => {
    const { unsaved, asked } = setup();
    await expect(unsaved.confirmLoss('close')).resolves.toBe(true);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
    expect(asked).toEqual([]);
    unsaved.report(APP, HELD);
    await unsaved.confirmLoss('quit');
    expect(asked).toEqual([{ description: HELD, action: 'quit' }]);
  });

  it('"Go back" cancels the close or quit, and the next attempt asks again', async () => {
    const { unsaved, asked } = setup(async () => false);
    unsaved.report(APP, HELD);
    await expect(unsaved.confirmLoss('close')).resolves.toBe(false);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(false);
    expect(asked.map((question) => question.action)).toEqual(['close', 'quit']);
  });

  it('lets the close or quit go ahead when the user chooses to lose the work', async () => {
    const { unsaved } = setup(async () => true);
    unsaved.report(APP, HELD);
    await expect(unsaved.confirmLoss('close')).resolves.toBe(true);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
  });

  it('describes the latest report, and stops asking once the interface reports null', async () => {
    const { unsaved, asked } = setup();
    unsaved.report(APP, 'Your latest edits could not be saved.');
    unsaved.report(APP, HELD);
    await unsaved.confirmLoss('quit');
    expect(asked).toEqual([{ description: HELD, action: 'quit' }]);
    unsaved.report(APP, null);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('ignores invalid reports and keeps the last valid one', async () => {
    const invalid = [undefined, 42, true, {}, ['text'], { description: 'text' }, 'x'.repeat(501)];
    const { unsaved, asked } = setup();
    for (const value of invalid) unsaved.report(APP, value);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
    expect(asked).toEqual([]);
    unsaved.report(APP, HELD);
    for (const value of invalid) unsaved.report(APP, value);
    await unsaved.confirmLoss('quit');
    expect(asked).toEqual([{ description: HELD, action: 'quit' }]);
  });

  it('accepts a description of up to 500 characters', async () => {
    const { unsaved, asked } = setup();
    unsaved.report(APP, 'x'.repeat(500));
    await unsaved.confirmLoss('quit');
    expect(asked[0].description).toBe('x'.repeat(500));
  });

  it('ignores reports that do not come from the application window', async () => {
    const { unsaved, asked } = setup();
    unsaved.report(STRANGER, HELD);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
    expect(asked).toEqual([]);
    unsaved.report(APP, HELD);
    unsaved.report(STRANGER, null);
    unsaved.report(STRANGER, 'Forged description');
    await unsaved.confirmLoss('quit');
    expect(asked).toEqual([{ description: HELD, action: 'quit' }]);
  });

  it('forgets the work when the page that held it is gone', async () => {
    const { unsaved, asked } = setup();
    unsaved.report(APP, HELD);
    unsaved.forget();
    await expect(unsaved.confirmLoss('close')).resolves.toBe(true);
    expect(asked).toEqual([]);
  });

  it('asks one question at a time and gives every waiting close or quit the answer', async () => {
    let answer!: (value: boolean) => void;
    const { unsaved, asked } = setup(() => new Promise<boolean>((resolve) => (answer = resolve)));
    unsaved.report(APP, HELD);
    const close = unsaved.confirmLoss('close');
    const quit = unsaved.confirmLoss('quit');
    expect(asked).toHaveLength(1);
    answer(false);
    await expect(close).resolves.toBe(false);
    await expect(quit).resolves.toBe(false);
    void unsaved.confirmLoss('quit');
    expect(asked).toHaveLength(2);
  });

  it('goes ahead when the question cannot be shown, so the user is never trapped', async () => {
    const { unsaved } = setup(async () => {
      throw new Error('dialog failed');
    });
    unsaved.report(APP, HELD);
    await expect(unsaved.confirmLoss('quit')).resolves.toBe(true);
  });
});

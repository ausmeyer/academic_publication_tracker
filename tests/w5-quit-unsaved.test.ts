import { describe, expect, it } from 'vitest';
import { createQuitCoordinator } from '../electron/quit';
import { createUnsavedWorkGuard } from '../electron/unsaved';

function setup(
  options: {
    state?: 'none' | 'running' | 'waiting';
    flushInterface?: () => void;
    confirmUnsaved?: () => Promise<boolean>;
  } = {},
) {
  const log: string[] = [];
  const coordinator = createQuitCoordinator({
    searchState: () => options.state ?? 'none',
    guardSearch: () => log.push('guard'),
    confirmDiscardSearch: async () => {
      log.push('confirm-search');
      return true;
    },
    discardSearch: () => log.push('discard'),
    flushInterface: async () => {
      log.push('flush-interface');
      options.flushInterface?.();
    },
    flushStore: async () => {
      log.push('flush-store');
    },
    confirmUnsavedWork: async () => {
      log.push('confirm-unsaved');
      return options.confirmUnsaved ? options.confirmUnsaved() : true;
    },
    quit: () => log.push('quit'),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { coordinator, log, settle };
}

describe('quitting while the interface holds work it could not save', () => {
  it('asks only after the interface and the store have saved what they could, then quits', async () => {
    const { coordinator, log, settle } = setup();
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved', 'quit']);
    expect(coordinator.finished).toBe(true);
  });

  it('asks about a save that failed while the interface was flushing', async () => {
    const APP = {};
    const asked: string[] = [];
    const unsaved = createUnsavedWorkGuard<object>({
      fromApplication: (sender) => sender === APP,
      confirm: async (description) => {
        asked.push(description);
        return false;
      },
    });
    const { coordinator, log, settle } = setup({
      // The interface reports the failure before it acknowledges the flush request.
      flushInterface: () => unsaved.report(APP, 'Your latest edits could not be saved.'),
      confirmUnsaved: () => unsaved.confirmLoss('quit'),
    });
    coordinator.beforeQuit();
    await settle();
    expect(asked).toEqual(['Your latest edits could not be saved.']);
    expect(log).not.toContain('quit');
  });

  it('"Go back" keeps the application running, and quitting again asks again', async () => {
    let answer = false;
    const { coordinator, log, settle } = setup({ confirmUnsaved: async () => answer });
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved']);
    expect(coordinator.finished).toBe(false);
    answer = true;
    log.length = 0;
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved', 'quit']);
  });

  it('"Quit without saving" quits once and lets that quit through without asking again', async () => {
    const { coordinator, log, settle } = setup({ confirmUnsaved: async () => true });
    coordinator.beforeQuit();
    await settle();
    expect(coordinator.beforeQuit()).toBe(false);
    await settle();
    expect(log.filter((entry) => entry === 'confirm-unsaved')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'quit')).toHaveLength(1);
  });

  it('holds back repeated quit requests while the question is open', async () => {
    let answer!: (value: boolean) => void;
    const { coordinator, log, settle } = setup({
      confirmUnsaved: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    coordinator.beforeQuit();
    await settle();
    expect(coordinator.beforeQuit()).toBe(true);
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log.filter((entry) => entry === 'confirm-unsaved')).toHaveLength(1);
    answer(false);
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved']);
  });

  it('quits anyway if the question itself fails', async () => {
    const { coordinator, log, settle } = setup({
      confirmUnsaved: async () => {
        throw new Error('dialog failed');
      },
    });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved', 'quit']);
    expect(coordinator.finished).toBe(true);
  });

  it('asks about a Google Scholar search waiting for the user first, then about unsaved work', async () => {
    const { coordinator, log, settle } = setup({ state: 'waiting' });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual([
      'confirm-search',
      'flush-interface',
      'flush-store',
      'confirm-unsaved',
      'discard',
      'quit',
    ]);
  });

  it('does not ask about unsaved work while a Google Scholar search is retrieving pages', async () => {
    const { coordinator, log, settle } = setup({ state: 'running' });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['guard']);
  });
});

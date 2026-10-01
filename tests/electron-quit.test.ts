import { describe, expect, it } from 'vitest';
import { createQuitCoordinator } from '../electron/quit';

function setup(
  options: {
    state?: 'none' | 'running' | 'waiting';
    confirm?: () => Promise<boolean>;
    flushInterface?: () => Promise<unknown>;
    flushStore?: () => Promise<unknown>;
  } = {},
) {
  const log: string[] = [];
  const coordinator = createQuitCoordinator({
    searchState: () => options.state ?? 'none',
    guardSearch: () => log.push('guard'),
    confirmDiscardSearch: async () => {
      log.push('confirm');
      return options.confirm ? options.confirm() : true;
    },
    discardSearch: () => log.push('discard'),
    flushInterface: async () => {
      log.push('flush-interface');
      await options.flushInterface?.();
    },
    flushStore: async () => {
      log.push('flush-store');
      await options.flushStore?.();
    },
    confirmUnsavedWork: async () => true,
    quit: () => log.push('quit'),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { coordinator, log, settle };
}

describe('quitting the application', () => {
  it('asks the interface to save, then writes pending data, then quits', async () => {
    const { coordinator, log, settle } = setup();
    expect(coordinator.beforeQuit()).toBe(true); // this quit request is held back
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'quit']);
    expect(coordinator.finished).toBe(true);
    expect(coordinator.beforeQuit()).toBe(false); // the quit it started is let through
  });

  it('holds back repeated quit requests while the first is still saving', async () => {
    let release!: () => void;
    const { coordinator, log, settle } = setup({
      flushInterface: () => new Promise<void>((resolve) => (release = resolve)),
    });
    expect(coordinator.beforeQuit()).toBe(true);
    expect(coordinator.beforeQuit()).toBe(true);
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    release();
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'quit']);
  });

  it('still quits when saving fails', async () => {
    const { coordinator, log, settle } = setup({
      flushInterface: async () => {
        throw new Error('window gone');
      },
      flushStore: async () => {
        throw new Error('disk full');
      },
    });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'quit']);
  });

  it('keeps running a Google Scholar search that is retrieving pages and says how to end it', async () => {
    const { coordinator, log, settle } = setup({ state: 'running' });
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['guard']);
    expect(coordinator.finished).toBe(false);
  });

  it('lets the user quit, after a confirmation, while a search is only waiting for them', async () => {
    const { coordinator, log, settle } = setup({ state: 'waiting', confirm: async () => true });
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['confirm', 'flush-interface', 'flush-store', 'discard', 'quit']);
  });

  it('keeps waiting when the user declines, and can be asked again later', async () => {
    let answer = false;
    const { coordinator, log, settle } = setup({ state: 'waiting', confirm: async () => answer });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['confirm', 'guard']);
    expect(coordinator.finished).toBe(false);
    answer = true;
    log.length = 0;
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['confirm', 'flush-interface', 'flush-store', 'discard', 'quit']);
  });

  it('does not stack confirmation dialogs', async () => {
    let answer!: (value: boolean) => void;
    const { coordinator, log, settle } = setup({
      state: 'waiting',
      confirm: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    coordinator.beforeQuit();
    coordinator.beforeQuit();
    await settle();
    expect(log.filter((entry) => entry === 'confirm')).toHaveLength(1);
    answer(false);
    await settle();
    expect(log).toEqual(['confirm', 'guard']);
  });

  it('quits anyway if the confirmation itself fails', async () => {
    const { coordinator, log, settle } = setup({
      state: 'waiting',
      confirm: async () => {
        throw new Error('dialog failed');
      },
    });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['confirm', 'quit']);
    expect(coordinator.finished).toBe(true);
  });
});

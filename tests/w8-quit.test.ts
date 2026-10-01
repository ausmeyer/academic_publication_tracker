import { describe, expect, it } from 'vitest';
import { createQuitCoordinator } from '../electron/quit';
import { createUnsavedWorkGuard } from '../electron/unsaved';

type SearchState = 'none' | 'running' | 'waiting';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The desktop shell's real pieces, wired as electron/main.ts wires them, with unsaved work reported.
 * `search.state` is what the Google Scholar search is doing whenever the coordinator looks;
 * `answer()` is the reply to the unsaved-work question.
 */
function setup(search: { state: SearchState }, answer: () => boolean) {
  const APP = {};
  const log: string[] = [];
  const unsaved = createUnsavedWorkGuard<object>({
    fromApplication: (sender) => sender === APP,
    confirm: async () => {
      log.push('confirm-unsaved');
      return answer();
    },
  });
  unsaved.report(APP, 'Search results that could not be saved: “Jane Scholar”.');
  const coordinator = createQuitCoordinator({
    searchState: () => search.state,
    guardSearch: () => log.push('guard'),
    confirmDiscardSearch: async () => {
      log.push('confirm-search');
      return true; // "Quit and discard the search"
    },
    discardSearch: () => {
      log.push('discard');
      search.state = 'none';
    },
    flushInterface: async () => log.push('flush-interface'),
    flushStore: async () => log.push('flush-store'),
    confirmUnsavedWork: () => unsaved.confirmLoss('quit'),
    quit: () => log.push('quit'),
  });
  return { coordinator, log };
}

describe('quitting while a Google Scholar search waits for the user and work is unsaved', () => {
  it('"Go back" on the unsaved-work question keeps the Scholar search it was going to discard', async () => {
    const search = { state: 'waiting' as SearchState };
    const { coordinator, log } = setup(search, () => false);
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['confirm-search', 'flush-interface', 'flush-store', 'confirm-unsaved']);
    expect(search.state).toBe('waiting');
    expect(coordinator.finished).toBe(false);
  });

  it('"Quit without saving" discards the search only then, and quits', async () => {
    const search = { state: 'waiting' as SearchState };
    const { coordinator, log } = setup(search, () => true);
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
    expect(coordinator.finished).toBe(true);
  });
});

describe('a Google Scholar search that starts while the quit question is open', () => {
  it('keeps the application running, and the next quit saves and asks again', async () => {
    // The question has no parent window, so the main window can start a search meanwhile. That
    // search's windows refuse to close, so going ahead would start a quit that never happens.
    const search = { state: 'none' as SearchState };
    let questions = 0;
    const { coordinator, log } = setup(search, () => {
      if (++questions === 1) search.state = 'running';
      return true; // "Quit without saving"
    });
    coordinator.beforeQuit();
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved', 'guard']);
    expect(coordinator.finished).toBe(false);
    // Once the search has ended, quitting is a quit like any other: saved first, then asked.
    search.state = 'none';
    log.length = 0;
    expect(coordinator.beforeQuit()).toBe(true);
    await settle();
    expect(log).toEqual(['flush-interface', 'flush-store', 'confirm-unsaved', 'quit']);
  });
});

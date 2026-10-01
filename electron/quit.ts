export interface QuitDeps {
  /** 'running': a Google Scholar search is retrieving pages. 'waiting': it only waits for the user. */
  searchState(): 'none' | 'running' | 'waiting';
  /** Tells the user to stop or cancel the running search first. */
  guardSearch(): void;
  /** Asks whether to quit and discard a search that is waiting for the user. */
  confirmDiscardSearch(): Promise<boolean>;
  discardSearch(): void;
  /** Lets the interface save edits it still holds. */
  flushInterface(): Promise<unknown>;
  /** Waits for queued writes to finish. */
  flushStore(): Promise<unknown>;
  /** Asks before losing work the interface could not save; false keeps the app running. */
  confirmUnsavedWork(): Promise<boolean>;
  quit(): void;
}

/**
 * Orders everything that happens before the app quits. `beforeQuit()` belongs in the `before-quit`
 * handler: true means that quit request is held back (this coordinator quits again when ready).
 */
export function createQuitCoordinator(deps: QuitDeps) {
  let inProgress = false;
  const state = { finished: false };

  async function run(): Promise<void> {
    const search = deps.searchState();
    if (search === 'running') return deps.guardSearch();
    // Waiting on Google verification never ends by itself, so quitting must stay possible.
    if (search === 'waiting' && !(await deps.confirmDiscardSearch())) return deps.guardSearch();
    await deps.flushInterface().catch(() => undefined);
    await deps.flushStore().catch(() => undefined);
    // Asked after the flushes: the interface reports a save that failed before it answers the flush.
    if (!(await deps.confirmUnsavedWork())) return;
    // Only now is the quit going ahead, so only now is the search discarded. A search started while
    // the questions were open would keep its windows from closing: this quit ends here instead.
    if (search === 'waiting') deps.discardSearch();
    else if (deps.searchState() !== 'none') return deps.guardSearch();
    state.finished = true;
    deps.quit();
  }

  return {
    get finished(): boolean {
      return state.finished;
    },
    beforeQuit(): boolean {
      if (state.finished) return false;
      if (!inProgress) {
        inProgress = true;
        void run()
          .catch(() => {
            // Whatever went wrong, the user's request to quit is not dropped.
            state.finished = true;
            deps.quit();
          })
          .finally(() => {
            inProgress = false;
          });
      }
      return true;
    },
  };
}

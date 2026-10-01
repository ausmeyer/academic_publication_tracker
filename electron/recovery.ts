export type RecoveryAction = 'ignore' | 'reload' | 'give-up';

const ERR_ABORTED = -3;

/**
 * Decides what to do when the application window's page crashes or fails to load: reload it, but only
 * a few times in a short while, so that a page that cannot start does not reload forever.
 */
export function createCrashRecovery(
  options: { maxReloads?: number; windowMs?: number; now?: () => number } = {},
) {
  const { maxReloads = 3, windowMs = 60_000, now = Date.now } = options;
  let reloads: number[] = [];

  function attempt(): RecoveryAction {
    const current = now();
    reloads = reloads.filter((at) => current - at < windowMs);
    if (reloads.length >= maxReloads) return 'give-up';
    reloads.push(current);
    return 'reload';
  }

  return {
    rendererGone: (reason: string): RecoveryAction =>
      reason === 'clean-exit' ? 'ignore' : attempt(),
    loadFailed: (errorCode: number, isMainFrame: boolean): RecoveryAction =>
      isMainFrame && errorCode !== ERR_ABORTED ? attempt() : 'ignore',
    reset(): void {
      reloads = [];
    },
  };
}

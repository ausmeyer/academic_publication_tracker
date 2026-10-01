/**
 * Remembers what the interface last reported about work that exists only in its memory (search
 * results that could not be saved, edits whose save failed), so that closing the window or quitting
 * can ask before that work is lost.
 */
export function createUnsavedWorkGuard<Sender>(deps: {
  /** True when a message comes from the application's own page. */
  fromApplication(sender: Sender): boolean;
  /** Shows the question; true means close or quit without saving. */
  confirm(description: string, action: 'close' | 'quit'): Promise<boolean>;
}) {
  let description: string | null = null;
  let asking: Promise<boolean> | null = null;
  return {
    /** A short description of the unsaved work, or null once it is saved or discarded. */
    report(sender: Sender, value: unknown): void {
      if (!deps.fromApplication(sender)) return;
      if (value === null || (typeof value === 'string' && value.length <= 500)) description = value;
    },
    /** The page that held the work closed, crashed or was reloaded: the work is already gone. */
    forget(): void {
      description = null;
    },
    /** What the interface last reported as unsaved, or null. */
    reported(): string | null {
      return description;
    },
    /** True when nothing would be lost or the user chose to lose it. One question at a time. */
    confirmLoss(action: 'close' | 'quit'): Promise<boolean> {
      if (description === null) return Promise.resolve(true);
      // A question that cannot be shown must not trap the user in the application.
      asking ??= deps
        .confirm(description, action)
        .catch(() => true)
        .finally(() => {
          asking = null;
        });
      return asking;
    },
  };
}

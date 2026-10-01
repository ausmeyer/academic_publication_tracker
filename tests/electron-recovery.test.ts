import { describe, expect, it } from 'vitest';
import { createCrashRecovery } from '../electron/recovery';

function setup() {
  let clock = 1_000_000;
  const recovery = createCrashRecovery({ now: () => clock });
  return { recovery, advance: (ms: number) => (clock += ms) };
}

describe('recovering a window whose page crashed or failed to load', () => {
  it('reloads after a crash and ignores a clean exit', () => {
    const { recovery } = setup();
    expect(recovery.rendererGone('clean-exit')).toBe('ignore');
    for (const reason of ['crashed', 'abnormal-exit', 'killed', 'oom', 'launch-failed'])
      expect(setup().recovery.rendererGone(reason)).toBe('reload');
  });

  it('gives up after three reloads in a minute instead of looping', () => {
    const { recovery, advance } = setup();
    expect(recovery.rendererGone('crashed')).toBe('reload');
    advance(2000);
    expect(recovery.rendererGone('crashed')).toBe('reload');
    advance(2000);
    expect(recovery.loadFailed(-105, true)).toBe('reload');
    advance(2000);
    expect(recovery.rendererGone('crashed')).toBe('give-up');
    expect(recovery.loadFailed(-105, true)).toBe('give-up');
  });

  it('forgets failures that are more than a minute old', () => {
    const { recovery, advance } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(recovery.rendererGone('crashed')).toBe('reload');
      advance(1000);
    }
    advance(61_000);
    expect(recovery.rendererGone('crashed')).toBe('reload');
  });

  it('starts over after the user chooses to try again', () => {
    const { recovery } = setup();
    for (let i = 0; i < 3; i += 1) recovery.rendererGone('crashed');
    expect(recovery.rendererGone('crashed')).toBe('give-up');
    recovery.reset();
    expect(recovery.rendererGone('crashed')).toBe('reload');
  });

  it('ignores an aborted load and failures of embedded frames', () => {
    const { recovery } = setup();
    expect(recovery.loadFailed(-3, true)).toBe('ignore'); // ERR_ABORTED: a navigation we cancelled
    expect(recovery.loadFailed(-105, false)).toBe('ignore');
    expect(recovery.loadFailed(-105, true)).toBe('reload');
  });
});

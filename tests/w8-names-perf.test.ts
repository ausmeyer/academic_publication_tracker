import { describe, expect, it, vi } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { settings, work } from './insights-helpers';

describe('the cheapest byline check', () => {
  it('dismisses a byline with no word that begins a surname before trying to spell one', () => {
    // Spelling a surname out of a byline's words compares strings with startsWith; a byline none
    // of whose words begins "scholar" must be dismissed before that (a set lookup per word).
    const works = Array.from({ length: 2000 }, (_, i) =>
      work(`p${i}`, { authors: [`Kim Lee${i}`, `Alex Other${i}`, `Pat Doe${i}`] }),
    );
    const config = settings({ author: 'Jane Scholar' });
    const spy = vi.spyOn(String.prototype, 'startsWith');
    let calls: number;
    try {
      const before = spy.mock.calls.length;
      const result = analyzeInsights(works, config, 'all');
      calls = spy.mock.calls.length - before;
      expect(result.nameMatches).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(0);
  });

  it('still spells a byline that has such a word', () => {
    const works = [work('a', { authors: ['Scholar Kim', 'Alex Other'] })];
    const spy = vi.spyOn(String.prototype, 'startsWith');
    try {
      analyzeInsights(works, settings({ author: 'Jane Q Scholar' }), 'all');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { decodeImportBytes } from '../src/core/encoding';

const utf8 = (text: string) => [...new TextEncoder().encode(text)];

describe('W7-04 a small UTF-8 file with a stray byte stays UTF-8', () => {
  it('keeps one accented name readable next to one stray byte', () => {
    const bytes = new Uint8Array([
      ...utf8('Title,Authors\nA paper,Hans Müller\nB paper,'),
      0x93, // a windows-1252 “
      ...utf8('Smith\n'),
    ]);
    expect(decodeImportBytes(bytes)).toBe(
      'Title,Authors\nA paper,Hans Müller\nB paper,\ufffdSmith\n',
    );
  });
});

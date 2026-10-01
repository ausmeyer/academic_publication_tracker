import { describe, expect, it } from 'vitest';
import { decodeImportBytes } from '../src/core/encoding';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('decodeImportBytes', () => {
  it('decodes UTF-8 and strips a byte-order mark', () => {
    expect(decodeImportBytes(new TextEncoder().encode('Müller ✓'))).toBe('Müller ✓');
    expect(decodeImportBytes(bytes(0xef, 0xbb, 0xbf, 0x41, 0x42))).toBe('AB');
  });

  it('decodes UTF-16 little and big endian files written by spreadsheets', () => {
    expect(decodeImportBytes(bytes(0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00))).toBe('Aé');
    expect(decodeImportBytes(bytes(0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9))).toBe('Aé');
  });

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    // "Müller “quoted”" as saved by Excel on Windows
    expect(
      decodeImportBytes(bytes(0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x93, 0x71, 0x94)),
    ).toBe('Müller “q”');
  });

  it('handles empty input', () => {
    expect(decodeImportBytes(new Uint8Array())).toBe('');
  });
});

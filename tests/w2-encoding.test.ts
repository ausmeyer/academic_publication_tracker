import { describe, expect, it } from 'vitest';
import { decodeImportBytes } from '../src/core/encoding';
import { importWorks } from '../src/core/formats';

const utf8 = (text: string) => [...new TextEncoder().encode(text)];
const cp1252 = (text: string) =>
  [...text].map(
    (char) => ({ ü: 0xfc, é: 0xe9, ø: 0xf8, '“': 0x93, '”': 0x94 })[char] ?? char.charCodeAt(0),
  );

describe('W2-11 one stray byte does not turn a UTF-8 file into mojibake', () => {
  it('keeps the valid UTF-8 names readable and marks only the stray bytes', () => {
    const bytes = new Uint8Array([
      ...utf8('Title,Authors\nÉtude sur la grippe,"Müller, Jürgen; Dæhlen, Bjørn"\nSecond '),
      0x93, // a windows-1252 “
      ...utf8('q title,"Nze Ndong, David"\n'),
    ]);
    const text = decodeImportBytes(bytes);
    expect(text).toContain('Müller, Jürgen; Dæhlen, Bjørn');
    expect(text).toContain('Étude');
    expect(text).toContain('Second \ufffdq title');
    expect(importWorks(text, 'x.csv').map((w) => w.authors)).toEqual([
      ['Müller, Jürgen', 'Dæhlen, Bjørn'],
      ['Nze Ndong, David'],
    ]);
  });

  it('still reads windows-1252 files whose accents are single bytes', () => {
    const text =
      'Title,Authors\nA paper,"Müller, Jürgen; Søren Kierkegaard"\nAnother “quoted” paper,Hélène\n';
    expect(decodeImportBytes(new Uint8Array(cp1252(text)))).toBe(text);
  });

  it('keeps windows-1252 when an accidental UTF-8 pair is outnumbered by single-byte accents', () => {
    // "Ã©" in windows-1252 is the byte pair of a UTF-8 "é".
    const bytes = new Uint8Array([...cp1252('Müller, Jürgen, Søren and '), 0xc3, 0xa9]);
    expect(decodeImportBytes(bytes)).toBe('Müller, Jürgen, Søren and Ã©');
  });
});

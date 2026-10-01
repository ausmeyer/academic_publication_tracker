import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readBody } from '../src/services/body';
import { APP_VERSION } from '../src/version';

describe('APP_VERSION', () => {
  it('is the version in package.json', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(APP_VERSION).toBe(manifest.version);
  });
});

describe('readBody', () => {
  it('keeps a multi-byte character that is split across chunks intact', async () => {
    const encoded = Buffer.from('{"name":"Müller"}', 'utf8');
    const split = encoded.indexOf(0xc3) + 1; // between the two bytes of "ü"
    const stream = Readable.from([encoded.subarray(0, split), encoded.subarray(split)]);
    expect(await readBody(stream, 1000)).toBe('{"name":"Müller"}');
  });

  it('caps the body in bytes, not characters', async () => {
    await expect(
      readBody(Readable.from([Buffer.from('ü'.repeat(600), 'utf8')]), 1000),
    ).rejects.toThrow('Search request is too large.');
    expect(await readBody(Readable.from([Buffer.from('a'.repeat(1000))]), 1000)).toHaveLength(1000);
  });

  it('returns an empty string for an empty body', async () => {
    expect(await readBody(Readable.from([]), 1000)).toBe('');
  });
});

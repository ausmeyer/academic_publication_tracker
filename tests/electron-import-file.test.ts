import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readImportFile } from '../electron/import-file';

const directories: string[] = [];
async function fileWith(bytes: Uint8Array | string, name = 'import.csv'): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apt-import-'));
  directories.push(directory);
  const file = path.join(directory, name);
  await writeFile(file, bytes);
  return file;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('reading a file chosen for import', () => {
  it('reads plain UTF-8 unchanged', async () => {
    expect(await readImportFile(await fileWith('Title,Year\nMüller “quoted”,2020\n'))).toBe(
      'Title,Year\nMüller “quoted”,2020\n',
    );
  });

  it('removes the byte-order mark from UTF-8 files', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Title\nAé\n')]);
    expect(await readImportFile(await fileWith(bytes))).toBe('Title\nAé\n');
  });

  it('decodes the UTF-16 little-endian text that Excel calls "Unicode Text"', async () => {
    const text = 'Title\tYear\nMüller “quoted” 日本語\t2020\n';
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(await readImportFile(await fileWith(bytes, 'export.txt'))).toBe(text);
  });

  it('decodes UTF-16 big-endian files with a byte-order mark', async () => {
    const text = 'Title\nÅngström\n';
    const little = Buffer.from(text, 'utf16le');
    const big = Buffer.from(little).swap16();
    expect(
      await readImportFile(await fileWith(Buffer.concat([Buffer.from([0xfe, 0xff]), big]))),
    ).toBe(text);
  });

  it('decodes the windows-1252 files that Excel saves as "CSV (Windows)"', async () => {
    // ü = 0xFC, “ = 0x93, ” = 0x94 are not valid UTF-8.
    const bytes = Buffer.from([
      ...Buffer.from('Title\nM'),
      0xfc,
      ...Buffer.from('ller '),
      0x93,
      ...Buffer.from('quoted'),
      0x94,
      ...Buffer.from('\n'),
    ]);
    expect(await readImportFile(await fileWith(bytes))).toBe('Title\nMüller “quoted”\n');
  });

  it('refuses a file over 25 MB without reading it', async () => {
    const file = await fileWith('x');
    await truncate(file, 25 * 1024 * 1024 + 1);
    await expect(readImportFile(file)).rejects.toThrow('Choose a file smaller than 25 MB.');
  });

  it('accepts a file of exactly 25 MB', async () => {
    const file = await fileWith('x');
    await truncate(file, 25 * 1024 * 1024);
    expect((await readImportFile(file)).length).toBe(25 * 1024 * 1024);
  });
});

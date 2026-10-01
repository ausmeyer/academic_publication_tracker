import { readFile, stat } from 'node:fs/promises';
import { decodeImportBytes } from '../src/core/encoding';
import { MAX_FILE_BYTES } from './store';

/** Reads a file chosen for import and decodes it: UTF-8, UTF-16 with a byte-order mark, or windows-1252. */
export async function readImportFile(file: string): Promise<string> {
  if ((await stat(file)).size > MAX_FILE_BYTES)
    throw new Error('Choose a file smaller than 25 MB.');
  return decodeImportBytes(await readFile(file));
}

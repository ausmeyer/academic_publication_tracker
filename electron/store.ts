import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Settings, Workspace } from '../src/types';
import { validateWorkspace } from '../src/core/workspace';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid settings file.');
  return value as Record<string, unknown>;
}

export function validateSettings(value: unknown): Settings {
  const data = object(value);
  const result: Settings = { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
  for (const key of Object.keys(result) as (keyof Settings)[]) {
    if (typeof data[key] !== 'string' || data[key].length > (key === 'email' ? 320 : 8192)) {
      throw new Error(`Invalid setting: ${key}.`);
    }
    result[key] = data[key].trim();
  }
  return result;
}

async function readText(file: string): Promise<string | null> {
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES)
      throw new Error('The local data file exceeds the 25 MB limit.');
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

class JsonFile<T> {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly validate: (value: unknown) => T,
  ) {}

  flush(): Promise<void> {
    return this.pending;
  }

  private async read(file: string): Promise<T | null> {
    const text = await readText(file);
    return text === null ? null : this.validate(JSON.parse(text));
  }

  async load(): Promise<T | null> {
    await this.pending;
    let primaryError: unknown;
    try {
      const primary = await this.read(this.file);
      if (primary !== null) return primary;
    } catch (error) {
      primaryError = error;
    }
    try {
      const backup = await this.read(`${this.file}.backup`);
      if (backup !== null) return backup;
    } catch (error) {
      throw new Error(
        'The local data file and its backup could not be read. Keep both files for recovery.',
        { cause: error },
      );
    }
    if (primaryError)
      throw new Error('The local data file could not be read, and no valid backup is available.', {
        cause: primaryError,
      });
    return null;
  }

  save(value: unknown): Promise<void> {
    const validated = this.validate(value);
    const text = JSON.stringify(validated, null, 2);
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
      throw new Error(
        'The workspace exceeds the 25 MB limit. Export or remove older searches first.',
      );
    const operation = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      // Only a valid previous file may replace the recovery copy.
      let previous: T | null = null;
      try {
        previous = await this.read(this.file);
      } catch {
        // An explicit restore may replace corrupt data, but must retain the original bytes.
        const recoveredFile = `${this.file}.${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.corrupt`;
        await copyFile(this.file, recoveredFile, constants.COPYFILE_EXCL);
        await chmod(recoveredFile, 0o600);
      }
      if (previous !== null)
        await atomicWrite(`${this.file}.backup`, JSON.stringify(previous, null, 2));
      await atomicWrite(this.file, text);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

interface StoredSettings {
  version: 1;
  email: string;
  encryptedKeys: string | null;
}

function validateStoredSettings(value: unknown): StoredSettings {
  const data = object(value);
  if (
    data.version !== 1 ||
    typeof data.email !== 'string' ||
    data.email.length > 320 ||
    (data.encryptedKeys !== null &&
      (typeof data.encryptedKeys !== 'string' || data.encryptedKeys.length > 65536))
  ) {
    throw new Error('Invalid encrypted settings file.');
  }
  return { version: 1, email: data.email, encryptedKeys: data.encryptedKeys as string | null };
}

export function createDesktopStore(directory: string, encryption: CredentialEncryption) {
  const workspace = new JsonFile<Workspace>(
    path.join(directory, 'workspace.json'),
    validateWorkspace,
  );
  const settings = new JsonFile<StoredSettings>(
    path.join(directory, 'settings.json'),
    validateStoredSettings,
  );
  return {
    flush: () => Promise.all([workspace.flush(), settings.flush()]).then(() => undefined),
    loadWorkspace: () => workspace.load(),
    saveWorkspace: (value: unknown) => workspace.save(value),
    async loadSettings(): Promise<Settings> {
      const stored = await settings.load();
      if (!stored) return { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
      if (!stored.encryptedKeys)
        return { email: stored.email, openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
      if (!encryption.isEncryptionAvailable())
        throw new Error(
          'The operating system credential vault is unavailable. API keys cannot be unlocked.',
        );
      try {
        const keys = object(
          JSON.parse(encryption.decryptString(Buffer.from(stored.encryptedKeys, 'base64'))),
        );
        return validateSettings({ ...keys, email: stored.email });
      } catch (error) {
        throw new Error('Saved API keys could not be unlocked by this operating system account.', {
          cause: error,
        });
      }
    },
    async saveSettings(value: unknown): Promise<void> {
      const { email, ...keys } = validateSettings(value);
      const hasKeys = Object.values(keys).some(Boolean);
      if (hasKeys && !encryption.isEncryptionAvailable()) {
        throw new Error(
          'The operating system credential vault is unavailable. API keys were not saved.',
        );
      }
      await settings.save({
        version: 1,
        email,
        encryptedKeys: hasKeys
          ? encryption.encryptString(JSON.stringify(keys)).toString('base64')
          : null,
      });
    },
  };
}

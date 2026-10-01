import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle,
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

/** The file-system steps whose order and failure handling matter for durability; tests replace them. */
export interface StoreOps {
  /** Forces a written file to stable storage. */
  syncFile(handle: FileHandle): Promise<void>;
  /** Best effort: makes a rename durable. Windows cannot open directories. */
  syncDirectory(directory: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
}

const defaultOps: StoreOps = {
  syncFile: (handle) => handle.sync(),
  async syncDirectory(directory) {
    try {
      const handle = await open(directory, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      /* Not every platform can sync a directory. */
    }
  },
  rename,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

// A virus scanner or search indexer can hold the target for a moment, notably on Windows.
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 6;
const RENAME_BACKOFF_MS = 25;
const STALE_TEMPORARY_MS = 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const SETTINGS_WARNING =
  'Saved API settings could not be read; searching without API keys. Open Settings to re-enter them.';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid settings file.');
  return value as Record<string, unknown>;
}

const blankSettings = (): Settings => ({
  email: '',
  openalexApiKey: '',
  semanticApiKey: '',
  ncbiApiKey: '',
});

export function validateSettings(value: unknown): Settings {
  const data = object(value);
  const result: Settings = blankSettings();
  for (const key of Object.keys(result) as (keyof Settings)[]) {
    if (typeof data[key] !== 'string' || data[key].length > (key === 'email' ? 320 : 8192)) {
      throw new Error(`Invalid setting: ${key}.`);
    }
    result[key] = data[key].trim();
  }
  return result;
}

class TooLargeError extends Error {
  constructor() {
    super('The local data file exceeds the 25 MB limit.');
  }
}

/** The bytes of a file, or null when it does not exist. Oversized files are refused. */
async function readBytes(file: string): Promise<Buffer | null> {
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) throw new TooLargeError();
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(file: string, data: string | Buffer, ops: StoreOps): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await ops.syncFile(handle);
    } finally {
      await handle.close();
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await ops.rename(temporary, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= RENAME_ATTEMPTS || !code || !TRANSIENT_RENAME_ERRORS.has(code)) throw error;
        await ops.sleep(RENAME_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    await ops.syncDirectory(path.dirname(file));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Removes temporary files that an interrupted write left behind. */
async function purgeStaleTemporaries(directory: string): Promise<void> {
  const pattern = new RegExp(`^(?:workspace|settings)\\.json(?:\\.backup)?\\.${UUID}\\.tmp$`);
  try {
    for (const entry of await readdir(directory)) {
      if (!pattern.test(entry)) continue;
      const candidate = path.join(directory, entry);
      const modified = await stat(candidate).then(
        (info) => info.mtimeMs,
        () => Date.now(),
      );
      if (Date.now() - modified > STALE_TEMPORARY_MS)
        await unlink(candidate).catch(() => undefined);
    }
  } catch {
    /* The directory may not exist yet. */
  }
}

interface JsonFileOptions {
  /** Keeps the original of a file written by an older app version, the first time it is replaced. */
  legacy?: { version: number; suffix: string };
}

class JsonFile<T> {
  private pending: Promise<void> = Promise.resolve();
  private notice: string | null = null;

  constructor(
    private readonly file: string,
    private readonly validate: (value: unknown) => T,
    private readonly ops: StoreOps,
    private readonly options: JsonFileOptions = {},
  ) {}

  flush(): Promise<void> {
    return this.pending;
  }

  /** Set when the last load had to use the automatic backup instead of the file itself. */
  recoveryNotice(): string | null {
    return this.notice;
  }

  private parse(bytes: Buffer): T {
    return this.validate(JSON.parse(bytes.toString('utf8')));
  }

  /** Whether the bytes are a file this version can read, and the version number they claim. */
  private inspect(bytes: Buffer): { readable: boolean; version: unknown } {
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { readable: false, version: undefined };
    }
    const version = (raw as { version?: unknown } | null)?.version;
    try {
      this.validate(raw);
      return { readable: true, version };
    } catch {
      return { readable: false, version };
    }
  }

  /** Keeps the exact bytes of an unreadable file under a timestamped name before it is replaced. */
  private async preserveUnreadable(file: string, bytes: Buffer | null): Promise<string> {
    const base = path.basename(file);
    const directory = path.dirname(file);
    const digest = bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 16) : null;
    if (digest) {
      const known = (await readdir(directory)).find(
        (entry) => entry.startsWith(`${base}.`) && entry.endsWith(`-${digest}.corrupt`),
      );
      if (known) return known;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${base}.${stamp}-${digest ?? randomUUID()}.corrupt`;
    const target = path.join(directory, name);
    await copyFile(file, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    return name;
  }

  async load(): Promise<T | null> {
    await this.pending;
    this.notice = null;
    let primaryBytes: Buffer | null = null;
    let primaryError: unknown;
    try {
      primaryBytes = await readBytes(this.file);
      if (primaryBytes !== null) return this.parse(primaryBytes);
    } catch (error) {
      primaryError = error;
    }
    let backup: T | null;
    try {
      const backupBytes = await readBytes(`${this.file}.backup`);
      backup = backupBytes === null ? null : this.parse(backupBytes);
    } catch (error) {
      throw new Error(
        'The local data file and its backup could not be read. Keep both files for recovery.',
        { cause: error },
      );
    }
    if (backup !== null) {
      const when = (await stat(`${this.file}.backup`)).mtime.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      if (primaryError) {
        const kept = await this.preserveUnreadable(this.file, primaryBytes).catch(() => null);
        this.notice =
          `Your workspace file could not be read; the automatic backup from ${when} was loaded.` +
          (kept ? ` The unreadable file was preserved as ${kept}.` : '');
      } else {
        this.notice = `Your workspace file was missing; the automatic backup from ${when} was loaded.`;
      }
      return backup;
    }
    if (primaryError)
      throw new Error('The local data file could not be read, and no valid backup is available.', {
        cause: primaryError,
      });
    return null;
  }

  save(value: unknown): Promise<void> {
    const validated = this.validate(value);
    const text = JSON.stringify(validated);
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES)
      throw new Error(
        'The workspace exceeds the 25 MB limit. Export or remove older searches first.',
      );
    const operation = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      let current: Buffer | null = null;
      try {
        current = await readBytes(this.file);
      } catch (error) {
        if (!(error instanceof TooLargeError)) throw error;
        // Too large to read: keep it as it is before replacing it.
        await this.preserveUnreadable(this.file, null);
      }
      if (current !== null) {
        // Nothing to do when the file already holds exactly this: no rotation, no rewrite.
        if (current.toString('utf8') === text) return;
        const { readable, version } = this.inspect(current);
        const { legacy } = this.options;
        if (legacy && version === legacy.version) await this.keepLegacyCopy(legacy.suffix);
        if (readable) await this.replaceBackup(current);
        else await this.preserveUnreadable(this.file, current);
      }
      await atomicWrite(this.file, text, this.ops);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async keepLegacyCopy(suffix: string): Promise<void> {
    const target = `${this.file}${suffix}`;
    try {
      await copyFile(this.file, target, constants.COPYFILE_EXCL);
      await chmod(target, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  /** Only a readable previous file may become the recovery copy; an unreadable old copy is kept first. */
  private async replaceBackup(previous: Buffer): Promise<void> {
    const backup = `${this.file}.backup`;
    let existing: Buffer | null = null;
    try {
      existing = await readBytes(backup);
    } catch {
      await this.preserveUnreadable(backup, null);
    }
    if (existing !== null) {
      try {
        this.parse(existing);
        if (existing.equals(previous)) return;
      } catch {
        await this.preserveUnreadable(backup, existing);
      }
    }
    await atomicWrite(backup, previous, this.ops);
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

export function createDesktopStore(
  directory: string,
  encryption: CredentialEncryption,
  ops: Partial<StoreOps> = {},
) {
  const fileOps: StoreOps = { ...defaultOps, ...ops };
  // The workspace schema moved to version 2; the released app only opens version 1.
  const workspace = new JsonFile<Workspace>(
    path.join(directory, 'workspace.json'),
    validateWorkspace,
    fileOps,
    { legacy: { version: 1, suffix: '.v1.bak' } },
  );
  const settings = new JsonFile<StoredSettings>(
    path.join(directory, 'settings.json'),
    validateStoredSettings,
    fileOps,
  );
  let cleaned: Promise<void> | undefined;
  const cleanUp = () => (cleaned ??= purgeStaleTemporaries(directory));
  async function loadSettings(): Promise<Settings> {
    await cleanUp();
    const stored = await settings.load();
    if (!stored) return blankSettings();
    if (!stored.encryptedKeys) return { ...blankSettings(), email: stored.email };
    if (!encryption.isEncryptionAvailable())
      throw new Error(
        'The operating system credential vault is unavailable. API keys cannot be unlocked.',
      );
    try {
      const keys = object(
        JSON.parse(encryption.decryptString(Buffer.from(stored.encryptedKeys, 'base64'))),
      );
      // A key added by a later release is simply absent from an older blob.
      return validateSettings({ ...blankSettings(), ...keys, email: stored.email });
    } catch (error) {
      throw new Error('Saved API keys could not be unlocked by this operating system account.', {
        cause: error,
      });
    }
  }
  return {
    flush: () => Promise.all([workspace.flush(), settings.flush()]).then(() => undefined),
    loadWorkspace: async () => {
      await cleanUp();
      return workspace.load();
    },
    saveWorkspace: (value: unknown) => workspace.save(value),
    /** Why the last workspace load used the automatic backup, or null. */
    recoveryNotice: async () => workspace.recoveryNotice(),
    loadSettings,
    /** For searches: unreadable settings must never block a keyless search. */
    async loadSettingsLenient(): Promise<{ settings: Settings; warning: string | null }> {
      try {
        return { settings: await loadSettings(), warning: null };
      } catch {
        const stored = await settings.load().catch(() => null);
        return {
          settings: { ...blankSettings(), email: stored?.email ?? '' },
          warning: SETTINGS_WARNING,
        };
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

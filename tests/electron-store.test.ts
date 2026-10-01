import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  readFile,
  readdir,
  rename as renameFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopStore, type CredentialEncryption, type StoreOps } from '../electron/store';
import type { Workspace } from '../src/types';

const directories: string[] = [];
const encryption: CredentialEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join('')),
  decryptString: (value) => [...value.toString()].reverse().join(''),
};
async function setup(ops: Partial<StoreOps> = {}, crypto = encryption) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apt-store-'));
  directories.push(directory);
  return { directory, store: createDesktopStore(directory, crypto, ops) };
}
function workspace(id: string, version: 1 | 2 = 2): Workspace {
  return {
    version,
    activeId: id,
    snapshots: [
      {
        id,
        name: id,
        query: { text: 'testing', mode: 'topic', sources: ['crossref'], limit: 20 },
        works: [],
        searchedAt: '2026-09-14T12:00:00.000Z',
        sourceResults: [],
      },
    ],
  } as unknown as Workspace;
}
const primary = (directory: string) => path.join(directory, 'workspace.json');
const backupOf = (directory: string) => path.join(directory, 'workspace.json.backup');
const activeIdIn = async (file: string) => JSON.parse(await readFile(file, 'utf8')).activeId;
const corruptCopies = async (directory: string) =>
  (await readdir(directory)).filter((name) => name.endsWith('.corrupt')).sort();

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('saves that change nothing', () => {
  it('leave the recovery copy and the file alone, including the save made at every launch', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('good'));
    await store.saveWorkspace(workspace('mistake'));
    expect(await activeIdIn(backupOf(directory))).toBe('good');
    const before = await stat(primary(directory));

    await store.saveWorkspace(workspace('mistake'));
    // A new process loads the workspace and the interface saves it again, unchanged.
    const reopened = createDesktopStore(directory, encryption);
    await reopened.saveWorkspace((await reopened.loadWorkspace())!);

    expect(await activeIdIn(backupOf(directory))).toBe('good');
    expect(await activeIdIn(primary(directory))).toBe('mistake');
    expect((await stat(primary(directory))).mtimeMs).toBe(before.mtimeMs);
    expect((await readdir(directory)).sort()).toEqual(['workspace.json', 'workspace.json.backup']);
  });
});

describe('the recovery copy', () => {
  it('is the previous file byte for byte, including fields this version does not know', async () => {
    const { store, directory } = await setup();
    const original = JSON.stringify(
      { ...workspace('from-a-newer-build'), futureField: { keep: 'me', é: '日本語' } },
      null,
      4,
    );
    await writeFile(primary(directory), original);
    await store.saveWorkspace(workspace('saved-here'));
    expect(await readFile(backupOf(directory), 'utf8')).toBe(original);
  });

  it('is only ever replaced by a file that could be read', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first'));
    await store.saveWorkspace(workspace('second'));
    await writeFile(primary(directory), '{"version":2,"snapshots":[{"bad":1}],"activeId":null}');
    await store.saveWorkspace(workspace('third'));
    expect(await activeIdIn(backupOf(directory))).toBe('first');
  });
});

describe('a workspace file that is valid JSON but fails validation', () => {
  it('loads the automatic backup and says so, naming the preserved unreadable file', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first'));
    await store.saveWorkspace(workspace('second'));
    expect(await store.recoveryNotice()).toBeNull();
    const unreadable = '{"version":2,"snapshots":[{"bad":1}],"activeId":null}';
    await writeFile(primary(directory), unreadable);

    expect((await store.loadWorkspace())?.activeId).toBe('first');

    const copies = await corruptCopies(directory);
    expect(copies).toHaveLength(1);
    expect(await readFile(path.join(directory, copies[0]), 'utf8')).toBe(unreadable);
    const notice = (await store.recoveryNotice()) ?? '';
    expect(notice).toMatch(/could not be read/);
    expect(notice).toMatch(/automatic backup from .*20\d\d/);
    expect(notice).toContain(copies[0]);

    // Saving afterwards neither duplicates the preserved file nor touches the good backup.
    await store.saveWorkspace(workspace('recovered'));
    expect(await corruptCopies(directory)).toEqual(copies);
    expect(await activeIdIn(backupOf(directory))).toBe('first');
  });

  it('reports the notice for a truncated primary as well, and not for a healthy load', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first'));
    await store.saveWorkspace(workspace('second'));
    await store.loadWorkspace();
    expect(await store.recoveryNotice()).toBeNull();
    await writeFile(primary(directory), '{"truncated');
    await store.loadWorkspace();
    expect(await store.recoveryNotice()).toMatch(/automatic backup/);
  });

  it('says the file was missing when only the backup exists', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first'));
    await store.saveWorkspace(workspace('second'));
    await rm(primary(directory));
    expect((await store.loadWorkspace())?.activeId).toBe('first');
    expect(await store.recoveryNotice()).toMatch(/missing.*automatic backup/);
  });
});

describe('unreadable files are never overwritten without a copy', () => {
  it('keeps the raw bytes of an unreadable backup that a later save would replace', async () => {
    const { store, directory } = await setup();
    await writeFile(primary(directory), '{"truncated primary');
    await writeFile(backupOf(directory), '{"truncated backup, maybe partly recoverable');
    await expect(store.loadWorkspace()).rejects.toThrow('Keep both files for recovery');

    await store.saveWorkspace(workspace('restored-from-import'));
    await store.saveWorkspace(workspace('next-edit'));

    const copies = await corruptCopies(directory);
    const texts = await Promise.all(
      copies.map((name) => readFile(path.join(directory, name), 'utf8')),
    );
    expect(texts.sort()).toEqual(
      ['{"truncated backup, maybe partly recoverable', '{"truncated primary'].sort(),
    );
    expect(copies.some((name) => name.startsWith('workspace.json.backup.'))).toBe(true);
    expect(await activeIdIn(backupOf(directory))).toBe('restored-from-import');
  });

  it('preserves a file written by a newer, unsupported version', async () => {
    const { store, directory } = await setup();
    const future = JSON.stringify({ version: 3, snapshots: [], activeId: null });
    await writeFile(primary(directory), future);
    await store.saveWorkspace(workspace('mine'));
    const copies = await corruptCopies(directory);
    expect(copies).toHaveLength(1);
    expect(await readFile(path.join(directory, copies[0]), 'utf8')).toBe(future);
  });
});

describe('the workspace file format', () => {
  it('is compact JSON, version 2, and pretty files from earlier builds still load', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('compact'));
    const raw = await readFile(primary(directory), 'utf8');
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)));
    expect(JSON.parse(raw).version).toBe(2);

    await writeFile(primary(directory), JSON.stringify(workspace('pretty'), null, 2));
    expect((await store.loadWorkspace())?.activeId).toBe('pretty');
  });

  it('loads a legacy version 1 file as version 2 and writes version 2 afterwards', async () => {
    const { store, directory } = await setup();
    await writeFile(primary(directory), JSON.stringify(workspace('legacy', 1), null, 2));
    expect((await store.loadWorkspace())?.version).toBe(2);
    await store.saveWorkspace(workspace('edited'));
    expect(JSON.parse(await readFile(primary(directory), 'utf8')).version).toBe(2);
  });
});

describe('the original of a legacy version 1 workspace', () => {
  const legacyName = 'workspace.json.v1.bak';
  const legacyBytes = (id: string) =>
    JSON.stringify({ ...workspace(id, 1), note: 'é 日本語' }, null, 2);

  it('is kept byte for byte the first time a save replaces it', async () => {
    const { store, directory } = await setup();
    const original = Buffer.from(legacyBytes('legacy'));
    await writeFile(primary(directory), original);

    await store.saveWorkspace(workspace('first-edit'));

    expect(await readFile(path.join(directory, legacyName))).toEqual(original);
    expect(JSON.parse(await readFile(primary(directory), 'utf8')).version).toBe(2);
    if (process.platform !== 'win32')
      expect((await stat(path.join(directory, legacyName))).mode & 0o077).toBe(0);
  });

  it('is kept when the launch-time save writes the migrated version 2 file', async () => {
    const { store, directory } = await setup();
    const original = JSON.stringify(workspace('legacy', 1), null, 2);
    await writeFile(primary(directory), original);
    await store.saveWorkspace((await store.loadWorkspace())!);
    expect(await readFile(path.join(directory, legacyName), 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(primary(directory), 'utf8')).version).toBe(2);
  });

  it('is never changed by later saves, even if another version 1 file replaces the primary', async () => {
    const { store, directory } = await setup();
    await writeFile(primary(directory), legacyBytes('first-legacy'));
    await store.saveWorkspace(workspace('one'));
    const kept = await readFile(path.join(directory, legacyName));
    const modified = (await stat(path.join(directory, legacyName))).mtimeMs;

    await store.saveWorkspace(workspace('two'));
    expect(await readFile(path.join(directory, legacyName))).toEqual(kept);

    // The older app was used again and wrote another version 1 file; the first copy is not replaced.
    await writeFile(primary(directory), legacyBytes('second-legacy'));
    await store.saveWorkspace(workspace('three'));
    expect(await readFile(path.join(directory, legacyName))).toEqual(kept);
    expect((await stat(path.join(directory, legacyName))).mtimeMs).toBe(modified);
  });

  it('is never created for a version 2 workspace', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('one'));
    await store.saveWorkspace(workspace('two'));
    await store.saveWorkspace(workspace('three'));
    expect(await readdir(directory)).not.toContain(legacyName);
  });

  it('is kept even when the version 1 file no longer passes validation', async () => {
    const { store, directory } = await setup();
    const original = JSON.stringify({ version: 1, snapshots: [{ broken: true }], activeId: null });
    await writeFile(primary(directory), original);
    await store.saveWorkspace(workspace('fresh'));
    expect(await readFile(path.join(directory, legacyName), 'utf8')).toBe(original);
  });

  it('does not apply to the settings file, which has its own version 1 format', async () => {
    const { store, directory } = await setup();
    await store.saveSettings({
      email: 'a@example.org',
      openalexApiKey: '',
      semanticApiKey: '',
      ncbiApiKey: '',
    });
    await store.saveSettings({
      email: 'b@example.org',
      openalexApiKey: '',
      semanticApiKey: '',
      ncbiApiKey: '',
    });
    expect((await readdir(directory)).filter((name) => name.endsWith('.v1.bak'))).toEqual([]);
  });

  it('is not needed when there is no earlier file', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first-ever'));
    expect(await readdir(directory)).toEqual(['workspace.json']);
  });
});

describe('API settings that cannot be read', () => {
  const keyless = { email: '', openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };

  it('default a key that an older version did not store', async () => {
    const { store, directory } = await setup();
    const encryptedKeys = encryption
      .encryptString(JSON.stringify({ openalexApiKey: 'oa-key', semanticApiKey: 'ss-key' }))
      .toString('base64');
    await writeFile(
      path.join(directory, 'settings.json'),
      JSON.stringify({ version: 1, email: 'me@example.org', encryptedKeys }),
    );
    expect(await store.loadSettings()).toEqual({
      email: 'me@example.org',
      openalexApiKey: 'oa-key',
      semanticApiKey: 'ss-key',
      ncbiApiKey: '',
    });
  });

  it('let a search continue without keys, keeping the email, and explain why', async () => {
    const { store, directory } = await setup();
    await store.saveSettings({
      email: 'researcher@example.org',
      openalexApiKey: 'private-openalex-key',
      semanticApiKey: '',
      ncbiApiKey: '',
    });
    const locked = createDesktopStore(directory, {
      ...encryption,
      decryptString: () => {
        throw new Error('locked vault');
      },
    });
    const result = await locked.loadSettingsLenient();
    expect(result.settings).toEqual({ ...keyless, email: 'researcher@example.org' });
    expect(result.warning).toBe(
      'Saved API settings could not be read; searching without API keys. Open Settings to re-enter them.',
    );
    // The strict reader still reports the failure so Settings can explain it.
    await expect(locked.loadSettings()).rejects.toThrow('could not be unlocked');
  });

  it('let a search continue when the vault is unavailable or the settings file is corrupt', async () => {
    const { store, directory } = await setup();
    await store.saveSettings({ ...keyless, email: 'x@example.org', openalexApiKey: 'key' });
    const unavailable = createDesktopStore(directory, {
      ...encryption,
      isEncryptionAvailable: () => false,
    });
    expect((await unavailable.loadSettingsLenient()).warning).toMatch(/searching without API keys/);

    await writeFile(path.join(directory, 'settings.json'), '{corrupt');
    await rm(path.join(directory, 'settings.json.backup'), { force: true });
    const corrupt = createDesktopStore(directory, encryption);
    const result = await corrupt.loadSettingsLenient();
    expect(result.settings).toEqual(keyless);
    expect(result.warning).toMatch(/searching without API keys/);
  });

  it('report no warning when the settings load normally', async () => {
    const { store } = await setup();
    await store.saveSettings({ ...keyless, email: 'fine@example.org', ncbiApiKey: 'ncbi' });
    expect(await store.loadSettingsLenient()).toEqual({
      settings: { ...keyless, email: 'fine@example.org', ncbiApiKey: 'ncbi' },
      warning: null,
    });
    expect((await (await setup()).store.loadSettingsLenient()).warning).toBeNull();
  });
});

describe('durable writes', () => {
  it('flush a file to disk before it replaces the old one, and sync the directory afterwards', async () => {
    const events: string[] = [];
    const { store } = await setup({
      async syncFile(handle) {
        events.push('sync-file');
        await handle.sync();
      },
      async syncDirectory() {
        events.push('sync-directory');
      },
      async rename(from, to) {
        events.push('rename');
        await renameFile(from, to);
      },
    });
    await store.saveWorkspace(workspace('one'));
    await store.saveWorkspace(workspace('two'));
    // First save: only the primary. Second: the recovery copy, then the primary.
    expect(events).toEqual([
      ...['sync-file', 'rename', 'sync-directory'],
      ...['sync-file', 'rename', 'sync-directory'],
      ...['sync-file', 'rename', 'sync-directory'],
    ]);
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'retry the rename after a transient %s, as when a virus scanner holds the file',
    async (code) => {
      let failures = 2;
      const waits: number[] = [];
      const { store, directory } = await setup({
        async rename(from, to) {
          if (failures-- > 0) throw Object.assign(new Error(`${code}: busy`), { code });
          await renameFile(from, to);
        },
        async sleep(milliseconds) {
          waits.push(milliseconds);
        },
      });
      await store.saveWorkspace(workspace('eventually'));
      expect(await activeIdIn(primary(directory))).toBe('eventually');
      expect(waits).toHaveLength(2);
      expect(waits[1]).toBeGreaterThan(waits[0]);
      expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
  );

  it('give up after a bounded number of retries, keep the old file, and remove the temporary file', async () => {
    let attempts = 0;
    const { store, directory } = await setup({
      async rename() {
        attempts += 1;
        throw Object.assign(new Error('EPERM: locked'), { code: 'EPERM' });
      },
      async sleep() {},
    });
    await expect(store.saveWorkspace(workspace('never'))).rejects.toThrow('EPERM');
    expect(attempts).toBeGreaterThan(2);
    expect(attempts).toBeLessThanOrEqual(10);
    expect(await readdir(directory)).toEqual([]);
  });

  it('do not retry an error that waiting cannot fix', async () => {
    let attempts = 0;
    const { store } = await setup({
      async rename() {
        attempts += 1;
        throw Object.assign(new Error('ENOSPC: disk full'), { code: 'ENOSPC' });
      },
      async sleep() {},
    });
    await expect(store.saveWorkspace(workspace('full'))).rejects.toThrow('ENOSPC');
    expect(attempts).toBe(1);
  });

  it('remove abandoned temporary files older than a minute when the store is opened', async () => {
    const { store, directory } = await setup();
    const id = 'c0ffee00-1234-4abc-8def-0123456789ab';
    const stale = [
      `workspace.json.${id}.tmp`,
      `workspace.json.backup.${id}.tmp`,
      `settings.json.${id}.tmp`,
    ];
    const fresh = `workspace.json.11111111-2222-4333-8444-555555555555.tmp`;
    const unrelated = 'notes.tmp';
    const longAgo = Date.now() / 1000 - 120;
    for (const name of [...stale, fresh, unrelated]) {
      await writeFile(path.join(directory, name), 'partial');
      if (name !== fresh) await utimes(path.join(directory, name), longAgo, longAgo);
    }
    await store.loadWorkspace();
    expect((await readdir(directory)).sort()).toEqual([fresh, unrelated].sort());
  });
});

describe('file permissions', () => {
  it('keep the workspace and its recovery copy private to the user', async () => {
    if (process.platform === 'win32') return;
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('one'));
    await store.saveWorkspace(workspace('two'));
    for (const file of [primary(directory), backupOf(directory)])
      expect((await stat(file)).mode & 0o077).toBe(0);
  });
});

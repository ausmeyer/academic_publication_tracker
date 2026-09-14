import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopStore, type CredentialEncryption } from '../electron/store';
import type { Workspace } from '../src/types';

const directories: string[] = [];
const encryption: CredentialEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join('')),
  decryptString: (value) => [...value.toString()].reverse().join(''),
};
async function setup(crypto = encryption) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apt-store-'));
  directories.push(directory);
  return { directory, store: createDesktopStore(directory, crypto) };
}
function workspace(id: string): Workspace {
  return {
    version: 1,
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
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('desktop workspace persistence', () => {
  it('returns no workspace on the first launch and serializes concurrent writes', async () => {
    const { store, directory } = await setup();
    expect(await store.loadWorkspace()).toBeNull();
    await Promise.all([
      store.saveWorkspace(workspace('first')),
      store.saveWorkspace(workspace('second')),
      store.saveWorkspace(workspace('third')),
    ]);
    expect(await store.loadWorkspace()).toEqual(workspace('third'));
    expect(
      JSON.parse(await readFile(path.join(directory, 'workspace.json.backup'), 'utf8')),
    ).toEqual(workspace('second'));
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('recovers from a corrupt primary and preserves the valid backup during the next save', async () => {
    const { store, directory } = await setup();
    await store.saveWorkspace(workspace('first'));
    await store.saveWorkspace(workspace('second'));
    await writeFile(path.join(directory, 'workspace.json'), '{broken');
    expect(await store.loadWorkspace()).toEqual(workspace('first'));
    await store.saveWorkspace(workspace('recovered'));
    expect(await store.loadWorkspace()).toEqual(workspace('recovered'));
    expect(
      JSON.parse(await readFile(path.join(directory, 'workspace.json.backup'), 'utf8')),
    ).toEqual(workspace('first'));
    const recoveryCopies = (await readdir(directory)).filter((name) => name.endsWith('.corrupt'));
    expect(recoveryCopies).toHaveLength(1);
    expect(await readFile(path.join(directory, recoveryCopies[0]), 'utf8')).toBe('{broken');
  });

  it('retains the exact corrupt original when an explicit restore replaces a workspace without a backup', async () => {
    const { store, directory } = await setup();
    const original = Buffer.from([0xff, 0xfe, 0x00, 0x7b, 0x22, 0x78]);
    await writeFile(path.join(directory, 'workspace.json'), original);
    await expect(store.loadWorkspace()).rejects.toThrow('no valid backup');
    await store.saveWorkspace(workspace('restored'));
    const recoveryCopies = (await readdir(directory)).filter(
      (name) => name.startsWith('workspace.json.') && name.endsWith('.corrupt'),
    );
    expect(recoveryCopies).toHaveLength(1);
    expect(await readFile(path.join(directory, recoveryCopies[0]))).toEqual(original);
    expect(await store.loadWorkspace()).toEqual(workspace('restored'));
  });

  it('rejects unsupported and malformed workspaces before touching existing data', async () => {
    const { store } = await setup();
    await store.saveWorkspace(workspace('valid'));
    expect(() => store.saveWorkspace({ version: 2, snapshots: [], activeId: null })).toThrow();
    expect(() => store.saveWorkspace({ version: 1, snapshots: [], activeId: 'missing' })).toThrow();
    expect(await store.loadWorkspace()).toEqual(workspace('valid'));
  });

  it('reports a corrupt workspace when there is no recovery copy', async () => {
    const { store, directory } = await setup();
    await writeFile(path.join(directory, 'workspace.json'), 'null');
    await expect(store.loadWorkspace()).rejects.toThrow('no valid backup');
  });
});

describe('desktop credentials', () => {
  const settings = {
    email: 'researcher@example.org',
    openalexApiKey: 'private-openalex-key',
    semanticApiKey: 'private-semantic-key',
    ncbiApiKey: '',
  };

  it('round trips keys through the OS encryption adapter and keeps plaintext out of files and backups', async () => {
    const { store, directory } = await setup();
    await store.saveSettings(settings);
    await store.saveSettings({ ...settings, ncbiApiKey: 'private-ncbi-key' });
    expect(await store.loadSettings()).toEqual({ ...settings, ncbiApiKey: 'private-ncbi-key' });
    for (const file of await readdir(directory)) {
      const raw = await readFile(path.join(directory, file), 'utf8');
      expect(raw).not.toContain('private-');
      expect(raw).not.toContain('openalexApiKey');
    }
  });

  it('refuses to persist keys when encryption is unavailable, but supports keyless settings', async () => {
    const { store, directory } = await setup({ ...encryption, isEncryptionAvailable: () => false });
    await expect(store.saveSettings(settings)).rejects.toThrow('were not saved');
    expect(await readdir(directory)).toEqual([]);
    const empty = { email: settings.email, openalexApiKey: '', semanticApiKey: '', ncbiApiKey: '' };
    await store.saveSettings(empty);
    expect(await store.loadSettings()).toEqual(empty);
  });

  it('reports keys that cannot be decrypted instead of treating them as blank credentials', async () => {
    const { store, directory } = await setup();
    await store.saveSettings(settings);
    const locked = createDesktopStore(directory, {
      ...encryption,
      decryptString: () => {
        throw new Error('locked vault');
      },
    });
    await expect(locked.loadSettings()).rejects.toThrow('could not be unlocked');
  });
});

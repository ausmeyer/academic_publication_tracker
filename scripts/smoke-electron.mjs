import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect } from '@playwright/test';

// Pass a packaged application executable to verify an installer candidate.
// With no argument, verify the actual built app through the development runtime.
const requestedExecutable =
  process.argv[2] === '--packaged'
    ? process.platform === 'darwin'
      ? path.join(
          'release',
          process.arch === 'arm64' ? 'mac-arm64' : 'mac',
          'Academic Publication Tracker.app',
          'Contents',
          'MacOS',
          'Academic Publication Tracker',
        )
      : path.join('release', 'win-unpacked', 'Academic Publication Tracker.exe')
    : process.argv[2];
const executablePath = requestedExecutable ? path.resolve(requestedExecutable) : undefined;
const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const profile = await mkdtemp(path.join(os.tmpdir(), 'apt-electron-smoke-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.APT_RENDERER_URL;
delete env.APT_USER_DATA_DIR;
let application;

try {
  application = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [process.cwd()]), `--user-data-dir=${profile}`],
    env,
    timeout: 45000,
  });
  const window = await application.firstWindow();
  const pageErrors = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  await window.getByRole('heading', { name: /Your research/ }).waitFor({ state: 'visible' });
  if (process.env.APT_SMOKE_SCREENSHOT) {
    await window.screenshot({ path: process.env.APT_SMOKE_SCREENSHOT, animations: 'disabled' });
  }
  const metadata = await application.evaluate(({ app, BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
    };
  });
  assert.equal(
    await realpath(metadata.userData),
    await realpath(profile),
    'Smoke test must use its isolated profile.',
  );
  assert.equal(metadata.name, 'Academic Publication Tracker');
  assert.equal(metadata.version, packageVersion, 'The running app must match the release version.');
  assert.equal(metadata.packaged, Boolean(executablePath));
  assert.equal(metadata.sandbox, true);
  assert.equal(metadata.contextIsolation, true);
  assert.equal(metadata.nodeIntegration, false);
  await window.getByRole('button', { name: /New search/ }).click();
  const dialog = window.getByRole('dialog');
  const author = dialog.getByRole('textbox', { name: 'Author name' });
  assert.equal(await author.inputValue(), '');
  assert.equal(await author.getAttribute('placeholder'), 'Enter an author name');
  assert.doesNotMatch(await dialog.innerText(), /Austin|Meyer/i);
  assert.equal(await dialog.getByRole('checkbox').count(), 8);
  for (const source of ['Google Scholar', 'Preprints', 'DataCite']) {
    assert.equal(await dialog.getByRole('checkbox', { name: new RegExp(source) }).count(), 1);
  }
  if (process.env.APT_SEARCH_SCREENSHOT) {
    await expect(dialog).toHaveCSS('opacity', '1');
    await window.screenshot({ path: process.env.APT_SEARCH_SCREENSHOT, animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Observe the native writer without replacing the user's system clipboard.
  await application.evaluate(({ clipboard }) => {
    globalThis.__aptSmokeClipboard = { original: clipboard.writeText, written: null };
    clipboard.writeText = (text) => {
      globalThis.__aptSmokeClipboard.written = text;
    };
  });
  const result = await window.evaluate(async () => {
    const desktop = window.desktop;
    if (!desktop) throw new Error('The desktop bridge is missing.');
    const workspace = { version: 1, snapshots: [], activeId: null };
    await desktop.saveWorkspace(workspace);
    const saved = await desktop.loadWorkspace();
    const settings = {
      email: 'smoke@example.invalid',
      openalexApiKey: '',
      semanticApiKey: '',
      ncbiApiKey: '',
    };
    await desktop.saveSettings(settings);
    const loadedSettings = await desktop.loadSettings();
    await desktop.copyText('10.1234/apt-desktop-smoke');
    async function rejects(operation) {
      try {
        await operation();
        return false;
      } catch {
        return true;
      }
    }
    return {
      saved,
      settingsRoundtrip: JSON.stringify(loadedSettings) === JSON.stringify(settings),
      rendererNode: typeof window.require,
      invalidWorkspaceRejected: await rejects(() => desktop.saveWorkspace({ version: 999 })),
      invalidSearchRejected: await rejects(() =>
        desktop.search({ text: '', mode: 'topic', sources: ['crossref'], limit: 20 }),
      ),
      fileUrlRejected: await rejects(() => desktop.openExternal('file:///not-a-publication')),
      invalidClipboardRejected: await rejects(() => desktop.copyText({ invalid: true })),
    };
  });
  assert.deepEqual(result.saved, { version: 1, snapshots: [], activeId: null });
  assert.equal(result.settingsRoundtrip, true);
  assert.equal(result.rendererNode, 'undefined');
  assert.equal(result.invalidWorkspaceRejected, true);
  assert.equal(result.invalidSearchRejected, true);
  assert.equal(result.fileUrlRejected, true);
  assert.equal(result.invalidClipboardRejected, true);
  const copied = await application.evaluate(({ clipboard }) => {
    const { original, written } = globalThis.__aptSmokeClipboard;
    clipboard.writeText = original;
    delete globalThis.__aptSmokeClipboard;
    return written;
  });
  assert.equal(copied, '10.1234/apt-desktop-smoke');
  assert.deepEqual(pageErrors, []);
  await application.close();
  application = undefined;
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'workspace.json'), 'utf8')), {
    version: 1,
    snapshots: [],
    activeId: null,
  });
  console.log(
    `Desktop smoke passed: ${metadata.name} ${metadata.version} (${metadata.packaged ? 'packaged' : 'development'}, ${process.platform}).`,
  );
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

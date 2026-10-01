import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
const extraProfiles = [];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.APT_RENDERER_URL;
delete env.APT_USER_DATA_DIR;
let application;
const servers = [];

async function launch(userDataDirectory) {
  return _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [process.cwd()]), `--user-data-dir=${userDataDirectory}`],
    env,
    timeout: 45000,
  });
}
async function freshProfile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apt-electron-smoke-extra-'));
  extraProfiles.push(directory);
  return directory;
}
const at = '2026-09-14T15:00:00.000Z';
function seededWorkspace(notes = '') {
  const work = {
    id: 'smoke:one',
    title: 'Evaluating epidemic forecasts across changing conditions',
    authors: ['Jane Scholar', 'Alex Researcher'],
    year: 2021,
    venue: 'Journal of Research Methods',
    doi: '10.1234/smoke-one',
    abstract: 'A synthetic record for the desktop smoke check.',
    type: 'journal-article',
    url: 'https://doi.org/10.1234/smoke-one',
    openAccessUrl: '',
    isOpenAccess: false,
    citations: 42,
    provenance: [{ source: 'crossref', sourceId: 'one', citations: 42, retrievedAt: at, url: '' }],
    included: true,
    tags: [],
    notes,
  };
  return {
    version: 2,
    activeId: 'snapshot-1',
    snapshots: [
      {
        id: 'snapshot-1',
        name: 'Smoke search',
        query: { text: 'smoke', mode: 'topic', sources: ['crossref'], limit: 25 },
        works: [work],
        searchedAt: at,
        sourceResults: [{ source: 'crossref', total: 1 }],
      },
    ],
  };
}
const seededTitle = seededWorkspace().snapshots[0].works[0].title;
const seededPaper = (page) => page.getByRole('button', { name: seededTitle, exact: true });
const readWorkspace = async (directory) =>
  JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
async function waitForExit(app, milliseconds = 15000) {
  await Promise.race([
    app.waitForEvent('close'),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The application did not exit.')), milliseconds),
    ),
  ]);
}

try {
  application = await launch(profile);
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

  // The production content-security policy must not allow the development server or websockets.
  const policy = await window
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  assert.match(policy, /connect-src 'self'(?:;|$)/, 'The shipped policy restricts connect-src.');
  assert.doesNotMatch(policy, /127\.0\.0\.1|ws:|localhost/, 'No development origins ship.');
  if (!executablePath) {
    const builtPage = await readFile(path.join('dist', 'index.html'), 'utf8');
    assert.match(
      builtPage,
      /connect-src 'self'(?:;|\s|")/,
      'dist/index.html restricts connect-src.',
    );
    assert.doesNotMatch(builtPage, /127\.0\.0\.1|ws:\/\//, 'dist/index.html has no dev origins.');
  }

  await window.getByRole('button', { name: /New search/ }).click();
  const dialog = window.getByRole('dialog');
  const author = dialog.getByRole('textbox', { name: 'Author name' });
  assert.equal(await author.inputValue(), '');
  assert.equal(await author.getAttribute('placeholder'), 'Enter an author name');
  assert.doesNotMatch(await dialog.innerText(), /Austin|Meyer/i);
  await expect(dialog.getByRole('checkbox')).toHaveCount(8);
  for (const source of ['Google Scholar', 'Preprints', 'DataCite']) {
    await expect(dialog.getByRole('checkbox', { name: new RegExp(source) })).toHaveCount(1);
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
    const workspace = { version: 2, snapshots: [], activeId: null };
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
    async function rejection(operation) {
      try {
        await operation();
        return null;
      } catch (error) {
        return error.message;
      }
    }
    return {
      saved,
      settingsRoundtrip: JSON.stringify(loadedSettings) === JSON.stringify(settings),
      rendererNode: typeof window.require,
      bridge: {
        flush: typeof desktop.onFlushRequest,
        notice: typeof desktop.recoveryNotice,
        noticeValue: await desktop.recoveryNotice?.(),
      },
      invalidWorkspace: await rejection(() => desktop.saveWorkspace({ version: 999 })),
      emptySearch: await rejection(() =>
        desktop.search({ text: '', mode: 'topic', sources: ['crossref'], limit: 20 }),
      ),
      shortSearch: await rejection(() =>
        desktop.search({ text: 'x', mode: 'topic', sources: ['crossref'], limit: 20 }),
      ),
      badDoi: await rejection(() =>
        desktop.search({ text: 'not a doi', mode: 'doi', sources: ['crossref'], limit: 20 }),
      ),
      fileUrl: await rejection(() => desktop.openExternal('file:///not-a-publication')),
      invalidClipboard: await rejection(() => desktop.copyText({ invalid: true })),
    };
  });
  assert.deepEqual(result.saved, { version: 2, snapshots: [], activeId: null });
  assert.equal(result.settingsRoundtrip, true);
  assert.equal(result.rendererNode, 'undefined');
  assert.deepEqual(result.bridge, { flush: 'function', notice: 'function', noticeValue: null });
  // Rejections reach the interface as plain messages, without Electron's "Error invoking remote method".
  assert.equal(result.invalidWorkspace, 'This workspace version is not supported.');
  assert.equal(result.emptySearch, 'Enter a search between 2 and 500 characters.');
  assert.equal(result.shortSearch, 'Enter a search between 2 and 500 characters.');
  assert.equal(result.badDoi, 'Enter a complete DOI, such as 10.1038/nature12373.');
  for (const message of [result.fileUrl, result.invalidClipboard]) {
    assert.ok(message, 'Invalid requests are rejected.');
    assert.doesNotMatch(message, /Error invoking remote method/);
  }
  const copied = await application.evaluate(({ clipboard }) => {
    const { original, written } = globalThis.__aptSmokeClipboard;
    clipboard.writeText = original;
    delete globalThis.__aptSmokeClipboard;
    return written;
  });
  assert.equal(copied, '10.1234/apt-desktop-smoke');

  // The error screen's "Reload app" calls location.reload(); the navigation lockdown must allow it.
  await window.evaluate(() => {
    window.__aptBeforeReload = true;
  });
  await window.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  await expect
    .poll(() => window.evaluate(() => window.__aptBeforeReload).catch(() => 'reloading'), {
      message: 'location.reload() must reload the page instead of being blocked.',
      timeout: 10000,
    })
    .toBeUndefined();
  await window.getByRole('heading', { name: /Your research/ }).waitFor({ state: 'visible' });
  // Other navigations stay blocked: the window cannot be sent somewhere else.
  const stayedPut = await window.evaluate(() => {
    const before = location.href;
    window.__aptStillHere = true;
    location.href = 'https://example.org/';
    return before;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await window.evaluate(() => location.href), stayedPut);
  assert.equal(await window.evaluate(() => window.__aptStillHere), true);

  // Only the application's own page may use its IPC channels: another window, even one that can
  // reach ipcRenderer, is refused.
  const probeDirectory = await freshProfile();
  await writeFile(
    path.join(probeDirectory, 'probe-preload.cjs'),
    "const { contextBridge, ipcRenderer } = require('electron');" +
      "contextBridge.exposeInMainWorld('probe', { invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args), send: (channel, ...args) => ipcRenderer.send(channel, ...args) });",
  );
  const foreign = await application.evaluate(
    async ({ BrowserWindow }, preload) => {
      const stranger = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      await stranger.loadURL('data:text/html,<title>stranger</title>');
      const attempts = {};
      for (const channel of [
        'apt:workspace:load',
        'apt:workspace:notice',
        'apt:settings:load',
        'apt:search',
        'apt:external',
      ]) {
        attempts[channel] = await stranger.webContents.executeJavaScript(
          `window.probe.invoke(${JSON.stringify(channel)}, 'https://example.org').then(() => 'allowed', (error) => error.message)`,
        );
      }
      // A forged acknowledgement must not be taken for the application's own.
      await stranger.webContents.executeJavaScript("window.probe.send('apt:flushed', 1)");
      stranger.destroy();
      return attempts;
    },
    path.join(probeDirectory, 'probe-preload.cjs'),
  );
  for (const [channel, outcome] of Object.entries(foreign))
    assert.match(
      outcome,
      /did not originate from the application/,
      `${channel} must refuse a window that is not the application.`,
    );

  // Provider requests use Electron's network stack (system proxy and certificates): it must honour
  // the options the source adapters rely on, redirect: 'error' and AbortSignal.
  const streamsClosed = [];
  const server = createServer((request, response) => {
    if (request.url === '/json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, agent: request.headers['user-agent'] }));
    } else if (request.url === '/redirect') {
      response.statusCode = 302;
      response.setHeader('location', '/json');
      response.end();
    } else if (request.url === '/slow') {
      setTimeout(() => response.end('late'), 4000);
    } else if (request.url === '/limited') {
      response.statusCode = 429;
      response.setHeader('retry-after', '7');
      response.end('slow down');
    } else if (request.url === '/limited-date') {
      response.statusCode = 503;
      response.setHeader('retry-after', new Date(Date.now() + 5000).toUTCString());
      response.end();
    } else if (request.url.startsWith('/stream')) {
      // An endless body: the client must be able to stop reading it.
      response.writeHead(200, { 'content-type': 'text/plain' });
      const timer = setInterval(() => response.write('x'.repeat(1024)), 5);
      response.on('close', () => {
        clearInterval(timer);
        streamsClosed.push(request.url);
      });
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const netFetch = await application.evaluate(async ({ net }, port) => {
    const base = `http://127.0.0.1:${port}`;
    const out = {};
    const ok = await net.fetch(new URL(`${base}/json`), {
      headers: { Accept: 'application/json', 'User-Agent': 'AcademicPublicationTracker/smoke' },
      redirect: 'error',
    });
    out.status = ok.status;
    out.body = await ok.json();
    try {
      await net.fetch(`${base}/redirect`, { redirect: 'error' });
      out.redirect = 'followed';
    } catch {
      out.redirect = 'rejected';
    }
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 200);
    try {
      await (
        await net.fetch(`${base}/slow`, { signal: controller.signal, redirect: 'error' })
      ).text();
      out.abort = 'completed';
    } catch (error) {
      out.abort = error.name;
    }
    out.abortMs = Date.now() - started;
    // The retry logic reads Retry-After from the response headers.
    const limited = await net.fetch(new URL(`${base}/limited`));
    out.limited = {
      status: limited.status,
      ok: limited.ok,
      retryAfter: limited.headers.get('retry-after'),
    };
    await limited.body?.cancel();
    const dated = await net.fetch(`${base}/limited-date`, { redirect: 'error' });
    out.limitedDate = {
      status: dated.status,
      parses: Number.isFinite(Date.parse(dated.headers.get('retry-after'))),
    };
    await dated.body?.cancel();
    out.missing = (await net.fetch(`${base}/nothing`)).status;
    // A string and a URL object are both accepted as the address.
    out.stringInput = (await net.fetch(`${base}/json`)).status;
    // Bodies can be read as a stream and abandoned early (the adapters cap the bytes they read).
    const streamed = await net.fetch(new URL(`${base}/stream?reader`), { redirect: 'error' });
    const reader = streamed.body.getReader();
    let bytes = 0;
    while (bytes < 20000) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
    const cancelStarted = Date.now();
    await reader.cancel();
    out.readerCancelMs = Date.now() - cancelStarted;
    out.streamBytes = bytes;
    const dropped = await net.fetch(new URL(`${base}/stream?cancel`));
    const dropStarted = Date.now();
    await dropped.body.cancel();
    out.bodyCancelMs = Date.now() - dropStarted;
    // An abort after the headers arrived stops the body read as well.
    const late = new AbortController();
    const lateResponse = await net.fetch(`${base}/stream?abort`, { signal: late.signal });
    const lateReader = lateResponse.body.getReader();
    await lateReader.read();
    late.abort();
    try {
      for (let i = 0; i < 1000; i += 1) if ((await lateReader.read()).done) break;
      out.bodyAbort = 'completed';
    } catch (error) {
      out.bodyAbort = error.name;
    }
    return out;
  }, server.address().port);
  assert.equal(netFetch.status, 200);
  assert.deepEqual(netFetch.body, { ok: true, agent: 'AcademicPublicationTracker/smoke' });
  assert.equal(netFetch.redirect, 'rejected', "net.fetch must honour redirect: 'error'.");
  assert.equal(netFetch.abort, 'AbortError', 'net.fetch must honour AbortSignal.');
  assert.ok(
    netFetch.abortMs < 3500,
    `An aborted request ends promptly (took ${netFetch.abortMs} ms).`,
  );
  assert.deepEqual(netFetch.limited, { status: 429, ok: false, retryAfter: '7' });
  assert.deepEqual(netFetch.limitedDate, { status: 503, parses: true });
  assert.equal(netFetch.missing, 404);
  assert.equal(netFetch.stringInput, 200, 'net.fetch accepts a string address.');
  assert.ok(
    netFetch.streamBytes >= 20000,
    `A body can be read as a stream (read ${netFetch.streamBytes} bytes).`,
  );
  assert.ok(
    netFetch.readerCancelMs < 3000 && netFetch.bodyCancelMs < 3000,
    `A body can be abandoned (${netFetch.readerCancelMs} and ${netFetch.bodyCancelMs} ms).`,
  );
  assert.equal(netFetch.bodyAbort, 'AbortError', 'An abort also stops a body that is being read.');
  // Only an AbortSignal ends the connection of a body that is being abandoned; cancelling the
  // stream merely stops reading it. The source adapters abort in a finally block for that reason.
  await expect
    .poll(() => streamsClosed.includes('/stream?abort'), {
      message: 'Aborting a request closes its connection.',
    })
    .toBe(true);

  assert.deepEqual(pageErrors, []);
  await application.close();
  application = undefined;
  // Compact JSON, written by this version (schema 2).
  assert.equal(
    await readFile(path.join(profile, 'workspace.json'), 'utf8'),
    JSON.stringify({ version: 2, snapshots: [], activeId: null }),
  );

  if (executablePath) {
    // The fuses that electron-builder.yml asks for must be in the binary that ships.
    const { getCurrentFuseWire, FuseV1Options } = await import('@electron/fuses');
    const fuses = await getCurrentFuseWire(executablePath);
    const ENABLED = 49;
    const DISABLED = 48;
    for (const [name, state] of [
      ['RunAsNode', DISABLED],
      ['EnableNodeOptionsEnvironmentVariable', DISABLED],
      ['EnableCookieEncryption', ENABLED],
      ['EnableEmbeddedAsarIntegrityValidation', ENABLED],
      ['OnlyLoadAppFromAsar', ENABLED],
    ])
      assert.equal(
        fuses[FuseV1Options[name]],
        state,
        `Fuse ${name} must be ${state === ENABLED ? 'on' : 'off'}.`,
      );
    if (process.platform === 'darwin') {
      // The signed bundle carries the entitlements of build/entitlements.mac.plist: the two that
      // Electron needs, and not the one that turns library validation off.
      const bundle = path.resolve(executablePath, '..', '..', '..');
      const entitlements = await new Promise((resolve, reject) =>
        execFile('codesign', ['-d', '--entitlements', '-', bundle], (error, stdout, stderr) =>
          error ? reject(error) : resolve(`${stdout}${stderr}`),
        ),
      );
      assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
      assert.doesNotMatch(entitlements, /disable-library-validation/);
    }
    // A packaged app must not be usable as a Node.js interpreter through ELECTRON_RUN_AS_NODE.
    const scratch = await freshProfile();
    const child = spawn(
      executablePath,
      [`--user-data-dir=${scratch}`, '-e', 'console.log("NODE_RAN")'],
      {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    await new Promise((resolve) => setTimeout(resolve, 4000));
    child.kill();
    assert.doesNotMatch(output, /NODE_RAN/, 'ELECTRON_RUN_AS_NODE must be ignored.');
  }

  // Edits the interface still holds are saved when the window closes and before the app quits.
  async function flushScenario(marker, answer, finish) {
    const directory = await freshProfile();
    await writeFile(path.join(directory, 'workspace.json'), JSON.stringify(seededWorkspace()));
    const app = await launch(directory);
    try {
      const page = await app.firstWindow();
      await seededPaper(page).waitFor();
      await page.evaluate(
        ({ marker, answer }) => {
          window.desktop.onFlushRequest(async () => {
            if (answer === 'never') return new Promise(() => {});
            // A save that takes a moment: the app must wait for it before it writes and quits.
            await new Promise((resolve) => setTimeout(resolve, 400));
            const workspace = await window.desktop.loadWorkspace();
            workspace.snapshots[0].works[0].notes = marker;
            await window.desktop.saveWorkspace(workspace);
          });
        },
        { marker, answer },
      );
      const started = Date.now();
      await finish(app, directory);
      return { directory, elapsed: Date.now() - started };
    } finally {
      await app.close().catch(() => undefined);
    }
  }
  const notesOf = async (directory) => (await readWorkspace(directory)).snapshots[0].works[0].notes;
  const quitApp = (app) =>
    app.evaluate(({ app: electron }) => {
      setTimeout(() => electron.quit(), 0);
    });

  await flushScenario('saved when the window closed', 'slow-save', async (app, directory) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await expect
      .poll(() => notesOf(directory), { message: 'Closing the window asks the interface to save.' })
      .toBe('saved when the window closed');
  });
  const quit = await flushScenario(
    'saved before the app quit',
    'slow-save',
    async (app, directory) => {
      await quitApp(app);
      await waitForExit(app);
      assert.equal(
        await notesOf(directory),
        'saved before the app quit',
        'Quitting waits for the interface to finish saving.',
      );
    },
  );
  assert.ok(quit.elapsed < 20000, `Quitting after a save is prompt (${quit.elapsed} ms).`);
  const unanswered = await flushScenario('never written', 'never', async (app, directory) => {
    await quitApp(app);
    await waitForExit(app, 15000);
    assert.equal(
      await notesOf(directory),
      '',
      'An interface that never answers is not waited for.',
    );
  });
  assert.ok(
    unanswered.elapsed < 25000,
    `Waiting for the interface is bounded (${unanswered.elapsed} ms).`,
  );

  // A workspace file that cannot be read falls back to the automatic backup, visibly.
  {
    const directory = await freshProfile();
    await writeFile(
      path.join(directory, 'workspace.json'),
      '{"version":2,"snapshots":[{"bad":1}],"activeId":null}',
    );
    await writeFile(
      path.join(directory, 'workspace.json.backup'),
      JSON.stringify(seededWorkspace()),
    );
    const app = await launch(directory);
    try {
      const page = await app.firstWindow();
      await seededPaper(page).waitFor();
      const notice = await page.evaluate(() => window.desktop.recoveryNotice());
      assert.match(notice, /could not be read; the automatic backup from .* was loaded/);
      const kept = /preserved as (workspace\.json\.[^\s]+\.corrupt)/.exec(notice)?.[1];
      assert.ok(kept, 'The notice names the preserved unreadable file.');
      assert.equal(
        await readFile(path.join(directory, kept), 'utf8'),
        '{"version":2,"snapshots":[{"bad":1}],"activeId":null}',
      );
    } finally {
      await app.close().catch(() => undefined);
    }
  }

  // A crashed page is reloaded automatically instead of leaving a blank window.
  {
    const app = await launch(await freshProfile());
    try {
      const page = await app.firstWindow();
      await page.getByRole('heading', { name: /Your research/ }).waitFor();
      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        globalThis.__aptLoads = 0;
        contents.on('did-finish-load', () => {
          globalThis.__aptLoads += 1;
        });
        contents.forcefullyCrashRenderer();
      });
      await expect
        .poll(() => app.evaluate(() => globalThis.__aptLoads), {
          message: 'The window reloads after its page crashes.',
          timeout: 20000,
        })
        .toBeGreaterThan(0);
      // Playwright's page handle does not follow the new renderer process, so ask the window itself.
      await expect
        .poll(
          () =>
            app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
                'document.body.innerText',
              ),
            ),
          { message: 'The reloaded page shows the application.', timeout: 15000 },
        )
        .toMatch(/Your research/);
    } finally {
      await app.close().catch(() => undefined);
    }
  }

  // Typing a note and quitting without leaving the field must keep the note: the desktop shell asks
  // the interface to flush its pending save before it quits.
  {
    const typed = 'typed without leaving the field';
    const directory = await freshProfile();
    await writeFile(path.join(directory, 'workspace.json'), JSON.stringify(seededWorkspace()));
    let saved = null;
    const app = await launch(directory);
    try {
      const page = await app.firstWindow();
      await seededPaper(page).click();
      await page.getByLabel('Research notes').fill(typed);
      await quitApp(app);
      await waitForExit(app);
      saved = await notesOf(directory);
    } catch (error) {
      saved = `error: ${error.message}`;
    } finally {
      await app.close().catch(() => undefined);
    }
    assert.equal(saved, typed, 'A note typed without leaving the field must survive quit.');
  }

  // Work the interface could not save (search results held because the workspace is full, edits
  // whose save failed) exists only in its memory. While the interface reports it, closing the window
  // or quitting asks first, after the interface has had its chance to save. The failure is real: a
  // directory stands where the recovery copy belongs, so every save through the actual store fails
  // until the scenario removes it. (The interface recomputes what it reports at every flush, so a
  // report injected from outside would be overwritten; the state has to be genuine.)
  const unsavedText = 'Changes that could not be saved.';
  const edit = 'an edit that cannot be saved yet';
  async function unsavedScenario(run) {
    const directory = await freshProfile();
    await writeFile(path.join(directory, 'workspace.json'), JSON.stringify(seededWorkspace()));
    const blocker = path.join(directory, 'workspace.json.backup');
    await mkdir(blocker);
    const app = await launch(directory);
    try {
      const page = await app.firstWindow();
      await seededPaper(page).waitFor();
      await app.evaluate(({ dialog }) => {
        // Questions take the queued answers, then "Go back", which keeps the application open: a
        // question that should not be asked leaves the scenario waiting for an exit that never comes.
        globalThis.__aptQuestions = [];
        globalThis.__aptAnswers = [];
        globalThis.__aptOtherwise = 0;
        dialog.showMessageBox = async (...args) => {
          const { message, detail, buttons, defaultId, cancelId } = args.at(-1);
          globalThis.__aptQuestions.push({ message, detail, buttons, defaultId, cancelId });
          return {
            response: globalThis.__aptAnswers.shift() ?? globalThis.__aptOtherwise,
            checkboxChecked: false,
          };
        };
      });
      // An edit that cannot be saved: the interface says so and reports it to the shell.
      await seededPaper(page).click();
      await page.getByLabel('Research notes').fill(edit);
      await expect(page.getByText('Changes not saved').first()).toBeVisible({ timeout: 15000 });
      // Messages from one page reach the shell in order, so this answer follows the report.
      await page.evaluate(() => window.desktop.loadSettings());
      await run(app, page, { directory, heal: () => rm(blocker, { recursive: true }) });
    } finally {
      // Nothing may keep the application from closing once the scenario is over.
      await app.evaluate(() => (globalThis.__aptOtherwise = 1)).catch(() => undefined);
      await app.close().catch(() => undefined);
    }
  }
  const questions = (app) => app.evaluate(() => globalThis.__aptQuestions);
  const asked = (app, count, message) =>
    expect.poll(async () => (await questions(app)).length, { message }).toBe(count);
  const answerNext = (app, response) =>
    app.evaluate((_electron, response) => {
      globalThis.__aptAnswers.push(response);
    }, response);
  const closeWindow = (app) =>
    app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });

  await unsavedScenario(async (app) => {
    await quitApp(app);
    await asked(app, 1, 'Quitting asks before losing unsaved work.');
    const [question] = await questions(app);
    assert.deepEqual(question.buttons, ['Go back', 'Quit without saving']);
    assert.equal(question.defaultId, 0);
    assert.equal(question.cancelId, 0);
    assert.ok(question.detail.includes(unsavedText), 'The question says what would be lost.');
    // "Go back" kept the application running: closing the window asks in turn.
    await closeWindow(app);
    await asked(app, 2, 'Closing the window asks before losing unsaved work.');
    assert.deepEqual((await questions(app))[1].buttons, ['Go back', 'Close without saving']);
    // "Go back" also kept the window open: quitting asks again, about the same work.
    await quitApp(app);
    await asked(app, 3, 'The window stayed open with its unsaved work.');
    assert.ok((await questions(app))[2].detail.includes(unsavedText));
    // "Quit without saving" quits, and the quit it starts asks nothing more.
    await answerNext(app, 1);
    await quitApp(app);
    await waitForExit(app);
  });

  await unsavedScenario(async (app) => {
    await answerNext(app, 1);
    if (process.platform === 'darwin') {
      // The application keeps running without its window. The closed page's work is gone with it,
      // so quitting now has nothing to ask about.
      await closeWindow(app);
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
          message: '"Close without saving" closes the window.',
        })
        .toBe(0);
      assert.equal((await questions(app)).length, 1);
      await quitApp(app);
      await waitForExit(app);
    } else {
      // Closing the last window quits the application, which must not ask a second time.
      const exited = waitForExit(app);
      await closeWindow(app);
      await exited;
    }
  });

  // The disk recovers: the save made while quitting succeeds, nothing is left to ask about, and the
  // edit reaches the file.
  await unsavedScenario(async (app, _page, { directory, heal }) => {
    await quitApp(app);
    await asked(app, 1, 'A save that fails while quitting is asked about.');
    assert.ok((await questions(app))[0].detail.includes(unsavedText));
    await heal();
    await quitApp(app);
    await waitForExit(app);
    assert.equal(await notesOf(directory), edit, 'The edit is saved once the disk recovers.');
  });

  // A window that stops responding can be reloaded, which loses what its page held only in memory:
  // the question says so.
  await unsavedScenario(async (app) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].emit('unresponsive');
    });
    await asked(app, 1, 'An unresponsive window asks whether to wait or reload.');
    const [question] = await questions(app);
    assert.deepEqual(question.buttons, ['Wait', 'Reload']);
    assert.ok(question.detail.includes(unsavedText), 'The question says what reloading loses.');
    // "Wait" was answered; the work is still there, so quitting asks about it ("Go back" keeps the
    // application open, so the question can be read before the next quit is allowed to go through).
    await quitApp(app);
    await asked(app, 2, 'Quitting still asks about the unsaved work.');
    await answerNext(app, 1);
    await quitApp(app);
    await waitForExit(app);
  });

  // A page that reloads or crashes has lost what it held: there is nothing left to ask about.
  // The reloaded page is kept from starting (its script is served empty), so it never reports
  // anything itself: only the shell forgetting the old page's report lets this quit through.
  await unsavedScenario(async (app, page) => {
    await app.evaluate(({ session, net, BrowserWindow }) => {
      session.defaultSession.protocol.handle('file', (request) =>
        /\/assets\/[^/]+\.js$/.test(new URL(request.url).pathname)
          ? new Response('', { headers: { 'content-type': 'text/javascript' } })
          : net.fetch(request, { bypassCustomProtocolHandlers: true }),
      );
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      globalThis.__aptReloaded = new Promise((resolve) =>
        contents.once('did-finish-load', resolve),
      );
    });
    await page.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    });
    await app.evaluate(() => globalThis.__aptReloaded);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
          'document.body.innerText.trim()',
        ),
      ),
      '',
      'The reloaded page did not start.',
    );
    await quitApp(app);
    await waitForExit(app);
  });
  await unsavedScenario(async (app) => {
    await app.evaluate(
      ({ app: electron, BrowserWindow }) =>
        new Promise((resolve) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          // Quit before the window reloads the crashed page.
          contents.once('render-process-gone', () => {
            setTimeout(() => electron.quit(), 0);
            resolve();
          });
          contents.forcefullyCrashRenderer();
        }),
    );
    await waitForExit(app);
  });

  console.log(
    `Desktop smoke passed: ${metadata.name} ${metadata.version} (${metadata.packaged ? 'packaged' : 'development'}, ${process.platform}).`,
  );
} finally {
  if (application) await application.close().catch(() => undefined);
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  for (const directory of extraProfiles)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

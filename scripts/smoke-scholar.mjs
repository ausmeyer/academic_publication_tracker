import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect } from '@playwright/test';

const profile = await mkdtemp(path.join(os.tmpdir(), 'apt-scholar-smoke-'));
const selected =
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
const executablePath = selected ? path.resolve(selected) : undefined;
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
  const workspace = await application.firstWindow();
  await workspace.getByRole('heading', { name: /Your research/ }).waitFor();
  await application.evaluate(({ session, ipcMain, BrowserWindow }) => {
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, callback) => {
      if (channel === 'apt:scholar:action') globalThis.__scholarToolbarHandler = callback;
      return handle(channel, callback);
    };
    const originalShow = BrowserWindow.prototype.show;
    const originalHide = BrowserWindow.prototype.hide;
    BrowserWindow.prototype.show = function () {
      if (this.getTitle().startsWith('Google Scholar')) globalThis.__fixture.shown += 1;
      return originalShow.call(this);
    };
    BrowserWindow.prototype.hide = function () {
      if (this.getTitle().startsWith('Google Scholar')) globalThis.__fixture.hidden += 1;
      return originalHide.call(this);
    };
    // Only timeout/deadline stress cases fire recorded callbacks manually. The first
    // normal paging case uses real time and verifies the five-second request pace.
    globalThis.__scholarTimers = new Map();
    const schedule = globalThis.setTimeout,
      clear = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      let timer;
      const wrapped = () => {
        globalThis.__scholarTimers.delete(timer);
        callback(...args);
      };
      timer = schedule(wrapped, milliseconds);
      if (milliseconds >= 3000 && milliseconds <= 300000)
        globalThis.__scholarTimers.set(timer, { milliseconds, fire: wrapped });
      return timer;
    };
    globalThis.clearTimeout = (timer) => {
      globalThis.__scholarTimers.delete(timer);
      clear(timer);
    };
    globalThis.__fireScholarTimer = (kind) => {
      const entry = [...globalThis.__scholarTimers.entries()].find(([, value]) =>
        kind === 'budget'
          ? value.milliseconds > 60000
          : kind === 'load'
            ? value.milliseconds === 30000
            : value.milliseconds <= 5000,
      );
      if (!entry) throw new Error(`No active ${kind} timer.`);
      clear(entry[0]);
      entry[1].fire();
    };
    const fromPartition = session.fromPartition.bind(session);
    session.fromPartition = (partition, options) => {
      const isolated = fromPartition(partition, options);
      if (!partition.startsWith('apt-scholar-')) return isolated;
      const fixture = globalThis.__fixture;
      const row = (id, title = `Synthetic publication ${id}`, citations = 12) =>
        `<div class="gs_r gs_or gs_scl" data-cid="${id}"><h3 class="gs_rt"><a href="https://example.org/paper/${id}">${title}</a></h3><div class="gs_a">R Example, T Researcher - Example Journal, 2024 - example.org</div><div class="gs_rs">Synthetic bibliographic snippet.</div><div class="gs_fl"><a href="/scholar?cites=${id}">Cited by ${citations}</a></div></div>`;
      const html = (content, next = '') =>
        `<!doctype html><html><head><title>Google Scholar synthetic fixture</title></head><body>${content}${next ? `<a aria-label="Next" href="${next}">Next</a>` : ''}<a id="external" href="https://example.org/blocked">External paper</a><a id="popup" target="_blank" href="https://example.org/popup">Popup</a></body></html>`;
      fixture.resultHtml = html(row('verified'));
      isolated.protocol.handle('https', async (request) => {
        const url = new URL(request.url);
        if (!['scholar.google.com', 'accounts.google.com'].includes(url.hostname))
          return new Response('Blocked fixture host', { status: 403 });
        if (!['/scholar', '/signin'].includes(url.pathname))
          return new Response('Not found', { status: 404 });
        const offset = Number(url.searchParams.get('start') || 0);
        // Reproduce slow Chromium request dispatch after navigation starts (notably Rosetta).
        if (fixture.mode === 'auto' && !offset)
          await new Promise((resolve) => setTimeout(resolve, 1200));
        fixture.requests.push({ url: url.href, at: Date.now() });
        if ((fixture.mode === 'auto' && !offset) || fixture.mode === 'loading')
          await new Promise((resolve) => {
            fixture.release = resolve;
          });
        const response = (body, status = 200) =>
          new Response(body, { status, headers: { 'content-type': 'text/html' } });
        const next = `/scholar?hl=en&q=synthetic&start=${offset + 10}`;
        if (fixture.mode === 'unstable')
          return response(
            html(`<div id="gs_ab_md">About 43 results</div>${row('changing')}<script>
            let count = 12;
            setInterval(() => { document.querySelector('.gs_fl a').textContent = 'Cited by ' + ++count; }, 100);
          </script>`),
          );
        if (fixture.mode === 'short')
          return response(html(`<div id="gs_ab_md">About 43 results</div>${row('only-one')}`));
        if (fixture.mode === 'settling') {
          const rows = Array.from({ length: Math.min(10, 43 - offset) }, (_, index) =>
            row(`settling-${offset + index}`),
          ).join('');
          const navigation = offset < 40 ? `<a aria-label="Next" href="${next}">Next</a>` : '';
          if (!offset) {
            const initial = Array.from({ length: 4 }, (_, index) => row(`settling-${index}`)).join(
              '',
            );
            return response(
              html(`<div id="results">${initial}</div><script>
              setTimeout(() => { document.querySelector('#results').innerHTML = ${JSON.stringify(rows + navigation)}; }, 900);
            </script>`),
            );
          }
          return response(html(rows + navigation));
        }
        if (fixture.mode === 'empty') return response(html('<p>No results found.</p>'));
        if (fixture.mode === 'refusal')
          return response(html('<p>Our systems have detected unusual traffic.</p>'), 429);
        if (fixture.mode === 'accounts-error')
          return url.hostname === 'scholar.google.com'
            ? new Response(null, {
                status: 302,
                headers: { location: 'https://accounts.google.com/signin' },
              })
            : response(
                '<html><head><title>Sign in</title></head><body><h1>This browser or app may not be secure</h1><button>Retry</button></body></html>',
                403,
              );
        if (fixture.mode === 'bad-current' && !offset)
          return new Response(null, {
            status: 302,
            headers: { location: 'https://scholar.google.com/scholar?hl=en&q=synthetic&start=200' },
          });
        if (fixture.mode === 'challenge')
          return response(
            html(
              '<form id="captcha-form"><label>Human verification<input name="captcha"></label></form>',
            ),
            200,
          );
        if (fixture.mode === 'partial-error' && offset)
          return response(html('<h1>Service unavailable</h1>'), 503);
        if (fixture.mode === 'bad-next')
          return response(html(row('a'), '/scholar?hl=en&q=different&start=10'));
        if (fixture.mode === 'many') return response(html(row(`paper-${offset}`), next));
        if (fixture.mode === 'auto' && offset)
          return response(html(row('a') + row('b', 'Second synthetic publication', 3) + row('c')));
        if (fixture.mode === 'duplicate' && offset) return response(html(row('a'), next));
        if (['auto', 'waiting', 'partial-error', 'duplicate'].includes(fixture.mode))
          return response(html(row('a'), next));
        return response(html(row('a')));
      });
      return isolated;
    };
  });
  await workspace.evaluate(() => {
    window.__scholarEvents = [];
    window.__unsubscribe = window.desktop.onScholarProgress((progress) =>
      window.__scholarEvents.push(progress),
    );
  });
  async function begin(mode, limit = 10) {
    await application.evaluate((_electron, mode) => {
      globalThis.__fixture = { mode, requests: [], shown: 0, hidden: 0 };
    }, mode);
    const opening = application.waitForEvent('window');
    await workspace.evaluate((limit) => {
      window.__scholarEvents = [];
      window.__scholarDone = false;
      window.__scholarValue = undefined;
      window.__scholarError = undefined;
      window.desktop
        .searchScholar({ text: 'synthetic', mode: 'topic', sources: ['scholar'], limit })
        .then((value) => {
          window.__scholarValue = value;
          window.__scholarDone = true;
        })
        .catch((error) => {
          window.__scholarError = error.message;
          window.__scholarDone = true;
        });
    }, limit);
    return opening;
  }
  async function completed(timeout = 20000) {
    await expect.poll(() => workspace.evaluate(() => window.__scholarDone), { timeout }).toBe(true);
    const value = await workspace.evaluate(() => ({
      value: window.__scholarValue,
      error: window.__scholarError,
    }));
    assert.equal(value.error, undefined);
    await application.evaluate(() => globalThis.__fixture.release?.());
    return value.value;
  }
  async function phase(expected) {
    await expect
      .poll(() => workspace.evaluate(() => window.__scholarEvents.at(-1)?.phase), {
        timeout: 10000,
      })
      .toBe(expected);
  }
  const control = (action) =>
    workspace.evaluate((action) => window.desktop.controlScholar(action), action);
  const fixture = () =>
    application.evaluate(() => ({
      requests: globalThis.__fixture.requests,
      shown: globalThis.__fixture.shown,
      hidden: globalThis.__fixture.hidden,
    }));
  const fire = (kind) =>
    application.evaluate((_electron, kind) => globalThis.__fireScholarTimer(kind), kind);
  async function remoteAction(code) {
    return application.evaluate(({ BrowserWindow }, code) => {
      const browser = BrowserWindow.getAllWindows().find((window) =>
        window.getTitle().startsWith('Google Scholar'),
      );
      const view = browser.contentView.children.find(
        (child) => child.webContents && child.webContents !== browser.webContents,
      );
      return view.webContents.executeJavaScript(code);
    }, code);
  }

  const hidden = await begin('auto', 2);
  await expect.poll(async () => (await fixture()).requests.length).toBe(1);
  assert.equal((await fixture()).shown, 0);
  const isolation = await application.evaluate(({ BrowserWindow }) => {
    const browser = BrowserWindow.getAllWindows().find((window) =>
      window.getTitle().startsWith('Google Scholar'),
    );
    const remote = browser.contentView.children.find(
      (child) => child.webContents && child.webContents !== browser.webContents,
    ).webContents;
    const p = remote.getLastWebPreferences();
    return {
      visible: browser.isVisible(),
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      preload: p.preload,
      isolated: remote.session !== browser.webContents.session,
    };
  });
  assert.deepEqual(isolation, {
    visible: false,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    preload: undefined,
    isolated: true,
  });
  await application.evaluate(() => globalThis.__fixture.release());
  const automatic = await completed();
  assert.equal(hidden.isClosed(), true);
  assert.equal(automatic.results[0].works.length, 2);
  assert.equal(automatic.results[0].works[0].provenance.length, 2);
  assert.match(automatic.results[0].warning, /2-paper/);
  assert.equal(automatic.results[0].error, undefined);
  const paced = await fixture();
  assert.equal(paced.shown, 0);
  assert.equal(paced.requests.length, 2);
  assert.ok(
    paced.requests[1].at - paced.requests[0].at >= 4900,
    'Automatic page retrieval must be paced at five seconds (allowing small event-delivery skew).',
  );

  await begin('settling', 100);
  const settled = await completed(60000);
  assert.equal(
    settled.results[0].works.length,
    43,
    'Wait for results and Next before ending collection.',
  );
  assert.equal(settled.results[0].error, undefined);
  assert.equal((await fixture()).requests.length, 5);

  await begin('unstable', 100);
  const unstable = await completed();
  assert.equal(unstable.results[0].works.length, 1);
  assert.match(unstable.results[0].error, /stable results/);
  assert.equal(unstable.results[0].total, 43);
  assert.match(unstable.results[0].warning, /43 matches, but 1 publication was retrieved/);
  await begin('short', 100);
  const short = await completed();
  assert.equal(short.results[0].works.length, 1);
  assert.equal(short.results[0].total, 43);
  assert.match(short.results[0].warning, /may be incomplete/);

  const challenge = await begin('challenge');
  await phase('verification');
  assert.equal((await fixture()).shown, 1);
  assert.equal(
    await application.evaluate(() =>
      [...globalThis.__scholarTimers.values()].some((timer) => timer.milliseconds > 60000),
    ),
    false,
    'Human verification pauses the search deadline.',
  );
  const guards = await application.evaluate(async ({ BrowserWindow }) => {
    const browser = BrowserWindow.getAllWindows().find((window) =>
      window.getTitle().startsWith('Google Scholar'),
    );
    const parent = BrowserWindow.getAllWindows().find((window) => window !== browser);
    const remote = browser.contentView.children.find(
      (child) => child.webContents && child.webContents !== browser.webContents,
    ).webContents;
    async function denied(event) {
      try {
        await globalThis.__scholarToolbarHandler(event, 'ready');
        return false;
      } catch {
        return true;
      }
    }
    return {
      parent: await denied({
        sender: parent.webContents,
        senderFrame: parent.webContents.mainFrame,
      }),
      remote: await denied({ sender: remote, senderFrame: remote.mainFrame }),
      foreignFrame: await denied({ sender: browser.webContents, senderFrame: remote.mainFrame }),
    };
  });
  assert.deepEqual(guards, { parent: true, remote: true, foreignFrame: true });
  assert.deepEqual(
    await remoteAction(
      '({desktop: typeof window.desktop, toolbar: typeof window.scholarBrowser, node: typeof window.require})',
    ),
    { desktop: 'undefined', toolbar: 'undefined', node: 'undefined' },
  );
  assert.equal(
    await challenge.evaluate(async () => {
      try {
        await window.scholarBrowser.act('apt:scholar:control');
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await remoteAction('document.querySelector("#external").click()');
  await expect(challenge.locator('#status')).toContainText('stays on Google Scholar');
  await remoteAction('document.querySelector("#popup").click()');
  await expect(challenge.locator('#status')).toContainText('New windows are disabled');
  await application.evaluate(({ app }) => app.quit());
  await expect(challenge.locator('#status')).toContainText('before closing the app');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => !window.getTitle().startsWith('Google Scholar'))
      .close();
  });
  assert.equal(workspace.isClosed(), false);
  await expect(challenge.locator('#status')).toContainText('Stop and keep');
  const verifiedHtml = await application.evaluate(() => globalThis.__fixture.resultHtml);
  await remoteAction(`document.documentElement.innerHTML = ${JSON.stringify(verifiedHtml)}`);
  assert.equal(
    await workspace.evaluate(() => window.__scholarDone),
    false,
    'Completing verification alone must not resume collection.',
  );
  await challenge.getByRole('button', { name: 'Resume search', exact: true }).click();
  const verified = await completed();
  assert.equal(verified.results[0].works.length, 1);
  assert.equal(
    (await fixture()).requests.length,
    1,
    'Resume reads the current page without a reload.',
  );
  assert.ok((await fixture()).hidden >= 1);

  for (const mode of ['refusal', 'accounts-error', 'bad-current']) {
    await begin(mode, 1);
    const result = await completed();
    assert.equal(result.results[0].works.length, 0);
    assert.ok(result.results[0].error, `${mode} must return a source error.`);
    assert.equal((await fixture()).shown, 0, `${mode} must not enter indefinite verification.`);
  }
  await begin('empty');
  const empty = await completed();
  assert.equal(empty.results[0].works.length, 0);
  assert.equal(empty.results[0].error, undefined);
  await begin('bad-next');
  const badNext = await completed();
  assert.equal(badNext.results[0].works.length, 1);
  assert.ok(badNext.results[0].error);

  for (const action of ['stop', 'cancel']) {
    await begin('loading');
    await expect.poll(async () => (await fixture()).requests.length).toBe(1);
    await control(action);
    const result = await completed();
    if (action === 'cancel') assert.equal(result, null);
    else assert.equal(result.results[0].works.length, 0);
    await begin('waiting');
    await phase('waiting');
    await control(action);
    const partial = await completed();
    if (action === 'cancel') assert.equal(partial, null);
    else assert.equal(partial.results[0].works.length, 1);
    assert.equal((await fixture()).requests.length, 1);
  }
  const shown = await begin('waiting');
  await phase('waiting');
  await control('show');
  assert.equal((await fixture()).shown, 1);
  await shown.close();
  assert.equal(
    (await completed()).results[0].works.length,
    1,
    'Closing the shown browser preserves papers.',
  );

  await begin('partial-error');
  await phase('waiting');
  await fire('wait');
  const partialError = await completed();
  assert.equal(partialError.results[0].works.length, 1);
  assert.ok(partialError.results[0].error);
  await begin('duplicate');
  await phase('waiting');
  await fire('wait');
  const duplicate = await completed();
  assert.equal(duplicate.results[0].works.length, 1);
  assert.match(duplicate.results[0].warning, /no new records/);
  await begin('loading');
  await expect.poll(async () => (await fixture()).requests.length).toBe(1);
  await fire('load');
  assert.match((await completed()).results[0].error, /too long to load/);
  await begin('waiting');
  await phase('waiting');
  await fire('budget');
  const budget = await completed();
  assert.equal(budget.results[0].works.length, 1);
  assert.match(budget.results[0].error, /five-minute/);
  await begin('waiting');
  await phase('waiting');
  await application.evaluate(({ BrowserWindow }) => {
    const browser = BrowserWindow.getAllWindows().find((window) =>
      window.getTitle().startsWith('Google Scholar'),
    );
    browser.contentView.children
      .find((child) => child.webContents && child.webContents !== browser.webContents)
      .webContents.forcefullyCrashRenderer();
  });
  assert.equal((await completed()).results[0].works.length, 1);
  await begin('many', 200);
  for (let page = 1; page < 20; page += 1) {
    await expect
      .poll(() =>
        workspace.evaluate(() => ({
          count: window.__scholarEvents.at(-1)?.count,
          phase: window.__scholarEvents.at(-1)?.phase,
        })),
      )
      .toEqual({ count: page, phase: 'waiting' });
    await fire('wait');
  }
  const capped = await completed();
  assert.equal(capped.results[0].works.length, 20);
  assert.match(capped.results[0].warning, /20-page/);
  assert.equal((await fixture()).requests.length, 20);
  assert.equal((await fixture()).shown, 0);
  await workspace.evaluate(() => window.__unsubscribe());
  await control('cancel');
  assert.equal(
    await workspace.evaluate(async () => {
      try {
        await window.desktop.controlScholar('unsupported');
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await application.close();
  application = undefined;
  console.log(
    'Automatic Scholar native smoke passed: hidden paced paging; delayed rendering from 4 to 43 records; unstable and incomplete result notices; isolation and sender guards; user-only verification/resume; source refusals; empty results; partial errors; safe URLs; stop/cancel during load and wait; close/quit guards; timeouts; renderer failure; duplicate and 20-page caps.',
  );
} finally {
  if (application) {
    const workspace = application.windows()[0];
    if (workspace && !workspace.isClosed())
      await workspace.evaluate(() => window.desktop?.controlScholar('cancel')).catch(() => {});
    await application.close();
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

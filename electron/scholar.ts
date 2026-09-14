import { BrowserWindow, ipcMain, session, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ScholarAction,
  ScholarProgress,
  SearchQuery,
  SearchResponse,
  Work,
} from '../src/types';
import {
  buildScholarUrl,
  getScholarNextUrl,
  normalizeScholarPage,
  SCHOLAR_SETTLED_CAPTURE_SCRIPT,
} from '../src/core/scholar';

const TOOLBAR_HEIGHT = 184;
const PAGE_INTERVAL_MS = 5000;
const LOAD_TIMEOUT_MS = 30000;
const SEARCH_BUDGET_MS = 5 * 60 * 1000;
const MAX_PAGES = 20;
const COVERAGE_WARNING =
  'Google Scholar results cover only the pages retrieved in this search, not a complete bibliography. Author lists and snippets may be abbreviated. No full-text license has been verified.';
let active: { control(action: ScholarAction): void; guardClose(): void } | null = null;

function allowedNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.hostname === 'accounts.google.com') return true;
    if (url.hostname === 'www.google.com' && url.pathname.startsWith('/sorry/')) return true;
    return (
      url.hostname === 'scholar.google.com' &&
      (['/', '/scholar', '/citations'].includes(url.pathname) || url.pathname.startsWith('/sorry/'))
    );
  } catch {
    return false;
  }
}

function sameSearchPage(value: string, initialUrl: string): boolean {
  try {
    const url = new URL(value),
      initial = new URL(initialUrl);
    return (
      allowedNavigation(value) &&
      url.origin === initial.origin &&
      url.pathname === '/scholar' &&
      ['q', 'as_ylo', 'as_yhi'].every(
        (key) =>
          url.searchParams.getAll(key).length === initial.searchParams.getAll(key).length &&
          url.searchParams.get(key) === initial.searchParams.get(key),
      )
    );
  } catch {
    return false;
  }
}

export function controlScholarSearch(action: unknown): void {
  if (!['stop', 'cancel', 'show', 'resume'].includes(String(action)) || typeof action !== 'string')
    throw new Error('Unsupported Google Scholar action.');
  active?.control(action as ScholarAction);
}

export function preventScholarSearchLoss(): boolean {
  if (!active) return false;
  active.guardClose();
  return true;
}

/** The remote view has no preload, native bridge, persistent session, or broad permissions. */
export async function openScholarSearch(
  query: SearchQuery,
  parent: BrowserWindow,
  onProgress: (progress: ScholarProgress) => void,
): Promise<SearchResponse | null> {
  const initialUrl = buildScholarUrl(query);
  if (active) throw new Error('A Google Scholar search is already running.');
  const location = pathToFileURL(path.join(__dirname, '../dist/scholar.html')).href;
  const remoteSession = session.fromPartition(`apt-scholar-${randomUUID()}`, { cache: false });
  remoteSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  remoteSession.setDevicePermissionHandler(() => false);
  const browser = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 840,
    minHeight: 620,
    parent,
    title: 'Google Scholar · Academic Publication Tracker',
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'scholar-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const view = new WebContentsView({
    webPreferences: {
      session: remoteSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      navigateOnDragDrop: false,
      safeDialogs: true,
      backgroundThrottling: false,
    },
  });
  const remote = view.webContents;
  const works = new Map<string, Work>();
  const warnings = new Set([COVERAGE_WARNING]);
  const visited = new Set<string>();
  const abort = new AbortController();
  const searchedAt = new Date().toISOString();
  let closed = false;
  let pages = 0;
  let estimatedTotal: number | null = null;
  let phase: ScholarProgress['phase'] = 'searching';
  let message = 'Searching Google Scholar…';
  let nextRequestAt = 0;
  let remainingBudget = SEARCH_BUDGET_MS;
  let budgetStartedAt = 0;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeVerification: (() => void) | null = null;
  let mainHttpStatus = 200;
  let resolveSearch: (response: SearchResponse | null) => void;
  const result = new Promise<SearchResponse | null>((resolve) => {
    resolveSearch = resolve;
  });

  function sendState(): void {
    if (closed) return;
    const progress = { phase, count: works.size, pages, limit: query.limit, message };
    if (!parent.isDestroyed() && !parent.webContents.isDestroyed()) onProgress(progress);
    if (!browser.isDestroyed() && !browser.webContents.isDestroyed())
      browser.webContents.send('apt:scholar:state', {
        ...progress,
        busy: !remote.isDestroyed() && remote.isLoadingMainFrame(),
        url: remote.isDestroyed() ? '' : remote.getURL(),
      });
  }
  function notice(value: string): void {
    message = value;
    sendState();
  }
  function show(): void {
    if (closed || browser.isDestroyed()) return;
    if (browser.isMinimized()) browser.restore();
    browser.show();
    browser.focus();
  }
  function pauseBudget(): void {
    if (budgetTimer) clearTimeout(budgetTimer);
    budgetTimer = undefined;
    if (budgetStartedAt)
      remainingBudget = Math.max(0, remainingBudget - (Date.now() - budgetStartedAt));
    budgetStartedAt = 0;
  }
  function startBudget(): void {
    if (closed) return;
    budgetStartedAt = Date.now();
    budgetTimer = setTimeout(
      () =>
        finish(
          'Google Scholar search reached its five-minute time limit. Retrieved papers were kept.',
        ),
      remainingBudget,
    );
  }
  function finish(error?: string, discard = false, reason?: string): void {
    if (closed) return;
    if (reason) warnings.add(reason);
    if (estimatedTotal !== null && works.size < estimatedTotal)
      warnings.add(
        `Google Scholar estimates about ${estimatedTotal} matches, but ${works.size} ${works.size === 1 ? 'publication was' : 'publications were'} retrieved. This collection may be incomplete; Scholar's estimate is approximate.`,
      );
    message = discard
      ? 'Search canceled. Collected papers were discarded.'
      : error || reason || `Search complete. ${works.size} papers retrieved.`;
    sendState();
    closed = true;
    pauseBudget();
    abort.abort();
    resumeVerification = null;
    parent.removeListener('close', guardParentClose);
    parent.removeListener('closed', parentClosed);
    ipcMain.removeHandler('apt:scholar:action');
    active = null;
    if (!remote.isDestroyed()) {
      remote.stop();
      remote.close({ waitForBeforeUnload: false });
    }
    if (!browser.isDestroyed()) browser.destroy();
    if (!parent.isDestroyed()) {
      parent.show();
      parent.focus();
    }
    void remoteSession.clearStorageData().catch(() => {});
    resolveSearch!(
      discard
        ? null
        : {
            searchedAt,
            results: [
              {
                source: 'scholar',
                works: [...works.values()],
                total: estimatedTotal,
                warning: [...warnings].join(' '),
                ...(error ? { error } : {}),
              },
            ],
          },
    );
  }
  function control(action: ScholarAction): void {
    if (closed) return;
    if (action === 'cancel') return finish(undefined, true);
    if (action === 'stop')
      return finish(undefined, false, 'Search stopped early. Retrieved papers were kept.');
    if (action === 'show') return show();
    if (phase !== 'verification' || !resumeVerification) return;
    if (remote.isLoadingMainFrame())
      return notice('Wait for the verification page to finish loading, then choose Resume.');
    browser.hide();
    parent.show();
    parent.focus();
    resumeVerification();
  }
  active = {
    control,
    guardClose: () => {
      notice('Choose Stop and keep results or Cancel before closing the app.');
      show();
    },
  };
  function guardParentClose(event: Electron.Event): void {
    if (!closed) {
      event.preventDefault();
      active?.guardClose();
    }
  }
  function parentClosed(): void {
    finish('The workspace window closed. Google Scholar collection stopped.');
  }
  parent.on('close', guardParentClose);
  parent.on('closed', parentClosed);

  function bounded<T>(operation: Promise<T>, milliseconds: number, failure: string): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', canceled);
        callback();
      };
      const canceled = () => settle(() => reject(new Error('Google Scholar search ended.')));
      const timer = setTimeout(() => settle(() => reject(new Error(failure))), milliseconds);
      abort.signal.addEventListener('abort', canceled, { once: true });
      operation.then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
      if (abort.signal.aborted) canceled();
    });
  }
  function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', canceled);
      };
      const canceled = () => {
        cleanup();
        reject(new Error('Google Scholar search ended.'));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, milliseconds);
      abort.signal.addEventListener('abort', canceled, { once: true });
      if (abort.signal.aborted) canceled();
    });
  }
  async function verification(): Promise<void> {
    phase = 'verification';
    pauseBudget();
    notice(
      'Google requires verification or sign-in. Complete it yourself here, then choose Resume.',
    );
    show();
    await new Promise<void>((resolve, reject) => {
      const canceled = () => {
        resumeVerification = null;
        reject(new Error('Google Scholar search ended.'));
      };
      resumeVerification = () => {
        abort.signal.removeEventListener('abort', canceled);
        resumeVerification = null;
        resolve();
      };
      abort.signal.addEventListener('abort', canceled, { once: true });
      if (abort.signal.aborted) canceled();
    });
    if (closed) return;
    phase = 'searching';
    startBudget();
    notice('Checking the current Google Scholar page…');
    // Resuming never submits or solves a verification form and never reloads the page.
  }
  function resize(): void {
    const [width, height] = browser.getContentSize();
    view.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    });
  }
  browser.contentView.addChildView(view);
  resize();
  browser.on('resize', resize);
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browser.webContents.on('will-navigate', (event) => event.preventDefault());
  browser.webContents.on('will-attach-webview', (event) => event.preventDefault());
  browser.webContents.on('render-process-gone', () =>
    finish('The Google Scholar controls stopped responding. Retrieved papers were kept.'),
  );
  browser.on('close', (event) => {
    if (!closed) {
      event.preventDefault();
      finish(undefined, false, 'Google Scholar window closed. Retrieved papers were kept.');
    }
  });
  browser.on('closed', () => {
    if (!closed)
      finish(undefined, false, 'Google Scholar window closed. Retrieved papers were kept.');
  });
  remote.on('will-attach-webview', (event) => event.preventDefault());
  remote.setWindowOpenHandler(() => {
    notice(
      'New windows are disabled in Google Scholar. Open publication links from your workspace after collection.',
    );
    return { action: 'deny' };
  });
  remote.on('will-frame-navigate', (event) => {
    if (event.isMainFrame && !allowedNavigation(event.url)) {
      event.preventDefault();
      notice(
        'This browser stays on Google Scholar. External publication links open from your workspace.',
      );
    }
  });
  remote.on('will-redirect', (event) => {
    if (event.isMainFrame && !allowedNavigation(event.url)) {
      event.preventDefault();
      finish(
        'Google Scholar redirected outside the supported search or verification pages. Retrieved papers were kept.',
      );
    }
  });
  remoteSession.on('will-download', (event) => {
    event.preventDefault();
    notice('Downloads are disabled in the Google Scholar browser.');
  });
  remote.on('did-navigate', (_event, _url, status) => {
    mainHttpStatus = status;
    sendState();
  });
  remote.on('did-start-loading', sendState);
  remote.on('did-stop-loading', sendState);
  remote.on('render-process-gone', () =>
    finish('The Google Scholar page stopped responding. Retrieved papers were kept.'),
  );
  remote.on('destroyed', () => {
    if (!closed) finish('The Google Scholar page closed unexpectedly. Retrieved papers were kept.');
  });

  ipcMain.handle('apt:scholar:action', (event, action: unknown) => {
    if (
      closed ||
      event.sender !== browser.webContents ||
      event.senderFrame !== browser.webContents.mainFrame ||
      event.senderFrame.url !== location
    )
      throw new Error('This request did not originate from the Google Scholar toolbar.');
    if (action === 'ready') return sendState();
    if (typeof action !== 'string' || !['resume', 'stop', 'cancel'].includes(action))
      throw new Error('Unsupported Google Scholar toolbar action.');
    control(action as ScholarAction);
  });

  async function collect(): Promise<void> {
    try {
      startBudget();
      sendState();
      await bounded(
        browser.loadURL(location),
        LOAD_TIMEOUT_MS,
        'The Google Scholar controls could not load.',
      );
      let nextUrl = initialUrl;
      let loadNext = true;
      while (!closed) {
        if (loadNext) {
          if (visited.has(nextUrl))
            return finish(
              undefined,
              false,
              'Google Scholar repeated a results page. Collection stopped.',
            );
          const delay = Math.max(0, nextRequestAt - Date.now());
          if (delay) {
            phase = 'waiting';
            notice('Waiting before retrieving the next Google Scholar page…');
            await wait(delay);
          }
          if (closed) return;
          phase = 'searching';
          notice(`Retrieving Google Scholar page ${pages + 1}…`);
          mainHttpStatus = 200;
          await bounded(
            remote.loadURL(nextUrl),
            LOAD_TIMEOUT_MS,
            'Google Scholar took too long to load. Retrieved papers were kept.',
          );
        }
        if (closed) return;
        const pageUrl = remote.getURL();
        const raw: unknown = await bounded(
          remote.executeJavaScriptInIsolatedWorld(999, [{ code: SCHOLAR_SETTLED_CAPTURE_SCRIPT }]),
          LOAD_TIMEOUT_MS,
          'Google Scholar took too long to read. Retrieved papers were kept.',
        );
        if (closed) return;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
          throw new Error('Google Scholar returned an unreadable page.');
        const page = raw as Record<string, unknown>;
        if (page.version !== 1 || page.url !== pageUrl || remote.getURL() !== pageUrl)
          throw new Error(
            'The Google Scholar page changed while it was being read. Retrieved papers were kept.',
          );
        if (page.status === 'captcha' || page.status === 'login') {
          if (!allowedNavigation(pageUrl) || page.interactiveVerification !== true)
            throw new Error(
              'Google Scholar refused this request without an interactive verification option. Try again later.',
            );
          await verification();
          loadNext = false;
          continue;
        }
        if (!sameSearchPage(pageUrl, initialUrl))
          throw new Error('Google Scholar left the requested search. Retrieved papers were kept.');
        if (mainHttpStatus >= 400)
          throw new Error(
            `Google Scholar refused or could not complete this request (HTTP ${mainHttpStatus}). Try again later.`,
          );
        getScholarNextUrl({ ...page, nextUrl: null }, pageUrl, initialUrl);
        if (
          typeof page.estimatedTotal === 'number' &&
          Number.isSafeInteger(page.estimatedTotal) &&
          page.estimatedTotal >= 0 &&
          page.estimatedTotal <= 1000000000
        )
          estimatedTotal = Math.max(estimatedTotal ?? 0, page.estimatedTotal);
        if (page.status === 'empty') {
          if (page.settled !== true)
            throw new Error(
              'The Google Scholar page did not finish displaying stable results. Try again later.',
            );
          pages += 1;
          return finish();
        }
        const captured = normalizeScholarPage(raw, new Date().toISOString());
        if (visited.has(pageUrl))
          return finish(
            undefined,
            false,
            'Google Scholar repeated a results page. Collection stopped.',
          );
        visited.add(pageUrl);
        pages += 1;
        const before = works.size;
        for (const work of captured.works) {
          const previous = works.get(work.id);
          if (!previous && works.size >= query.limit) continue;
          const provenance = new Map(
            previous?.provenance.map((record) => [record.url, record]) ?? [],
          );
          for (const record of work.provenance) provenance.set(record.url, record);
          works.set(work.id, { ...work, provenance: [...provenance.values()] });
        }
        if (captured.warning) warnings.add(captured.warning);
        if (page.settled !== true)
          return finish(
            'The Google Scholar page did not finish displaying stable results. Retrieved papers were kept; this search is incomplete. Try again later.',
          );
        notice(
          `${works.size} papers retrieved from ${pages} Google Scholar ${pages === 1 ? 'page' : 'pages'}.`,
        );
        if (works.size >= query.limit)
          return finish(undefined, false, `The ${query.limit}-paper result limit was reached.`);
        if (works.size === before)
          return finish(
            undefined,
            false,
            'The next Google Scholar page contained no new records. Collection stopped.',
          );
        if (pages >= MAX_PAGES) return finish(undefined, false, 'The 20-page limit was reached.');
        const following = getScholarNextUrl(raw, pageUrl, initialUrl);
        if (!following) return finish();
        // Chromium can dispatch the first request well after navigation starts.
        // Pace from the completed page read so that slow dispatch cannot compress requests.
        nextRequestAt = Date.now() + PAGE_INTERVAL_MS;
        nextUrl = following;
        loadNext = true;
      }
    } catch (error) {
      if (!closed)
        finish(
          error instanceof Error
            ? error.message
            : 'Google Scholar collection failed. Retrieved papers were kept.',
        );
    }
  }
  void collect();
  return result;
}

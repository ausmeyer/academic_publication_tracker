import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  safeStorage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SearchQuery } from '../src/types';
import { searchSources } from '../src/services/sources';
import { createDesktopStore, MAX_FILE_BYTES, validateSettings } from './store';
import {
  controlScholarSearch,
  discardScholarSearch,
  openScholarSearch,
  preventScholarSearchLoss,
  scholarSearchState,
} from './scholar';
import { createFlushCoordinator } from './flush';
import { readImportFile } from './import-file';
import { isAppLocation } from './navigation';
import { validateQuery } from './query';
import { createQuitCoordinator } from './quit';
import { createCrashRecovery, type RecoveryAction } from './recovery';
import { runProviderSearch } from './search';
import { configureSpellchecker } from './session-policy';
import { createUnsavedWorkGuard } from './unsaved';

app.setName('Academic Publication Tracker');
app.setAppUserModelId('org.academicpublicationtracker.desktop');
if (!app.isPackaged && process.env.APT_USER_DATA_DIR) {
  if (!path.isAbsolute(process.env.APT_USER_DATA_DIR))
    throw new Error('APT_USER_DATA_DIR must be an absolute path.');
  app.setPath('userData', process.env.APT_USER_DATA_DIR);
}

let window: BrowserWindow | null = null;
let searching = false;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

function externalUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid external link.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only public HTTP and HTTPS links can be opened.');
  return url.href;
}

function rendererLocation(): string {
  const dev = process.env.APT_RENDERER_URL;
  if (dev && !app.isPackaged) {
    const url = new URL(dev);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('APT_RENDERER_URL must be an HTTP URL on 127.0.0.1 without a path.');
    }
    return url.href;
  }
  return pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
}

function installIpc(location: string) {
  const store = createDesktopStore(app.getPath('userData'), safeStorage);
  function fromApplication(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !!(
      window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame.url.split('#')[0] === location
    );
  }
  // Before a window closes or the app quits, the interface is asked to save what it still holds
  // (notes and tags are saved shortly after typing); it is never waited for longer than 2 seconds.
  const flush = createFlushCoordinator({
    timeoutMs: 2000,
    send: (id) => {
      if (
        !window ||
        window.isDestroyed() ||
        window.webContents.isDestroyed() ||
        window.webContents.isCrashed()
      )
        return false;
      window.webContents.send('apt:flush', id);
      return true;
    },
  });
  ipcMain.on('apt:flushed', (event, id: unknown) => {
    if (fromApplication(event)) flush.acknowledge(id);
  });
  // Work the interface holds only in memory (search results or edits it could not save): closing
  // the window or quitting asks first, once the interface has had its chance to save.
  const unsaved = createUnsavedWorkGuard({
    fromApplication,
    confirm: async (description, action) => {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Go back', action === 'quit' ? 'Quit without saving' : 'Close without saving'],
        defaultId: 0,
        cancelId: 0,
        title: 'Unsaved work',
        message: action === 'quit' ? 'Quit without saving?' : 'Close the window without saving?',
        detail: `${description}\n\nThis work has not been saved and will be lost. Choose Go back to keep it.`,
      });
      return response === 1;
    },
  });
  ipcMain.on('apt:unsaved-work', (event, value: unknown) => unsaved.report(event, value));
  const quitting = createQuitCoordinator({
    searchState: scholarSearchState,
    guardSearch: () => {
      preventScholarSearchLoss();
    },
    // Waiting for Google verification has no time limit, so it must not be able to block the
    // operating system from logging out or shutting down.
    confirmDiscardSearch: async () => {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Quit and discard the search', 'Keep waiting'],
        defaultId: 1,
        cancelId: 1,
        title: 'Google Scholar search in progress',
        message: 'Quit while the Google Scholar search is waiting for you?',
        detail:
          'The search is paused for Google verification or consent. Quitting now discards the publications it has collected so far. To keep them, choose Stop in the Google Scholar window first.',
      });
      return response === 0;
    },
    discardSearch: discardScholarSearch,
    flushInterface: () => flush.request(),
    flushStore: () => store.flush(),
    confirmUnsavedWork: () => unsaved.confirmLoss('quit'),
    quit: () => app.quit(),
  });
  app.on('before-quit', (event) => {
    if (quitting.beforeQuit()) event.preventDefault();
  });
  function handle(channel: string, callback: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!fromApplication(event)) {
        throw new Error('This request did not originate from the application.');
      }
      return callback(...args);
    });
  }
  handle('apt:workspace:load', () => store.loadWorkspace());
  handle('apt:workspace:save', (value) => store.saveWorkspace(value));
  handle('apt:workspace:notice', () => store.recoveryNotice());
  handle('apt:settings:load', () => store.loadSettings());
  handle('apt:settings:save', (value) => store.saveSettings(validateSettings(value)));
  handle('apt:search', async (value) => {
    const query = validateQuery(value);
    if (searching) throw new Error('A search is already running. Wait for it to finish.');
    searching = true;
    try {
      // Provider requests go through Electron's network stack, which honours the operating
      // system's proxy, PAC and certificate settings. (The adapters take it as `options.fetch`.)
      return await runProviderSearch(query, {
        store,
        search: searchSources,
        fetch: net.fetch.bind(net) as typeof fetch,
      });
    } finally {
      searching = false;
    }
  });
  handle('apt:scholar:open', async (value) => {
    if (searching) throw new Error('A search is already running. Wait for it to finish.');
    searching = true;
    try {
      return await openScholarSearch(value as SearchQuery, window!, (progress) => {
        if (window && !window.isDestroyed())
          window.webContents.send('apt:scholar:progress', progress);
      });
    } finally {
      searching = false;
    }
  });
  handle('apt:scholar:control', (action) => controlScholarSearch(action));
  handle('apt:external', (value) => shell.openExternal(externalUrl(value)));
  handle('apt:clipboard:write', (value) => {
    if (typeof value !== 'string' || value.length > 20000)
      throw new Error('The text to copy is invalid or too large.');
    clipboard.writeText(value);
  });
  handle('apt:file:export', async (value) => {
    const data = value as { name?: unknown; content?: unknown } | null;
    if (
      !data ||
      typeof data.name !== 'string' ||
      typeof data.content !== 'string' ||
      Buffer.byteLength(data.content, 'utf8') > MAX_FILE_BYTES
    )
      throw new Error('The export is invalid or exceeds 25 MB.');
    const name =
      data.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'publications.json';
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export publications',
      defaultPath: path.join(app.getPath('documents'), name),
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data.content, 'utf8');
    return true;
  });
  handle('apt:file:import', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Import publications or workspace',
      properties: ['openFile'],
      filters: [
        {
          name: 'Publication data',
          extensions: ['json', 'csv', 'tsv', 'bib', 'bibtex', 'ris', 'txt'],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return { name: path.basename(file), content: await readImportFile(file) };
  });
  return {
    flushInterface: () => flush.request(),
    confirmClose: () => unsaved.confirmLoss('close'),
    unsavedWork: () => unsaved.reported(),
    forgetUnsavedWork: () => unsaved.forget(),
    quitFinished: () => quitting.finished,
  };
}

function createWindow(location: string, services: ReturnType<typeof installIpc>): void {
  const created = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    title: 'Academic Publication Tracker',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Only the application's own page may be navigated to; reloading it (the error screen's
  // "Reload app") is one of those navigations.
  created.webContents.on('will-navigate', (event) => {
    if (!isAppLocation(event.url, location)) event.preventDefault();
  });
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  created.webContents.session.setPermissionCheckHandler(() => false);
  configureSpellchecker(created.webContents.session);

  // A crashed or failed page is reloaded a few times, then the user decides.
  const recovery = createCrashRecovery();
  const alive = () => (window === created && !created.isDestroyed() ? created : null);
  function recover(action: RecoveryAction, reason: string, how: 'reload' | 'load'): void {
    if (action === 'ignore') return;
    if (action === 'reload') {
      setTimeout(() => {
        if (!alive()) return;
        if (how === 'load') void created.loadURL(location).catch(() => undefined);
        else created.webContents.reload();
      }, 300);
      return;
    }
    if (!alive()) return;
    // Not attached to the window: it may never have been shown if its page could not load at all.
    void dialog
      .showMessageBox({
        type: 'error',
        buttons: ['Try again', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        title: 'Academic Publication Tracker',
        message: 'The window could not be restored.',
        detail: `${reason} Your saved workspace is not affected.`,
      })
      .then(({ response }) => {
        if (response === 0) {
          recovery.reset();
          recover('reload', reason, how);
        } else app.quit();
      });
  }
  created.webContents.on('render-process-gone', (_event, details) =>
    recover(
      recovery.rendererGone(details.reason),
      `The window's page stopped unexpectedly (${details.reason}).`,
      'reload',
    ),
  );
  created.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) =>
    recover(
      recovery.loadFailed(code, isMainFrame),
      `The window's page could not be loaded (${description}).`,
      'load',
    ),
  );
  let asking = false;
  created.on('unresponsive', () => {
    console.warn('The application window is not responding.');
    const target = alive();
    if (asking || !target) return;
    asking = true;
    // Reloading loses what the page holds only in memory.
    const unsaved = services.unsavedWork();
    void dialog
      .showMessageBox(target, {
        type: 'warning',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        title: 'Academic Publication Tracker',
        message: 'The window is not responding.',
        detail: `Choose Wait to give it more time, or Reload to restart the window. Your saved workspace is not affected.${unsaved ? `\n\n${unsaved}\n\nThis work has not been saved and is lost if you reload.` : ''}`,
      })
      .then(({ response }) => {
        asking = false;
        // The crash handler above reloads the page.
        if (response === 1 && alive()) created.webContents.forcefullyCrashRenderer();
      });
  });

  created.once('ready-to-show', () => created.show());
  // Closing the window (which on macOS keeps the app running) first lets the interface save, then
  // asks before losing what it could not save.
  let closeFlushed = false;
  created.on('close', (event) => {
    if (closeFlushed) {
      closeFlushed = false;
      return;
    }
    if (services.quitFinished()) return;
    event.preventDefault();
    void services.flushInterface().finally(async () => {
      if (!(await services.confirmClose()) || created.isDestroyed()) return;
      closeFlushed = true;
      created.close();
    });
  });
  created.on('closed', () => {
    if (window === created) window = null;
    // What the page held only in memory is gone with it.
    services.forgetUnsavedWork();
  });
  // So is what a reloaded or crashed page held.
  created.webContents.on('did-navigate', () => services.forgetUnsavedWork());
  created.webContents.on('render-process-gone', () => services.forgetUnsavedWork());
  void created.loadURL(location).catch(() => undefined);
}

if (ownsInstance)
  void app
    .whenReady()
    .then(() => {
      const location = rendererLocation();
      const services = installIpc(location);
      const template: Electron.MenuItemConstructorOptions[] = [
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        {
          label: 'File',
          submenu: [process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }],
        },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
          ],
        },
        { role: 'windowMenu' },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
      createWindow(location, services);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(location, services);
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        'Academic Publication Tracker could not start',
        error instanceof Error ? error.message : 'Unknown startup error.',
      );
      app.quit();
    });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

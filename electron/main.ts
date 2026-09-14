import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SearchQuery, SourceId } from '../src/types';
import { searchSources } from '../src/services/sources';
import { createDesktopStore, MAX_FILE_BYTES, validateSettings } from './store';
import { controlScholarSearch, openScholarSearch, preventScholarSearchLoss } from './scholar';

app.setName('Academic Publication Tracker');
app.setAppUserModelId('org.academicpublicationtracker.desktop');
if (!app.isPackaged && process.env.APT_USER_DATA_DIR) {
  if (!path.isAbsolute(process.env.APT_USER_DATA_DIR))
    throw new Error('APT_USER_DATA_DIR must be an absolute path.');
  app.setPath('userData', process.env.APT_USER_DATA_DIR);
}

const sourceIds = new Set<SourceId>([
  'openalex',
  'crossref',
  'europepmc',
  'pubmed',
  'semantic',
  'arxiv',
  'preprints',
  'datacite',
]);
let window: BrowserWindow | null = null;
let searching = false;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

function validateQuery(value: unknown): SearchQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid search request.');
  const query = value as SearchQuery;
  if (
    typeof query.text !== 'string' ||
    !query.text.trim() ||
    query.text.length > 500 ||
    !['topic', 'author', 'doi'].includes(query.mode) ||
    !Array.isArray(query.sources) ||
    !query.sources.length ||
    query.sources.length > sourceIds.size ||
    query.sources.some((source) => !sourceIds.has(source)) ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 200
  ) {
    throw new Error(
      'Enter a search term, choose at least one supported source, and request 1–200 results per source.',
    );
  }
  const latestYear = new Date().getFullYear() + 1;
  for (const year of [query.yearFrom, query.yearTo]) {
    if (year !== undefined && (!Number.isInteger(year) || year < 1500 || year > latestYear))
      throw new Error(`Years must be between 1500 and ${latestYear}.`);
  }
  if (query.yearFrom !== undefined && query.yearTo !== undefined && query.yearFrom > query.yearTo)
    throw new Error('The first year must not be after the last year.');
  return {
    text: query.text.trim(),
    mode: query.mode,
    sources: [...new Set(query.sources)],
    limit: query.limit,
    yearFrom: query.yearFrom,
    yearTo: query.yearTo,
  };
}

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

function installIpc(location: string): void {
  const store = createDesktopStore(app.getPath('userData'), safeStorage);
  let quitAfterFlush = false;
  app.on('before-quit', (event) => {
    if (preventScholarSearchLoss()) {
      event.preventDefault();
      return;
    }
    if (quitAfterFlush) return;
    event.preventDefault();
    quitAfterFlush = true;
    void store.flush().finally(() => app.quit());
  });
  function handle(channel: string, callback: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url.split('#')[0] !== location
      ) {
        throw new Error('This request did not originate from the application.');
      }
      return callback(...args);
    });
  }
  handle('apt:workspace:load', () => store.loadWorkspace());
  handle('apt:workspace:save', (value) => store.saveWorkspace(value));
  handle('apt:settings:load', () => store.loadSettings());
  handle('apt:settings:save', (value) => store.saveSettings(validateSettings(value)));
  handle('apt:search', async (value) => {
    const query = validateQuery(value);
    if (searching) throw new Error('A search is already running. Wait for it to finish.');
    searching = true;
    try {
      return await searchSources(query, await store.loadSettings());
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
        { name: 'Publication data', extensions: ['json', 'csv', 'bib', 'bibtex', 'ris', 'txt'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > MAX_FILE_BYTES)
      throw new Error('Choose a file smaller than 25 MB.');
    return { name: path.basename(file), content: await readFile(file, 'utf8') };
  });
}

function createWindow(location: string): void {
  window = new BrowserWindow({
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(location);
}

if (ownsInstance)
  void app
    .whenReady()
    .then(() => {
      const location = rendererLocation();
      installIpc(location);
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
      createWindow(location);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(location);
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

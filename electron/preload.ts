import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/types';
import { createInvoker } from './ipc-error';

// Every call goes through one helper so a failure reaches the interface as a plain message,
// without Electron's "Error invoking remote method 'channel': Error:" prefix.
const invoke = createInvoker(ipcRenderer);

// Before the window closes or the app quits, main asks the interface to save what it still holds.
const flushListeners = new Set<() => void | Promise<void>>();
ipcRenderer.on('apt:flush', async (_event: Electron.IpcRendererEvent, request: unknown) => {
  await Promise.allSettled([...flushListeners].map(async (listener) => listener()));
  ipcRenderer.send('apt:flushed', request);
});

const bridge: DesktopBridge = {
  search: (query) => invoke('apt:search', query),
  searchScholar: (query) => invoke('apt:scholar:open', query),
  onScholarProgress: (listener) => {
    if (typeof listener !== 'function') throw new Error('A progress listener is required.');
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('apt:scholar:progress', handler);
    return () => {
      ipcRenderer.removeListener('apt:scholar:progress', handler);
    };
  },
  controlScholar: (action) => invoke('apt:scholar:control', action),
  loadWorkspace: () => invoke('apt:workspace:load'),
  saveWorkspace: (workspace) => invoke('apt:workspace:save', workspace),
  loadSettings: () => invoke('apt:settings:load'),
  saveSettings: (settings) => invoke('apt:settings:save', settings),
  exportFile: (data) => invoke('apt:file:export', data),
  importFile: () => invoke('apt:file:import'),
  openExternal: (url) => invoke('apt:external', url),
  copyText: (text) => invoke('apt:clipboard:write', text),
  onFlushRequest: (listener) => {
    if (typeof listener !== 'function') throw new Error('A flush listener is required.');
    flushListeners.add(listener);
    return () => {
      flushListeners.delete(listener);
    };
  },
  recoveryNotice: () => invoke('apt:workspace:notice'),
  // Main checks the value and asks before the window closes or the app quits while it is set.
  setUnsavedWork: (description) => ipcRenderer.send('apt:unsaved-work', description),
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));

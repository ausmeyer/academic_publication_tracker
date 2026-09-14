import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/types';

const bridge: DesktopBridge = {
  search: (query) => ipcRenderer.invoke('apt:search', query),
  searchScholar: (query) => ipcRenderer.invoke('apt:scholar:open', query),
  onScholarProgress: (listener) => {
    if (typeof listener !== 'function') throw new Error('A progress listener is required.');
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('apt:scholar:progress', handler);
    return () => {
      ipcRenderer.removeListener('apt:scholar:progress', handler);
    };
  },
  controlScholar: (action) => ipcRenderer.invoke('apt:scholar:control', action),
  loadWorkspace: () => ipcRenderer.invoke('apt:workspace:load'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('apt:workspace:save', workspace),
  loadSettings: () => ipcRenderer.invoke('apt:settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('apt:settings:save', settings),
  exportFile: (data) => ipcRenderer.invoke('apt:file:export', data),
  importFile: () => ipcRenderer.invoke('apt:file:import'),
  openExternal: (url) => ipcRenderer.invoke('apt:external', url),
  copyText: (text) => ipcRenderer.invoke('apt:clipboard:write', text),
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));

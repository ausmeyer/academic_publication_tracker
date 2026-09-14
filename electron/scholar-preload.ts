import { contextBridge, ipcRenderer } from 'electron';
import type { ScholarProgress } from '../src/types';

type ToolbarAction = 'ready' | 'resume' | 'stop' | 'cancel';
interface ToolbarState extends ScholarProgress {
  busy: boolean;
  url: string;
}
const act = (action: ToolbarAction): Promise<void> =>
  ipcRenderer.invoke('apt:scholar:action', action);
contextBridge.exposeInMainWorld('scholarBrowser', Object.freeze({ act }));

window.addEventListener('DOMContentLoaded', () => {
  const resume = document.querySelector<HTMLButtonElement>('#resume')!;
  const stop = document.querySelector<HTMLButtonElement>('#stop')!;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const location = document.querySelector<HTMLElement>('#location')!;
  const count = document.querySelector<HTMLElement>('#count')!;
  for (const button of [resume, stop, cancel])
    button.addEventListener('click', () => {
      void act(button.id as ToolbarAction).catch(() => {
        status.textContent =
          'The browser request failed. Close this window to keep retrieved papers.';
      });
    });
  ipcRenderer.on('apt:scholar:state', (_event, state: ToolbarState) => {
    resume.disabled = state.phase !== 'verification' || state.busy;
    count.textContent = `${state.count} / ${state.limit} papers · ${state.pages} pages`;
    status.textContent = state.message;
    location.textContent = state.url || 'Opening Google Scholar…';
  });
  void act('ready');
});

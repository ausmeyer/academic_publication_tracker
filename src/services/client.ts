import type { DesktopBridge, Settings, Workspace } from '../types';
import { buildScholarUrl } from '../core/scholar';

let previewSettings: Settings = {
  email: '',
  openalexApiKey: '',
  semanticApiKey: '',
  ncbiApiKey: '',
};
const preview: DesktopBridge = {
  onScholarProgress: () => () => {},
  async controlScholar() {},
  async searchScholar(query) {
    await preview.openExternal(buildScholarUrl(query));
    return null;
  },
  async search(query) {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, settings: previewSettings }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Search could not be completed. Please try again.');
    }
    return response.json();
  },
  async loadWorkspace() {
    const raw = localStorage.getItem('apt-workspace-v1');
    return raw ? (JSON.parse(raw) as Workspace) : null;
  },
  async saveWorkspace(workspace) {
    localStorage.setItem('apt-workspace-v1', JSON.stringify(workspace));
  },
  async loadSettings() {
    return previewSettings;
  },
  async saveSettings(settings) {
    previewSettings = settings;
  },
  async exportFile({ name, content }) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  async importFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.bib,.bibtex,.ris,.json';
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.addEventListener(
        'change',
        async () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          if (file.size > 25 * 1024 * 1024) {
            reject(new Error('Please select a file smaller than 25 MB.'));
            return;
          }
          try {
            resolve({ name: file.name, content: await file.text() });
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      input.click();
    });
  },
  async openExternal(url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('Only web links can be opened.');
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  },
  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },
};
export const client = window.desktop ?? preview;

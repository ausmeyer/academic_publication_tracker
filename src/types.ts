export type SourceId =
  | 'openalex'
  | 'crossref'
  | 'europepmc'
  | 'pubmed'
  | 'semantic'
  | 'arxiv'
  | 'scholar'
  | 'preprints'
  | 'datacite';
export type ApiSourceId = Exclude<SourceId, 'scholar'>;
export interface SourceInfo {
  id: SourceId;
  name: string;
  description: string;
  access: string;
  url: string;
  citationSupport: boolean;
}
export interface Settings {
  email: string;
  openalexApiKey: string;
  semanticApiKey: string;
  ncbiApiKey: string;
}
export interface SearchQuery {
  text: string;
  mode: 'topic' | 'author' | 'doi';
  sources: SourceId[];
  yearFrom?: number;
  yearTo?: number;
  limit: number;
}
export interface Provenance {
  source: SourceId;
  sourceId: string;
  citations: number | null;
  retrievedAt: string;
  url: string;
}
export interface Work {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  abstract: string;
  snippet?: string;
  type: string;
  url: string;
  openAccessUrl: string;
  isOpenAccess: boolean;
  citations: number | null;
  provenance: Provenance[];
  included: boolean;
  tags: string[];
  notes: string;
}
export interface SourceResult {
  source: SourceId;
  works: Work[];
  total: number | null;
  error?: string;
  warning?: string;
}
export interface SearchResponse {
  results: SourceResult[];
  searchedAt: string;
}
export interface ScholarProgress {
  phase: 'searching' | 'waiting' | 'verification';
  count: number;
  pages: number;
  limit: number;
  message: string;
}
export type ScholarAction = 'stop' | 'cancel' | 'show' | 'resume';
export interface Snapshot {
  id: string;
  name: string;
  query: SearchQuery;
  works: Work[];
  searchedAt: string;
  sourceResults: Omit<SourceResult, 'works'>[];
  isDemo?: boolean;
  previous?: { searchedAt: string; papers: number; citations: number };
}
export interface Workspace {
  version: 1;
  snapshots: Snapshot[];
  activeId: string | null;
}
export interface DesktopBridge {
  search(query: SearchQuery): Promise<SearchResponse>;
  searchScholar(query: SearchQuery): Promise<SearchResponse | null>;
  onScholarProgress(listener: (progress: ScholarProgress) => void): () => void;
  controlScholar(action: ScholarAction): Promise<void>;
  loadWorkspace(): Promise<Workspace | null>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  exportFile(data: { name: string; content: string }): Promise<boolean>;
  importFile(): Promise<{ name: string; content: string } | null>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
}
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

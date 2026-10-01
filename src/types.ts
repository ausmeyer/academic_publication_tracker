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
  authorsComplete?: boolean;
  citationHistory?: Array<Omit<AnnualCitation, 'key'>>;
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
  insights?: InsightsSettings;
  previous?: { searchedAt: string; papers: number; citations: number };
}
export interface PaperAnnotation {
  key: string;
  authors: string[];
  complete: boolean;
  role?: 'sole' | 'first' | 'second' | 'middle' | 'last' | 'corresponding';
}
export interface AnnualCitation {
  key: string;
  year: number;
  citations: number;
  source: SourceId;
}
export interface JournalRank {
  venue: string;
  year: number;
  category: string;
  quartile: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  source: string;
}
export interface RetractionRecord {
  doi: string;
  status: string;
  reason: string;
  date: string;
  source: string;
}
export interface InsightsSettings {
  author: string;
  aliases: string[];
  yearFrom?: number;
  yearTo?: number;
  lensConvention: boolean;
  annotations: PaperAnnotation[];
  annualCitations: AnnualCitation[];
  journalRanks: JournalRank[];
  retractions: RetractionRecord[];
}
export interface Workspace {
  version: 2;
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
  /** Desktop only: called before the app quits so the renderer can save edits still pending. */
  onFlushRequest?(listener: () => void | Promise<void>): () => void;
  /** Desktop only: explains that the workspace was restored from its automatic backup, if it was. */
  recoveryNotice?(): Promise<string | null>;
  /**
   * Desktop only: tells the shell about work that exists only in memory (search results that could
   * not be saved, edits that failed to save), or `null` once it is saved or discarded. The shell asks
   * before it closes the window or quits while this is set. The interface must call it before it
   * acknowledges a flush request if a save failed.
   */
  setUnsavedWork?(description: string | null): void;
}
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

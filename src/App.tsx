import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  LockKeyholeOpen,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ScholarAction,
  ScholarProgress,
  SearchQuery,
  Settings,
  Snapshot,
  SourceId,
  Work,
  Workspace,
} from './types';
import {
  SOURCES,
  EMPTY_SETTINGS,
  formatDate,
  formatNumber,
  sourceMark,
  sourceName,
} from './catalog';
import { client } from './services/client';
import { calculateMetrics, citationsForSource } from './core/metrics';
import { mergeWorks } from './core/merge';
import { carryForwardCuration } from './core/curation';
import { exportWorks, importWorks } from './core/formats';
import { validateWorkspace } from './core/workspace';
import Modal from './components/Modal';
import SearchDialog from './components/SearchDialog';
import SettingsDialog from './components/SettingsDialog';
import Metrics from './components/Metrics';
import Charts from './components/Charts';
import PaperDetails from './components/PaperDetails';
import SavedSearchMenu from './components/SavedSearchMenu';

type View = 'workspace' | 'library' | 'insights' | 'sources';
type ExportFormat = 'csv' | 'bibtex' | 'ris' | 'json';
const EMPTY: Workspace = { version: 1, snapshots: [], activeId: null };

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<View>('workspace');
  const [dialog, setDialog] = useState<
    'search' | 'settings' | 'export' | 'help' | 'rename' | 'delete' | null
  >(null);
  const [searchInitial, setSearchInitial] = useState<Partial<SearchQuery>>({});
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [scholarBusy, setScholarBusy] = useState(false);
  const [scholarProgress, setScholarProgress] = useState<ScholarProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'included' | 'excluded' | 'oa'>('all');
  const [sort, setSort] = useState<'citations' | 'year' | 'title'>('citations');
  const [descending, setDescending] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [metricSource, setMetricSource] = useState<SourceId | 'all'>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportScope, setExportScope] = useState<'included' | 'all' | 'visible'>('included');
  const [rename, setRename] = useState('');
  const [snapshotActionId, setSnapshotActionId] = useState<string | null>(null);
  const [searchMenu, setSearchMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const searchMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const loadStarted = useRef(false);
  const saveSequence = useRef(0);
  const scholarCanceled = useRef(false);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const active = workspace.snapshots.find((s) => s.id === workspace.activeId);
  const actionSnapshot = workspace.snapshots.find((s) => s.id === snapshotActionId);
  const menuSnapshot = workspace.snapshots.find((s) => s.id === searchMenu?.id);
  const selected = active?.works.find((w) => w.id === selectedId);
  const metrics = useMemo(
    () => calculateMetrics(active?.works ?? [], metricSource),
    [active, metricSource],
  );
  const toast = useCallback((message: string) => setNotice(message), []);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    void Promise.allSettled([client.loadWorkspace(), client.loadSettings()]).then(
      ([data, preferences]) => {
        try {
          if (data.status === 'fulfilled' && data.value)
            setWorkspace(validateWorkspace(data.value));
          else if (data.status === 'rejected') throw data.reason;
        } catch (e) {
          setLoadFailed(true);
          setError(
            `Your saved workspace could not be loaded. It has not been overwritten. ${e instanceof Error ? e.message : ''}`,
          );
        }
        if (preferences.status === 'fulfilled') setSettings(preferences.value);
        else setError('Saved API settings could not be read. Open Settings to enter them again.');
        setReady(true);
      },
    );
  }, []);
  useEffect(() => {
    if (!ready || loadFailed) return;
    const sequence = ++saveSequence.current;
    setSaving(true);
    void client
      .saveWorkspace(workspace)
      .then(() => {
        if (sequence === saveSequence.current) {
          setSaving(false);
          setSaveFailed(false);
        }
      })
      .catch((e) => {
        setSaving(false);
        setSaveFailed(true);
        setError(
          `Changes could not be saved. Export a workspace backup to keep your work. ${e instanceof Error ? e.message : ''}`,
        );
      });
  }, [workspace, ready, loadFailed]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setSelectedId(null);
    setFilter('');
    setPage(1);
    setMetricSource('all');
    setFilterMode('all');
  }, [workspace.activeId]);
  useEffect(() => {
    setPage(1);
  }, [filter, filterMode, sort, descending]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!busy) {
          setSearchInitial({});
          setDialog('search');
        }
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy]);

  const filtered = useMemo(() => {
    const needle = filter.toLocaleLowerCase();
    const works = (active?.works ?? []).filter(
      (w) =>
        (!needle ||
          [
            w.title,
            w.authors.join(' '),
            w.venue,
            w.doi,
            w.tags.join(' '),
            w.notes,
            String(w.year ?? ''),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle)) &&
        (filterMode === 'all' ||
          (filterMode === 'oa'
            ? w.isOpenAccess
            : filterMode === 'included'
              ? w.included
              : !w.included)),
    );
    return works.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title) * (descending ? -1 : 1);
      const av = sort === 'year' ? a.year : citationsForSource(a, metricSource);
      const bv = sort === 'year' ? b.year : citationsForSource(b, metricSource);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * (descending ? -1 : 1) || a.title.localeCompare(b.title);
    });
  }, [active, filter, filterMode, sort, descending, metricSource]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const availableSources = [
    ...new Set(active?.works.flatMap((w) => w.provenance.map((p) => p.source)) ?? []),
  ];

  const openSearch = (initial: Partial<SearchQuery> = {}) => {
    if (busy || !ready) return;
    if (loadFailed) {
      setError(
        'Restore a workspace backup with Import before starting a new search. The unreadable local files have been preserved.',
      );
      return;
    }
    setSearchInitial(initial);
    setDialog('search');
  };
  function updateSnapshot(
    fn: (snapshot: Snapshot) => Snapshot,
    id = workspaceRef.current.activeId,
  ) {
    try {
      const current = workspaceRef.current;
      const next = validateWorkspace({
        ...current,
        snapshots: current.snapshots.map((s) => (s.id === id ? fn(s) : s)),
      });
      workspaceRef.current = next;
      setWorkspace(next);
    } catch (e) {
      setError(
        `This edit was not saved; the previous workspace is intact. ${e instanceof Error ? e.message : ''}`,
      );
    }
  }
  function updateWork(id: string, update: Partial<Work>) {
    updateSnapshot((s) => ({
      ...s,
      works: s.works.map((w) => (w.id === id ? { ...w, ...update } : w)),
    }));
  }
  function activate(id: string) {
    setWorkspace((prev) => ({ ...prev, activeId: id }));
    setView('workspace');
  }
  function closeSearchMenu(restoreFocus = false) {
    setSearchMenu(null);
    if (restoreFocus) searchMenuTrigger.current?.focus();
  }
  function snapshotAction(id: string, action: 'rename' | 'delete') {
    const snapshot = workspaceRef.current.snapshots.find((s) => s.id === id);
    if (!snapshot) return;
    closeSearchMenu();
    setSnapshotActionId(id);
    if (action === 'rename') setRename(snapshot.name);
    setDialog(action);
  }
  function searchMenuEvents(id: string) {
    const show = (button: HTMLButtonElement, x?: number, y?: number) => {
      button.focus();
      searchMenuTrigger.current = button;
      const bounds = button.getBoundingClientRect();
      setSearchMenu({ id, x: x || bounds.left + 12, y: y || bounds.bottom });
    };
    return {
      'aria-haspopup': 'menu' as const,
      onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        show(event.currentTarget, event.clientX, event.clientY);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          show(event.currentTarget);
        }
      },
    };
  }
  async function search(query: SearchQuery, previous?: Snapshot) {
    if (busy || loadFailed || !ready) return;
    setDialog(null);
    setBusy(true);
    setError('');
    const isScholar = query.sources.includes('scholar');
    scholarCanceled.current = false;
    setScholarBusy(isScholar);
    setScholarProgress(null);
    setBusyText(
      isScholar
        ? 'Searching Google Scholar…'
        : `Searching ${query.sources.map(sourceName).join(', ')}…`,
    );
    const unsubscribe = isScholar ? client.onScholarProgress(setScholarProgress) : undefined;
    try {
      const response = isScholar ? await client.searchScholar(query) : await client.search(query);
      if (isScholar && scholarCanceled.current) return;
      if (!response) {
        if (isScholar && !window.desktop)
          toast(
            'Google Scholar opened. Use the desktop app for internal searches, or import a Scholar export file here.',
          );
        return;
      }
      if (response.results.every((r) => r.error) && !response.results.some((r) => r.works.length))
        throw new Error(
          response.results.map((r) => `${sourceName(r.source)}: ${r.error}`).join(' '),
        );
      let works = mergeWorks(response.results.flatMap((r) => r.works));
      const latestPrevious = previous
        ? (workspaceRef.current.snapshots.find((s) => s.id === previous.id) ?? previous)
        : undefined;
      if (latestPrevious) works = carryForwardCuration(works, latestPrevious.works);
      const priorMetrics = latestPrevious ? calculateMetrics(latestPrevious.works) : null;
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        name: latestPrevious?.name ?? query.text,
        query,
        works,
        searchedAt: response.searchedAt,
        sourceResults: response.results.map(({ works: _works, ...r }) => r),
        ...(previous && priorMetrics
          ? {
              previous: {
                searchedAt: previous.searchedAt,
                papers: priorMetrics.papers,
                citations: priorMetrics.citations,
              },
            }
          : {}),
      };
      const current = workspaceRef.current;
      const next = validateWorkspace({
        ...current,
        snapshots: [snapshot, ...current.snapshots],
        activeId: snapshot.id,
      });
      workspaceRef.current = next;
      setWorkspace(next);
      setView('workspace');
      toast(
        `${formatNumber(works.length)} publications saved${previous ? '. Earlier snapshot kept in your library.' : '.'}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed. Please try again.');
    } finally {
      unsubscribe?.();
      setBusy(false);
      setScholarBusy(false);
      setScholarProgress(null);
    }
  }
  async function controlScholar(action: ScholarAction) {
    if (action === 'cancel') scholarCanceled.current = true;
    try {
      await client.controlScholar(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the Scholar search.');
    }
  }
  async function importFile() {
    try {
      const file = await client.importFile();
      if (!file) return;
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(file.content.replace(/^\uFEFF/, ''));
        if (data && !Array.isArray(data) && 'snapshots' in data) {
          const backup = validateWorkspace(data);
          const snapshots = backup.snapshots.map((s) => ({ ...s, id: crypto.randomUUID() }));
          const activeIndex = backup.snapshots.findIndex((s) => s.id === backup.activeId);
          const current = workspaceRef.current;
          const next = validateWorkspace({
            ...current,
            snapshots: [...snapshots, ...current.snapshots],
            activeId: snapshots[activeIndex >= 0 ? activeIndex : 0]?.id ?? current.activeId,
          });
          workspaceRef.current = next;
          setWorkspace(next);
          setLoadFailed(false);
          setError('');
          setView('library');
          toast(`Restored ${snapshots.length} search snapshots alongside your existing workspace.`);
          return;
        }
      }
      const works = mergeWorks(importWorks(file.content, file.name));
      if (!works.length) throw new Error('No publications were found in this file.');
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        query: { text: file.name, mode: 'topic', sources: [], limit: works.length },
        works,
        searchedAt: new Date().toISOString(),
        sourceResults: [],
      };
      const current = workspaceRef.current;
      const next = validateWorkspace({
        ...current,
        snapshots: [snapshot, ...current.snapshots],
        activeId: snapshot.id,
      });
      workspaceRef.current = next;
      setWorkspace(next);
      setLoadFailed(false);
      setError('');
      setView('workspace');
      toast(`Imported ${formatNumber(works.length)} publications.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This file could not be imported.');
    }
  }
  async function backup() {
    try {
      if (
        await client.exportFile({
          name: `academic-publication-tracker-${new Date().toISOString().slice(0, 10)}.json`,
          content: JSON.stringify(workspace, null, 2),
        })
      )
        toast('Workspace backup exported.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    }
  }
  async function exportData() {
    if (!active) return;
    try {
      const works =
        exportScope === 'visible'
          ? filtered
          : exportScope === 'included'
            ? active.works.filter((w) => w.included)
            : active.works;
      const extension = exportFormat === 'bibtex' ? 'bib' : exportFormat;
      const name = `${active.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'publications'}.${extension}`;
      if (await client.exportFile({ name, content: exportWorks(works, exportFormat) })) {
        setDialog(null);
        toast(`Exported ${works.length} publications.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  }
  function setSortColumn(column: typeof sort) {
    if (sort === column) setDescending(!descending);
    else {
      setSort(column);
      setDescending(column !== 'title');
    }
  }
  const issues = active?.sourceResults.filter((r) => r.error || r.warning) ?? [];
  const countExport =
    exportScope === 'visible'
      ? filtered.length
      : exportScope === 'included'
        ? metrics.papers
        : (active?.works.length ?? 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('workspace');
          }}
          aria-label="Academic Publication Tracker home"
        >
          <img src="./icon.svg" alt="" />
          <span>
            Academic<span>Publication Tracker</span>
          </span>
        </a>
        <button
          className="new-search button"
          onClick={() => openSearch()}
          disabled={busy || !ready}
        >
          <Plus size={18} />
          New search
          <span className="shortcut">{navigator.userAgent.includes('Mac') ? '⌘ K' : 'Ctrl K'}</span>
        </button>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              ['workspace', LayoutDashboard, 'Overview'],
              ['library', FolderOpen, 'Search library'],
              ['insights', BarChart3, 'Research insights'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              className={`nav-item ${view === id ? 'active' : ''}`}
              key={id}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'library' && <span className="nav-count">{workspace.snapshots.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-label saved-label">
          SAVED SEARCHES
          <button
            className="sidebar-plus"
            aria-label="Add saved search"
            onClick={() => openSearch()}
            disabled={busy}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="saved-searches">
          {workspace.snapshots.length ? (
            workspace.snapshots.slice(0, 12).map((s) => (
              <button
                className={`saved-search ${workspace.activeId === s.id && view === 'workspace' ? 'selected' : ''}`}
                key={s.id}
                onClick={() => activate(s.id)}
                {...searchMenuEvents(s.id)}
              >
                <span className="search-bullet" />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.works.length} papers · {formatDate(s.searchedAt)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">Your searches will be saved here, ready to revisit.</p>
          )}
          {workspace.snapshots.length > 12 && (
            <button className="sidebar-see-all" onClick={() => setView('library')}>
              See all {workspace.snapshots.length} searches
              <ArrowRight size={13} />
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'sources' ? 'active' : ''}`}
            onClick={() => setView('sources')}
          >
            <Database size={17} />
            Data sources<span className="source-count">{SOURCES.length}</span>
          </button>
          <button className="nav-item" onClick={() => setDialog('settings')}>
            <SettingsIcon size={17} />
            Settings
          </button>
          <button className="nav-item" onClick={() => setDialog('help')}>
            <CircleHelp size={17} />
            About & metric guide
          </button>
          <div className="local-status">
            <span className={`status-dot ${saving ? 'saving' : ''}`} />
            <span>
              {loadFailed
                ? 'Workspace recovery needed'
                : saveFailed
                  ? 'Changes not saved'
                  : saving
                    ? 'Saving changes…'
                    : 'Stored on this device'}
              <small>Open Source</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace<span>/</span>
            <strong>
              {view === 'workspace'
                ? 'Overview'
                : view === 'library'
                  ? 'Search library'
                  : view === 'insights'
                    ? 'Research insights'
                    : 'Data sources'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="local-badge">
              <ShieldCheck size={13} />
              Local workspace
            </span>
            <button className="button secondary compact" onClick={() => void importFile()}>
              <FileUp size={15} />
              Import
            </button>
            <button
              className="button primary compact"
              disabled={!active?.works.length}
              onClick={() => setDialog('export')}
            >
              <Download size={15} />
              Export
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>Something needs attention</strong>
                <p>{error}</p>
                {loadFailed && (
                  <button className="text-button" onClick={() => location.reload()}>
                    Try loading again
                  </button>
                )}
              </div>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {busy && (
            <div className="search-progress">
              <LoaderCircle size={20} className="spin" />
              <div role="status">
                <strong>
                  {scholarProgress?.phase === 'verification'
                    ? 'Google Scholar needs your attention'
                    : busyText}
                </strong>
                <span>
                  {scholarBusy
                    ? (scholarProgress?.message ?? 'Connecting to Google Scholar…')
                    : 'Fetching and matching publications. Public sources may take a minute.'}
                </span>
                {scholarProgress && (
                  <span>
                    {scholarProgress.count} of {scholarProgress.limit} publications ·{' '}
                    {scholarProgress.pages} {scholarProgress.pages === 1 ? 'page' : 'pages'} read
                  </span>
                )}
              </div>
              {scholarBusy && window.desktop && (
                <div className="scholar-progress-actions">
                  {scholarProgress?.phase === 'verification' && (
                    <button
                      className="button secondary"
                      onClick={() => void controlScholar('show')}
                    >
                      Open verification
                    </button>
                  )}
                  <button className="button secondary" onClick={() => void controlScholar('stop')}>
                    Stop and keep results
                  </button>
                  <button className="text-button" onClick={() => void controlScholar('cancel')}>
                    Cancel search
                  </button>
                </div>
              )}
            </div>
          )}
          {!ready ? (
            <div className="loading-screen">
              <LoaderCircle className="spin" />
              Opening your workspace…
            </div>
          ) : view === 'sources' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CONNECTED KNOWLEDGE</div>
                  <h1>Open sources. Wider perspective.</h1>
                  <p>
                    Discover research across eight scholarly search sources, with the source always
                    in view.
                  </p>
                </div>
              </div>
              <div className="source-grid">
                {SOURCES.map((s) => (
                  <section className="source-card" key={s.id}>
                    <div className="source-card-top">
                      <span className={`source-logo source-${s.id}`}>{sourceMark(s.id)}</span>
                      <span className="tag">
                        {s.citationSupport ? 'Citation data' : 'Metadata'}
                      </span>
                    </div>
                    <h2>{s.name}</h2>
                    <p>{s.description}</p>
                    <div className="source-access">
                      <span className="small-dot" />
                      {s.access}
                    </div>
                    <div className="source-card-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => openSearch({ sources: [s.id] })}
                      >
                        Search source
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Visit ${s.name}`}
                        onClick={() => void client.openExternal(s.url)}
                      >
                        <ExternalLink size={15} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              <div className="information-card">
                <ShieldCheck size={25} />
                <div>
                  <h3>Access is yours. Your workspace is, too.</h3>
                  <p>
                    No app subscription or hosted account. Add personal API keys in Settings for
                    providers with limited public access. Citation coverage differs across sources;
                    PubMed and arXiv do not supply citation counts through these APIs. Google
                    Scholar collects results inside the desktop app and pauses if Google requests
                    verification.
                  </p>
                  <button className="text-button" onClick={() => setDialog('settings')}>
                    Manage API settings
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </>
          ) : view === 'library' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR RESEARCH, REVISITABLE</div>
                  <h1>
                    Search library
                    <span className="heading-count">{workspace.snapshots.length}</span>
                  </h1>
                  <p>Every search is a snapshot. Return to the evidence as you found it.</p>
                </div>
                <button className="button primary" disabled={busy} onClick={() => openSearch()}>
                  <Plus size={17} />
                  New search
                </button>
              </div>
              {workspace.snapshots.length ? (
                <div className="library-grid">
                  {workspace.snapshots.map((s) => {
                    const m = calculateMetrics(s.works);
                    return (
                      <button
                        className="library-card"
                        onClick={() => activate(s.id)}
                        key={s.id}
                        {...searchMenuEvents(s.id)}
                      >
                        <div className="library-card-top">
                          <span className="library-icon">
                            <FolderOpen size={20} />
                          </span>
                          <span className="tag">
                            {s.query.sources.length
                              ? s.query.mode === 'author'
                                ? 'Author search'
                                : s.query.mode === 'doi'
                                  ? 'DOI lookup'
                                  : 'Topic search'
                              : 'Imported'}
                          </span>
                        </div>
                        <h2>{s.name}</h2>
                        <p>
                          {s.query.sources.map(sourceName).join(' · ') || 'Imported publications'}
                        </p>
                        <div className="library-stats">
                          <span>
                            <strong>{formatNumber(m.papers)}</strong>papers
                          </span>
                          <span>
                            <strong>{formatNumber(m.citations)}</strong>citations
                          </span>
                          <span>
                            <strong>{m.hIndex}</strong>h-index
                          </span>
                        </div>
                        <div className="library-footer">
                          <span>{formatDate(s.searchedAt)}</span>
                          <ArrowRight size={17} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState onSearch={openSearch} onImport={() => void importFile()} />
              )}
            </>
          ) : !active ? (
            <>
              <div className="page-heading welcome-heading">
                <div>
                  <div className="eyebrow">ACADEMIC PUBLICATION TRACKER</div>
                  <h1>Your research, in perspective.</h1>
                  <p>
                    A thoughtful workspace for finding literature, understanding impact,
                    <br className="desktop-break" /> and keeping the evidence together.
                  </p>
                </div>
                <div className="welcome-mark">
                  <BookOpen size={62} strokeWidth={1.2} />
                  <span className="orbit orbit-one" />
                  <span className="orbit orbit-two" />
                </div>
              </div>
              <EmptyState onSearch={openSearch} onImport={() => void importFile()} />
              <div className="welcome-sources">
                <div className="section-label">
                  <span>EIGHT SOURCES. ONE RESEARCH WORKSPACE.</span>
                  <button className="text-button" onClick={() => setView('sources')}>
                    Explore sources
                    <ArrowRight size={14} />
                  </button>
                </div>
                <div className="source-wordmarks">
                  {SOURCES.map((s) => (
                    <span key={s.id}>
                      <i className={`source-dot source-${s.id}`} />
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="welcome-footer">
                <ShieldCheck size={17} />
                <span>Saved locally. Exportable at any time. Built for open research.</span>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div className="heading-copy">
                  <div className="eyebrow">
                    {view === 'insights' ? 'RESEARCH INSIGHTS' : 'RESEARCH OVERVIEW'}
                    {active.query.mode === 'author' && (
                      <span className="eyebrow-divider">AUTHOR SEARCH</span>
                    )}
                  </div>
                  <h1 title={active.name}>{active.name}</h1>
                  <div className="snapshot-description">
                    <span>{formatDate(active.searchedAt)}</span>
                    <span className="separator">·</span>
                    <span>
                      {active.query.sources.map(sourceName).join(' + ') || 'Imported publications'}
                    </span>
                    {active.query.yearFrom || active.query.yearTo ? (
                      <>
                        <span className="separator">·</span>
                        <span>
                          {active.query.yearFrom ?? 'Any year'}–{active.query.yearTo ?? 'present'}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="heading-actions">
                  <button
                    className="button secondary compact"
                    onClick={() => void search(active.query, active)}
                    disabled={busy || !active.query.sources.length}
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                  <details className="action-menu">
                    <summary aria-label="Search actions">
                      <MoreHorizontal size={20} />
                    </summary>
                    <div>
                      <button onClick={() => snapshotAction(active.id, 'rename')}>
                        Rename search
                      </button>
                      <button onClick={() => openSearch(active.query)} disabled={busy}>
                        Edit & run new search
                      </button>
                      <button onClick={() => void backup()}>Back up workspace</button>
                      <button
                        className="danger-text"
                        onClick={() => snapshotAction(active.id, 'delete')}
                      >
                        Delete this snapshot
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              {active.previous && (
                <div className="refresh-note">
                  <RefreshCw size={14} />
                  New snapshot compared with {formatDate(active.previous.searchedAt)}:{' '}
                  {metrics.papers - active.previous.papers >= 0 ? '+' : ''}
                  {metrics.papers - active.previous.papers} included papers. Earlier snapshot
                  retained in your library.
                </div>
              )}
              <div className="metrics-toolbar">
                <div className="live-label">
                  <span className="small-dot" />
                  Snapshot metrics<span>Based on included publications</span>
                </div>
                <label className="source-select">
                  Citation source
                  <select
                    aria-label="Citation source"
                    value={metricSource}
                    onChange={(e) => setMetricSource(e.target.value as SourceId | 'all')}
                  >
                    <option value="all">Combined · highest per paper</option>
                    {availableSources.map((id) => (
                      <option key={id} value={id}>
                        {sourceName(id)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Metrics
                metrics={metrics}
                excluded={active.works.length - metrics.papers}
                onHelp={() => setDialog('help')}
              />
              {view === 'insights' ? (
                <>
                  <Charts metrics={metrics} expanded />
                  <div className="secondary-metrics">
                    <div>
                      <span>i10-index</span>
                      <strong>{metrics.i10Index}</strong>
                      <small>Papers with at least 10 citations</small>
                    </div>
                    <div>
                      <span>Average citations</span>
                      <strong>{formatNumber(metrics.citationsPerPaper)}</strong>
                      <small>Per included paper with counts</small>
                    </div>
                    <div>
                      <span>Citations per year</span>
                      <strong>{formatNumber(metrics.citationsPerYear)}</strong>
                      <small>Since first included publication</small>
                    </div>
                    <div>
                      <span>Open access</span>
                      <strong>{metrics.openAccess}</strong>
                      <small>Included papers with open access</small>
                    </div>
                  </div>
                  <div className="information-card">
                    <CircleHelp size={23} />
                    <div>
                      <h3>Context belongs beside the numbers.</h3>
                      <p>
                        These metrics describe the retrieved, included papers. Result limits, author
                        ambiguity, missing citation counts, and each database’s coverage affect
                        them. Combined counts are maxima across sources, not a union of unique
                        citing papers. Publication-year charts show output, not citations received
                        over time.
                      </p>
                      <button className="text-button" onClick={() => setDialog('help')}>
                        Read the metric guide
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="results-layout">
                    <section className="results-panel">
                      <div className="results-heading">
                        <div>
                          <h2>
                            Publications<span>{active.works.length}</span>
                          </h2>
                          <p>Explore your results. Include the work that belongs.</p>
                        </div>
                        <button
                          className="icon-button"
                          title="View research insights"
                          aria-label="View research insights"
                          onClick={() => setView('insights')}
                        >
                          <BarChart3 size={19} />
                        </button>
                      </div>
                      <div className="table-toolbar">
                        <div className="filter-input">
                          <Search size={16} />
                          <input
                            ref={filterInput}
                            aria-label="Filter publications"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Filter by title, author, DOI, or tag…"
                          />
                          {filter && (
                            <button
                              className="icon-button"
                              aria-label="Clear filter"
                              onClick={() => setFilter('')}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                        <label className="filter-select">
                          <SlidersHorizontal size={14} />
                          <select
                            aria-label="Publication filter"
                            value={filterMode}
                            onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
                          >
                            <option value="all">All papers</option>
                            <option value="included">Included</option>
                            <option value="excluded">Excluded</option>
                            <option value="oa">Open access</option>
                          </select>
                        </label>
                      </div>
                      <div className="table-scroll">
                        <table className="publication-table">
                          <thead>
                            <tr>
                              <th className="check-cell">
                                <input
                                  type="checkbox"
                                  aria-label="Include all filtered publications"
                                  checked={filtered.length > 0 && filtered.every((w) => w.included)}
                                  ref={(el) => {
                                    if (el)
                                      el.indeterminate =
                                        filtered.some((w) => w.included) &&
                                        !filtered.every((w) => w.included);
                                  }}
                                  disabled={!filtered.length}
                                  onChange={(e) => {
                                    const ids = new Set(filtered.map((w) => w.id));
                                    const included = e.target.checked;
                                    updateSnapshot((s) => ({
                                      ...s,
                                      works: s.works.map((w) =>
                                        ids.has(w.id) ? { ...w, included } : w,
                                      ),
                                    }));
                                  }}
                                />
                              </th>
                              <th>
                                <button onClick={() => setSortColumn('title')}>
                                  Publication
                                  {sort === 'title' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                              <th className="year-cell">
                                <button onClick={() => setSortColumn('year')}>
                                  Year
                                  {sort === 'year' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                              <th className="citations-cell">
                                <button onClick={() => setSortColumn('citations')}>
                                  Citations
                                  {sort === 'citations' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                              <th className="access-cell">Access</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((w) => {
                              const count = citationsForSource(w, metricSource);
                              return (
                                <tr
                                  className={`${selectedId === w.id ? 'selected-row' : ''} ${!w.included ? 'excluded-row' : ''}`}
                                  key={w.id}
                                >
                                  <td className="check-cell">
                                    <input
                                      type="checkbox"
                                      aria-label={`Include ${w.title}`}
                                      checked={w.included}
                                      onChange={(e) =>
                                        updateWork(w.id, { included: e.target.checked })
                                      }
                                    />
                                  </td>
                                  <td className="publication-cell">
                                    <button
                                      className="paper-title"
                                      onClick={() => setSelectedId(w.id)}
                                    >
                                      {w.title}
                                    </button>
                                    <div className="paper-authors" title={w.authors.join(', ')}>
                                      {w.authors.slice(0, 3).join(', ')}
                                      {w.authors.length > 3 ? ' et al.' : ''}
                                      {w.authors.length === 0 ? 'Authors not provided' : ''}
                                    </div>
                                    <div className="paper-meta">
                                      <span className="paper-venue" title={w.venue}>
                                        {w.venue || 'Venue not provided'}
                                      </span>
                                      {w.tags.slice(0, 2).map((t) => (
                                        <span className="paper-tag" key={t}>
                                          {t}
                                        </span>
                                      ))}
                                      {w.provenance.length > 1 && (
                                        <span
                                          className="matched-source"
                                          title={w.provenance
                                            .map((p) => sourceName(p.source))
                                            .join(', ')}
                                        >
                                          {new Set(w.provenance.map((p) => p.source)).size} sources
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="year-cell">{w.year ?? '—'}</td>
                                  <td className="citations-cell">
                                    <strong>{count === null ? '—' : formatNumber(count)}</strong>
                                    {count !== null &&
                                      w.year !== null &&
                                      w.year <= new Date().getFullYear() && (
                                        <small>
                                          {formatNumber(
                                            count / (new Date().getFullYear() - w.year + 1),
                                          )}
                                          /yr
                                        </small>
                                      )}
                                  </td>
                                  <td className="access-cell">
                                    {w.isOpenAccess ? (
                                      <span className="oa-badge" title="Open access">
                                        <LockKeyholeOpen size={13} />
                                        <span>Open</span>
                                      </span>
                                    ) : (
                                      <span
                                        className="unknown-access"
                                        title="Open access not indicated"
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {!filtered.length && (
                          <div className="table-empty">
                            <Search size={28} />
                            <h3>
                              {active.works.length
                                ? 'No publications match these filters'
                                : 'No publications found'}
                            </h3>
                            <p>
                              {active.works.length
                                ? 'Try a different term or show all papers.'
                                : 'Try broader terms, a different source, or another year range.'}
                            </p>
                            <button
                              className="button secondary compact"
                              onClick={() =>
                                active.works.length
                                  ? (setFilter(''), setFilterMode('all'))
                                  : openSearch(active.query)
                              }
                            >
                              {active.works.length ? 'Clear filters' : 'Refine search'}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="table-footer">
                        <span>
                          {filtered.length
                            ? `${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, filtered.length)} of ${formatNumber(filtered.length)}`
                            : '0'}{' '}
                          publications
                        </span>
                        <div>
                          <button
                            disabled={currentPage === 1}
                            onClick={() => setPage(currentPage - 1)}
                          >
                            Previous
                          </button>
                          <span>
                            {currentPage} / {pageCount}
                          </span>
                          <button
                            disabled={currentPage === pageCount}
                            onClick={() => setPage(currentPage + 1)}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </section>
                    {selected && (
                      <PaperDetails
                        key={selected.id}
                        work={selected}
                        onClose={() => setSelectedId(null)}
                        onUpdate={(update) => updateWork(selected.id, update)}
                        onToast={toast}
                      />
                    )}
                  </div>
                  <Charts metrics={metrics} />
                </>
              )}
              <details
                className={`retrieval-details ${issues.length ? 'has-issues' : ''}`}
                open={issues.length > 0 ? true : undefined}
              >
                <summary>
                  <Database size={14} />
                  {issues.length
                    ? `${issues.length} source notice${issues.length === 1 ? '' : 's'} · review retrieval details`
                    : 'Search provenance & coverage'}
                  <ChevronDown size={14} />
                </summary>
                <div>
                  <p>
                    Retrieved {new Date(active.searchedAt).toLocaleString()}.{' '}
                    {active.query.sources.length
                      ? active.query.sources.includes('scholar')
                        ? `Scholar collection with a ${active.query.limit}-paper limit. Each record keeps the address of its retrieved page. Coverage depends on the pages available during this search; it is not a complete bibliography.`
                        : `Requested up to ${active.query.limit} results per source. This is a search result set, not a guaranteed complete bibliography.`
                      : 'Imported records retain any provided source metadata.'}{' '}
                    Exclusions affect metrics; filters only affect the table.
                  </p>
                  {active.sourceResults.map((r) => (
                    <p key={r.source}>
                      <strong>{sourceName(r.source)}:</strong>{' '}
                      {[r.error, r.warning].filter(Boolean).join(' ') ||
                        `${active.works.filter((w) => w.provenance.some((p) => p.source === r.source)).length} matching records retained${r.total !== null ? `; source reports ${r.source === 'scholar' ? 'approximately ' : ''}${formatNumber(r.total)} total matches` : ''}.`}
                    </p>
                  ))}
                </div>
              </details>
            </>
          )}
          <footer className="main-footer">
            <span>Academic Publication Tracker</span>
            <span>
              Independent software for open scholarship{' '}
              <span className="footer-version">v0.4.3</span>
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {dialog === 'search' && (
        <SearchDialog
          initial={searchInitial}
          onClose={() => setDialog(null)}
          onSearch={(q) => void search(q)}
        />
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSave={async (s) => {
            await client.saveSettings(s);
            setSettings(s);
            toast('Settings saved.');
          }}
          onBackup={() => void backup()}
        />
      )}
      {dialog === 'export' && (
        <Modal
          title="Export publications"
          description="Take your work into a reference manager, spreadsheet, or analysis."
          onClose={() => setDialog(null)}
        >
          <div className="export-options">
            {(
              [
                ['csv', 'CSV spreadsheet', 'Publication data, citations, and source provenance'],
                ['bibtex', 'BibTeX', 'For LaTeX and academic writing'],
                ['ris', 'RIS reference file', 'For Zotero, EndNote, and other reference managers'],
                ['json', 'JSON records', 'Complete records, notes, tags, and screening decisions'],
              ] as const
            ).map(([id, label, help]) => (
              <label className={`export-option ${exportFormat === id ? 'selected' : ''}`} key={id}>
                <input
                  type="radio"
                  name="format"
                  value={id}
                  checked={exportFormat === id}
                  onChange={() => setExportFormat(id)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{help}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            Publications to export
            <select
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value as typeof exportScope)}
            >
              <option value="included">Included publications</option>
              <option value="all">All publications in this snapshot</option>
              <option value="visible">All matching current table filters</option>
            </select>
          </label>
          <p className="field-help">
            {countExport} publications. Citation exports use the combined count and retain source
            counts where the format supports them. Use workspace backup for full search history.
          </p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!countExport}
              onClick={() => void exportData()}
            >
              <Download size={16} />
              Export {exportFormat.toUpperCase()}
            </button>
          </div>
        </Modal>
      )}
      {searchMenu && menuSnapshot && (
        <SavedSearchMenu
          key={menuSnapshot.id}
          name={menuSnapshot.name}
          x={searchMenu.x}
          y={searchMenu.y}
          onOpen={() => {
            closeSearchMenu();
            activate(menuSnapshot.id);
          }}
          onRename={() => snapshotAction(menuSnapshot.id, 'rename')}
          onDelete={() => snapshotAction(menuSnapshot.id, 'delete')}
          onClose={closeSearchMenu}
        />
      )}
      {dialog === 'rename' && actionSnapshot && (
        <Modal title="Rename search" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename.trim()) {
                updateSnapshot((s) => ({ ...s, name: rename.trim() }), actionSnapshot.id);
                setDialog(null);
              }
            }}
          >
            <label className="field">
              Search name
              <input
                autoFocus
                required
                maxLength={200}
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
            </label>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="button primary">Save name</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'delete' && actionSnapshot && (
        <Modal
          title="Delete this snapshot?"
          description={`“${actionSnapshot.name}” and its notes will be removed from this workspace. Other snapshots will remain.`}
          onClose={() => setDialog(null)}
        >
          <p className="field-help">
            Export a workspace backup first if you may need this snapshot again.
          </p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setDialog(null)}>
              Keep snapshot
            </button>
            <button
              className="button danger"
              onClick={() => {
                const current = workspaceRef.current;
                const snapshots = current.snapshots.filter((s) => s.id !== actionSnapshot.id);
                const next = {
                  ...current,
                  snapshots,
                  activeId:
                    current.activeId === actionSnapshot.id
                      ? (snapshots[0]?.id ?? null)
                      : current.activeId,
                };
                workspaceRef.current = next;
                setWorkspace(next);
                setDialog(null);
                toast('Snapshot deleted.');
              }}
            >
              <Trash2 size={15} />
              Delete snapshot
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'help' && (
        <Modal
          title="Put the numbers in context"
          description="A short guide to transparent bibliometrics."
          onClose={() => setDialog(null)}
          wide
        >
          <div className="help-content">
            <p>
              Academic Publication Tracker is independent, MIT-licensed software inspired by the
              academic workflow of Publish or Perish. It is not affiliated with Publish or Perish or
              its data providers.
            </p>
            <dl>
              <dt>h-index</dt>
              <dd>The largest h for which h included papers each have at least h citations.</dd>
              <dt>g-index</dt>
              <dd>
                The largest g for which the top g included papers have at least g² citations in
                total, capped at the number of included papers.
              </dd>
              <dt>i10-index</dt>
              <dd>The number of included papers with 10 or more citations.</dd>
              <dt>Combined citation counts</dt>
              <dd>
                The highest available count for each paper across its sources. Counts are never
                added across databases. This is not a count of unique citing papers. Choose one
                citation source for a consistent database view.
              </dd>
              <dt>Coverage and missing values</dt>
              <dd>
                A dash means no count was provided, not zero citations. Indices are lower bounds
                when coverage is incomplete. Mean and median citations use only papers with known
                counts.
              </dd>
              <dt>Time and annual rates</dt>
              <dd>
                Annual rates divide by years since the first included publication, including the
                current year. Per-paper rates use its publication year. Charts show papers by
                publication year, not historical citation growth.
              </dd>
              <dt>Screening and completeness</dt>
              <dd>
                Uncheck unrelated publications to exclude them from metrics. Author names can be
                ambiguous, and database search limits can omit relevant work. Citation indices here
                describe your included result set, not a verified author profile. Self-citations are
                not removed.
              </dd>
              <dt>Saved snapshots and privacy</dt>
              <dd>
                Every search is saved locally. Refresh creates a new snapshot and keeps the previous
                one. Notes and tags transfer for matching papers. Query text and API credentials are
                sent only to the selected providers. No analytics, account, or background sync.
              </dd>
            </dl>
            <p className="field-help">
              Version 0.4.2 · Sources and metric definitions are documented in the open-source
              project.
            </p>
          </div>
          <div className="modal-footer">
            <button className="button primary" onClick={() => setDialog(null)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmptyState({
  onSearch,
  onImport,
}: {
  onSearch: (initial?: Partial<SearchQuery>) => void;
  onImport: () => void;
}) {
  return (
    <section className="welcome-panel">
      <div className="welcome-panel-heading">
        <span className="welcome-icon">
          <Sparkles size={21} />
        </span>
        <div>
          <h2>Start with a question.</h2>
          <p>Build a publication set you can understand, review, and return to.</p>
        </div>
      </div>
      <div className="start-options">
        <button onClick={() => onSearch({ mode: 'author' })}>
          <span className="start-icon">
            <Search size={23} />
          </span>
          <h3>Find an author’s work</h3>
          <p>Explore a research career and review its citation impact.</p>
          <span className="start-link">
            Search an author
            <ArrowRight size={15} />
          </span>
        </button>
        <button onClick={() => onSearch({ mode: 'topic' })}>
          <span className="start-icon">
            <BookOpen size={23} />
          </span>
          <h3>Explore a research topic</h3>
          <p>Search across disciplines and bring the literature together.</p>
          <span className="start-link">
            Explore a topic
            <ArrowRight size={15} />
          </span>
        </button>
        <button onClick={onImport}>
          <span className="start-icon">
            <FileUp size={23} />
          </span>
          <h3>Bring your publications</h3>
          <p>Import CSV, BibTeX, RIS, or JSON from your existing workflow.</p>
          <span className="start-link">
            Import publications
            <ArrowRight size={15} />
          </span>
        </button>
      </div>
      <div className="example-search">
        <span>Want to explore first?</span>
        <button
          className="text-button"
          onClick={() =>
            onSearch({
              mode: 'topic',
              text: 'epidemic forecasting',
              sources: ['europepmc'],
              limit: 25,
            })
          }
        >
          Try “epidemic forecasting”
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

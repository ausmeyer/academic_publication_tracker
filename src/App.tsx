import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  formatDateTime,
  formatNumber,
  sourceMark,
  sourceName,
} from './catalog';
import { APP_VERSION } from './version';
import { client } from './services/client';
import { searchSelectedSources } from './services/combined-search';
import { calculateMetrics, citationsForSource } from './core/metrics';
import { analyzeInsights } from './core/insights';
import { carryInsights, defaultInsights } from './core/insights-data';
import { mergeWorks } from './core/merge';
import { carryForwardCuration } from './core/curation';
import { exportWorks, importWorksWithReport } from './core/formats';
import { validateWorkspace } from './core/workspace';
import {
  backupFileName,
  capacityWarning,
  countText,
  describeSaveFailure,
  exportFileName,
  filterTokens,
  importSummary,
  matchesFilter,
  settleEdit,
  snapshotMetrics,
  unsavedWork,
  type RefusedEdit,
} from './library';
import Modal, { announceInDialog } from './components/Modal';
import Banner from './components/Banner';
import ActionMenu from './components/ActionMenu';
import PendingResults, { type PendingSave } from './components/PendingResults';
import SearchDialog from './components/SearchDialog';
import SettingsDialog from './components/SettingsDialog';
import Metrics from './components/Metrics';
import Charts from './components/Charts';
import LocalInsights from './components/LocalInsights';
import PaperDetails from './components/PaperDetails';
import SavedSearchMenu from './components/SavedSearchMenu';

type View = 'workspace' | 'library' | 'insights' | 'sources';
type ExportFormat = 'csv' | 'bibtex' | 'ris' | 'json';
// One dialog at a time, including the ones of the held-results banners.
type DialogName =
  | 'search'
  | 'settings'
  | 'export'
  | 'help'
  | 'rename'
  | 'delete'
  | 'capacity'
  | 'held-remove'
  | 'held-discard'
  | null;
/** Builds the snapshot to save from the workspace as it is then; the ids in `removed` are about to go. */
type Build = (current: Workspace, removed: Set<string>) => { snapshot: Snapshot; message: string };
type Held = PendingSave & { build: Build };
const EMPTY: Workspace = { version: 2, snapshots: [], activeId: null };
const IS_MAC = navigator.userAgent.includes('Mac');
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNumber(Math.abs(n))}`;

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<View>('workspace');
  const [dialog, setDialog] = useState<DialogName>(null);
  const [searchInitial, setSearchInitial] = useState<Partial<SearchQuery>>({});
  const [searchFailure, setSearchFailure] = useState('');
  const [searchWarning, setSearchWarning] = useState('');
  const [capacityGate, setCapacityGate] = useState<{ message: string; proceed: () => void } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [scholarBusy, setScholarBusy] = useState(false);
  const [scholarProgress, setScholarProgress] = useState<ScholarProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  // Every result set that could not be saved, until it is saved or discarded: none replaces another.
  const [held, setHeld] = useState<Held[]>([]);
  // Set with the list (changeHeld), so a flush in the same moment reports it as it is.
  const heldRef = useRef(held);
  /** The held result set whose dialog is open. */
  const [heldTarget, setHeldTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  /** The last save failed, so storage lacks what the app shows (the banner may be dismissed). */
  const [unsaved, setUnsaved] = useState(false);
  // Typed text the workspace refused: kept, and counted as unsaved, until it is stored or dropped.
  const [refused, setRefused] = useState<RefusedEdit[]>([]);
  const refusedRef = useRef(refused);
  /** The message about the last refused edit; it goes once nothing refused is left. */
  const refusal = useRef('');
  const retryRef = useRef(() => {});
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'included' | 'excluded'>('all');
  const [sort, setSort] = useState<'citations' | 'year' | 'title'>('citations');
  const [descending, setDescending] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [metricSource, setMetricSource] = useState<SourceId | 'all'>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportScope, setExportScope] = useState<'included' | 'all' | 'visible'>('included');
  const [rename, setRename] = useState('');
  const [renameError, setRenameError] = useState('');
  const [snapshotActionId, setSnapshotActionId] = useState<string | null>(null);
  const [searchMenu, setSearchMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const searchMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const tableScroll = useRef<HTMLDivElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const loadStarted = useRef(false);
  const saveSequence = useRef(0);
  /** The workspace most recently handed to storage (null after a failed save, so the next change retries). */
  const requested = useRef<Workspace | null>(null);
  /** Whether that save stored it (it may still be running). */
  const lastSave = useRef<Promise<boolean>>(Promise.resolve(true));
  /** `hiding`: the window is only hidden, so what is being typed may still be finished. */
  const flushers = useRef(new Set<(hiding: boolean) => void>());
  const scholarCanceled = useRef(false);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const loadFailedRef = useRef(loadFailed);
  loadFailedRef.current = loadFailed;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const active = workspace.snapshots.find((s) => s.id === workspace.activeId);
  const actionSnapshot = workspace.snapshots.find((s) => s.id === snapshotActionId);
  const menuSnapshot = workspace.snapshots.find((s) => s.id === searchMenu?.id);
  const selected = active?.works.find((w) => w.id === selectedId);
  const insightsSettings = useMemo(() => (active ? defaultInsights(active) : null), [active]);
  // The analysis is the expensive part of an edit, and only the Insights view shows it.
  const insights = useMemo(
    () =>
      view === 'insights' && active && insightsSettings
        ? analyzeInsights(active.works, insightsSettings, metricSource)
        : null,
    [view, active, insightsSettings, metricSource],
  );
  // Counts for the whole snapshot: exports and the refresh note must not follow the Insights range.
  const overviewMetrics = useMemo(
    () => calculateMetrics(active?.works ?? [], metricSource),
    [active, metricSource],
  );
  const metrics = useMemo(
    () =>
      insights
        ? calculateMetrics(
            insights.rows.map((r) => r.work),
            metricSource,
          )
        : overviewMetrics,
    [insights, overviewMetrics, metricSource],
  );
  const toast = useCallback((message: string) => setNotice(message), []);

  const flushPending = useCallback((hiding = false) => {
    for (const flush of [...flushers.current]) flush(hiding);
    retryRef.current();
  }, []);
  const registerFlush = useCallback((flush: (hiding: boolean) => void) => {
    flushers.current.add(flush);
    return () => {
      flushers.current.delete(flush);
    };
  }, []);
  /** Resolves true when storage holds `next`, false when the save failed. */
  const save = useCallback((next: Workspace): Promise<boolean> => {
    requested.current = next;
    const sequence = ++saveSequence.current;
    setSaving(true);
    const saved = client.saveWorkspace(next).then(
      () => {
        if (sequence !== saveSequence.current) return true;
        setSaving(false);
        setSaveError('');
        setUnsaved(false);
        return true;
      },
      (e) => {
        if (requested.current === next) requested.current = null;
        if (sequence === saveSequence.current) setSaving(false);
        setSaveError(
          `Changes could not be saved. Export a workspace backup to keep your work. ${e instanceof Error ? e.message : ''}`,
        );
        setUnsaved(true);
        return false;
      },
    );
    lastSave.current = saved;
    return saved;
  }, []);
  /**
   * Saves now whatever the running app holds and storage does not (window closing, app quitting);
   * false when storage still lacks it.
   */
  const persistNow = useCallback((): Promise<boolean> => {
    const current = workspaceRef.current;
    if (!readyRef.current || loadFailedRef.current) return Promise.resolve(true);
    // Already handed to storage: that save may still be running, and may still fail.
    if (current === requested.current) return lastSave.current;
    return save(current);
  }, [save]);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    void Promise.allSettled([client.loadWorkspace(), client.loadSettings()]).then(
      ([data, preferences]) => {
        const problems: string[] = [];
        let loaded: Workspace | null = null;
        try {
          if (data.status === 'fulfilled' && data.value) loaded = validateWorkspace(data.value);
          else if (data.status === 'rejected') throw data.reason;
        } catch (e) {
          setLoadFailed(true);
          problems.push(
            `Your saved workspace could not be loaded. It has not been overwritten. ${e instanceof Error ? e.message : ''}`,
          );
        }
        if (loaded) setWorkspace(loaded);
        requested.current = loaded ?? EMPTY;
        if (preferences.status === 'fulfilled') setSettings(preferences.value);
        else
          problems.push('Saved API settings could not be read. Open Settings to enter them again.');
        if (problems.length) setError(problems.join('\n'));
        setReady(true);
        void Promise.resolve(client.recoveryNotice?.())
          .then((text) => text && setRecoveryNotice(text))
          .catch(() => {});
      },
    );
  }, []);
  useEffect(() => {
    if (!ready || loadFailed) return;
    const stored = requested.current;
    // Nothing new since the last save (this includes the load at startup).
    if (workspace === stored) return;
    // Only the open snapshot changed: it is saved with the next edit or when the window closes.
    if (stored && workspace.snapshots === stored.snapshots) return;
    void save(workspace);
  }, [workspace, ready, loadFailed, save]);
  useEffect(() => {
    const leave = (event: Event) => {
      flushPending(event.type === 'visibilitychange');
      void persistNow();
    };
    const hidden = (event: Event) => {
      if (document.visibilityState === 'hidden') leave(event);
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = client.onFlushRequest?.(async () => {
      flushPending();
      const stored = await persistNow();
      // The shell asks before closing while unsaved work is reported: report it before answering.
      client.setUnsavedWork?.(
        unsavedWork(
          heldRef.current.map((h) => h.snapshot.name),
          !stored,
          refusedRef.current.map((e) => e.label),
        ),
      );
    });
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
      unsubscribe?.();
    };
  }, [flushPending, persistNow]);
  // Work that exists only in memory: the desktop shell (or the browser) asks before closing.
  const unsavedDescription = unsavedWork(
    held.map((h) => h.snapshot.name),
    unsaved,
    refused.map((e) => e.label),
  );
  useEffect(() => {
    client.setUnsavedWork?.(unsavedDescription);
  }, [unsavedDescription]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), Math.max(4500, notice.length * 60));
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
  // A saved-search menu sits above the page; it must not stay above (and act behind) a dialog.
  useEffect(() => {
    if (dialog) setSearchMenu(null);
  }, [dialog]);
  // A banner raised while a dialog is open is behind it: the dialog announces it too.
  const heldCount = useRef(0);
  useEffect(() => announceInDialog(''), [dialog]);
  useEffect(() => {
    // A refused name is shown by the Rename dialog itself.
    if (dialogRef.current && error && error !== refusal.current) announceInDialog(error);
  }, [error]);
  useEffect(() => {
    if (dialogRef.current && saveError) announceInDialog(saveError);
  }, [saveError]);
  useEffect(() => {
    if (dialogRef.current && held.length > heldCount.current)
      announceInDialog(`These results have not been saved. ${held.at(-1)!.reason}`);
    heldCount.current = held.length;
  }, [held]);
  const openSearchRef = useRef<() => void>(() => {});
  useEffect(() => {
    function key(e: KeyboardEvent) {
      // Cmd+K on macOS, where Ctrl+K deletes to the end of the line in text fields.
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Never replace a dialog that is already open (Settings, Rename, …).
        if (!dialogRef.current) openSearchRef.current();
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const filterWords = useMemo(() => filterTokens(filter), [filter]);
  const filtered = useMemo(() => {
    const works = (active?.works ?? []).filter(
      (w) =>
        matchesFilter(w, filterWords) &&
        (filterMode === 'all' || (filterMode === 'included' ? w.included : !w.included)),
    );
    return works.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title) * (descending ? -1 : 1);
      const av = sort === 'year' ? a.year : citationsForSource(a, metricSource);
      const bv = sort === 'year' ? b.year : citationsForSource(b, metricSource);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * (descending ? -1 : 1) || a.title.localeCompare(b.title);
    });
  }, [active, filterWords, filterMode, sort, descending, metricSource]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  useEffect(() => {
    tableScroll.current?.scrollTo({ top: 0 });
  }, [currentPage, filterWords, filterMode, sort, descending, workspace.activeId]);
  const availableSources = [
    ...new Set([
      ...(active?.works.flatMap((w) => w.provenance.map((p) => p.source)) ?? []),
      ...(active?.works.flatMap((w) => (w.citationHistory ?? []).map((p) => p.source)) ?? []),
      ...(active?.insights?.annualCitations.map((r) => r.source) ?? []),
    ]),
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
    setSearchFailure('');
    setSearchWarning(capacityWarning(workspaceRef.current) ?? '');
    setDialog('search');
  };
  openSearchRef.current = () => openSearch();
  /** Runs `proceed` at once, or after the person confirms when the workspace is nearly full. */
  function withCapacityCheck(proceed: () => void) {
    const warning = capacityWarning(workspaceRef.current);
    if (!warning) {
      proceed();
      return;
    }
    setCapacityGate({ message: warning, proceed });
    setDialog('capacity');
  }
  function updateSnapshot(
    fn: (snapshot: Snapshot) => Snapshot,
    id = workspaceRef.current.activeId,
  ): boolean {
    try {
      const current = workspaceRef.current;
      const next = validateWorkspace({
        ...current,
        snapshots: current.snapshots.map((s) => (s.id === id ? fn(s) : s)),
      });
      workspaceRef.current = next;
      setWorkspace(next);
      return true;
    } catch (e) {
      refusal.current = `This edit was not saved; the previous workspace is intact. ${e instanceof Error ? e.message : ''}`;
      setError(refusal.current);
      return false;
    }
  }
  function settle(edit: RefusedEdit, stored: boolean) {
    const next = settleEdit(refusedRef.current, edit, stored);
    if (next === refusedRef.current) return;
    refusedRef.current = next;
    setRefused(next);
    if (!next.length) setError((e) => (e === refusal.current ? '' : e));
  }
  /** True when the workspace holds the update; refused notes and tags are kept to be tried again. */
  function updateWork(
    id: string,
    update: Partial<Work>,
    snapshotId = workspaceRef.current.activeId,
  ): boolean {
    const existing = workspaceRef.current.snapshots
      .find((s) => s.id === snapshotId)
      ?.works.find((w) => w.id === id);
    const edit: RefusedEdit = {
      key: `${snapshotId}/${id}`,
      label: existing?.title ?? '',
      snapshotId: snapshotId ?? '',
      workId: id,
      fields: {
        ...(update.notes === undefined ? {} : { notes: update.notes }),
        ...(update.tags === undefined ? {} : { tags: update.tags }),
      },
    };
    // The paper is gone, and with it any text refused for it.
    if (!existing) {
      settle({ ...edit, fields: {} }, true);
      return true;
    }
    const stored =
      (Object.keys(update) as Array<keyof Work>).every((key) =>
        sameValue(existing[key], update[key]),
      ) ||
      updateSnapshot(
        (s) => ({
          ...s,
          works: s.works.map((w) => (w.id === id ? { ...w, ...update } : w)),
        }),
        snapshotId,
      );
    if (Object.keys(edit.fields).length) settle(edit, stored);
    return stored;
  }
  /** Tries the refused text again (room may have been made): what fits now is stored. */
  function retryRefused() {
    for (const edit of refusedRef.current)
      if (edit.workId) updateWork(edit.workId, edit.fields, edit.snapshotId);
  }
  retryRef.current = retryRefused;
  function activate(id: string) {
    const current = workspaceRef.current;
    if (current.activeId !== id) {
      const next = { ...current, activeId: id };
      workspaceRef.current = next;
      setWorkspace(next);
    }
    setView('workspace');
  }
  function removeSnapshots(ids: Set<string>) {
    const current = workspaceRef.current;
    const snapshots = current.snapshots.filter((s) => !ids.has(s.id));
    const next: Workspace = {
      ...current,
      snapshots,
      activeId:
        current.activeId && ids.has(current.activeId)
          ? (snapshots[0]?.id ?? null)
          : current.activeId,
    };
    workspaceRef.current = next;
    setWorkspace(next);
    retryRefused();
  }
  function closeSearchMenu(restoreFocus = false) {
    setSearchMenu(null);
    if (restoreFocus) searchMenuTrigger.current?.focus();
  }
  function snapshotAction(id: string, action: 'rename' | 'delete', fromContextMenu = false) {
    const snapshot = workspaceRef.current.snapshots.find((s) => s.id === id);
    if (!snapshot) return;
    closeSearchMenu();
    // Focus goes back to the item that opened the menu before the dialog opens, so closing returns there.
    if (fromContextMenu) searchMenuTrigger.current?.focus();
    setSnapshotActionId(id);
    if (action === 'rename') {
      setRename(snapshot.name);
      setRenameError('');
    }
    setDialog(action);
  }
  /** Closing Rename drops a name the workspace refused. */
  function closeRename() {
    if (snapshotActionId)
      settle(
        { key: `name/${snapshotActionId}`, label: '', snapshotId: snapshotActionId, fields: {} },
        true,
      );
    setDialog(null);
  }
  function searchMenuEvents(id: string) {
    const show = (button: HTMLButtonElement, x?: number, y?: number) => {
      button.focus();
      searchMenuTrigger.current = button;
      const bounds = button.getBoundingClientRect();
      setSearchMenu({ id, x: x || bounds.left + 12, y: y || bounds.bottom });
    };
    return {
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
  function changeHeld(change: (list: Held[]) => Held[]) {
    heldRef.current = change(heldRef.current);
    setHeld(heldRef.current);
  }
  /**
   * Adds a snapshot built now, after removing `removed`. If the result does not fit, nothing is
   * removed and the results are held instead of being lost.
   */
  function commitSnapshot(
    build: Build,
    origin: PendingSave['origin'],
    removed = new Set<string>(),
  ) {
    const current = workspaceRef.current;
    const { snapshot, message } = build(current, removed);
    const kept = { ...current, snapshots: current.snapshots.filter((s) => !removed.has(s.id)) };
    try {
      const next = validateWorkspace({
        ...kept,
        snapshots: [snapshot, ...kept.snapshots],
        activeId: snapshot.id,
      });
      workspaceRef.current = next;
      setWorkspace(next);
      changeHeld((list) => list.filter((h) => h.snapshot.id !== snapshot.id));
      setView('workspace');
      toast(message);
      return true;
    } catch (e) {
      const entry: Held = {
        snapshot,
        message,
        origin,
        build,
        // Nothing was removed: the reason describes the workspace as it still is.
        reason: describeSaveFailure(e, current, snapshot),
      };
      // Only a newer build of the same results replaces held results.
      changeHeld((list) =>
        list.some((h) => h.snapshot.id === snapshot.id)
          ? list.map((h) => (h.snapshot.id === snapshot.id ? entry : h))
          : [...list, entry],
      );
      return false;
    }
  }
  async function search(query: SearchQuery, previous?: Snapshot) {
    if (busy || loadFailed || !ready) return;
    setDialog(null);
    setBusy(true);
    setError('');
    const isScholar = query.sources.includes('scholar');
    scholarCanceled.current = false;
    setScholarBusy(false);
    setScholarProgress(null);
    setBusyText(
      isScholar
        ? 'Searching Google Scholar…'
        : `Searching ${query.sources.map(sourceName).join(', ')}…`,
    );
    const unsubscribe = isScholar ? client.onScholarProgress(setScholarProgress) : undefined;
    try {
      const response = await searchSelectedSources(
        query,
        client,
        (phase) => {
          setScholarBusy(phase === 'scholar' && Boolean(window.desktop));
          setBusyText(
            phase === 'scholar'
              ? 'Searching Google Scholar…'
              : `Searching ${query.sources
                  .filter((source) => source !== 'scholar')
                  .map(sourceName)
                  .join(', ')}…`,
          );
        },
        !window.desktop,
      );
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
      // Edits still waiting in an open panel belong to the snapshot being refreshed.
      flushPending();
      const fresh = mergeWorks(response.results.flatMap((r) => r.works));
      const id = crypto.randomUUID();
      const { searchedAt } = response;
      const sourceResults = response.results.map(({ works: _works, ...r }) => r);
      // Built when it is saved, so a refresh held for later carries the curation of that moment.
      const build: Build = (current, removed) => {
        const latestPrevious = previous
          ? current.snapshots.find((s) => s.id === previous.id)
          : undefined;
        const works = latestPrevious ? carryForwardCuration(fresh, latestPrevious.works) : fresh;
        const priorMetrics = latestPrevious ? calculateMetrics(latestPrevious.works) : null;
        const snapshot: Snapshot = {
          id,
          name: latestPrevious?.name ?? query.text,
          query,
          works,
          searchedAt,
          sourceResults,
          // Reviews and annual counts follow each paper to the fresh record that replaces it.
          ...(latestPrevious?.insights
            ? { insights: carryInsights(latestPrevious.insights, latestPrevious.works, works) }
            : {}),
          ...(latestPrevious && priorMetrics
            ? {
                previous: {
                  searchedAt: latestPrevious.searchedAt,
                  papers: priorMetrics.papers,
                  citations: priorMetrics.citations,
                },
              }
            : {}),
        };
        const message = `${countText(works.length, 'publication', 'publications')} saved${
          !previous
            ? '.'
            : !latestPrevious
              ? '. The snapshot you were refreshing was deleted meanwhile, so nothing was carried forward.'
              : removed.has(latestPrevious.id)
                ? '. The earlier snapshot was removed to make room.'
                : '. Earlier snapshot kept in your library.'
        }`;
        return { snapshot, message };
      };
      commitSnapshot(build, previous ? 'refresh' : 'search');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Search failed. Please try again.';
      // A dialog opened meanwhile (Settings with a typed key, …) is not replaced.
      if (previous || dialogRef.current) setError(message);
      else {
        // Back to the dialog with the same query, so nothing has to be typed again.
        setSearchInitial(query);
        setSearchFailure(message);
        setSearchWarning(capacityWarning(workspaceRef.current) ?? '');
        setDialog('search');
      }
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
          let next: Workspace;
          try {
            next = validateWorkspace({
              ...current,
              snapshots: [...snapshots, ...current.snapshots],
              activeId: snapshots[activeIndex >= 0 ? activeIndex : 0]?.id ?? current.activeId,
            });
          } catch (e) {
            throw new Error(describeSaveFailure(e, current, snapshots));
          }
          workspaceRef.current = next;
          setWorkspace(next);
          setLoadFailed(false);
          setError('');
          setView('library');
          toast(`Restored ${snapshots.length} search snapshots alongside your existing workspace.`);
          return;
        }
      }
      const report = importWorksWithReport(file.content, file.name);
      const works = mergeWorks(report.works);
      if (!works.length) throw new Error('No publications were found in this file.');
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        query: { text: file.name, mode: 'topic', sources: [], limit: works.length },
        works,
        searchedAt: new Date().toISOString(),
        sourceResults: [],
      };
      const summary = importSummary({
        kept: works.length,
        merged: report.works.length - works.length,
        ignoredColumns: report.ignoredColumns,
        warnings: report.warnings,
      });
      if (commitSnapshot(() => ({ snapshot, message: summary }), 'import')) {
        setLoadFailed(false);
        setError('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This file could not be imported.');
    }
  }
  async function backup() {
    if (loadFailed) {
      setError(
        'A backup is not possible while the saved workspace is unreadable; it would not contain your searches. The unreadable files have been preserved.',
      );
      return;
    }
    try {
      flushPending();
      if (
        await client.exportFile({
          name: backupFileName(),
          content: JSON.stringify(workspaceRef.current),
        })
      )
        toast('Workspace backup exported.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    }
  }
  async function exportHeld(entry: Held) {
    try {
      if (
        await client.exportFile({
          name: exportFileName(entry.snapshot.name, 'json'),
          // The records of exportWorks(…, 'json'), written compactly: held results can be large, and
          // pretty printing could push them past the 25 MB export limit.
          content: JSON.stringify(
            entry.snapshot.works.map((work) => ({ ...work, citations: citationsForSource(work) })),
          ),
        })
      )
        toast('Results exported. They stay here until you save or discard them.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  }
  /** Saves held results; the snapshots in `removed` go only if the results then fit. */
  function retryHeld(entry: Held, removed: string[] = []) {
    return commitSnapshot(entry.build, entry.origin, new Set(removed));
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
      const name = exportFileName(active.name, extension);
      if (await client.exportFile({ name, content: exportWorks(works, exportFormat) })) {
        setDialog(null);
        toast(`Exported ${countText(works.length, 'publication', 'publications')}.`);
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
  const sortState = (column: typeof sort) =>
    sort === column ? (descending ? ('descending' as const) : ('ascending' as const)) : undefined;
  function closeDetails() {
    const id = selectedId;
    setSelectedId(null);
    // The panel is about to disappear: put focus back on the row it was opened from.
    if (id) rowButtons.current.get(id)?.focus();
  }
  const issues = active?.sourceResults.filter((r) => r.error || r.warning) ?? [];
  const includedCount = active?.works.filter((w) => w.included).length ?? 0;
  // Combined counts, like the ones stored when the earlier snapshot was replaced.
  const combinedCitations = useMemo(
    () => (active?.previous ? calculateMetrics(active.works).citations : 0),
    [active],
  );
  const includedChange = active?.previous ? includedCount - active.previous.papers : 0;
  const citationChange = active?.previous ? combinedCitations - active.previous.citations : 0;
  // The earlier snapshot may have been removed to make room (it is known only by its date).
  const earlierKept = workspace.snapshots.some(
    (s) => s !== active && s.searchedAt === active?.previous?.searchedAt,
  );
  const countExport =
    exportScope === 'visible'
      ? filtered.length
      : exportScope === 'included'
        ? includedCount
        : (active?.works.length ?? 0);
  const startImport = () => withCapacityCheck(() => void importFile());

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
          <span className="shortcut">{IS_MAC ? '⌘ K' : 'Ctrl K'}</span>
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
              aria-current={view === id ? 'page' : undefined}
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
                aria-current={
                  workspace.activeId === s.id && view === 'workspace' ? 'true' : undefined
                }
                onClick={() => activate(s.id)}
                {...searchMenuEvents(s.id)}
              >
                <span className="search-bullet" />
                <span>
                  <strong>{s.name}</strong>
                  <small>{countText(s.works.length, 'paper', 'papers')}</small>
                  <small>{formatDateTime(s.searchedAt)}</small>
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
            aria-current={view === 'sources' ? 'page' : undefined}
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
                : unsaved || refused.length
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
            Workspace<span aria-hidden="true">/</span>
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
            <button className="button secondary compact" onClick={startImport}>
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
        <main className="main-content" tabIndex={-1} data-focus-fallback>
          {error && (
            <Banner
              title="Something needs attention"
              onDismiss={() => setError('')}
              dismissLabel="Dismiss error"
            >
              {error.split('\n').map((line) => (
                <p key={line}>{line}</p>
              ))}
              {loadFailed && (
                <button className="text-button" onClick={() => location.reload()}>
                  Try loading again
                </button>
              )}
            </Banner>
          )}
          {saveError && (
            <Banner
              title="Changes are not saved"
              onDismiss={() => setSaveError('')}
              dismissLabel="Dismiss save error"
            >
              <p>{saveError}</p>
            </Banner>
          )}
          {recoveryNotice && (
            <Banner
              title="Restored from backup"
              tone="notice"
              onDismiss={() => setRecoveryNotice('')}
              dismissLabel="Dismiss notice"
            >
              <p>{recoveryNotice}</p>
            </Banner>
          )}
          {held.map((entry) => (
            <PendingResults
              key={entry.snapshot.id}
              pending={entry}
              snapshots={workspace.snapshots}
              refreshSources={held.flatMap((h) =>
                h !== entry && h.snapshot.previous ? [h.snapshot.previous.searchedAt] : [],
              )}
              dialog={
                heldTarget !== entry.snapshot.id
                  ? null
                  : dialog === 'held-remove'
                    ? 'remove'
                    : dialog === 'held-discard'
                      ? 'discard'
                      : null
              }
              onDialog={(mode) => {
                setHeldTarget(entry.snapshot.id);
                setDialog(mode && `held-${mode}`);
              }}
              onRetry={() => {
                // Saved: the banner goes with the focused button, so focus moves to the page.
                if (retryHeld(entry))
                  document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus();
              }}
              onExport={() => void exportHeld(entry)}
              onRemove={(ids) => retryHeld(entry, ids)}
              onBackup={() => void backup()}
              onDiscard={() =>
                changeHeld((list) => list.filter((h) => h.snapshot.id !== entry.snapshot.id))
              }
            />
          ))}
          <div role="status">
            {busy && (
              <div className="search-progress">
                <LoaderCircle size={20} className="spin" />
                <div>
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
                    <button
                      className="button secondary"
                      onClick={() => void controlScholar('stop')}
                    >
                      Stop and keep results
                    </button>
                    <button className="text-button" onClick={() => void controlScholar('cancel')}>
                      Cancel search
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
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
                    const m = snapshotMetrics(s.works);
                    return (
                      <button
                        className="library-card"
                        onClick={() => activate(s.id)}
                        key={s.id}
                        {...searchMenuEvents(s.id)}
                      >
                        <span className="library-card-top">
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
                        </span>
                        <span className="library-card-title">{s.name}</span>
                        <span className="library-card-sources">
                          {s.query.sources.map(sourceName).join(' · ') || 'Imported publications'}
                        </span>
                        <span className="library-stats">
                          <span>
                            <strong>{formatNumber(m.papers)}</strong>papers
                          </span>
                          <span>
                            <strong>{formatNumber(m.citations)}</strong>citations
                          </span>
                          <span>
                            <strong>{m.hIndex}</strong>h-index
                          </span>
                        </span>
                        <span className="library-footer">
                          <span>{formatDateTime(s.searchedAt)}</span>
                          <ArrowRight size={17} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState onSearch={openSearch} onImport={startImport} />
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
              <EmptyState onSearch={openSearch} onImport={startImport} />
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
                    <span className="separator" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      {active.query.sources.map(sourceName).join(' + ') || 'Imported publications'}
                    </span>
                    {active.query.yearFrom || active.query.yearTo ? (
                      <>
                        <span className="separator" aria-hidden="true">
                          ·
                        </span>
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
                    onClick={() => withCapacityCheck(() => void search(active.query, active))}
                    disabled={busy || !active.query.sources.length}
                    title={
                      active.query.sources.length
                        ? undefined
                        : 'Imported publications have no search to repeat, so they cannot be refreshed.'
                    }
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                  <ActionMenu label="Search actions">
                    {(close) => (
                      <>
                        <button
                          onClick={() => {
                            close();
                            snapshotAction(active.id, 'rename');
                          }}
                        >
                          Rename search
                        </button>
                        <button
                          onClick={() => {
                            close();
                            openSearch(active.query);
                          }}
                          disabled={busy || !active.query.sources.length}
                          title={
                            active.query.sources.length
                              ? undefined
                              : 'Imported publications have no search to edit.'
                          }
                        >
                          Edit & run new search
                        </button>
                        <button
                          onClick={() => {
                            close();
                            void backup();
                          }}
                        >
                          Back up workspace
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => {
                            close();
                            snapshotAction(active.id, 'delete');
                          }}
                        >
                          Delete this snapshot
                        </button>
                      </>
                    )}
                  </ActionMenu>
                </div>
              </div>
              {active.previous && (
                <div className="refresh-note">
                  <RefreshCw size={14} />
                  New snapshot compared with {formatDate(active.previous.searchedAt)}:{' '}
                  {signed(includedChange)} included{' '}
                  {Math.abs(includedChange) === 1 ? 'paper' : 'papers'}, {signed(citationChange)}{' '}
                  {Math.abs(citationChange) === 1 ? 'citation' : 'citations'}.{' '}
                  {earlierKept
                    ? 'Earlier snapshot retained in your library.'
                    : 'The earlier snapshot is no longer in your library.'}
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
                excluded={active.works.filter((w) => !w.included).length}
                onHelp={() => setDialog('help')}
              />
              {view === 'insights' ? (
                <>
                  <Charts metrics={metrics} annual={insights?.annual} expanded />
                  {/* Without a single citation count these are unknown, not zero. */}
                  <div className="secondary-metrics">
                    <div>
                      <span>i10-index</span>
                      <strong>{metrics.citationCoverage ? metrics.i10Index : '—'}</strong>
                      <small>Papers with at least 10 citations</small>
                    </div>
                    <div>
                      <span>Average citations</span>
                      <strong>
                        {metrics.citationCoverage ? formatNumber(metrics.citationsPerPaper) : '—'}
                      </strong>
                      <small>Per included paper with counts</small>
                    </div>
                    <div>
                      <span>Citations per year</span>
                      <strong>
                        {metrics.citationCoverage ? formatNumber(metrics.citationsPerYear) : '—'}
                      </strong>
                      <small>Since first included publication</small>
                    </div>
                  </div>
                  {insights && insightsSettings && (
                    <LocalInsights
                      key={active.id}
                      analysis={insights}
                      settings={insightsSettings}
                      works={active.works}
                      source={metricSource}
                      // True when the change was stored; the panel shows "Saved" only then.
                      onChange={(settings) =>
                        updateSnapshot((s) => ({ ...s, insights: settings }), active.id)
                      }
                      snapshot={active}
                    />
                  )}
                  <div className="information-card">
                    <CircleHelp size={23} />
                    <div>
                      <h3>Context belongs beside the numbers.</h3>
                      <p>
                        These metrics describe the retrieved, included papers. Result limits, author
                        ambiguity, missing citation counts, and each database’s coverage affect
                        them. Combined counts are maxima across sources, not a union of unique
                        citing papers. The annual citation view uses imported calendar-year counts;
                        lifetime citation totals are shown separately by publication year. The
                        publication-year range applies to all Insights metrics and charts.
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
                          </select>
                        </label>
                      </div>
                      <div className="table-scroll" ref={tableScroll}>
                        <table className="publication-table">
                          <thead>
                            <tr>
                              <th className="check-cell">
                                <label className="check-hit">
                                  <input
                                    type="checkbox"
                                    aria-label="Include all filtered publications"
                                    checked={
                                      filtered.length > 0 && filtered.every((w) => w.included)
                                    }
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
                                </label>
                              </th>
                              <th aria-sort={sortState('title')}>
                                <button onClick={() => setSortColumn('title')}>
                                  Publication
                                  {sort === 'title' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                              <th className="year-cell" aria-sort={sortState('year')}>
                                <button onClick={() => setSortColumn('year')}>
                                  Year
                                  {sort === 'year' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                              <th className="citations-cell" aria-sort={sortState('citations')}>
                                <button onClick={() => setSortColumn('citations')}>
                                  Citations
                                  {sort === 'citations' ? (
                                    <ArrowDown size={12} className={!descending ? 'rotate' : ''} />
                                  ) : (
                                    <ArrowDownUp size={12} />
                                  )}
                                </button>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((w) => {
                              const count = citationsForSource(w, metricSource);
                              return (
                                <tr
                                  className={`${selectedId === w.id ? 'selected-row' : ''} ${!w.included ? 'excluded-row' : ''}`}
                                  aria-selected={selectedId === w.id}
                                  key={w.id}
                                >
                                  <td className="check-cell">
                                    <label className="check-hit">
                                      <input
                                        type="checkbox"
                                        aria-label={`Include ${w.title}`}
                                        checked={w.included}
                                        onChange={(e) =>
                                          updateWork(w.id, { included: e.target.checked })
                                        }
                                      />
                                    </label>
                                  </td>
                                  <td className="publication-cell">
                                    <button
                                      className="paper-title"
                                      ref={(el) => {
                                        if (el) rowButtons.current.set(w.id, el);
                                        else rowButtons.current.delete(w.id);
                                      }}
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
                          {filtered.length === 1 ? 'publication' : 'publications'}
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
                        refused={
                          refused.find((e) => e.key === `${active.id}/${selected.id}`)?.fields
                        }
                        onClose={closeDetails}
                        onUpdate={(update) => updateWork(selected.id, update, active.id)}
                        onToast={toast}
                        registerFlush={registerFlush}
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
                        ? `Requested up to ${active.query.limit} papers per source, including Scholar. Matching records retain their source counts and retrieved-page addresses. Coverage depends on each source and the pages available; this is not a complete bibliography.`
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
              <span className="footer-version">v{APP_VERSION}</span>
            </span>
          </footer>
        </main>
      </div>
      {createPortal(
        <div role="status">
          {notice && (
            <div className="toast">
              <Check size={17} />
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
      {dialog === 'search' && (
        <SearchDialog
          initial={searchInitial}
          failure={searchFailure}
          warning={searchWarning}
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
          backupUnavailable={
            loadFailed
              ? 'A backup is not possible while the saved workspace is unreadable; it would not contain your searches.'
              : undefined
          }
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
            {countText(countExport, 'publication', 'publications')}. Citation exports use the
            combined count and retain source counts where the format supports them. Use workspace
            backup for full search history.
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
          onRename={() => snapshotAction(menuSnapshot.id, 'rename', true)}
          onDelete={() => snapshotAction(menuSnapshot.id, 'delete', true)}
          onClose={closeSearchMenu}
        />
      )}
      {dialog === 'rename' && actionSnapshot && (
        <Modal
          title="Rename search"
          description={`${formatDateTime(actionSnapshot.searchedAt)} · ${countText(actionSnapshot.works.length, 'publication', 'publications')}`}
          onClose={closeRename}
          dirty={rename !== actionSnapshot.name}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!rename.trim()) {
                setRenameError('Enter a name for this search.');
                return;
              }
              const edit: RefusedEdit = {
                key: `name/${actionSnapshot.id}`,
                label: rename.trim(),
                snapshotId: actionSnapshot.id,
                fields: {},
              };
              const stored = updateSnapshot(
                (s) => ({ ...s, name: rename.trim() }),
                actionSnapshot.id,
              );
              // A refused name stays in the dialog, counted as unsaved until it is saved or dropped.
              settle(edit, stored);
              if (stored) setDialog(null);
              else setRenameError(refusal.current);
            }}
          >
            <label className="field">
              Search name
              <input
                autoFocus
                maxLength={200}
                value={rename}
                onChange={(e) => {
                  setRename(e.target.value);
                  setRenameError('');
                }}
              />
            </label>
            {renameError && (
              <p className="inline-error" role="alert">
                {renameError}
              </p>
            )}
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={closeRename}>
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
          description={`“${actionSnapshot.name}” (${formatDateTime(actionSnapshot.searchedAt)}, ${countText(actionSnapshot.works.length, 'publication', 'publications')}) and its notes will be removed from this workspace. Other snapshots will remain.`}
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
                removeSnapshots(new Set([actionSnapshot.id]));
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
      {dialog === 'capacity' && capacityGate && (
        <Modal
          title="Your workspace is almost full"
          description={capacityGate.message}
          onClose={() => setDialog(null)}
        >
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                const { proceed } = capacityGate;
                setDialog(null);
                setCapacityGate(null);
                proceed();
              }}
            >
              Continue anyway
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
                current year. Per-paper rates use its publication year. Timeline choices distinguish
                publication output, lifetime citations by publication year, and citations actually
                received per calendar year. Annual history comes from saved source data or local
                imports; missing years are unknown. OpenAlex history may cover only recent years.
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
              Version {APP_VERSION} · Sources and metric definitions are documented in the
              open-source project.
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
          <span className="start-title">Find an author’s work</span>
          <span className="start-copy">
            Explore a research career and review its citation impact.
          </span>
          <span className="start-link">
            Search an author
            <ArrowRight size={15} />
          </span>
        </button>
        <button onClick={() => onSearch({ mode: 'topic' })}>
          <span className="start-icon">
            <BookOpen size={23} />
          </span>
          <span className="start-title">Explore a research topic</span>
          <span className="start-copy">
            Search across disciplines and bring the literature together.
          </span>
          <span className="start-link">
            Explore a topic
            <ArrowRight size={15} />
          </span>
        </button>
        <button onClick={onImport}>
          <span className="start-icon">
            <FileUp size={23} />
          </span>
          <span className="start-title">Bring your publications</span>
          <span className="start-copy">
            Import CSV, BibTeX, RIS, or JSON from your existing workflow.
          </span>
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

import type { Snapshot, Work, Workspace } from './types';
import { foldText } from './core/names';
import { LIMITS, clampText } from './core/limits';
import { calculateMetrics } from './core/metrics';
import { MAX_WORKSPACE_BYTES, validateWorkspace, workspaceBytes } from './core/workspace';
import { formatNumber, localDateStamp } from './catalog';

/** Choices offered for "Results per source". */
export const RESULT_LIMITS = [25, 50, 100, 200] as const;

/** The option closest to `limit` (ties go up); imports and old searches may hold any number. */
export function nearestLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return RESULT_LIMITS.reduce((best, option) =>
    Math.abs(option - limit) <= Math.abs(best - limit) ? option : best,
  );
}

const haystacks = new WeakMap<Work, string>();
function haystack(work: Work): string {
  let text = haystacks.get(work);
  if (text === undefined) {
    text = foldText(
      [
        work.title,
        work.authors.join(' '),
        work.venue,
        work.doi,
        work.tags.join(' '),
        work.notes,
        work.year ?? '',
      ].join(' '),
    );
    haystacks.set(work, text);
  }
  return text;
}
/** The whitespace-separated words of a filter, accent- and case-folded without locale rules. */
export const filterTokens = (text: string): string[] => foldText(text).split(' ').filter(Boolean);
/** True when every word appears somewhere in the record's title, authors, venue, DOI, tags, notes or year. */
export const matchesFilter = (work: Work, tokens: string[]): boolean =>
  tokens.every((token) => haystack(work).includes(token));

const summaries = new WeakMap<Work[], ReturnType<typeof calculateMetrics>>();
/**
 * The metrics of a saved search for the library view, computed once per version of its
 * publications: 500 searches of 200 papers take a quarter of a second or more to recompute.
 */
export function snapshotMetrics(works: Work[]): ReturnType<typeof calculateMetrics> {
  let metrics = summaries.get(works);
  if (!metrics) {
    metrics = calculateMetrics(works);
    summaries.set(works, metrics);
  }
  return metrics;
}

/** A workspace above this share of any limit gets a warning before more data is added. */
export const NEARLY_FULL = 0.9;
export interface WorkspaceUsage {
  fraction: number;
  fullest: 'storage' | 'snapshots' | 'publications';
  message: string;
}
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
const usages = new WeakMap<Workspace, WorkspaceUsage>();
/** How close the workspace is to the size, saved-search and publication limits. */
export function workspaceUsage(workspace: Workspace): WorkspaceUsage {
  let usage = usages.get(workspace);
  if (usage) return usage;
  const publications = workspace.snapshots.reduce((sum, s) => sum + s.works.length, 0);
  const bytes = workspaceBytes(workspace);
  const measures = [
    {
      fullest: 'storage' as const,
      fraction: bytes / MAX_WORKSPACE_BYTES,
      detail: `${megabytes(bytes)} of ${megabytes(MAX_WORKSPACE_BYTES)} MB`,
    },
    {
      fullest: 'snapshots' as const,
      fraction: workspace.snapshots.length / LIMITS.snapshots,
      detail: `${workspace.snapshots.length} of ${LIMITS.snapshots} saved searches`,
    },
    {
      fullest: 'publications' as const,
      fraction: publications / LIMITS.totalWorks,
      detail: `${formatNumber(publications)} of ${formatNumber(LIMITS.totalWorks)} publications`,
    },
  ].reduce((best, measure) => (measure.fraction > best.fraction ? measure : best));
  usage = {
    fraction: measures.fraction,
    fullest: measures.fullest,
    message: `Your workspace is ${Math.round(measures.fraction * 100)}% full (${measures.detail}).`,
  };
  usages.set(workspace, usage);
  return usage;
}

/** Megabytes rounded up to a tenth, so "at least" never understates the room needed. */
const megabytesUp = (bytes: number) => (Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toFixed(1);
/**
 * Turns a failed save into every actual reason: the size, snapshot and publication limits (with the
 * room still needed) and a record that can never be saved. `workspace` is what the results join.
 */
export function describeSaveFailure(
  error: unknown,
  workspace: Workspace,
  added: Snapshot | Snapshot[],
): string {
  const snapshots = Array.isArray(added) ? added : [added];
  const message = error instanceof Error ? error.message : '';
  const reasons: string[] = [];
  const count = workspace.snapshots.length + snapshots.length;
  if (count > LIMITS.snapshots)
    reasons.push(
      `The workspace would hold ${formatNumber(count)} saved searches, more than the maximum of ${LIMITS.snapshots} saved searches. Remove at least ${countText(count - LIMITS.snapshots, 'older snapshot', 'older snapshots')} to make room.`,
    );
  for (const snapshot of snapshots)
    if (snapshot.works.length > LIMITS.works)
      reasons.push(
        // An imported file has no sources to search again.
        snapshot.query.sources.length
          ? `One saved search can hold at most ${formatNumber(LIMITS.works)} publications, and these results contain ${formatNumber(snapshot.works.length)}. Choose a smaller result limit or a narrower search.`
          : `One saved search can hold at most ${formatNumber(LIMITS.works)} publications, and this file contains ${formatNumber(snapshot.works.length)}. Split the file and import each part.`,
      );
  const publications = [...workspace.snapshots, ...snapshots].reduce(
    (sum, s) => sum + s.works.length,
    0,
  );
  if (publications > LIMITS.totalWorks)
    reasons.push(
      `Saving these results would bring the workspace to ${formatNumber(publications)} publications; the limit is ${formatNumber(LIMITS.totalWorks)}. Remove older snapshots holding at least ${countText(publications - LIMITS.totalWorks, 'publication', 'publications')} to make room.`,
    );
  const before = workspaceBytes(workspace);
  const after = workspaceBytes({ ...workspace, snapshots: [...snapshots, ...workspace.snapshots] });
  if (after > MAX_WORKSPACE_BYTES || /\b25 MB\b/.test(message))
    reasons.push(
      `The workspace would exceed its 25 MB limit: it uses ${megabytes(before)} MB now and these results add about ${megabytes(after - before)} MB. ${after > MAX_WORKSPACE_BYTES ? `Remove older snapshots holding at least ${megabytesUp(after - MAX_WORKSPACE_BYTES)} MB` : 'Remove older snapshots'} to make room.`,
    );
  // A record the validator rejects on its own cannot be saved whatever is removed.
  for (const snapshot of snapshots) {
    try {
      validateWorkspace({ version: 2, snapshots: [snapshot], activeId: null });
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      if (text && !/\b25 MB\b|^Invalid or oversized workspace list\.$/.test(text))
        reasons.push(text);
    }
  }
  return reasons.join(' ') || message || 'The workspace could not accept these results.';
}

/**
 * Typed tags ("a, b") added to a paper's tags: `next` is the list to save (null: nothing new),
 * `left` what the limit leaves out (it stays in the field) and `message` says why a tag was not
 * added. A tag the list repeats (imports can repeat a keyword) is kept once.
 */
export function addTypedTags(
  tags: string[],
  text: string,
): { next: string[] | null; left: string; message: string } {
  const current = [...new Set(tags)];
  const typed = [
    ...new Set(
      text
        .split(',')
        .map((tag) => tag.trim().slice(0, LIMITS.tag))
        .filter(Boolean),
    ),
  ];
  const fresh = typed.filter((tag) => !current.includes(tag));
  const room = Math.max(0, LIMITS.tags - current.length);
  const repeated = typed.filter((tag) => current.includes(tag)).map((tag) => `“${tag}”`);
  return {
    next: fresh.length && room ? [...current, ...fresh.slice(0, room)] : null,
    left: fresh.slice(room).join(', '),
    message:
      fresh.length > room
        ? `A paper can have at most ${LIMITS.tags} tags. Remove one to add another.`
        : repeated.length
          ? `${repeated.join(', ')} ${repeated.length === 1 ? 'is already a tag' : 'are already tags'}.`
          : '',
  };
}

/** "1 publication", "2 publications". */
export const countText = (n: number, one: string, many: string) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * What the desktop shell names before it closes while work exists only in memory; null when nothing
 * does. `edits` names the edits the workspace refused (a paper's title, a new search name).
 */
export function unsavedWork(
  held: string[],
  saveFailed: boolean,
  edits: string[] = [],
): string | null {
  // The shell accepts at most 500 characters, so long lists are shortened.
  const names = (list: string[]) =>
    `${list
      .slice(0, 3)
      .map((name) => `“${clampText(name, 50)}”`)
      .join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}.`;
  const parts: string[] = [];
  if (held.length) parts.push(`Search results that could not be saved: ${names(held)}`);
  if (edits.length) parts.push(`Edits that could not be saved: ${names(edits)}`);
  if (saveFailed) parts.push('Changes that could not be saved.');
  return parts.length ? parts.join(' ') : null;
}

/** Typed text the workspace refused (it would not fit): kept in memory until it is stored or dropped. */
export interface RefusedEdit {
  /** `snapshotId/workId` for a paper's notes and tags, `name/snapshotId` for a new search name. */
  key: string;
  /** What the person knows it by: the paper's title or the new name. */
  label: string;
  snapshotId: string;
  workId?: string;
  /** The paper's refused notes and tags, tried again until stored (none for a name). */
  fields: Partial<Pick<Work, 'notes' | 'tags'>>;
}
/**
 * The refused edits once `edit` was tried: a refused one is kept, merged with an earlier one for the
 * same key; a stored one clears the fields it covered, or the whole entry when it has no fields.
 */
export function settleEdit(
  refused: RefusedEdit[],
  edit: RefusedEdit,
  stored: boolean,
): RefusedEdit[] {
  const earlier = refused.find((e) => e.key === edit.key);
  if (!stored) {
    const merged = { ...edit, fields: { ...earlier?.fields, ...edit.fields } };
    return earlier ? refused.map((e) => (e === earlier ? merged : e)) : [...refused, merged];
  }
  if (!earlier) return refused;
  const fields = { ...earlier.fields };
  for (const field of Object.keys(edit.fields) as Array<keyof typeof fields>) delete fields[field];
  return Object.keys(edit.fields).length && Object.keys(fields).length
    ? refused.map((e) => (e === earlier ? { ...e, fields } : e))
    : refused.filter((e) => e !== earlier);
}
/** The toast after an import: how many publications, how many duplicates were merged, what was skipped. */
export function importSummary(info: {
  kept: number;
  merged: number;
  ignoredColumns: string[];
  warnings: string[];
}): string {
  let text = `Imported ${countText(info.kept, 'publication', 'publications')}`;
  if (info.merged > 0)
    text += ` (${countText(info.merged, 'duplicate merged', 'duplicates merged')})`;
  text += '.';
  if (info.ignoredColumns.length) text += ` Ignored columns: ${info.ignoredColumns.join(', ')}.`;
  for (const warning of info.warnings) text += ` ${warning}`;
  return text;
}

/** File name for an export: the snapshot name reduced to letters, digits, "_" and "-". */
export const exportFileName = (name: string, extension: string) =>
  `${name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'publications'}.${extension}`;

export const backupFileName = (date = new Date()) =>
  `academic-publication-tracker-${localDateStamp(date)}.json`;

/** A warning (or null) for starting a search, refresh or import while the workspace is nearly full. */
export function capacityWarning(workspace: Workspace): string | null {
  const usage = workspaceUsage(workspace);
  return usage.fraction > NEARLY_FULL
    ? `${usage.message} A large result set may not fit. Back up your workspace and remove saved searches you no longer need first; results that cannot be saved are held so you can export them.`
    : null;
}

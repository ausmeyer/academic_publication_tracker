import type { InsightsSettings, Snapshot, SourceId, Work } from '../types';
import { mergeWorks, normalizeDoi, providerKey, titleKey } from './merge';
import { csvCell, parseCsvTable } from './formats';
import { venueKey } from './metrics';

export const roles = ['sole', 'first', 'second', 'middle', 'last', 'corresponding'] as const;
export const sourceIds: SourceId[] = [
  'openalex',
  'crossref',
  'europepmc',
  'pubmed',
  'semantic',
  'arxiv',
  'scholar',
  'preprints',
  'datacite',
];
export type Dataset = 'authors' | 'annual' | 'rankings' | 'retractions';
/** Sizes of the saved lists (validated on every save) and of an import file. */
export const INSIGHTS_LIMITS = {
  aliases: 100,
  annotations: 20000,
  annualCitations: 100000,
  journalRanks: 20000,
  retractions: 20000,
  importRows: 100000,
} as const;
export const paperKey = (work: Work) => normalizeDoi(work.doi) || work.id;
export { venueKey };
/** "…", "..." and "et al" mark an author list that was cut short. */
export const hasTruncationMarker = (authors: string[]) =>
  authors.some((a) => /\.{3}|…|\bet al\b/i.test(a));
export function authorListComplete(work: Work): boolean {
  if (!work.authors.length || hasTruncationMarker(work.authors)) return false;
  // Legacy Scholar records lost truncation markers: require an explicit confirmation.
  return work.authorsComplete ?? !work.provenance.some((p) => p.source === 'scholar');
}
export function defaultInsights(snapshot: Snapshot): InsightsSettings {
  return (
    snapshot.insights ?? {
      author: snapshot.query.mode === 'author' ? snapshot.query.text : '',
      aliases: [],
      lensConvention: false,
      annotations: [],
      annualCitations: [],
      journalRanks: [],
      retractions: [],
    }
  );
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a data record.');
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 2000): string => {
  if (typeof v !== 'string' || v.length > max)
    throw new Error('Invalid or oversized text in Insights data.');
  return v.trim();
};
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new Error('Invalid number in Insights data.');
  return v;
};
const flag = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new Error('Expected true or false in Insights data.');
  return v;
};
const thousands = (n: number) => n.toLocaleString('en-US');
const list = (v: unknown, max = 20000, label = 'Insights lists'): unknown[] => {
  if (!Array.isArray(v)) throw new Error('Invalid or oversized Insights list.');
  if (v.length > max)
    throw new Error(
      `${label} are limited to ${thousands(max)} records (found ${thousands(v.length)}).`,
    );
  return v;
};
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length)
    throw new Error('Duplicate records in Insights data.');
  return values;
}
/**
 * Checks saved Insights settings. Lists and flags an earlier version did not save default to
 * empty/false so one older snapshot cannot block loading the workspace; anything present but
 * invalid is still rejected.
 */
export function validateInsights(value: unknown): InsightsSettings {
  const v = record(value);
  const result: InsightsSettings = {
    author: text(v.author ?? '', 1000),
    aliases: list(v.aliases ?? [], INSIGHTS_LIMITS.aliases, 'Name variants').map((a) =>
      text(a, 1000),
    ),
    lensConvention: flag(v.lensConvention ?? false),
    ...(v.yearFrom == null ? {} : { yearFrom: integer(v.yearFrom, 1000, 3000) }),
    ...(v.yearTo == null ? {} : { yearTo: integer(v.yearTo, 1000, 3000) }),
    annotations: unique(
      list(v.annotations ?? [], INSIGHTS_LIMITS.annotations, 'Author reviews').map((raw) => {
        const r = record(raw);
        if (r.role != null && !roles.includes(r.role as (typeof roles)[number]))
          throw new Error('Unknown author role.');
        return {
          key: text(r.key),
          authors: list(r.authors ?? [], 10000, 'Author lists').map((a) => text(a, 1000)),
          complete: flag(r.complete ?? false),
          ...(r.role == null ? {} : { role: r.role as (typeof roles)[number] }),
        };
      }),
      (r) => r.key,
    ),
    annualCitations: unique(
      list(v.annualCitations ?? [], INSIGHTS_LIMITS.annualCitations, 'Annual citation counts').map(
        (raw) => {
          const r = record(raw);
          if (!sourceIds.includes(r.source as SourceId))
            throw new Error('Unknown annual citation source.');
          return {
            key: text(r.key),
            year: integer(r.year, 1000, 3000),
            citations: integer(r.citations),
            source: r.source as SourceId,
          };
        },
      ),
      (r) => JSON.stringify([r.key, r.year, r.source]),
    ),
    journalRanks: unique(
      list(v.journalRanks ?? [], INSIGHTS_LIMITS.journalRanks, 'Journal rankings').map((raw) => {
        const r = record(raw);
        if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(String(r.quartile)))
          throw new Error('Quartile must be Q1, Q2, Q3 or Q4.');
        return {
          venue: text(r.venue),
          year: integer(r.year, 1000, 3000),
          category: text(r.category),
          quartile: r.quartile as 'Q1' | 'Q2' | 'Q3' | 'Q4',
          source: text(r.source),
        };
      }),
      (r) => JSON.stringify([venueKey(r.venue), r.year, r.category, r.source]),
    ),
    retractions: unique(
      list(v.retractions ?? [], INSIGHTS_LIMITS.retractions, 'Retraction notices').map((raw) => {
        const r = record(raw);
        const doi = normalizeDoi(text(r.doi));
        if (!doi) throw new Error('Retraction records require a valid original-paper DOI.');
        return {
          doi,
          status: text(r.status),
          reason: text(r.reason, 10000),
          date: text(r.date, 100),
          source: text(r.source),
        };
      }),
      (r) => JSON.stringify([r.doi, r.status, r.date, r.source]),
    ),
  };
  if (
    result.yearFrom !== undefined &&
    result.yearTo !== undefined &&
    result.yearFrom > result.yearTo
  )
    throw new Error('Start year must not exceed end year.');
  return result;
}

/** Rows moved to their new key, except where another row has or takes the same identity. */
function moveRows<T extends { key: string }>(
  rows: T[],
  keys: Map<string, string>,
  identity: (row: T) => string,
): T[] {
  const moved = rows.map((row) => (keys.has(row.key) ? { ...row, key: keys.get(row.key)! } : row));
  const count = new Map<string, number>();
  for (const row of [...rows, ...moved.filter((row, i) => row !== rows[i])])
    count.set(identity(row), (count.get(identity(row)) ?? 0) + 1);
  return moved.map((row, i) => (row !== rows[i] && count.get(identity(row))! > 1 ? rows[i] : row));
}

/**
 * Insights settings for a refreshed snapshot. Author reviews and annual counts are keyed by paper
 * (DOI, else workspace ID), and a refresh can change that key: an arXiv ID loses its version, a
 * record without a DOI gains one by merging. Each previous paper's rows move to the fresh record
 * that is the same paper (same DOI, else a shared provider record, else the same workspace ID, else,
 * as for notes and tags, the same title and year where merging the two makes one publication; never
 * one with a different DOI); rows without exactly one such record stay as they are.
 */
export function carryInsights(
  settings: InsightsSettings,
  previous: Work[],
  fresh: Work[],
): InsightsSettings {
  const index = (key: (work: Work) => string[]) => {
    const map = new Map<string, Work[]>();
    for (const work of fresh)
      for (const k of new Set(key(work).filter(Boolean))) {
        const list = map.get(k) ?? [];
        list.push(work);
        map.set(k, list);
      }
    return map;
  };
  const byDoi = index((w) => [normalizeDoi(w.doi)]);
  const byProvider = index((w) => w.provenance.map(providerKey));
  const byId = index((w) => [w.id]);
  let byTitle: Map<string, Work[]> | undefined;
  const keys = new Map<string, string>();
  const unclear = new Set<string>();
  for (const old of previous) {
    const doi = normalizeDoi(old.doi);
    const compatible = (w: Work) => !doi || !normalizeDoi(w.doi) || normalizeDoi(w.doi) === doi;
    const groups = [
      doi ? (byDoi.get(doi) ?? []) : [],
      [...new Set(old.provenance.flatMap((p) => byProvider.get(providerKey(p)) ?? []))],
      byId.get(old.id) ?? [],
    ].map((group) => group.filter(compatible));
    const group =
      groups.find((candidates) => candidates.length) ??
      (byTitle ??= index((w) => [titleKey(w)]))
        .get(titleKey(old))
        ?.filter((w) => compatible(w) && mergeWorks([old, w]).length === 1);
    const from = paperKey(old);
    const to = group?.length === 1 ? paperKey(group[0]) : from;
    if (keys.has(from) && keys.get(from) !== to) unclear.add(from);
    keys.set(from, to);
  }
  for (const [from, to] of keys) if (from === to || unclear.has(from)) keys.delete(from);
  return {
    ...settings,
    annotations: moveRows(settings.annotations, keys, (r) => r.key),
    annualCitations: moveRows(settings.annualCitations, keys, (r) =>
      JSON.stringify([r.key, r.year, r.source]),
    ),
  };
}

/** The authors in a template cell: a JSON list of names, or names separated by ";". */
function splitAuthors(cell: string): string[] {
  if (cell.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(cell);
      if (Array.isArray(list) && list.every((name) => typeof name === 'string')) return list;
    } catch {
      /* Names separated by ";" below. */
    }
  }
  return cell
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean);
}
/** "A; B; C", or a JSON list when that text would not read back as the same names. */
function authorsCell(authors: string[]): string {
  const text = authors.join('; ');
  const back = splitAuthors(text);
  return back.length === authors.length && back.every((name, i) => name === authors[i])
    ? text
    : JSON.stringify(authors);
}

export interface InsightsImport {
  settings: InsightsSettings;
  /** Records added or changed. */
  count: number;
  /** Rows for papers (or, for rankings, journals) that are not in this snapshot. */
  skipped: number;
  /** Author-review rows identical to what is already in effect. */
  unchanged: number;
  /** Annual rows dated before their paper was published. */
  ignored: number;
  /** Template rows left empty: annual rows without year and count, rankings without any rank. */
  blank: number;
}

/**
 * Imports normalized CSV/TSV/JSON, also recognizing Retraction Watch column names. Annual rows for
 * a year after `currentYear` are rejected.
 */
export function importInsightsData(
  settings: InsightsSettings,
  kind: Dataset,
  content: string,
  works: Work[],
  currentYear = new Date().getFullYear(),
): InsightsImport {
  if (new TextEncoder().encode(content).length > 25 * 1024 * 1024)
    throw new Error('Please use a file smaller than 25 MB.');
  // Only the byte-order mark and final line breaks go: a trailing tab is an empty last cell.
  const body = content.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '');
  const first = body.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const json = body.trimStart().startsWith('[');
  const table = json
    ? undefined
    : parseCsvTable(
        body,
        first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',',
        false,
      );
  const raw = table ? table.records : (JSON.parse(body) as unknown);
  const rows = list(raw, INSIGHTS_LIMITS.importRows, 'Import files').map(record);
  if (!rows.length) throw new Error('No data records found.');
  const keyMap = new Map(
    works.flatMap((w) => [
      [w.id, paperKey(w)],
      [paperKey(w), paperKey(w)],
    ]),
  );
  const papers = new Map(works.map((w) => [paperKey(w), w]));
  const keys = new Set(papers.keys());
  let skipped = 0;
  let unchanged = 0;
  let ignored = 0;
  let blank = 0;
  /** A record's spreadsheet row (the header is row 1, blank rows count), or its place in a JSON array. */
  const place = (i: number) => (table ? table.rows[i] : i + 1);
  const cellError = (i: number, column: string, problem: string) =>
    new Error(`${json ? 'Record' : 'Row'} ${place(i)}, ${column}: ${problem}`);
  const quote = (cell: string) => (cell ? `"${cell}"` : 'an empty cell');
  /** Rejects two records with the same identity, naming both. */
  function distinct<T extends { i: number }>(records: T[], id: (r: T) => string, what: string) {
    const seen = new Map<string, number>();
    for (const r of records) {
      const earlier = seen.get(id(r));
      if (earlier !== undefined)
        throw new Error(
          `${json ? 'Records' : 'Rows'} ${place(earlier)} and ${place(r.i)} ${what}.`,
        );
      seen.set(id(r), r.i);
    }
  }
  /** The first non-empty value among a column's aliases. */
  const get = (r: Record<string, unknown>, ...names: string[]) => {
    for (const name of names) {
      const value = r[name];
      if (value === undefined || value === null) continue;
      const cell = String(value).trim();
      if (cell) return cell;
    }
    return '';
  };
  const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  /** The paper a row refers to: the first identifier column that names a paper in this snapshot. */
  const paper = (r: Record<string, unknown>) => {
    for (const name of ['key', 'doi', 'workid', 'id']) {
      const value = get(r, name);
      const key = value ? keyMap.get(normalizeDoi(value) || value) : undefined;
      if (key) return key;
    }
    return undefined;
  };
  const next = { ...settings };
  if (kind === 'authors') {
    const saved = new Map(settings.annotations.map((r) => [r.key, r]));
    const matched = rows.flatMap((r, i) => {
      const key = paper(r);
      if (!key) {
        skipped++;
        return [];
      }
      const authors = (
        Array.isArray(r.authors) ? r.authors : splitAuthors(get(r, 'authors'))
      ) as string[];
      const complete = get(r, 'complete').toLowerCase();
      if (!['true', 'false'].includes(complete))
        throw cellError(i, 'complete', `${quote(get(r, 'complete'))} is not true or false.`);
      const role = get(r, 'role');
      if (role && !roles.includes(role as (typeof roles)[number]))
        throw cellError(i, 'role', `${quote(role)} is not one of ${roles.join(', ')}.`);
      if (role && !settings.author.trim())
        throw cellError(
          i,
          'role',
          'choose the author to analyze before importing confirmed roles.',
        );
      return [
        {
          i,
          key,
          authors,
          complete: complete === 'true',
          ...(role ? { role: role as (typeof roles)[number] } : {}),
        },
      ];
    });
    distinct(matched, (r) => r.key, 'are for the same paper');
    // A row that repeats what is already in effect (a saved review, or else the record's own
    // authors) is not a change; storing it would only freeze the list against later refreshes.
    const imported = matched
      .map(({ i: _i, ...r }) => r)
      .filter((r) => {
        const current = saved.get(r.key);
        const own = papers.get(r.key);
        const authors = current?.authors ?? own?.authors ?? [];
        const complete = current?.complete ?? (own ? authorListComplete(own) : false);
        const same =
          authors.length === r.authors.length &&
          authors.every((a, i) => a === r.authors[i]) &&
          complete === r.complete &&
          (r.role ?? undefined) === (current?.role ?? undefined);
        if (same) unchanged++;
        return !same;
      });
    const importedKeys = new Set(imported.map((r) => r.key));
    next.annotations = [
      ...settings.annotations.filter((r) => !importedKeys.has(r.key)),
      ...imported,
    ];
  } else if (kind === 'annual') {
    const entries = rows.flatMap((r, i) => {
      const [yearCell, count] = [get(r, 'year'), get(r, 'citations')];
      // A template row left as it was downloaded.
      if (!yearCell && !count) {
        blank++;
        return [];
      }
      const key = paper(r);
      if (!key) {
        skipped++;
        return [];
      }
      const year = num(yearCell);
      if (!(year >= 1000 && year <= 3000))
        throw cellError(i, 'year', `${quote(yearCell)} is not a year.`);
      if (year > currentYear)
        throw cellError(
          i,
          'year',
          `annual citation years cannot be after ${currentYear} (this row has ${year}). Remove or correct it and import again.`,
        );
      const published = papers.get(key)?.year;
      if (typeof published === 'number' && Number.isFinite(published) && year < published) {
        ignored++;
        return [];
      }
      const citations = num(count);
      if (!Number.isSafeInteger(citations))
        throw cellError(i, 'citations', `${quote(count)} is not a whole number of citations.`);
      const source = get(r, 'source').toLowerCase() as SourceId;
      if (!sourceIds.includes(source))
        throw cellError(i, 'source', `${quote(source)} is not one of ${sourceIds.join(', ')}.`);
      return [{ i, key, year, citations, source }];
    });
    const key = (r: InsightsSettings['annualCitations'][number]) =>
      JSON.stringify([r.key, r.year, r.source]);
    distinct(entries, key, 'repeat the same paper, year and source');
    const imported = entries.map(({ i: _i, ...r }) => r);
    const ids = new Set(imported.map(key));
    next.annualCitations = [
      ...settings.annualCitations.filter((r) => !ids.has(key(r))),
      ...imported,
    ];
  } else if (kind === 'rankings') {
    const all = rows.flatMap((r, i) => {
      const entry = {
        i,
        venue: get(r, 'venue', 'journal', 'title'),
        year: get(r, 'year'),
        category: get(r, 'category'),
        quartile: get(r, 'quartile').toUpperCase(),
        source: get(r, 'source'),
      };
      // A template row left as it was downloaded.
      if (!entry.category && !entry.quartile && !entry.source) {
        blank++;
        return [];
      }
      for (const column of ['venue', 'category', 'source'] as const)
        if (!entry[column])
          throw cellError(
            i,
            column,
            'the cell is empty. Rankings need venue, year, category, quartile and source columns.',
          );
      return [entry];
    });
    // Ranking tables cover thousands of journals; only those shown in this snapshot are kept.
    const shown = new Set(works.map((w) => venueKey(w.venue)).filter(Boolean));
    const entries = all
      .filter((r) => shown.has(venueKey(r.venue)))
      .map((r) => {
        const year = num(r.year);
        if (!(year >= 1000 && year <= 3000))
          throw cellError(r.i, 'year', `${quote(r.year)} is not a year.`);
        if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(r.quartile))
          throw cellError(r.i, 'quartile', `${quote(r.quartile)} is not Q1, Q2, Q3 or Q4.`);
        const quartile = r.quartile as 'Q1' | 'Q2' | 'Q3' | 'Q4';
        return { i: r.i, venue: r.venue, year, category: r.category, quartile, source: r.source };
      });
    skipped = all.length - entries.length;
    const key = (r: InsightsSettings['journalRanks'][number]) =>
      JSON.stringify([venueKey(r.venue), r.year, r.category, r.source]);
    distinct(entries, key, 'repeat the same journal, year, category and source');
    const imported = entries.map(({ i: _i, ...r }) => r);
    const ids = new Set(imported.map(key));
    next.journalRanks = [...settings.journalRanks.filter((r) => !ids.has(key(r))), ...imported];
  } else {
    const imported = rows.flatMap((r, i) => {
      const doi = normalizeDoi(get(r, 'doi', 'originalpaperdoi'));
      if (!doi || !keys.has(doi)) {
        skipped++;
        return [];
      }
      const rw = r.originalpaperdoi !== undefined;
      const notice = {
        doi,
        status: get(r, 'status', 'retractionnature'),
        reason: get(r, 'reason'),
        date: get(r, 'date', 'retractiondate'),
        source: get(r, 'source') || (rw ? 'Retraction Watch' : ''),
      };
      for (const column of ['status', 'source'] as const)
        if (!notice[column])
          throw cellError(
            i,
            column,
            'the cell is empty. Retraction records need status and source.',
          );
      return [notice];
    });
    const key = (r: InsightsSettings['retractions'][number]) =>
      JSON.stringify([r.doi, r.status, r.date, r.source]);
    const merged = new Map([...settings.retractions, ...imported].map((r) => [key(r), r]));
    next.retractions = [...merged.values()];
  }
  if (skipped && skipped === rows.length - blank)
    throw new Error(
      kind === 'rankings'
        ? 'No ranking matches a journal in this snapshot. Journal names must match the venue shown for its papers (case and spacing are ignored).'
        : 'No records match this snapshot. Use its DOI or work ID from the template.',
    );
  return {
    settings: validateInsights(next),
    count: rows.length - skipped - unchanged - ignored - blank,
    skipped,
    unchanged,
    ignored,
    blank,
  };
}

/** A CSV template for a dataset; it starts with a byte-order mark so spreadsheets read UTF-8. */
export function datasetTemplate(kind: Dataset, works: Work[], settings?: InsightsSettings): string {
  let rows: unknown[][];
  if (kind === 'authors') {
    // Rows start from what is in effect (the saved review, else the record), so an untouched row
    // is recognised as unchanged when the file is imported again.
    const saved = new Map(settings?.annotations.map((r) => [r.key, r]));
    rows = [
      ['key', 'authors', 'complete', 'role'],
      ...works.map((w) => {
        const review = saved.get(paperKey(w));
        return review
          ? [paperKey(w), authorsCell(review.authors), review.complete, review.role ?? '']
          : [paperKey(w), authorsCell(w.authors), authorListComplete(w), ''];
      }),
    ];
  } else if (kind === 'annual')
    rows = [
      ['key', 'year', 'citations', 'source'],
      ...works.map((w) => [paperKey(w), '', '', 'scholar']),
    ];
  else if (kind === 'rankings')
    rows = [
      ['venue', 'year', 'category', 'quartile', 'source'],
      ...Array.from(
        new Map(
          works
            .filter((w) => w.venue)
            .map((w) => [`${w.venue}|${w.year}`, [w.venue, w.year, '', '', '']]),
        ).values(),
      ),
    ];
  else
    rows = [
      ['doi', 'status', 'reason', 'date', 'source'],
      ...works.filter((w) => w.doi).map((w) => [w.doi, '', '', '', '']),
    ];
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}`;
}

import type { InsightsSettings, Snapshot, SourceId, Work } from '../types';
import { citationsForSource } from './metrics';
import {
  authorListComplete,
  hasTruncationMarker,
  paperKey,
  roles,
  venueKey,
} from './insights-data';
import { csvCell } from './formats';
import { foldText, nameKeys, nameMatch, type NameMatch } from './names';
import { APP_VERSION } from '../version';

export { authorListComplete };

export type Role = (typeof roles)[number];
export const roleLabels: Record<Role | 'unclassified', string> = {
  sole: 'Sole author',
  first: 'First author',
  second: 'Second author',
  middle: 'Middle author',
  last: 'Last author',
  corresponding: 'Corresponding author',
  unclassified: 'Unclassified',
};
/**
 * Whether a confirmed role applies only to an author list confirmed complete. First, second and
 * corresponding authorship and their weights do not depend on the rest of the list; sole, middle
 * and last positions (and team-size weights) do.
 */
export const roleNeedsCompleteList = (role: Role) =>
  role !== 'first' && role !== 'second' && role !== 'corresponding';
/** Heuristic authorship weights after GScholarLENS (arXiv 2509.04124); see docs/LOCAL_INSIGHTS.md. */
export const WEIGHTS = {
  full: 1,
  first: 0.9,
  second: 0.5,
  smallTeam: 0.25,
  largeTeam: 0.1,
  smallTeamMaxAuthors: 6,
} as const;
export function hIndex(values: number[]): number {
  return [...values].sort((a, b) => b - a).filter((value, i) => value >= i + 1).length;
}
export function quantile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * probability;
  const lower = Math.floor(at);
  return sorted[lower] + (sorted[Math.ceil(at)] - sorted[lower]) * (at - lower);
}
const MATCH_MEMO_LIMIT = 200_000;
let lastMatcher: { signature: string; match: (byline: string) => NameMatch | null } | null = null;
/** Letters and digits only, folded like names.ts, for the cheap surname pre-check below. */
const letters = (value: string) =>
  /^[\x00-\x7f]*$/.test(value)
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, '')
    : foldText(value).replace(/[^\p{L}\p{N}]+/gu, '');
/** Whether some of `words` (each given as its possible spellings), in order, spell `surname`. */
function spells(surname: string, words: string[][]): boolean {
  const reached = new Set([0]);
  for (const spellings of words)
    for (const at of [...reached])
      for (const spelling of spellings)
        if (spelling && surname.startsWith(spelling, at)) reached.add(at + spelling.length);
  return reached.has(surname.length);
}
/**
 * Best match of a byline name against the analysis author and aliases. names.ts keys a surname by
 * its words, leaving out particles inside it ("Garcia de la Cruz" is "garciacruz"), and each of
 * those words is a word of the name. So a byline can only match when some of its words, in order,
 * spell one of the targets' surname keys: most bylines are dismissed by that test and only plausible
 * ones are parsed; those results are remembered per distinct spelling (and across runs while the
 * author and aliases stay the same) so re-analysing after an edit is cheap.
 */
function bylineMatcher(targets: string[]): (byline: string) => NameMatch | null {
  const signature = JSON.stringify(targets);
  if (lastMatcher?.signature === signature) return lastMatcher.match;
  // nameKeys writes "surname:initial"; a surname may itself hold a ":", so both readings are kept.
  const surnames = new Set(
    targets.flatMap((target) =>
      nameKeys(target).flatMap((key) =>
        key.includes(':')
          ? [letters(key), letters(key.slice(0, key.lastIndexOf(':')))]
          : [letters(key)],
      ),
    ),
  );
  // Every beginning of a surname key: a byline with no word among them cannot spell one (an empty
  // key is spelled by any byline).
  const starts = new Set(
    [...surnames].flatMap((s) => Array.from({ length: s.length }, (_, i) => s.slice(0, i + 1))),
  );
  // A word's spellings as a surname word: "Müller" is "muller" or "mueller"; ASCII has one.
  const wordSpellings = new Map<string, string[]>();
  const spellingsOf = (word: string) => {
    let known = wordSpellings.get(word);
    if (!known) {
      known = /^[\x00-\x7f]*$/.test(word) ? [letters(word)] : nameKeys(word).map(letters);
      if (wordSpellings.size >= MATCH_MEMO_LIMIT) wordSpellings.clear();
      wordSpellings.set(word, known);
    }
    return known;
  };
  const memo = new Map<string, NameMatch | null>();
  const match = (byline: string): NameMatch | null => {
    const known = memo.get(byline);
    if (known !== undefined) return known;
    const words = byline.split(/[\s,]+/).map(spellingsOf);
    if (!surnames.has('') && !words.some((spellings) => spellings.some((s) => starts.has(s))))
      return null;
    let plausible = false;
    for (const surname of surnames)
      if (spells(surname, words)) {
        plausible = true;
        break;
      }
    if (!plausible) return null;
    let best: NameMatch | null = null;
    for (const target of targets) {
      const found = nameMatch(byline, target);
      if (found === 'exact') {
        best = 'exact';
        break;
      }
      if (found) best = 'compatible';
    }
    if (memo.size >= MATCH_MEMO_LIMIT) memo.clear();
    memo.set(byline, best);
    return best;
  };
  lastMatcher = { signature, match };
  return match;
}
/** Classified only because the initials are compatible, and not confirmed by hand. */
const isInitialOnlyMatch = (r: { role: string; initialMatch: boolean; reason: string }) =>
  r.role !== 'unclassified' && r.initialMatch && r.reason !== 'Manually confirmed role';
const hasYear = (work: Work) => typeof work.year === 'number' && Number.isFinite(work.year);
export function analyzeInsights(
  works: Work[],
  settings: InsightsSettings,
  source: SourceId | 'all',
  currentYear = new Date().getFullYear(),
) {
  const targets = settings.author.trim()
    ? [settings.author, ...settings.aliases].filter((name) => name.trim())
    : [];
  const match = bylineMatcher(targets);
  const annotations = new Map(settings.annotations.map((r) => [r.key, r]));
  const ranks = new Map<string, Set<string>>();
  for (const r of settings.journalRanks) {
    const key = JSON.stringify([venueKey(r.venue), r.year]);
    const values = ranks.get(key) ?? new Set<string>();
    values.add(r.quartile);
    ranks.set(key, values);
  }
  const retractions = new Map<string, typeof settings.retractions>();
  for (const r of settings.retractions)
    retractions.set(r.doi, [...(retractions.get(r.doi) ?? []), r]);
  const included = works.filter(
    (w) =>
      w.included &&
      (settings.yearFrom === undefined || (w.year !== null && w.year >= settings.yearFrom)) &&
      (settings.yearTo === undefined || (w.year !== null && w.year <= settings.yearTo)),
  );
  // A year bound cannot be checked for undated papers, so they leave the analysis; say how many.
  const undatedExcluded =
    settings.yearFrom === undefined && settings.yearTo === undefined
      ? 0
      : works.filter((w) => w.included && !hasYear(w)).length;
  const rows = included.map((work) => {
    const key = paperKey(work);
    const annotation = annotations.get(key);
    const authors = annotation?.authors ?? work.authors;
    const complete = annotation
      ? annotation.complete && authors.length > 0 && !hasTruncationMarker(authors)
      : authorListComplete(work);
    const positions = targets.length ? authors.flatMap((a, i) => (match(a) ? [i] : [])) : [];
    const initialMatch = positions.length === 1 && match(authors[positions[0]]) === 'compatible';
    let role: Role | 'unclassified' = 'unclassified';
    let reason = !settings.author.trim()
      ? 'Choose an author'
      : !complete
        ? 'Author list needs review'
        : positions.length > 1
          ? 'Ambiguous author match'
          : 'No compatible name or alias match';
    if (
      settings.author.trim() &&
      annotation?.role &&
      (complete || !roleNeedsCompleteList(annotation.role))
    ) {
      role = annotation.role;
      reason = 'Manually confirmed role';
    } else if (settings.author.trim() && positions.length === 1 && (complete || positions[0] < 2)) {
      const position = positions[0];
      role =
        complete && authors.length === 1
          ? 'sole'
          : position === 0
            ? 'first'
            : complete && position === authors.length - 1
              ? 'last'
              : position === 1
                ? 'second'
                : 'middle';
      reason = `${initialMatch ? 'Initial-compatible name; verify identity' : 'Exact name or saved alias'}${complete ? '' : '; known position in an incomplete list'}`;
    }
    const citations = citationsForSource(work, source);
    const weight =
      role === 'unclassified'
        ? null
        : role === 'sole' ||
            role === 'corresponding' ||
            (role === 'last' && settings.lensConvention)
          ? WEIGHTS.full
          : role === 'first'
            ? WEIGHTS.first
            : role === 'second'
              ? WEIGHTS.second
              : authors.length <= WEIGHTS.smallTeamMaxAuthors
                ? WEIGHTS.smallTeam
                : WEIGHTS.largeTeam;
    const rank = ranks.get(JSON.stringify([venueKey(work.venue), work.year]));
    const quartile = rank?.size === 1 ? [...rank][0] : 'Unknown';
    return {
      work,
      key,
      authors,
      complete,
      initialMatch,
      matches: positions.length,
      role,
      reason,
      citations,
      weight,
      adjusted: citations === null || weight === null ? null : citations * weight,
      quartile,
      rankConflict: (rank?.size ?? 0) > 1,
      notices: retractions.get(key) ?? [],
    };
  });
  const counts = rows.flatMap((r) => (r.citations === null ? [] : [r.citations]));
  const totalCitations = counts.reduce((sum, v) => sum + v, 0);
  const adjusted = rows.flatMap((r) => (r.adjusted === null ? [] : [r.adjusted]));
  const groups = [...roles, 'unclassified' as const].map((role) => {
    const members = rows.filter((r) => r.role === role);
    const values = members.flatMap((r) => (r.citations === null ? [] : [r.citations]));
    const weighted = members.flatMap((r) => (r.adjusted === null ? [] : [r.adjusted]));
    const citations = values.reduce((sum, v) => sum + v, 0);
    return {
      role,
      label: roleLabels[role],
      papers: members.length,
      citations,
      coverage: values.length,
      values,
      publicationShare: rows.length ? (members.length / rows.length) * 100 : 0,
      citationShare: totalCitations ? (citations / totalCitations) * 100 : null,
      hIndex: hIndex(values),
      weightedH: role === 'unclassified' ? null : hIndex(weighted),
      median: quantile(values, 0.5),
      q1: quantile(values, 0.25),
      q3: quantile(values, 0.75),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      mean: values.length ? citations / values.length : null,
      quartiles: ['Q1', 'Q2', 'Q3', 'Q4', 'Unknown'].map((quartile) => {
        const papers = members.filter((r) => r.quartile === quartile);
        return {
          quartile,
          papers: papers.length,
          citations: papers.reduce((sum, r) => sum + (r.citations ?? 0), 0),
        };
      }),
    };
  });
  const publishedIn = new Map(rows.map((r) => [r.key, r.work]));
  const publishedYears = rows
    .flatMap((r) => (hasYear(r.work) ? [r.work.year as number] : []))
    .sort((a, b) => a - b);
  /** Dated papers already published by the end of a calendar year: the most that could be cited. */
  const publishedBy = (year: number) => {
    let low = 0;
    let high = publishedYears.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (publishedYears[middle] <= year) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const byYear = new Map<number, Map<string, number>>();
  const history = new Map(
    [
      ...rows.flatMap((r) => (r.work.citationHistory ?? []).map((h) => ({ ...h, key: r.key }))),
      ...settings.annualCitations,
    ].map((r) => [JSON.stringify([r.key, r.year, r.source]), r]),
  );
  let annualIgnored = 0;
  for (const r of history.values()) {
    const paper = publishedIn.get(r.key);
    if (!paper || (source !== 'all' && r.source !== source)) continue;
    // Undated papers cannot be placed in time: they are counted and noted, not plotted.
    if (!hasYear(paper)) continue;
    if (r.year < (paper.year as number) || r.year > currentYear) {
      annualIgnored++;
      continue;
    }
    const year = byYear.get(r.year) ?? new Map<string, number>();
    year.set(r.key, Math.max(year.get(r.key) ?? 0, r.citations));
    byYear.set(r.year, year);
  }
  const annual = [...byYear]
    .sort(([a], [b]) => a - b)
    .map(([year, values]) => ({
      year,
      citations: [...values.values()].reduce((sum, v) => sum + v, 0),
      coverage: values.size,
      papers: publishedBy(year),
    }));
  return {
    rows,
    groups,
    annual,
    annualIgnored,
    undatedPapers: rows.filter((r) => !hasYear(r.work)).length,
    undatedExcluded,
    papers: rows.length,
    totalCitations,
    citationCoverage: counts.length,
    classified: rows.filter((r) => r.role !== 'unclassified').length,
    nameMatches: rows.filter((r) => r.matches > 0).length,
    initialMatches: rows.filter(isInitialOnlyMatch).length,
    hIndex: hIndex(counts),
    shIndex: hIndex(adjusted),
    adjustedCitations: adjusted.reduce((sum, v) => sum + v, 0),
    weightedCoverage: adjusted.length,
    median: quantile(counts, 0.5),
    adjustedMedian: quantile(adjusted, 0.5),
    zeroCitations: counts.filter((v) => v === 0).length,
    preprints: rows.filter(
      (r) =>
        /preprint|posted-content/i.test(r.work.type) ||
        r.work.provenance.some((p) => p.source === 'arxiv' || p.source === 'preprints'),
    ).length,
    retracted: rows.filter((r) => r.notices.some((n) => /^retract(?:ion|ed)$/i.test(n.status)))
      .length,
  };
}
export type InsightsAnalysis = ReturnType<typeof analyzeInsights>;

type InsightRow = InsightsAnalysis['rows'][number];
/** Papers whose author identity needs a look: initial-only matches first, then unclassified ones. */
export const reviewRows = (analysis: InsightsAnalysis): InsightRow[] => [
  ...analysis.rows.filter(isInitialOnlyMatch),
  ...analysis.rows.filter((r) => r.role === 'unclassified'),
];

export interface ExportContext {
  /** The snapshot being analysed, for the reproducibility header of the JSON export. */
  snapshot?: Pick<Snapshot, 'name' | 'query' | 'searchedAt' | 'sourceResults'>;
}
/** At most six decimals, so 544 x 0.1 is written as 54.4 and not 54.400000000000006. */
const round6 = (value: number) => (Number.isInteger(value) ? value : Math.round(value * 1e6) / 1e6);
/** A paper's retraction notices are in the exported settings (by DOI, the row's key), not here. */
const summarizeRow = (r: InsightsAnalysis['rows'][number]) => ({
  key: r.key,
  title: r.work.title,
  year: r.work.year,
  venue: r.work.venue,
  role: r.role,
  classification: r.reason,
  authorsComplete: r.complete,
  authorCount: r.authors.length,
  citations: r.citations,
  weight: r.weight,
  adjusted: r.adjusted,
  quartile: r.quartile,
});
function retrievalSummary(rows: InsightsAnalysis['rows'], source: SourceId | 'all') {
  let earliest: string | null = null;
  let latest: string | null = null;
  let first = Infinity;
  let last = -Infinity;
  const sources = new Set<SourceId>();
  for (const { work } of rows)
    for (const record of work.provenance) {
      if (source !== 'all' && record.source !== source) continue;
      sources.add(record.source);
      const time = Date.parse(record.retrievedAt);
      if (Number.isNaN(time)) continue;
      if (time < first) [first, earliest] = [time, record.retrievedAt];
      if (time > last) [last, latest] = [time, record.retrievedAt];
    }
  return { earliest, latest, sources: [...sources].sort() };
}

export function exportInsights(
  analysis: InsightsAnalysis,
  settings: InsightsSettings,
  source: SourceId | 'all',
  format: 'csv' | 'tsv' | 'json',
  context: ExportContext = {},
): string {
  if (format === 'json') {
    const { rows, ...summary } = analysis;
    const { snapshot } = context;
    // Written compactly: indentation would nearly triple the size of the long lists.
    return JSON.stringify(
      {
        header: {
          application: 'Academic Publication Tracker',
          appVersion: APP_VERSION,
          exportedAt: new Date().toISOString(),
          snapshot: snapshot
            ? {
                name: snapshot.name,
                searchedAt: snapshot.searchedAt,
                query: snapshot.query,
                sourceResults: snapshot.sourceResults,
              }
            : null,
          citationSource: source,
          author: settings.author,
          aliases: settings.aliases,
          yearRange: { from: settings.yearFrom ?? null, to: settings.yearTo ?? null },
          weighting: {
            method:
              'Heuristic authorship weights after GScholarLENS (arXiv 2509.04124). Position is descriptive, not a measure of contribution.',
            weights: {
              soleOrCorresponding: WEIGHTS.full,
              first: WEIGHTS.first,
              second: WEIGHTS.second,
              otherSmallTeam: WEIGHTS.smallTeam,
              otherLargeTeam: WEIGHTS.largeTeam,
            },
            smallTeamMaxAuthors: WEIGHTS.smallTeamMaxAuthors,
            lastAuthorConvention: settings.lensConvention,
            notes: [
              settings.lensConvention
                ? 'Last authors receive the full weight (GScholarLENS convention).'
                : 'Last authors are weighted like other roles.',
              'On a complete two-author list the second author is classified as last author.',
              'Teams of exactly six authors use the small-team weight; the source paper leaves exactly six unspecified.',
              'Weighted statistics use only papers with a classified role and a known citation count.',
            ],
          },
          retrieval: retrievalSummary(rows, source),
        },
        settings,
        source,
        analysis: { ...summary, rows: rows.map(summarizeRow) },
      },
      (_key, value) => (typeof value === 'number' ? round6(value) : value),
    );
  }
  const table: unknown[][] = [
    [
      'author',
      'aliases',
      'citation_source',
      'year_from',
      'year_to',
      'last_author_convention',
      'key',
      'title',
      'year',
      'role',
      'classification',
      'authors_complete',
      'citations',
      'weight',
      'adjusted_citations',
      'quartile',
      'notices',
    ],
    ...analysis.rows.map((r) => [
      settings.author,
      settings.aliases.join('; '),
      source,
      settings.yearFrom,
      settings.yearTo,
      settings.lensConvention,
      r.key,
      r.work.title,
      r.work.year,
      r.role,
      r.reason,
      r.complete,
      r.citations,
      r.weight === null ? null : round6(r.weight),
      r.adjusted === null ? null : round6(r.adjusted),
      r.quartile,
      r.notices.map((n) => `${n.status}: ${n.source} ${n.date} ${n.reason}`).join('; '),
    ]),
  ];
  // The byte-order mark makes spreadsheets read the file as UTF-8, so author names keep accents.
  return `\uFEFF${table.map((row) => row.map(csvCell).join(format === 'tsv' ? '\t' : ',')).join('\r\n')}`;
}

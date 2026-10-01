import type { SourceId, Work } from '../types';

/** Venue names that differ only by case, spacing or compatibility forms are the same venue. */
export const venueKey = (venue: string) =>
  venue.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export function citationsForSource(work: Work, source: SourceId | 'all' = 'all'): number | null {
  const counts = work.provenance
    .filter((record) => source === 'all' || record.source === source)
    .map((record) => record.citations)
    .filter(
      (count): count is number => count !== null && Number.isSafeInteger(count) && count >= 0,
    );
  if (counts.length) return Math.max(...counts);
  if (
    source === 'all' &&
    !work.provenance.length &&
    work.citations !== null &&
    Number.isSafeInteger(work.citations) &&
    work.citations >= 0
  )
    return work.citations;
  return null;
}

export function calculateMetrics(
  works: Work[],
  source: SourceId | 'all' = 'all',
  currentYear = new Date().getFullYear(),
) {
  const included = works.filter((work) => work.included);
  const known = included
    .map((work) => citationsForSource(work, source))
    .filter((count): count is number => count !== null)
    .sort((a, b) => b - a);
  const counts = [...known, ...Array<number>(included.length - known.length).fill(0)];
  const citations = known.reduce((sum, count) => sum + count, 0);
  let hIndex = 0;
  let gIndex = 0;
  let cumulative = 0;
  counts.forEach((count, index) => {
    const rank = index + 1;
    if (count >= rank) hIndex = rank;
    cumulative += count;
    if (cumulative >= rank * rank) gIndex = rank;
  });
  const dated = included
    .map((work) => work.year)
    .filter((year): year is number => year !== null && Number.isInteger(year) && year > 0);
  // The years the timeline draws: a mistyped year it leaves out does not stretch the span either.
  const drawn = yearWindow(dated, currentYear);
  const firstYear = drawn?.oldest ?? null;
  const lastYear = drawn?.newest ?? null;
  const publicationYears =
    firstYear !== null && firstYear <= currentYear ? currentYear - firstYear + 1 : 0;
  const yearGroups = new Map<
    number,
    { year: number; papers: number; citations: number; coverage: number }
  >();
  const venues = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const work of included) {
    if (work.year !== null && Number.isInteger(work.year) && work.year > 0) {
      const group = yearGroups.get(work.year) ?? {
        year: work.year,
        papers: 0,
        citations: 0,
        coverage: 0,
      };
      group.papers++;
      group.citations += citationsForSource(work, source) ?? 0;
      if (citationsForSource(work, source) !== null) group.coverage++;
      yearGroups.set(work.year, group);
    }
    const venue = work.venue.trim();
    if (venue) {
      const group = venues.get(venueKey(venue)) ?? { count: 0, spellings: new Map() };
      group.count++;
      group.spellings.set(venue, (group.spellings.get(venue) ?? 0) + 1);
      venues.set(venueKey(venue), group);
    }
  }
  const middle = Math.floor(known.length / 2);
  return {
    papers: included.length,
    citations,
    citationCoverage: known.length,
    hIndex,
    gIndex,
    i10Index: known.filter((count) => count >= 10).length,
    citationsPerPaper: known.length ? citations / known.length : 0,
    citationsPerYear: publicationYears ? citations / publicationYears : 0,
    annualizedH: publicationYears ? hIndex / publicationYears : 0,
    medianCitations: known.length
      ? known.length % 2
        ? known[middle]
        : (known[middle - 1] + known[middle]) / 2
      : 0,
    firstYear,
    lastYear,
    years: [...yearGroups.values()].sort((a, b) => a.year - b.year),
    topVenues: [...venues.values()]
      .map(({ count, spellings }) => ({
        // Show the most used spelling; ties go to the first in code-unit order, whatever the input order.
        name: [...spellings].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0],
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8),
  };
}

/** The widest year axis a chart draws; a mistyped year must not stretch it across centuries. */
export const MAX_CHART_YEARS = 120;

/** The latest year up to next year, and the earliest within MAX_CHART_YEARS of it; null if none. */
function yearWindow(years: number[], currentYear: number) {
  const real = years.filter((year) => year <= currentYear + 1);
  if (!real.length) return null;
  const newest = Math.max(...real);
  return { oldest: Math.min(...real.filter((year) => year > newest - MAX_CHART_YEARS)), newest };
}

/**
 * One entry per calendar year from the first to the last, `empty(year)` standing in for years with
 * no data, so a gap looks like a gap. The axis ends at the latest year with data up to next year and
 * starts at the earliest year with data within MAX_CHART_YEARS of that, so a mistyped year on either
 * side cannot stretch it; rows outside it (or not calendar years at all) are handed back as `omitted`.
 */
export function chartYears<T extends { year: number }>(
  rows: T[],
  empty: (year: number) => T,
  currentYear = new Date().getFullYear(),
): { years: T[]; omitted: T[] } {
  const valid = rows.filter((row) => Number.isInteger(row.year) && row.year > 0);
  const drawn = yearWindow(
    valid.map((row) => row.year),
    currentYear,
  );
  if (!drawn) return { years: [], omitted: valid };
  const { oldest, newest } = drawn;
  const byYear = new Map(valid.map((row) => [row.year, row]));
  const years: T[] = [];
  for (let year = oldest; year <= newest; year++) years.push(byYear.get(year) ?? empty(year));
  return { years, omitted: valid.filter((row) => row.year < oldest || row.year > newest) };
}

/** Print a year label every this many years, so that about ten labels fit under the bars. */
export function yearLabelStep(count: number): number {
  if (count <= 12) return 1;
  return [2, 5, 10, 20, 25, 50, 100].find((step) => Math.ceil(count / step) <= 10) ?? 100;
}

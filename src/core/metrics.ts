import type { SourceId, Work } from '../types';

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
  const firstYear = dated.length ? Math.min(...dated) : null;
  const lastYear = dated.length ? Math.max(...dated) : null;
  const publicationYears =
    firstYear !== null && firstYear <= currentYear ? currentYear - firstYear + 1 : 0;
  const yearGroups = new Map<number, { year: number; papers: number; citations: number }>();
  const venues = new Map<string, number>();
  for (const work of included) {
    if (work.year !== null && Number.isInteger(work.year) && work.year > 0) {
      const group = yearGroups.get(work.year) ?? { year: work.year, papers: 0, citations: 0 };
      group.papers++;
      group.citations += citationsForSource(work, source) ?? 0;
      yearGroups.set(work.year, group);
    }
    const venue = work.venue.trim();
    if (venue) venues.set(venue, (venues.get(venue) ?? 0) + 1);
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
    openAccess: included.filter((work) => work.isOpenAccess).length,
    medianCitations: known.length
      ? known.length % 2
        ? known[middle]
        : (known[middle - 1] + known[middle]) / 2
      : 0,
    firstYear,
    lastYear,
    years: [...yearGroups.values()].sort((a, b) => a.year - b.year),
    topVenues: [...venues]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8),
  };
}

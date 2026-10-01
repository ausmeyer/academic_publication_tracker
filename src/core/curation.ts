import type { Work } from '../types';
import { mergeWorks, normalizeDoi, providerKey, titleKey } from './merge';
import { isPublicationKind, workKind } from './worktype';

/** Most old copies of one paper that a fresh record takes curation from together. */
const MAX_COPIES = 20;

function providerKeys(work: Work): string[] {
  return [...new Set(work.provenance.map(providerKey).filter(Boolean))];
}

/**
 * v0.4.3 saved every record included, so an included record of a non-publication kind (erratum,
 * peer review …) without notes or tags is that default, not a choice to keep it (decision D11).
 */
const defaultInclusion = (work: Work) =>
  work.included &&
  !isPublicationKind(workKind(work.type)) &&
  !work.notes.trim() &&
  !work.tags.length;

/**
 * Carry only curation into fresh metadata, and leave ambiguous matches untouched. Matching is
 * one-to-one: an old record hands its curation to at most one fresh record, and an old record
 * claimed by several fresh records carries nothing. An identifier match (DOI or provider record)
 * beats a title match: a title match never takes an old record that another fresh record claims by
 * identifier. A fresh record with an identifier match also takes each old record that only it
 * matches, by title, when merging would join that record to the ones it shares an identifier with.
 * A fresh record that matches several old records takes their combined curation (as merging would
 * combine it) when they are copies of one paper, and nothing otherwise.
 */
export function carryForwardCuration(fresh: Work[], previous: Work[]): Work[] {
  const byDoi = new Map<string, number[]>();
  const byProvider = new Map<string, number[]>();
  const byTitle = new Map<string, number[]>();
  const oldDois = previous.map((work) => normalizeDoi(work.doi));
  const index = (map: Map<string, number[]>, key: string, position: number) => {
    if (!key) return;
    const matches = map.get(key) ?? [];
    matches.push(position);
    map.set(key, matches);
  };
  previous.forEach((work, position) => {
    index(byDoi, oldDois[position], position);
    for (const key of providerKeys(work)) index(byProvider, key, position);
    index(byTitle, titleKey(work), position);
  });
  const conflict = (doi: string, position: number) =>
    Boolean(doi && oldDois[position] && doi !== oldDois[position]);
  /** Old records that share the DOI or a provider record of each fresh record (never two DOIs). */
  const identified = fresh.map((work) => {
    const doi = normalizeDoi(work.doi);
    const found = new Set<number>();
    for (const group of [
      byDoi.get(doi) ?? [],
      ...providerKeys(work).map((key) => byProvider.get(key) ?? []),
    ])
      for (const position of group) {
        if (conflict(doi, position)) continue;
        found.add(position);
        if (found.size > MAX_COPIES) return [...found];
      }
    return [...found];
  });
  type Claim = { matches: number[]; old: Work; byDefault: boolean };
  const claimOf = (matches: number[]): Claim | null => {
    if (!matches.length || matches.length > MAX_COPIES) return null;
    const olds = matches.sort((a, b) => a - b).map((position) => previous[position]);
    // Several old records are one claim only when merging would make them one publication.
    const combined = olds.length === 1 ? olds : mergeWorks(olds);
    if (combined.length !== 1) return null;
    return { matches, old: combined[0], byDefault: olds.every(defaultInclusion) };
  };
  const tally = (lists: number[][]) => {
    const counts = new Map<number, number>();
    for (const list of lists)
      for (const match of list) counts.set(match, (counts.get(match) ?? 0) + 1);
    return counts;
  };
  const matchesOf = (claims: (Claim | null)[]) => claims.map((claim) => claim?.matches ?? []);
  const strongClaims = identified.map((matches) => claimOf(matches));
  const strongCounts = tally(matchesOf(strongClaims));
  /** Old records each fresh record matches by title, except those claimed by identifier. */
  const titled = fresh.map((work) => {
    const doi = normalizeDoi(work.doi);
    const matches: number[] = [];
    for (const candidate of byTitle.get(titleKey(work)) ?? []) {
      if (conflict(doi, candidate) || strongCounts.has(candidate)) continue;
      if (mergeWorks([previous[candidate], work]).length !== 1) continue;
      matches.push(candidate);
      if (matches.length > MAX_COPIES) break;
    }
    return matches;
  });
  const titleCounts = tally(titled);
  // A fresh record without an identifier match claims its title matches.
  const weakClaims = fresh.map((_, position) =>
    identified[position].length ? null : claimOf(titled[position]),
  );
  const weakCounts = tally(matchesOf(weakClaims));
  return fresh.map((work, position) => {
    const strong = strongClaims[position];
    let claim = strong ?? weakClaims[position];
    const counts = strong ? strongCounts : weakCounts;
    if (!claim || claim.matches.some((match) => counts.get(match) !== 1)) return work;
    if (strong) {
      // It also takes the old records that only it matches by title and that merge with its own.
      const olds = strong.matches.map((match) => previous[match]);
      const extras = titled[position].filter(
        (candidate) =>
          titleCounts.get(candidate) === 1 &&
          mergeWorks([...olds, previous[candidate]]).length === 1,
      );
      if (extras.length) claim = claimOf([...strong.matches, ...extras]) ?? strong;
    }
    const { old } = claim;
    // A default inclusion (D11) leaves the fresh record's own default in place.
    const included = claim.byDefault ? work.included : old.included;
    return { ...work, included, notes: old.notes, tags: [...old.tags] };
  });
}

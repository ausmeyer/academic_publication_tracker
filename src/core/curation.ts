import type { Work } from '../types';
import { mergeWorks, normalizeDoi } from './merge';

function titleKey(work: Work): string {
  // This is only a candidate index. mergeWorks makes the identity decision.
  const title = work.title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return work.year === null || title.length < 24 ? '' : `${work.year}:${title}`;
}

function providerKeys(work: Work): string[] {
  return work.provenance
    .filter((p) => p.sourceId.trim())
    .map((p) => `${p.source}:${p.sourceId.trim()}`);
}

/** Carry only curation into fresh metadata, and leave ambiguous matches untouched. */
export function carryForwardCuration(fresh: Work[], previous: Work[]): Work[] {
  const byDoi = new Map<string, number[]>();
  const byProvider = new Map<string, number[]>();
  const byTitle = new Map<string, number[]>();
  const oldDois = previous.map((work) => normalizeDoi(work.doi));
  const oldProviders = previous.map((work) => new Set(providerKeys(work)));
  const index = (map: Map<string, number[]>, key: string, position: number) => {
    if (!key) return;
    const matches = map.get(key) ?? [];
    matches.push(position);
    map.set(key, matches);
  };
  previous.forEach((work, position) => {
    index(byDoi, oldDois[position], position);
    for (const key of oldProviders[position]) index(byProvider, key, position);
    index(byTitle, titleKey(work), position);
  });
  return fresh.map((work) => {
    const doi = normalizeDoi(work.doi);
    const providers = providerKeys(work);
    const groups = [
      byDoi.get(doi) ?? [],
      ...providers.map((key) => byProvider.get(key) ?? []),
      byTitle.get(titleKey(work)) ?? [],
    ];
    const visited = new Set<number>();
    let match: Work | undefined;
    for (const group of groups) {
      for (const position of group) {
        if (visited.has(position)) continue;
        visited.add(position);
        const old = previous[position];
        if (doi && oldDois[position] && doi !== oldDois[position]) continue;
        const sameIdentifier =
          Boolean(doi && doi === oldDois[position]) ||
          providers.some((key) => oldProviders[position].has(key));
        if (!sameIdentifier && mergeWorks([old, work]).length !== 1) continue;
        if (match) return work;
        match = old;
      }
    }
    return match
      ? { ...work, included: match.included, notes: match.notes, tags: [...match.tags] }
      : work;
  });
}

import type { Work } from '../types';

export function normalizeDoi(value: string): string {
  let doi = value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  try {
    doi = decodeURIComponent(doi);
  } catch {
    /* Keep literal DOI if it is not URL encoded. */
  }
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi.toLowerCase() : '';
}

function titleKey(work: Work): string {
  const title = work.title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return title.length >= 24 && work.year !== null ? `${work.year}:${title}` : '';
}

function authorKey(name: string): string {
  const parts = name.toLowerCase().normalize('NFKC').split(',');
  const words =
    (parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0]}` : parts[0]).match(
      /[\p{L}\p{N}]+/gu,
    ) ?? [];
  return words.length > 1 ? `${words.at(-1)}:${words[0]?.[0]}` : (words[0] ?? '');
}

function sameTitleAndAuthor(left: Work, right: Work): boolean {
  const title = titleKey(left);
  if (!title || title !== titleKey(right)) return false;
  const authors = new Set(left.authors.map(authorKey).filter(Boolean));
  return right.authors.some((author) => authors.has(authorKey(author)));
}

function combine(first: Work, incoming: Work): Work {
  const provenance = [...first.provenance];
  const existing = new Set(provenance.map((record) => JSON.stringify(record)));
  for (const record of incoming.provenance) {
    if (!existing.has(JSON.stringify(record))) {
      provenance.push({ ...record });
      existing.add(JSON.stringify(record));
    }
  }
  const counts = [
    first.citations,
    incoming.citations,
    ...provenance.map((record) => record.citations),
  ].filter((count): count is number => count !== null && Number.isSafeInteger(count) && count >= 0);
  return {
    ...first,
    title: first.title || incoming.title,
    authors: incoming.authors.length > first.authors.length ? [...incoming.authors] : first.authors,
    year: first.year ?? incoming.year,
    venue: first.venue || incoming.venue,
    doi: first.doi || incoming.doi,
    abstract: first.abstract || incoming.abstract,
    ...(first.snippet || incoming.snippet ? { snippet: first.snippet || incoming.snippet } : {}),
    type: first.type || incoming.type,
    url: first.url || incoming.url,
    openAccessUrl: first.openAccessUrl || incoming.openAccessUrl,
    isOpenAccess: first.isOpenAccess || incoming.isOpenAccess,
    citations: counts.length ? Math.max(...counts) : null,
    provenance,
  };
}

/** DOI and provider identity first; matching never bridges two different DOIs. */
export function mergeWorks(works: Work[]): Work[] {
  type Group = { work: Work; members: Work[]; order: number };
  const groups: Group[] = [];
  const doiGroups = new Map<string, Group>();
  works.forEach((original, order) => {
    const work: Work = {
      ...original,
      doi: normalizeDoi(original.doi),
      authors: [...original.authors],
      provenance: original.provenance.map((record) => ({ ...record })),
      tags: [...original.tags],
    };
    const group = work.doi ? doiGroups.get(work.doi) : undefined;
    if (group) {
      group.work = combine(group.work, work);
      group.members.push(work);
    } else {
      const added = { work, members: [work], order };
      groups.push(added);
      if (work.doi) doiGroups.set(work.doi, added);
    }
  });
  const removed = new Set<Group>();
  const providerGroups = new Map<string, Set<Group>>();
  for (const group of groups) {
    for (const record of group.work.provenance) {
      if (!record.sourceId.trim()) continue;
      const key = `${record.source}:${record.sourceId.trim()}`;
      const matches = providerGroups.get(key) ?? new Set<Group>();
      matches.add(group);
      providerGroups.set(key, matches);
    }
  }
  // Inspect the entire provider-connected component before merging. A DOI-less
  // bridge must not attach to whichever conflicting DOI happened to arrive first.
  const visited = new Set<Group>();
  const expandedProviders = new Set<string>();
  for (const group of groups) {
    if (visited.has(group)) continue;
    const component: Group[] = [];
    const pending = [group];
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const record of current.work.provenance) {
        if (!record.sourceId.trim()) continue;
        const key = `${record.source}:${record.sourceId.trim()}`;
        if (expandedProviders.has(key)) continue;
        expandedProviders.add(key);
        for (const match of providerGroups.get(key) ?? []) {
          if (!visited.has(match)) pending.push(match);
        }
      }
    }
    if (component.filter((candidate) => candidate.work.doi).length > 1) continue;
    component.sort((a, b) => a.order - b.order);
    const target = component[0];
    for (const candidate of component.slice(1)) {
      target.work = combine(target.work, candidate.work);
      target.members.push(...candidate.members);
      removed.add(candidate);
    }
  }
  const titleGroups = new Map<string, Set<Group>>();
  for (const group of groups) {
    if (removed.has(group)) continue;
    for (const member of group.members) {
      const key = titleKey(member);
      if (!key) continue;
      const matches = titleGroups.get(key) ?? new Set<Group>();
      matches.add(group);
      titleGroups.set(key, matches);
    }
  }
  // Resolve all DOI groups before considering records without a DOI. An ambiguous
  // title-only record stays separate, regardless of the order of its candidates.
  for (const group of groups) {
    if (group.work.doi || removed.has(group)) continue;
    const possible = new Set(
      group.members.flatMap((member) => [...(titleGroups.get(titleKey(member)) ?? [])]),
    );
    const candidates = [...possible].filter(
      (candidate) =>
        candidate !== group &&
        !removed.has(candidate) &&
        candidate.members.some((other) =>
          group.members.some((work) => sameTitleAndAuthor(work, other)),
        ),
    );
    const withDoi = candidates.filter((candidate) => candidate.work.doi);
    if (withDoi.length > 1) continue;
    const target =
      withDoi[0] ??
      candidates.find((candidate) => !candidate.work.doi && candidate.order < group.order);
    if (!target) continue;
    const first = target.order < group.order ? target.work : group.work;
    const second = target.order < group.order ? group.work : target.work;
    target.work = combine(first, second);
    target.members.push(...group.members);
    target.order = Math.min(target.order, group.order);
    for (const member of group.members) {
      titleGroups.get(titleKey(member))?.add(target);
    }
    removed.add(group);
  }
  return groups
    .filter((group) => !removed.has(group))
    .sort((a, b) => a.order - b.order)
    .map((group) => group.work);
}

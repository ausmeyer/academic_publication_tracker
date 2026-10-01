import type { Provenance, Work } from '../types.ts';
import { LIMITS, clampText } from './limits.ts';
import { foldText, nameKeys, nameMatch } from './names.ts';
import { isPublicationKind, workKind } from './worktype.ts';

const INVISIBLE = /[\u{200b}-\u{200d}\u{2060}\u{feff}]/gu;
const DOI_HOST = /^(?:https?:\/\/)?(?:(?:www|dx)\.)?doi\.org\//i;
const DOI_LABEL = /^(?:urn:)?doi\s*:\s*|^info:doi\//i;
const WRAPPED_DOI = /^(?:https?:|doi\b|urn:|info:|www\.|dx\.|doi\.org|10\.)/i;
const WRAPPERS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '<': '>',
  '{': '}',
  '"': '"',
  "'": "'",
};

function unwrap(text: string): string {
  for (;;) {
    const close = WRAPPERS[text[0]];
    if (!close || text.length < 3 || text[text.length - 1] !== close) return text;
    const inner = text.slice(1, -1).trim();
    if (!WRAPPED_DOI.test(inner)) return text;
    text = inner;
  }
}

function count(text: string, char: string): number {
  let total = 0;
  for (let i = text.indexOf(char); i !== -1; i = text.indexOf(char, i + 1)) total++;
  return total;
}

const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Drops what clearly is sentence punctuation after a DOI: a comma, a period after a letter or digit,
 * a closing bracket without an opening partner (and a period or comma after one), and, for a doi.org
 * link, a trailing slash. A trailing ";", ":", "#", ">" or "/" can belong to a DOI, so it stays.
 */
function trimTail(text: string, link: boolean): string {
  const open: Record<string, number> = {};
  for (const bracket of '()[]{}') open[bracket] = count(text, bracket);
  const unmatched = (closer: string) => open[closer] > open[OPENERS[closer]];
  let end = text.length;
  for (;;) {
    const last = text[end - 1];
    const before = text[end - 2];
    if (last in OPENERS && unmatched(last)) {
      open[last]--;
      end--;
    } else if (
      (last === '.' || last === ',') &&
      before !== undefined &&
      (/[\p{L}\p{N}]/u.test(before) || (before in OPENERS && unmatched(before)))
    )
      end--;
    else if (link && last === '/') end--;
    else break;
  }
  return text.slice(0, end);
}

/**
 * Canonical lower-case DOI, or '' when the text is not a DOI. Accepts bare DOIs and the forms people
 * paste (doi:, info:doi/, urn:doi:, doi.org / dx.doi.org / www.doi.org links with or without a
 * scheme, wrapping brackets). A bare DOI is taken whole: a trailing "#", ";", ":" or ">" and any
 * "?" or "#" inside belong to it (real SICI DOIs end in "2-#" or contain "<>"); only a comma, a period
 * after a letter or digit and a closing bracket without an opening partner are sentence punctuation.
 * A doi.org link additionally loses its query, fragment and trailing slash, but a final "#" or "?"
 * with nothing after it stays (providers link "…;2-#" unencoded). Percent-encoding is decoded.
 */
export function normalizeDoi(value: string): string {
  if (typeof value !== 'string') return '';
  let text = unwrap(value.replace(INVISIBLE, '').trim());
  let link = false;
  for (let pass = 0; pass < 3; pass++) {
    const host = DOI_HOST.exec(text);
    if (host) {
      text = text.slice(host[0].length);
      link = true;
      continue;
    }
    const label = DOI_LABEL.exec(text);
    if (!label) break;
    text = text.slice(label[0].length).trimStart();
  }
  if (link) {
    // The query and fragment of a link are not part of the DOI; an encoded %23 or %3F still is,
    // and so is a "#" or "?" at the very end, which starts no query or fragment.
    const cut = text.search(/[?#]/);
    if (cut !== -1 && cut < text.length - 1) text = text.slice(0, cut);
  }
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* Not percent-encoded: keep the literal text. */
  }
  // A decoded space would make the DOI unreadable, so a literal "%20" stays as typed.
  if (decoded !== text && /\s/.test(decoded) && !/\s/.test(text)) decoded = text;
  decoded = trimTail(decoded, link);
  if (decoded.length > LIMITS.doi) return '';
  return /^10\.\d{4,9}(?:\.\d+)*\/\S+$/.test(decoded) ? decoded.toLowerCase() : '';
}

/**
 * The doi.org address of a DOI. The URL path setter encodes what cannot stand in a path (`#`, `?`,
 * `<`, `>`, spaces), so those characters stay part of the DOI; "%" and "\" are encoded first.
 */
export function doiUrl(doi: string): string {
  const link = new URL('https://doi.org/');
  link.pathname = `/${doi.replace(/[%\\]/g, encodeURIComponent)}`;
  return link.href;
}

/** Text that is not a readable DOI but harmless to keep: short, single-line, no control characters. */
function keepableDoiText(value: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length <= LIMITS.doi && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
}

const isPlaceholderTitle = (title: string) =>
  !title.trim() || /^untitled record$/i.test(title.trim());
const isPlaceholderType = (type: string) => !type.trim() || /^publication$/i.test(type.trim());
/** A type that names a kind of publication; a placeholder or an unknown type says nothing. */
const namesPublication = (type: string) => {
  const kind = workKind(type);
  return kind !== 'other' && isPublicationKind(kind) && !isPlaceholderType(type);
};
/** Excluded by default because of its kind (an erratum, a peer review …), with nothing added. */
const excludedByKind = (work: Work) =>
  !work.included &&
  !isPublicationKind(workKind(work.type)) &&
  !work.notes.trim() &&
  !work.tags.length;

/** Comparable title text: diacritics, case and punctuation are ignored; short titles are not evidence. */
function titleText(work: Work): string {
  const text = foldText(work.title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return text.length >= 24 ? text : '';
}

/** Title + year candidate key. */
export function titleKey(work: Work): string {
  const text = titleText(work);
  return text && work.year !== null ? `${work.year}:${text}` : '';
}

/**
 * Identity of a provider record. Europe PMC describes PubMed records as "MED:<pmid>"; PubMed calls
 * the same record "<pmid>", and an arXiv record keeps its identity across versions ("<id>v2"), so
 * each of those spellings is one provider identity.
 */
export function providerKey(record: Provenance): string {
  const id = record.sourceId.trim();
  if (!id) return '';
  if (record.source === 'europepmc') {
    const pubmed = /^MED:(\d+)$/i.exec(id);
    if (pubmed) return `pubmed:${pubmed[1]}`;
  }
  // arXiv ids were saved with their version ("2304.02643v1"); a later version is the same record.
  if (record.source === 'arxiv') return `arxiv:${id.replace(/v\d+$/i, '')}`;
  return `${record.source}:${id}`;
}

function uniqueProviderKeys(work: Work): string[] {
  return [...new Set(work.provenance.map(providerKey).filter(Boolean))];
}

/** Duplicate-detection keys of an author list, each with the names that have it. */
function authorKeys(authors: string[]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const author of authors)
    for (const key of nameKeys(author)) {
      const names = keys.get(key);
      if (!names) keys.set(key, [author]);
      else if (!names.includes(author)) names.push(author);
    }
  return keys;
}

const isScholar = (record: Provenance) => record.source === 'scholar';
const isCount = (count: number | null): count is number =>
  count !== null && Number.isSafeInteger(count) && count >= 0;

function isComplete(work: Work): boolean {
  return (
    work.authors.length > 0 &&
    !work.authors.some((author) => /\.{3}|…|\bet al\b/i.test(author)) &&
    (work.authorsComplete ?? !work.provenance.some(isScholar))
  );
}

/** Keeps the provenance list inside the workspace limit without dropping the best citation count. */
function clampProvenance(list: Provenance[]): Provenance[] {
  if (list.length <= LIMITS.provenance) return list;
  const kept = list.slice(0, LIMITS.provenance);
  let best = -1;
  let bestIndex = -1;
  list.forEach((record, index) => {
    if (isCount(record.citations) && record.citations > best) {
      best = record.citations;
      bestIndex = index;
    }
  });
  if (bestIndex >= LIMITS.provenance) kept[LIMITS.provenance - 1] = list[bestIndex];
  return kept;
}

/**
 * Combines records of one publication, in input order. The first record supplies identity and
 * wins every scalar field it has (a publication merged with notices is described by the
 * publication); curation is shared: tags are united, distinct notes are kept,
 * and one excluded record excludes the merged publication (unless it was excluded only because it
 * is typed as a notice, review report … and another member is typed as a publication). Citations
 * are the maximum of all members, and the most complete author list wins.
 */
function combineAll(members: Work[]): Work {
  const first = members[0];
  const provenance = [...first.provenance];
  const seen = new Set(provenance.map((record) => JSON.stringify(record)));
  let allScholar = provenance.every(isScholar);
  let authors = first.authors;
  let complete = isComplete(first);
  let citations: number | null = null;
  const note = (value: number | null) => {
    if (isCount(value) && (citations === null || value > citations)) citations = value;
  };
  note(first.citations);
  for (const record of provenance) note(record.citations);
  const history = new Map<string, NonNullable<Work['citationHistory']>[number]>();
  let hasHistory = false;
  const addHistory = (list: Work['citationHistory']) => {
    if (!list) return;
    hasHistory = true;
    for (const entry of list) history.set(`${entry.source}:${entry.year}`, entry);
  };
  addHistory(first.citationHistory);
  for (let index = 1; index < members.length; index++) {
    const incoming = members[index];
    const incomingComplete = isComplete(incoming);
    const takeIncoming =
      incomingComplete !== complete
        ? incomingComplete
        : incoming.authors.length > authors.length ||
          (incoming.authors.length === authors.length &&
            allScholar &&
            incoming.provenance.some((record) => !isScholar(record)));
    if (takeIncoming) {
      authors = incoming.authors;
      complete = incomingComplete;
    }
    note(incoming.citations);
    for (const record of incoming.provenance) {
      const key = JSON.stringify(record);
      if (seen.has(key)) continue;
      seen.add(key);
      provenance.push(record);
      note(record.citations);
      if (!isScholar(record)) allScholar = false;
    }
    addHistory(incoming.citationHistory);
  }
  // A provider may type the publication itself as an erratum or paratext, and a PubMed erratum can
  // carry the corrected article's DOI. When members disagree, the merged record is the publication:
  // it takes the first publication type and that member's description (title, year, venue …), and
  // a member excluded only by its kind does not exclude it.
  const publication = members.some((member) => !isPublicationKind(workKind(member.type)))
    ? members.find((member) => namesPublication(member.type))
    : undefined;
  const described = publication
    ? [publication, ...members.filter((member) => member !== publication)]
    : members;
  const pick = (get: (work: Work) => string, placeholder: (value: string) => boolean) => {
    let fallback = '';
    for (const member of described) {
      const value = get(member);
      if (!placeholder(value)) return value;
      fallback ||= value;
    }
    return fallback;
  };
  const firstText = (get: (work: Work) => string) => pick(get, (value) => !value);
  const snippet = firstText((member) => member.snippet ?? '');
  const tags = [...new Set(members.flatMap((member) => member.tags))].slice(0, LIMITS.tags);
  const notes: string[] = [];
  for (const member of members) {
    const text = member.notes.trim();
    if (text && !notes.some((existing) => existing.trim() === text)) notes.push(member.notes);
  }
  return {
    ...first,
    title: pick((member) => member.title, isPlaceholderTitle),
    authors,
    ...(hasHistory
      ? { citationHistory: [...history.values()].slice(0, LIMITS.citationHistory) }
      : {}),
    authorsComplete: complete,
    year: described.find((member) => member.year !== null)?.year ?? null,
    venue: firstText((member) => member.venue),
    doi: firstText((member) => member.doi),
    abstract: firstText((member) => member.abstract),
    ...(snippet ? { snippet } : {}),
    type: publication?.type ?? pick((member) => member.type, isPlaceholderType),
    url: firstText((member) => member.url),
    openAccessUrl: firstText((member) => member.openAccessUrl),
    isOpenAccess: members.some((member) => member.isOpenAccess),
    citations,
    provenance: clampProvenance(provenance),
    included: members.every(
      (member) => member.included || (publication !== undefined && excludedByKind(member)),
    ),
    tags,
    notes: clampText(notes.join('\n\n'), LIMITS.notes),
  };
}

/** Disjoint sets whose representative is always the smallest member index. */
class DisjointSets {
  readonly parent: Int32Array;
  constructor(size: number) {
    this.parent = Int32Array.from({ length: size }, (_, index) => index);
  }
  find(index: number): number {
    const parent = this.parent;
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  union(a: number, b: number): number {
    const left = this.find(a);
    const right = this.find(b);
    if (left === right) return -1;
    const [root, child] = left < right ? [left, right] : [right, left];
    this.parent[child] = root;
    return root;
  }
}

const MAX_ROUNDS = 12;
/** Above this many title/year/author combinations a set is matched member by member. */
const MAX_SET_ENTRIES = 5000;
/** Above this many spellings of one author key under one title, only identical spellings match. */
const MAX_SPELLINGS = 100;

function mergeOnce(works: Work[]): Work[] {
  const size = works.length;
  const rawDoi = works.map((work) => keepableDoiText(work.doi));
  const items: Work[] = works.map((original) => ({
    ...original,
    doi: normalizeDoi(original.doi),
    authors: [...original.authors],
    provenance: original.provenance.map((record) => ({ ...record })),
    tags: [...original.tags],
  }));
  const sets = new DisjointSets(size);
  /** The one DOI a set may carry, by representative. Two different DOIs never share a set. */
  const setDoi = items.map((item) => item.doi);
  const join = (a: number, b: number): boolean => {
    const left = sets.find(a);
    const right = sets.find(b);
    if (left === right || (setDoi[left] && setDoi[right] && setDoi[left] !== setDoi[right]))
      return false;
    const doi = setDoi[left] || setDoi[right];
    const root = sets.union(left, right);
    setDoi[root] = doi;
    return true;
  };

  const byDoi = new Map<string, number>();
  items.forEach((item, index) => {
    if (!item.doi) return;
    const seen = byDoi.get(item.doi);
    if (seen === undefined) byDoi.set(item.doi, index);
    else join(seen, index);
  });

  const providerKeys = items.map(uniqueProviderKeys);
  const titleTexts = items.map(titleText);
  const titleKeys = items.map(titleKey);
  const titleIds = new Map<string, number>();
  const authorKeyCache = new Map<number, Map<string, string[]>>();
  const memberAuthorKeys = (index: number) => {
    let keys = authorKeyCache.get(index);
    if (!keys) authorKeyCache.set(index, (keys = authorKeys(items[index].authors)));
    return keys;
  };

  /** Provider records shared by sets join them, unless that would put two DOIs in one set. */
  const mergeByProvider = (): boolean => {
    const component = new DisjointSets(size);
    const firstRoot = new Map<string, number>();
    for (let index = 0; index < size; index++) {
      const root = sets.find(index);
      for (const key of providerKeys[index]) {
        const seen = firstRoot.get(key);
        if (seen === undefined) firstRoot.set(key, root);
        else component.union(seen, root);
      }
    }
    const found = new Map<number, { roots: number[]; doi: string; conflict: boolean }>();
    for (let index = 0; index < size; index++) {
      if (sets.find(index) !== index) continue;
      const info = found.get(component.find(index)) ?? { roots: [], doi: '', conflict: false };
      info.roots.push(index);
      if (setDoi[index]) {
        if (!info.doi) info.doi = setDoi[index];
        else if (info.doi !== setDoi[index]) info.conflict = true;
      }
      found.set(component.find(index), info);
    }
    let changed = false;
    for (const { roots, conflict } of found.values())
      if (!conflict) for (const root of roots.slice(1)) changed = join(roots[0], root) || changed;
    return changed;
  };

  /**
   * Records with the same title and year and a shared author are one publication. A set without a
   * DOI joins the single DOI set it matches; matching two DOI sets is ambiguous and joins neither.
   * A set matches with every title, year and author of its members, so the outcome cannot depend
   * on which member happens to supply the merged record's metadata.
   */
  const mergeByTitle = (): boolean => {
    const buckets = new Map<string, number[]>();
    const combos = new Map<number, number[]>();
    const add = (key: string, authors: Iterable<string>, root: number) => {
      let id = titleIds.get(key);
      if (id === undefined) titleIds.set(key, (id = titleIds.size));
      let listed = false;
      for (const author of authors) {
        if (!listed) {
          listed = true;
          const owners = combos.get(id);
          if (!owners) combos.set(id, [root]);
          else if (owners[owners.length - 1] !== root) owners.push(root);
        }
        const bucket = `${id}\u0000${author}`;
        const list = buckets.get(bucket);
        if (!list) buckets.set(bucket, [root]);
        else if (list[list.length - 1] !== root) list.push(root);
      }
    };
    const total = new Int32Array(size);
    for (let index = 0; index < size; index++) total[sets.find(index)]++;
    const multi = new Map<number, number[]>();
    for (let index = 0; index < size; index++) {
      const root = sets.find(index);
      if (total[root] === 1) {
        if (titleKeys[index]) add(titleKeys[index], memberAuthorKeys(index).keys(), root);
      } else {
        const list = multi.get(root);
        if (list) list.push(index);
        else multi.set(root, [index]);
      }
    }
    for (const [root, list] of multi) {
      const texts = new Set<string>();
      const years = new Set<number>();
      for (const index of list) {
        if (titleTexts[index]) texts.add(titleTexts[index]);
        if (items[index].year !== null) years.add(items[index].year);
      }
      if (!texts.size || !years.size) continue;
      const names = new Set<string>();
      for (const index of list) for (const name of memberAuthorKeys(index).keys()) names.add(name);
      if (texts.size * years.size * names.size <= MAX_SET_ENTRIES) {
        for (const year of years) for (const text of texts) add(`${year}:${text}`, names, root);
      } else {
        for (const index of list)
          if (titleKeys[index]) add(titleKeys[index], memberAuthorKeys(index).keys(), root);
      }
    }
    /** The names of a set's members that have one author key. */
    const spellings = (root: number, key: string): string[] => {
      const members = multi.get(root);
      if (!members) return memberAuthorKeys(root).get(key) ?? [];
      const names = new Set<string>();
      for (const index of members)
        for (const name of memberAuthorKeys(index).get(key) ?? []) names.add(name);
      return [...names];
    };
    /**
     * An author key ("smith:j") only finds candidates: the sets that share it are split into groups
     * whose names really are one person ("John Smith" and "J Smith", not "Jane Smith").
     */
    const samePerson = (roots: number[], key: string): number[][] => {
      const owners = new Map<string, number[]>();
      roots.forEach((root, position) => {
        for (const name of spellings(root, key)) {
          const list = owners.get(name);
          if (list) list.push(position);
          else owners.set(name, [position]);
        }
      });
      const people = new DisjointSets(roots.length);
      for (const list of owners.values())
        for (const position of list) people.union(list[0], position);
      const names = [...owners.keys()];
      if (names.length <= MAX_SPELLINGS)
        for (let i = 0; i < names.length; i++)
          for (let j = i + 1; j < names.length; j++) {
            const a = owners.get(names[i])![0];
            const b = owners.get(names[j])![0];
            if (people.find(a) !== people.find(b) && nameMatch(names[i], names[j]) !== null)
              people.union(a, b);
          }
      const groups = new Map<number, number[]>();
      roots.forEach((root, position) => {
        const at = people.find(position);
        const group = groups.get(at);
        if (group) group.push(root);
        else groups.set(at, [root]);
      });
      return [...groups.values()];
    };
    const cluster = new DisjointSets(size);
    const together: Array<[number, number]> = [];
    const matches: Array<[number, number]> = [];
    for (const [bucket, candidates] of buckets) {
      if (candidates.length < 2) continue;
      for (const roots of samePerson(candidates, bucket.slice(bucket.indexOf('\u0000') + 1))) {
        let anchor = -1;
        const dois = new Set<number>();
        for (const root of roots) {
          if (setDoi[root]) dois.add(root);
          else if (anchor === -1) anchor = root;
          else if (cluster.union(anchor, root) !== -1) together.push([anchor, root]);
        }
        if (anchor !== -1) for (const doi of dois) matches.push([anchor, doi]);
      }
    }
    // Whether a set without a DOI could belong to several DOI groups is decided by title and year
    // alone, so the answer cannot change when its authors are merged into one list.
    const NONE = -2;
    const AMBIGUOUS = -1;
    const possible = new Int32Array(size).fill(NONE);
    for (const roots of combos.values()) {
      const dois = roots.filter((root) => setDoi[root]);
      const distinct = new Set(dois).size;
      if (!distinct) continue;
      for (const root of roots) {
        if (setDoi[root]) continue;
        if (distinct > 1 || (possible[root] !== NONE && possible[root] !== dois[0]))
          possible[root] = AMBIGUOUS;
        else possible[root] = dois[0];
      }
    }
    const clusterPossible = new Map<number, number>();
    for (let root = 0; root < size; root++) {
      if (possible[root] === NONE) continue;
      const at = cluster.find(root);
      const seen = clusterPossible.get(at);
      clusterPossible.set(
        at,
        seen === undefined || seen === possible[root] ? possible[root] : AMBIGUOUS,
      );
    }
    const target = new Map<number, number>();
    for (const [less, doi] of matches) {
      const at = cluster.find(less);
      const seen = target.get(at);
      if (seen === undefined) target.set(at, doi);
      else if (seen !== doi) target.set(at, AMBIGUOUS);
    }
    let changed = false;
    for (const [a, b] of together) changed = join(a, b) || changed;
    for (const [at, doi] of target)
      if (doi >= 0 && clusterPossible.get(at) === doi) changed = join(at, doi) || changed;
    return changed;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const byProvider = mergeByProvider();
    const byTitle = mergeByTitle();
    if (!byProvider && !byTitle) break;
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < size; index++) {
    const root = sets.find(index);
    const list = groups.get(root);
    if (list) list.push(index);
    else groups.set(root, [index]);
  }
  return [...groups.values()].map((list) => {
    const merged = list.length === 1 ? items[list[0]] : combineAll(list.map((i) => items[i]));
    // Text that is not a readable DOI is kept, but only when no member has a real DOI.
    if (!merged.doi) merged.doi = list.map((index) => rawDoi[index]).find(Boolean) ?? '';
    return merged;
  });
}

/**
 * DOI and provider identity first, then title + year + author overlap. Matching never bridges two
 * different DOIs and does not depend on the order of the input. A publication that matches two
 * different DOI groups is ambiguous and stays separate.
 */
export function mergeWorks(works: Work[]): Work[] {
  return mergeOnce(works);
}

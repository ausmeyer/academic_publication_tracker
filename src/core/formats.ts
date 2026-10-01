import type { Provenance, SourceId, Work } from '../types';
import { LIMITS, MAX_WORKSPACE_BYTES, clampText, clampWork } from './limits';
import { doiUrl, normalizeDoi } from './merge';
import { citationsForSource } from './metrics';
import { workKind, type WorkKind } from './worktype';

const MAX_BYTES = MAX_WORKSPACE_BYTES;
const MAX_WORKS = LIMITS.works;
const SOURCE_IDS = new Set<SourceId>([
  'scholar',
  'preprints',
  'datacite',
  'openalex',
  'crossref',
  'europepmc',
  'pubmed',
  'semantic',
  'arxiv',
]);
const CSV_COLUMNS = [
  'id',
  'title',
  'authors',
  'authorsComplete',
  'citationHistory',
  'year',
  'venue',
  'doi',
  'citations',
  'abstract',
  'snippet',
  'type',
  'url',
  'openAccessUrl',
  'isOpenAccess',
  'included',
  'tags',
  'notes',
  'provenance',
] as const;
const KNOWN_FIELDS = new Set<string>(CSV_COLUMNS);

function string(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value
        .replace(/\u0000/g, '')
        .slice(0, max)
        .trim()
    : '';
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** true/false, yes/no, y/n, 1/0 in any case with surrounding spaces; anything else is unknown. */
function flag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'no', 'n', '0'].includes(text)) return false;
  }
  return undefined;
}

function bool(value: unknown, fallback = false): boolean {
  return flag(value) ?? fallback;
}

const present = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== '';

// Separators carry no `\s*` padding: pieces are trimmed afterwards, so a long run of spaces is
// scanned once instead of once per position.
const AUTHOR_SEPARATOR = /[;|]|(?<=\s)and(?=\s)/i;
const TAG_SEPARATOR = /;/;
// Other tools separate keywords with commas; a semicolon anywhere means the commas belong to the keywords.
const KEYWORD_SEPARATOR = (text: string) => text.split(text.includes(';') ? ';' : ',');
const NAME_WORD = /^[\p{L}\p{M}.'’-]+$/u;
const INITIALS = /^(?:\p{Lu}\.?){1,3}$/u;

/**
 * "AG Meyer, J Smith, K Doe" and "Smith J., Doe A." are lists of people. "Smith, John" and
 * "García Márquez, Gabriel José" are one person, so only lists of three or more full names, or of
 * names written with initials, are taken apart.
 */
function commaList(text: string): string[] | null {
  const parts = text
    .split(/,|(?<=\s)and(?=\s)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const words = parts.map((part) => part.split(/\s+/));
  if (
    !words.every((w) => w.length >= 2 && w.length <= 5 && w.every((word) => NAME_WORD.test(word)))
  )
    return null;
  const initials = words.every((w) => INITIALS.test(w[0]) || INITIALS.test(w[w.length - 1]));
  return parts.length >= 3 || initials ? parts : null;
}

/** "et al.", "..." or "…" at the end of an author list: the list was cut short. */
const CUT_SHORT = /(?:\bet\.?\s+al\b\.?|\.{3}|…)\s*$/i;

function splitAuthors(text: string): string[] {
  const body = text.replace(CUT_SHORT, '');
  const list = body.includes(',') && !body.includes(';') ? commaList(body) : null;
  return list ?? body.split(AUTHOR_SEPARATOR);
}

function stringList(
  value: unknown,
  separator: RegExp | ((text: string) => string[]),
  max = 1000,
  textMax = 100_000,
): string[] {
  if (Array.isArray(value))
    return value
      .slice(0, max)
      .map((item) => string(item, LIMITS.authorName))
      .filter(Boolean);
  const text = string(value, textMax);
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return stringList(parsed, separator, max, textMax);
    } catch {
      /* Parse ordinary text below. */
    }
  }
  return text
    ? (typeof separator === 'function' ? separator(text) : text.split(separator))
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function safeUrl(value: unknown): string {
  try {
    const url = new URL(string(value, LIMITS.url));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function hash(value: string): string {
  let result = 2166136261;
  for (const letter of value) result = Math.imul(result ^ (letter.codePointAt(0) ?? 0), 16777619);
  return (result >>> 0).toString(36);
}

interface ImportStats {
  importedAt: string;
  lastYear: number;
  unknownIncluded: number;
  badYears: number;
  badDois: number;
  cutAuthors: number;
}

const readableDate = (text: string) => text !== '' && !Number.isNaN(Date.parse(text));

function validateWork(value: unknown, index: number, stats: ImportStats): Work {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Record ${index + 1} is not a publication object.`);
  const item = value as Record<string, unknown>;
  const title = string(item.title, LIMITS.title);
  if (!title) throw new Error(`Record ${index + 1} is missing a title.`);
  let cutShort = false;
  const authors = stringList(
    item.authors,
    (text) => {
      cutShort = CUT_SHORT.test(text);
      return splitAuthors(text);
    },
    LIMITS.authors + 1,
    1_000_000,
  );
  const year = integer(item.year);
  const validYear = year !== null && year >= 1500 && year <= stats.lastYear;
  if (present(item.year) && !validYear) stats.badYears++;
  let rawProvenance = item.provenance;
  if (typeof rawProvenance === 'string') {
    try {
      rawProvenance = JSON.parse(rawProvenance);
    } catch {
      rawProvenance = [];
    }
  }
  const provenance: Provenance[] = [];
  if (Array.isArray(rawProvenance)) {
    for (const raw of rawProvenance.slice(0, LIMITS.provenance)) {
      if (!raw || typeof raw !== 'object' || !SOURCE_IDS.has(raw.source)) continue;
      const retrievedAt = string(raw.retrievedAt, 100);
      provenance.push({
        source: raw.source,
        sourceId: string(raw.sourceId, LIMITS.sourceId),
        citations: integer(raw.citations),
        retrievedAt: readableDate(retrievedAt) ? retrievedAt : stats.importedAt,
        url: safeUrl(raw.url),
      });
    }
  }
  const rawDoi = string(item.doi, LIMITS.doi);
  const doi = normalizeDoi(rawDoi);
  if (rawDoi && !doi) stats.badDois++;
  let history = item.citationHistory;
  if (typeof history === 'string') {
    if (!history.trim()) history = undefined;
    else
      try {
        history = JSON.parse(history);
      } catch {
        throw new Error(`Record ${index + 1} has an unreadable citation history.`);
      }
  }
  const citationHistory: NonNullable<Work['citationHistory']> = [];
  if (history) {
    if (!Array.isArray(history) || history.length > LIMITS.citationHistory)
      throw new Error(`Record ${index + 1} has an invalid citation history.`);
    for (const raw of history) {
      const y = integer(raw?.year);
      const citations = integer(raw?.citations);
      if (y === null || y < 1000 || y > 3000 || citations === null || !SOURCE_IDS.has(raw?.source))
        throw new Error(`Record ${index + 1} has an invalid citation history.`);
      citationHistory.push({ year: y, citations, source: raw.source });
    }
  }
  const included = flag(item.included);
  if (included === undefined && present(item.included)) stats.unknownIncluded++;
  const complete = cutShort ? false : flag(item.authorsComplete);
  if (authors.length > LIMITS.authors) stats.cutAuthors++;
  return clampWork({
    id:
      string(item.id, LIMITS.id) ||
      `import-${hash(`${doi}|${title}|${year}|${authors.join(';')}`)}-${index}`,
    title,
    authors,
    ...(complete === undefined ? {} : { authorsComplete: complete }),
    ...(history ? { citationHistory } : {}),
    year: validYear ? year : null,
    venue: string(item.venue, LIMITS.venue),
    doi,
    abstract: string(item.abstract, LIMITS.abstract),
    ...(item.snippet ? { snippet: string(item.snippet, LIMITS.snippet) } : {}),
    type: string(item.type, LIMITS.type) || 'article',
    url: safeUrl(item.url) || (doi ? doiUrl(doi) : ''),
    openAccessUrl: safeUrl(item.openAccessUrl),
    isOpenAccess: bool(item.isOpenAccess),
    citations: integer(item.citations),
    provenance,
    included: included ?? true,
    tags: stringList(item.tags, TAG_SEPARATOR, LIMITS.tags),
    notes: string(item.notes, LIMITS.notes),
  });
}

const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/u;
/**
 * True when a spreadsheet could take the text for a formula, or when an importer would mistake its
 * own leading apostrophe for the guard. Such cells are written with one extra apostrophe, and the
 * importer removes exactly one from a cell that needs it, so every text round-trips.
 */
function guarded(text: string): boolean {
  let start = 0;
  while (text[start] === "'") start++;
  const rest = start ? text.slice(start) : text;
  return FORMULA_PREFIX.test(rest) || /^[\t\r]/.test(rest);
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (guarded(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Column names (lower case, letters and digits only) that other tools use for our fields. */
const ALIASES: Record<string, string> = {
  articletitle: 'title',
  ti: 'title',
  displayname: 'title',
  author: 'authors',
  au: 'authors',
  af: 'authors',
  authorshipsauthordisplayname: 'authors',
  authorscomplete: 'authorsComplete',
  citationhistory: 'citationHistory',
  publicationyear: 'year',
  pubyear: 'year',
  py: 'year',
  publication: 'venue',
  publicationtitle: 'venue',
  journal: 'venue',
  journaltitle: 'venue',
  source: 'venue',
  sourcetitle: 'venue',
  so: 'venue',
  primarylocationsourcedisplayname: 'venue',
  cites: 'citations',
  citationcount: 'citations',
  citedby: 'citations',
  citedbycount: 'citations',
  timescited: 'citations',
  tc: 'citations',
  abstractnote: 'abstract',
  ab: 'abstract',
  di: 'doi',
  articleurl: 'url',
  link: 'url',
  itemtype: 'type',
  documenttype: 'type',
  manualtags: 'tags',
  authorkeywords: 'tags',
  keywords: 'tags',
  de: 'tags',
  openaccessurl: 'openAccessUrl',
  isopenaccess: 'isOpenAccess',
};

/** Own-property lookup, so a column called "constructor" is never mistaken for an alias. */
const lookup = (table: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** A column name as the ALIASES key: lower case, letters and digits only. */
const columnKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Comma, semicolon or tab, read from the first record line (delimiters inside quotes do not count). */
function sniffDelimiter(text: string): string {
  let quoted = false;
  let content = false;
  let tabs = 0;
  let semicolons = 0;
  let commas = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      content = true;
    } else if (quoted) content = true;
    else if (char === '\n' || char === '\r') {
      if (content) break;
      tabs = semicolons = commas = 0;
    } else {
      if (char === '\t') tabs++;
      else if (char === ';') semicolons++;
      else if (char === ',') commas++;
      if (char > ' ') content = true;
    }
  }
  return tabs ? '\t' : semicolons > commas ? ';' : ',';
}

/**
 * True when the quote at `start` opens a cell that is quoted as a whole: `"…"` and the cell ends.
 * With `oneCell`, the quoted text also holds no tab or line break.
 */
function quotedCell(content: string, start: number, delimiter: string, oneCell = false): boolean {
  let close = content.indexOf('"', start + 1);
  while (close !== -1 && content[close + 1] === '"') close = content.indexOf('"', close + 2);
  if (close === -1) return false;
  if (oneCell && /[\t\r\n]/.test(content.slice(start + 1, close))) return false;
  for (let index = close + 1; index < content.length; index++) {
    const char = content[index];
    if (char === delimiter || char === '\n' || char === '\r') return true;
    if (!/\s/.test(char)) return false;
  }
  return true;
}

/**
 * Reads CSV or TSV text. `rows[i]` is the spreadsheet row that `records[i]` comes from: the text
 * starts at row 1, blank rows count, and a line break inside quotes stays in its row.
 */
export function parseCsvTable(
  content: string,
  delimiter: string,
  publication: boolean,
): { records: Record<string, unknown>[]; ignored: string[]; rows: number[] } {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let rowNumber = 1;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let webOfScience = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else field += char;
    } else if (char === '"') {
      // Tab-separated exports such as Web of Science do not quote their cells, so there a quote is
      // text unless it opens a cell that is quoted as a whole (in Web of Science, within the cell).
      if (
        delimiter === '\t' &&
        (field || closedQuote || !quotedCell(content, index, delimiter, webOfScience))
      )
        field += char;
      else if (field || closedQuote)
        throw new Error('Invalid CSV: a quote appears inside an unquoted field.');
      else quoted = true;
    } else if (char === delimiter || char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      closedQuote = false;
      if (char !== delimiter) {
        if (row.some((cell) => cell.trim())) {
          rows.push(row);
          rowNumbers.push(rowNumber);
        }
        rowNumber++;
        // Web of Science exports have PT, AU and TI columns.
        if (rows.length === 1) {
          const keys = rows[0].map(columnKey);
          webOfScience = ['pt', 'au', 'ti'].every((key) => keys.includes(key));
        }
        if (rows.length > (publication ? MAX_WORKS : 100000) + 1)
          throw new Error(`Import exceeds the ${publication ? MAX_WORKS : 100000} row limit.`);
        row = [];
        if (char === '\r' && content[index + 1] === '\n') index++;
      }
    } else {
      if (closedQuote && !/\s/.test(char))
        throw new Error('Invalid CSV: unexpected text after a quoted field.');
      if (!closedQuote) field += char;
    }
  }
  if (quoted) throw new Error('Invalid CSV: a quoted field was not closed.');
  row.push(field);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
    rowNumbers.push(rowNumber);
  }
  const label = delimiter === '\t' ? 'TSV' : 'CSV';
  const names = rows.shift() ?? [];
  rowNumbers.shift();
  const headers = names.map(columnKey);
  if (publication && !headers.some((header) => (lookup(ALIASES, header) ?? header) === 'title'))
    throw new Error(`${label} needs a Title column.`);
  // Web of Science calls Keywords Plus "ID": in its exports that column is not a record identifier.
  const targets = headers.map((header) =>
    !publication
      ? header
      : webOfScience && header === 'id'
        ? 'keywordsplus'
        : (lookup(ALIASES, header) ?? header),
  );
  const used = new Set<string>();
  const records = rows.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(
        `${label} row ${rowNumbers[index]} has ${cells.length} fields; expected ${headers.length}.`,
      );
    const result: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      if (!header || header === '__proto__' || header === 'constructor' || header === 'prototype')
        return;
      let cell = cells[column];
      if (cell.startsWith("'") && guarded(cell.slice(1))) cell = cell.slice(1);
      const target = targets[column];
      if (cell.trim()) used.add(target);
      // With several columns for one field (Journal and Source) the first filled one wins.
      if (!publication || !Object.hasOwn(result, target) || !String(result[target]).trim())
        result[target] = cell;
    });
    return result;
  });
  const ignored = publication
    ? [
        ...new Set(
          names
            .map((name, column) => [name.trim(), targets[column]] as const)
            .filter(([name, target]) => name && !KNOWN_FIELDS.has(target) && used.has(target))
            .map(([name]) => name),
        ),
      ]
    : [];
  return { records, ignored, rows: rowNumbers };
}

export function parseCsv(
  content: string,
  delimiter = ',',
  publication = true,
): Record<string, unknown>[] {
  return parseCsvTable(content, delimiter, publication).records;
}

function bibEscape(value: string): string {
  const replacements: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '&': '\\&',
    '%': '\\%',
    $: '\\$',
    '#': '\\#',
    _: '\\_',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  };
  return value.replace(/[\\{}&%$#_~^]/g, (char) => replacements[char]);
}

const TEX_ACCENTS: Record<string, string> = {
  "'": '\u{301}',
  '`': '\u{300}',
  '^': '\u{302}',
  '"': '\u{308}',
  '~': '\u{303}',
  '=': '\u{304}',
  '.': '\u{307}',
  c: '\u{327}',
  v: '\u{30c}',
  u: '\u{306}',
  H: '\u{30b}',
  k: '\u{328}',
  r: '\u{30a}',
  d: '\u{323}',
  b: '\u{331}',
};
const TEX_LETTERS: Record<string, string> = {
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  o: 'ø',
  O: 'Ø',
  l: 'ł',
  L: 'Ł',
  i: 'i',
  j: 'j',
};

/** Accents and letters that BibTeX writes as commands: \'e, \"o, \c{c}, {\o}, {\ss}, {\L}. */
function texToUnicode(value: string): string {
  if (!value.includes('\\')) return value;
  const accent = (match: string, mark: string, braced?: string, bare?: string) => {
    const letter = (braced ?? bare ?? '').replace(/^\\/, '');
    if (mark === '"' && !/^[aeiouyAEIOUY]$/.test(letter)) return match;
    return `${letter}${TEX_ACCENTS[mark]}`.normalize('NFC');
  };
  return value
    .replace(/\\(['`^"~=.])(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij](?![A-Za-z])|[A-Za-z]))/g, accent)
    .replace(/\\([cvuHkrdb])(?:\s*\{\s*(\\[ij]|[A-Za-z])\s*\}|\s+([A-Za-z]))/g, accent)
    .replace(
      /\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])(?:\{\})?/g,
      (_, name: string) => TEX_LETTERS[name],
    );
}

function bibUnescape(value: string): string {
  return texToUnicode(value)
    .replace(/\\textbackslash\{\}/g, '\u0001')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\([&%$#_{}])/g, (_, char: string) =>
      char === '{' ? '\u0002' : char === '}' ? '\u0003' : char,
    )
    .replace(/[{}]/g, '')
    .replace(/\u0001/g, '\\')
    .replace(/\u0002/g, '{')
    .replace(/\u0003/g, '}')
    .trim();
}

/** Names, titles and other single-line fields: a hard wrap (line break and indentation) is a space. */
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Free text: only a line break followed by indentation is a hard wrap; other breaks stay. */
function unwrapLines(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length === 1) return value;
  const text: string[] = [lines[0]];
  const joins: string[] = [];
  for (const line of lines.slice(1)) {
    if (/^[ \t]/.test(line)) {
      text[text.length - 1] = text[text.length - 1].trimEnd();
      text.push(line.trimStart());
      joins.push(' ');
    } else {
      text.push(line);
      joins.push('\n');
    }
  }
  return text[0] + joins.map((join, index) => join + text[index + 1]).join('');
}

function splitBibAuthors(value: string): { authors: string[]; others: boolean } {
  // A bare "~" is a tie (a non-breaking space) inside a name; "\~" is the tilde accent.
  value = value.replace(/(?<!\\)~/g, ' ');
  const authors: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++;
      continue;
    }
    if (value[i] === '{') depth++;
    if (value[i] === '}') depth--;
    if (depth === 0 && /\s/.test(value[i])) {
      // One scan over the whitespace run: " and " is a separator, anything else is not.
      let end = i;
      while (end < value.length && /\s/.test(value[end])) end++;
      if (
        value.slice(end, end + 3).toLowerCase() === 'and' &&
        end + 3 < value.length &&
        /\s/.test(value[end + 3])
      ) {
        let next = end + 3;
        while (next < value.length && /\s/.test(value[next])) next++;
        authors.push(oneLine(bibUnescape(value.slice(start, i))));
        start = next;
        i = next - 1;
      } else i = end - 1;
    }
  }
  authors.push(oneLine(bibUnescape(value.slice(start))));
  const others = authors.length > 0 && authors[authors.length - 1].toLowerCase() === 'others';
  return {
    authors: authors.filter((author, index) => author && !(others && index === authors.length - 1)),
    others,
  };
}

/** BibTeX entry types that are another entry type under a name this app recognises. */
const BIB_TYPES: Record<string, string> = { inbook: 'incollection' };

function parseBibtex(content: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let position = 0;
  const skip = () => {
    while (position < content.length) {
      if (/\s|,/.test(content[position])) position++;
      else if (content[position] === '%') {
        while (position < content.length && content[position] !== '\n') position++;
      } else break;
    }
  };
  const value = (): string => {
    skip();
    const opening = content[position];
    if (opening === '{' || opening === '"') {
      position++;
      let depth = opening === '{' ? 1 : 0;
      let result = '';
      while (position < content.length) {
        const char = content[position++];
        if (char === '\\') {
          result += char + (content[position++] ?? '');
          continue;
        }
        if (char === '{') depth++;
        if (char === '}') depth--;
        if ((opening === '{' && depth === 0) || (opening === '"' && char === '"' && depth === 0))
          return result;
        result += char;
      }
      throw new Error('Invalid BibTeX: a quoted or braced value was not closed.');
    }
    const start = position;
    while (position < content.length && !/[\s,})#]/.test(content[position])) position++;
    if (position === start) throw new Error('Invalid BibTeX field value.');
    return content.slice(start, position);
  };
  while (position < content.length) {
    skip();
    const at = content.indexOf('@', position);
    if (at === -1) break;
    position = at + 1;
    const type = /^[A-Za-z]+/.exec(content.slice(position))?.[0];
    if (!type) throw new Error('Invalid BibTeX entry type.');
    position += type.length;
    skip();
    const opening = content[position++];
    if (opening !== '{' && opening !== '(')
      throw new Error('Invalid BibTeX: expected an entry opening brace.');
    const closing = opening === '{' ? '}' : ')';
    if (['comment', 'preamble', 'string'].includes(type.toLowerCase())) {
      let depth = 1;
      while (position < content.length && depth) {
        const char = content[position++];
        if (char === '\\') position++;
        else if (char === opening) depth++;
        else if (char === closing) depth--;
      }
      if (depth) throw new Error('Invalid BibTeX: an entry was not closed.');
      continue;
    }
    const keyStart = position;
    while (position < content.length && content[position] !== ',' && content[position] !== closing)
      position++;
    if (content[position] !== ',')
      throw new Error('Invalid BibTeX: expected fields after the citation key.');
    const key = content.slice(keyStart, position++).trim();
    const fields: Record<string, string> = {};
    let entryClosed = false;
    while (position < content.length) {
      skip();
      if (content[position] === closing) {
        position++;
        entryClosed = true;
        break;
      }
      const field = /^[A-Za-z][A-Za-z0-9_-]*/.exec(content.slice(position))?.[0];
      if (!field) throw new Error('Invalid BibTeX field name.');
      position += field.length;
      skip();
      if (content[position++] !== '=')
        throw new Error('Invalid BibTeX: expected = after a field name.');
      let fieldValue = value();
      skip();
      while (content[position] === '#') {
        position++;
        fieldValue += value();
        skip();
      }
      fields[field.toLowerCase()] = fieldValue;
    }
    if (!entryClosed) throw new Error('Invalid BibTeX: an entry was not closed.');
    const decoded = (field: string) => bibUnescape(fields[field] ?? '');
    const line = (field: string) => oneLine(decoded(field));
    const { authors, others } = splitBibAuthors(fields.author ?? '');
    // howpublished often holds a link ({\url{https://…}}); that is an address, not a venue.
    const howpublished = /^\s*\\url\s*\{(.*)\}\s*$/s.exec(fields.howpublished ?? '');
    const kind = type.toLowerCase();
    records.push({
      id: `bib-${key || records.length}`,
      title: line('title'),
      authors,
      ...(others ? { authorsComplete: false } : {}),
      year: line('year') || line('date').slice(0, 4),
      venue:
        line('journal') ||
        line('journaltitle') ||
        line('booktitle') ||
        (howpublished ? '' : line('howpublished')) ||
        line('school') ||
        line('institution') ||
        line('publisher'),
      doi: line('doi'),
      url: line('url') || (howpublished ? bibUnescape(howpublished[1]) : ''),
      abstract: unwrapLines(decoded('abstract')),
      type: lookup(BIB_TYPES, kind) ?? kind,
      notes: unwrapLines(decoded('note')),
      tags: stringList(line('keywords'), KEYWORD_SEPARATOR),
      citations: decoded('citationcount'),
    });
    if (records.length > MAX_WORKS)
      throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
  }
  return records;
}

/** RIS reference types, as the (provider-style) type names this app understands. */
const RIS_TYPES: Record<string, string> = {
  JOUR: 'article',
  JFULL: 'article',
  EJOUR: 'article',
  MGZN: 'article',
  CONF: 'proceedings-article',
  CPAPER: 'proceedings-article',
  CHAP: 'book-chapter',
  ECHAP: 'book-chapter',
  BOOK: 'book',
  EBOOK: 'book',
  EDBOOK: 'book',
  THES: 'thesis',
  RPRT: 'report',
  DATA: 'dataset',
  COMP: 'software',
  GEN: 'misc',
};

function parseRis(content: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let fields: Record<string, string[]> | null = null;
  let lastTag = '';
  const finish = () => {
    if (!fields) return;
    const first = (...tags: string[]) => tags.map((tag) => fields?.[tag]?.[0]).find(Boolean) ?? '';
    records.push({
      title: first('TI', 'T1', 'CT'),
      authors: fields.AU ?? fields.A1 ?? [],
      year: first('PY', 'Y1', 'DA').slice(0, 4),
      venue: first('JO', 'JF', 'T2', 'JA', 'PB'),
      doi: first('DO'),
      url: first('UR'),
      abstract: first('AB', 'N2'),
      type: lookup(RIS_TYPES, first('TY').toUpperCase()) ?? first('TY').toLowerCase(),
      tags: fields.KW ?? [],
      notes: (fields.N1 ?? []).join('\n'),
    });
    fields = null;
    if (records.length > MAX_WORKS)
      throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
  };
  for (const line of content.split(/\r?\n|\r/)) {
    const match = /^([A-Z0-9]{2})\s{2}-\s?(.*)$/.exec(line);
    if (match) {
      const [, tag, text] = match;
      if (tag === 'TY') {
        if (fields)
          throw new Error('Invalid RIS: each record must end with ER before the next TY.');
        fields = {};
      }
      if (tag === 'ER') {
        finish();
        lastTag = '';
        continue;
      }
      if (!fields) throw new Error('Invalid RIS: each record must start with TY.');
      (fields[tag] ??= []).push(text);
      lastTag = tag;
    } else if (line.trim() && fields && lastTag) {
      const values = fields[lastTag];
      values[values.length - 1] += `\n${line.trim()}`;
    } else if (line.trim()) throw new Error('Invalid RIS record.');
  }
  if (fields) throw new Error('Invalid RIS: the final record is missing ER.');
  return records;
}

export interface ImportReport {
  works: Work[];
  /** Columns (or JSON fields) that held data but are not used by this app. */
  ignoredColumns: string[];
  /** Plain-language notes about values that were repaired or could not be read. */
  warnings: string[];
}

const records = (count: number, rest: string) => `${count} record${count === 1 ? '' : 's'} ${rest}`;

export function importWorksWithReport(content: string, filename: string): ImportReport {
  if (new TextEncoder().encode(content).length > MAX_BYTES)
    throw new Error('Import files must be 25 MB or smaller.');
  const body = content.replace(/^\u{feff}/u, '');
  if (!/\S/.test(body)) throw new Error('The import file is empty.');
  // Only the BOM and the final line break are dropped: a trailing or leading tab is an empty cell.
  let end = body.length;
  while (end > 0 && (body[end - 1] === '\n' || body[end - 1] === '\r')) end--;
  const text = body.slice(0, end);
  const start = text.search(/\S/);
  const head = start > 0 ? text.slice(start) : text;
  const extension = filename.split('.').at(-1)?.toLowerCase();
  let parsed: unknown;
  let ignoredColumns: string[] = [];
  if (extension === 'json' || /^[\[{]/.test(head)) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON.');
    }
    if (!Array.isArray(parsed))
      throw new Error(
        'Publication JSON must contain an array of works. To restore a workspace backup, use Import and choose the backup file.',
      );
    const unknown = new Set<string>();
    for (const record of parsed)
      if (record && typeof record === 'object' && !Array.isArray(record))
        for (const key of Object.keys(record))
          if (!KNOWN_FIELDS.has(key) && present((record as Record<string, unknown>)[key]))
            unknown.add(key);
    ignoredColumns = [...unknown].slice(0, 50);
  } else if (extension === 'ris' || /^TY\s{2}-/.test(head)) parsed = parseRis(text);
  else if (extension === 'bib' || extension === 'bibtex' || head.startsWith('@'))
    parsed = parseBibtex(text);
  else {
    // Dimensions writes one line ("About the data: …") above the header row of its exports. Its
    // line breaks stay, so the rows below keep their spreadsheet numbers.
    const csv = text.replace(/^\s*"?About the data[^\r\n]*[\r\n]+/i, (line) =>
      line.replace(/[^\r\n]/g, ''),
    );
    const table = parseCsvTable(csv, extension === 'tsv' ? '\t' : sniffDelimiter(csv), true);
    parsed = table.records;
    ignoredColumns = table.ignored;
  }
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error('No publications were found in the file.');
  if (parsed.length > MAX_WORKS)
    throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
  const stats: ImportStats = {
    importedAt: new Date().toISOString(),
    lastYear: new Date().getFullYear() + 1,
    unknownIncluded: 0,
    badYears: 0,
    badDois: 0,
    cutAuthors: 0,
  };
  const works = parsed.map((record, index) => validateWork(record, index, stats));
  const ids = new Set<string>();
  works.forEach((work, index) => {
    const base = clampText(work.id, LIMITS.id - 40);
    let suffix = index;
    while (ids.has(work.id)) work.id = `${base}-${suffix++}-${hash(work.title)}`;
    ids.add(work.id);
  });
  const warnings: string[] = [];
  if (stats.unknownIncluded)
    warnings.push(
      `${records(stats.unknownIncluded, 'had an Included value that is not true/false or yes/no and stayed included.')}`,
    );
  if (stats.badYears)
    warnings.push(
      `${records(stats.badYears, `had a publication year that could not be read or is outside 1500-${stats.lastYear}; it was imported without a year.`)}`,
    );
  if (stats.badDois)
    warnings.push(`${records(stats.badDois, 'had a DOI that could not be read and was ignored.')}`);
  if (stats.cutAuthors)
    warnings.push(
      `${records(stats.cutAuthors, `had more than ${LIMITS.authors.toLocaleString()} authors; the list was cut and marked incomplete.`)}`,
    );
  return { works, ignoredColumns, warnings };
}

/** Imports publications from CSV, TSV, JSON, BibTeX or RIS text. See importWorksWithReport for notes. */
export function importWorks(content: string, filename: string): Work[] {
  return importWorksWithReport(content, filename).works;
}

/** "A; B; C", or a JSON list when the importer would not read that text back as the same authors. */
function authorCell(authors: string[]): string {
  const text = authors.join('; ');
  const back = stringList(text, splitAuthors, LIMITS.authors + 1, 1_000_000);
  return back.length === authors.length && back.every((author, i) => author === authors[i])
    ? text
    : JSON.stringify(authors);
}

/** BibTeX entry type and the field that carries the venue, by kind of work. */
const BIB_ENTRIES: Partial<Record<WorkKind, { entry: string; venue: string }>> = {
  article: { entry: 'article', venue: 'journal' },
  review: { entry: 'article', venue: 'journal' },
  editorial: { entry: 'article', venue: 'journal' },
  notice: { entry: 'article', venue: 'journal' },
  conference: { entry: 'inproceedings', venue: 'booktitle' },
  chapter: { entry: 'incollection', venue: 'booktitle' },
  book: { entry: 'book', venue: 'publisher' },
  thesis: { entry: 'phdthesis', venue: 'school' },
  report: { entry: 'techreport', venue: 'institution' },
};
function bibType(work: Work): { entry: string; venue: string } {
  const kind = workKind(work.type);
  const bib = BIB_ENTRIES[kind] ?? { entry: 'misc', venue: 'howpublished' };
  return kind === 'thesis' && /master/i.test(work.type) ? { ...bib, entry: 'mastersthesis' } : bib;
}

/** RIS reference type and the tag that carries the venue, by kind of work. */
const RIS_ENTRIES: Partial<Record<WorkKind, { type: string; venue: string }>> = {
  article: { type: 'JOUR', venue: 'JO' },
  review: { type: 'JOUR', venue: 'JO' },
  editorial: { type: 'JOUR', venue: 'JO' },
  notice: { type: 'JOUR', venue: 'JO' },
  conference: { type: 'CONF', venue: 'T2' },
  chapter: { type: 'CHAP', venue: 'T2' },
  book: { type: 'BOOK', venue: 'PB' },
  thesis: { type: 'THES', venue: 'PB' },
  report: { type: 'RPRT', venue: 'PB' },
};
const risType = (work: Work) => RIS_ENTRIES[workKind(work.type)] ?? { type: 'GEN', venue: 'T2' };

export function exportWorks(works: Work[], format: 'csv' | 'bibtex' | 'ris' | 'json'): string {
  works = works.map((work) => ({ ...work, citations: citationsForSource(work) }));
  if (format === 'json') return JSON.stringify(works, null, 2);
  if (format === 'csv')
    return (
      '\uFEFF' +
      [
        CSV_COLUMNS.join(','),
        ...works.map((work) =>
          CSV_COLUMNS.map((column) => {
            const value =
              column === 'authors'
                ? authorCell(work.authors)
                : column === 'tags' || column === 'provenance' || column === 'citationHistory'
                  ? JSON.stringify(work[column])
                  : work[column];
            return csvCell(value);
          }).join(','),
        ),
      ].join('\r\n')
    );
  if (format === 'bibtex') {
    const keys = new Set<string>();
    return (
      works
        .map((work) => {
          const author =
            (work.authors[0]?.split(',')[0].split(/\s+/).at(-1) ?? 'work')
              .normalize('NFKD')
              .replace(/[^A-Za-z0-9]/g, '') || 'work';
          const base = `${author}${work.year ?? 'nd'}_${hash(work.doi || work.id || work.title)}`;
          let key = base;
          let suffix = 2;
          while (keys.has(key)) key = `${base}_${suffix++}`;
          keys.add(key);
          const bib = bibType(work);
          const fields: [string, string][] = [
            ['title', work.title],
            [
              'author',
              work.authors
                .map((author) => {
                  const escaped = bibEscape(author);
                  return /\s+and\s+/i.test(author) ? `{${escaped}}` : escaped;
                })
                .join(' and '),
            ],
            ['year', work.year?.toString() ?? ''],
            [bib.venue, work.venue],
            ['doi', work.doi],
            ['url', work.url],
            ['abstract', work.abstract],
            // A tag with a comma needs the semicolon (even alone) so it reads back as one keyword.
            [
              'keywords',
              work.tags.join('; ') + (work.tags.some((tag) => tag.includes(',')) ? ';' : ''),
            ],
            [
              'note',
              [work.notes, work.snippet ? `Search snippet: ${work.snippet}` : '']
                .filter(Boolean)
                .join('\n'),
            ],
          ];
          return `@${bib.entry}{${key},\n${fields
            .filter(([, text]) => text)
            .map(([field, text]) => `  ${field} = {${field === 'author' ? text : bibEscape(text)}}`)
            .join(',\n')}\n}`;
        })
        .join('\n\n') + '\n'
    );
  }
  return works
    .map((work) => {
      // Newlines cannot introduce executable RIS tags inside imported metadata.
      const line = (tag: string, value: string) =>
        value ? `${tag}  - ${value.replace(/[\r\n]+/g, ' ')}\r\n` : '';
      const ris = risType(work);
      return (
        line('TY', ris.type) +
        line('TI', work.title) +
        work.authors.map((author) => line('AU', author)).join('') +
        line('PY', work.year?.toString() ?? '') +
        line(ris.venue, work.venue) +
        line('DO', work.doi) +
        line('UR', work.url) +
        line('AB', work.abstract) +
        work.tags.map((tag) => line('KW', tag)).join('') +
        line('N1', work.notes) +
        line('N1', work.snippet ? `Search snippet: ${work.snippet}` : '') +
        'ER  - \r\n'
      );
    })
    .join('\r\n');
}

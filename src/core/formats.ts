import type { Provenance, SourceId, Work } from '../types';
import { normalizeDoi } from './merge';
import { citationsForSource } from './metrics';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_WORKS = 20_000;
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

function string(value: unknown, max = 100_000): string {
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

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || (typeof value === 'string' && value.toLowerCase() === 'true'))
    return true;
  if (
    value === 0 ||
    value === '0' ||
    (typeof value === 'string' && value.toLowerCase() === 'false')
  )
    return false;
  return fallback;
}

function stringList(value: unknown, separator: RegExp): string[] {
  if (Array.isArray(value))
    return value
      .slice(0, 1000)
      .map((item) => string(item, 1000))
      .filter(Boolean);
  const text = string(value);
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return stringList(parsed, separator);
    } catch {
      /* Parse ordinary text below. */
    }
  }
  return text
    ? text
        .split(separator)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 1000)
    : [];
}

function safeUrl(value: unknown): string {
  try {
    const url = new URL(string(value, 4000));
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

function validateWork(value: unknown, index: number): Work {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Record ${index + 1} is not a publication object.`);
  const item = value as Record<string, unknown>;
  const title = string(item.title, 10_000);
  if (!title) throw new Error(`Record ${index + 1} is missing a title.`);
  const authors = stringList(item.authors, /\s*;\s*|\s+and\s+/i);
  const year = integer(item.year);
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
    for (const raw of rawProvenance.slice(0, 100)) {
      if (!raw || typeof raw !== 'object' || !SOURCE_IDS.has(raw.source)) continue;
      provenance.push({
        source: raw.source,
        sourceId: string(raw.sourceId, 1000),
        citations: integer(raw.citations),
        retrievedAt: string(raw.retrievedAt, 100),
        url: safeUrl(raw.url),
      });
    }
  }
  const doi = normalizeDoi(string(item.doi, 2000));
  return {
    id:
      string(item.id, 1000) ||
      `import-${hash(`${doi}|${title}|${year}|${authors.join(';')}`)}-${index}`,
    title,
    authors,
    year: year !== null && year >= 1000 && year <= 3000 ? year : null,
    venue: string(item.venue, 10_000),
    doi,
    abstract: string(item.abstract),
    ...(item.snippet ? { snippet: string(item.snippet, 10000) } : {}),
    type: string(item.type, 100) || 'article',
    url: safeUrl(item.url) || (doi ? `https://doi.org/${doi}` : ''),
    openAccessUrl: safeUrl(item.openAccessUrl),
    isOpenAccess: bool(item.isOpenAccess),
    citations: integer(item.citations),
    provenance,
    included: bool(item.included, true),
    tags: stringList(item.tags, /\s*;\s*/).slice(0, 100),
    notes: string(item.notes),
  };
}

const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/u;
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_PREFIX.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseCsv(content: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
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
      if (field || closedQuote)
        throw new Error('Invalid CSV: a quote appears inside an unquoted field.');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      closedQuote = false;
      if (char !== ',') {
        if (row.some((cell) => cell.trim())) rows.push(row);
        if (rows.length > MAX_WORKS + 1)
          throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
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
  if (row.some((cell) => cell.trim())) rows.push(row);
  const headers =
    rows.shift()?.map((header) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    ) ?? [];
  if (!headers.includes('title') && !headers.includes('articletitle'))
    throw new Error('CSV needs a Title column.');
  const aliases: Record<string, string> = {
    articletitle: 'title',
    author: 'authors',
    publicationyear: 'year',
    publication: 'venue',
    journal: 'venue',
    journaltitle: 'venue',
    source: 'venue',
    cites: 'citations',
    citationcount: 'citations',
    openaccessurl: 'openAccessUrl',
    isopenaccess: 'isOpenAccess',
  };
  return rows.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} fields; expected ${headers.length}.`,
      );
    const result: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      if (!header || header === '__proto__' || header === 'constructor' || header === 'prototype')
        return;
      let cell = cells[column];
      if (
        cell.startsWith("'") &&
        (FORMULA_PREFIX.test(cell.slice(1)) || /^[\t\r]/.test(cell.slice(1)))
      )
        cell = cell.slice(1);
      result[aliases[header] ?? header] = cell;
    });
    return result;
  });
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

function bibUnescape(value: string): string {
  return value
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

function splitBibAuthors(value: string): string[] {
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
    const match = depth === 0 ? /^\s+and\s+/i.exec(value.slice(i)) : null;
    if (match) {
      authors.push(bibUnescape(value.slice(start, i)));
      i += match[0].length - 1;
      start = i + 1;
    }
  }
  authors.push(bibUnescape(value.slice(start)));
  return authors.filter(Boolean);
}

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
    records.push({
      id: `bib-${key || records.length}`,
      title: decoded('title'),
      authors: splitBibAuthors(fields.author ?? ''),
      year: decoded('year') || decoded('date').slice(0, 4),
      venue: decoded('journal') || decoded('booktitle'),
      doi: decoded('doi'),
      url: decoded('url'),
      abstract: decoded('abstract'),
      type: type.toLowerCase(),
      notes: decoded('note'),
      tags: stringList(decoded('keywords'), /\s*[,;]\s*/),
      citations: decoded('citationcount'),
    });
    if (records.length > MAX_WORKS)
      throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
  }
  return records;
}

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
      venue: first('JO', 'JF', 'T2', 'JA'),
      doi: first('DO'),
      url: first('UR'),
      abstract: first('AB', 'N2'),
      type: first('TY').toUpperCase() === 'JOUR' ? 'article' : first('TY').toLowerCase(),
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

export function importWorks(content: string, filename: string): Work[] {
  if (new TextEncoder().encode(content).length > MAX_BYTES)
    throw new Error('Import files must be 25 MB or smaller.');
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('The import file is empty.');
  const extension = filename.split('.').at(-1)?.toLowerCase();
  let records: unknown;
  if (extension === 'json' || /^[\[{]/.test(text)) {
    try {
      records = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON.');
    }
    if (!Array.isArray(records))
      throw new Error(
        'Publication JSON must contain an array of works. Use Restore backup for a workspace backup.',
      );
  } else if (extension === 'ris' || /^TY\s{2}-/.test(text)) records = parseRis(text);
  else if (extension === 'bib' || extension === 'bibtex' || text.startsWith('@'))
    records = parseBibtex(text);
  else records = parseCsv(text);
  if (!Array.isArray(records) || !records.length)
    throw new Error('No publications were found in the file.');
  if (records.length > MAX_WORKS)
    throw new Error(`Import is limited to ${MAX_WORKS.toLocaleString()} publications.`);
  const works = records.map(validateWork);
  const ids = new Set<string>();
  works.forEach((work, index) => {
    const base = work.id;
    let suffix = index;
    while (ids.has(work.id)) work.id = `${base}-${suffix++}-${hash(work.title)}`;
    ids.add(work.id);
  });
  return works;
}

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
                ? work.authors.some((author) => /;|\s+and\s+/i.test(author))
                  ? JSON.stringify(work.authors)
                  : work.authors.join('; ')
                : column === 'tags' || column === 'provenance'
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
            ['journal', work.venue],
            ['doi', work.doi],
            ['url', work.url],
            ['abstract', work.abstract],
            ['keywords', work.tags.join('; ')],
            [
              'note',
              [work.notes, work.snippet ? `Search snippet: ${work.snippet}` : '']
                .filter(Boolean)
                .join('\n'),
            ],
          ];
          const type = [
            'article',
            'book',
            'inproceedings',
            'incollection',
            'phdthesis',
            'mastersthesis',
            'techreport',
            'misc',
          ].includes(work.type)
            ? work.type
            : 'misc';
          return `@${type}{${key},\n${fields
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
      return (
        line('TY', work.type === 'article' ? 'JOUR' : work.type === 'book' ? 'BOOK' : 'GEN') +
        line('TI', work.title) +
        work.authors.map((author) => line('AU', author)).join('') +
        line('PY', work.year?.toString() ?? '') +
        line('JO', work.venue) +
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

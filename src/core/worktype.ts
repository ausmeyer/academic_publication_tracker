import { LIMITS, clampText } from './limits.ts';

/**
 * Providers describe document types in incompatible vocabularies ("journal-article",
 * "research-article", "Journal Article, Research Support, N.I.H., Extramural", "JournalArticle").
 * `workKind` maps any of them to one small set, without changing the stored type string.
 */
export type WorkKind =
  | 'article'
  | 'review'
  | 'preprint'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'thesis'
  | 'report'
  | 'dataset'
  | 'software'
  | 'editorial'
  | 'notice'
  | 'peer-review'
  | 'grant'
  | 'issue'
  | 'component'
  | 'other';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const oneOf =
  (...names: string[]) =>
  (token: string) =>
    names.includes(token);

// First matching rule wins, so a comma-joined list such as "Journal Article, Preprint" is a preprint.
const RULES: Array<[WorkKind, (token: string) => boolean]> = [
  [
    'notice',
    (token) =>
      /erratum|^retraction(ofpublication|notice)?$|expressionofconcern|^correction$|^withdrawn|^withdrawal$|^paratext$/.test(
        token,
      ),
  ],
  ['peer-review', oneOf('peerreview')],
  ['grant', oneOf('grant')],
  [
    'issue',
    oneOf(
      'journal',
      'journalissue',
      'journalvolume',
      'proceedings',
      'proceedingsseries',
      'bookseries',
      'bookset',
      'reportseries',
      'standardseries',
    ),
  ],
  ['component', oneOf('component', 'supplementarymaterials')],
  ['preprint', (token) => token.includes('preprint') || token === 'postedcontent'],
  ['thesis', oneOf('dissertation', 'thesis', 'phdthesis', 'mastersthesis')],
  ['dataset', oneOf('dataset', 'database')],
  ['software', oneOf('software')],
  ['report', oneOf('report', 'techreport')],
  ['book', oneOf('book', 'monograph', 'editedbook', 'referencebook')],
  [
    'chapter',
    oneOf('bookchapter', 'bookpart', 'booksection', 'referenceentry', 'chapter', 'incollection'),
  ],
  [
    'conference',
    oneOf(
      'proceedingsarticle',
      'conferencepaper',
      'conference',
      'conferenceproceeding',
      'inproceedings',
      'congress',
    ),
  ],
  ['review', oneOf('review', 'reviewarticle', 'systematicreview', 'metaanalysis')],
  ['editorial', oneOf('editorial', 'comment', 'letter', 'news', 'lettersandcomments')],
  [
    'article',
    (token) =>
      token.includes('article') ||
      token.endsWith('study') ||
      token.endsWith('trial') ||
      oneOf('publication', 'casereport', 'casereports', 'briefreport', 'jour')(token),
  ],
];

export function workKind(type: string): WorkKind {
  const tokens = type.split(',').map(normalize).filter(Boolean);
  for (const [kind, matches] of RULES) if (tokens.some(matches)) return kind;
  return 'other';
}

/** False for records that describe something other than a publication (issues, reviews, notices…). */
export function isPublicationKind(kind: WorkKind): boolean {
  return !['notice', 'peer-review', 'grant', 'issue', 'component'].includes(kind);
}

const LABELS: Record<WorkKind, string> = {
  article: 'Article',
  review: 'Review',
  preprint: 'Preprint',
  conference: 'Conference paper',
  book: 'Book',
  chapter: 'Book chapter',
  thesis: 'Thesis',
  report: 'Report',
  dataset: 'Dataset',
  software: 'Software',
  editorial: 'Editorial or letter',
  notice: 'Notice',
  'peer-review': 'Peer review',
  grant: 'Grant',
  issue: 'Journal issue',
  component: 'Component',
  other: 'Other',
};
export const workKindLabel = (kind: WorkKind): string => LABELS[kind];

/** Crossref `type` values that are publications; requested for topic and author searches. */
export const CROSSREF_PUBLICATION_TYPES = [
  'journal-article',
  'proceedings-article',
  'book',
  'book-chapter',
  'book-part',
  'book-section',
  'monograph',
  'edited-book',
  'reference-book',
  'reference-entry',
  'report',
  'posted-content',
  'dissertation',
  'dataset',
];

/**
 * Joins the publication types of a PubMed / Europe PMC record into one short string. Funding tags
 * ("Research Support, N.I.H., Extramural") say nothing about the document and are dropped; the
 * types that classify the record (preprint, erratum, review …) are kept first when space runs out.
 */
export function cleanPublicationTypes(types: string[], max: number = LIMITS.type): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of types) {
    const type = raw.replace(/\s+/g, ' ').trim();
    const key = type.toLowerCase();
    if (!type || /^research support\b/.test(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(type);
  }
  const informative = (type: string) => !['article', 'other'].includes(workKind(type));
  const ordered = [...kept.filter(informative), ...kept.filter((type) => !informative(type))];
  let joined = '';
  for (const type of ordered) {
    const next = joined ? `${joined}, ${type}` : type;
    if (next.length > max) break;
    joined = next;
  }
  return joined || (ordered.length ? clampText(ordered[0], max) : '');
}

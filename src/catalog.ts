import type { Settings, SourceInfo, SourceId } from './types';
export const SOURCES: SourceInfo[] = [
  {
    id: 'scholar',
    name: 'Google Scholar',
    description:
      'Collect Scholar results and citation counts inside the desktop app, with verification when needed.',
    access: 'Free · internal desktop search',
    url: 'https://scholar.google.com/',
    citationSupport: true,
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    description: 'A broad, open catalog of scholarly works and citations.',
    access: 'Public · optional free key',
    url: 'https://openalex.org/',
    citationSupport: true,
  },
  {
    id: 'crossref',
    name: 'Crossref',
    description: 'Publisher-deposited metadata, DOIs, and citation counts.',
    access: 'Public · no key needed',
    url: 'https://www.crossref.org/',
    citationSupport: true,
  },
  {
    id: 'europepmc',
    name: 'Europe PMC',
    description: 'Life sciences literature, preprints, and open full text.',
    access: 'Public · no key needed',
    url: 'https://europepmc.org/',
    citationSupport: true,
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    description: 'Biomedical and health research from the NLM.',
    access: 'Public · optional free key',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    citationSupport: false,
  },
  {
    id: 'semantic',
    name: 'Semantic Scholar',
    description: 'Research discovery across disciplines and citation data.',
    access: 'Public · key recommended',
    url: 'https://www.semanticscholar.org/product/api',
    citationSupport: true,
  },
  {
    id: 'preprints',
    name: 'Preprints',
    description:
      'Search arXiv, bioRxiv, medRxiv, and other indexed preprint repositories together. Coverage varies by index.',
    access: 'Public · no key needed',
    url: 'https://europepmc.org/help',
    citationSupport: true,
  },
  {
    id: 'datacite',
    name: 'DataCite',
    description:
      'Discover datasets, software, preprints, and other research outputs with DOIs and reported citation relationships.',
    access: 'Public · no key needed',
    url: 'https://commons.datacite.org/',
    citationSupport: true,
  },
];
export const EMPTY_SETTINGS: Settings = {
  email: '',
  openalexApiKey: '',
  semanticApiKey: '',
  ncbiApiKey: '',
};
export const sourceName = (id: string) =>
  SOURCES.find((s) => s.id === id)?.name ?? (id === 'arxiv' ? 'arXiv' : id);
export const sourceMark = (id: SourceId) =>
  ({
    scholar: 'G',
    openalex: 'O',
    crossref: 'C',
    europepmc: 'E',
    pubmed: 'P',
    semantic: 'S',
    arxiv: 'a',
    preprints: 'Rx',
    datacite: 'D',
  })[id];
export const formatNumber = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

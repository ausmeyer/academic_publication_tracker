import { describe, expect, it } from 'vitest';
import type { Work, Workspace } from '../src/types';
import { importWorks, importWorksWithReport } from '../src/core/formats';
import { validateWorkspace } from '../src/core/workspace';

const workspaceOf = (works: Work[]): Workspace => ({
  version: 2,
  activeId: null,
  snapshots: [
    {
      id: 's',
      name: 'Imported',
      query: { text: 'import', mode: 'topic', sources: [], limit: 10 },
      works,
      searchedAt: '2026-09-30T00:00:00Z',
      sourceResults: [],
    },
  ],
});
const thisYear = new Date().getFullYear();

describe('P2-01 tab- and comma-separated files keep empty edge cells', () => {
  it('imports a last row that ends in an empty cell', () => {
    for (const content of [
      'Title\tYear\tNotes\nA\t2020\tx\nB\t2021\t\n',
      'Title\tYear\tNotes\r\nA\t2020\tx\r\nB\t2021\t\r\n',
      'Title\tYear\tNotes\nA\t2020\tx\nB\t2021\t',
    ]) {
      const works = importWorks(content, 'papers.tsv');
      expect(works.map((w) => [w.title, w.year, w.notes])).toEqual([
        ['A', 2020, 'x'],
        ['B', 2021, ''],
      ]);
    }
    expect(importWorks('Title\tYear\tNotes\nA\t2020\t\n', 'x.tsv')[0].notes).toBe('');
  });

  it('imports a spreadsheet export whose header starts with an empty cell', () => {
    const works = importWorks('\tTitle\tYear\n1\tA paper\t2020\n2\tAnother paper\t2021\n', 'x.tsv');
    expect(works.map((w) => w.title)).toEqual(['A paper', 'Another paper']);
    expect(works[1].year).toBe(2021);
    const comma = importWorks(',Title,Year\n1,A paper,2020\n', 'x.csv');
    expect(comma[0].title).toBe('A paper');
  });

  it('reports a missing title instead of a confusing field count', () => {
    expect(() => importWorks('Year\tTitle\n2020\tA\n2021\t\n', 'x.tsv')).toThrow('missing a title');
  });

  it('says TSV for tab-separated files and CSV for the rest', () => {
    expect(() => importWorks('Title\tYear\nA\t2020\textra\n', 'x.tsv')).toThrow(
      'TSV row 2 has 3 fields; expected 2.',
    );
    expect(() => importWorks('Title,Year\nA,2020,extra\n', 'x.csv')).toThrow(
      'CSV row 2 has 3 fields; expected 2.',
    );
  });

  it('still detects JSON, BibTeX and RIS behind leading blank lines', () => {
    expect(importWorks('\n\n  [{"title":"A"}]\n', 'x.txt')).toHaveLength(1);
    expect(importWorks('\n\n@article{a, title={A}}\n', 'x.txt')).toHaveLength(1);
    expect(importWorks('\n\nTY  - JOUR\nTI  - A\nER  -\n', 'x.txt')).toHaveLength(1);
    expect(() => importWorks('  \n\t\n', 'x.csv')).toThrow('empty');
  });
});

describe('P2-03 yes/no values are read the way people write them', () => {
  const read = (column: string, value: string) =>
    importWorks(`Title,${column}\r\n"A paper with a flag","${value}"\r\n`, 'x.csv')[0];

  it.each([' false', 'false ', 'FALSE', 'False', 'no', 'No', 'N', 'n', '0', ' 0 '])(
    'reads %j in Included as excluded',
    (value) => expect(read('Included', value).included).toBe(false),
  );
  it.each(['true', ' true', 'TRUE', 'yes', 'Yes', 'Y', 'y', '1', ' 1'])(
    'reads %j in Included as included',
    (value) => expect(read('Included', value).included).toBe(true),
  );
  it.each([' true', 'Yes', 'Y', '1'])('reads %j in Is Open Access as open', (value) =>
    expect(read('Is Open Access', value).isOpenAccess).toBe(true),
  );
  it.each(['false ', 'no', 'N', '0', '', 'maybe'])(
    'reads %j in Is Open Access as closed',
    (value) => expect(read('Is Open Access', value).isOpenAccess).toBe(false),
  );

  it('reads Authors Complete as true, false or unknown (never a guess)', () => {
    expect(read('Authors Complete', ' true').authorsComplete).toBe(true);
    expect(read('Authors Complete', 'false ').authorsComplete).toBe(false);
    expect(read('Authors Complete', 'no').authorsComplete).toBe(false);
    for (const unknown of ['', 'maybe'])
      expect(read('Authors Complete', unknown)).not.toHaveProperty('authorsComplete');
    const json = importWorks(
      JSON.stringify([
        { title: 'A', authorsComplete: null },
        { title: 'B', authorsComplete: ' true ' },
        { title: 'C', included: null },
        { title: 'D', included: ' false ' },
        { title: 'E', included: 'N' },
      ]),
      'x.json',
    );
    expect(json[0]).not.toHaveProperty('authorsComplete');
    expect(json[1].authorsComplete).toBe(true);
    expect(json.map((w) => w.included)).toEqual([true, true, true, false, false]);
  });

  it('keeps unknown Included values included but says so in the report', () => {
    const report = importWorksWithReport(
      'Title,Included\r\nAAA,excluded\r\nBBB,x\r\nCCC,\r\nDDD,no\r\n',
      'x.csv',
    );
    expect(report.works.map((w) => w.included)).toEqual([true, true, true, false]);
    expect(report.warnings.join(' ')).toMatch(/2 records.*Included/);
    expect(importWorksWithReport('Title,Included\r\nAAA,yes\r\n', 'x.csv').warnings).toEqual([]);
  });
});

describe('P2-10 BibTeX written by real tools', () => {
  it('reads "and others" as an incomplete author list, not as an author named others', () => {
    const [paper] = importWorks(
      '@article{a, title={Attention is all you need}, author={Vaswani, Ashish and Shazeer, Noam and others}, year={2017}}',
      'x.bib',
    );
    expect(paper.authors).toEqual(['Vaswani, Ashish', 'Shazeer, Noam']);
    expect(paper.authorsComplete).toBe(false);
    const [whole] = importWorks(
      '@article{a, title={T}, author={Doe, Jane and Roe, Rick}}',
      'x.bib',
    );
    expect(whole).not.toHaveProperty('authorsComplete');
  });

  it('uses biblatex journaltitle and the venue fields of other entry types', () => {
    const venue = (entry: string) => importWorks(entry, 'x.bib')[0].venue;
    expect(venue('@article{a, title={T}, journaltitle={Journal Two}}')).toBe('Journal Two');
    expect(venue('@article{a, title={T}, journal={J1}, journaltitle={J2}}')).toBe('J1');
    expect(venue('@inproceedings{a, title={T}, booktitle={Proc. of X}}')).toBe('Proc. of X');
    expect(venue('@book{a, title={T}, publisher={Publisher House}}')).toBe('Publisher House');
    expect(venue('@phdthesis{a, title={T}, school={State University}}')).toBe('State University');
    expect(venue('@techreport{a, title={T}, institution={Institute}}')).toBe('Institute');
    expect(venue('@misc{a, title={T}, howpublished={bioRxiv}}')).toBe('bioRxiv');
  });

  it('does not mistake a \\url{} in howpublished for a venue', () => {
    const [paper] = importWorks(
      '@misc{a, title={T}, howpublished={\\url{https://example.org/x}}}',
      'x.bib',
    );
    expect(paper.venue).toBe('');
    expect(paper.url).toBe('https://example.org/x');
  });

  it('collapses the newlines and indentation of hard-wrapped fields', () => {
    const [paper] = importWorks(
      `@article{a,
  title     = {A long title that is hard wrapped
               across several lines by the editor},
  author    = {Doe, Jane and
               Roe, Richard},
  abstract  = {First sentence of the abstract
               continues here.},
  journal   = {Journal of
               Things},
  keywords  = {alpha,
               beta},
  year      = {2020}
}`,
      'x.bib',
    );
    expect(paper.title).toBe(
      'A long title that is hard wrapped across several lines by the editor',
    );
    expect(paper.authors).toEqual(['Doe, Jane', 'Roe, Richard']);
    expect(paper.abstract).toBe('First sentence of the abstract continues here.');
    expect(paper.venue).toBe('Journal of Things');
    expect(paper.tags).toEqual(['alpha', 'beta']);
  });

  it('keeps the line breaks of abstracts that were not hard-wrapped', () => {
    const [paper] = importWorks(
      '@article{a, title={T}, abstract={One line.\nA second line.\n\nNew paragraph.}}',
      'x.bib',
    );
    expect(paper.abstract).toBe('One line.\nA second line.\n\nNew paragraph.');
  });

  it.each([
    ['M{\\"o}ller', 'Möller'],
    ['M\\"oller', 'Möller'],
    ["Caf\\'e", 'Café'],
    ["Caf\\'{e}", 'Café'],
    ['P\\`ere', 'Père'],
    ['\\^etre', 'être'],
    ['Espa\\~na', 'España'],
    ['Fran{\\c c}ois', 'François'],
    ['Fran\\c{c}ois', 'François'],
    ['Fran\\c cois', 'François'],
    ['{\\O}rsted', 'Ørsted'],
    ['K{\\o}benhavn', 'København'],
    ['Stra{\\ss}e', 'Straße'],
    ['{\\L}ukasz', 'Łukasz'],
    ['Bia{\\l}ystok', 'Białystok'],
    ['{\\AA}ngstr{\\"o}m', 'Ångström'],
    ['\\v{S}koda', 'Škoda'],
    ["\\'{\\i}ndice", 'índice'],
    ['Erd\\H{o}s', 'Erdős'],
    ["Dvo\\v{r}\\'ak", 'Dvořák'],
    ['na{\\"\\i}ve', 'naïve'],
  ])('turns the TeX accent in %j into %j', (tex, plain) => {
    const [paper] = importWorks(
      `@article{a, title={${tex}}, author={${tex}, Jane and Roe, Rick}}`,
      'x.bib',
    );
    expect(paper.title).toBe(plain);
    expect(paper.authors).toEqual([`${plain}, Jane`, 'Roe, Rick']);
  });

  it('leaves escaped text and unrelated backslashes alone', () => {
    const [paper] = importWorks(
      '@article{a, title={R\\&D at 50\\% of \\$5 and the \\"hi\\" example}}',
      'x.bib',
    );
    expect(paper.title).toBe('R&D at 50% of $5 and the \\"hi\\" example');
  });

  it('gives Google Scholar style entries proper names', () => {
    const [paper] = importWorks(
      `@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Kaiser, {\\L}ukasz and Polosukhin, Illia and others},
  journal={Advances in neural information processing systems},
  year={2017}
}`,
      'x.bib',
    );
    expect(paper.authors).toEqual(['Vaswani, Ashish', 'Kaiser, Łukasz', 'Polosukhin, Illia']);
    expect(paper.authorsComplete).toBe(false);
  });
});

describe('P2-11 columns from other tools', () => {
  const first = (csv: string, name = 'x.csv') => importWorksWithReport(csv, name).works[0];

  it('reads Zotero exports', () => {
    const paper = first(
      'Key,Item Type,Publication Year,Author,Title,Publication Title,DOI,Url,Abstract Note,Manual Tags,Notes\r\nK1,journalArticle,2020,"Smith, John; Doe, Jane",A study of things in general,Nature,10.1234/x,https://example.org/a,An abstract,"tag1; tag2",A note\r\n',
    );
    expect(paper).toMatchObject({
      title: 'A study of things in general',
      authors: ['Smith, John', 'Doe, Jane'],
      year: 2020,
      venue: 'Nature',
      abstract: 'An abstract',
      tags: ['tag1', 'tag2'],
      notes: 'A note',
      url: 'https://example.org/a',
      type: 'journalArticle',
    });
  });

  it('reads Scopus exports', () => {
    const paper = first(
      'Authors,Title,Year,Source title,Cited by,DOI,Link,Abstract,Author Keywords,Document Type\r\n"Smith J., Doe A.",A study of things in general,2020,Nature,42,10.1234/x,https://example.org/a,An abstract,kw1; kw2,Article\r\n',
    );
    expect(paper).toMatchObject({
      authors: ['Smith J.', 'Doe A.'],
      venue: 'Nature',
      citations: 42,
      tags: ['kw1', 'kw2'],
      url: 'https://example.org/a',
      type: 'Article',
    });
  });

  it('reads Dimensions exports', () => {
    const paper = first(
      'Rank,Publication ID,DOI,PMID,Title,Abstract,Source Title,Publication Date,PubYear,Authors,Times cited\r\n1,pub.1,10.1234/x,1,A study of things in general,An abstract,Nature,2020-01-01,2020,"Smith, John; Doe, Jane",42\r\n',
    );
    expect(paper).toMatchObject({ year: 2020, venue: 'Nature', citations: 42 });
  });

  it('reads OpenAlex exports', () => {
    const paper = first(
      'id,doi,title,display_name,publication_year,cited_by_count\r\nhttps://openalex.org/W1,https://doi.org/10.1234/x,A study of things in general,A study of things in general,2020,42\r\n',
    );
    expect(paper).toMatchObject({ year: 2020, citations: 42, doi: '10.1234/x' });
  });

  it('reads Publish or Perish exports, including comma-separated author lists', () => {
    const paper = first(
      'Cites,Authors,Title,Year,Source,Publisher,ArticleURL,CitesURL,Type,DOI,Abstract\r\n42,"AG Meyer, J Smith, K Doe",A study of things in general,2020,Nature,NPG,https://example.org/a,https://scholar.google.com/x,,10.1234/x,An abstract\r\n',
    );
    expect(paper).toMatchObject({
      authors: ['AG Meyer', 'J Smith', 'K Doe'],
      url: 'https://example.org/a',
      venue: 'Nature',
      citations: 42,
    });
  });

  it('reads Web of Science tab-delimited files', () => {
    const paper = first(
      'PT\tAU\tTI\tSO\tPY\tTC\tDI\tAB\tDE\r\nJ\tSmith, J; Doe, A\tA study of things in general\tNATURE\t2020\t42\t10.1234/x\tAn abstract\tkw1; kw2\r\n',
      'savedrecs.txt',
    );
    expect(paper).toMatchObject({
      title: 'A study of things in general',
      authors: ['Smith, J', 'Doe, A'],
      venue: 'NATURE',
      year: 2020,
      citations: 42,
      tags: ['kw1', 'kw2'],
    });
  });

  it('prefers the first filled column when two columns mean the same field', () => {
    expect(first('Title,Journal,Source\nAAA,J1,\n').venue).toBe('J1');
    expect(first('Title,Source,Journal\nAAA,,J2\n').venue).toBe('J2');
    expect(first('Title,Journal,Source\nAAA,J1,J2\n').venue).toBe('J1');
  });

  it('detects semicolon- and tab-separated files by their first record line', () => {
    expect(first('Title;Authors;Year\nA study of things in general;Smith J;2020\n')).toMatchObject({
      authors: ['Smith J'],
      year: 2020,
    });
    expect(first('Title;Notes, with comma;Year\nA;x;2020\n').year).toBe(2020);
    expect(first('Title\tYear\rA paper\t2020\r', 'x.txt')).toMatchObject({ year: 2020 });
    // A tab inside a quoted cell of a comma file, in a file that only uses lone CR line ends.
    expect(first('Title,Notes\rAAA,"a\tb"\r').notes).toBe('a\tb');
    // Delimiters inside quotes do not count.
    expect(first('"Notes; misc; more",Title\n"x;y",A paper\n')).toMatchObject({ title: 'A paper' });
  });

  it('reports the columns it could not use', () => {
    const report = importWorksWithReport(
      'Title,Year,Weird Column,Empty Extra,Key\nA paper,2020,x,,K1\n',
      'x.csv',
    );
    expect(report.ignoredColumns).toEqual(['Weird Column', 'Key']);
    expect(report.works).toHaveLength(1);
    expect(
      importWorksWithReport('[{"title":"A","mystery":1,"venue":"V"}]', 'x.json').ignoredColumns,
    ).toEqual(['mystery']);
    expect(
      importWorksWithReport('@article{a, title={T}, volume={3}}', 'x.bib').ignoredColumns,
    ).toEqual([]);
  });
});

describe('P2-11 author lists', () => {
  const authors = (value: string) =>
    importWorks(JSON.stringify([{ title: 'A paper', authors: value }]), 'x.json')[0].authors;

  it.each([
    ['AG Meyer, J Smith, K Doe', ['AG Meyer', 'J Smith', 'K Doe']],
    ['Smith J., Doe A.', ['Smith J.', 'Doe A.']],
    ['Smith J, Doe A', ['Smith J', 'Doe A']],
    ['Jane Smith, John Doe, Ali Jones', ['Jane Smith', 'John Doe', 'Ali Jones']],
    ['Jane Smith, John Doe and Ali Jones', ['Jane Smith', 'John Doe', 'Ali Jones']],
    ['Smith, John; Doe, Jane', ['Smith, John', 'Doe, Jane']],
    ['Smith, John and Doe, Jane', ['Smith, John', 'Doe, Jane']],
    ['Doe, Jane Marie', ['Doe, Jane Marie']],
    ['Smith, John, Jr.', ['Smith, John, Jr.']],
    ['García Márquez, Gabriel José', ['García Márquez, Gabriel José']],
    ['Jane Smith, John Doe', ['Jane Smith, John Doe']],
    ['Meyer, Austin G', ['Meyer, Austin G']],
  ])('reads %j', (value, expected) => expect(authors(value)).toEqual(expected));

  it('keeps every author up to the workspace limit, and flags lists that had to be cut', () => {
    const many = Array.from({ length: 3000 }, (_, i) => `Author ${i}`);
    const [kept] = importWorks(
      JSON.stringify([{ title: 'Big collaboration', authors: many }]),
      'x.json',
    );
    expect(kept.authors).toHaveLength(3000);
    expect(kept.authors.at(-1)).toBe('Author 2999');
    expect(kept).not.toHaveProperty('authorsComplete');

    const huge = Array.from({ length: 10_050 }, (_, i) => `Author ${i}`);
    const [cut] = importWorks(
      JSON.stringify([{ title: 'Huge collaboration', authors: huge }]),
      'x.json',
    );
    expect(cut.authors).toHaveLength(10_000);
    expect(cut.authorsComplete).toBe(false);
    expect(() => validateWorkspace(workspaceOf([cut]))).not.toThrow();
  });
});

describe('P2-11 values the workspace would refuse are repaired at the boundary', () => {
  it('accepts publication years from 1500 to next year only', () => {
    const report = importWorksWithReport(
      JSON.stringify(
        [1018, 1499, 1500, 1999, thisYear, thisYear + 1, thisYear + 2, 2999].map((year) => ({
          title: `Paper ${year}`,
          year,
        })),
      ),
      'x.json',
    );
    expect(report.works.map((w) => w.year)).toEqual([
      null,
      null,
      1500,
      1999,
      thisYear,
      thisYear + 1,
      null,
      null,
    ]);
    expect(report.warnings.join(' ')).toMatch(/4 records.*year/);
    expect(importWorks('Title,Year\nA,1018\nB,2020\n', 'x.csv').map((w) => w.year)).toEqual([
      null,
      2020,
    ]);
  });

  it('turns a bad citationHistory cell into a readable error', () => {
    for (const [content, name] of [
      ['Title,CitationHistory\nA paper,oops\n', 'x.csv'],
      ['[{"title":"A paper","citationHistory":"oops"}]', 'x.json'],
      ['[{"title":"A paper","citationHistory":[{"year":"x"}]}]', 'x.json'],
    ] as const) {
      let failure: Error | undefined;
      try {
        importWorks(content, name);
      } catch (error) {
        failure = error as Error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(SyntaxError);
      expect(failure!.message).toMatch(/Record 1.*citation history/i);
    }
  });

  it('gives every provenance entry a parseable retrieval date', () => {
    const [paper] = importWorks(
      JSON.stringify([
        {
          title: 'Paper with provenance',
          provenance: [
            { source: 'pubmed', sourceId: '1', citations: 3 },
            { source: 'crossref', sourceId: '2', retrievedAt: 'yesterday-ish' },
            { source: 'openalex', sourceId: '3', retrievedAt: '2026-09-14' },
          ],
        },
      ]),
      'x.json',
    );
    for (const record of paper.provenance)
      expect(Number.isNaN(Date.parse(record.retrievedAt))).toBe(false);
    expect(paper.provenance[2].retrievedAt).toBe('2026-09-14');
    expect(() => validateWorkspace(workspaceOf([paper]))).not.toThrow();
  });

  it('clamps long tags and fields so the imported records always fit the workspace', () => {
    const tags = Array.from({ length: 150 }, (_, i) => `${i}-${'t'.repeat(300)}`);
    const records = [
      {
        title: 'Paper with oversized fields',
        tags,
        authors: [`${'a'.repeat(1500)} Author`],
        type: 'x'.repeat(150),
        provenance: [{ source: 'pubmed', sourceId: 's'.repeat(1500), retrievedAt: '2026-09-14' }],
      },
    ];
    for (const [content, name] of [
      [JSON.stringify(records), 'x.json'],
      [`Title,Tags\n"Paper with oversized fields","${tags.join(';')}"\n`, 'x.csv'],
    ] as const) {
      const works = importWorks(content, name);
      expect(works[0].tags.length).toBeLessThanOrEqual(100);
      expect(works[0].tags.every((tag) => tag.length <= 200)).toBe(true);
      expect(() => validateWorkspace(workspaceOf(works))).not.toThrow();
    }
  });

  it('never rewrites a DOI it cannot read, and counts the records where that happened', () => {
    const report = importWorksWithReport(
      JSON.stringify([
        { title: 'Good DOI', doi: 'https://doi.org/10.1234/ABC.' },
        { title: 'Bad DOI', doi: 'not available' },
        { title: 'No DOI' },
      ]),
      'x.json',
    );
    expect(report.works.map((w) => w.doi)).toEqual(['10.1234/abc', '', '']);
    expect(report.warnings.join(' ')).toMatch(/1 record.*DOI/);
  });

  it('links a SICI DOI to a valid doi.org address', () => {
    const doi = '10.1002/(sici)1097-0258(19981215)17:23<2804::aid-sim964>3.0.co;2-a';
    const [paper] = importWorks(JSON.stringify([{ title: 'SICI paper', doi }]), 'x.json');
    expect(paper.doi).toBe(doi);
    expect(() => new URL(paper.url)).not.toThrow();
    expect(decodeURIComponent(new URL(paper.url).pathname)).toBe(`/${doi}`);
  });
});

describe('what importing must keep doing', () => {
  it('does not pollute prototypes through hostile keys', () => {
    importWorks(
      '[{"title":"A","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}]',
      'x.json',
    );
    importWorks('Title,__proto__,constructor,prototype\nAAA,1,2,3\n', 'x.csv');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('treats entry types and columns named like object members as plain names', () => {
    expect(importWorks('@constructor{k, title={A paper}}', 'x.bib')[0].type).toBe('constructor');
    expect(importWorks('TY  - toString\nTI  - A\nER  -', 'x.ris')[0].type).toBe('tostring');
    expect(importWorks('Title,constructor,__proto__\nA,1,2\n', 'x.csv')).toHaveLength(1);
  });

  it('imports 20,000 records quickly', { timeout: 300_000 }, () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      title: `Imported publication number ${i} about topic`,
      authors: ['Austin Meyer', `Author ${i}`],
      year: 2000 + (i % 25),
      doi: `10.1234/${i}`,
      citations: i,
      tags: ['a', 'b'],
    }));
    const started = performance.now();
    expect(importWorks(JSON.stringify(rows), 'x.json')).toHaveLength(20_000);
    const header = 'Title,Authors,Year,DOI,Citations\n';
    const csv =
      header +
      rows
        .map((r) => `"${r.title}","${r.authors.join('; ')}",${r.year},${r.doi},${r.citations}`)
        .join('\n');
    expect(importWorks(csv, 'x.csv')).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});

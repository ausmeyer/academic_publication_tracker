import { describe, expect, it } from 'vitest';
import type { Work } from '../src/types';
import { exportWorks, importWorks, importWorksWithReport } from '../src/core/formats';
import { mergeWorks } from '../src/core/merge';
import { nameMatch } from '../src/core/names';

describe('W2-04 Web of Science tab-delimited files', () => {
  const header = ['PT', 'AU', 'AF', 'TI', 'SO', 'DE', 'ID', 'AB', 'TC', 'PY', 'DI', 'UT'].join(
    '\t',
  );
  const row = (title: string, abstract: string, keywordsPlus = '') =>
    [
      'J',
      'Meyer, AG; Smith, J',
      'Meyer, Austin G.; Smith, John',
      title,
      'JOURNAL OF TESTS',
      'influenza; forecasting',
      keywordsPlus,
      abstract,
      '12',
      '2020',
      '10.1234/wos1',
      'WOS:000123',
    ].join('\t');
  const read = (...rows: string[]) =>
    importWorksWithReport([header, ...rows].join('\n'), 'savedrecs.txt');

  it('imports a record whose abstract quotes a phrase', () => {
    const [work] = read(
      row('Forecasting influenza', 'We test the so-called "hygiene hypothesis" here.'),
    ).works;
    expect(work.abstract).toBe('We test the so-called "hygiene hypothesis" here.');
    expect(work).toMatchObject({ title: 'Forecasting influenza', year: 2020, citations: 12 });
  });

  it('imports a record whose title starts with a quoted word', () => {
    const { works } = read(
      row('"Big data" and influenza forecasting', 'Plain.'),
      row('"Unclosed quote in a second title', 'Plain "too.'),
    );
    expect(works.map((w) => w.title)).toEqual([
      '"Big data" and influenza forecasting',
      '"Unclosed quote in a second title',
    ]);
    expect(works[1].abstract).toBe('Plain "too.');
  });

  it('does not turn Keywords Plus (ID) into the record id', () => {
    const report = read(row('Forecasting influenza', 'Plain.', 'INFLUENZA; MODELS'));
    expect(report.works[0].id).not.toBe('INFLUENZA; MODELS');
    expect(report.ignoredColumns).toContain('ID');
  });

  it('still reads cells that are quoted as a whole in tab-separated files', () => {
    const [work] = importWorks(
      'Title\tNotes\tAuthors\n"Quoted, title"\t"Line one\nline two\twith a tab and ""quotes"""\t"Smith, J"\n',
      'x.tsv',
    );
    expect(work).toMatchObject({
      title: 'Quoted, title',
      notes: 'Line one\nline two\twith a tab and "quotes"',
      authors: ['Smith, J'],
    });
  });

  it('keeps an ID column as the record id outside Web of Science files', () => {
    expect(importWorks('ID\tTitle\nK1\tA paper\n', 'x.tsv')[0].id).toBe('K1');
    expect(importWorks('ID,Title\nK1,A paper\n', 'x.csv')[0].id).toBe('K1');
  });

  it('still rejects stray quotes in comma-separated files', () => {
    expect(() => importWorks('Title,Notes\nA paper,say "hi"\n', 'x.csv')).toThrow(
      'a quote appears inside an unquoted field',
    );
    expect(() => importWorks('Title,Notes\n"A" paper,x\n', 'x.csv')).toThrow(
      'unexpected text after a quoted field',
    );
  });
});

describe('W2-05 "et al." and ellipses end an author list instead of becoming authors', () => {
  const authors = (value: string) => {
    const [work] = importWorks(`Cites,Authors,Title,Year\n3,"${value}",A paper,2020\n`, 'pop.csv');
    return { authors: work.authors, complete: work.authorsComplete };
  };

  it.each([
    ['AG Meyer, J Smith, et al.', ['AG Meyer', 'J Smith']],
    ['AG Meyer, J Smith et al', ['AG Meyer', 'J Smith']],
    ['Meyer AG; Smith J; et al.', ['Meyer AG', 'Smith J']],
    ['AG Meyer, J Smith, K Doe…', ['AG Meyer', 'J Smith', 'K Doe']],
    ['AG Meyer, J Smith, K Doe...', ['AG Meyer', 'J Smith', 'K Doe']],
    ['Meyer AG; Smith J; …', ['Meyer AG', 'Smith J']],
  ])('reads %j as an incomplete list', (value, expected) => {
    expect(authors(value)).toEqual({ authors: expected, complete: false });
  });

  it('leaves complete lists unmarked', () => {
    expect(authors('AG Meyer, J Smith, K Doe')).toEqual({
      authors: ['AG Meyer', 'J Smith', 'K Doe'],
      complete: undefined,
    });
  });

  it('does not merge two different papers through "et al."', () => {
    const works = importWorks(
      'Cites,Authors,Title,Year,Source\n' +
        '3,"AG Meyer, J Smith, et al.",Response to the letter to the editor on influenza,2020,J1\n' +
        '5,"K Doe, R Roe, et al.",Response to the letter to the editor on influenza,2020,J2\n',
      'pop.csv',
    );
    expect(works.map((w) => w.authors)).toEqual([
      ['AG Meyer', 'J Smith'],
      ['K Doe', 'R Roe'],
    ]);
    expect(mergeWorks(works)).toHaveLength(2);
  });

  it('keeps a saved author named like a marker through a CSV export and import', () => {
    const work: Work = {
      id: 'w1',
      title: 'A paper',
      authors: ['Jane Smith', 'et al.'],
      year: 2020,
      venue: '',
      doi: '',
      abstract: '',
      type: 'article',
      url: '',
      openAccessUrl: '',
      isOpenAccess: false,
      citations: null,
      provenance: [],
      included: true,
      tags: [],
      notes: '',
    };
    const [back] = importWorks(exportWorks([work], 'csv'), 'x.csv');
    expect(back.authors).toEqual(work.authors);
  });
});

describe('W2-10 BibTeX ties in author names', () => {
  it('reads "Meyer, A.~G." as a name that matches Austin G Meyer', () => {
    const [work] = importWorks(
      "@article{k1,\n  title = {A paper},\n  author = {Meyer, A.~G. and Smith,~J. and Pe\\~na, Jos\\'{e}},\n  year = {2020}\n}\n",
      'refs.bib',
    );
    expect(work.authors).toEqual(['Meyer, A. G.', 'Smith, J.', 'Peña, José']);
    expect(nameMatch(work.authors[0], 'Austin G Meyer')).not.toBeNull();
  });

  it('keeps a literal tilde that the exporter escaped', () => {
    const [work] = importWorks(
      '@article{k1, title = {A paper}, author = {ACME\\textasciitilde{}Labs and Doe, J.}}',
      'refs.bib',
    );
    expect(work.authors).toEqual(['ACME~Labs', 'Doe, J.']);
  });
});

describe('W2-12 Dimensions and OpenAlex CSV exports', () => {
  // Column names of the Dimensions "Publications export (full data)" (help.dimensions.ai), a subset.
  const dimensions = [
    '"Rank","Publication ID","DOI","PMID","PMCID","Title","Abstract","Source title","Publication Date","PubYear","Publication Type","Document Type","Authors","Times cited","Dimensions URL"',
    '"1","pub.1000000001","10.1234/dim1","","","Forecasting influenza with ensembles","An abstract.","Journal of Tests","2020-03-01","2020","Article","Research Article","Meyer, Austin G; Smith, Jane","42","https://app.dimensions.ai/details/publication/pub.1000000001"',
  ].join('\r\n');
  const expected = {
    title: 'Forecasting influenza with ensembles',
    authors: ['Meyer, Austin G', 'Smith, Jane'],
    year: 2020,
    venue: 'Journal of Tests',
    citations: 42,
    doi: '10.1234/dim1',
  };

  it('skips the line that Dimensions writes above the header row', () => {
    for (const preamble of [
      'About the data: Exported on Sep 30, 2026. Criteria: "influenza" in title and abstract.',
      '"About the data: This export was generated on 2026-09-30, search: influenza; forecasting"',
    ]) {
      const [work] = importWorks(
        `\uFEFF${preamble}\r\n${dimensions}\r\n`,
        'Dimensions-Publication-2026-09-30.csv',
      );
      expect(work).toMatchObject(expected);
    }
    expect(importWorks(dimensions, 'dimensions.csv')[0]).toMatchObject(expected);
  });

  it('still asks for a Title column when neither of the first two lines has one', () => {
    expect(() => importWorks('Note line\nName,Year\nA,2020\n', 'x.csv')).toThrow(
      'CSV needs a Title column.',
    );
  });

  it('reads the OpenAlex CSV layout with dotted column names and "|" between authors', () => {
    // Header and values as in a real OpenAlex export (ourresearch/openalex-formatter).
    const csv = [
      '"id","authorships.author.display_name","cited_by_count","display_name","doi","primary_location.source.display_name","publication_year","type"',
      '"https://openalex.org/W2741809807","Jakub Kužílek|Martin Hlosta|Zdeněk Zdráhal","143","Open University Learning Analytics dataset","https://doi.org/10.1038/sdata.2017.171","Scientific Data","2017","article"',
    ].join('\n');
    expect(importWorks(csv, 'works.csv')[0]).toMatchObject({
      title: 'Open University Learning Analytics dataset',
      authors: ['Jakub Kužílek', 'Martin Hlosta', 'Zdeněk Zdráhal'],
      year: 2017,
      venue: 'Scientific Data',
      citations: 143,
      doi: '10.1038/sdata.2017.171',
    });
  });

  it('reads the OpenAlex web export with readable column names', () => {
    for (const authors of ['Jakub Kužílek|Martin Hlosta', 'Jakub Kužílek; Martin Hlosta']) {
      const csv = `Work ID,Title,Author,Year,Citation count,Source,DOI\nW1,A dataset paper,"${authors}",2017,143,Scientific Data,https://doi.org/10.1038/sdata.2017.171\n`;
      expect(importWorks(csv, 'works.csv')[0]).toMatchObject({
        title: 'A dataset paper',
        authors: ['Jakub Kužílek', 'Martin Hlosta'],
        year: 2017,
        venue: 'Scientific Data',
        citations: 143,
      });
    }
  });
});

describe('W2-13 the error for a JSON object names the control that restores backups', () => {
  it('points to Import instead of a "Restore backup" control that does not exist', () => {
    expect(() => importWorks('{"version":2}', 'backup.json')).toThrow(
      'Publication JSON must contain an array of works. To restore a workspace backup, use Import and choose the backup file.',
    );
  });
});

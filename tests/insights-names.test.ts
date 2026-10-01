import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { settings, work } from './insights-helpers';

const COMPATIBLE = 'Initial-compatible name; verify identity';
const EXACT = 'Exact name or saved alias';

const classify = (byline: string[], author: string, aliases: string[] = []) =>
  analyzeInsights([work('x', { authors: byline })], settings({ author, aliases }), 'all').rows[0];

describe('author-name matching in Research insights', () => {
  it.each([
    ['Europe PMC "Reich NG" for a given-first author', ['Reich NG', 'Smith J'], 'Nicholas G Reich'],
    ['a typed "Reich NG" for a given-first byline', ['Nicholas G Reich', 'Smith J'], 'Reich NG'],
    ['"Piwowar HA" for "Heather A Piwowar"', ['Piwowar HA', 'Day RS'], 'Heather A Piwowar'],
    [
      '"Heather A Piwowar" for a typed "Piwowar HA"',
      ['Heather A Piwowar', 'Roger S Day'],
      'Piwowar HA',
    ],
    ['"Scholar J" for "Jane Scholar"', ['Scholar J', 'Alex Other'], 'Jane Scholar'],
    ['a generational suffix on the byline', ['Austin G. Meyer Jr.', 'Smith J'], 'Austin G Meyer'],
    ['a comma form with a suffix', ['Meyer, Jr., Austin G.', 'Smith J'], 'Austin G Meyer'],
    ['a trailing period on Vancouver initials', ['Fridsma DB.', 'Day RS'], 'Douglas B Fridsma'],
  ])('flags %s as initial-compatible and classifies it', (_label, byline, author) => {
    const row = classify(byline, author);
    expect(row.role).toBe('first');
    expect(row.initialMatch).toBe(true);
    expect(row.reason).toContain(COMPATIBLE);
  });

  it.each([
    ['Łukasz Kowalski', 'Lukasz Kowalski'],
    ['Lukasz Kowalski', 'Łukasz Kowalski'],
    ['Bjørn Dæhlen', 'Bjorn Daehlen'],
    ['Hans Strauss', 'Hans Strauß'],
    ['Schólar, Jane', 'Jane Scholar'],
    ['Scholar, Jane', 'Jane Scholar'],
    ['JANE SCHOLAR', 'Jane Scholar'],
  ])('treats %s and %s as the same spelling', (byline, author) => {
    const row = classify([byline, 'Alex Other'], author);
    expect(row.role).toBe('first');
    expect(row.initialMatch).toBe(false);
    expect(row.reason).toContain(EXACT);
  });

  it.each([
    ['JOHN SCHOLAR', 'Jane Scholar'],
    ['JILL SCHOLAR', 'Jane Scholar'],
    ['Anna Jones', 'Anna Smith-Jones'],
    ['Anna Smith-Jones', 'Anna Jones'],
    ['KEVIN LEE', 'Kim Lee'],
    ['Adam Meyer', 'Austin G Meyer'],
    ['Alex George Meyer', 'Austin G Meyer'],
  ])('does not treat %s as %s', (byline, author) => {
    const row = classify(['Alex Other', byline], author);
    expect(row.role).toBe('unclassified');
    expect(row.weight).toBeNull();
  });

  it('does not turn a different full given name into the second author', () => {
    const rows = analyzeInsights(
      [
        work('john', { authors: ['Alex Other', 'JOHN SCHOLAR'] }),
        work('jill', { authors: ['Alex Other', 'JILL SCHOLAR'] }),
        work('jane', { authors: ['Alex Other', 'JANE SCHOLAR', 'Third Person'] }),
      ],
      settings(),
      'all',
    );
    expect(rows.rows.map((r) => r.role)).toEqual(['unclassified', 'unclassified', 'second']);
    expect(rows.initialMatches).toBe(0);
  });

  it('keeps more than one match in a byline unclassified, whichever spelling matched', () => {
    const row = classify(['Reich NG', 'Nicholas G Reich', 'Smith J'], 'Nicholas G Reich');
    expect(row.role).toBe('unclassified');
    expect(row.reason).toBe('Ambiguous author match');
    expect(row.matches).toBe(2);
  });

  it('treats a saved alias that spells the byline exactly as an exact match', () => {
    const row = classify(['Reich NG', 'Smith J'], 'Nicholas G Reich', ['Reich NG']);
    expect(row.role).toBe('first');
    expect(row.initialMatch).toBe(false);
    expect(row.reason).toContain(EXACT);
  });

  it('finds the byline position for Europe PMC author names from a real record', () => {
    // Europe PMC returns "Surname Initials"; OpenAlex, PubMed and Crossref return given names.
    const europePmc = ['Bracher J', 'Ray EL', 'Gneiting T', 'Reich NG'];
    const openAlex = ['Johannes Bracher', 'Evan L Ray', 'Tilmann Gneiting', 'Nicholas G Reich'];
    const crossref = ['Johannes Bracher', 'Evan L. Ray', 'Tilmann Gneiting', 'Nicholas G. Reich'];
    for (const byline of [europePmc, openAlex, crossref]) {
      const row = classify(byline, 'Nicholas G Reich');
      expect(row.role).toBe('last');
      expect(row.weight).toBe(0.25);
    }
    expect(classify(europePmc, 'Nicholas G Reich').initialMatch).toBe(true);
    expect(classify(openAlex, 'Nicholas G Reich').initialMatch).toBe(false);
    expect(classify(europePmc, 'Reich NG').role).toBe('last');
  });

  it('does not reuse one analysis author for the next', () => {
    const works = [
      work('a', { authors: ['Jane Scholar', 'Alex Other'] }),
      work('b', { authors: ['Alex Other', 'Jane Scholar'] }),
    ];
    const jane = analyzeInsights(works, settings({ author: 'Jane Scholar' }), 'all');
    const alex = analyzeInsights(works, settings({ author: 'Alex Other' }), 'all');
    const nobody = analyzeInsights(works, settings({ author: 'Sam Nobody' }), 'all');
    const aliased = analyzeInsights(
      works,
      settings({ author: 'Sam Nobody', aliases: ['Alex Other'] }),
      'all',
    );
    expect(jane.rows.map((r) => r.role)).toEqual(['first', 'last']);
    expect(alex.rows.map((r) => r.role)).toEqual(['last', 'first']);
    expect(nobody.rows.map((r) => r.role)).toEqual(['unclassified', 'unclassified']);
    expect(aliased.rows.map((r) => r.role)).toEqual(['last', 'first']);
  });

  it('counts the papers whose byline matched the analysis author at all', () => {
    const works = [
      work('match', { authors: ['Jane Scholar', 'Alex Other'] }),
      work('ambiguous', { authors: ['Jane Scholar', 'J Scholar'] }),
      work('none', { authors: ['Someone Else', 'Alex Other'] }),
    ];
    const result = analyzeInsights(works, settings(), 'all');
    expect(result.rows.map((r) => r.matches)).toEqual([1, 2, 0]);
    expect(result.nameMatches).toBe(2);
    expect(analyzeInsights(works, settings({ author: '' }), 'all').nameMatches).toBe(0);
  });
});

describe('author-name matching against the shared name matcher', () => {
  const pieces = [
    'Jane',
    'Scholar',
    'J',
    'JS',
    'J.',
    'Scholar,',
    ',',
    'Łukasz',
    'Lukasz',
    'Søren',
    'Soren',
    'van',
    'der',
    'Berg',
    'Meyer',
    'AG',
    'A',
    'G',
    "O'Brien",
    'O’Brien',
    'Smith-Jones',
    'Jones',
    'Müller',
    'Muller',
    'Jr.',
    'III',
    '李',
    '伟',
    'İsmail',
    'Straße',
    'Strasse',
    'Dæhlen',
    'Daehlen',
    'Austin',
    'Reich',
    'NG',
    'Nicholas',
  ];
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
  const name = () =>
    Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(pieces)).join(
      pick([' ', ' ', ', ']),
    );

  it('finds exactly the bylines that nameMatch accepts, however odd the spelling', async () => {
    const { nameMatch } = await import('../src/core/names');
    for (let trial = 0; trial < 3000; trial++) {
      const byline = Array.from({ length: 1 + Math.floor(random() * 6) }, name);
      const author = name();
      const aliases = Array.from({ length: Math.floor(random() * 3) }, name);
      const targets = [author, ...aliases].filter((value) => value.trim());
      const kinds = byline.map((candidate) => {
        const found = targets.map((target) => nameMatch(candidate, target));
        return found.includes('exact')
          ? 'exact'
          : found.includes('compatible')
            ? 'compatible'
            : null;
      });
      const expected = kinds.filter(Boolean).length;
      const row = analyzeInsights(
        [work('x', { authors: byline })],
        settings({ author, aliases }),
        'all',
      ).rows[0];
      expect(row.matches, JSON.stringify({ byline, author, aliases })).toBe(
        author.trim() ? expected : 0,
      );
      if (author.trim() && expected === 1)
        expect(row.initialMatch, JSON.stringify({ byline, author, aliases })).toBe(
          kinds.find(Boolean) === 'compatible',
        );
    }
  });
});

describe('author-name matching performance', () => {
  let seed = 1;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  // Nearly every byline is a different string, which defeats any per-name cache.
  const works = Array.from({ length: 20000 }, (_, i) =>
    work(`p${i}`, {
      authors: Array.from(
        { length: 10 },
        (_, k) =>
          `Name${Math.floor(random() * 500)} ${String.fromCharCode(65 + k)} Surname${Math.floor(random() * 500)}`,
      ),
    }),
  );
  works[17].authors[4] = 'Austin G Meyer';

  it('classifies 20,000 papers with three aliases without stalling the interface', () => {
    const config = settings({
      author: 'Austin G Meyer',
      aliases: ['AG Meyer', 'Meyer AG', 'A Meyer'],
    });
    const started = performance.now();
    const result = analyzeInsights(works, config, 'all');
    expect(result.classified).toBe(1);
    expect(performance.now() - started).toBeLessThan(2500);
  });

  it('does no name work at all while no author is chosen', () => {
    const started = performance.now();
    const result = analyzeInsights(works, settings({ author: '', aliases: ['AG Meyer'] }), 'all');
    expect(result.classified).toBe(0);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

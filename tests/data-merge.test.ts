import { describe, expect, it } from 'vitest';
import type { Provenance, Work } from '../src/types';
import { mergeWorks, normalizeDoi } from '../src/core/merge';

const work = (overrides: Partial<Work> = {}): Work => ({
  id: 'w',
  title: 'A longitudinal study of scientific collaboration',
  authors: ['Austin Meyer'],
  year: 2020,
  venue: 'Journal of Research',
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
  ...overrides,
});
const prov = (
  source: Provenance['source'],
  sourceId: string,
  citations: number | null = null,
  retrievedAt = '2026-09-14T00:00:00Z',
): Provenance => ({ source, sourceId, citations, retrievedAt, url: '' });
const permutations = <T>(items: T[]): T[][] =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );
const ids = (list: Work[]) => list.map((w) => w.id).sort();

describe('P2-05 curation is shared when records merge', () => {
  const included = work({ id: 'a', doi: '10.1234/x' });
  const excluded = work({
    id: 'b',
    doi: '10.1234/x',
    included: false,
    notes: 'WRONG AUTHOR - exclude',
    tags: ['namesake'],
  });

  it('keeps the exclusion, note and tags of any member, whichever arrives first', () => {
    for (const input of [
      [included, excluded],
      [excluded, included],
    ]) {
      const [merged, ...rest] = mergeWorks(input);
      expect(rest).toHaveLength(0);
      expect(merged).toMatchObject({
        included: false,
        notes: 'WRONG AUTHOR - exclude',
        tags: ['namesake'],
      });
    }
  });

  it('unites tags without duplicates and keeps each distinct note once, in input order', () => {
    const [merged] = mergeWorks([
      work({ id: '1', doi: '10.1234/x', notes: 'first note', tags: ['a', 'b'] }),
      work({ id: '2', doi: '10.1234/x', notes: 'second note', tags: ['b', 'c'] }),
      work({ id: '3', doi: '10.1234/x', notes: 'first note', tags: ['c'] }),
      work({ id: '4', doi: '10.1234/x', notes: '  ', tags: [] }),
    ]);
    expect(merged.tags).toEqual(['a', 'b', 'c']);
    expect(merged.notes).toBe('first note\n\nsecond note');
  });

  it('leaves ordinary search results (included, no notes, no tags) exactly as before', () => {
    const [merged] = mergeWorks([
      work({ id: '1', doi: '10.1234/x', provenance: [prov('openalex', 'W1', 4)] }),
      work({ id: '2', doi: '10.1234/x', provenance: [prov('crossref', 'c1', 9)] }),
    ]);
    expect(merged).toMatchObject({ included: true, notes: '', tags: [], citations: 9 });
  });

  it('stays inside the workspace limits for tags and notes', () => {
    const many = (prefix: string) => Array.from({ length: 80 }, (_, i) => `${prefix}${i}`);
    const [merged] = mergeWorks([
      work({ id: '1', doi: '10.1234/x', tags: many('a'), notes: 'x'.repeat(70_000) }),
      work({ id: '2', doi: '10.1234/x', tags: many('b'), notes: 'y'.repeat(70_000) }),
    ]);
    expect(merged.tags).toHaveLength(100);
    expect(merged.notes.length).toBeLessThanOrEqual(100_000);
  });
});

describe('P2-14 placeholder title and type never beat real metadata', () => {
  const provenance = [prov('pubmed', '77')];
  const sparse = work({ id: 'sparse', title: 'Untitled record', type: 'publication', provenance });
  const real = work({
    id: 'real',
    title: 'Proper title of the paper, fully described',
    type: 'journal-article',
    provenance,
  });

  it('takes the incoming title and type when the first record only has placeholders', () => {
    for (const input of [
      [sparse, real],
      [real, sparse],
    ]) {
      const [merged, ...rest] = mergeWorks(input);
      expect(rest).toHaveLength(0);
      expect(merged.title).toBe(real.title);
      expect(merged.type).toBe('journal-article');
    }
  });

  it('keeps the placeholders when nothing better exists', () => {
    const [merged] = mergeWorks([sparse, { ...sparse, id: 'sparse-2' }]);
    expect(merged).toMatchObject({ title: 'Untitled record', type: 'publication' });
  });

  it('still lets the first real title win over later real titles', () => {
    const [merged] = mergeWorks([
      { ...real, title: 'First real title of the paper' },
      { ...real, id: 'real-2', title: 'Second real title of the paper' },
    ]);
    expect(merged.title).toBe('First real title of the paper');
  });
});

describe('P2-07 duplicates are found across name formats, diacritics and provider spellings', () => {
  const epmc = work({
    id: 'europepmc:MED:123',
    title: 'Mortality after pediatric cardiac arrest: a multicenter cohort study',
    authors: ['Meyer AG', 'Smith J', 'Doe JA'],
    year: 1998,
    citations: 40,
    provenance: [prov('europepmc', 'MED:123', 40)],
  });
  const pubmed = work({
    ...epmc,
    id: 'pubmed:123',
    authors: ['Austin G Meyer', 'John Smith', 'Jane A Doe'],
    citations: null,
    provenance: [prov('pubmed', '123')],
  });
  const scholar = work({
    ...epmc,
    id: 'scholar:x',
    authors: ['AG Meyer', 'J Smith'],
    authorsComplete: false,
    citations: 55,
    provenance: [prov('scholar', 'x', 55)],
  });
  const openalex = work({
    ...epmc,
    id: 'openalex:W1',
    authors: ['Austin G. Meyer', 'John Smith'],
    citations: 60,
    provenance: [prov('openalex', 'W1', 60)],
  });

  it('merges Europe PMC, PubMed, Scholar and OpenAlex records of one paper (DOI-less)', () => {
    const all = [epmc, pubmed, scholar, openalex];
    for (const pair of [
      [epmc, pubmed],
      [epmc, scholar],
      [epmc, openalex],
      [pubmed, scholar],
      [pubmed, openalex],
      [scholar, openalex],
    ])
      expect(mergeWorks(pair)).toHaveLength(1);
    for (const input of permutations(all)) {
      const merged = mergeWorks(input);
      expect(merged).toHaveLength(1);
      expect(merged[0].citations).toBe(60);
      expect(merged[0].provenance).toHaveLength(4);
    }
  });

  it.each([
    ['Meyer AG', 'Austin G Meyer'],
    ['Meyer, AG', 'Austin G Meyer'],
    ['Meyer A', 'Austin Meyer'],
    ['Meyer, A.', 'Austin Meyer'],
    ['A. G. Meyer', 'Austin G. Meyer'],
    ['van der Berg J', 'Jan van der Berg'],
    ['Van Der Berg, Jan', 'Jan Van Der Berg'],
    ['Müller H', 'Hans Müller'],
    ['Muller H', 'Hans Müller'],
    ['Wang X', 'Xiao Wang'],
    ['Wang, Xiao', 'Xiao Wang'],
    ['Jean-Pierre Sartre', 'Sartre, J.-P.'],
    ['J. Smith', 'Smith J'],
    ['JOHN SMITH', 'John Smith'],
  ])('treats %j and %j as the same author', (a, b) => {
    expect(
      mergeWorks([work({ id: 'a', authors: [a] }), work({ id: 'b', authors: [b] })]),
    ).toHaveLength(1);
  });

  it.each([
    ['Meyer A', 'Smith A'],
    ['Austin Meyer', 'Bob Meyer'],
    ['Meyer AG', 'Meyer BG'],
  ])('keeps %j and %j apart', (a, b) => {
    expect(
      mergeWorks([work({ id: 'a', authors: [a] }), work({ id: 'b', authors: [b] })]),
    ).toHaveLength(2);
  });

  it('ignores diacritics in titles', () => {
    const merged = mergeWorks([
      work({ id: 'a', title: 'Étude longitudinale de la collaboration scientifique' }),
      work({ id: 'b', title: 'Etude longitudinale de la collaboration scientifique' }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('reads Europe PMC "MED:<pmid>" and PubMed "<pmid>" as one provider identity', () => {
    const sparse = work({ doi: '', title: 'Brief report', year: null, authors: [] });
    const europe = { ...sparse, id: 'e', provenance: [prov('europepmc', 'MED:99')] };
    const pub = { ...sparse, id: 'p', provenance: [prov('pubmed', '99')] };
    expect(mergeWorks([europe, pub])).toHaveLength(1);
    expect(mergeWorks([pub, europe])).toHaveLength(1);
    // Other Europe PMC record families and other numbers are not PubMed identities.
    const preprint = { ...sparse, id: 'r', provenance: [prov('europepmc', 'PPR:99')] };
    const plain = { ...sparse, id: 'q', provenance: [prov('europepmc', '99')] };
    expect(mergeWorks([preprint, pub])).toHaveLength(2);
    expect(mergeWorks([plain, pub])).toHaveLength(2);
    expect(mergeWorks([europe, { ...pub, provenance: [prov('pubmed', '98')] }])).toHaveLength(2);
  });

  it('reads arXiv "<id>v<n>" and "<id>" as one provider identity, whatever the version', () => {
    const sparse = work({ doi: '', title: 'Brief note', year: null, authors: [] });
    const versioned = { ...sparse, id: 'a1', provenance: [prov('arxiv', '2304.02643v1')] };
    const latest = { ...sparse, id: 'a2', provenance: [prov('arxiv', '2304.02643')] };
    const second = { ...sparse, id: 'a3', provenance: [prov('arxiv', '2304.02643v2')] };
    for (const input of permutations([versioned, latest, second])) {
      const merged = mergeWorks(input);
      expect(merged).toHaveLength(1);
      expect(merged[0].provenance).toHaveLength(3);
    }
    const old = { ...sparse, id: 'o', provenance: [prov('arxiv', 'hep-th/9901001v2')] };
    const old1 = { ...sparse, id: 'p', provenance: [prov('arxiv', 'hep-th/9901001')] };
    expect(mergeWorks([old, old1])).toHaveLength(1);
    // Other ids and other sources are not the same record.
    const other = { ...sparse, id: 'q', provenance: [prov('arxiv', '2304.02644')] };
    const elsewhere = { ...sparse, id: 'r', provenance: [prov('openalex', '2304.02643')] };
    expect(mergeWorks([versioned, other, elsewhere])).toHaveLength(3);
  });

  it('still refuses to bridge different DOIs through a shared PubMed record', () => {
    const a = work({ id: 'a', doi: '10.1234/a', provenance: [prov('europepmc', 'MED:5')] });
    const b = work({ id: 'b', doi: '10.1234/b', provenance: [prov('pubmed', '5')] });
    expect(mergeWorks([a, b])).toHaveLength(2);
  });
});

describe('P2-06 merging is deterministic, order-independent and stable', () => {
  it('repro A: a bridging record joins everything in every input order', () => {
    const p = work({ id: 'P', authors: ['Austin Meyer'] });
    const s = work({ id: 'S', authors: ['Sara Jones'] });
    const q = work({ id: 'Q', authors: ['Austin Meyer', 'Sara Jones'] });
    for (const input of permutations([p, s, q])) expect(mergeWorks(input)).toHaveLength(1);
  });

  it('repro B: a second merge finds nothing the first merge missed', () => {
    const r1 = work({ id: 'R1', doi: '10.1234/d', authors: ['Austin Meyer'] });
    const r2 = work({
      id: 'R2',
      doi: '10.1234/D',
      title: 'Completely different title text for this record',
      year: null,
      authors: ['Austin Meyer', 'Sara Jones'],
    });
    const r3 = work({ id: 'R3', authors: ['Sara Jones'] });
    for (const input of permutations([r1, r2, r3])) {
      const once = mergeWorks(input);
      expect(once).toHaveLength(1);
      expect(mergeWorks(once)).toEqual(once);
    }
  });

  it('keeps two DOI groups apart, but merges the DOI-less duplicates of each other', () => {
    const d1 = work({ id: 'D1', doi: '10.1234/a' });
    const d2 = work({ id: 'D2', doi: '10.1234/b' });
    const n1 = work({ id: 'N1' });
    const n2 = work({ id: 'N2' });
    for (const input of permutations([d1, d2, n1, n2])) {
      const merged = mergeWorks(input);
      expect(merged).toHaveLength(3);
      expect(merged.map((w) => w.doi).sort()).toEqual(['', '10.1234/a', '10.1234/b']);
      const duplicates = merged.find((w) => !w.doi)!;
      expect(duplicates.id).toBe(input.find((w) => w === n1 || w === n2)!.id);
      const again = mergeWorks(merged);
      expect(again).toHaveLength(3);
    }
  });

  it('keeps a record that matches two different DOIs by title separate, even when authors differ', () => {
    const d1 = work({ id: 'D1', doi: '10.1234/a', authors: ['Austin Meyer', 'Sara Jones'] });
    const d2 = work({ id: 'D2', doi: '10.1234/b', authors: ['Bob Jones'] });
    const bridge = work({ id: 'N', authors: ['Sara Jones'] });
    for (const input of permutations([d1, d2, bridge])) {
      expect(mergeWorks(input)).toHaveLength(3);
      expect(mergeWorks(mergeWorks(input))).toHaveLength(3);
    }
  });

  it('attaches a DOI-less record to the only DOI group that shares its title, year and an author', () => {
    const d1 = work({ id: 'D1', doi: '10.1234/a', authors: ['Austin Meyer'] });
    const other = work({
      id: 'D2',
      doi: '10.1234/b',
      title: 'An entirely different paper about something else',
    });
    const n = work({ id: 'N', authors: ['Austin Meyer'] });
    for (const input of permutations([d1, other, n])) {
      const merged = mergeWorks(input);
      expect(merged).toHaveLength(2);
      expect(merged.find((w) => w.doi === '10.1234/b')!.id).toBe('D2');
      expect(merged.find((w) => w.doi === '10.1234/a')!.id).toBe(
        input.find((w) => w === d1 || w === n)!.id,
      );
    }
  });

  // -- property checks over random record sets ------------------------------------------------
  const prng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const partition = (list: Work[]) =>
    list
      .map((w) =>
        [...new Set(w.provenance.map((p) => p.retrievedAt).filter((r) => r.startsWith('i:')))]
          .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
          .join(','),
      )
      .sort()
      .join(' | ');
  /** Verifies the invariants that must hold for any input. Returns counts of violations. */
  const audit = (makeSet: (rnd: () => number) => Work[], trials: number, seed: number) => {
    const rnd = prng(seed);
    const shuffle = <T>(items: T[]) => {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const bad = { order: 0, idempotent: 0, doi: 0, lost: 0, citations: 0, mutated: 0 };
    for (let trial = 0; trial < trials; trial++) {
      const works = makeSet(rnd);
      const before = JSON.stringify(works);
      const merged = mergeWorks(works);
      if (JSON.stringify(works) !== before) bad.mutated++;
      const expected = partition(merged);
      for (let k = 0; k < 4; k++)
        if (partition(mergeWorks(shuffle(works))) !== expected) {
          bad.order++;
          break;
        }
      if (mergeWorks(merged).length !== merged.length) bad.idempotent++;
      const doiOf = new Map(works.map((w, i) => [`i:${i}`, normalizeDoi(w.doi)]));
      for (const w of merged) {
        const dois = new Set(
          w.provenance.map((p) => doiOf.get(p.retrievedAt) ?? '').filter(Boolean),
        );
        if (dois.size > 1) bad.doi++;
        const cites = w.provenance.map((p) => p.citations).filter((c): c is number => c !== null);
        if (w.citations !== (cites.length ? Math.max(...cites) : null)) bad.citations++;
      }
      const seen = new Map<string, number>();
      for (const w of merged)
        for (const m of new Set(w.provenance.map((p) => p.retrievedAt)))
          seen.set(m, (seen.get(m) ?? 0) + 1);
      if (works.some((_, i) => seen.get(`i:${i}`) !== 1)) bad.lost++;
    }
    return bad;
  };
  const pickFrom = <T>(rnd: () => number, items: readonly T[]): T =>
    items[Math.floor(rnd() * items.length)];
  const record = (
    i: number,
    rnd: () => number,
    fields: Partial<Work>,
    sharedPubmed: string,
  ): Work => {
    const citations = Math.floor(rnd() * 6) || null;
    const provenance = [prov('crossref', `u${i}`, citations, `i:${i}`)];
    if (sharedPubmed) provenance.push(prov('pubmed', sharedPubmed, null, `i:${i}`));
    return work({ id: `id${i}`, citations, provenance, ...fields });
  };

  it(
    'property: realistic duplicate sets give the same partition in any order, and merging twice changes nothing',
    { timeout: 300_000 },
    () => {
      const people = [
        ['Austin', 'Meyer'],
        ['Alice', 'Smith'],
        ['Bob', 'Jones'],
        ['María', 'González'],
        ['Jan', 'van der Berg'],
      ];
      const style = (person: string[], kind: number) =>
        [
          `${person[0]} ${person[1]}`,
          `${person[1]}, ${person[0]}`,
          `${person[1]} ${person[0][0]}`,
          `${person[0][0]}. ${person[1]}`,
        ][kind];
      const titles = [
        'Deep learning for protein structure prediction',
        'Forecasting seasonal influenza with mechanistic models',
      ];
      const bad = audit(
        (rnd) => {
          const papers = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => ({
            title: pickFrom(rnd, titles),
            year: pickFrom(rnd, [2019, 2020, 2020]),
            doi: rnd() < 0.7 ? `10.1234/p${k}` : '',
            authors: [...people].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3)),
            pubmed: `${100 + k}`,
          }));
          return Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => {
            const paper = pickFrom(rnd, papers);
            const kind = Math.floor(rnd() * 4);
            return record(
              i,
              rnd,
              {
                title: pickFrom(rnd, [paper.title, paper.title.toUpperCase(), `${paper.title}.`]),
                authors: paper.authors
                  .slice(0, 1 + Math.floor(rnd() * paper.authors.length))
                  .map((person) => style(person, kind)),
                year: rnd() < 0.15 ? null : paper.year,
                doi: rnd() < 0.6 ? pickFrom(rnd, [paper.doi, `https://doi.org/${paper.doi}`]) : '',
              },
              rnd() < 0.4 ? pickFrom(rnd, [paper.pubmed, `MED:${paper.pubmed}`]) : '',
            );
          });
        },
        1200,
        4242,
      );
      expect(bad).toEqual({ order: 0, idempotent: 0, doi: 0, lost: 0, citations: 0, mutated: 0 });
    },
  );

  it(
    'property: adversarial sets (contradictory metadata) never depend on order, bridge DOIs or lose records',
    { timeout: 300_000 },
    () => {
      const titles = [
        'A longitudinal study of scientific collaboration',
        'A Longitudinal Study of Scientific Collaboration!',
        'Another quite long and distinct publication title',
        'Short',
      ];
      const authorLists = [
        ['Austin Meyer'],
        ['Meyer, A.'],
        ['Alice Smith'],
        ['Austin Meyer', 'Alice Smith'],
        ['Alice Smith', 'Bob Jones'],
        [],
      ];
      const dois = ['', '', '', '10.1234/a', '10.1234/A', 'https://doi.org/10.1234/b', '10.1234/c'];
      const bad = audit(
        (rnd) =>
          Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, i) =>
            record(
              i,
              rnd,
              {
                title: pickFrom(rnd, titles),
                authors: [...pickFrom(rnd, authorLists)],
                year: pickFrom(rnd, [2020, 2020, 2021, null]),
                doi: pickFrom(rnd, dois),
              },
              pickFrom(rnd, ['', '', 'P1', 'P2', 'P3']),
            ),
          ),
        1500,
        12345,
      );
      expect(bad).toMatchObject({ order: 0, doi: 0, lost: 0, citations: 0, mutated: 0 });
      // Only records that contradict themselves (one provider id, several titles) can make a second
      // merge resolve an ambiguity the first one left open; the original code did this for ~2% of sets.
      expect(bad.idempotent).toBeLessThan(15);
    },
  );
});

describe('merging edge cases', () => {
  it('returns copies for empty and single inputs', () => {
    expect(mergeWorks([])).toEqual([]);
    const only = work({ id: 'only', doi: 'https://doi.org/10.1234/X' });
    const [copy] = mergeWorks([only]);
    expect(copy).not.toBe(only);
    expect(copy.doi).toBe('10.1234/x');
    expect(only.doi).toBe('https://doi.org/10.1234/X');
  });

  it('copes with a DOI group that has hundreds of metadata variants', () => {
    const variants = Array.from({ length: 60 }, (_, i) =>
      work({
        id: `v${i}`,
        doi: '10.1234/v',
        title: `Variant title number ${i} of the same article`,
        year: 2000 + (i % 30),
        authors: [`Person${i} Name${i}`, 'Austin Meyer'],
      }),
    );
    const lookalike = work({
      id: 'n',
      title: 'Variant title number 7 of the same article',
      year: 2007,
      authors: ['Person7 Name7'],
    });
    const merged = mergeWorks([...variants, lookalike]);
    expect(merged).toHaveLength(1);
    expect(mergeWorks([lookalike, ...variants])).toHaveLength(1);
  });

  it('keeps unrelated publications apart', () => {
    const merged = mergeWorks([
      work({ id: 'a', title: 'First unrelated paper about something' }),
      work({ id: 'b', title: 'Second unrelated paper about something else' }),
      work({ id: 'c', doi: '10.1234/c', title: 'Third unrelated paper with its own DOI' }),
    ]);
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
  });
});

describe('what merging must keep doing', () => {
  it('never merges two different DOIs and keeps every record exactly once', () => {
    const merged = mergeWorks([
      work({ id: 'a', doi: '10.1234/a', provenance: [prov('pubmed', '1')] }),
      work({ id: 'b', doi: '10.1234/b', provenance: [prov('pubmed', '1')] }),
      work({ id: 'c', doi: '', provenance: [prov('pubmed', '1')] }),
    ]);
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
  });

  it('uses the largest citation count of any member and de-duplicates provenance', () => {
    const shared = prov('openalex', 'W1', 7);
    const [merged] = mergeWorks([
      work({ id: 'a', doi: '10.1234/x', citations: 3, provenance: [shared] }),
      work({ id: 'b', doi: '10.1234/x', citations: 12, provenance: [{ ...shared }] }),
      work({ id: 'c', doi: '10.1234/x', citations: null, provenance: [prov('crossref', 'c', 9)] }),
    ]);
    expect(merged.citations).toBe(12);
    expect(merged.provenance).toHaveLength(2);
  });

  it('never mutates its input', () => {
    const inputs = [
      work({ id: 'a', doi: '10.1234/x', tags: ['t'], provenance: [prov('openalex', 'W1', 1)] }),
      work({ id: 'b', doi: 'https://doi.org/10.1234/X', notes: 'n', authors: ['B'] }),
    ];
    const frozen = JSON.stringify(inputs);
    for (const input of inputs) {
      Object.freeze(input);
      Object.freeze(input.authors);
      Object.freeze(input.tags);
      Object.freeze(input.provenance);
    }
    mergeWorks(inputs);
    expect(JSON.stringify(inputs)).toBe(frozen);
  });

  it('keeps provenance inside the workspace limit without losing the best citation count', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      work({
        id: `m${i}`,
        doi: '10.1234/x',
        provenance: [prov('openalex', `W${i}`, i === 149 ? 500 : i, `t${i}`)],
      }),
    );
    const [merged] = mergeWorks(many);
    expect(merged.provenance.length).toBeLessThanOrEqual(100);
    expect(merged.citations).toBe(500);
    expect(merged.provenance.some((p) => p.citations === 500)).toBe(true);
  });
});

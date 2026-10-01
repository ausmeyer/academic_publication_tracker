// Round-3 review (R5) of the names revision: each test asserts the desired behaviour.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foldText, nameMatch } from '../src/core/names';
import { mergeWorks } from '../src/core/merge';
import { analyzeInsights } from '../src/core/insights';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchQuery, SearchResponse, Work } from '../src/types';
import { settings, work } from './insights-helpers';

describe('R5: different people are never an exact name match', () => {
  it.each([
    // same given names and first surname, different second surname
    ['Francisco Javier Álvarez Martín', 'Francisco Javier Álvarez Pérez'],
    ['María José García López', 'María José García Pérez'],
    // given names that contain a particle: any two holders, whatever their surnames
    ['María del Carmen Rodríguez', 'María del Carmen Domínguez'],
    ['María de los Ángeles Torres', 'María de los Ángeles Ruiz'],
    ['Juan de Dios Pérez', 'Juan de Dios Gómez'],
    ['Maria de Fátima Silva', 'Maria de Fátima Costa'],
    ['Maria das Graças Souza', 'Maria das Graças Lima'],
  ])('%s is not %s', (a, b) => {
    expect(nameMatch(a, b)).toBeNull();
  });

  it.each([
    // "exact" is documented as "the same spelling (after folding)"; a dropped surname is not that
    ['Ana Paula Souza Silva', 'Ana Paula Souza'],
    ['Torres, Ana María', 'Ana María Torres Pérez'],
    ['Mohammed Ali Hassan Ibrahim', 'Mohammed Ali Hassan'],
  ])('%s and %s are at most compatible', (a, b) => {
    expect(nameMatch(a, b)).not.toBe('exact');
  });
});

describe('R5: Insights does not count another person as the analysis author', () => {
  it('a paper by María José García Pérez is not "Exact name" for María José García López', () => {
    const paper = work('p1', { authors: ['María José García Pérez', 'A Other'] });
    const result = analyzeInsights([paper], settings({ author: 'María José García López' }), 'all');
    expect(result.rows[0].reason).not.toBe('Exact name or saved alias');
  });
  it('a paper co-written by María del Carmen Rodríguez and María del Carmen Domínguez is not ambiguous', () => {
    const paper = work('p2', {
      authors: ['María del Carmen Rodríguez', 'María del Carmen Domínguez', 'A Other'],
    });
    const result = analyzeInsights(
      [paper],
      settings({ author: 'María del Carmen Rodríguez' }),
      'all',
    );
    expect(result.rows[0].role).toBe('first');
  });
});

describe('R5: title+year duplicate detection does not join different people', () => {
  const record = (id: string, authors: string[]): Work => ({
    id,
    title: 'Response to the letter to the editor on influenza vaccination',
    authors,
    year: 2020,
    venue: '',
    doi: '',
    abstract: '',
    type: 'article',
    url: '',
    openAccessUrl: '',
    isOpenAccess: false,
    citations: null,
    provenance: [
      {
        source: 'scholar',
        sourceId: id,
        citations: null,
        retrievedAt: '2026-09-01T00:00:00Z',
        url: '',
      },
    ],
    included: true,
    tags: [],
    notes: '',
  });
  it('keeps the letters of María del Carmen Rodríguez and María del Carmen Domínguez apart', () => {
    expect(
      mergeWorks([
        record('a', ['María del Carmen Rodríguez']),
        record('b', ['María del Carmen Domínguez']),
      ]),
    ).toHaveLength(2);
  });
  it('keeps the letters of Juan Carlos Pérez Gómez and Juan Carlos Pérez López apart', () => {
    expect(
      mergeWorks([
        record('a', ['Juan Carlos Pérez Gómez']),
        record('b', ['Juan Carlos Pérez López']),
      ]),
    ).toHaveLength(2);
  });
});

describe('R5: Crossref author screen (W1 rotation x first-surname reading)', () => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  let clock = new Date('2026-10-03T12:00:00Z').getTime();
  beforeEach(() => {
    vi.useFakeTimers();
    clock += 300000;
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function kept(text: string, bylines: [string, string][]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          message: {
            'total-results': bylines.length,
            items: bylines.map(([given, family], index) => ({
              DOI: `10.1234/p${index}`,
              title: [`Paper ${index}`],
              author: [{ given, family }],
              published: { 'date-parts': [[2021]] },
              type: 'journal-article',
            })),
          },
        }),
      ),
    );
    const q: SearchQuery = { text, mode: 'author', sources: ['crossref'], limit: 50 };
    const promise: Promise<SearchResponse> = searchSources(q, DEFAULT_SETTINGS);
    await vi.runAllTimersAsync();
    return (await promise).results[0].works.map((w) => w.authors[0]);
  }
  it('"Juan Carlos Pérez Gómez" does not keep Carlos Pérez Gómez or Juan Carlos Pérez López', async () => {
    expect(
      await kept('Juan Carlos Pérez Gómez', [
        ['Juan Carlos', 'Pérez Gómez'],
        ['Carlos', 'Pérez Gómez'],
        ['Juan Carlos', 'Pérez López'],
      ]),
    ).toEqual(['Juan Carlos Pérez Gómez']);
  });
  it('"Wang Xiaoming" typed surname-first keeps the same given name written in syllables', async () => {
    expect(
      await kept('Wang Xiaoming', [
        ['Xiaoming', 'Wang'],
        ['Xiao-Ming', 'Wang'],
        ['Xiao Ming', 'Wang'],
      ]),
    ).toEqual(['Xiaoming Wang', 'Xiao-Ming Wang', 'Xiao Ming Wang']);
  });
  it('a surname typed alone with a capitalised particle ("Van Dijk") still keeps that surname', async () => {
    expect(
      await kept('Van Dijk', [
        ['Jan', 'van Dijk'],
        ['Anna', 'Van Dijk'],
      ]),
    ).toEqual(['Jan van Dijk', 'Anna Van Dijk']);
    expect(await kept('Das Gupta', [['Amit', 'Das Gupta']])).toEqual(['Amit Das Gupta']);
  });
  it('"Mohammed Ali Hassan Ibrahim" does not keep his father Ali Hassan Ibrahim', async () => {
    expect(
      await kept('Mohammed Ali Hassan Ibrahim', [
        ['Mohammed Ali Hassan', 'Ibrahim'],
        ['Ali Hassan', 'Ibrahim'],
      ]),
    ).toEqual(['Mohammed Ali Hassan Ibrahim']);
  });
});

describe('apostrophe look-alikes', () => {
  it("reads an acute accent or a right quote used as an apostrophe like D'Angelo's own", () => {
    expect(foldText('D´Angelo')).toBe(foldText("D'Angelo"));
    expect(foldText('D’Angelo')).toBe(foldText("D'Angelo"));
    expect(nameMatch('Maria D´Angelo', "Maria D'Angelo")).toBe('exact');
    expect(nameMatch("D'Angelo, Maria", 'Maria D’Angelo')).toBe('exact');
  });
});

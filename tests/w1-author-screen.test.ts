import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, searchSources } from '../src/services/sources';
import type { SearchResponse } from '../src/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let clock = new Date('2026-10-05T12:00:00Z').getTime();
beforeEach(() => {
  vi.useFakeTimers();
  clock += 300000;
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function finish(promise: Promise<SearchResponse>) {
  await vi.runAllTimersAsync();
  return promise;
}

/** First author of every Crossref candidate that survives the screen for the typed name. */
async function crossrefKeeps(text: string, bylines: [string, string][]): Promise<string[]> {
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
  const response = await finish(
    searchSources({ text, mode: 'author', sources: ['crossref'], limit: 50 }, DEFAULT_SETTINGS),
  );
  return response.results[0].works.map((work) => work.authors[0]);
}

/** Creator of every DataCite candidate that survives the screen; creators are written "Family, Given". */
async function dataciteKeeps(text: string, creators: string[]): Promise<string[]> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        meta: { total: creators.length },
        data: creators.map((name, index) => ({
          id: `10.1234/d${index}`,
          attributes: {
            doi: `10.1234/d${index}`,
            titles: [{ title: `Dataset ${index}` }],
            creators: [{ name }],
            publicationYear: 2021,
          },
        })),
      }),
    ),
  );
  const response = await finish(
    searchSources({ text, mode: 'author', sources: ['datacite'], limit: 50 }, DEFAULT_SETTINGS),
  );
  return response.results[0].works.map((work) => work.authors[0]);
}

describe('the surname-first reading of a typed name never admits other people', () => {
  it('"Austin G Meyer" keeps Austin Meyer and drops George Austin and G. Austin', async () => {
    expect(
      await crossrefKeeps('Austin G Meyer', [
        ['Austin', 'Meyer'],
        ['George', 'Austin'],
        ['G.', 'Austin'],
      ]),
    ).toEqual(['Austin Meyer']);
  });

  it('"Austin Meyer" drops Michael Austin and M. Austin', async () => {
    expect(
      await crossrefKeeps('Austin Meyer', [
        ['Austin', 'Meyer'],
        ['Michael', 'Austin'],
        ['M.', 'Austin'],
      ]),
    ).toEqual(['Austin Meyer']);
  });

  it('"Albert Einstein" drops Edward Albert', async () => {
    expect(
      await crossrefKeeps('Albert Einstein', [
        ['Albert', 'Einstein'],
        ['Edward', 'Albert'],
      ]),
    ).toEqual(['Albert Einstein']);
  });

  it('DataCite creators are screened the same way', async () => {
    expect(
      await dataciteKeeps('Austin G Meyer', ['Meyer, Austin', 'Austin, George', 'Austin, G.']),
    ).toEqual(['Meyer, Austin']);
  });
});

describe('a surname typed first still finds the same name', () => {
  it('"Wang Xiao Ming" keeps the bylines "Xiao Ming Wang" and "Wang, Xiao Ming"', async () => {
    expect(
      await crossrefKeeps('Wang Xiao Ming', [
        ['Xiao Ming', 'Wang'],
        ['Xiao', 'Li'],
      ]),
    ).toEqual(['Xiao Ming Wang']);
    expect(await dataciteKeeps('Wang Xiao Ming', ['Wang, Xiao Ming', 'Li, Xiao'])).toEqual([
      'Wang, Xiao Ming',
    ]);
  });

  it('the surname-first reading does not match through initials or another given name', async () => {
    expect(
      await crossrefKeeps('Wang Xiao Ming', [
        ['Xiao Ming', 'Wang'],
        ['X. M.', 'Wang'],
        ['Xiao', 'Wang'],
        ['Xiao Hong', 'Wang'],
      ]),
    ).toEqual(['Xiao Ming Wang']);
  });

  it('with a comma ("Wang, Xiao Ming") the typed order is known, so initials still match', async () => {
    expect(
      await crossrefKeeps('Wang, Xiao Ming', [
        ['Xiao Ming', 'Wang'],
        ['X. M.', 'Wang'],
        ['Xiao Hong', 'Wang'],
      ]),
    ).toEqual(['Xiao Ming Wang', 'X. M. Wang']);
  });
});

describe('given names that can also be surname particles or hyphenated', () => {
  it('"Bin Wang" keeps Bin Wang and B. Wang and drops other Wangs', async () => {
    expect(
      await crossrefKeeps('Bin Wang', [
        ['Bin', 'Wang'],
        ['B.', 'Wang'],
        ['Xiaoming', 'Wang'],
        ['Wei', 'Wang'],
      ]),
    ).toEqual(['Bin Wang', 'B. Wang']);
  });

  it('"Van Nguyen" drops Thi Nguyen', async () => {
    expect(
      await crossrefKeeps('Van Nguyen', [
        ['Van', 'Nguyen'],
        ['Thi', 'Nguyen'],
      ]),
    ).toEqual(['Van Nguyen']);
  });

  it('"Yi-An Chen" keeps Y.-A. Chen and Yian Chen and drops Yi Chen and Yi-Ling Chen', async () => {
    expect(
      await crossrefKeeps('Yi-An Chen', [
        ['Yi-An', 'Chen'],
        ['Y.-A.', 'Chen'],
        ['Yian', 'Chen'],
        ['Yi', 'Chen'],
        ['Yi-Ling', 'Chen'],
      ]),
    ).toEqual(['Yi-An Chen', 'Y.-A. Chen', 'Yian Chen']);
  });
});

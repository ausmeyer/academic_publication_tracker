import { describe, expect, it } from 'vitest';
import { validateQuery } from '../electron/query';

const next = new Date().getFullYear() + 1;
const base = {
  text: 'epidemic forecasting',
  mode: 'topic',
  sources: ['crossref', 'openalex'],
  limit: 20,
};

describe('search request validation in the main process', () => {
  it('accepts a valid request and returns it trimmed, with each source once', () => {
    expect(
      validateQuery({
        ...base,
        text: '  epidemic forecasting  ',
        sources: ['crossref', 'crossref', 'pubmed'],
        yearFrom: 2020,
        yearTo: next,
      }),
    ).toEqual({
      text: 'epidemic forecasting',
      mode: 'topic',
      sources: ['crossref', 'pubmed'],
      limit: 20,
      yearFrom: 2020,
      yearTo: next,
    });
  });

  // The messages are the ones searchSources shows, so people read one wording wherever a request fails.
  it.each([
    [null, 'Invalid search request.'],
    ['text', 'Invalid search request.'],
    [{ ...base, text: 'x' }, 'Enter a search between 2 and 500 characters.'],
    [{ ...base, text: ' a ' }, 'Enter a search between 2 and 500 characters.'],
    [{ ...base, text: '' }, 'Enter a search between 2 and 500 characters.'],
    [{ ...base, text: 'x'.repeat(501) }, 'Enter a search between 2 and 500 characters.'],
    [{ ...base, text: 42 }, 'Enter a search between 2 and 500 characters.'],
    [{ ...base, mode: 'other' }, 'Choose topic, author, or DOI search.'],
    [{ ...base, sources: [] }, 'Choose at least one supported data source.'],
    [{ ...base, sources: 'crossref' }, 'Choose at least one supported data source.'],
    [{ ...base, sources: ['google'] }, 'Choose at least one supported data source.'],
    [{ ...base, sources: ['scholar'] }, 'Choose at least one supported data source.'],
    [
      { ...base, sources: Array.from({ length: 9 }, () => 'crossref') },
      'Choose at least one supported data source.',
    ],
    [{ ...base, limit: 0 }, 'Choose between 1 and 200 results per source.'],
    [{ ...base, limit: 201 }, 'Choose between 1 and 200 results per source.'],
    [{ ...base, limit: 2.5 }, 'Choose between 1 and 200 results per source.'],
    [{ ...base, yearFrom: 1499 }, `Publication years must be between 1500 and ${next}.`],
    [{ ...base, yearTo: next + 1 }, `Publication years must be between 1500 and ${next}.`],
    [{ ...base, yearFrom: 2020.5 }, `Publication years must be between 1500 and ${next}.`],
    [{ ...base, yearFrom: 2024, yearTo: 2020 }, 'The start year must come before the end year.'],
    [
      { ...base, mode: 'doi', text: 'not a doi' },
      'Enter a complete DOI, such as 10.1038/nature12373.',
    ],
    [
      { ...base, mode: 'doi', text: '10.12/short' },
      'Enter a complete DOI, such as 10.1038/nature12373.',
    ],
  ])('rejects %j with a friendly message', (request, message) => {
    expect(() => validateQuery(request)).toThrow(message);
  });

  it.each([
    '10.1038/nature12373',
    'https://doi.org/10.1038/NATURE12373',
    'doi:10.1038/nature12373',
  ])('accepts the DOI %s', (text) => {
    expect(validateQuery({ ...base, mode: 'doi', text }).text).toBe(text);
  });

  it('accepts years without a range and treats null years as absent', () => {
    expect(validateQuery({ ...base, yearFrom: null, yearTo: undefined })).toMatchObject({
      yearFrom: undefined,
      yearTo: undefined,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, localDateStamp } from '../src/catalog';
import { doiUrl } from '../src/core/merge';

// A zone west of UTC is where date-only strings and UTC dates go wrong.
process.env.TZ = 'America/Chicago';

const day = { month: 'short', day: 'numeric', year: 'numeric' } as const;

describe('calendar dates (P5-11)', () => {
  it('shows a date-only string as the same calendar day west of UTC', () => {
    expect(formatDate('2026-09-30')).toBe(new Date(2026, 8, 30).toLocaleDateString(undefined, day));
  });

  it('shows a full timestamp in local time', () => {
    // 01:30 UTC on 1 Oct is 20:30 on 30 Sep in Chicago.
    expect(formatDate('2026-10-01T01:30:00Z')).toBe(
      new Date(2026, 8, 30).toLocaleDateString(undefined, day),
    );
  });

  it('adds the local time so two searches on one day can be told apart', () => {
    const text = formatDateTime('2026-10-01T01:30:00Z');
    expect(text).toBe(
      new Date(2026, 8, 30, 20, 30).toLocaleString(undefined, {
        ...day,
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
    expect(text).toMatch(/8:30/);
  });

  it('shows no time for a date-only string', () => {
    expect(formatDateTime('2026-09-30')).toBe(formatDate('2026-09-30'));
  });

  it('names backups by the local calendar date, not the UTC date', () => {
    expect(localDateStamp(new Date(2026, 8, 30, 20, 30))).toBe('2026-09-30');
    expect(localDateStamp(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
  });
});

describe('DOI links (P5-11)', () => {
  // The link leads to the whole DOI: nothing is cut off as a fragment or a query.
  const target = (doi: string) => {
    const link = new URL(doiUrl(doi));
    return {
      host: link.host,
      hash: link.hash,
      search: link.search,
      doi: decodeURIComponent(link.pathname.slice(1)),
    };
  };

  it('keeps a fragment or query inside the DOI instead of cutting it off', () => {
    for (const doi of ['10.1000/abc#frag', '10.1000/abc?x=1'])
      expect(target(doi)).toEqual({ host: 'doi.org', hash: '', search: '', doi });
  });

  it('keeps the slash between prefix and suffix', () => {
    expect(doiUrl('10.1038/s41586-020-2649-2')).toBe('https://doi.org/10.1038/s41586-020-2649-2');
  });

  it('encodes the punctuation of older SICI-style DOIs', () => {
    const doi = '10.1002/(sici)1097-0258(19981215)17:23<2804::aid-sim964>3.0.co;2-a';
    expect(target(doi)).toEqual({ host: 'doi.org', hash: '', search: '', doi });
  });
});

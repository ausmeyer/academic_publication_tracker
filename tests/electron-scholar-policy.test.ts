import { describe, expect, it } from 'vitest';
import {
  allowedNavigation,
  isScholarSearchLocation,
  sameSearchPage,
} from '../electron/scholar-policy';
import { isScholarConsentHost } from '../src/core/scholar';

const initial = 'https://scholar.google.com/scholar?hl=en&q=forecasting&as_ylo=2020';

describe('Google Scholar navigation allow-list', () => {
  it.each([
    'https://scholar.google.com/',
    'https://scholar.google.com/scholar?q=forecasting',
    'https://scholar.google.com/citations?user=abc',
    'https://scholar.google.com/sorry/index?continue=x',
    'https://accounts.google.com/v3/signin/identifier',
    'https://www.google.com/sorry/index?continue=x',
  ])('keeps allowing %s', (url) => {
    expect(allowedNavigation(url)).toBe(true);
  });

  it.each([
    'http://scholar.google.com/scholar',
    'https://scholar.google.com.evil.example/scholar',
    'https://scholar.google.com:8443/scholar',
    'https://user:pass@scholar.google.com/scholar',
    'https://scholar.google.com/scholar_settings',
    'https://www.google.com/search?q=x',
    'https://example.org/',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('keeps rejecting %s', (url) => {
    expect(allowedNavigation(url)).toBe(false);
  });

  // EU/UK visitors without cookies are sent to Google's consent interstitial before any results.
  it.each([
    'https://consent.google.com/ml?continue=https%3A%2F%2Fscholar.google.com%2Fscholar%3Fq%3Dx',
    'https://consent.google.com/save',
    'https://consent.google.de/ml?continue=x',
    'https://consent.google.fr/m?continue=x',
    'https://consent.google.co.uk/ml?continue=x',
    'https://consent.google.com.au/ml?continue=x',
    'https://consent.google.es/ml',
  ])('allows the consent interstitial %s', (url) => {
    expect(allowedNavigation(url)).toBe(true);
  });

  it.each([
    'http://consent.google.com/ml',
    'https://consent.google.com:8443/ml',
    'https://user:pass@consent.google.com/ml',
    'https://consent.google.com.evil.example/ml',
    'https://consent.google.com.evil.co/ml',
    'https://consent.google.evil/ml',
    'https://consent.google.comx/ml',
    'https://consent.google.c/ml',
    'https://xconsent.google.com/ml',
    'https://evil-consent.google.com/ml',
    'https://consent.evil.google.com/ml',
    'https://consent.google.com.evil.example:443/ml',
    'https://consent-google.com/ml',
    'https://consent.google./ml',
    'https://consent.google.co.uk.evil.example/ml',
  ])('rejects host tricks around the consent host %s', (url) => {
    expect(allowedNavigation(url)).toBe(false);
  });

  it.each([
    ['consent.google.com', true],
    ['consent.google.de', true],
    ['consent.google.co.uk', true],
    ['consent.google.com.br', true],
    ['consent.google.cat', true],
    ['scholar.google.com', false],
    ['consent.google.com.evil.example', false],
    ['consent.google.org.evil', false],
    ['CONSENT.GOOGLE.COM', false],
    ['consent.google', false],
    ['', false],
  ])('classifies the host %s as a consent host: %s', (host, expected) => {
    expect(isScholarConsentHost(host)).toBe(expected);
  });
});

describe('same-search page check', () => {
  it('accepts result pages of the same query and year filters, with extra paging parameters', () => {
    expect(sameSearchPage(`${initial}&start=10`, initial)).toBe(true);
    expect(sameSearchPage(initial, initial)).toBe(true);
  });

  it('rejects another query, changed filters, other pages, and the consent interstitial', () => {
    expect(sameSearchPage('https://scholar.google.com/scholar?q=other&as_ylo=2020', initial)).toBe(
      false,
    );
    expect(sameSearchPage('https://scholar.google.com/scholar?q=forecasting', initial)).toBe(false);
    expect(sameSearchPage('https://scholar.google.com/citations?user=abc', initial)).toBe(false);
    expect(sameSearchPage('https://consent.google.com/ml?q=forecasting&as_ylo=2020', initial)).toBe(
      false,
    );
  });
});

describe('returning from a verification or consent page', () => {
  it('recognises a Scholar search page but not the consent, sign-in, or sorry pages', () => {
    expect(isScholarSearchLocation(initial)).toBe(true);
    expect(isScholarSearchLocation('https://scholar.google.com/scholar?q=x&start=10')).toBe(true);
    expect(isScholarSearchLocation('https://consent.google.com/ml?continue=x')).toBe(false);
    expect(isScholarSearchLocation('https://accounts.google.com/signin')).toBe(false);
    expect(isScholarSearchLocation('https://www.google.com/sorry/index')).toBe(false);
    expect(isScholarSearchLocation('https://scholar.google.com/sorry/index')).toBe(false);
    expect(isScholarSearchLocation('https://scholar.google.com.evil.example/scholar')).toBe(false);
    expect(isScholarSearchLocation('not a url')).toBe(false);
  });
});

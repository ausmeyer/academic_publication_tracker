import { isScholarConsentHost } from '../src/core/scholar';

/**
 * Where the isolated Google Scholar browser may navigate: Scholar itself, Google sign-in and
 * unusual-traffic pages, and Google's cookie-consent interstitial. https only, no credentials or ports.
 * Kept free of Electron imports so the policy can be unit tested.
 */
export function allowedNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.hostname === 'accounts.google.com') return true;
    if (isScholarConsentHost(url.hostname)) return true;
    if (url.hostname === 'www.google.com' && url.pathname.startsWith('/sorry/')) return true;
    return (
      url.hostname === 'scholar.google.com' &&
      (['/', '/scholar', '/citations'].includes(url.pathname) || url.pathname.startsWith('/sorry/'))
    );
  } catch {
    return false;
  }
}

export function sameSearchPage(value: string, initialUrl: string): boolean {
  try {
    const url = new URL(value),
      initial = new URL(initialUrl);
    return (
      allowedNavigation(value) &&
      url.origin === initial.origin &&
      url.pathname === '/scholar' &&
      ['q', 'as_ylo', 'as_yhi'].every(
        (key) =>
          url.searchParams.getAll(key).length === initial.searchParams.getAll(key).length &&
          url.searchParams.get(key) === initial.searchParams.get(key),
      )
    );
  } catch {
    return false;
  }
}

/** True for a Scholar results page, the place a user returns to after consent or verification. */
export function isScholarSearchLocation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      allowedNavigation(value) &&
      url.hostname === 'scholar.google.com' &&
      url.pathname === '/scholar'
    );
  } catch {
    return false;
  }
}

const withoutHash = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  return url.href;
};

/**
 * True when a navigation targets the application's own page. Reloading it (for example the error
 * screen's "Reload app") is allowed; every other navigation of the window stays blocked.
 */
export function isAppLocation(target: string, location: string): boolean {
  try {
    return withoutHash(target) === withoutHash(location);
  } catch {
    return false;
  }
}

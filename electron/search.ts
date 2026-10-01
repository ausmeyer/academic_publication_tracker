import type { SearchQuery, SearchResponse, Settings } from '../src/types';

type SearchFunction = (
  query: SearchQuery,
  settings: Settings,
  options?: { fetch?: typeof fetch },
) => Promise<SearchResponse>;

/** Adds a note to every source of a response, keeping what each already says. */
export function withSettingsWarning(response: SearchResponse, warning: string): SearchResponse {
  return {
    ...response,
    results: response.results.map((result) => ({
      ...result,
      warning: [result.warning, warning].filter(Boolean).join(' '),
    })),
  };
}

/**
 * Runs a provider search with the saved settings. Settings that cannot be read never block a search:
 * it runs without API keys and each source says so. Provider requests use the given `fetch`, so the
 * desktop app can pass Electron's network stack (system proxy, PAC and certificate store).
 */
export async function runProviderSearch(
  query: SearchQuery,
  deps: {
    store: { loadSettingsLenient(): Promise<{ settings: Settings; warning: string | null }> };
    search: SearchFunction;
    fetch?: typeof fetch;
  },
): Promise<SearchResponse> {
  const { settings, warning } = await deps.store.loadSettingsLenient();
  const response = await deps.search(
    query,
    settings,
    deps.fetch ? { fetch: deps.fetch } : undefined,
  );
  return warning ? withSettingsWarning(response, warning) : response;
}

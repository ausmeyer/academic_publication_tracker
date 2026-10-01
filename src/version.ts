import manifest from '../package.json' with { type: 'json' };

/** The application version from package.json, for display and outgoing User-Agent headers. */
export const APP_VERSION: string = manifest.version;

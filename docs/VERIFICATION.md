# Verification record — version 0.4.2

Checks were performed on macOS Apple Silicon on September 14, 2026, using Node.js 26.7.0 and npm 11.19.0. The GitHub workflow also specifies native macOS and Windows runners with Node.js 24.

## Application checks

- A later same-day layout update orders the search tabs Author / Topic or title / DOI. The production build and desktop smoke passed again, the installed app visibly showed the new order, and the rebuilt platform bundles matched the current source build.
- New search now defaults to Author. The regression first reproduced the old Topic default, then passed with the fix. All 43 browser tests and the desktop smoke passed again; checks cover the New search button, keyboard shortcut, and explicit topic entry points. The installed app was also verified by clicking New search and observing the empty Author name field.
- Scholar author-query regression covers case and spacing variants without changing saved input or topic operators. Right-click menus are tested for the correct snapshot target, confirmation/cancel, persistence, keyboard access, rename, open, and dismissal.
- TypeScript checks and the production renderer/desktop build pass.
- 166 unit tests pass: citation metrics, conservative deduplication, refresh curation, imports/exports, source adapters, malformed input, size limits, local recovery, and credential-storage boundaries.
- 44 browser workflow tests pass: live-search response handling, reported Scholar result estimates, restart persistence, screening, filtering, sorting, annotations, exports/imports, backup restoration, corrupt storage recovery, layout, and partial search results.
- New source checks cover combined preprint filtering, balanced limits, original citation provenance, mixed direct/combined search deduplication, component failures, DataCite author/year searches, and canonical exact DOI matching.
- The native desktop smoke verifies the actual app version against the package manifest and checks an empty author field with the neutral placeholder plus all eight source choices. It checks the actual app UI, isolated user-data directory, workspace persistence, settings round trip, clipboard bridge, rejected invalid inputs, and sandbox/context isolation. Its clipboard test intercepts the native writer and does not replace the user's clipboard. Settings use no real API keys.
- Scholar parser tests cover rendered result/profile pages, bounded capture, known versus missing counts, separate snippets, interactive verification versus access refusal, and validated same-query next links. Browser workflows verify progress, verification controls, partial-result saving, and cancellation winning a race with completed results.
- Native Scholar checks cover delayed result rendering from four to 43 papers across five pages, continuously changing pages, approximate-count warnings, and hidden paced paging (including a deliberately delayed first request), sandbox/IPC isolation, interactive verification and resume, noninteractive refusals, empty searches, invalid redirects, partial errors, stop/cancel during loading and waiting, quit/close guards, deadline/load timeouts, renderer failure, and duplicate/page caps.
- Scholar collection also passes the actual React snapshot creation, citation display, save/reload, and canceled-search preservation workflow with a stubbed desktop response. JSON/CSV preserve snippets and provenance; BibTeX/RIS export snippets as labeled notes rather than abstracts.
- API-key encryption is tested through a deterministic encryption adapter. Keyed live requests and operating-system credential migration are not claimed verified.

## Live data checks

For v0.4.2, user snapshots showed a four-record Scholar search and a ten-record search with a pagination error, both using the same author query and 100-paper limit. A controlled baseline rerun returned 43 records, so the original live failure was not directly reproduced. A synthetic delayed-rendering page did reproduce premature completion at four records before the remaining results and Next link appeared. The updated collector waits at least 1.5 seconds and requires 0.5 seconds of stable results, bounded by five seconds of page reading. A live check of the updated collector retrieved all 43 papers and 2,583 citations across five pages without an error or verification challenge. This fixes the demonstrated timing defect; it does not guarantee that Scholar always returns the same results.

The installed v0.4.2 app was then used to refresh the user's search. It collected 40 papers across four pages before Google requested human verification on the final page. The app displayed its verification window and retained the 40 records while awaiting user completion; no challenge was solved or bypassed by automation.

For v0.4.1, a reported capitalization difference was present in saved snapshots but did not recur in a controlled live comparison: lowercase, title case, and uppercase-initial variants returned the same first ten records and counts. A full normalized lowercase author search returned 43 papers and 2,583 citations, matching the earlier title-case totals. The normalization regression ensures identical requests, not deterministic upstream results. Existing user snapshots were preserved.

Crossref, Europe PMC, and PubMed topic, author, and exact-DOI retrieval succeeded in small live checks. The interactive preview also completed a Europe PMC search for “epidemic forecasting.” A v0.4 live native Google Scholar search for the same public topic retrieved ten papers internally while its Scholar window remained hidden. Progress reached the paced next-page wait; **Stop and keep results** saved the ten papers and available citation counts through the app UI. Reload retained the collection in an isolated test workspace. No Google credentials or verification were needed. This live check stopped after one page; automatic pagination and verification are checked separately with synthetic pages. Live author-profile collection was not checked; it passes synthetic profile fixtures.

OpenAlex and Semantic Scholar keyless calls returned rate-limit errors during this session. arXiv calls timed out. Their normalization and failure handling pass deterministic tests, but successful live retrieval for those three services remains unverified here. Provider notices remain visible beside any retained results. See [source details](DATA_SOURCES.md).

DataCite topic searches with publication-year limits and creator-name searches returned records in live checks. Combined Preprints returned six records from Europe PMC/Crossref, including bioRxiv, medRxiv, and SSRN entries. The arXiv component timed out after 15 seconds; successful components were retained with its visible warning. This verifies combined retrieval and partial-failure behavior, not successful arXiv access in this environment.

The stale screen reported during this update came from a v0.1.0 process that remained running while its development release bundle was replaced. Its single-instance lock refocused that existing process when another copy opened. Normal quit followed by opening the newly installed build resolves the version mismatch; the application name and workspace location are unchanged.

## Installer checks

- Final Apple Silicon app launch and Scholar checks passed on the host Mac. Version 0.4.2 replaced the earlier app in the user Applications folder after a normal quit. The previous application bundle was retained as a backup, and the new bundle contents matched the packaged build. The workspace checksum was unchanged at installation. The running installed app visibly showed v0.4.2 and the two existing search snapshots. The isolated desktop screenshots verify the neutral Author default, eight sources, and the welcome heading on one line in a wide window.
- Final Intel app launch passed under the host's existing Rosetta installation; physical Intel hardware was not used.
- Both Mac DMGs and ZIP archives passed integrity checks. The Windows NSIS installer passed archive inspection and contains the expected x64 app.
- Bundled renderer, main process, and preload bytes match the final local build; application identifiers, version, icons, and production content-security policy were checked.
- Mac executables carry ad-hoc signatures, without Developer ID signing or notarization. Strict whole-bundle signature verification reports the missing resource seal in these unsigned builds; local launches succeeded. Windows executables have no signing certificate.
- `release/SHA256SUMS.txt` records checksums for the local distributables and source archive.

## Distribution limits

The project includes self-contained Mac Apple Silicon, Mac Intel, and Windows x64 packaging, plus native GitHub build and launch checks. Local packages are **unsigned and not notarized**. They should not be presented as a frictionless public release until signing and clean-machine testing are complete.

Windows installer creation and archive inspection do not establish that installation or execution works on Windows. The native Windows workflow must run after the project is placed on GitHub, and a clean-machine installer check is still needed. These local checks preceded GitHub publication; see GitHub Actions for subsequent native platform build results.

## Repeat the checks

```sh
npm ci
npm run typecheck
npm test
npm run format:check
npx playwright install chromium
npm run test:e2e
npm run test:desktop
npm run test:scholar
npm run dist:mac  # on macOS
npm run dist:win  # on Windows
node scripts/smoke-electron.mjs --packaged
node scripts/smoke-scholar.mjs --packaged
```

The native smoke uses an automatically removed temporary profile. It does not read or replace an existing user workspace. Browser tests use isolated browser contexts and synthetic fixtures; those fixtures are not shipped as example research data.

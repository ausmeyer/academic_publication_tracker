# Verification record — version 0.4.3

Checks were performed on macOS Apple Silicon on September 14–15, 2026, using Node.js 26.7.0 and npm 11.19.0. The GitHub workflow also specifies native macOS and Windows runners with Node.js 24.

## Version 0.4.3 Mac packaging correction

The installed v0.4.2 app and original local Mac bundle failed strict signature verification with “code has no resources but signature indicates they must be present.” The installed app carried Chrome quarantine metadata. This was a packaging defect, not an acceptable unsigned-build outcome; the earlier local launch checks did not test downloaded-app trust.

- Both rebuilt Mac app bundles pass complete, strict signature verification. Apple Silicon and Intel (under Rosetta) packaged desktop checks pass; the Apple Silicon packaged Scholar checks pass.
- Both final v0.4.3 DMGs pass integrity verification. Apps copied from each DMG pass strict signature, stapled-ticket, and Gatekeeper checks after adding quarantine metadata to simulate an internet download. Both copied apps pass the isolated desktop smoke check (Intel under Rosetta). Both final ZIPs pass integrity checks; their extracted apps pass distribution verification and contain the same application bytes as the corresponding DMGs.
- A disposable copy with an altered `app.asar` is correctly rejected by the new verification script. Distribution mode also correctly rejects an ad-hoc preview.
- Gatekeeper rejects the ad-hoc preview as expected. Both subsequent Mac bundles are signed with a valid Developer ID Application certificate, secure timestamps, and hardened runtime. Complete strict signature and Apple trust-chain checks pass. Packaged desktop checks pass on Apple Silicon and Intel under Rosetta; packaged Scholar checks pass on Apple Silicon. The final notarization and quarantined-installer checks are recorded below. No system security setting or quarantine exception was changed.
- The final “Open Source” footer is included in the signed apps. Both exact app bundles submitted through Xcode pass strict resource-seal checks and packaged desktop launch checks (Intel under Rosetta). The final Apple Silicon and Intel submissions uploaded successfully at 22:45 and 22:46 CDT on September 14. On September 15, Apple approval tickets were successfully retrieved, stapled, and validated for both exact submitted apps. Gatekeeper accepts both with `source=Notarized Developer ID`. The final DMGs and ZIPs package these approved apps without rebuilding or re-signing them.
- Google Drive added disallowed Finder metadata during a local in-place build. Final candidate bundles were built outside the synced directory, and only installer archives are copied back.
- The first GitHub workflow passed Windows builds and packaged tests; its Mac packaging failed because missing signing secrets became empty certificate paths. After the workflow removed empty values and explicitly selected preview or distribution signing, [both native platform jobs passed](https://github.com/ausmeyer/academic_publication_tracker/actions/runs/34890499980), including packaged desktop and Scholar checks.

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

## Earlier v0.4.2 installer checks

- Final Apple Silicon app launch and Scholar checks passed on the host Mac. Version 0.4.2 replaced the earlier app in the user Applications folder after a normal quit. The previous application bundle was retained as a backup, and the new bundle contents matched the packaged build. The workspace checksum was unchanged at installation. The running installed app visibly showed v0.4.2 and the two existing search snapshots. The isolated desktop screenshots verify the neutral Author default, eight sources, and the welcome heading on one line in a wide window.
- Final Intel app launch passed under the host's existing Rosetta installation; physical Intel hardware was not used.
- Both Mac DMGs and ZIP archives passed integrity checks. The Windows NSIS installer passed archive inspection and contains the expected x64 app.
- Bundled renderer, main process, and preload bytes match the final local build; application identifiers, version, icons, and production content-security policy were checked.
- Mac executables carry ad-hoc signatures, without Developer ID signing or notarization. These v0.4.2 bundles had a missing resource seal despite successful local launches; this defect is addressed by the v0.4.3 checks above. Windows executables have no signing certificate.
- `release/SHA256SUMS.txt` records checksums for the local distributables and source archive.

## Distribution limits

The project includes self-contained Mac Apple Silicon, Mac Intel, and Windows x64 packaging, plus native GitHub build and launch checks. The v0.4.3 Mac apps have valid Developer ID signatures and stapled Apple notarization tickets. Both final DMGs and ZIPs pass integrity and extracted-app verification; both quarantined DMG copies pass Gatekeeper and launch checks. Apple Silicon was tested natively and Intel under Rosetta; a separate clean Mac and physical Intel hardware were not used. Windows remains an explicitly unsigned preview. These statuses must be stated accurately on the download page.

The [final native workflow](https://github.com/ausmeyer/academic_publication_tracker/actions/runs/34928101947) passes on macOS and Windows. On Windows, it installs the exact generated NSIS installer silently into a temporary directory on the fresh runner and then launches the installed app with an isolated test profile. The installation and desktop checks pass. This verifies automated installation and launch, not manual wizard interaction or SmartScreen behavior on a consumer PC. The published Windows installer remains unsigned.

## Release provenance

The final Mac apps contain application code from `a336df362d0691daee5791f43d622a6d71bac3e1`. The Windows installer is the exact artifact from successful native workflow run `34928101947` at `dcf1a1b8af096134b8db2b504ca8d0f8893a808f`; the intervening changes only affect CI and documentation. The release source archive includes the final documentation updates. `SHA256SUMS-0.4.3.txt` accompanies the release downloads.

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

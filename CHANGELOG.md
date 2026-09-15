# Changelog

## 0.4.3 — 2026-09-15

- Fix the Mac signature resource seal that caused the damaged-app warning in v0.4.2.
- Distribute Developer ID-signed, Apple-notarized apps for Apple Silicon and Intel Macs.
- Verify complete signatures, notarization tickets, and Gatekeeper acceptance before Mac distribution.
- Verify Windows installation and installed-app launch on the native GitHub runner; Windows remains an unsigned preview.
- Include native desktop screenshots in GitHub build artifacts.
- Simplify the footer to “Open Source.”

## 0.4.2 — 2026-09-14

- Wait for Scholar results and pagination links to settle before collecting a page.
- Retain partial records with an explicit error if the page keeps changing.
- Preserve Scholar's approximate match count and flag potentially incomplete collections.
- Regression coverage for a page that initially shows four records before exposing 43 across five pages.

## 0.4.1 — 2026-09-14

- Welcome heading uses one line when space permits and wraps naturally on smaller windows.
- Search dialog tabs follow the main screen order: Author, Topic or title, DOI.
- New search opens in Author mode; topic-specific entry points keep Topic or title selected.
- Case and spacing variants of Scholar author names send the same normalized query; saved names retain their original spelling.
- Right-click saved searches in the sidebar or library to open, rename, or delete them.
- Keyboard menu support and confirmation before deleting the selected snapshot; other searches remain intact.

## 0.4.0 — 2026-09-14

- Internal Google Scholar searches with automatic, paced result-page collection.
- Publication/page progress, stop-and-keep, and cancel controls in the tracker.
- A dedicated verification window appears when Google requires user attention.
- Partial results retained on interruptions, with bounded navigation and clear coverage notices.
- No runtime LLM, external search service, or additional installation required.

## 0.3.0 — 2026-09-14

- Eight source choices, with Google Scholar visibly included in the search dialog.
- Combined Preprints search across arXiv, Europe PMC preprints, and Crossref preprint records, including indexed bioRxiv/medRxiv records.
- Public DataCite discovery for datasets, software, preprints, and other DOI research outputs.
- Original citation provenance, balanced capped preprint results, and clear partial-provider notices.
- Continued compatibility with earlier arXiv searches and empty, neutral author-search prompts.
- Packaged-app checks verify the source choices and placeholder users actually see.

## 0.2.0 — 2026-09-14

- Google Scholar browser with explicit page imports for search results and author profiles.
- Scholar citation counts, page provenance, duplicate handling, and saved collection metrics.
- Isolated Scholar browsing with user-controlled navigation and verification.
- Empty author searches with a neutral prompt, without a personal name as the example.
- Regression checks for Scholar page parsing, desktop isolation, and collection persistence.

## 0.1.0 — 2026-09-14

Initial desktop release of Academic Publication Tracker.

- Consistent macOS and Windows interface with self-contained installers.
- Topic, author, and DOI discovery through six documented scholarly APIs.
- Saved, named search snapshots and refreshes that preserve earlier results.
- Conservative duplicate matching with retained source provenance.
- Publication screening, local filtering and sorting, notes, and tags.
- Source-specific citation counts, h-index, g-index, i10-index, coverage, and publication-year charts.
- CSV, BibTeX, RIS, and JSON interchange, plus full workspace backup and restoration.
- Local storage, recovery copies, operating-system encryption for API keys, and a sandboxed desktop interface.
- Automated unit, browser, desktop-launch, and native platform packaging workflows.

See [verification notes](docs/VERIFICATION.md) for live-source coverage, unsigned builds, and remaining platform release checks.

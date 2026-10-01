# Changelog

## 0.5.0 — 2026-09-30

### Workspace format

- The workspace file is now version 2. Files are written as compact JSON, and the 25 MB limit is measured on that compact form (500 saved searches, 20,000 publications per search, 100,000 in all). Earlier apps (0.4.3 and before) refuse a version 2 file instead of silently discarding what they do not understand. The first time a version 1 workspace is replaced, the exact old file is kept as `workspace.json.v1.bak` (see the recovery notes in `docs/RELEASING.md` if you need to go back).
- Provider and imported records are shortened to the workspace limits when they arrive, so one unusual record can no longer make a whole search unsaveable. Validation errors now name the saved search and record.

### Searching and providers

- Crossref and OpenAlex: DOIs that contain `<` and `>` or end in `#` (older Wiley and other SICI-style DOIs) are kept whole, linked correctly, found in DOI mode, and merged with the copy from the other index; journal issues, peer-review reports, grants and other non-publication records no longer use up the result limit or appear as "Untitled record".
- Erratum and retraction notices, peer-review reports, grants, journal issues and components from any source are kept but excluded by default, with a count in the source notice; records without a title are skipped in topic and author searches.
- PubMed records with many publication types no longer make a whole search fail; funding labels are dropped from the type.
- Europe PMC returns authors as full names ("Nicholas G Reich") instead of "Reich NG", and year filters use the publication year. OpenAlex author searches ask for the most-cited works first, so a result limit keeps the papers that matter for the h-index.
- DataCite topics containing colons, quotes or slashes are searched literally (`<`, `>` and `=` cannot turn them into range queries); PubMed, Europe PMC and DataCite author searches send surname-first variants; Crossref and DataCite author screening accepts initials, omitted middle names, diacritics and surname particles, and no longer lets a name typed surname-first admit other people ("Austin G Meyer" no longer keeps "George Austin").
- arXiv ignores punctuation-only words and stores ids without a version suffix; Semantic Scholar year filters use the documented range format, and hyphens in topic words are sent as spaces as its documentation requires.
- Author screening keeps the same given name written with other syllable spacing ("Wang Xiaoming" keeps "Xiao-Ming Wang"), a surname typed alone with a capitalised particle ("Van Dijk", "Das Gupta") keeps its bylines, and a second-surname reading of Spanish names can no longer make different people an exact match.
- Names are matched more carefully everywhere (duplicates, author screening, Insights): "Bin Wang" and "Van Nguyen" are given names, "Ivanov IV" and "Smith JR" are initials rather than suffixes, "Yi-An" is not "Yi", "WANG Wei", "Müller"/"Mueller" and Spanish double surnames match their other spellings.
- Titles and abstracts are cleaned of markup and entities (DOIs and links never are); abstracts keep their paragraphs. Responses over 64 MB are refused, and requests identify the app with its real version.

### Duplicates, imports and exports

- Duplicate merging no longer depends on record order and matches the same author across name forms and accents, without joining "John Smith" and "Jane Smith" on a shared initial. A merged record keeps every member's tags and notes, and an excluded member keeps it excluded (except an erratum or similar typed copy of a real article); a placeholder title or type never replaces a real one. Refreshing a search carries notes, tags and inclusion choices over one-to-one, and a record that replaces several earlier duplicates takes their combined curation instead of losing it; old uncurated errata and peer-review reports from 0.4.3 stay excluded.
- Import reads comma, semicolon and tab delimiters, UTF-16 and Windows-1252 files, empty first and last cells, and the usual column names from Zotero, Scopus, Dimensions, OpenAlex, Publish or Perish and Web of Science. Columns it does not recognize and the number of duplicates merged are reported; yes/no values, years and BibTeX accent commands are handled, and a pathological file can no longer hang the app.
- Keywords with commas ("Influenza, Human") survive a BibTeX export and import; a refresh keeps the exclusion, notes and tags of every paper whose results are unchanged, including a journal article, its preprint and a Scholar copy; a merged erratum and article keep the article's title and year; a Web of Science title that opens a quote can no longer swallow the rows after it.
- Importing Web of Science files works (quotes in titles, the `ID` column), "et al." is no longer imported as an author, `|`-separated authors (OpenAlex) are split, a Dimensions preamble line is skipped, `~` in BibTeX names is a space, and a stray bad byte no longer turns every accent in a UTF-8 file into garbage. A JSON export re-imports without silent truncation, and pasted doi.org links keep a final `#`.
- BibTeX and RIS exports use the right entry type for each kind of work (article, conference paper, chapter, book, thesis, report) instead of `@misc` for most records. A CSV cell that begins with an apostrophe survives a round trip.

### Research Insights

- Author names in every form providers use (`Given Family`, `Family, Given`, `Family INITIALS`) are classified, including hyphen, spelling, umlaut and particle variants (compound surnames such as "Garcia de la Cruz" too); papers that cannot be classified are listed for review, initial-only matches first.
- Insights author reviews and annual counts also follow a paper matched only by title and year on refresh, author names containing a semicolon survive the authors template, import errors name the real spreadsheet row, quartile counts are printed under each role bar, and the citations-per-year span ignores a mistyped year.
- Re-importing an untouched authors template no longer overwrites saved author reviews; blank rows in the annual and ranking templates are skipped and every import error names its row and column. First, second and corresponding-author overrides apply to shortened author lists. A refresh keeps reviews and annual counts attached to a paper even when its key changes (an arXiv id losing its version, a record gaining a DOI).
- A change the workspace cannot hold is reported as a failure instead of "Saved". Reviews can be saved before an author is applied, and switching to a different author asks before clearing role overrides.
- Exports include a header with the snapshot, settings and date; CSV and template files open correctly in spreadsheets; values are rounded sensibly. The JSON export is a fraction of its former size.
- Annual citations use dated, in-range papers as the denominator, mark the current year as year to date, and ignore rows that cannot belong to a paper. Charts fill gaps between years, leave a mistyped year out instead of stretching the axis, and show bar values only when they fit; the quartile chart has a text alternative. Journals that differ only in capitalization or spacing are grouped. The top cards show “—” instead of 0 when no paper has a citation count.
- Analysis runs only when the Insights view is open, and is much faster for large publication lists.

### Interface

- Notes save automatically as you type and are flushed when you leave the field, switch papers or quit. Tags are chips you add and remove one at a time, so imported keywords that contain commas are no longer split apart.
- Results that cannot be saved (size, 500 searches, 100,000 papers, a bad record) stay in a banner you can retry, export, or make room for; several sets can be held at once and a later search or import never drops them; making room deletes nothing unless the results then fit; a warning appears above 90% of any limit. Escape or an outside click asks before discarding typed input; a failed search reopens the dialog with its query, or reports in the error banner when another dialog is open.
- An edit the workspace refuses (a note, tag or name when it is full) is kept on screen, counted as unsaved, retried, and asked about at quit instead of being dropped; form errors sit above the dialog buttons, the sticky dialog footer never hides the control you tabbed to, an IME's confirming Enter no longer adds a tag, a half-typed tag is not added just because you switched apps, and the refresh note no longer claims a removed snapshot is kept.
- Dialogs trap focus and return it to their opener; the library filter ignores accents and word order; results-per-source snaps to the available choices; Edit and Refresh are disabled, with reasons, for imported searches.
- Text is never smaller than 11 px and everything, including excluded rows, meets 4.5:1 contrast; focus indicators are stronger, click targets are at least 24 px, and Windows High Contrast is supported. Buttons no longer contain block elements, the API-key fields have their own labels, and state is announced to screen readers. Dialog buttons stay in view at the smallest window size, the New search shortcut is Cmd+K on a Mac and Ctrl+K elsewhere, and the library view no longer recomputes every saved search on each change.
- Saved searches show their date, time and count; the import message reports merged duplicates; the about box and footer show the real version.

### Desktop app and security

- Answering "Go back" to a quit or close question keeps a waiting Google Scholar search and its collected results; the window-not-responding dialog names unsaved work a reload would lose.
- Notes typed but not yet saved are flushed before the window closes or the app quits, even if you never left the field. If search results or edits could not be saved, closing the window or quitting asks first (Go back or Quit without saving).
- Saving is more durable: files are flushed to disk before they replace the old one, a save that changes nothing no longer rotates the recovery copy, the recovery copy is the exact previous file and only a readable file replaces it, and every unreadable file is kept before anything overwrites it. A banner tells you when the workspace was restored from its backup.
- "Reload app" works again (navigation blocking had swallowed the reload), and a crashed or unresponsive window reloads itself or offers Wait or Reload. Settings with missing keys no longer block searches; they run without API keys and say so. Error messages no longer start with Electron's "Error invoking remote method" text.
- Provider requests use Electron's network stack, so they follow the operating system's proxy and certificates. Files you import are decoded in the main process (UTF-8, UTF-16, Windows-1252) under the 25 MB limit.
- Google Scholar: the citations-per-year count no longer mistakes a year-like number in an arXiv identifier for a year; ordinary queries such as "error correction" are no longer mistaken for a verification page, and a search with no results is reported as empty; Google's cookie-consent page is handled as a user step (tested with synthetic pages only); one in-memory session is wiped before and after each search instead of leaving one behind per search; quitting while Scholar only waits for you asks first.
- The packaged app ignores `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`, loads only from its integrity-checked archive, and encrypts cookies; macOS entitlements are reduced to what V8 needs; the spell checker is off on Windows and Linux.

### Build and release

- `app.asar` shrinks from about 2,100 entries to 13 (684 KB), and the package ships `THIRD_PARTY_LICENSES.txt` for the libraries it bundles.
- Electron 44.5.1; `npm audit` reports no vulnerabilities.
- The release workflow pins every action to a commit, has time limits, checks that the tag matches `package.json` and `package-lock.json`, and uploads to an existing draft without touching a published release.

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

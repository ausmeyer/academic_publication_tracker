# Research Insights

These features are included in the v0.5.0 release candidate; the published v0.4.3 installers do not contain them. To run the source tree locally, from the repository directory run:

```sh
npm run desktop
```

This builds and launches Electron without packaging, signing, notarizing, or publishing. Close an older running copy first. `npm run dev` runs a browser preview at http://127.0.0.1:5173; browser and desktop workspaces are separate.

## Analyze a saved publication set

Open a saved search or import publication records, then choose **Research insights**. Author analysis works for author searches, topic searches, and imports. CSV, TSV, JSON, BibTeX and RIS publication imports are supported.

In **New search**, you can select **Google Scholar and PubMed together**, or combine Scholar with other API sources. API searches run first, followed by Scholar collection. DOI matches and conservative title/year/author matches are merged into one snapshot. Complete author lists are preferred, and citation counts remain attributed to their original sources. PubMed author metadata does not replace Scholar's citation count. A provider failure leaves successful results available with a notice. Canceling Scholar discards the current combined desktop search; stopping Scholar keeps partial Scholar results alongside the API results.

This combined collection requires the desktop app. The browser preview saves API results and opens Scholar externally; it does not automatically import Scholar records. An existing Scholar-only snapshot keeps its original sources on Refresh: start a new search with both sources selected to cross-reference it. Search limits and unmatched metadata can still leave papers incomplete.

Enter the **Author to analyze**, add confirmed name variants separated by semicolons, and select **Apply analysis**. Author searches prefill the searched name. The optional publication-year range controls all Insights metrics and charts, without removing records or changing Overview. Papers without a year are excluded while a range is set, and the page says how many.

The page includes:

- Publication and lifetime-citation timelines; a separate calendar-year citation timeline. Years without papers appear as empty columns; a mistyped year far from the rest is left out (and listed) rather than stretching the axis, and bar values are shown only while they fit their columns.
- Publication/citation bars by author role, stacked by journal quartile when supplied; the counts per quartile are printed under each bar as text.
- Publication and citation percentage shares, including an unclassified group.
- Citation distributions with median, quartiles, range, mean, and known-count sample sizes. Violin densities use log(1 + citations); fewer than three counts show individual points instead.
- Raw h-indices by role, weighted h-indices, experimental Sh-index, raw and weighted medians, known zero-citation counts, and identifiable preprints.
- CSV/TSV exports of per-paper calculations, and a JSON export with a header (application version, snapshot name, query and search date, citation source, author and aliases, year range, weighting convention), the settings, all summary statistics, and a per-paper summary. The JSON export is written compactly, lists retraction notices once (in the settings), and leaves out notes, abstracts, tags and provenance; use a workspace backup to keep those. The CSV and TSV exports and all templates are UTF-8 with a byte-order mark so spreadsheets read accents correctly (the JSON export is plain UTF-8), and weights are rounded to six decimals.

Changing controls only reads saved data. Searches and Refresh remain explicit data-retrieval operations. No Insights action requests Google Scholar pages.

## Review author information

Expand **Review author lists and roles**. A full author list uses semicolons between names. Confirm its completeness and optionally select a verified role override, including corresponding author or joint first author represented as first author. Overrides apply to the selected analysis author. Respelling the same author keeps them; switching to a different author asks for confirmation before clearing the role overrides, and corrected author lists are always kept. A review can be saved before any author has been applied.

Names may be written `Given Family`, `Family, Given` or `Family INITIALS` (the PubMed and Europe PMC form, such as `Reich NG`). Compatible initials are matched in given-name order, including compact Scholar spellings such as `AG Meyer` for `Austin G Meyer`; diacritics, hyphen and space variants, name suffixes (Jr., III) and surname particles (van der, de la) are ignored. Initial-based matches are labeled for identity review and listed first in the review list, followed by the unclassified papers; conflicting names or multiple candidates remain unclassified. Add a confirmed alias to record a verified spelling. Shortened lists can establish first or second position, so first, second and corresponding-author overrides apply to them; sole, middle and last overrides, later positions and team-size-dependent weights require a complete list, and the review form says so when an override cannot be applied. New Scholar captures preserve truncation information. Position alone is not a measure of contribution.

Roles are mutually exclusive. For two-author papers with a complete author list the second position is last author. Corresponding authorship requires a confirmed override. The optional GScholarLENS convention gives last authors the corresponding-author weight without relabeling them as confirmed corresponding authors.

## Supply annual counts and reference datasets

Expand **Import local analysis data**, choose a data type, download its template, fill verified values, and import it. CSV/TSV or a normalized JSON array is accepted. Files must be smaller than 25 MB. Unmatched paper rows are reported; invalid or conflicting duplicate records reject the import without changing the saved data. A paper key is its DOI, or its workspace ID when it has no DOI; imports also accept its workspace ID. The authors template is prefilled with each paper's saved review (authors, completeness and role) or, without one, the record's own authors, and rows identical to that are skipped and counted as unchanged, so re-importing an untouched template changes nothing; an emptied role cell clears the role. An author name that contains a semicolon, or spaces at either end, turns that cell into a JSON list, which import accepts. Template rows left blank in the annual-citation and ranking templates are skipped and counted, and every validation error names its row and column (for example `Row 2, citations: …`); annual sources can be written in any case. Limits: 20,000 rankings, reviews or notices, 100,000 annual-citation rows, and 100 aliases.

| Dataset          | Required columns                      | Matching and interpretation                                                                                                |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Author reviews   | `key,authors,complete,role`           | Semicolon-separated authors; `complete` is true/false; role is optional: sole, first, second, middle, last, corresponding. |
| Annual citations | `key,year,citations,source`           | Actual citations received in that calendar year. One record per paper/year/source. Include explicit zeroes.                |
| Journal rankings | `venue,year,category,quartile,source` | Q1–Q4 for that journal and publication year. Journal names match ignoring case/spacing. Conflicting ranks remain Unknown.  |

The annual chart divides by the dated, in-range papers published by each year. Papers without a year are left out of the annual series and counted beside it. Rows dated before a paper's publication year or after the current year are ignored (and counted in the “Saved” line), and an import rejects rows for future years. The current year is drawn hatched and marked with an asterisk because it is year to date.

Annual citation sources use the app identifiers: `scholar`, `openalex`, `crossref`, `europepmc`, `pubmed`, `semantic`, `arxiv`, `preprints`, `datacite`. Combined counts take the highest supplied value for each paper/year, not the sum across sources. Selecting a source filters both annual and lifetime calculations. Missing annual rows remain unknown, so partial coverage is displayed beside the chart.

New OpenAlex searches retain `counts_by_year` when returned by the API. OpenAlex history can be limited to recent years; this app retains explicit rows and does not fabricate missing historical counts. Imported annual rows override native history for the same paper/year/source. Lifetime totals alone cannot reconstruct annual history.

An import keeps only the journals that appear in this snapshot and reports how many rows it skipped; an import with no matching journal is an error. Rankings must retain year, subject category and source. Prepare a consistent category-specific extract from your ranking dataset; an undated or best-quartile value is not silently treated as a publication-year category rank. No ranking database is bundled.

The retraction display and import controls have been removed. Previously saved notice data remains in workspace backups. Workspaces saved by earlier versions, including ones whose Insights settings are missing some lists or flags, open normally.

Imports update matching keys and retain other saved records. Settings and reference data persist in workspace backups and carry into refreshed snapshots; paper-specific data reconnects by DOI, shared provider record (for example an arXiv ID that lost its version), stable workspace ID or, failing those, a single record with the same title and year that merging would join. Ordinary publication exports do not contain snapshot-specific author reviews or reference tables: use a workspace backup to preserve everything.

## Experimental weighting

The [GScholarLENS paper](https://arxiv.org/abs/2509.04124) describes heuristic weights and a standard h-index calculation on weighted citation counts. This implementation uses 100% for sole/confirmed corresponding authors, 90% first, 50% second, and 25% for other roles in teams of at most six or 10% in larger teams. The optional last-author convention changes the last-author weight to 100%. In a two-author paper the second author is classified as last author, so without that convention they receive the 25% weight of other roles rather than the 50% second-author weight. Teams of exactly six authors use the 25% tier; the source paper's abstract leaves that size unspecified. The last-author convention is off by default. Weighted calculations use only classified papers with known citation counts; they are not validated measures of contribution.

References: [GScholarLENS features](https://project.iith.ac.in/sharmaglab/gscholarlens/), [OpenAlex work attributes](https://help.openalex.org/data/works/attributes/).

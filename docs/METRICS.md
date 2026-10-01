# How Academic Publication Tracker calculates metrics

Metrics describe the **included publications in the current search**. They are not
automatically a complete author profile: source coverage, author ambiguity, search
limits, and manually excluded papers all affect the result. Use author identifiers
where supported, inspect the records, and report the source and retrieval date.

## Citation counts and missing data

Each publication retains source identifiers, citation counts, links, and retrieval
dates. A missing count is `null`; a reported zero is `0`. Coverage is the number of
included publications with a known citation count, out of all included publications.

The combined view uses the **largest known count for each publication**, never the
sum of counts from different databases. This is a transparent approximation, not a
deduplicated union of citing papers. The source selector uses counts from that
source's provenance only. Records without provenance can use their imported count
in the combined view; that count cannot be attributed to a particular database.
When several observations of a count are retained, the maximum is used; the app
does not infer that an undated observation is the newest one.

All indices and totals are observed lower bounds when counts are missing or a
search is incomplete. Means and medians use only publications with known counts.
When there are no known counts, aggregate numeric fields return zero for display;
**zero coverage means unknown, not evidence of no citations**; the Overview cards for citations, h-index and g-index then show “—”.

| Measure             | Definition                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Papers              | Number of included, merged publications.                                                                                                                                                                                                                   |
| Citations           | Sum of the selected per-publication counts.                                                                                                                                                                                                                |
| h-index             | Largest `h` for which at least `h` papers each have at least `h` citations.                                                                                                                                                                                |
| g-index             | Largest `g` for which the top `g` papers have at least `g²` citations in total; capped at the actual included paper count.                                                                                                                                 |
| i10-index           | Number of papers with at least 10 citations.                                                                                                                                                                                                               |
| Citations per paper | Citations divided by publications with known counts.                                                                                                                                                                                                       |
| Median citations    | Median among publications with known counts, including reported zeros.                                                                                                                                                                                     |
| Citations per year  | Citations divided by years from the earliest dated included publication through the current calendar year, inclusive; a year more than 120 years before the latest one, or later than next year, is taken for a mistyped date and does not start the span. |
| Annualized h        | h-index divided by that same inclusive publication-year span.                                                                                                                                                                                              |

Missing counts contribute zero only to the lower-bound h/g calculation. The
g-index convention here does not add fictitious zero-citation publications.
Annualized h is a descriptive rate with an explicit denominator, not an
author-normalized h-index or a field-normalized score. Rates are zero when no valid
past or current publication year is available. Undated publications still count
toward paper and citation totals, but do not establish the publication-year span.

Charts grouped by year show **publication years**. A publication's citation total
is its lifetime total observed at retrieval; it is not citations received in that
calendar year. The app cannot reconstruct annual citation trajectories from these
totals. Top venues count included publications with a nonempty venue name; spellings that differ only in capitalization or spacing are counted together (punctuation still distinguishes them). Years without papers appear as empty columns so gaps stay visible; a chart draws at most 120 year columns and a note lists any years left out.

Foundational definitions: [Hirsch's h-index paper (2005)](https://arxiv.org/abs/physics/0508025)
and [Egghe, Theory and practise of the g-index (2006)](https://citeseerx.ist.psu.edu/document?doi=73f5c0b199f78e9d0b846350ac27c8a029907806&repid=rep1&type=pdf).

## Combined sources and research output types

Preprints combines arXiv, Europe PMC, and Crossref retrieval. Each record retains the original index's citation counts; the source selector uses those indexes, not an invented aggregate Preprints count. arXiv supplies no citation counts through this adapter.

DataCite results can include datasets, software, and other research outputs as well as papers. The app's included-record totals and indices apply to that chosen collection. DataCite counts use Event Data DOI citation/reference relationships, including supplementary relationships, rather than a universal citation graph. Check the record types and source before comparing collections. [DataCite definitions](https://support.datacite.org/docs/consuming-citations-and-references).

## Duplicate handling

DOIs are normalized to lowercase identifiers. A link at doi.org (with or without `https://`, `www.` or `dx.`) loses its query, fragment and trailing slash (a final `#` or `?` with nothing after it stays, because some real DOIs end that way); a `doi:` prefix is removed and percent-encoding is decoded. Bare text that starts with `10.` is taken whole, because real DOIs can end in `#` or contain `<`, `>`, `;` and `?`; only a trailing comma, a period after a letter or digit, and an unmatched closing bracket are dropped as sentence punctuation. Equal DOIs merge even when source titles differ. Records sharing a stable identifier from the same provider also merge, including sparse metadata, unless the connected records have conflicting DOIs. Europe PMC's `MED:<id>` record counts as the same key as PubMed's `<id>`, and an arXiv id with a version (`v2`) is the same key as the unversioned id. This handles overlap between combined Preprints and a directly selected index. Arbitrary imported record IDs alone are not identity evidence.

In the absence of identifier evidence, a title match requires the same publication year, a normalized title of at least 24 characters (capitalization, punctuation and diacritics are ignored), and an overlapping author name that the name matcher accepts: the same surname with compatible given names or initials, or a complete single name. `Reich NG`, `Nicholas G. Reich` and `Reich, Nicholas` count as the same author, as do accented and unaccented spellings and `Müller`/`Mueller`; the same surname and first initial alone is not enough (`John Smith` and `Jane Smith` are different people). Unknown-year or short-title records are kept separate.

Different DOIs always remain separate. A title-only record that could belong to multiple DOI groups remains separate too, so it cannot connect two different papers. This deliberately favors missed duplicates over false merges; metadata alone cannot resolve every identity ambiguity. Which records merge does not depend on their order; the ID, title and other descriptive fields come from the first record.

A merged record shares its members' curation: tags are united, distinct notes are kept (joined by a blank line), and if any member was excluded the merged record is excluded. The exception is a member that is excluded only because it is an erratum, peer-review report, grant, issue or component (and has no notes or tags): it does not exclude a merged publication that also has a member of a publication type, and the merged record takes the type, title, year, venue, abstract and links of the first member that names a publication. The first record's ID and other descriptive fields survive, except that a placeholder title (`Untitled record`) or type (`publication`) never displaces real metadata from another member. Missing metadata is filled, longer author lists may replace shorter ones, and source provenance is retained: at most 100 entries per publication, always including the one with the highest citation count.

When a refresh produces a new snapshot, each new record inherits the combined notes, tags and inclusion choices of the earlier copies of the same paper (up to 20): excluded if any copy was excluded, tags united, distinct notes kept. DOI and provider-ID matches come first. A new record found that way also inherits an earlier copy that matches it only by title, if no other new record matches that copy and it merges with the copies found by identifier. A new record without such a match inherits by title, but never an earlier copy that another new record matches by DOI or provider ID. An earlier record claimed by several new ones carries nothing over. An earlier erratum, peer-review report, grant, issue or component that is included but has no notes or tags counts as the default of the previous version, which included everything, so its new copy stays excluded; add a note or a tag to keep such a record included.

## Import and export

- **JSON** is the lossless publication format: it preserves provenance, citation
  counts, notes, tags, inclusion, and open-access metadata. A publication export is
  an array of works; a workspace backup is restored through Import, which
  recognizes the backup file.
- **CSV and TSV** preserve those fields too, using quoted fields, UTF-8 with a BOM,
  JSON for tags/provenance, and semicolons between authors (JSON author lists when a
  name itself contains a separator). The delimiter (comma, semicolon or tab) is
  detected from the first row, and a `.tsv` file is read as tab-separated. Embedded
  quotes, line breaks and empty first or last cells are supported. Exports prefix
  text that starts with a formula character (`=`, `+`, `-`, `@`, also after leading
  whitespace), a tab or a carriage return, or with apostrophes followed by one of
  these, with one extra apostrophe so spreadsheets do not run it; the importer
  removes exactly one.
- **BibTeX** supports braced/quoted values, nested braces, author lists, common
  bibliographic fields (including biblatex `journaltitle`), and literal
  concatenation; `and others` marks an author list as incomplete. Keywords are written separated by semicolons (with a closing one when a tag itself contains a comma, so such a tag survives a round trip) and read back on semicolons when any are present, otherwise on commas. TeX accent
  commands such as `{\"o}` and `\'{e}` are converted to Unicode. Exports escape
  special TeX characters, preserve Unicode, and generate stable unique citation
  keys. This is a bibliography interchange parser, not a TeX interpreter: custom
  string macros, cross-reference inheritance, and arbitrary TeX commands are not
  expanded.
- **RIS** supports multiple records, repeated authors and keywords, and
  continuation lines. Each record must begin with `TY` and end with `ER`.
  Line breaks in exported fields are flattened to keep metadata from becoming
  structural tags.

Exports follow the kind of work. BibTeX writes articles, reviews, editorials and
notices as `@article` (journal), conference papers as `@inproceedings`, book
chapters as `@incollection`, books as `@book`, theses as `@phdthesis` or
`@mastersthesis`, reports as `@techreport`, and everything else (preprints,
datasets, software) as `@misc`. RIS writes `JOUR`, `CONF`, `CHAP`, `BOOK`, `THES`,
`RPRT`, or `GEN`. Imports read these entry types and the common RIS type codes
back into the app's kinds of work. Some kinds have no entry type of their own, so a
BibTeX or RIS round trip returns them as a more general kind: reviews and editorials
as articles, and preprints, datasets and software as other.

Common column names from reference managers and databases are recognized on CSV
and TSV import, including Zotero, Scopus, Dimensions (the full-record CSV export),
OpenAlex (`display_name`, `authorships.author.display_name`,
`primary_location.source.display_name`, `cited_by_count`), Publish or Perish and
Web of Science exports. The first filled column wins when several name the
same field, and columns the app does not recognize are listed in the message shown
after the import rather than dropped silently. `Included` accepts yes/no, y/n and
1/0; any other text leaves the paper included and is reported. Comma-separated
author lists are split only when they hold three or more full names or names with
initials, and `|` also separates authors. A trailing "et al.", "..." or "…" is
dropped and marks the author list as incomplete. In tab-separated files a quote is
an ordinary character unless the whole cell is quoted (Web of Science titles
contain them; in a Web of Science file a quoted cell never spans cells or lines),
and the Web of Science `ID` (Keywords Plus) column is never the record ID. A Dimensions export's first line ("About the data…") is skipped, and in
BibTeX author names `~` is read as a space.

BibTeX and RIS carry standard bibliographic metadata; they do not preserve source
provenance, inclusion choices, or citation metrics. Use JSON or CSV when those
fields matter. JSON and CSV recompute the aggregate citation field from the
retained source counts so it agrees with the displayed combined count; the source
observations themselves are preserved.

Import files are limited to 25 MB and 20,000 publications and may be UTF-8, UTF-16
with a byte-order mark, or Windows-1252; a file stays UTF-8 when it has at least as many valid accented characters as bad bytes, and the bad bytes show as �. Imports validate title presence, numeric
values, source IDs, and HTTP/HTTPS links, and bound long fields and lists: years
must fall between 1500 and next year, author lists are cut at 10,000 names (a cut
list is marked incomplete), and text that is not a readable DOI is dropped with a
warning. A record with a missing or unreadable retrieval date receives the import
date. Errors that name a row count spreadsheet rows, blank rows and the Dimensions line included. Duplicates inside the file are merged and counted in the import message. No
imported bibliography text is executed.

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
**zero coverage means unknown, not evidence of no citations**.

| Measure             | Definition                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Papers              | Number of included, merged publications.                                                                                   |
| Citations           | Sum of the selected per-publication counts.                                                                                |
| h-index             | Largest `h` for which at least `h` papers each have at least `h` citations.                                                |
| g-index             | Largest `g` for which the top `g` papers have at least `g²` citations in total; capped at the actual included paper count. |
| i10-index           | Number of papers with at least 10 citations.                                                                               |
| Citations per paper | Citations divided by publications with known counts.                                                                       |
| Median citations    | Median among publications with known counts, including reported zeros.                                                     |
| Citations per year  | Citations divided by years from the earliest dated included publication through the current calendar year, inclusive.      |
| Annualized h        | h-index divided by that same inclusive publication-year span.                                                              |
| Open access         | Number of included papers explicitly marked open access by available metadata.                                             |

Missing counts contribute zero only to the lower-bound h/g calculation. The
g-index convention here does not add fictitious zero-citation publications.
Annualized h is a descriptive rate with an explicit denominator, not an
author-normalized h-index or a field-normalized score. Rates are zero when no valid
past or current publication year is available. Undated publications still count
toward paper and citation totals, but do not establish the publication-year span.

Charts grouped by year show **publication years**. A publication's citation total
is its lifetime total observed at retrieval; it is not citations received in that
calendar year. The app cannot reconstruct annual citation trajectories from these
totals. Top venues count included publications with a nonempty venue name.

Foundational definitions: [Hirsch's h-index paper (2005)](https://arxiv.org/abs/physics/0508025)
and [Egghe, Theory and practise of the g-index (2006)](https://citeseerx.ist.psu.edu/document?doi=73f5c0b199f78e9d0b846350ac27c8a029907806&repid=rep1&type=pdf).

## Combined sources and research output types

Preprints combines arXiv, Europe PMC, and Crossref retrieval. Each record retains the original index's citation counts; the source selector uses those indexes, not an invented aggregate Preprints count. arXiv supplies no citation counts through this adapter.

DataCite results can include datasets, software, and other research outputs as well as papers. The app's included-record totals and indices apply to that chosen collection. DataCite counts use Event Data DOI citation/reference relationships, including supplementary relationships, rather than a universal citation graph. Check the record types and source before comparing collections. [DataCite definitions](https://support.datacite.org/docs/consuming-citations-and-references).

## Duplicate handling

DOI URLs and DOI prefixes are normalized to lowercase DOI identifiers. Equal DOIs
merge even when source titles differ. Records sharing a stable identifier from the same provider also merge, including sparse metadata, unless the connected records have conflicting DOIs. This handles overlap between combined Preprints and a directly selected index. Arbitrary imported record IDs alone are not identity evidence. In the absence of identifier evidence, a title match
requires the same publication year, a normalized title of at least 24 characters,
and an overlapping author name (surname and first initial, or a complete single
name). Unknown-year or short-title records are kept separate.

Different DOIs always remain separate. A title-only record that could belong to
multiple DOI groups remains separate too, so it cannot connect two different
papers. This deliberately favors missed duplicates over false merges; metadata
alone cannot resolve every identity ambiguity. The first record's inclusion,
notes, tags, and ID survive a merge. Missing metadata is filled, longer author
lists may replace shorter ones, and source provenance is retained.

## Import and export

- **JSON** is the lossless publication format: it preserves provenance, citation
  counts, notes, tags, inclusion, and open-access metadata. A publication export is
  an array of works; workspace backups are restored through the separate backup
  workflow.
- **CSV** preserves those fields too, using quoted fields, UTF-8 with a BOM, JSON
  for tags/provenance, and semicolons between authors (JSON author lists when a
  name itself contains a separator). Common publication-column
  names are recognized on import. Embedded quotes and line breaks are supported.
  Formula-leading text is prefixed with an apostrophe for spreadsheet safety; the
  importer removes that protective apostrophe when reimporting such fields.
- **BibTeX** supports braced/quoted values, nested braces, author lists, common
  bibliographic fields, and literal concatenation. Exports escape special TeX
  characters, preserve Unicode, and generate stable unique citation keys. This is
  a bibliography interchange parser, not a TeX interpreter: custom string macros,
  cross-reference inheritance, and arbitrary TeX commands are not expanded.
- **RIS** supports multiple records, repeated authors and keywords, and
  continuation lines. Each record must begin with `TY` and end with `ER`.
  Line breaks in exported fields are flattened to keep metadata from becoming
  structural tags.

BibTeX and RIS carry standard bibliographic metadata; they do not preserve source
provenance, inclusion choices, or citation metrics. Use JSON or CSV when those
fields matter. JSON and CSV recompute the aggregate citation field from the
retained source counts so it agrees with the displayed combined count; the source
observations themselves are preserved. Import files are limited to 25 MB and 20,000 publications. Imports
validate title presence, numeric values, source IDs, and HTTP/HTTPS links, and
bound long fields and lists. No imported bibliography text is executed.

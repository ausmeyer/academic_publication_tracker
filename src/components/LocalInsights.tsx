import { useEffect, useMemo, useRef, useState } from 'react';
import type { InsightsSettings, SourceId, Work } from '../types';
import {
  type ExportContext,
  type InsightsAnalysis,
  type Role,
  authorListComplete,
  exportInsights,
  reviewRows,
  roleLabels,
  roleNeedsCompleteList,
} from '../core/insights';
import {
  datasetTemplate,
  hasTruncationMarker,
  importInsightsData,
  paperKey,
  roles,
  validateInsights,
  type Dataset,
} from '../core/insights-data';
import { foldText, nameMatch } from '../core/names';
import { client } from '../services/client';
import { formatNumber } from '../catalog';
import { filterTokens } from '../library';
import './insights.css';

const number = (value: number | null) => (value === null ? '—' : formatNumber(value));
const percent = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);
const quartileColors = ['#426e60', '#77a58d', '#b0cba4', '#dcc789', '#dce2da'];
const METHOD_URL = 'https://arxiv.org/abs/2509.04124';
/** Most matching publications offered in the review picker; the rest are reached by searching. */
const PICKER_LIMIT = 200;
/** Papers listed in the review table. */
const REVIEW_LIMIT = 50;

/** The same person spelled the same way (case, spacing, name order and accents aside). */
const sameAuthor = (a: string, b: string) => a.trim() === b.trim() || nameMatch(a, b) === 'exact';
const plural = (n: number, one: string, many: string) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;
/** A role's split by journal quartile, such as ["Q1 2", "Unknown 1"]. */
const quartileSplit = (g: InsightsAnalysis['groups'][number], measure: 'papers' | 'citations') =>
  g.quartiles.filter((q) => q[measure] > 0).map((q) => `${q.quartile} ${number(q[measure])}`);
/** The role chart in words: each role's total and its split by journal quartile. */
const roleChartText = (groups: InsightsAnalysis['groups'], measure: 'papers' | 'citations') =>
  groups
    .map((g) => {
      if (measure === 'citations' && !g.coverage) return `${g.label}: citations unknown`;
      const split = quartileSplit(g, measure);
      const total =
        measure === 'papers'
          ? plural(g.papers, 'publication', 'publications')
          : plural(g.citations, 'citation', 'citations');
      return `${g.label}: ${total}${split.length ? ` (${split.join(', ')})` : ''}`;
    })
    .join('; ');
/** What keeps a saved author list from counting as complete, and what to do about it. */
function completeListFix(review: { authors: string[]; complete: boolean }): string {
  const marker = review.authors.find((author) => hasTruncationMarker([author]));
  if (marker)
    return `The saved list still contains “${marker}”, which marks it as shortened: replace it with the missing authors to apply the role.`;
  if (!review.authors.length)
    return 'The saved list is empty: enter the full author list to apply the role.';
  return 'Confirm the list is complete to apply it.';
}

/** State that starts from `initial` and starts over whenever `signature` changes. */
function useResettable<T>(initial: T, signature: string) {
  const [value, setValue] = useState(initial);
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setValue(initial);
  }
  return [value, setValue] as const;
}

function Distribution({ analysis }: { analysis: InsightsAnalysis }) {
  const groups = analysis.groups.filter((g) => g.papers > 0);
  const upper = Math.max(1, ...groups.flatMap((g) => g.values));
  const logMax = Math.log1p(upper);
  const y = (v: number) => 155 - (Math.log1p(v) / logMax) * 130;
  return (
    <div className="insight-distribution">
      <svg
        viewBox={`0 0 ${Math.max(220, groups.length * 110 + 50)} 200`}
        role="img"
        aria-label="Citation distributions by authorship role, log one plus citations scale"
      >
        {[0, Math.expm1(logMax / 2), upper].map((tick, i) => (
          <g key={i}>
            <line
              x1="42"
              x2={groups.length * 110 + 45}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e5ebe2"
            />
            <text x="37" y={y(tick) + 4} textAnchor="end">
              {number(tick)}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const x = 100 + i * 110;
          const values = g.values.map((v) => Math.log1p(v));
          const bandwidth = Math.max(0.12, logMax / 12);
          const density = Array.from({ length: 41 }, (_, j) => {
            const value = (j / 40) * logMax;
            return values.reduce(
              (sum, v) => sum + Math.exp(-0.5 * ((value - v) / bandwidth) ** 2),
              0,
            );
          });
          const maxDensity = Math.max(1, ...density);
          const side = (sign: number) =>
            density.map((d, j) => `${x + ((sign * d) / maxDensity) * 27},${155 - (j / 40) * 130}`);
          return (
            <g key={g.role}>
              {g.values.length >= 3 && (
                <polygon
                  points={[...side(-1), ...side(1).reverse()].join(' ')}
                  fill="#c1d6c0"
                  stroke="#82a383"
                />
              )}
              {g.values.length > 0 && (
                <>
                  <line x1={x} x2={x} y1={y(g.min!)} y2={y(g.max!)} stroke="#3c6053" />
                  <rect
                    x={x - 6}
                    width="12"
                    y={y(g.q3!)}
                    height={Math.max(1, y(g.q1!) - y(g.q3!))}
                    fill="#7c9c77"
                  />
                  <line
                    x1={x - 10}
                    x2={x + 10}
                    y1={y(g.median!)}
                    y2={y(g.median!)}
                    stroke="#203f33"
                    strokeWidth="2"
                  />
                  {g.values.length < 3 &&
                    g.values.map((v, j) => (
                      <circle key={j} cx={x} cy={y(v)} r="4" fill="#426e60" />
                    ))}
                </>
              )}
              <text x={x} y="178" textAnchor="middle">
                {g.label.replace(' author', '')}
              </text>
              <text x={x} y="193" textAnchor="middle">
                n = {g.values.length}
              </text>
            </g>
          );
        })}
      </svg>
      <p>
        Log(1 + citations) includes zero. Boxes show the middle 50%; lines show the median and
        range. Smoothed violins appear for groups with at least three known counts.
      </p>
    </div>
  );
}

export default function LocalInsights({
  analysis,
  settings,
  works,
  source,
  onChange,
  snapshot,
}: {
  analysis: InsightsAnalysis;
  settings: InsightsSettings;
  works: Work[];
  source: SourceId | 'all';
  /** Saves new settings and returns whether they were persisted; anything but `true` is a failure. */
  onChange: (settings: InsightsSettings) => boolean;
  /** The snapshot being analysed; it fills the reproducibility header of the JSON export. */
  snapshot?: ExportContext['snapshot'];
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [kind, setKind] = useState<Dataset>('authors');
  const [measure, setMeasure] = useState<'papers' | 'citations'>('papers');
  const [selected, setSelected] = useState(works[0]?.id ?? '');
  const [reviewFilter, setReviewFilter] = useState('');
  const [pendingAuthor, setPendingAuthor] = useState<{
    next: InsightsSettings;
    overrides: number;
  } | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const applied = {
    author: settings.author,
    aliases: settings.aliases.join('; '),
    from: settings.yearFrom === undefined ? '' : String(settings.yearFrom),
    to: settings.yearTo === undefined ? '' : String(settings.yearTo),
  };
  const [draft, setDraft] = useResettable(applied, JSON.stringify(applied));
  const groups = analysis.groups.filter((g) => g.papers);
  const max = Math.max(1, ...groups.map((g) => g[measure]));
  // Once any paper has a quartile, each bar says in words which quartiles it is made of.
  const ranked = analysis.rows.some((r) => r.quartile !== 'Unknown');
  const selectedWork = works.find((w) => w.id === selected);
  const annotation = settings.annotations.find(
    (a) => a.key === (selectedWork && paperKey(selectedWork)),
  );
  const selectedResult = analysis.rows.find((r) => r.work.id === selected);
  const [review, setReview] = useResettable(
    {
      authors: (annotation?.authors ?? selectedWork?.authors ?? []).join('; '),
      complete: annotation?.complete ?? (selectedWork ? authorListComplete(selectedWork) : false),
      role: annotation?.role ?? '',
    },
    `${selectedWork?.id}|${settings.author}|${JSON.stringify(annotation)}`,
  );
  // Matched like the library filter: accents and case folded, every word anywhere in title or authors.
  const searchable = useMemo(
    () => works.map((w) => foldText(`${w.title} ${w.authors.join(' ')}`)),
    [works],
  );
  const matching = useMemo(() => {
    const tokens = filterTokens(reviewFilter);
    return tokens.length
      ? works.filter((_, i) => tokens.every((token) => searchable[i].includes(token)))
      : works;
  }, [works, searchable, reviewFilter]);
  const shown = matching.slice(0, PICKER_LIMIT);
  const toReview = useMemo(() => reviewRows(analysis), [analysis]);
  const knownCounts = analysis.citationCoverage > 0;
  const noNameMatched =
    settings.author.trim() !== '' && analysis.papers > 0 && analysis.nameMatches === 0;
  useEffect(() => {
    if (pendingAuthor) confirmButton.current?.focus();
  }, [pendingAuthor]);
  // The question was asked about these settings; if they change, it no longer applies.
  useEffect(() => setPendingAuthor(null), [settings]);
  async function action(fn: () => Promise<void>) {
    setError('');
    setMessage('');
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation failed.');
    } finally {
      setWorking(false);
    }
  }
  /** Saves new settings; `success` is shown only when they were really persisted. */
  function commit(next: InsightsSettings, success: string): boolean {
    try {
      validateInsights(next);
    } catch (e) {
      setMessage('');
      setError(e instanceof Error ? e.message : 'These settings are not valid.');
      return false;
    }
    let saved: boolean;
    try {
      saved = onChange(next);
    } catch (e) {
      setMessage('');
      setError(e instanceof Error ? e.message : 'This change could not be saved.');
      return false;
    }
    if (saved !== true) {
      setMessage('');
      setError(
        'This change was not saved and the analysis settings are unchanged. The reason is shown at the top of the window.',
      );
      return false;
    }
    setError('');
    setMessage(success);
    return true;
  }
  const applyControls = (next: InsightsSettings) =>
    commit(next, 'Analysis updated from saved publications. No new data was retrieved.');
  async function importData() {
    await action(async () => {
      const file = await client.importFile();
      if (!file) return;
      const result = importInsightsData(settings, kind, file.content, works);
      const notes = [
        result.unchanged && `${formatNumber(result.unchanged)} unchanged (already in effect)`,
        result.ignored &&
          `${formatNumber(result.ignored)} dated before their paper's publication year ignored`,
        result.blank && `${plural(result.blank, 'blank row', 'blank rows')} skipped`,
        result.skipped &&
          (kind === 'rankings'
            ? `${formatNumber(result.skipped)} for journals not in this snapshot skipped`
            : `${plural(result.skipped, 'unmatched record', 'unmatched records')} skipped`),
      ].filter(Boolean);
      commit(
        result.settings,
        `Imported ${plural(result.count, 'record', 'records')}${notes.length ? `; ${notes.join('; ')}` : ''}.`,
      );
    });
  }
  return (
    <section
      className="authorship-panel local-insights"
      aria-labelledby="authorship-insights-title"
    >
      <div className="authorship-heading">
        <div>
          <h3 id="authorship-insights-title">Authorship roles</h3>
          <p>
            Analyze saved publications locally. No Google Scholar requests are made by these
            controls.
          </p>
        </div>
      </div>
      <form
        className="insight-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const author = draft.author.trim();
          if (draft.from && draft.to && Number(draft.from) > Number(draft.to)) {
            setError('Start year must not exceed end year.');
            return;
          }
          const overrides = settings.annotations.filter((a) => a.role).length;
          const keepRoles = sameAuthor(author, settings.author);
          const next: InsightsSettings = {
            ...settings,
            author,
            aliases: draft.aliases
              .split(';')
              .map((a) => a.trim())
              .filter(Boolean),
            yearFrom: draft.from ? Number(draft.from) : undefined,
            yearTo: draft.to ? Number(draft.to) : undefined,
            // Confirmed roles belong to one author: another author starts without them.
            annotations: keepRoles
              ? settings.annotations
              : settings.annotations.map(({ role: _role, ...a }) => a),
          };
          if (!keepRoles && overrides > 0) {
            setError('');
            setMessage('');
            setPendingAuthor({ next, overrides });
            return;
          }
          setPendingAuthor(null);
          applyControls(next);
        }}
      >
        <label>
          Author to analyze
          <input
            name="author"
            value={draft.author}
            onChange={(e) => {
              setDraft({ ...draft, author: e.target.value });
              setPendingAuthor(null);
            }}
            placeholder="Full name"
            maxLength={1000}
          />
        </label>
        <label>
          Confirmed name variants
          <input
            name="aliases"
            value={draft.aliases}
            onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            placeholder="Scholar, Jane; Jane A Scholar"
            maxLength={5000}
          />
        </label>
        <label>
          Publication year from
          <input
            name="from"
            type="number"
            min="1000"
            max="3000"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            placeholder="All"
          />
        </label>
        <label>
          Publication year to
          <input
            name="to"
            type="number"
            min="1000"
            max="3000"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            placeholder="All"
          />
        </label>
        <button className="button primary" type="submit" disabled={working}>
          Apply analysis
        </button>
      </form>
      {pendingAuthor && (
        <div className="insight-confirm" role="alert">
          <p>
            {`Changing the author clears ${plural(pendingAuthor.overrides, 'confirmed role override', 'confirmed role overrides')}, because a confirmed role belongs to one author. Saved author lists are kept.`}
          </p>
          <div className="insight-actions">
            <button
              ref={confirmButton}
              type="button"
              className="button primary"
              disabled={working}
              onClick={() => {
                const { next } = pendingAuthor;
                setPendingAuthor(null);
                applyControls(next);
              }}
            >
              Clear role overrides and apply
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPendingAuthor(null)}
            >
              Keep the current author
            </button>
          </div>
        </div>
      )}
      <p className="authorship-summary">
        {analysis.classified} of {analysis.papers} included publications classified. Citation counts
        available for {analysis.citationCoverage} of {analysis.papers}. Shares include the
        unclassified group; missing counts are excluded from citation statistics.
        {analysis.initialMatches > 0 &&
          ` ${plural(analysis.initialMatches, 'paper', 'papers')} matched compatible initials; verify author identity in the review below.`}
      </p>
      {analysis.undatedExcluded > 0 && (
        <p className="insight-note">
          {`${plural(analysis.undatedExcluded, 'undated paper is', 'undated papers are')} excluded by the year range.`}
        </p>
      )}
      {noNameMatched && (
        <p className="insight-hint">
          No byline matched this name. Names are matched as “Given Family”, “Family, Given” or
          “Family INITIALS”; add name variants above.
        </p>
      )}
      <div className="insight-actions">
        {(['csv', 'tsv', 'json'] as const).map((format) => (
          <button
            key={format}
            className="button secondary"
            disabled={working}
            onClick={() =>
              action(async () => {
                if (
                  await client.exportFile({
                    name: `research-insights.${format}`,
                    content: exportInsights(analysis, settings, source, format, { snapshot }),
                  })
                )
                  setMessage(`Exported ${format.toUpperCase()} analysis.`);
              })
            }
          >
            Export {format.toUpperCase()}
          </button>
        ))}
      </div>
      {error && (
        <p className="insight-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="insight-cards">
        {(
          [
            ['Raw h-index', analysis.hIndex, 'counts'],
            ['Experimental Sh-index', analysis.shIndex, 'weighted'],
            ['Weighted citations', analysis.adjustedCitations, 'weighted'],
            ['Median citations', analysis.median, 'counts'],
            ['Median weighted citations', analysis.adjustedMedian, 'weighted'],
            ['Zero-citation papers', analysis.zeroCitations, 'counts'],
            ['Preprints identified', analysis.preprints, 'other'],
          ] as const
        ).map(([label, value, basis]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {/* With no known count, a zero would claim "no citations" instead of "unknown". */}
              {basis === 'weighted'
                ? analysis.weightedCoverage
                  ? number(value)
                  : '—'
                : basis === 'counts' && !knownCounts
                  ? '—'
                  : number(value)}
            </strong>
          </div>
        ))}
      </div>
      <details className="insight-method">
        <summary>Weights and interpretation</summary>
        <p>
          Experimental Sh-index applies the usual h-index calculation to weighted citations.
          Weights: sole or confirmed corresponding 100%, first 90%, second 50%, other roles 25% for
          teams of six or fewer and 10% for larger teams.{' '}
          {plural(analysis.weightedCoverage, 'paper has', 'papers have')} both a classified role and
          a known count. Missing data can lower these indices.
        </p>
        <p>
          Two-author papers: on a complete two-author list the second author is classified as last
          author, so that paper is weighted like other roles (25%) unless the last-author convention
          below is on. Teams of exactly six authors use the 25% tier; the source paper (arXiv
          2509.04124) leaves exactly six unspecified, so this is a choice made here and not a
          published rule.
        </p>
        <label>
          <input
            type="checkbox"
            checked={settings.lensConvention}
            onChange={(e) => commit({ ...settings, lensConvention: e.target.checked }, '')}
          />{' '}
          Use GScholarLENS convention: last author receives 100% weight
        </label>
        <p>
          Last authorship does not establish corresponding authorship. Roles are mutually exclusive;
          confirmed role overrides take precedence. Weights are heuristic, not measured
          contributions.{' '}
          <a
            href={METHOD_URL}
            rel="noreferrer"
            onClick={(event) => {
              // The desktop app blocks new windows; its bridge opens the page in the browser.
              event.preventDefault();
              client
                .openExternal(METHOD_URL)
                .catch((e) =>
                  setError(e instanceof Error ? e.message : 'The link could not be opened.'),
                );
            }}
          >
            Sh-index method
          </a>
        </p>
      </details>
      <div className="insight-section-heading">
        <h4>Publications and citations by role and journal quartile</h4>
        <label>
          Role chart measure
          <select value={measure} onChange={(e) => setMeasure(e.target.value as typeof measure)}>
            <option value="papers">Publications</option>
            <option value="citations">Citations</option>
          </select>
        </label>
      </div>
      <div className="quartile-legend">
        {['Q1', 'Q2', 'Q3', 'Q4', 'Unknown'].map((q, i) => (
          <span key={q}>
            <i style={{ background: quartileColors[i] }} />
            {q}
          </span>
        ))}
      </div>
      <div
        className="authorship-chart"
        role="img"
        aria-label={`${measure === 'papers' ? 'Publications' : 'Citations'} by authorship role and journal quartile. ${roleChartText(groups, measure)}.`}
      >
        {groups.map((g) => (
          <div className="authorship-row" key={g.role}>
            <div className="authorship-role">
              <span>{g.label}</span>
              <small>
                {plural(g.papers, 'publication', 'publications')} ·{' '}
                {g.coverage ? plural(g.citations, 'citation', 'citations') : 'Unknown citations'}
              </small>
            </div>
            <div className="role-stack quartile-stack">
              {g.quartiles.map((q, i) => (
                <i
                  key={q.quartile}
                  style={{ width: `${(q[measure] / max) * 100}%`, background: quartileColors[i] }}
                  title={`${g.label}, ${q.quartile}: ${q[measure]} ${measure}`}
                />
              ))}
            </div>
            <strong>{measure === 'citations' && !g.coverage ? '—' : number(g[measure])}</strong>
            {ranked && quartileSplit(g, measure).length > 0 && (
              <small className="quartile-split">{quartileSplit(g, measure).join(' · ')}</small>
            )}
          </div>
        ))}
      </div>
      <p>
        Quartiles match journal name and publication year exactly. Conflicting categories or sources
        appear as Unknown. {analysis.rows.filter((r) => r.quartile !== 'Unknown').length} of{' '}
        {analysis.papers} papers have a unique matching quartile.
      </p>
      <h4>Publication and citation shares</h4>
      <div className="insight-table-wrap">
        <table className="insight-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Publications</th>
              <th>Publication share</th>
              <th>Known citations</th>
              <th>Citation share</th>
              <th>Coverage</th>
              <th>Raw h-index</th>
              <th>Weighted h-index</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.role}>
                <th>{g.label}</th>
                <td>{g.papers}</td>
                <td>
                  {percent(g.publicationShare)}
                  <meter
                    min="0"
                    max="100"
                    value={g.publicationShare}
                    aria-label={`${g.label} publication share`}
                  />
                </td>
                <td>{g.coverage ? number(g.citations) : '—'}</td>
                <td>
                  {percent(g.citationShare)}
                  {g.citationShare !== null && (
                    <meter
                      min="0"
                      max="100"
                      value={g.citationShare}
                      aria-label={`${g.label} citation share`}
                    />
                  )}
                </td>
                <td>
                  {g.coverage}/{g.papers}
                </td>
                <td>{g.coverage ? g.hIndex : '—'}</td>
                <td>{g.coverage ? number(g.weightedH) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Citation distributions by role</h4>
      <Distribution analysis={analysis} />
      <div className="insight-table-wrap">
        <table className="insight-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Known counts</th>
              <th>Minimum</th>
              <th>25th percentile</th>
              <th>Median</th>
              <th>75th percentile</th>
              <th>Maximum</th>
              <th>Mean</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.role}>
                <th>{g.label}</th>
                <td>{g.coverage}</td>
                {[g.min, g.q1, g.median, g.q3, g.max, g.mean].map((v, i) => (
                  <td key={i}>{number(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="insight-method">
        <summary>Review author lists and roles</summary>
        <p>
          Names match normalized spelling or compatible initials in “Given Family”, “Family, Given”
          and “Family INITIALS” order, including compact initials such as AG. Conflicting or
          multiple matches are left unclassified. Confirm variants above to record a verified
          spelling. Shortened lists can establish first or second position; later positions need a
          complete list. Role overrides apply to the selected author only.
        </p>
        <label>
          Find a publication
          <input
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value)}
            placeholder="Title or author"
          />
        </label>
        <label>
          Publication to review
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {selectedWork && !shown.includes(selectedWork) && (
              <option value={selectedWork.id}>{selectedWork.title}</option>
            )}
            {shown.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </label>
        {matching.length > shown.length && (
          <p className="insight-note insight-option-note">
            {`Showing ${formatNumber(shown.length)} of ${formatNumber(matching.length)} matching publications. Refine “Find a publication” to narrow the list.`}
          </p>
        )}
        {selectedWork && (
          <form
            className="author-review"
            onSubmit={(e) => {
              e.preventDefault();
              // The role control is disabled until an author is applied, and then keeps what was saved.
              const role = settings.author.trim() ? review.role : (annotation?.role ?? '');
              const entry = {
                key: paperKey(selectedWork),
                authors: review.authors
                  .split(';')
                  .map((a) => a.trim())
                  .filter(Boolean),
                complete: review.complete,
                ...(role ? { role: role as Role } : {}),
              };
              commit(
                {
                  ...settings,
                  annotations: [...settings.annotations.filter((a) => a.key !== entry.key), entry],
                },
                'Saved author review.',
              );
            }}
          >
            <p>
              Current classification:{' '}
              {selectedResult
                ? `${roleLabels[selectedResult.role]} — ${selectedResult.reason}`
                : 'Outside the included publication range'}
            </p>
            {settings.author.trim() &&
              annotation?.role &&
              selectedResult &&
              !selectedResult.complete &&
              roleNeedsCompleteList(annotation.role) && (
                <p className="insight-note">
                  {`Your confirmed role, ${roleLabels[annotation.role]}, is not applied: sole, middle and last positions need a complete author list. ${completeListFix(annotation)}`}
                </p>
              )}
            <label>
              Full author list
              <textarea
                name="authors"
                value={review.authors}
                onChange={(e) => setReview({ ...review, authors: e.target.value })}
                rows={3}
                maxLength={100000}
              />
            </label>
            <label>
              <input
                name="complete"
                type="checkbox"
                checked={review.complete}
                onChange={(e) => setReview({ ...review, complete: e.target.checked })}
              />{' '}
              I confirm this is the complete author list in publication order
            </label>
            <label>
              Confirmed role override
              <select
                name="role"
                value={review.role}
                onChange={(e) => setReview({ ...review, role: e.target.value as Role | '' })}
                disabled={!settings.author}
              >
                <option value="">Use author order</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary" disabled={working}>
              Save author review
            </button>
          </form>
        )}
        <div className="insight-table-wrap">
          <table className="insight-table">
            <thead>
              <tr>
                <th>Publication</th>
                <th>Role</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {toReview.slice(0, REVIEW_LIMIT).map((r) => (
                <tr key={r.key}>
                  <td>
                    <button className="text-button" onClick={() => setSelected(r.work.id)}>
                      {r.work.title}
                    </button>
                  </td>
                  <td>{roleLabels[r.role]}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          {toReview.length
            ? `Showing up to ${REVIEW_LIMIT} of ${formatNumber(toReview.length)} papers to review: matches based only on initials first, then unclassified papers. Use Find a publication to review any record.`
            : 'No paper needs an identity review. Use Find a publication to review any record.'}
        </p>
      </details>
      <details className="insight-method">
        <summary>Import local analysis data</summary>
        <p>
          Download a template, fill in verified values, then import CSV, TSV or a JSON array.
          Imports merge by record key; matching records are updated. All analysis data is saved in
          workspace backups.
        </p>
        <label>
          Analysis data type
          <select value={kind} onChange={(e) => setKind(e.target.value as Dataset)}>
            <option value="authors">Complete author lists and confirmed roles</option>
            <option value="annual">Citations received per calendar year</option>
            <option value="rankings">Journal quartiles</option>
          </select>
        </label>
        {kind === 'authors' && (
          <p>
            The template is filled in with each paper’s current author list, completeness and
            confirmed role. Rows you leave unchanged are not imported.
          </p>
        )}
        {kind === 'annual' && (
          <p>
            OpenAlex searches also save annual counts when supplied by the API. For imports, use one
            row per paper, calendar year and source. Supply actual citations received that year,
            including explicit zeroes; omitted years are unknown. Years after the current year are
            rejected, and rows dated before a paper’s publication year are ignored and counted.
            Sources: scholar, openalex, crossref, europepmc, pubmed, semantic, arxiv, preprints,
            datacite. Imported rows override saved history for the same paper, source and year; they
            do not replace lifetime totals.
          </p>
        )}
        {kind === 'rankings' && (
          <p>
            Required: venue, year, category, quartile (Q1–Q4), source. Use the publication-year
            ranking and a consistent subject category. An SJR “best quartile” is not automatically
            substituted for a category-specific rank. Only journals that appear in this snapshot are
            kept; the import reports how many rows were skipped.
          </p>
        )}
        <div className="insight-actions">
          <button
            className="button secondary"
            disabled={working}
            onClick={() =>
              action(async () => {
                await client.exportFile({
                  name: `insights-${kind}-template.csv`,
                  content: datasetTemplate(kind, works, settings),
                });
              })
            }
          >
            Download data template
          </button>
          <button className="button secondary" disabled={working} onClick={importData}>
            Import analysis data
          </button>
        </div>
        <p>
          {`Saved: ${plural(settings.annotations.length, 'author review', 'author reviews')} · ${plural(settings.annualCitations.length, 'annual count', 'annual counts')} · ${plural(settings.journalRanks.length, 'ranking record', 'ranking records')}.`}
          {analysis.annualIgnored > 0 &&
            ` ${plural(analysis.annualIgnored, 'annual count is', 'annual counts are')} ignored because ${analysis.annualIgnored === 1 ? 'it falls' : 'they fall'} before the paper’s publication year or after the current year.`}
        </p>
      </details>
      <p className="authorship-disclaimer">
        Position is descriptive, not a measure of contribution. This panel never opens or requests
        Google Scholar pages.
      </p>
    </section>
  );
}

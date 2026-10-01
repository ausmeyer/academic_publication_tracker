import { useLayoutEffect, useRef, useState } from 'react';
import type { ReturnTypeOfMetrics } from './Metrics';
import { formatNumber } from '../catalog';
import { chartYears, yearLabelStep } from '../core/metrics';
import './insights.css';

type TimelineMeasure = 'papers' | 'citations' | 'annual';
type YearBar = { year: number; papers: number; citations: number; coverage: number };

export default function Charts({
  metrics,
  expanded = false,
  annual = [],
  currentYear = new Date().getFullYear(),
}: {
  metrics: ReturnTypeOfMetrics;
  expanded?: boolean;
  annual?: YearBar[];
  currentYear?: number;
}) {
  const [timelineMeasure, setTimelineMeasure] = useState<TimelineMeasure>('papers');
  const isAnnual = timelineMeasure === 'annual';
  // Every calendar year from the first to the last gets a column, so gaps show as gaps.
  const { years, omitted } = chartYears<YearBar>(
    (isAnnual ? annual : metrics.years).filter((y) => y.year > 0),
    (year) => ({ year, papers: 0, citations: 0, coverage: 0 }),
    currentYear,
  );
  const measure = timelineMeasure === 'papers' ? 'papers' : 'citations';
  const isCitationTimeline = timelineMeasure !== 'papers';
  const timelineLabel = isCitationTimeline ? 'Citation timeline' : 'Publication timeline';
  const timelineDescription =
    timelineMeasure === 'annual'
      ? 'Citations received per calendar year'
      : isCitationTimeline
        ? 'Lifetime citations by publication year'
        : 'Papers by publication year';
  const max = Math.max(1, ...years.map((y) => y[measure]));
  // Years without data have no papers; in the annual view they are unknown, not zero.
  const isGap = (y: YearBar) => y.papers === 0;
  const valueLabel = (y: YearBar) =>
    isGap(y)
      ? isAnnual
        ? '—'
        : '0'
      : isCitationTimeline && !y.coverage
        ? 'Unknown'
        : formatNumber(y[measure]);
  const real = years.filter((y) => !isGap(y));
  const step = yearLabelStep(years.length);
  const showValues = years.length <= 24;
  const chart = useRef<HTMLDivElement>(null);
  const [valuesFit, setValuesFit] = useState(true);
  const values = showValues ? years.map(valueLabel).join('|') : '';
  // A value wider than its column would be cut off or run into its neighbour, so the values are
  // shown only while every one fits; they are measured again whenever the chart is resized.
  useLayoutEffect(() => {
    const element = chart.current;
    if (!element) return;
    const measure = () =>
      setValuesFit(
        [...element.querySelectorAll<HTMLElement>('.chart-value')].every(
          (label) => label.scrollWidth <= label.clientWidth,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [values]);
  const tight = years.length > 60;
  const crowded = years.length > 24;
  // The current calendar year is still running, so its citation count is year to date.
  const yearToDate = (y: YearBar) => isAnnual && y.year === currentYear && !isGap(y);
  const one = omitted.length === 1;
  const omittedList = `${omitted
    .slice(0, 3)
    .map((y) => y.year)
    .join(', ')}${omitted.length > 3 ? ', …' : ''}`;
  const undated = metrics.papers - metrics.years.reduce((sum, y) => sum + y.papers, 0);
  const venues = metrics.topVenues.slice(0, 5);
  const maxVenue = Math.max(1, ...venues.map((v) => v.count));
  return (
    <div className={`charts ${expanded ? 'expanded-charts' : ''}`}>
      <section className="chart-panel">
        <div className="chart-title">
          <div>
            <h3>{timelineLabel}</h3>
            <span>{timelineDescription}</span>
          </div>
          <label className="chart-select">
            Show
            <select
              aria-label="Timeline measure"
              value={timelineMeasure}
              onChange={(event) => setTimelineMeasure(event.target.value as TimelineMeasure)}
            >
              <option value="papers">Publications</option>
              <option value="citations">Lifetime citations by publication year</option>
              {expanded && <option value="annual">Citations received per year</option>}
            </select>
          </label>
        </div>
        {years.length ? (
          <div
            ref={chart}
            className={`year-chart${valuesFit ? '' : ' chart-values-hidden'}`}
            role="img"
            style={tight ? { gap: 0 } : crowded ? { gap: 2 } : undefined}
            aria-label={`${timelineDescription}: ${real
              .map(
                (y) =>
                  `${y.year}: ${valueLabel(y)}${isCitationTimeline ? `; counts for ${y.coverage} of ${y.papers} papers` : ''}${yearToDate(y) ? '; year to date' : ''}`,
              )
              .join(', ')}`}
          >
            {years.map((y, i) => (
              <div className="year-column" key={y.year}>
                {showValues && <span className="bar-value chart-value">{valueLabel(y)}</span>}
                <div className="bar-track">
                  <div
                    className={`year-bar ${i === years.length - 1 ? 'latest' : ''} ${yearToDate(y) ? 'insight-year-to-date' : ''}`}
                    style={{
                      height: `${y[measure] ? Math.max(3, (y[measure] / max) * 100) : 0}%`,
                      ...(tight ? { minWidth: 1 } : crowded ? { minWidth: 2 } : {}),
                    }}
                    title={
                      isGap(y)
                        ? `${y.year}: ${isAnnual ? 'no annual counts' : `0 ${isCitationTimeline ? 'citations' : 'papers'}`}`
                        : `${y.year}: ${valueLabel(y)} ${isCitationTimeline ? 'citation' : 'paper'}${y[measure] === 1 ? '' : 's'}${
                            isCitationTimeline
                              ? `; counts for ${y.coverage} of ${y.papers} papers`
                              : ''
                          }${yearToDate(y) ? ' (year to date)' : ''}`
                    }
                  />
                </div>
                <span className="year-label">
                  {step === 1 || y.year % step === 0 ? (
                    `${y.year}${yearToDate(y) ? '*' : ''}`
                  ) : (
                    <>&nbsp;</>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="chart-empty">
            {timelineMeasure === 'annual'
              ? 'Import calendar-year citation counts under “Import local analysis data” below. Lifetime totals cannot reconstruct annual history.'
              : 'Publication years will appear here.'}
          </p>
        )}
        {omitted.length > 0 && years.length > 0 && (
          <p className="timeline-coverage insight-chart-note">
            {`${omitted.length} ${one ? 'year' : 'years'} with data (${omittedList}) ${one ? 'falls' : 'fall'} outside the drawn range ${years[0].year}–${years[years.length - 1].year} and ${one ? 'is' : 'are'} not drawn.`}
          </p>
        )}
        {isCitationTimeline && real.length > 0 && (
          <p className="timeline-coverage">
            Known counts only; gaps are unknown.{' '}
            {real.map((y) => `${y.year}: ${y.coverage}/${y.papers} papers`).join(' · ')}
          </p>
        )}
        {isAnnual && real.some((y) => yearToDate(y)) && (
          <p className="timeline-coverage insight-chart-note">
            <span className="insight-ytd-swatch" aria-hidden="true" /> {currentYear}* is year to
            date and will keep rising; the hatched bar marks it.
          </p>
        )}
        {isAnnual && undated > 0 && (
          <p className="timeline-coverage insight-chart-note">
            {undated} undated {undated === 1 ? 'paper is' : 'papers are'} not counted here: without
            a publication year they cannot be placed in time.
          </p>
        )}
      </section>
      <section className="chart-panel">
        <div className="chart-title">
          <div>
            <h3>Leading venues</h3>
            <span>By included papers</span>
          </div>
        </div>
        {venues.length ? (
          <div className="venue-chart">
            {venues.map((v) => (
              <div key={v.name} className="venue-row">
                <div>
                  <span title={v.name}>{v.name}</span>
                  <strong>{formatNumber(v.count)}</strong>
                </div>
                <div className="venue-track">
                  <i style={{ width: `${(v.count / maxVenue) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="chart-empty">Publication venues will appear here.</p>
        )}
      </section>
    </div>
  );
}

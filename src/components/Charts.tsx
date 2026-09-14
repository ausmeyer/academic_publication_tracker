import type { ReturnTypeOfMetrics } from './Metrics';
import { formatNumber } from '../catalog';

export default function Charts({
  metrics,
  expanded = false,
}: {
  metrics: ReturnTypeOfMetrics;
  expanded?: boolean;
}) {
  const years = metrics.years.filter((y) => y.year > 0).slice(-24);
  const max = Math.max(1, ...years.map((y) => y.papers));
  const venues = metrics.topVenues.slice(0, 5);
  const maxVenue = Math.max(1, ...venues.map((v) => v.count));
  return (
    <div className={`charts ${expanded ? 'expanded-charts' : ''}`}>
      <section className="chart-panel">
        <div className="chart-title">
          <h3>Publication timeline</h3>
          <span>Papers by publication year</span>
        </div>
        {years.length ? (
          <div
            className="year-chart"
            role="img"
            aria-label={`Publications by year: ${years.map((y) => `${y.year}: ${y.papers}`).join(', ')}`}
          >
            {years.map((y, i) => (
              <div className="year-column" key={y.year}>
                <span className="bar-value">{y.papers}</span>
                <div className="bar-track">
                  <div
                    className={`year-bar ${i === years.length - 1 ? 'latest' : ''}`}
                    style={{ height: `${Math.max(3, (y.papers / max) * 100)}%` }}
                    title={`${y.year}: ${formatNumber(y.papers)} papers`}
                  />
                </div>
                <span className="year-label">
                  {years.length <= 12 ||
                  i % Math.ceil(years.length / 8) === 0 ||
                  i === years.length - 1
                    ? y.year
                    : '·'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="chart-empty">Publication years will appear here.</p>
        )}
      </section>
      <section className="chart-panel">
        <div className="chart-title">
          <h3>Leading venues</h3>
          <span>By included papers</span>
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

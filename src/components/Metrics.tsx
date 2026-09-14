import { BookOpen, Quote, TrendingUp, BarChart3 } from 'lucide-react';
import { calculateMetrics } from '../core/metrics';
import { formatNumber } from '../catalog';
export type ReturnTypeOfMetrics = ReturnType<typeof calculateMetrics>;
export default function Metrics({
  metrics,
  excluded,
  onHelp,
}: {
  metrics: ReturnTypeOfMetrics;
  excluded: number;
  onHelp: () => void;
}) {
  return (
    <div className="metrics-grid">
      <div className="metric-card">
        <div className="metric-label">
          Included publications
          <BookOpen size={17} />
        </div>
        <div className="metric-value">{formatNumber(metrics.papers)}</div>
        <div className="metric-caption">
          {excluded ? `${excluded} excluded from analysis` : 'Your reviewed research set'}
        </div>
      </div>
      <div className="metric-card">
        <div className="metric-label">
          Citations
          <Quote size={17} />
        </div>
        <div className="metric-value">{formatNumber(metrics.citations)}</div>
        <div className="metric-caption">
          <span className="small-dot" />
          {formatNumber(metrics.citationCoverage)} of {formatNumber(metrics.papers)} papers have
          counts
        </div>
      </div>
      <button className="metric-card metric-button" onClick={onHelp}>
        <div className="metric-label">
          h-index
          <TrendingUp size={17} />
        </div>
        <div className="metric-value">
          {metrics.hIndex}
          <span className="metric-unit">h</span>
        </div>
        <div className="metric-caption">
          {metrics.citationCoverage < metrics.papers
            ? 'Lower bound · incomplete coverage'
            : 'Publication impact over time'}
        </div>
      </button>
      <button className="metric-card metric-button" onClick={onHelp}>
        <div className="metric-label">
          g-index
          <BarChart3 size={17} />
        </div>
        <div className="metric-value">
          {metrics.gIndex}
          <span className="metric-unit">g</span>
        </div>
        <div className="metric-caption">Greater weight to highly cited work</div>
      </button>
    </div>
  );
}

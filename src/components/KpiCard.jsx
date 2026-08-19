/**
 * KpiCard — 2026 redesign
 *
 * Props:
 *  color      string  — 'blue' | 'teal' | 'navy' | 'green' | 'amber' | 'sky'
 *  icon       string  — emoji
 *  label      string
 *  value      string | number
 *  change     string  — descriptive sub-line
 *  trend      number  — optional % number: positive = green arrow, negative = red
 *  valueClass string  — 'sm' for smaller font
 */
function KpiCard({ color, icon, label, value, change, trend, valueClass = '' }) {
  const hasTrend = trend !== undefined && trend !== null;
  const trendUp   = hasTrend && trend >= 0;
  const trendColor = trendUp ? 'var(--green)' : 'var(--red)';
  const trendArrow = trendUp ? '↑' : '↓';

  return (
    <div className={`kpi-card ${color}`}>
      {icon && <div className="kpi-icon">{icon}</div>}
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{value}</div>
      <div className="kpi-footer">
        <div className="kpi-change">{change}</div>
        {hasTrend && (
          <span className="kpi-trend" style={{ color: trendColor }}>
            {trendArrow} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export default KpiCard;

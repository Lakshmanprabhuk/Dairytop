import { useState, useRef, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

/**
 * ChartCard — unified card that wraps any ECharts option
 * and optionally renders a data table via the Chart ↔ Table toggle.
 *
 * Props:
 *  title        string
 *  subtitle     string
 *  tag          string
 *  option       object   — ECharts option object (preferred)
 *  height       string   — css height for the chart, default '280px'
 *  tableData    { headers: string[], rows: (string|number)[][] }
 *               When provided the toggle button appears.
 *  defaultView  'chart' | 'table'   default 'chart'
 *
 * Legacy Chart.js support (chartConfig) is intentionally dropped —
 * everything is now ECharts for visual consistency.
 */
function ChartCard({
  title,
  subtitle,
  tag,
  option,
  height = '280px',
  tableData,
  defaultView = 'chart',
  children,
}) {
  const [view, setView] = useState(defaultView);
  const hasToggle = !!tableData;

  return (
    <div className="chart-card">
      {/* ── Header ── */}
      {(title || subtitle || tag || hasToggle) && (
        <div className="chart-header">
          <div style={{ minWidth: 0 }}>
            {title    && <div className="chart-title">{title}</div>}
            {subtitle && <div className="chart-sub">{subtitle}</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {tag && <div className="chart-tag">{tag}</div>}

            {hasToggle && (
              <div className="view-toggle">
                <button
                  className={`vt-btn ${view === 'chart' ? 'active' : ''}`}
                  onClick={() => setView('chart')}
                  title="Chart view"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor"/>
                    <rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor"/>
                    <rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor"/>
                  </svg>
                  Chart
                </button>
                <button
                  className={`vt-btn ${view === 'table' ? 'active' : ''}`}
                  onClick={() => setView('table')}
                  title="Table view"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="12" height="2.5" rx="1" fill="currentColor"/>
                    <rect x="1" y="5.5" width="12" height="2" rx="0.5" fill="currentColor" opacity=".6"/>
                    <rect x="1" y="9.5" width="12" height="2" rx="0.5" fill="currentColor" opacity=".4"/>
                    <rect x="1" y="12.5" width="8" height="1" rx="0.5" fill="currentColor" opacity=".25"/>
                  </svg>
                  Table
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      {view === 'chart' ? (
        option ? (
          <ReactECharts
            option={option}
            style={{ height }}
            opts={{ renderer: 'svg' }}
            notMerge
          />
        ) : children ? (
          <div style={{ height }}>{children}</div>
        ) : null
      ) : (
        <InlineTable data={tableData} height={height} />
      )}
    </div>
  );
}

/* ─── Inline sortable table rendered at the same fixed height ─── */
function InlineTable({ data, height }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  if (!data) return null;
  const { headers, rows } = data;

  const handleSort = (colIdx) => {
    if (sortCol === colIdx) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colIdx);
      setSortDir('asc');
    }
  };

  const sorted = [...rows].sort((a, b) => {
    if (sortCol === null) return 0;
    const av = a[sortCol];
    const bv = b[sortCol];
    const an = parseFloat(String(av).replace(/[^0-9.-]/g, ''));
    const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ''));
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div style={{ height, overflowY: 'auto', overflowX: 'auto' }} className="inline-table-wrap">
      <table className="inline-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} onClick={() => handleSort(i)} className="sortable-th">
                <span>{h}</span>
                <span className="sort-arrow">
                  {sortCol === i ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={ci === 0 ? { fontWeight: 600, color: 'var(--text)' } : {}}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ChartCard;

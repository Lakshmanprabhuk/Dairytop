import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { salesreps, PALETTE, fmt, fmtN, legendClickHandler } from '../utils/data';

function SalesReps() {
  const top3 = useMemo(() => salesreps.slice(0, 3), []);
  const top3Share = useMemo(() => { const t = salesreps.reduce((s, r) => s + r.rev, 0); return ((top3.reduce((s, r) => s + r.rev, 0) / t) * 100).toFixed(0); }, [top3]);

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: salesreps.map(d => d.n), datasets: [{ data: salesreps.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) }, min: 0 }, y: { grid: { display: false } } }
    }
  }), []);

  const donutConfig = useMemo(() => ({
    type: 'doughnut',
    data: { labels: salesreps.map(d => d.n.split(' ')[0]), datasets: [{ data: salesreps.map(d => d.rev), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', onClick: legendClickHandler, labels: { boxWidth: 8, padding: 8, color: '#334E5A', font: { size: 9 } } },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } }
      }
    }
  }), []);

  const tableRows = useMemo(() => salesreps.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), fmt(Math.round(d.rev / d.orders))]), []);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="#1 — Johan H." value={fmt(top3[0].rev)} valueClass="sm" change={`${fmtN(top3[0].orders)} orders · ${fmtN(top3[0].qty)} units`} />
        <KpiCard color="teal" label="#2 — Edo S." value={fmt(top3[1].rev)} valueClass="sm" change={`${fmtN(top3[1].orders)} orders · ${fmtN(top3[1].qty)} units`} />
        <KpiCard color="navy" label="#3 — Bärbel A." value={fmt(top3[2].rev)} valueClass="sm" change={`${fmtN(top3[2].orders)} orders · ${fmtN(top3[2].qty)} units`} />
        <KpiCard color="amber" label="Top 3 Revenue Share" value={`${top3Share}%`} valueClass="sm" change="of total revenue" />
      </div>
      <div className="chart-grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 18, marginBottom: 18 }}>
        <ChartCard title="Revenue by Sales Rep" subtitle="Horizontal bar · all reps" chartConfig={barConfig} height="300px" />
        <ChartCard title="Rep Revenue Share" subtitle="Doughnut breakdown" chartConfig={donutConfig} height="300px" />
      </div>
      <div className="section-title"><div className="section-dot"></div>Rep Leaderboard</div>
      <div className="chart-card"><Table headers={['#', 'Rep', 'Revenue', 'Orders', 'Avg Order']} rows={tableRows} /></div>
    </div>
  );
}

export default SalesReps;
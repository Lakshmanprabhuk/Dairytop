import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { categories, PALETTE, fmt, fmtN, legendClickHandler } from '../utils/data';

function Categories() {
  const totalRev = 31445750;

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: categories.map(d => d.n), datasets: [{ data: categories.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false, onClick: legendClickHandler, labels: { boxWidth: 10, padding: 10, color: '#334E5A' } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) }, min: 0 }, y: { grid: { display: false } } }
    }
  }), []);

  const donutConfig = useMemo(() => ({
    type: 'doughnut',
    data: { labels: categories.map(d => d.n), datasets: [{ data: categories.map(d => d.rev), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', onClick: legendClickHandler, labels: { boxWidth: 8, padding: 6, color: '#334E5A', font: { size: 9 } } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } }
    }
  }), []);

  const tableRows = useMemo(() => categories.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), ((d.rev / totalRev) * 100).toFixed(1) + '%']), [totalRev]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="Top Category" value="Melkpoeder" valueClass="sm" change="€21.3M · 68% of revenue" />
        <KpiCard color="teal" label="Kalverhuisvesting" value="€3.90M" valueClass="sm" change="12.4% share · 507 orders" />
        <KpiCard color="navy" label="Overig Veevoer" value="€3.30M" valueClass="sm" change="10.5% share · 2,047 orders" />
        <KpiCard color="amber" label="Categories Tracked" value="14" valueClass="sm" change="Active product groups" />
      </div>
      <div className="chart-grid chart-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard title="Category Revenue" subtitle="Total by category" chartConfig={barConfig} height="300px" />
        <ChartCard title="Category Split" subtitle="Donut view" chartConfig={donutConfig} height="300px" />
      </div>
      <div className="section-title"><div className="section-dot"></div>Category Breakdown</div>
      <div className="chart-card"><Table headers={['#', 'Category', 'Revenue', 'Orders', 'Share']} rows={tableRows} /></div>
    </div>
  );
}

export default Categories;
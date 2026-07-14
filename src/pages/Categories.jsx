import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { categories, PALETTE, fmt, fmtN } from '../utils/data';

function Categories() {
  const totalRevenue = useMemo(() => categories.reduce((s, c) => s + c.rev, 0), []);

  const barConfig = {
    type: 'bar',
    data: {
      labels: categories.map(d => d.n),
      datasets: [{ data: categories.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: {
        x: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) }, min: 0 },
        y: { grid: { display: false } }
      }
    }
  };

  const donutConfig = {
    type: 'doughnut',
    data: {
      labels: categories.map(d => d.n),
      datasets: [{ data: categories.map(d => d.rev), backgroundColor: PALETTE, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 8, padding: 6, color: '#334E5A', font: { size: 9 } } },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } }
      }
    }
  };

  const tableRows = useMemo(() =>
    categories.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), ((d.rev / totalRevenue) * 100).toFixed(1) + '%']),
    [totalRevenue]
  );

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="Top Category" value="Melkpoeder" valueClass="sm" change="€21.1M · 68% of revenue" />
        <KpiCard color="teal" label="Kalverhuisvesting" value="€3.89M" valueClass="sm" change="12.5% share · 499 orders" />
        <KpiCard color="navy" label="Overig Veevoer" value="€3.30M" valueClass="sm" change="10.6% share · 2,047 orders" />
        <KpiCard color="amber" label="Categories Tracked" value="12" change="Active product groups" />
      </div>
      <div className="chart-grid chart-grid-2">
        <ChartCard title="Category Revenue" subtitle="Total by category" chartConfig={barConfig} height="300px" />
        <ChartCard title="Category Split" subtitle="Donut view" chartConfig={donutConfig} height="300px" />
      </div>
      <div className="section-title"><div className="section-dot"></div>Category Breakdown</div>
      <div className="chart-card">
  <Table headers={['#', 'Category', 'Revenue', 'Orders', 'Share']} rows={tableRows} />
</div>
    </div>
  );
}

export default Categories;
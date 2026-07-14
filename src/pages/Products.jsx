import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { products, PALETTE, fmt, fmtN } from '../utils/data';

function Products() {
  const barConfig = {
    type: 'bar',
    data: {
      labels: products.map(d => d.n.length > 22 ? d.n.slice(0, 22) + '…' : d.n),
      datasets: [{ data: products.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: {
        x: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } },
        y: { grid: { display: false } }
      }
    }
  };

  const donutConfig = {
    type: 'doughnut',
    data: {
      labels: products.map(d => d.n.length > 18 ? d.n.slice(0, 18) + '…' : d.n),
      datasets: [{ data: products.map(d => d.rev), backgroundColor: PALETTE, borderWidth: 0 }]
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
    products.map((d, i) => [i + 1, d.n, fmt(d.rev), d.qty > 0 ? fmtN(d.qty) : '—', fmtN(d.orders)]),
    []
  );

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="#1 Product" value="Pro Elite 60" valueClass="sm" change="€14.4M · 46% of revenue" />
        <KpiCard color="teal" label="#2 Product" value="Pro Elite 40" valueClass="sm" change="€4.41M · 14% share" />
        <KpiCard color="navy" label="#3 Product" value="Optima Klima" valueClass="sm" change="€2.10M · 7% share" />
        <KpiCard color="green" label="Products Tracked" value="10+" change="Active product lines" />
      </div>
      <div className="chart-grid chart-grid-2">
        <ChartCard title="Top 10 Products by Revenue" chartConfig={barConfig} height="300px" />
        <ChartCard title="Product Revenue Share" chartConfig={donutConfig} height="300px" />
      </div>
      <div className="section-title"><div className="section-dot"></div>Product Table</div>
      <div className="chart-card">
  <Table headers={['#', 'Product', 'Revenue', 'Units', 'Orders']} rows={tableRows} />
</div>
    </div>
  );
}

export default Products;
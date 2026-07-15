import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { monthly, salesreps, categories, products, totalClients, PALETTE, fmt, fmtN, fmtNum, legendClickHandler } from '../utils/data';

function Overview() {
  const totalRevenue = useMemo(() => monthly.reduce((s, m) => s + m.rev, 0), []);
  const totalOrders = useMemo(() => monthly.reduce((s, m) => s + m.orders, 0), []);
  const totalUnits = useMemo(() => salesreps.reduce((s, r) => s + r.qty, 0), []);
  const topProduct = useMemo(() => products[0], []);
  const topRep = useMemo(() => salesreps[0], []);
  const topProductShare = useMemo(() => ((topProduct.rev / totalRevenue) * 100).toFixed(0), [topProduct, totalRevenue]);
  const topRepShare = useMemo(() => ((topRep.rev / totalRevenue) * 100).toFixed(0), [topRep, totalRevenue]);

  const lineConfig = useMemo(() => ({
    type: 'line',
    data: {
      labels: monthly.map(d => d.m),
      datasets: [{ data: monthly.map(d => d.rev), fill: true, tension: 0.4, borderColor: '#0891B2', backgroundColor: 'rgba(115,212,242,0.18)', pointBackgroundColor: '#0891B2', pointBorderColor: '#fff', pointRadius: 4, borderWidth: 2.5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } } }
    }
  }), []);

  const donutConfig = useMemo(() => ({
    type: 'doughnut',
    data: { labels: categories.map(d => d.n), datasets: [{ data: categories.map(d => d.rev), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', onClick: legendClickHandler, labels: { boxWidth: 10, padding: 12, color: '#334E5A', font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' (' + ((ctx.raw / ctx.dataset.data.reduce((a,b)=>a+b,0))*100).toFixed(1) + '%)' } }
      }
    }
  }), []);

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: salesreps.map(d => d.n.split(' ')[0]), datasets: [{ data: salesreps.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v)},min:0 } }
    }
  }), []);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" icon="💰" label="Total Revenue" value={fmt(totalRevenue)} valueClass="sm" change={`${fmtN(totalOrders)} invoiced transactions`} />
        <KpiCard color="teal" icon="📦" label="Units Sold" value={fmtNum(totalUnits)} valueClass="sm" change="All product categories" />
        <KpiCard color="green" icon="🏢" label="Unique Clients" value="1,349" valueClass="sm" change="Active customer accounts" />
        <KpiCard color="navy" icon="👥" label="Sales Reps" value={String(salesreps.length)} valueClass="sm" change="Active representatives" />
        <KpiCard color="sky" icon="🥇" label="Top Product" value={topProduct.n.split(' - ')[0]} valueClass="sm" change={`${fmt(topProduct.rev)} · ${topProductShare}% of revenue`} />
        <KpiCard color="amber" icon="⭐" label="Top Sales Rep" value={topRep.n} valueClass="sm" change={`${fmt(topRep.rev)} · ${topRepShare}% of revenue`} />
      </div>
      <ChartCard title="Monthly Revenue Trend" subtitle="Jan 2025 – Jul 2026" tag="19 months" chartConfig={lineConfig} height="300px" />
      <div className="chart-grid chart-grid-2">
        <ChartCard title="Revenue by Category" subtitle="All-time breakdown" chartConfig={donutConfig} />
        <ChartCard title="Sales Rep Performance" subtitle="Total revenue contribution" chartConfig={barConfig} />
      </div>
    </div>
  );
}

export default Overview;
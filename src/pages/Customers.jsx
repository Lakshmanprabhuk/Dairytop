import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { monthly, customers, totalClients, PALETTE, fmt, fmtN, legendClickHandler } from '../utils/data';

function Customers() {
  const totalRevenue = useMemo(() => monthly.reduce((s, m) => s + m.rev, 0), []);
  const topCustomer = useMemo(() => customers[0], []);
  const top15Revenue = useMemo(() => customers.slice(0, 15).reduce((s, c) => s + c.rev, 0), []);
  const avgRevenue = useMemo(() => Math.round(totalRevenue / totalClients), [totalRevenue]);
  const top15Share = useMemo(() => ((top15Revenue / totalRevenue) * 100).toFixed(0), [top15Revenue, totalRevenue]);

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: {
      labels: customers.map(d => d.n.length > 24 ? d.n.slice(0, 24) + '…' : d.n),
      datasets: [{ data: customers.map(d => d.rev), backgroundColor: PALETTE.map(c => c + 'cc'), borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } }, y: { grid: { display: false } } }
    }
  }), []);

  const tableRows = useMemo(() => customers.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), fmt(Math.round(d.rev / d.orders))]), []);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="Total Customers" value={totalClients.toLocaleString('en-US')} valueClass="sm" change="Unique billing accounts" />
        <KpiCard color="sky" label="Top Customer" value={topCustomer.n.length > 15 ? topCustomer.n.slice(0, 15) + '…' : topCustomer.n} valueClass="sm" change={`${fmt(topCustomer.rev)} · ${fmtN(topCustomer.orders)} orders`} />
        <KpiCard color="green" label="Top 15 Revenue" value={fmt(top15Revenue)} valueClass="sm" change={`${top15Share}% of total revenue`} />
        <KpiCard color="amber" label="Avg Rev / Customer" value={fmt(avgRevenue)} valueClass="sm" change="Across all accounts" />
      </div>
      <ChartCard title="Top 15 Customers by Revenue" subtitle="Full period" chartConfig={barConfig} height="300px" />
      <div className="section-title"><div className="section-dot"></div>Customer Leaderboard</div>
      <div className="chart-card"><Table headers={['#', 'Customer', 'Revenue', 'Orders', 'Avg Order']} rows={tableRows} /></div>
    </div>
  );
}

export default Customers;
import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { fmt, fmtN, multiLegendClickHandler } from '../utils/data';

function Revenue({ filteredMonthly, filterLabel }) {
  const totalRev = useMemo(() => filteredMonthly.reduce((s, m) => s + m.rev, 0), [filteredMonthly]);
  const totalOrders = useMemo(() => filteredMonthly.reduce((s, m) => s + m.orders, 0), [filteredMonthly]);
  const best = useMemo(() => filteredMonthly.length > 0 ? filteredMonthly.reduce((b, c) => c.rev > b.rev ? c : b, filteredMonthly[0]) : null, [filteredMonthly]);
  const avg = useMemo(() => filteredMonthly.length > 0 ? totalRev / filteredMonthly.length : 0, [totalRev, filteredMonthly]);

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: filteredMonthly.map(d => d.m), datasets: [{ data: filteredMonthly.map(d => d.rev), backgroundColor: 'rgba(8,145,178,0.75)', borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, min: 0, ticks: { callback: v => fmt(v) } } }
    }
  }), [filteredMonthly]);

  const compareConfig = useMemo(() => ({
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
      datasets: [
        { label: '2025', data: filteredMonthly.filter(m => m.m.includes('25')).slice(0,7).map(d => d.rev), borderColor: '#0891B2', backgroundColor: 'rgba(8,145,178,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4 },
        { label: '2026', data: filteredMonthly.filter(m => m.m.includes('26')).slice(0,7).map(d => d.rev), borderColor: '#73D4F2', backgroundColor: 'rgba(115,212,242,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4, borderDash: [5, 4] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, onClick: multiLegendClickHandler, labels: { boxWidth: 10, padding: 10, color: '#334E5A' } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, min: 0, ticks: { callback: v => fmt(v) } } }
    }
  }), [filteredMonthly]);

  const ordersConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: filteredMonthly.map(d => d.m), datasets: [{ data: filteredMonthly.map(d => d.orders), backgroundColor: 'rgba(3,105,161,0.7)', borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, min: 0 } }
    }
  }), [filteredMonthly]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="Total Revenue" value={fmt(totalRev)} valueClass="sm" change={`${fmtN(totalOrders)} transactions`} />
        <KpiCard color="teal" label="Months Shown" value={filteredMonthly.length} valueClass="sm" change="Active period" />
        <KpiCard color="green" label="Best Month" value={best ? best.m : '—'} valueClass="sm" change={best ? `${fmt(best.rev)} revenue` : ''} />
        <KpiCard color="amber" label="Avg Monthly Rev" value={fmt(avg)} valueClass="sm" change={`${filteredMonthly.length}-month average`} />
      </div>
      <ChartCard title="Monthly Revenue" subtitle={filterLabel} tag={`${filteredMonthly.length} months`} chartConfig={barConfig} height="300px" />
      <div className="chart-grid chart-grid-2">
        <ChartCard title="2025 vs 2026 Comparison" subtitle="Monthly overlay · Jan–Jul" chartConfig={compareConfig} />
        <ChartCard title="Monthly Order Volume" subtitle="Transaction count by month" chartConfig={ordersConfig} />
      </div>
    </div>
  );
}

export default Revenue;
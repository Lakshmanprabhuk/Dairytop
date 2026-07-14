import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { monthly, salesreps, categories, PALETTE, fmt, fmtN } from '../utils/data';

function Overview() {
  const totalOrders = useMemo(() => monthly.reduce((s, m) => s + m.orders, 0), []);

  const lineConfig = {
    type: 'line',
    data: {
      labels: monthly.map(d => d.m),
      datasets: [{
        data: monthly.map(d => d.rev),
        fill: true,
        tension: 0.4,
        borderColor: '#0891B2',
        backgroundColor: 'rgba(115,212,242,0.18)',
        pointBackgroundColor: '#0891B2',
        pointBorderColor: '#fff',
        pointRadius: 4,
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } }
      },
      scales: {
        x: { grid: { color: 'rgba(184,233,248,0.7)' } },
        y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } }
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
        legend: { position: 'right', labels: { boxWidth: 10, padding: 12, color: '#334E5A', font: { size: 10 } } }
      }
    }
  };

  const barConfig = {
    type: 'bar',
    data: {
      labels: salesreps.map(d => d.n.split(' ')[0]),
      datasets: [{ data: salesreps.map(d => d.rev), backgroundColor: PALETTE, borderRadius: 5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } }
      },
      scales: {
        x: { grid: { color: 'rgba(184,233,248,0.7)' } },
        y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } }
      }
    }
  };

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" icon="💰" label="Total Revenue" value="€31.1M" change={`${fmtN(totalOrders)} invoiced transactions`} />
        <KpiCard color="teal" icon="📦" label="Units Sold" value="2.01M" change="All product categories" />
        <KpiCard color="green" icon="🏢" label="Unique Clients" value="1,349" change="Active customer accounts" />
        <KpiCard color="navy" icon="👥" label="Sales Reps" value="10 Active" valueClass="sm" change="+ Webshop channel" />
        <KpiCard color="sky" icon="🥇" label="Top Product" value="Pro Elite 60" valueClass="sm" change="€14.4M · 46% of revenue" />
        <KpiCard color="amber" icon="⭐" label="Top Sales Rep" value="J. Hoogendoorn" valueClass="sm" change="€10.4M · 33% of revenue" />
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
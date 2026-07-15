import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { monthly, fmt, fmtN, legendClickHandler, multiLegendClickHandler} from '../utils/data';

function Revenue() {
  const fy25 = useMemo(() => monthly.slice(0, 12).reduce((a, m) => ({ rev: a.rev + m.rev, orders: a.orders + m.orders }), { rev: 0, orders: 0 }), []);
  const ytd26 = useMemo(() => monthly.slice(12).reduce((a, m) => ({ rev: a.rev + m.rev, orders: a.orders + m.orders }), { rev: 0, orders: 0 }), []);
  const best = useMemo(() => monthly.reduce((b, c) => c.rev > b.rev ? c : b), []);
  const avg = useMemo(() => monthly.reduce((s, m) => s + m.rev, 0) / monthly.length, []);

  const barConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: monthly.map(d => d.m), datasets: [{ data: monthly.map(d => d.rev), backgroundColor: monthly.map((_, i) => i < 12 ? 'rgba(8,145,178,0.75)' : 'rgba(115,212,242,0.85)'), borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } } }
    }
  }), []);

  const compareConfig = useMemo(() => ({
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
      datasets: [
        { label: '2025', data: monthly.slice(0, 7).map(d => d.rev), borderColor: '#0891B2', backgroundColor: 'rgba(8,145,178,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4 },
        { label: '2026', data: monthly.slice(12, 19).map(d => d.rev), borderColor: '#73D4F2', backgroundColor: 'rgba(115,212,242,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4, borderDash: [5, 4] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, onClick: multiLegendClickHandler, labels: { boxWidth: 10, padding: 10, color: '#334E5A' } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } } }
    }
  }), []);

  const ordersConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: monthly.map(d => d.m), datasets: [{ data: monthly.map(d => d.orders), backgroundColor: 'rgba(3,105,161,0.7)', borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(184,233,248,0.7)' } }, y: { grid: { color: 'rgba(184,233,248,0.7)' } } }
    }
  }), []);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="2025 Full Year" value={fmt(fy25.rev)} valueClass="sm" change={`${fmtN(fy25.orders)} transactions`} />
        <KpiCard color="teal" label="2026 YTD (Jan–Jul)" value={fmt(ytd26.rev)} valueClass="sm" change={`${fmtN(ytd26.orders)} transactions`} />
        <KpiCard color="green" label="Best Month" value={best.m} valueClass="sm" change={`${fmt(best.rev)} revenue`} />
        <KpiCard color="amber" label="Avg Monthly Rev" value={fmt(avg)} valueClass="sm" change="19-month average" />
      </div>
      <ChartCard title="Monthly Revenue – Full Timeline" subtitle="Jan 2025 to Jul 2026" tag="Bar chart" chartConfig={barConfig} height="300px" />
      <div className="chart-grid chart-grid-2">
        <ChartCard title="2025 vs 2026 Comparison" subtitle="Monthly overlay · Jan–Jul" chartConfig={compareConfig} />
        <ChartCard title="Monthly Order Volume" subtitle="Transaction count by month" chartConfig={ordersConfig} />
      </div>
    </div>
  );
}

export default Revenue;
import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { fmt, fmtN, legendClickHandler } from '../utils/data';

function Channels() {
  const directRevenue = 30852275;
  const webshopRevenue = 252881;
  const directOrders = 12801;
  const webshopOrders = 1516;
  const totalRevenue = directRevenue + webshopRevenue;
  const directAOV = Math.round(directRevenue / directOrders);
  const webshopAOV = Math.round(webshopRevenue / webshopOrders);

  const donutConfig = useMemo(() => ({
    type: 'doughnut',
    data: { labels: ['Direct Sales', 'Webshop'], datasets: [{ data: [directRevenue, webshopRevenue], backgroundColor: ['#0891B2', '#73D4F2'], borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', onClick: legendClickHandler, labels: { boxWidth: 10, padding: 12, color: '#334E5A' } }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + ' (' + ((ctx.raw / totalRevenue) * 100).toFixed(1) + '%)' } } }
    }
  }), [totalRevenue]);

  const ordersConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: ['Direct Sales', 'Webshop'], datasets: [{ data: [directOrders, webshopOrders], backgroundColor: ['rgba(8,145,178,0.8)', 'rgba(115,212,242,0.85)'], borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(184,233,248,0.7)' } } }
    }
  }), []);

  const aovConfig = useMemo(() => ({
    type: 'bar',
    data: { labels: ['Direct Sales', 'Webshop'], datasets: [{ data: [directAOV, webshopAOV], backgroundColor: ['rgba(3,105,161,0.85)', 'rgba(217,119,6,0.8)'], borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(184,233,248,0.7)' }, ticks: { callback: v => fmt(v) } } }
    }
  }), [directAOV, webshopAOV]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue" label="Direct Sales" value={fmt(directRevenue)} valueClass="sm" change={`${((directRevenue / totalRevenue) * 100).toFixed(1)}% of revenue · ${fmtN(directOrders)} orders`} />
        <KpiCard color="green" label="Webshop" value={fmt(webshopRevenue)} valueClass="sm" change={`${((webshopRevenue / totalRevenue) * 100).toFixed(1)}% of revenue · ${fmtN(webshopOrders)} orders`} />
        <KpiCard color="teal" label="Direct Avg Order" value={fmt(directAOV)} valueClass="sm" change="Per transaction" />
        <KpiCard color="amber" label="Webshop Avg Order" value={fmt(webshopAOV)} valueClass="sm" change="Per transaction" />
      </div>
      <div className="chart-grid chart-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard title="Channel Revenue Share" chartConfig={donutConfig} />
        <ChartCard title="Channel Order Volume" subtitle="Transaction count comparison" chartConfig={ordersConfig} />
      </div>
      <ChartCard title="Average Order Value by Channel" subtitle="Direct vs Webshop" chartConfig={aovConfig} height="180px" />
    </div>
  );
}

export default Channels;
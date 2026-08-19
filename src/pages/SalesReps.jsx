import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { salesreps, PALETTE, fmt, fmtN } from '../utils/data';

function SalesReps({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);

  const filteredReps = useMemo(() => {
    const grouped = {};
    salesreps.filter(r => filterMonths.includes(r.m)).forEach(r => {
      if (!grouped[r.n]) grouped[r.n] = { n: r.n, rev: 0, qty: 0, orders: 0 };
      grouped[r.n].rev += r.rev; grouped[r.n].qty += r.qty; grouped[r.n].orders += r.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev);
  }, [filterMonths]);

  const top3 = useMemo(() => filteredReps.slice(0, 3), [filteredReps]);
  const totalRev = useMemo(() => filteredReps.reduce((s, r) => s + r.rev, 0), [filteredReps]);
  const top3Share = useMemo(() => totalRev > 0 ? ((top3.reduce((s, r) => s + r.rev, 0) / totalRev) * 100).toFixed(0) : '0', [top3, totalRev]);

  const barOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmt(p[0].value)}` },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: filteredReps.map(d => d.n), axisLabel: { color: '#5F7078', fontSize: 10 }, inverse: true },
    series: [{ type: 'bar', data: filteredReps.map(d => d.rev), itemStyle: { color: params => PALETTE[params.dataIndex % PALETTE.length], borderRadius: [0,4,4,0] } }]
  }), [filteredReps]);

  const donutOption = useMemo(() => ({
    tooltip: { trigger: 'item', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 10 }, type: 'scroll' },
    series: [{ type: 'pie', radius: ['50%','75%'], center: ['50%','45%'], data: filteredReps.map(d => ({ name: d.n.split(' ')[0], value: d.rev })), itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }, label: { show: false }, emphasis: { scaleSize: 8 } }],
    color: PALETTE
  }), [filteredReps]);

  const repTableData = useMemo(() => ({
    headers: ['#', 'Rep', 'Revenue', 'Orders', 'Avg Order'],
    rows: filteredReps.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), fmt(Math.round(d.rev / (d.orders || 1)))])
  }), [filteredReps]);

  const donutTableData = useMemo(() => ({
    headers: ['Rep', 'Revenue', 'Share'],
    rows: filteredReps.map(d => [d.n, fmt(d.rev), ((d.rev / totalRev) * 100).toFixed(1) + '%'])
  }), [filteredReps, totalRev]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label={`#1 — ${top3[0]?.n?.split(' ')[0] || '—'}`} value={fmt(top3[0]?.rev || 0)} valueClass="sm" change={`${fmtN(top3[0]?.orders || 0)} orders · ${fmtN(top3[0]?.qty || 0)} units`} />
        <KpiCard color="teal"  label={`#2 — ${top3[1]?.n?.split(' ')[0] || '—'}`} value={fmt(top3[1]?.rev || 0)} valueClass="sm" change={`${fmtN(top3[1]?.orders || 0)} orders · ${fmtN(top3[1]?.qty || 0)} units`} />
        <KpiCard color="navy"  label={`#3 — ${top3[2]?.n?.split(' ')[0] || '—'}`} value={fmt(top3[2]?.rev || 0)} valueClass="sm" change={`${fmtN(top3[2]?.orders || 0)} orders · ${fmtN(top3[2]?.qty || 0)} units`} />
        <KpiCard color="amber" label="Top 3 Revenue Share" value={`${top3Share}%`} change="of total revenue" />
      </div>

      <div className="chart-grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 18, marginBottom: 18 }}>
        <ChartCard
          title="Revenue by Sales Rep"
          subtitle={filterLabel}
          option={barOption}
          height="300px"
          tableData={repTableData}
        />
        <ChartCard
          title="Rep Revenue Share"
          subtitle="Doughnut breakdown"
          option={donutOption}
          height="300px"
          tableData={donutTableData}
        />
      </div>

      <div className="section-title"><div className="section-dot"></div>Rep Leaderboard</div>
      <div className="chart-card">
        <Table headers={['#', 'Rep', 'Revenue', 'Orders', 'Avg Order']} rows={repTableData.rows} />
      </div>
    </div>
  );
}

export default SalesReps;

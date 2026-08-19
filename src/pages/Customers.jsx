import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { customers, totalClients, PALETTE, fmt, fmtN } from '../utils/data';

function Customers({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);
  const totalRevenue = useMemo(() => filteredMonthly.reduce((s, m) => s + m.rev, 0), [filteredMonthly]);

  const filteredCustomers = useMemo(() => {
    const grouped = {};
    customers.filter(c => filterMonths.includes(c.m)).forEach(c => {
      if (!grouped[c.n]) grouped[c.n] = { n: c.n, rev: 0, orders: 0 };
      grouped[c.n].rev += c.rev; grouped[c.n].orders += c.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev).slice(0, 15);
  }, [filterMonths]);

  const topCustomer  = useMemo(() => filteredCustomers[0] || { n: '—', rev: 0, orders: 0 }, [filteredCustomers]);
  const top15Revenue = useMemo(() => filteredCustomers.reduce((s, c) => s + c.rev, 0), [filteredCustomers]);
  const avgRevenue   = useMemo(() => Math.round(totalRevenue / totalClients), [totalRevenue]);
  const top15Share   = useMemo(() => totalRevenue > 0 ? ((top15Revenue / totalRevenue) * 100).toFixed(0) : '0', [top15Revenue, totalRevenue]);

  const barOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmt(p[0].value)}` },
    grid: { left: '2%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: filteredCustomers.map(d => d.n.length > 22 ? d.n.slice(0,22)+'…' : d.n), axisLabel: { color: '#5F7078', fontSize: 10 }, inverse: true },
    series: [{ type: 'bar', data: filteredCustomers.map(d => d.rev), itemStyle: { color: params => PALETTE[params.dataIndex % PALETTE.length] + 'cc', borderRadius: [0,4,4,0] } }]
  }), [filteredCustomers]);

  const tableData = useMemo(() => ({
    headers: ['#', 'Customer', 'Revenue', 'Orders', 'Avg Order'],
    rows: filteredCustomers.map((d, i) => [i+1, d.n, fmt(d.rev), fmtN(d.orders), fmt(Math.round(d.rev / (d.orders || 1)))])
  }), [filteredCustomers]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label="Total Customers"    value={totalClients.toLocaleString('en-US')} valueClass="sm" change="Unique billing accounts" />
        <KpiCard color="sky"   label="Top Customer"       value={topCustomer.n.length > 18 ? topCustomer.n.slice(0,18)+'…' : topCustomer.n} valueClass="sm" change={`${fmt(topCustomer.rev)} · ${fmtN(topCustomer.orders)} orders`} />
        <KpiCard color="green" label="Top 15 Revenue"     value={fmt(top15Revenue)}  valueClass="sm" change={`${top15Share}% of total revenue`} />
        <KpiCard color="amber" label="Avg Rev / Customer" value={fmt(avgRevenue)}    valueClass="sm" change="Across all accounts" />
      </div>

      <ChartCard
        title="Top 15 Customers by Revenue"
        subtitle={filterLabel}
        option={barOption}
        height="380px"
        tableData={tableData}
      />

      <div className="section-title"><div className="section-dot"></div>Customer Leaderboard</div>
      <div className="chart-card">
        <Table headers={tableData.headers} rows={tableData.rows} />
      </div>
    </div>
  );
}

export default Customers;

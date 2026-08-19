import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { categories, PALETTE, fmt, fmtN } from '../utils/data';

function Categories({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);

  const filteredCategories = useMemo(() => {
    const grouped = {};
    categories.filter(c => filterMonths.includes(c.m)).forEach(c => {
      const k = c.n.trim();
      if (!grouped[k]) grouped[k] = { n: k, rev: 0, orders: 0 };
      grouped[k].rev += c.rev; grouped[k].orders += c.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev);
  }, [filterMonths]);

  const totalRev       = useMemo(() => filteredCategories.reduce((s, c) => s + c.rev, 0), [filteredCategories]);
  const topCategory    = useMemo(() => filteredCategories[0] || { n: '—', rev: 0, orders: 0 }, [filteredCategories]);
  const secondCategory = useMemo(() => filteredCategories[1] || { n: '—', rev: 0, orders: 0 }, [filteredCategories]);
  const thirdCategory  = useMemo(() => filteredCategories[2] || { n: '—', rev: 0, orders: 0 }, [filteredCategories]);

  const barOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmt(p[0].value)}` },
    grid: { left: '2%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: filteredCategories.map(d => d.n), axisLabel: { color: '#5F7078', fontSize: 10 }, inverse: true },
    series: [{ type: 'bar', data: filteredCategories.map(d => d.rev), itemStyle: { color: params => PALETTE[params.dataIndex % PALETTE.length], borderRadius: [0,4,4,0] } }]
  }), [filteredCategories]);

  const donutOption = useMemo(() => ({
    tooltip: { trigger: 'item', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 10 }, type: 'scroll' },
    series: [{ type: 'pie', radius: ['50%','75%'], center: ['50%','45%'], data: filteredCategories.map(d => ({ name: d.n, value: d.rev })), itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }, label: { show: false }, emphasis: { scaleSize: 8 } }],
    color: PALETTE
  }), [filteredCategories]);

  const tableData = useMemo(() => ({
    headers: ['#', 'Category', 'Revenue', 'Orders', 'Share'],
    rows: filteredCategories.map((d, i) => [i+1, d.n, fmt(d.rev), fmtN(d.orders), ((d.rev / totalRev) * 100).toFixed(1) + '%'])
  }), [filteredCategories, totalRev]);

  const donutTableData = useMemo(() => ({
    headers: ['Category', 'Revenue', 'Share'],
    rows: filteredCategories.map(d => [d.n, fmt(d.rev), ((d.rev / totalRev) * 100).toFixed(1) + '%'])
  }), [filteredCategories, totalRev]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label="Top Category"       value={topCategory.n}             valueClass="sm" change={`${fmt(topCategory.rev)} · ${((topCategory.rev / totalRev) * 100).toFixed(0)}% of revenue`} />
        <KpiCard color="teal"  label={secondCategory.n || '—'} value={fmt(secondCategory.rev || 0)} valueClass="sm" change={`${((secondCategory.rev / totalRev) * 100).toFixed(1)}% share · ${fmtN(secondCategory.orders || 0)} orders`} />
        <KpiCard color="navy"  label={thirdCategory.n || '—'}  value={fmt(thirdCategory.rev || 0)}  valueClass="sm" change={`${((thirdCategory.rev / totalRev) * 100).toFixed(1)}% share · ${fmtN(thirdCategory.orders || 0)} orders`} />
        <KpiCard color="amber" label="Categories Tracked" value={filteredCategories.length} valueClass="sm" change="Active product groups" />
      </div>

      <div className="chart-grid chart-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard
          title="Category Revenue"
          subtitle={filterLabel}
          option={barOption}
          height="320px"
          tableData={tableData}
        />
        <ChartCard
          title="Category Split"
          subtitle="Donut view"
          option={donutOption}
          height="320px"
          tableData={donutTableData}
        />
      </div>

      <div className="section-title"><div className="section-dot"></div>Category Breakdown</div>
      <div className="chart-card">
        <Table headers={tableData.headers} rows={tableData.rows} />
      </div>
    </div>
  );
}

export default Categories;

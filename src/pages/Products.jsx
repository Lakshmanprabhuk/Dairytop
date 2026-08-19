import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { products, PALETTE, fmt, fmtN } from '../utils/data';

function Products({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);

  const filteredProducts = useMemo(() => {
    const grouped = {};
    products.filter(p => filterMonths.includes(p.m)).forEach(p => {
      const k = p.n.trim();
      if (!grouped[k]) grouped[k] = { n: k, rev: 0, qty: 0, orders: 0 };
      grouped[k].rev += p.rev; grouped[k].qty += p.qty; grouped[k].orders += p.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev).slice(0, 10);
  }, [filterMonths]);

  const totalRev      = useMemo(() => filteredProducts.reduce((s, p) => s + p.rev, 0), [filteredProducts]);
  const topProduct    = useMemo(() => filteredProducts[0] || { n: '—', rev: 0 }, [filteredProducts]);
  const secondProduct = useMemo(() => filteredProducts[1] || { n: '—', rev: 0 }, [filteredProducts]);
  const thirdProduct  = useMemo(() => filteredProducts[2] || { n: '—', rev: 0 }, [filteredProducts]);

  const barOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmt(p[0].value)}` },
    grid: { left: '2%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: filteredProducts.map(d => d.n.length > 22 ? d.n.slice(0,22)+'…' : d.n), axisLabel: { color: '#5F7078', fontSize: 10 }, inverse: true },
    series: [{ type: 'bar', data: filteredProducts.map(d => d.rev), itemStyle: { color: params => PALETTE[params.dataIndex % PALETTE.length], borderRadius: [0,4,4,0] } }]
  }), [filteredProducts]);

  const donutOption = useMemo(() => ({
    tooltip: { trigger: 'item', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 10 }, type: 'scroll' },
    series: [{ type: 'pie', radius: ['50%','75%'], center: ['50%','45%'], data: filteredProducts.map(d => ({ name: d.n.length > 18 ? d.n.slice(0,18)+'…' : d.n, value: d.rev })), itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }, label: { show: false }, emphasis: { scaleSize: 8 } }],
    color: PALETTE
  }), [filteredProducts]);

  const tableData = useMemo(() => ({
    headers: ['#', 'Product', 'Revenue', 'Orders', 'Share'],
    rows: filteredProducts.map((d, i) => [i+1, d.n, fmt(d.rev), fmtN(d.orders), ((d.rev / totalRev) * 100).toFixed(1) + '%'])
  }), [filteredProducts, totalRev]);

  const donutTableData = useMemo(() => ({
    headers: ['Product', 'Revenue', 'Share'],
    rows: filteredProducts.map(d => [d.n, fmt(d.rev), ((d.rev / totalRev) * 100).toFixed(1) + '%'])
  }), [filteredProducts, totalRev]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label="#1 Product"       value={topProduct.n.split(' - ')[0]}    valueClass="sm" change={`${fmt(topProduct.rev)} · ${((topProduct.rev / totalRev) * 100).toFixed(0)}% of revenue`} />
        <KpiCard color="teal"  label="#2 Product"       value={secondProduct.n.split(' - ')[0]} valueClass="sm" change={`${fmt(secondProduct.rev)} · ${((secondProduct.rev / totalRev) * 100).toFixed(0)}% share`} />
        <KpiCard color="navy"  label="#3 Product"       value={thirdProduct.n.split(' - ')[0]}  valueClass="sm" change={`${fmt(thirdProduct.rev)} · ${((thirdProduct.rev / totalRev) * 100).toFixed(0)}% share`} />
        <KpiCard color="green" label="Products Tracked" value={filteredProducts.length}          valueClass="sm" change="Active product lines" />
      </div>

      <div className="chart-grid chart-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard
          title="Top 10 Products by Revenue"
          subtitle={filterLabel}
          option={barOption}
          height="320px"
          tableData={tableData}
        />
        <ChartCard
          title="Product Revenue Share"
          subtitle={filterLabel}
          option={donutOption}
          height="320px"
          tableData={donutTableData}
        />
      </div>

      <div className="section-title"><div className="section-dot"></div>Product Table</div>
      <div className="chart-card">
        <Table headers={tableData.headers} rows={tableData.rows} />
      </div>
    </div>
  );
}

export default Products;

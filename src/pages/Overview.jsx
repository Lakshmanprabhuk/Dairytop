import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import Table from '../components/Table';
import { salesreps, categories, products, totalClients, PALETTE, fmt, fmtN, fmtNum } from '../utils/data';

function Overview({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);

  const totalRevenue = useMemo(() => filteredMonthly.reduce((s, m) => s + m.rev, 0), [filteredMonthly]);
  const totalOrders  = useMemo(() => filteredMonthly.reduce((s, m) => s + m.orders, 0), [filteredMonthly]);

  const filteredReps = useMemo(() => {
    const grouped = {};
    salesreps.filter(r => filterMonths.includes(r.m)).forEach(r => {
      const k = r.n.trim();
      if (!grouped[k]) grouped[k] = { n: k, rev: 0, qty: 0, orders: 0 };
      grouped[k].rev += r.rev; grouped[k].qty += r.qty; grouped[k].orders += r.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev);
  }, [filterMonths]);

  const filteredProducts = useMemo(() => {
    const grouped = {};
    products.filter(p => filterMonths.includes(p.m)).forEach(p => {
      const k = p.n.trim();
      if (!grouped[k]) grouped[k] = { n: k, rev: 0, qty: 0, orders: 0 };
      grouped[k].rev += p.rev; grouped[k].qty += p.qty; grouped[k].orders += p.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev);
  }, [filterMonths]);

  const filteredCategories = useMemo(() => {
    const grouped = {};
    categories.filter(c => filterMonths.includes(c.m)).forEach(c => {
      const k = c.n.trim();
      if (!grouped[k]) grouped[k] = { n: k, rev: 0, orders: 0 };
      grouped[k].rev += c.rev; grouped[k].orders += c.orders;
    });
    return Object.values(grouped).sort((a, b) => b.rev - a.rev);
  }, [filterMonths]);

  const totalUnits      = useMemo(() => filteredReps.reduce((s, r) => s + r.qty, 0), [filteredReps]);
  const topProduct      = useMemo(() => filteredProducts[0] || { n: '—', rev: 0 }, [filteredProducts]);
  const topRep          = useMemo(() => filteredReps[0] || { n: '—', rev: 0 }, [filteredReps]);
  const topProductShare = useMemo(() => totalRevenue > 0 ? ((topProduct.rev / totalRevenue) * 100).toFixed(0) : '0', [topProduct, totalRevenue]);
  const topRepShare     = useMemo(() => totalRevenue > 0 ? ((topRep.rev / totalRevenue) * 100).toFixed(0) : '0', [topRep, totalRevenue]);

  // ── Revenue line ──
  const lineOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(31,55,65,0.95)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: p => `<strong>${p[0].name}</strong><br/>Revenue: ${fmt(p[0].value)}`
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
    xAxis: { type: 'category', data: filteredMonthly.map(d => d.m), axisLabel: { color: '#5F7078', fontSize: 10 }, axisLine: { lineStyle: { color: '#DDE6E9' } } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'line', data: filteredMonthly.map(d => d.rev), smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { color: '#0891B2', width: 2.5 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(115,212,242,0.25)' }, { offset: 1, color: 'rgba(115,212,242,0.02)' }] } }, itemStyle: { color: '#0891B2', borderColor: '#fff', borderWidth: 2 } }]
  }), [filteredMonthly]);

  const lineTableData = useMemo(() => ({
    headers: ['Month', 'Revenue', 'Orders', 'Avg Order'],
    rows: filteredMonthly.map(m => [m.m, fmt(m.rev), fmtN(m.orders), fmt(Math.round(m.rev / (m.orders || 1)))])
  }), [filteredMonthly]);

  // ── Year comparison bar ──
  const compareOption = useMemo(() => {
    const m25 = filteredMonthly.filter(m => m.m.includes('25'));
    const m26 = filteredMonthly.filter(m => m.m.includes('26'));
    const n25 = m25.map(m => m.m.split(' ')[0]);
    const n26 = m26.map(m => m.m.split(' ')[0]);
    const order = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let months = (m25.length && m26.length) ? n25.filter(m => n26.includes(m)) : [...new Set([...n25,...n26])];
    months.sort((a,b) => order.indexOf(a) - order.indexOf(b));
    const series = [];
    if (m25.length) series.push({ name: '2025', type: 'bar', data: months.map(m => m25.find(d => d.m.startsWith(m))?.rev || 0), itemStyle: { color: '#0891B2', borderRadius: [4,4,0,0] }, barGap: '0%', barCategoryGap: '30%' });
    if (m26.length) series.push({ name: '2026', type: 'bar', data: months.map(m => m26.find(d => d.m.startsWith(m))?.rev || 0), itemStyle: { color: '#73D4F2', borderRadius: [4,4,0,0] }, barGap: '0%', barCategoryGap: '30%' });
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 } },
      legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 11 }, icon: 'roundRect' },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '5%', containLabel: true },
      xAxis: { type: 'category', data: months, axisLabel: { color: '#5F7078', fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
      series
    };
  }, [filteredMonthly]);

  // ── Category donut ──
  const donutOption = useMemo(() => ({
    tooltip: { trigger: 'item', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 10 }, type: 'scroll' },
    series: [{ type: 'pie', radius: ['50%','75%'], center: ['50%','45%'], data: filteredCategories.map(d => ({ name: d.n, value: d.rev })), itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }, label: { show: false }, emphasis: { scaleSize: 8 } }],
    color: PALETTE
  }), [filteredCategories]);

  const donutTableData = useMemo(() => {
    const total = filteredCategories.reduce((s, c) => s + c.rev, 0);
    return {
      headers: ['Category', 'Revenue', 'Orders', 'Share'],
      rows: filteredCategories.map(c => [c.n, fmt(c.rev), fmtN(c.orders), ((c.rev / total) * 100).toFixed(1) + '%'])
    };
  }, [filteredCategories]);

  // ── Rep bar ──
  const repBarOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 } },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: filteredReps.map(d => d.n.split(' ')[0]), axisLabel: { color: '#5F7078', fontSize: 10 }, inverse: true },
    series: [{ type: 'bar', data: filteredReps.map(d => d.rev), itemStyle: { color: params => PALETTE[params.dataIndex % PALETTE.length], borderRadius: [0,4,4,0] } }]
  }), [filteredReps]);

  const repTableData = useMemo(() => ({
    headers: ['#', 'Rep', 'Revenue', 'Orders', 'Avg Order'],
    rows: filteredReps.map((d, i) => [i + 1, d.n, fmt(d.rev), fmtN(d.orders), fmt(Math.round(d.rev / (d.orders || 1)))])
  }), [filteredReps]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  icon="💶" label="Total Revenue"  value={fmt(totalRevenue)}                      valueClass="sm" change={`${fmtN(totalOrders)} invoiced transactions`} />
        <KpiCard color="teal"  icon="📦" label="Units Sold"     value={fmtNum(totalUnits)}                     valueClass="sm" change="All product categories" />
        <KpiCard color="green" icon="🏢" label="Unique Clients" value={totalClients.toLocaleString('en-US')}   valueClass="sm" change="Active customer accounts" />
        <KpiCard color="navy"  icon="👥" label="Sales Reps"     value={filteredReps.length}                    valueClass="sm" change="Active representatives" />
        <KpiCard color="sky"   icon="🥇" label="Top Product"    value={topProduct.n.split(' - ')[0]}           valueClass="sm" change={`${fmt(topProduct.rev)} · ${topProductShare}% of revenue`} />
        <KpiCard color="amber" icon="⭐" label="Top Rep"        value={topRep.n.split(' ')[0]}                 valueClass="sm" change={`${fmt(topRep.rev)} · ${topRepShare}% of revenue`} />
      </div>

      <ChartCard
        title="2025 vs 2026 Comparison"
        subtitle="Monthly overlay"
        option={compareOption}
        height="300px"
      />

      <ChartCard
        title="Monthly Revenue Trend"
        subtitle={filterLabel}
        tag={`${filteredMonthly.length} months`}
        option={lineOption}
        height="300px"
        tableData={lineTableData}
      />

      <div className="chart-grid chart-grid-2">
        <ChartCard
          title="Revenue by Category"
          subtitle={filterLabel}
          option={donutOption}
          height="350px"
          tableData={donutTableData}
        />
        <ChartCard
          title="Sales Rep Performance"
          subtitle={filterLabel}
          option={repBarOption}
          height="300px"
          tableData={repTableData}
        />
      </div>
    </div>
  );
}

export default Overview;

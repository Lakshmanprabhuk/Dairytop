import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { salesreps, fmt, fmtN } from '../utils/data';

function Channels({ filteredMonthly, filterLabel }) {
  const filterMonths = useMemo(() => filteredMonthly.map(m => m.m), [filteredMonthly]);

  const channelData = useMemo(() => {
    const filtered = salesreps.filter(s => filterMonths.includes(s.m));
    const webshop = filtered.filter(s => s.n === 'Webshop');
    const direct  = filtered.filter(s => s.n !== 'Webshop');
    return {
      directRevenue:  direct.reduce((s, r) => s + r.rev, 0),
      webshopRevenue: webshop.reduce((s, r) => s + r.rev, 0),
      directOrders:   direct.reduce((s, r) => s + r.orders, 0),
      webshopOrders:  webshop.reduce((s, r) => s + r.orders, 0),
    };
  }, [filterMonths]);

  const totalRevenue = channelData.directRevenue + channelData.webshopRevenue;
  const directAOV    = channelData.directOrders  > 0 ? Math.round(channelData.directRevenue  / channelData.directOrders)  : 0;
  const webshopAOV   = channelData.webshopOrders > 0 ? Math.round(channelData.webshopRevenue / channelData.webshopOrders) : 0;

  if (totalRevenue === 0) {
    return (
      <div className="page">
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          No channel data for selected period
        </div>
      </div>
    );
  }

  const donutOption = {
    tooltip: { trigger: 'item', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 11 } },
    series: [{ type: 'pie', radius: ['50%','75%'], center: ['50%','45%'], data: [{ name: 'Direct Sales', value: channelData.directRevenue }, { name: 'Webshop', value: channelData.webshopRevenue }], itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }, label: { show: false }, emphasis: { scaleSize: 8 } }],
    color: ['#0891B2','#73D4F2']
  };

  const donutTableData = {
    headers: ['Channel', 'Revenue', 'Share', 'Orders', 'Avg Order'],
    rows: [
      ['Direct Sales', fmt(channelData.directRevenue), ((channelData.directRevenue / totalRevenue) * 100).toFixed(1) + '%', fmtN(channelData.directOrders), fmt(directAOV)],
      ['Webshop',      fmt(channelData.webshopRevenue),((channelData.webshopRevenue / totalRevenue) * 100).toFixed(1) + '%', fmtN(channelData.webshopOrders),fmt(webshopAOV)]
    ]
  };

  const ordersOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: ['Direct Sales', 'Webshop'], axisLabel: { color: '#5F7078', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10 }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'bar', data: [{ value: channelData.directOrders, itemStyle: { color: 'rgba(8,145,178,0.8)', borderRadius: [6,6,0,0] } }, { value: channelData.webshopOrders, itemStyle: { color: 'rgba(115,212,242,0.85)', borderRadius: [6,6,0,0] } }] }]
  };

  const aovOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `${p[0].name}: ${fmt(p[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: ['Direct Sales', 'Webshop'], axisLabel: { color: '#5F7078', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'bar', data: [{ value: directAOV, itemStyle: { color: 'rgba(3,105,161,0.85)', borderRadius: [6,6,0,0] } }, { value: webshopAOV, itemStyle: { color: 'rgba(217,119,6,0.8)', borderRadius: [6,6,0,0] } }] }]
  };

  const aovTableData = {
    headers: ['Channel', 'Avg Order Value'],
    rows: [['Direct Sales', fmt(directAOV)], ['Webshop', fmt(webshopAOV)]]
  };

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label="Direct Sales"       value={fmt(channelData.directRevenue)}  change={`${((channelData.directRevenue / totalRevenue) * 100).toFixed(1)}% of revenue · ${fmtN(channelData.directOrders)} orders`} />
        <KpiCard color="green" label="Webshop"            value={fmt(channelData.webshopRevenue)} change={`${((channelData.webshopRevenue / totalRevenue) * 100).toFixed(1)}% of revenue · ${fmtN(channelData.webshopOrders)} orders`} />
        <KpiCard color="teal"  label="Direct Avg Order"   value={fmt(directAOV)}  change="Per transaction" />
        <KpiCard color="amber" label="Webshop Avg Order"  value={fmt(webshopAOV)} change="Per transaction" />
      </div>

      <div className="chart-grid chart-grid-2" style={{ marginBottom: 18 }}>
        <ChartCard
          title="Channel Revenue Share"
          subtitle={filterLabel}
          option={donutOption}
          height="280px"
          tableData={donutTableData}
        />
        <ChartCard
          title="Channel Order Volume"
          subtitle="Transaction count comparison"
          option={ordersOption}
          height="280px"
        />
      </div>

      <ChartCard
        title="Average Order Value by Channel"
        subtitle="Direct vs Webshop"
        option={aovOption}
        height="200px"
        tableData={aovTableData}
      />
    </div>
  );
}

export default Channels;

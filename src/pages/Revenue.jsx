import { useMemo } from 'react';
import KpiCard from '../components/KpiCard';
import ChartCard from '../components/ChartCard';
import { fmt, fmtN } from '../utils/data';

function Revenue({ filteredMonthly, filterLabel }) {
  const totalRev    = useMemo(() => filteredMonthly.reduce((s, m) => s + m.rev, 0), [filteredMonthly]);
  const totalOrders = useMemo(() => filteredMonthly.reduce((s, m) => s + m.orders, 0), [filteredMonthly]);
  const best  = useMemo(() => filteredMonthly.length ? filteredMonthly.reduce((b, c) => c.rev > b.rev ? c : b, filteredMonthly[0]) : null, [filteredMonthly]);
  const avg   = useMemo(() => filteredMonthly.length ? totalRev / filteredMonthly.length : 0, [totalRev, filteredMonthly]);

  // ── Monthly bar ──
  const barOption = useMemo(() => ({
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmt(p[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: filteredMonthly.map(d => d.m), axisLabel: { color: '#5F7078', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'bar', data: filteredMonthly.map(d => d.rev), itemStyle: { color: 'rgba(8,145,178,0.75)', borderRadius: [4,4,0,0] } }]
  }), [filteredMonthly]);

  const barTableData = useMemo(() => ({
    headers: ['Month', 'Revenue', 'Orders', 'Avg Order'],
    rows: filteredMonthly.map(m => [m.m, fmt(m.rev), fmtN(m.orders), fmt(Math.round(m.rev / (m.orders || 1)))])
  }), [filteredMonthly]);

  // ── Orders bar ──
  const ordersOption = useMemo(() => ({
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: filteredMonthly.map(d => d.m), axisLabel: { color: '#5F7078', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10 }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'bar', data: filteredMonthly.map(d => d.orders), itemStyle: { color: 'rgba(3,105,161,0.7)', borderRadius: [3,3,0,0] } }]
  }), [filteredMonthly]);

  const ordersTableData = useMemo(() => ({
    headers: ['Month', 'Orders'],
    rows: filteredMonthly.map(m => [m.m, fmtN(m.orders)])
  }), [filteredMonthly]);

  // ── Year compare line ──
  const compareOption = useMemo(() => {
    const m25 = filteredMonthly.filter(m => m.m.includes('25'));
    const m26 = filteredMonthly.filter(m => m.m.includes('26'));
    const n25 = m25.map(m => m.m.split(' ')[0]);
    const n26 = m26.map(m => m.m.split(' ')[0]);
    const order = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let months = (m25.length && m26.length) ? n25.filter(m => n26.includes(m)) : [...new Set([...n25,...n26])];
    months.sort((a,b) => order.indexOf(a) - order.indexOf(b));
    const series = [];
    if (m25.length) series.push({ name: '2025', type: 'line', data: months.map(m => m25.find(d => d.m.startsWith(m))?.rev || null), lineStyle: { color: '#0891B2', width: 2.5 }, itemStyle: { color: '#0891B2' }, areaStyle: { color: 'rgba(8,145,178,0.08)' }, smooth: true });
    if (m26.length) series.push({ name: '2026', type: 'line', data: months.map(m => m26.find(d => d.m.startsWith(m))?.rev || null), lineStyle: { color: '#73D4F2', width: 2.5, type: 'dashed' }, itemStyle: { color: '#73D4F2' }, areaStyle: { color: 'rgba(115,212,242,0.08)' }, smooth: true });
    return {
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(31,55,65,0.95)', borderColor: 'rgba(255,255,255,0.12)', textStyle: { color: '#fff', fontSize: 12 }, formatter: p => p.map(s => `${s.marker} ${s.seriesName}: ${s.value ? fmt(s.value) : 'No data'}`).join('<br/>') },
      legend: { bottom: 0, textStyle: { color: '#334E5A', fontSize: 11 } },
      grid: { left: '3%', right: '4%', bottom: '14%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: months, axisLabel: { color: '#5F7078', fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 10, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
      series
    };
  }, [filteredMonthly]);

  const compareSubtitle = useMemo(() => {
    const m25 = filteredMonthly.filter(m => m.m.includes('25'));
    const m26 = filteredMonthly.filter(m => m.m.includes('26'));
    if (m25.length && m26.length) {
      const common = m25.filter(m => m26.some(d => d.m.split(' ')[0] === m.m.split(' ')[0]));
      return common.length ? `Monthly overlay · ${common[0].m.split(' ')[0]}–${common[common.length-1].m.split(' ')[0]}` : 'No common months';
    }
    return m25.length ? '2025 only' : m26.length ? '2026 only' : 'Select a year';
  }, [filteredMonthly]);

  const compareTableData = useMemo(() => {
    const m25 = filteredMonthly.filter(m => m.m.includes('25'));
    const m26 = filteredMonthly.filter(m => m.m.includes('26'));
    const order = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const n25 = m25.map(m => m.m.split(' ')[0]);
    const n26 = m26.map(m => m.m.split(' ')[0]);
    let months = (m25.length && m26.length) ? n25.filter(m => n26.includes(m)) : [...new Set([...n25,...n26])];
    months.sort((a,b) => order.indexOf(a) - order.indexOf(b));
    return {
      headers: ['Month', '2025 Revenue', '2026 Revenue', 'Δ'],
      rows: months.map(m => {
        const r25 = m25.find(d => d.m.startsWith(m))?.rev || 0;
        const r26 = m26.find(d => d.m.startsWith(m))?.rev || 0;
        const delta = r25 && r26 ? ((r26 - r25) / r25 * 100).toFixed(1) + '%' : '—';
        return [m, r25 ? fmt(r25) : '—', r26 ? fmt(r26) : '—', delta];
      })
    };
  }, [filteredMonthly]);

  return (
    <div className="page">
      <div className="kpi-grid">
        <KpiCard color="blue"  label="Total Revenue"   value={fmt(totalRev)}               valueClass="sm" change={`${fmtN(totalOrders)} transactions`} />
        <KpiCard color="teal"  label="Months Shown"    value={filteredMonthly.length}       valueClass="sm" change="Active period" />
        <KpiCard color="green" label="Best Month"      value={best ? best.m : '—'}          valueClass="sm" change={best ? `${fmt(best.rev)} revenue` : ''} />
        <KpiCard color="amber" label="Avg Monthly Rev" value={fmt(avg)}                     valueClass="sm" change={`${filteredMonthly.length}-month average`} />
      </div>

      <ChartCard
        title="Monthly Revenue"
        subtitle={filterLabel}
        tag={`${filteredMonthly.length} months`}
        option={barOption}
        height="300px"
        tableData={barTableData}
      />

      <div className="chart-grid chart-grid-2">
        <ChartCard
          title="2025 vs 2026 Comparison"
          subtitle={compareSubtitle}
          option={compareOption}
          height="280px"
          tableData={compareTableData}
        />
        <ChartCard
          title="Monthly Order Volume"
          subtitle="Transaction count by month"
          option={ordersOption}
          height="280px"
          tableData={ordersTableData}
        />
      </div>
    </div>
  );
}

export default Revenue;

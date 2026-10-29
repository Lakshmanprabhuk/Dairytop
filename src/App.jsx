 import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import ReactECharts from "echarts-for-react";
import * as XLSX from 'xlsx';
import ChatBot from './ChatBot.jsx';

import {
  monthly,
  weekly,
  salesreps as salesrepsRaw,
  salesrepsWeekly as salesrepsWeeklyRaw,
  categories as categoriesRaw,
  categoriesWeekly as categoriesWeeklyRaw,
  customers as customersRaw,
  customersWeekly as customersWeeklyRaw,
  products as _productsRaw,
  productsWeekly as _productsWeeklyRaw,
  salesmanCategorySales,
  tonnagePerSalesman,
  totalTonnageByCategory,
  totalClients,
  lastUpdated,
  maxFactuurDatum,
  openOrderValueFuture,
  openOrderValuePresent,
  openOrderValueMTD,
  projectedMTD,
  turnoverMTD,
  melkpoederTonnage2025,
  PALETTE,
  fmt,
  fmtFull,
  fmtN,
  fmtNum,
  finPeriodLabel,
  finSummary,
  finCategories,
  finLines,
  fmtPct,
  debtorAsOf,
  debtorKPI,
  debtorAgeing,
  debtorTrendlineCohort,
  debtorTrendlineSnapshot,
  debtorCustomers,
  debtorOpenItems,
  debtorQuarterlyYearly
} from './utils/data.js'; 

/* Strip trailing asterisks from product names (e.g. "Pro Elite 40 - GMO Controlled*" → "Pro Elite 40 - GMO Controlled") */
const _normProductName = n => typeof n === 'string' ? n.replace(/\*+\s*$/, '').trimEnd() : n;
const productsRaw = _productsRaw.map(p => ({...p, n: _normProductName(p.n)}));
const productsWeeklyRaw = _productsWeeklyRaw.map(p => ({...p, n: _normProductName(p.n)}));

function formatDisplayName(username) {
  if (!username) return '';
  const first = username.split(/[.\s_-]+/)[0];
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/* ── CATEGORY GROUPS ─────────────────────────────────────────── */
const CATEGORY_GROUPS = {
  'Melkpoeder & Veevoer':  ['Melkpoeder','Overig veevoer','Veevoeders','Aanvullende diervoeders','Aanvullende Veevoeders'],
  'Kalverhuisvesting':     ['Kalverhuisvesting','CalfOtel'],
  'Kalverbenodigdheden':   ['Milkbar','Kleine Kalverbenodigdheden','Overige Artikelen','Overige artikelen','Geen Groep'],
  'Kalverpasteurs':        ['Perfect Udder'],
};
const GROUP_NAMES = Object.keys(CATEGORY_GROUPS);
const CAT_TO_GROUP = {};
GROUP_NAMES.forEach(g => CATEGORY_GROUPS[g].forEach(c => { CAT_TO_GROUP[c] = g; }));
const GROUP_PALETTE = ['#40BCF3','#2E9B62','#E5A93D','#D95C5C'];

/* ── MOBILE HELPER ───────────────────────────────────────────── */
function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(max-width: 900px)').matches;
}

/* ── SHARED ECHARTS DEFAULTS ──────────────────────────────────── */
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(15,35,45,0.96)',
  borderColor: 'rgba(64,188,243,0.25)',
  borderWidth: 1,
  textStyle: { color: '#e8f4f8', fontSize: 12, fontFamily: 'Inter, sans-serif' },
  extraCssText: 'border-radius:10px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:320px;white-space:normal;',
  appendToBody: true,
  confine: true,
};

function withCrosshair(option, yFormatter = fmt) {
  return {
    ...option,
    tooltip: {
      ...TOOLTIP_STYLE,
      ...option.tooltip,
      axisPointer: {
        type: 'cross',
        crossStyle: { color: 'rgba(64,188,243,0.5)', width: 1, type: 'dashed' },
        label: {
          backgroundColor: '#1F3741',
          color: '#40BCF3',
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          padding: [4, 8],
          borderRadius: 4,
          formatter: (p) => {
            if (p.axisDimension === 'y') return yFormatter(p.value);
            return p.value;
          }
        },
      },
    },
  };
}

function withDataZoom(option) {
  if (isMobileViewport()) return option;
  return {
    ...option,
    dataZoom: [{
      type: 'inside',
      minSpan: 5,
      maxSpan: 100,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
      preventDefaultMouseMove: false
    }]
  };
}

function catAxisLabel(count, baseFontSize, forceRotate) {
  const mobile = isMobileViewport();
  const fs = baseFontSize || 9;
  const crowded = mobile && (forceRotate || count > 3);
  return {
    color: '#5F7078',
    fontSize: mobile ? Math.max(7, fs - 1) : fs,
    hideOverlap: true,
    interval: 0,
    rotate: crowded ? 40 : 0,
    margin: crowded ? 10 : 8,
  };
}

/* ── TIME GRANULARITY HELPERS ─────────────────────────────────── */
/* 'Apr 26' -> '26' */
function yearSuffixFromLabel(label) {
  const parts = String(label).trim().split(' ');
  return parts[parts.length - 1];
}
/* 'Apr 26' -> '2026' */
function yearFullFromLabel(label) {
  return '20' + yearSuffixFromLabel(label);
}

/* How granular is the user's selection for each year?
   Weekly if any weeks are ticked, monthly if months are ticked, otherwise yearly. */
function perYearFinestGrain(filter) {
  const years = filter.years || [];
  const map = {};
  years.forEach(y => {
    const wCount = (filter.eeks || filter.weeks?.[y] || []).length;
    const mCount = (filter.months?.[y] || []).length;
    if (wCount > 0) map[y] = 'weekly';
    else if (mCount > 0) map[y] = 'monthly';
    else map[y] = 'yearly';
  });
  return map;
}

/* Coarsest grain that all selected years can support. */
function effGrainFor(filter) {
  const map = perYearFinestGrain(filter);
  const vals = Object.values(map);
  if (vals.length === 0) return 'monthly';
  const rank = { weekly: 3, monthly: 2, yearly: 1 };
  const min = Math.min(...vals.map(v => rank[v]));
  return Object.keys(rank).find(k => rank[k] === min);
}

/* Yearly bars, respecting weekly ticks when present. */
function deriveYearlyFromFilter(filter, fm) {
  const map = perYearFinestGrain(filter);
  const buckets = {};
  const ensure = (y) => {
    const full = '20' + y;
    if (!buckets[full]) buckets[full] = { year: full, rev: 0, orders: 0 };
    return buckets[full];
  };
  Object.entries(map).forEach(([y, grain]) => {
    if (grain === 'weekly') {
      const set = new Set(filter.weeks?.[y] || []);
      weekly.forEach(w => {
        if (set.has(w.w)) { const b = ensure(y); b.rev += w.rev || 0; b.orders += w.orders || 0; }
      });
    } else {
      fm.forEach(m => {
        if (m.m.endsWith(y)) { const b = ensure(y); b.rev += m.rev || 0; b.orders += m.orders || 0; }
      });
    }
  });
  return Object.values(buckets).sort((a, b) => a.year.localeCompare(b.year));
}

/* 'dd/mm/yy' -> 'Apr 26' */
function weekOwnerMonth(weekRow) {
  const parts = String(weekRow.start).split('/');
  const mo = parseInt(parts[1], 10);
  const yy = parts[2];
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[mo - 1]} ${yy}`;
}

/* { 'Apr 26': ['W15 26', ...] } */
const WEEKS_BY_MONTH = (() => {
  const map = {};
  weekly.forEach(w => {
    const m = weekOwnerMonth(w);
    if (!map[m]) map[m] = [];
    map[m].push(w.w);
  });
  return map;
})();

/* ── CSS ─────────────────────────────────────────────────────── */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#EFF3F5;--surface:#FFFFFF;--surface2:#E8F7FD;--surface3:#F7FAFB;
  --border:#DDE6E9;--border2:#C8D8DE;
  --accent:#40BCF3;--accent2:#35A9DE;--accent3:#1F3741;
  --green:#2E9B62;--amber:#E5A93D;--red:#D95C5C;
  --text:#1F3741;--muted:#5F7078;--muted2:#7B898F;
  --sidebar-w:220px;
  --sidebar-w-collapsed:64px;
  --topbar-h:52px;
  --filter-h:56px;
  --r-sm:4px;--r-md:5px;--r-lg:6px;
  --shadow-sm:0 1px 2px rgba(31,55,65,0.05);
  --shadow-md:0 2px 6px rgba(31,55,65,0.06);
  --shadow-lg:0 3px 10px rgba(20,40,50,0.07);
  --glow-accent:0 0 0 1px rgba(64,188,243,0.18);
  --surface-elevated:#FCFEFF;
  --wash-blue:rgba(64,188,243,0.05);
  --wash-green:rgba(46,155,98,0.05);
  --wash-amber:rgba(229,169,61,0.06);
  --wash-red:rgba(217,92,92,0.05);
  --r-xl:8px;
  --hairline:1px solid var(--border);
}
html,body,#root{height:100%;overflow:hidden;}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased;}

.app{
  display:flex;height:100vh;height:100dvh;overflow:hidden;
  padding-top:env(safe-area-inset-top);
  padding-bottom:env(safe-area-inset-bottom);
  padding-left:env(safe-area-inset-left);
  padding-right:env(safe-area-inset-right);
}
html,body{overscroll-behavior:none;-webkit-text-size-adjust:100%;text-size-adjust:100%;}
.sidebar{
  position:relative;width:var(--sidebar-w);background:var(--accent3);
  display:flex;flex-direction:column;z-index:10;flex-shrink:0;
  margin:0;border-radius:0;
  box-shadow:2px 0 20px rgba(0,0,0,0.18);
  transition:width .32s cubic-bezier(.34,1.3,.44,1),margin .32s cubic-bezier(.34,1.3,.44,1),
             border-radius .32s cubic-bezier(.34,1.3,.44,1),box-shadow .32s ease,
             transform .28s cubic-bezier(.4,0,.2,1);
}
.sidebar.collapsed{
  width:var(--sidebar-w-collapsed);
  margin:14px;
  border-radius:22px;
  box-shadow:0 18px 40px rgba(15,23,28,.32),0 6px 16px rgba(15,23,28,.2),inset 0 1px 0 rgba(255,255,255,.05);
}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;min-height:0;}
.sidebar-inner{height:100%;display:flex;flex-direction:column;overflow:hidden;border-radius:inherit;}

.sb-logo{padding:20px 18px 16px;border-bottom:1px solid rgba(255,255,255,0.08);position:relative;}
.sidebar.collapsed .sb-logo{padding:12px 0 8px;display:flex;justify-content:center;}
.sb-brand{font-size:14px;font-weight:800;letter-spacing:.07em;color:#fff;text-transform:uppercase;display:flex;align-items:center;gap:7px;}
.sb-mark{color:var(--accent);font-size:15px;}
.sidebar.collapsed .sb-mark{display:none;}
.sidebar.collapsed .sb-brand-text{display:none;}
.sb-tag{font-size:9px;color:rgba(255,255,255,0.38);margin-top:2px;font-weight:500;letter-spacing:.04em;}
.sidebar.collapsed .sb-tag{display:none;}
.sb-collapse-btn{
  position:absolute;top:20px;right:-12px;width:24px;height:24px;border-radius:50%;
  background:var(--accent);color:#fff;border:2px solid var(--accent3);
  display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;
  box-shadow:0 2px 8px rgba(0,0,0,.25);z-index:11;transition:background .14s,transform .14s;
}
.sb-collapse-btn:hover{background:var(--accent2);transform:scale(1.08);}
.sidebar.collapsed .sb-collapse-btn{right:-12px;top:10px;}
.nav{flex:1;padding:6px 0;overflow-y:auto;overflow-x:hidden;}
.nav::-webkit-scrollbar{width:2px;}
.nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
.nav-section{font-size:8px;letter-spacing:.16em;color:rgba(255,255,255,0.28);text-transform:uppercase;padding:10px 18px 4px;font-weight:700;}
.sidebar.collapsed .nav-section{display:none;}
.nav-divider{height:1px;background:rgba(255,255,255,.09);margin:8px 16px;display:none;}
.sidebar.collapsed .nav-divider{display:block;}
.nav-item{
  display:flex;align-items:center;gap:9px;padding:8px 18px;position:relative;
  cursor:pointer;font-size:11.5px;font-weight:500;color:rgba(255,255,255,0.58);
  transition:background .14s,color .14s,border-left-color .14s;
  border-left:2px solid transparent;user-select:none;
}
.nav-item:hover{background:rgba(64,188,243,0.10);color:rgba(255,255,255,0.90);}
.nav-item.active{color:#fff;background:rgba(64,188,243,0.12);border-left-color:var(--accent);}
.nav-icon{width:22px;height:22px;flex-shrink:0;opacity:.82;transition:transform .15s ease-out,opacity .15s ease-out;display:flex;align-items:center;justify-content:center;}
.nav-icon img{width:22px;height:22px;object-fit:contain;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.18));}
.nav-item.active .nav-icon{opacity:1;}
.nav-item:hover .nav-icon{opacity:1;}
.nav-item.hovered .nav-icon{transform:scale(1.12);opacity:1;}
.nav-pip{margin-left:auto;width:5px;height:5px;border-radius:50%;background:var(--accent);opacity:.8;}
.sidebar.collapsed .nav-item{justify-content:center;padding:11px 0;gap:0;}
.sidebar.collapsed .nav-icon{width:22px;height:22px;}
.sidebar.collapsed .nav-label{display:none;}
.sidebar.collapsed .nav-pip{position:absolute;right:8px;top:50%;transform:translateY(-50%);margin-left:0;}
.sb-footer{padding:10px 16px;border-top:1px solid rgba(255,255,255,0.07);background:rgba(0,0,0,0.12);}
.sidebar.collapsed .sb-footer{padding:10px 0;display:flex;justify-content:center;}
.sidebar.collapsed .sb-footer-stats{display:none;}
.stat-row{display:flex;justify-content:space-between;align-items:baseline;gap:6px;padding:2px 0;}
.stat-lbl{font-size:9px;color:rgba(255,255,255,0.32);font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
.stat-val{font-size:10px;color:rgba(255,255,255,0.55);font-family:'JetBrains Mono',monospace;font-weight:500;}
.logout-btn{display:flex;align-items:center;gap:5px;color:rgba(255,255,255,0.38);cursor:pointer;font-size:11px;font-weight:500;background:none;border:none;padding:8px 0 0;font-family:inherit;transition:color .14s;}
.logout-btn:hover{color:var(--red);}
.sidebar.collapsed .logout-btn{padding:8px 0 0;}
.sidebar.collapsed .logout-btn-label{display:none;}

.nav-flyout{
  position:fixed;z-index:400;pointer-events:none;
  display:flex;align-items:center;gap:9px;
  background:linear-gradient(135deg,var(--accent3) 0%,#16262c 100%);
  color:#fff;padding:0 16px 0 10px;height:42px;
  border-radius:14px;
  box-shadow:0 10px 28px rgba(15,23,28,.38),0 3px 10px rgba(15,23,28,.2),inset 0 1px 0 rgba(255,255,255,.06);
  white-space:nowrap;
  will-change:clip-path,opacity;
  animation:navFlyoutPull .2s cubic-bezier(.22,.9,.36,1) both;
}
@media(max-width:900px){.nav-flyout{display:none !important;}}
@keyframes navFlyoutPull{
  from{opacity:0;clip-path:inset(0 100% 0 0 round 14px);}
  to{opacity:1;clip-path:inset(0 0 0 0 round 14px);}
}
.nav-flyout-badge{
  width:24px;height:24px;border-radius:50%;background:var(--accent);flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;
  box-shadow:0 0 0 3px rgba(64,188,243,.2);
}
.nav-flyout-text{display:flex;flex-direction:column;line-height:1.3;}
.nav-flyout-title{font-size:11.5px;font-weight:700;color:#fff;}
.nav-flyout-desc{font-size:9px;color:rgba(255,255,255,.55);margin-top:1px;}
.nav-flyout-chevron{font-size:12px;color:rgba(255,255,255,.35);}

.topbar{
  height:var(--topbar-h);background:var(--surface);
  border-bottom:var(--hairline);padding:0 20px;
  margin:0;border-radius:0;
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;gap:12px;
  box-shadow:none;
  transition:margin .32s cubic-bezier(.34,1.3,.44,1),border-radius .32s cubic-bezier(.34,1.3,.44,1);
}
.tb-row1{display:contents;}
.tb-titlewrap{}
.tb-title{font-size:14.5px;font-weight:700;color:var(--text);letter-spacing:-.1px;}
.tb-sub{font-size:10.5px;color:var(--muted);margin-top:1px;display:flex;align-items:center;gap:5px;}
.tb-sep{color:var(--border2);}
.tb-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}
.tb-time{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--muted);font-weight:500;}
.live-badge{
  display:flex;align-items:center;gap:5px;
  background:rgba(217,92,92,0.08);border:1px solid rgba(217,92,92,0.20);
  color:#B53939;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;
}
.blink-dot{width:6px;height:6px;background:var(--red);border-radius:50%;animation:blink 1.4s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.2;transform:scale(.85);}}

.filter-bar{
  min-height:var(--filter-h);background:var(--surface);border-bottom:1px solid var(--border);
  padding:0 20px;display:flex;align-items:center;gap:10px;flex-shrink:0;
  margin:0;border-radius:0;
  overflow:visible;position:relative;z-index:100;
  transition:margin .32s cubic-bezier(.34,1.3,.44,1),border-radius .32s cubic-bezier(.34,1.3,.44,1);
}
.filter-label{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.09em;white-space:nowrap;}
.filter-chips{display:flex;gap:6px;align-items:center;overflow-x:auto;padding:4px 0;flex:1;min-width:0;position:relative;}
.filter-chip{
  padding:4px 11px;border:1px solid var(--border);border-radius:20px;
  background:var(--surface);color:var(--muted);font-size:11px;font-weight:600;
  cursor:pointer;transition:all .15s;white-space:nowrap;flex-shrink:0;
}
.filter-chip:hover{border-color:var(--accent2);color:var(--accent2);}
.filter-chip.active{background:rgba(64,188,243,0.1);border-color:var(--accent);color:var(--accent2);font-weight:700;}
.filter-divider{width:1px;height:18px;background:var(--border);flex-shrink:0;}
.filter-meta{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;}
.filter-meta-row{font-size:10px;color:var(--muted);}
.filter-clear{
  padding:3px 8px;border:1px solid var(--red);border-radius:4px;
  background:transparent;color:var(--red);cursor:pointer;font-size:9px;font-weight:700;
  transition:all .14s;flex-shrink:0;
}
.filter-clear:hover{background:var(--red);color:#fff;}

.page-area{
  flex:1;overflow:hidden;padding:12px 16px;
  display:flex;flex-direction:column;gap:10px;
  min-height:0;
  transition:padding-left .32s cubic-bezier(.34,1.3,.44,1),padding-right .32s cubic-bezier(.34,1.3,.44,1);
}

.sidebar.collapsed ~ .main .topbar{
  margin:14px 14px 10px 14px;border-radius:var(--r-md);border:1px solid var(--border);
  box-shadow:var(--shadow-sm);
}
.sidebar.collapsed ~ .main .filter-bar{
  margin:0 14px 10px 14px;border-radius:var(--r-md);border:1px solid var(--border);
  box-shadow:none;
}
.sidebar.collapsed ~ .main .page-area{padding-left:14px;padding-right:14px;}

.kpi-strip{display:flex;gap:10px;flex-shrink:0;}
.kpi-card{
  flex:1;min-width:0;background:var(--surface);
  border:var(--hairline);border-left:2.5px solid var(--kpi-accent,var(--accent));border-radius:var(--r-sm);
  padding:11px 14px;position:relative;overflow:hidden;
  box-shadow:none;transition:background .16s,border-color .16s;
}
.kpi-card:hover{background:var(--surface3);border-color:var(--border2);border-left-color:var(--kpi-accent,var(--accent));}
.kpi-card.blue{--kpi-accent:var(--accent);--kpi-label:#0A6E9B;}
.kpi-card.teal{--kpi-accent:var(--accent2);--kpi-label:#14708F;}
.kpi-card.navy{--kpi-accent:var(--accent3);--kpi-label:#2A5570;}
.kpi-card.green{--kpi-accent:var(--green);--kpi-label:#1A6E43;}
.kpi-card.amber{--kpi-accent:var(--amber);--kpi-label:#8E610D;}
.kpi-card.sky{--kpi-accent:#63C4EE;--kpi-label:#12718F;}
.kpi-card.red{--kpi-accent:var(--red);--kpi-label:#9E3838;}
.kpi-icon{position:absolute;right:10px;top:10px;font-size:16px;opacity:.3;}
.kpi-lbl{
  font-size:9px;color:var(--kpi-label,var(--muted2));
  text-transform:uppercase;letter-spacing:.09em;font-weight:800;
  margin-bottom:5px;position:relative;
}
.kpi-val{font-size:17px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1;color:var(--text);word-break:break-all;position:relative;letter-spacing:-.2px;}
.kpi-val.sm{font-size:13px;}
.kpi-chg{font-size:9.5px;color:var(--muted);margin-top:5px;font-weight:500;position:relative;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.kpi-trend{display:inline-flex;align-items:center;gap:2px;font-weight:800;font-size:9.5px;padding:1px 6px 1px 5px;border-radius:20px;font-family:'JetBrains Mono',monospace;}
.kpi-trend.up{color:#1C7A46;background:rgba(46,155,98,0.12);}
.kpi-trend.down{color:#B23D3D;background:rgba(217,92,92,0.12);}
.kpi-spark{position:absolute;right:12px;bottom:10px;opacity:.85;pointer-events:none;}

.charts-row{display:flex;gap:10px;flex:1;min-height:0;min-width:0;}
.charts-col{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;min-width:0;}
.kpi-rail{display:flex;gap:10px;min-height:0;min-width:0;}
.kpi-rail-col{display:flex;flex-direction:column;gap:8px;flex:0 0 152px;min-height:0;}
.kpi-mini{padding:10px 12px;justify-content:center;}
.kpi-mini .kpi-lbl{margin-bottom:4px;}
.kpi-mini .kpi-val.sm{font-size:12px;}
.chart-panel{
  flex:1;background:var(--surface);border:var(--hairline);border-radius:var(--r-sm);
  padding:12px 14px;box-shadow:none;min-height:0;min-width:0;display:flex;flex-direction:column;
  transition:border-color .16s;overflow:hidden;position:relative;
}
.chart-panel:hover{box-shadow:none;border-color:var(--border2);}
.cp-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:9px;gap:8px;flex-shrink:0;flex-wrap:wrap;
  padding-bottom:9px;border-bottom:var(--hairline);}
.cp-title{font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.04em;font-size:10.5px;}
.cp-sub{font-size:10px;color:var(--muted);margin-top:2px;}
.cp-tag{font-size:9px;background:var(--surface3);color:var(--accent2);padding:2px 7px;border-radius:3px;font-weight:700;white-space:nowrap;border:1px solid var(--border);}
.cp-body{flex:1;min-height:0;min-width:0;position:relative;overflow:hidden;}

.panel-select{
  font-size:9.5px;font-weight:700;font-family:inherit;color:var(--accent2);
  background:var(--surface2);border:1px solid var(--border);border-radius:6px;
  padding:3px 18px 3px 7px;cursor:pointer;appearance:none;-webkit-appearance:none;
  white-space:nowrap;
  background-repeat:no-repeat;background-position:right 6px center;background-size:8px;
  transition:border-color .14s,color .14s;
}
.panel-select:hover{border-color:var(--accent2);}
.panel-select:focus{outline:none;border-color:var(--accent);}

.panel-btn{
  display:inline-flex;align-items:center;gap:4px;
  font-size:9.5px;font-weight:700;font-family:inherit;color:var(--green);
  background:rgba(46,155,98,0.08);border:1px solid rgba(46,155,98,0.25);border-radius:6px;
  padding:3px 9px;cursor:pointer;white-space:nowrap;
  transition:background .14s,border-color .14s;
}
.panel-btn:hover{background:rgba(46,155,98,0.16);border-color:var(--green);}

.view-tog{display:inline-flex;background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:2px;gap:1px;}
.vt-btn{
  display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
  border:none;border-radius:4px;background:transparent;color:var(--muted);
  font-size:10px;font-weight:600;font-family:inherit;cursor:pointer;
  transition:background .12s,color .12s;white-space:nowrap;
}
.vt-btn:hover{color:var(--text);background:var(--surface2);}
.vt-btn.active{background:var(--surface);color:var(--accent2);box-shadow:0 1px 3px rgba(31,55,65,0.1);}

.tbl-wrap{height:100%;width:100%;min-width:0;overflow:auto;}
.tbl-wrap::-webkit-scrollbar{width:3px;height:3px;}
.tbl-wrap::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}
.itbl{width:100%;border-collapse:collapse;font-size:11px;min-width:280px;}
.itbl th{text-align:left;padding:7px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.09em;
  color:var(--text);border-bottom:1px solid var(--border);font-weight:700;background:var(--surface3);
  white-space:nowrap;cursor:pointer;user-select:none;}
.itbl th:hover{color:var(--accent2);}
.itbl td{padding:7px 10px;color:var(--muted2);border-bottom:1px solid rgba(221,230,233,.5);white-space:nowrap;}
.itbl tr:last-child td{border-bottom:none;}
.itbl tr:hover td{background:#F4FBFE;}
.rank{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;}
.r1{background:rgba(229,169,61,.15);color:var(--amber);}
.r2{background:rgba(95,112,120,.12);color:#5F7078;}
.r3{background:rgba(217,92,92,.10);color:#B94A4A;}
.rn{background:var(--surface2);color:var(--muted);}

.login-screen{
  position:fixed;inset:0;background:var(--bg);
  background-image:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(64,188,243,.12) 0%,transparent 70%);
  display:flex;align-items:center;justify-content:center;z-index:1000;
  padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
}
.login-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:48px 40px;width:400px;max-width:100%;box-shadow:var(--shadow-md);position:relative;}
.login-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--accent);}
.login-logo{font-size:9px;letter-spacing:.22em;color:var(--accent);text-transform:uppercase;margin-bottom:8px;font-family:'JetBrains Mono',monospace;font-weight:500;}
.login-title{font-size:26px;font-weight:800;margin-bottom:4px;color:var(--text);letter-spacing:-.5px;}
.login-sub{color:var(--muted);font-size:12px;margin-bottom:32px;}
.field{margin-bottom:16px;}
.field label{display:block;font-size:9px;font-weight:700;color:var(--muted2);margin-bottom:5px;letter-spacing:.1em;text-transform:uppercase;}
.field input{width:100%;padding:11px 13px;background:var(--surface3);border:1.5px solid var(--border);border-radius:var(--r-md);color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .17s,box-shadow .17s;}
.field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(64,188,243,.13);}
.login-btn{width:100%;padding:13px;background:var(--accent3);border:none;border-radius:var(--r-md);color:#fff;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:8px;letter-spacing:.04em;transition:background .15s,transform .1s;box-shadow:none;}
.login-btn:hover:not(:disabled){background:#2A4855;}
.login-btn:active:not(:disabled){transform:scale(.98);}
.login-btn:disabled{opacity:.55;cursor:not-allowed;}
.login-err{color:var(--red);font-size:11px;margin-top:8px;font-weight:500;}
.login-err::before{content:'⚠ ';}

.sec-title{font-size:10px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:7px;text-transform:uppercase;letter-spacing:.09em;flex-shrink:0;margin-bottom:4px;}
.sec-dot{width:6px;height:6px;border-radius:50%;background:#8FD5F5;border:2px solid var(--accent);flex-shrink:0;}

::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:#C7D5D9;border-radius:2px;}

.page-area{animation:fadeIn .22s cubic-bezier(.4,0,.2,1);}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}

.donut-legend-wrapper{overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:4px 0;margin-top:4px;scrollbar-width:thin;}
.donut-legend-wrapper::-webkit-scrollbar{height:3px;}
.donut-legend-wrapper::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

.page-area.fin-scroll{overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;}
.page-area.fin-scroll .charts-row{flex:none;}
.page-area.fin-scroll .chart-panel{min-height:300px !important;}
.page-area.fin-scroll .kpi-strip{flex-shrink:0;}
.page-area.fin-scroll .chart-panel.hug{flex:none !important;min-height:0 !important;height:auto !important;}
.page-area.fin-scroll .chart-panel.hug .cp-body{flex:none !important;}
.page-area.fin-scroll .chart-panel.ledger-fixed{min-height:0 !important;}
.page-area.fin-scroll .chart-panel.fin-fixed{min-height:0 !important;height:var(--fin-fixed-h) !important;}

.fin-note{
  flex-shrink:0;padding:5px 12px;border-radius:var(--r-sm);
  background:rgba(229,169,61,0.08);border:1px solid rgba(229,169,61,0.25);
  font-size:10px;color:var(--amber);font-weight:600;
}
.fin-badge{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:20px;font-size:9px;font-weight:700;white-space:nowrap;}
.fin-badge.bad{background:rgba(217,92,92,0.10);color:#B53939;}
.fin-badge.good{background:rgba(46,155,98,0.10);color:var(--green);}
.indicative-tag{display:inline-flex;align-items:center;padding:1px 6px;border-radius:20px;font-size:7.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;background:rgba(229,169,61,0.12);color:var(--amber);border:1px solid rgba(229,169,61,0.3);margin-left:5px;vertical-align:middle;white-space:nowrap;}
.gauge-row{display:flex;gap:16px;flex:1;min-height:0;align-items:stretch;}
.gauge-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;}
.gauge-label{font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.gauge-val{font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1;}
.gauge-val.neg{color:var(--red);}
.gauge-val.pos{color:var(--green);}
.gauge-py{font-size:10px;color:var(--muted);margin-top:2px;}
.ledger-toolbar{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-shrink:0;}
.ledger-search{flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface3);color:var(--text);font-size:11px;font-family:inherit;outline:none;transition:border-color .15s;}
.ledger-search:focus{border-color:var(--accent);}
.ledger-count{font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;white-space:nowrap;flex-shrink:0;}
.ledger-cats{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;flex-shrink:0;}
.watch-split{display:flex;gap:8px;flex:1;min-height:0;}
.watch-col{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
.watch-col-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;flex-shrink:0;}
.watch-scroll{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;min-height:0;}
.watch-row{padding:5px 7px;border-radius:var(--r-sm);background:var(--surface3);border:1px solid var(--border);flex-shrink:0;}
.watch-row-desc{font-size:9.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.watch-row-amt{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--muted2);margin-top:1px;}
.watch-empty{font-size:10px;color:var(--muted);padding:8px;text-align:center;font-style:italic;}

.mob-toggle{display:none;position:fixed;top:6px;left:10px;z-index:300;width:38px;height:38px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);cursor:pointer;font-size:15px;color:var(--accent3);box-shadow:var(--shadow-md);align-items:center;justify-content:center;}
.mob-overlay{display:none;position:fixed;inset:0;background:rgba(31,55,65,.5);z-index:200;backdrop-filter:blur(2px);}

@media(max-width:1200px) and (min-width:901px){
  :root{--sidebar-w:190px;}
  .page-area{padding:10px 12px;gap:8px;}
  .kpi-val{font-size:14px;}
  .kpi-val.sm{font-size:12px;}
  .chart-panel{padding:10px 12px;}
  .cp-title{font-size:11px;}
}

@media(max-width:900px){
  html,body,#root{
    height:auto;width:100%;max-width:100vw;
    overflow-y:auto;overflow-x:hidden;
    -webkit-overflow-scrolling:touch;
    overscroll-behavior-x:none;
  }
  .app{height:auto;min-height:100vh;min-height:100dvh;overflow:visible;max-width:100vw;}
  .main{overflow:visible;min-height:0;max-width:100vw;}
  .page-area,.charts-row,.charts-col,.chart-panel,.kpi-strip,
  .topbar,.filter-bar,.tb-row1,.tb-search{
    max-width:100%;
    box-sizing:border-box;
  }

  .sidebar{position:fixed;top:0;left:0;bottom:0;transform:translateX(-100%);z-index:250;width:260px;}
  .sidebar.open{transform:translateX(0);}
  .sidebar.collapsed{width:260px !important;margin:0 !important;border-radius:0 !important;box-shadow:2px 0 20px rgba(0,0,0,0.18) !important;}
  .sidebar.collapsed .sb-logo{padding:20px 18px 16px;display:block;}
  .sidebar.collapsed .sb-mark{display:inline !important;}
  .sidebar.collapsed .sb-tag,
  .sidebar.collapsed .sb-brand-text,
  .sidebar.collapsed .nav-section,
  .sidebar.collapsed .nav-label,
  .sidebar.collapsed .sb-footer-stats,
  .sidebar.collapsed .logout-btn-label{display:block !important;}
  .sidebar .sb-logo,
  .sidebar.collapsed .sb-logo{
    padding-left:54px !important;
    padding-top:16px !important;
    padding-bottom:14px !important;
  }
  .sidebar.collapsed .nav-divider{display:none !important;}
  .sidebar.collapsed .nav-item{justify-content:flex-start;padding:8px 18px;gap:9px;}
  .sidebar.collapsed .nav-pip{position:static;transform:none;margin-left:auto;}
  .sidebar.collapsed .sb-footer{display:block;padding:10px 16px;}
  .sb-collapse-btn{display:none !important;}
  .main{margin-left:0;}
  .mob-toggle{display:inline-flex;}
  .mob-overlay{z-index:200;}
  .mob-overlay.open{display:block;}

  .topbar,
  .sidebar.collapsed ~ .main .topbar{
    position:relative;
    top:auto;z-index:60;
    margin:0;border-radius:0;border:none;
    border-bottom:1px solid var(--border);
    display:flex;flex-direction:column;
    padding:8px 10px 8px 58px;
    height:auto;gap:4px;
    box-shadow:none;background:var(--surface);
    align-items:stretch;
  }

  .tb-row1{
    display:flex;align-items:center;
    justify-content:space-between;
    gap:6px;width:100%;min-width:0;
  }
  .tb-titlewrap{flex:1;min-width:0;overflow:hidden;}

  .tb-title{
    font-size:13px;font-weight:700;color:var(--text);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    letter-spacing:-.1px;
  }
  .tb-sub{
    font-size:9px;color:var(--muted);
    display:flex;align-items:center;flex-wrap:wrap;
    gap:3px;margin-top:1px;line-height:1.3;
  }
  .tb-sep{display:none;}

  .tb-right{
    display:flex;align-items:center;
    gap:4px;flex-shrink:0;flex-wrap:nowrap;
  }
  .tb-refresh{display:none !important;}
  .tb-print-btn{
    font-size:9px !important;padding:4px 8px !important;
    border-radius:14px !important;white-space:nowrap;
  }
  .tb-time{
    font-size:9px !important;
    font-family:'JetBrains Mono',monospace;
    color:var(--muted);white-space:nowrap;
    display:block !important;
  }
  .live-badge{
    display:flex !important;
    font-size:8px !important;padding:2px 5px !important;gap:3px !important;
  }

  .tb-search{width:100%;}
  .tb-search input{
    width:100% !important;
    font-size:16px;
    padding:6px 10px 6px 28px;
    border-radius:8px;height:34px;
  }
  .tb-search input:focus{width:100% !important;}

  .topbar-overview{padding-bottom:6px;}

  .filter-bar,
  .sidebar.collapsed ~ .main .filter-bar{
    position:relative !important;
    top:auto !important;
    z-index:50;
    height:auto;
    display:flex;flex-direction:column;
    padding:5px 10px;
    gap:3px;margin:0;border-radius:0;
    box-shadow:none;
    background:var(--surface);
    border-bottom:1px solid var(--border);
    overflow:visible;
  }
  .filter-chips{
    display:flex;gap:5px;align-items:center;
    overflow-x:auto;flex-wrap:nowrap;
    padding:0;flex:none;width:100%;
    -webkit-overflow-scrolling:touch;
  }
  .filter-chip{font-size:9px;padding:3px 8px;min-height:auto;flex-shrink:0;}
  .filter-label{font-size:9px;flex-shrink:0;}
  .filter-clear{padding:3px 7px;font-size:8px;flex-shrink:0;}
  .filter-meta{
    display:flex !important;
    flex-direction:row;
    align-items:center;
    gap:8px;
    margin-left:0;
    flex-shrink:0;
    flex-wrap:wrap;
  }
  .filter-meta-row{
    font-size:8px;color:var(--muted);
    white-space:nowrap;
  }

  .page-area,
  .page-area.fin-scroll,
  .sidebar.collapsed ~ .main .page-area{overflow:visible;height:auto;padding:8px;gap:8px;}

  .kpi-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
  .kpi-card{padding:8px 10px;}
  .kpi-icon{font-size:13px;right:7px;top:7px;}
  .kpi-lbl{font-size:8px;margin-bottom:3px;}
  .kpi-val{font-size:13px;}
  .kpi-val.sm{font-size:11px;}
  .kpi-chg{font-size:8px;margin-top:3px;}

  .charts-row{flex-direction:column;}
  .charts-col{flex:none;}
  .chart-panel{flex:none;min-height:220px;padding:10px 12px;}
  .cp-body{min-height:160px;}
  .cp-title{font-size:11px;}
  .cp-sub{font-size:9px;}
  .vt-btn{font-size:9px;padding:2px 6px;}

  .kpi-rail{flex-direction:column;}
  .kpi-rail-col{flex-direction:row;flex:0 0 auto;}
  .kpi-mini{padding:8px 10px;}

  .itbl{font-size:9px;}
  .itbl th,.itbl td{padding:5px 7px;}
  .rank{width:18px;height:18px;font-size:8px;}

  .login-box{padding:28px 20px;}
  .login-title{font-size:22px;}

  .watch-split{flex-direction:column;}
  .fin-note{font-size:9px;padding:4px 10px;}
  .gauge-val{font-size:16px;}
  .ledger-search{font-size:10px;}
  .ledger-count{font-size:8px;}

  .page-area,
  .sidebar.collapsed ~ .main .page-area{padding:12px !important;}

  .kpi-strip{grid-template-columns:repeat(2,1fr);gap:6px;}
  .kpi-card{padding:8px 10px;}
  .kpi-val.sm{font-size:12px;}
  .kpi-chg{font-size:8px;}
}

@media(max-width:480px){
  .kpi-strip{grid-template-columns:repeat(2,1fr);gap:5px;}
  .topbar,.sidebar.collapsed ~ .main .topbar{padding-left:58px !important;}
  .sidebar{width:240px;}
  .chart-panel{min-height:200px;}
  .cp-body{min-height:140px;}
}

@media(max-height:500px) and (max-width:900px){
  .filter-bar{padding:4px 12px;}
  .page-area{padding:6px;gap:6px;}
  .kpi-strip{grid-template-columns:repeat(4,1fr);}
  .kpi-card{padding:5px 7px;}
  .chart-panel{min-height:160px;}
}

.itbl thead th{position:sticky;top:0;z-index:2;box-shadow:0 1px 0 var(--border);}

.cp-insight{
  display:flex;align-items:center;gap:7px;flex-shrink:0;
  font-size:10.5px;color:#1B5E82;font-weight:600;
  background:var(--surface3);
  border:var(--hairline);border-left:2.5px solid var(--accent);
  border-radius:var(--r-sm);padding:6px 10px;margin-bottom:7px;line-height:1.4;
}
.cp-insight-icon{flex-shrink:0;opacity:.9;font-size:11px;}
.cp-expand-btn{background:none;border:1px solid var(--border);cursor:pointer;color:var(--muted);padding:2px 5px;border-radius:4px;line-height:1;font-size:12px;display:flex;align-items:center;justify-content:center;}
.cp-expand-btn:hover{background:var(--row-hover);color:var(--fg);}
.cfs-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(2px);}
.cfs-panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;width:92vw;max-width:1300px;height:88vh;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.35);}
.cfs-hdr{display:flex;align-items:flex-start;gap:12px;padding:16px 20px 14px;border-bottom:1px solid var(--border);flex-shrink:0;}
.cfs-titles{flex:1;min-width:0;}
.cfs-title{font-size:15px;font-weight:700;color:var(--fg);}
.cfs-sub{font-size:11px;color:var(--muted);margin-top:3px;}
.cfs-close{background:none;border:1px solid var(--border);cursor:pointer;font-size:16px;color:var(--muted);padding:3px 9px;border-radius:6px;line-height:1;flex-shrink:0;}
.cfs-close:hover{background:var(--row-hover);color:var(--fg);}
.cfs-body{flex:1;min-height:0;position:relative;padding:8px;}

.delta{display:inline-flex;align-items:center;gap:2px;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:9.5px;padding:1px 6px;border-radius:20px;white-space:nowrap;}
.delta.up{color:var(--green);background:rgba(46,155,98,0.10);}
.delta.down{color:var(--red);background:rgba(217,92,92,0.10);}
.delta.flat{color:var(--muted);background:var(--surface3);}

.cmp-toggle{
  display:inline-flex;align-items:center;gap:4px;
  font-size:9.5px;font-weight:700;font-family:inherit;color:var(--muted);
  background:var(--surface3);border:1px solid var(--border);border-radius:6px;
  padding:3px 9px;cursor:pointer;white-space:nowrap;transition:all .14s;
}
.cmp-toggle:hover{border-color:var(--accent2);color:var(--accent2);}
.cmp-toggle.active{background:rgba(64,188,243,0.10);border-color:var(--accent);color:var(--accent2);}

.drill-chip{
  display:inline-flex;align-items:center;gap:6px;flex-shrink:0;
  font-size:10px;font-weight:600;color:var(--accent2);
  background:rgba(64,188,243,0.1);border:1px solid var(--accent);
  border-radius:20px;padding:3px 6px 3px 10px;margin-bottom:6px;
}
.drill-chip button{
  border:none;background:rgba(31,55,65,0.08);color:var(--accent3);
  width:15px;height:15px;border-radius:50%;cursor:pointer;font-size:9px;
  line-height:1;display:inline-flex;align-items:center;justify-content:center;
}
.drill-chip button:hover{background:var(--red);color:#fff;}

.tbl-search-wrap{flex-shrink:0;margin-bottom:6px;position:relative;}
.tbl-search-wrap input{
  width:100%;padding:6px 10px 6px 26px;border:1px solid var(--border);border-radius:var(--r-sm);
  background:var(--surface3);color:var(--text);font-size:11px;font-family:inherit;outline:none;
  transition:border-color .15s;
}
.tbl-search-wrap input:focus{border-color:var(--accent);}
.tbl-search-count{font-size:9px;color:var(--muted);position:absolute;right:8px;top:50%;transform:translateY(-50%);font-family:'JetBrains Mono',monospace;}

.cp-skeleton{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:4px;background:var(--surface);z-index:1;}
.cp-skeleton-bar{background:linear-gradient(90deg,var(--surface3) 25%,var(--border) 50%,var(--surface3) 75%);background-size:200% 100%;border-radius:4px;animation:skeleton-pulse 1.1s ease-in-out infinite;}
@keyframes skeleton-pulse{0%{background-position:200% 0;}100%{background-position:-200% 0;}}

.tb-search{position:relative;flex-shrink:0;}
.tb-search input{
  width:190px;padding:6px 10px 6px 28px;border:1px solid var(--border);border-radius:20px;
  background:var(--surface3);color:var(--text);font-size:11px;font-family:inherit;outline:none;
  transition:border-color .15s,width .2s;
}
.tb-search input:focus{border-color:var(--accent);width:230px;}
.tb-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:10px;opacity:.5;pointer-events:none;}
.tb-search-results{
  position:fixed;max-height:60vh;overflow-y:auto;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
  box-shadow:0 12px 32px rgba(31,55,65,.22);z-index:2000;
}
.tb-search-group{border-bottom:1px solid var(--border);}
.tb-search-group:last-child{border-bottom:none;}
.tb-search-group-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:7px 12px;background:var(--surface3);position:sticky;top:0;
  font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
}
.tb-search-group-head strong{color:var(--accent2);}
.tb-search-group-dest{font-size:8.5px;font-weight:600;color:var(--muted2);text-transform:none;letter-spacing:0;white-space:nowrap;}
.tb-search-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(221,230,233,.5);transition:background .12s;}
.tb-search-item:last-child{border-bottom:none;}
.tb-search-item:hover{background:var(--surface2);}
.tb-search-item-name{font-size:11px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tb-search-item-arrow{font-size:11px;color:var(--border2);flex-shrink:0;transition:transform .12s,color .12s;}
.tb-search-item:hover .tb-search-item-arrow{color:var(--accent2);transform:translateX(2px);}
.tb-search-empty{padding:14px 12px;font-size:10.5px;color:var(--muted);text-align:center;font-style:italic;}
.tb-refresh{font-size:9.5px;color:var(--muted);white-space:nowrap;}

.tb-print-btn{
  display:inline-flex;align-items:center;gap:5px;
  font-size:10px;font-weight:700;font-family:inherit;color:var(--accent2);
  background:var(--surface3);border:1px solid var(--border);border-radius:20px;
  padding:6px 11px;cursor:pointer;white-space:nowrap;transition:all .14s;flex-shrink:0;
}
.tb-print-btn:hover{border-color:var(--accent);background:rgba(64,188,243,0.08);}

@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;scroll-behavior:auto!important;}
}

@media print{
  html,body,#root{height:auto !important;overflow:visible !important;}
  .app{height:auto !important;overflow:visible !important;display:block !important;}
  .main{overflow:visible !important;height:auto !important;display:block !important;}
  .sidebar,.tb-search,.tb-search-results,.tb-print-btn,.filter-bar,.mob-toggle,.live-badge,.tb-time,.view-tog,.panel-btn,.cmp-toggle,.tbl-search-wrap,.drill-chip button,.cb-toggle,.cb-panel,.cb-greet,.cb-moo-wrap,.nav-flyout{display:none !important;}
  .page-area{overflow:visible !important;height:auto !important;display:block !important;padding:12px 16px;}
  .charts-row{display:block !important;}
  .charts-col{display:block !important;}
  .chart-panel{box-shadow:none !important;border:1px solid #ccc !important;break-inside:avoid;page-break-inside:avoid;margin-bottom:14px;flex:none !important;height:auto !important;min-height:340px !important;}
  .cp-body{min-height:270px !important;overflow:visible !important;}
  .kpi-strip{display:flex !important;flex-wrap:wrap;break-inside:avoid;}
  .kpi-card{flex:1 1 30% !important;min-width:140px;margin-bottom:8px;}
  .cp-skeleton{display:none !important;}
}

.scroll-hint,.scroll-fade{display:none;}

@media(max-width:900px){
  html{height:auto;overflow-x:hidden;overflow-y:auto;}
  html.no-scroll{overflow:hidden;}
  body,#root{height:auto;min-height:100%;overflow:visible;}

  .charts-row{flex:none !important;flex-direction:column;}
  .charts-col{flex:none !important;width:100%;}
  .chart-panel{flex:none !important;height:auto;min-height:0 !important;}

  .cp-body{flex:none;height:320px;min-height:320px;touch-action:pan-y;}
  .chart-panel svg,.chart-panel canvas{touch-action:pan-y;}

  .page-area.fin-scroll .chart-panel.fin-fixed{height:auto !important;}
  .page-area.fin-scroll .chart-panel.ledger-fixed{height:auto !important;}
  .chart-panel.ledger-fixed .cp-body{height:520px;min-height:520px;}
  .page-area.fin-scroll .chart-panel.hug .cp-body{height:auto !important;min-height:0 !important;}

  .kpi-strip>*:last-child:nth-child(odd){grid-column:1/-1;}

  .filter-bar{overflow:visible;}
  .filter-chips{overflow-x:auto !important;overflow-y:hidden !important;-webkit-overflow-scrolling:touch;}

  .page-area,.page-area.fin-scroll,
  .sidebar.collapsed ~ .main .page-area{padding-bottom:100px !important;}

  .login-screen{overflow-y:auto;align-items:flex-start;}
  .login-box{margin:auto;}
  .login-logo-img{width:44px !important;height:44px !important;top:28px !important;right:16px !important;}

  .scroll-fade{
    display:block;position:fixed;left:0;right:0;bottom:0;height:70px;
    z-index:140;pointer-events:none;
    background:linear-gradient(to top,rgba(239,243,245,.95),rgba(239,243,245,0));
    transition:opacity .25s;
  }
  .scroll-hint{
    display:flex;position:fixed;
    left:50%;
    bottom:calc(14px + env(safe-area-inset-bottom));
    transform:translateX(-50%);z-index:150;
    width:40px;height:40px;border-radius:50%;
    background:var(--accent3);color:#fff;
    border:2px solid var(--accent);
    align-items:center;justify-content:center;
    font-size:15px;cursor:pointer;
    box-shadow:0 6px 18px rgba(15,23,28,.3);
    animation:hintBounce 1.4s ease-in-out infinite;
    transition:opacity .25s;
  }
  .scroll-hint.hidden,.scroll-fade.hidden{opacity:0;pointer-events:none;animation:none;}
}
@keyframes hintBounce{
  0%,100%{transform:translateX(-50%) translateY(0);}
  50%{transform:translateX(-50%) translateY(7px);}
}
@media print{.scroll-hint,.scroll-fade{display:none !important;}}
`;

/* ── COMPONENTS ─────────────────────────────────────────────────── */

function Login({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState(false);
  const [attempts, setAttempts] = useState(() => {
    const saved = sessionStorage.getItem('login_attempts');
    return saved ? parseInt(saved) : 0;
  });
  const [locked, setLocked] = useState(() => {
    const saved = sessionStorage.getItem('login_locked');
    return saved === 'true';
  });
  const [timeLeft, setTimeLeft] = useState(() => {
    const saved = sessionStorage.getItem('login_timeleft');
    return saved ? parseInt(saved) : 0;
  });

  useEffect(() => {
    if (!locked || timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft(v => {
      if (v <= 1) {
        clearInterval(t);
        setLocked(false);
        setAttempts(0);
        setErr(false);
        sessionStorage.removeItem('login_locked');
        sessionStorage.removeItem('login_attempts');
        sessionStorage.removeItem('login_timeleft');
        return 0;
      }
      const newVal = v - 1;
      sessionStorage.setItem('login_timeleft', newVal.toString());
      return newVal;
    }), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const handle = (e) => {
    e.preventDefault();
    if (locked) return;
    const valid = (u === 'knitworks' && p === 'Knitworks@123') ||
                  (u === 'admin' && p === '1234') ||
                  (u === 'Jan.spiker' && p === 'Janspiker@123') ||
                  (u === 'Leon.dairytop' && p === 'LeonJonge@123') ||
                  (u === 'Joahan.dairytop' && p === 'Johan@123');
    if (valid) {
      sessionStorage.removeItem('login_attempts');
      sessionStorage.removeItem('login_locked');
      sessionStorage.removeItem('login_timeleft');
      onLogin(u);
    } else {
      const a = attempts + 1;
      setAttempts(a);
      sessionStorage.setItem('login_attempts', a.toString());
      setErr(true);
      if (a >= 5) {
        setLocked(true);
        setTimeLeft(1800);
        sessionStorage.setItem('login_locked', 'true');
        sessionStorage.setItem('login_timeleft', '1800');
      }
    }
  };

  const fmt_t = (s) => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;

  const clearLockout = () => {
    sessionStorage.removeItem('login_locked');
    sessionStorage.removeItem('login_attempts');
    sessionStorage.removeItem('login_timeleft');
    setLocked(false);
    setAttempts(0);
    setTimeLeft(0);
    setErr(false);
  };

  return (
    <div className="login-screen">
      <div className="login-box" style={{ position: 'relative' }}>
        <img
          className="login-logo-img"
          src="/favicon.png"
          alt="DairyTop Logo"
          style={{ position: 'absolute', top: '45px', right: '24px', width: '62px', height: '62px' }}
        />
        <div className="login-logo">▸ Business Intelligence</div>
        <div className="login-title">Dashboard</div>
        <div className="login-sub">Sign in to access your analytics</div>
        {locked && (
          <div style={{ background:'#ffebee',padding:'8px 12px',borderRadius:'4px',marginBottom:'16px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <span style={{ color:'#c62828',fontSize:'12px' }}>🔒 Locked for {fmt_t(timeLeft)}</span>
            <button onClick={clearLockout} style={{ padding:'4px 12px',background:'#d32f2f',color:'white',border:'none',borderRadius:'4px',cursor:'pointer',fontSize:'11px' }}>Clear Lockout (Dev)</button>
          </div>
        )}
        <form onSubmit={handle}>
          <div className="field">
            <label>Username</label>
            <input type="text" value={u} onChange={e=>{setU(e.target.value);setErr(false);}} placeholder="Enter username" disabled={locked} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={p} onChange={e=>{setP(e.target.value);setErr(false);}} placeholder="Enter password" disabled={locked} />
          </div>
          <button type="submit" className="login-btn" disabled={locked}>
            {locked ? `Locked — wait ${fmt_t(timeLeft)}` : 'Sign In →'}
          </button>
          {err && <div className="login-err">{locked ? `Locked. Wait ${fmt_t(timeLeft)}.` : 'Invalid credentials.'}</div>}
        </form>
        <div style={{textAlign:'right',marginTop:20,fontSize:11,color:'var(--muted)'}}>Powered by <strong>Knitworks</strong></div>
      </div>
    </div>
  );
}

function InlineTable({ headers, rows, height, searchable, initialQuery }) {
  const [sc, setSc] = useState(null);
  const [sd, setSd] = useState('asc');
  const [q, setQ] = useState(initialQuery || '');
  useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery || ''); }, [initialQuery]);
  const handleSort = (i) => { if (sc === i) setSd(d => d === 'asc' ? 'desc' : 'asc'); else { setSc(i); setSd('asc'); } };
  const filteredRows = (searchable && q.trim())
    ? rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(q.trim().toLowerCase())))
    : rows;
  const sorted = [...filteredRows].sort((a, b) => {
    if (sc === null) return 0;
    const av = a[sc], bv = b[sc];
    const an = parseFloat(String(av).replace(/[^0-9.-]/g,'')), bn = parseFloat(String(bv).replace(/[^0-9.-]/g,''));
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
    return sd === 'asc' ? cmp : -cmp;
  });
  return (
    <div className="tbl-wrap" style={{height, display:'flex', flexDirection:'column'}}>
      {searchable && (
        <div className="tbl-search-wrap">
          <input type="text" placeholder="Search this table…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search table" />
          {q.trim() && <span className="tbl-search-count">{sorted.length}/{rows.length}</span>}
        </div>
      )}
      <div style={{flex:1, minHeight:0, overflow:'auto'}}>
        <table className="itbl">
          <thead><tr>{headers.map((h,i) => <th key={i} onClick={()=>handleSort(i)}>{h} <span style={{opacity:.5,fontSize:8}}>{sc===i?(sd==='asc'?'↑':'↓'):'⇅'}</span></th>)}</tr></thead>
          <tbody>{sorted.map((row,ri) => (
            <tr key={ri}>{row.map((cell,ci) => {
              if (ci === 0 && (headers[0] === '#' || typeof cell === 'number' || /^\d+$/.test(String(cell)))) {
                return <td key={ci}><span className={`rank ${ri===0?'r1':ri===1?'r2':ri===2?'r3':'rn'}`}>{cell}</span></td>;
              }
              return <td key={ci}>{cell}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, tag, controls, flex, height, style, className, children, defaultView = 'chart', tableHeaders, tableRows, insight, searchableTable, tableInitialQuery, headerExtra }) {
  const [view, setView] = useState(defaultView);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 260); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = e => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  const hasToggle = tableHeaders && tableRows;
  const panelStyle = { ...(height != null ? { flex: '0 0 auto', height } : flex ? { flex } : {}), ...style };
  const fixedVars = height != null ? { '--fin-fixed-h': typeof height === 'number' ? `${height}px` : height } : undefined;

  const expandBtn = (
    <button className="cp-expand-btn" title="Expand chart" onClick={()=>setFullscreen(true)}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path d="M1 5V2a1 1 0 0 1 1-1h3M9 1h3a1 1 0 0 1 1 1v3M13 9v3a1 1 0 0 1-1 1H9M5 13H2a1 1 0 0 1-1-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );

  const headerControls = (
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,flexWrap:'wrap',marginLeft:8}}>
      {controls}
      {tag && <div className="cp-tag">{tag}</div>}
      {hasToggle && (
        <div className="view-tog">
          <button className={`vt-btn${view==='chart'?' active':''}`} onClick={()=>setView('chart')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor"/><rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor"/><rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor"/></svg>
            Chart
          </button>
          <button className={`vt-btn${view==='table'?' active':''}`} onClick={()=>setView('table')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="2.5" rx="1" fill="currentColor"/><rect x="1" y="5.5" width="12" height="2" rx=".5" fill="currentColor" opacity=".6"/><rect x="1" y="9.5" width="12" height="2" rx=".5" fill="currentColor" opacity=".4"/></svg>
            Table
          </button>
        </div>
      )}
      {expandBtn}
    </div>
  );

  return (
    <>
      <div className={`chart-panel${className ? ' ' + className : ''}`} style={{ ...panelStyle, ...(fixedVars || {}) }}>
        <div className="cp-head">
          <div style={{flex:1,minWidth:0}}>
            <div className="cp-title">{title}</div>
            {subtitle && <div className="cp-sub">{subtitle}</div>}
            {headerExtra && <div style={{marginTop:4}}>{headerExtra}</div>}
          </div>
          {headerControls}
        </div>
        {insight && <div className="cp-insight"><span className="cp-insight-icon">💡</span><span>{insight}</span></div>}
        <div className="cp-body">
          {!ready && view === 'chart' && (
            <div className="cp-skeleton" aria-hidden="true">
              <div className="cp-skeleton-bar" style={{height:'40%'}}/>
              <div className="cp-skeleton-bar" style={{height:'70%'}}/>
              <div className="cp-skeleton-bar" style={{height:'55%'}}/>
              <div className="cp-skeleton-bar" style={{height:'85%'}}/>
              <div className="cp-skeleton-bar" style={{height:'30%'}}/>
            </div>
          )}
          {view === 'chart' ? children : <InlineTable headers={tableHeaders} rows={tableRows} height="100%" searchable={searchableTable} initialQuery={tableInitialQuery} />}
        </div>
      </div>

      {fullscreen && createPortal(
        <div className="cfs-overlay" onClick={e=>{ if(e.target===e.currentTarget) setFullscreen(false); }}>
          <div className="cfs-panel">
            <div className="cfs-hdr">
              <div className="cfs-titles">
                <div className="cfs-title">{title}</div>
                {subtitle && <div className="cfs-sub">{subtitle}</div>}
              </div>
              {controls && <div style={{display:'flex',alignItems:'center',gap:6}}>{controls}</div>}
              <button className="cfs-close" onClick={()=>setFullscreen(false)} title="Close (Esc)">✕</button>
            </div>
            <div className="cfs-body">{children}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const liveChartInstances = new Set();
function EC({ option, onEvents }) {
  const instRef = useRef(null);
  const handleReady = (inst) => { instRef.current = inst; liveChartInstances.add(inst); };
  useEffect(() => () => { if (instRef.current) liveChartInstances.delete(instRef.current); }, []);
  return (
    <ReactECharts
      option={option}
      style={{height:'100%',width:'100%'}}
      opts={{renderer:'svg'}}
      notMerge={true}
      onEvents={onEvents}
      onChartReady={handleReady}
    />
  );
}

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename, headers, rows) {
  const lines = [headers, ...rows].map(r => r.map(csvEscape).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.replace(/\.xlsx$/i, '.csv');
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function ExportExcelButton({ filename, headers, rows, grain }) {
  const prefix = grain ? `${grain}_` : '';
  const finalName = prefix && !filename.startsWith(prefix) ? prefix + filename : filename;
  const handleExport = () => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, finalName);
  };
  return (
    <span style={{display:'inline-flex',gap:5}}>
      <button className="panel-btn" onClick={handleExport} title="Export to Excel">⬇ Excel</button>
      <button className="panel-btn" style={{color:'var(--accent2)',background:'rgba(64,188,243,0.08)',borderColor:'rgba(64,188,243,0.25)'}} onClick={() => downloadCSV(finalName, headers, rows)} title="Export to CSV">⬇ CSV</button>
    </span>
  );
}

/* ── DATE FILTER ─────────────────────────────────────────────── */
function DateFilterBar({ filter, setFilter }) {
  const years = [...new Set(monthly.map(m => m.m.split(' ')[1]))].sort();
  const [expandedYear, setExpandedYear] = useState(null);
  const [expandedMonth, setExpandedMonth] = useState(null);
  const popRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        setExpandedYear(null);
        setExpandedMonth(null);
      }
    };
    const closeOnScroll = () => { setExpandedYear(null); setExpandedMonth(null); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
      window.removeEventListener('scroll', closeOnScroll);
    };
  }, []);

  // Reset nested month expansion when the year popover switches
  useEffect(() => { setExpandedMonth(null); }, [expandedYear]);

  const toggleYear = (yr) => {
    const isActive = filter.years.includes(yr);
    if (isActive) {
      const newYears = filter.years.filter(y => y !== yr);
      const newMonths = { ...filter.months }; delete newMonths[yr];
      const newWeeks = { ...filter.weeks }; delete newWeeks[yr];
      setFilter({ years: newYears, months: newMonths, weeks: newWeeks });
    } else {
      setFilter({
        years: [...filter.years, yr],
        months: { ...filter.months, [yr]: filter.months[yr] || [] },
        weeks: { ...filter.weeks, [yr]: filter.weeks[yr] || [] }
      });
    }
  };

  const toggleMonth = (yr, m) => {
    const ym = filter.months[yr] || [];
    const isTicked = ym.includes(m);
    const newYm = isTicked ? ym.filter(x => x !== m) : [...ym, m];

    let weeksForYear = filter.weeks?.[yr] || [];
    if (isTicked) {
      const monthWeeks = WEEKS_BY_MONTH[m] || [];
      weeksForYear = weeksForYear.filter(w => !monthWeeks.includes(w));
    }

    setFilter({
      ...filter,
      months: { ...filter.months, [yr]: newYm },
      weeks: { ...filter.weeks, [yr]: weeksForYear }
    });
  };

  const toggleWeek = (yr, weekLabel, ownerMonth) => {
    const currentWeeks = filter.weeks?.[yr] || [];
    const isTicked = currentWeeks.includes(weekLabel);
    const newWeeks = isTicked ? currentWeeks.filter(w => w !== weekLabel) : [...currentWeeks, weekLabel];

    const currentMonths = filter.months?.[yr] || [];
    let newMonths = currentMonths;

    if (!isTicked) {
      // Auto-tick the parent month
      if (!currentMonths.includes(ownerMonth)) newMonths = [...currentMonths, ownerMonth];
    } else {
      // Unticking a week — if no other week of this month remains, drop the month
      const weeksOfMonth = WEEKS_BY_MONTH[ownerMonth] || [];
      const stillTicked = weeksOfMonth.some(w => newWeeks.includes(w));
      if (!stillTicked) newMonths = currentMonths.filter(m => m !== ownerMonth);
    }

    setFilter({
      ...filter,
      months: { ...filter.months, [yr]: newMonths },
      weeks: { ...filter.weeks, [yr]: newWeeks }
    });
  };

  const selectAllMonths = (yr) => {
    const allMonths = monthly.filter(m => m.m.includes(yr)).map(m => m.m);
    setFilter({ ...filter, months: { ...filter.months, [yr]: allMonths } });
  };
  const clearMonths = (yr) => {
    setFilter({
      ...filter,
      months: { ...filter.months, [yr]: [] },
      weeks: { ...filter.weeks, [yr]: [] }
    });
  };

  const eff = effGrainFor(filter);
  const hasBothYears = filter.years.includes('25') && filter.years.includes('26');
  const y26HasWeeks = (filter.weeks?.['26'] || []).length > 0;
  const showCrossYearNotice = hasBothYears && y26HasWeeks && eff !== 'weekly';
  const showWeeklyBadge = eff === 'weekly';

  return (
    <div className="filter-bar" ref={popRef} style={{ position:'relative', overflow:'visible', zIndex:100 }}>
      <span className="filter-label">🔍 Filter</span>
      {showWeeklyBadge && (
        <span className="cp-tag" style={{ background:'rgba(64,188,243,0.10)', color:'var(--accent2)', borderColor:'rgba(64,188,243,0.30)' }}>
          Weekly view
        </span>
      )}
      <div className="filter-chips" style={{ display:'flex', gap:'6px', flexWrap:'nowrap', alignItems:'center', overflow:'visible', padding:'4px 0', flex:1, minWidth:0, position:'relative' }}>
        {years.map(yr => {
          const active = filter.years.includes(yr);
          const mc = (filter.months[yr]||[]).length;
          const wc = (filter.weeks?.[yr]||[]).length;
          const isExpanded = expandedYear === yr;
          const summary = [
            mc > 0 ? `${mc}m` : null,
            wc > 0 ? `${wc}w` : null
          ].filter(Boolean).join(' · ');
          return (
            <div key={yr} style={{ position:'relative', display:'inline-flex', alignItems:'center', gap:3, zIndex: isExpanded ? 9999 : 1 }}>
              <button className={`filter-chip${active?' active':''}`} onClick={() => toggleYear(yr)} style={{ whiteSpace:'nowrap' }}>
                {active ? '☑' : '☐'} 20{yr}{active && summary ? ` (${summary})` : ''}
              </button>
              {active && (
                <button style={{ padding:'2px 5px', border:'1px solid var(--border)', borderRadius:4, background:'var(--surface3)', cursor:'pointer', fontSize:9, color:'var(--muted)', flexShrink:0 }}
                  onClick={(e) => { e.stopPropagation(); setExpandedYear(isExpanded ? null : yr); }}>
                  {isExpanded ? '▲' : '▼'}
                </button>
              )}
              {isExpanded && (
                <div
                  style={{ position:'fixed', marginTop:'4px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:10, zIndex:99999, boxShadow:'0 8px 32px rgba(0,0,0,0.25)', minWidth:240, maxWidth:340, maxHeight:420, overflowY:'auto', transform:'translateY(4px)' }}
                  onClick={(e) => e.stopPropagation()}
                  ref={(el) => {
                    if (el) {
                      const rect = el.parentElement.getBoundingClientRect();
                      const w = el.offsetWidth || 280;
                      el.style.top = (rect.bottom + 4) + 'px';
                      el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
                    }
                  }}
                >
                  <div style={{ display:'flex', gap:4, marginBottom:8, flexWrap:'wrap' }}>
                    <button onClick={() => selectAllMonths(yr)} style={{ padding:'3px 10px', border:'1px solid var(--accent)', borderRadius:4, background:'rgba(64,188,243,0.08)', color:'var(--accent2)', cursor:'pointer', fontSize:10, fontWeight:600, fontFamily:'inherit' }}>Select All</button>
                    <button onClick={() => clearMonths(yr)} style={{ padding:'3px 10px', border:'1px solid var(--muted)', borderRadius:4, background:'transparent', color:'var(--muted)', cursor:'pointer', fontSize:10, fontFamily:'inherit' }}>Clear</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:1, maxHeight:300, overflowY:'auto' }}>
                    {monthly.filter(m => m.m.includes(yr)).map(({m}) => {
                      const sel = (filter.months[yr]||[]).includes(m);
                      const monthWeeks = yr === '26' ? (WEEKS_BY_MONTH[m] || []) : [];
                      const hasWeeks = monthWeeks.length > 0;
                      const isMonthExpanded = expandedMonth === m;
                      const tickedWeeks = filter.weeks?.[yr] || [];

                      return (
                        <div key={m}>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <label style={{
                              flex:1, display:'flex', alignItems:'center', gap:6,
                              padding:'4px 8px', borderRadius:4, cursor:'pointer',
                              background: sel ? 'rgba(64,188,243,.08)' : 'transparent',
                              fontSize:11, fontFamily:'inherit', transition:'background .14s'
                            }}
                              onMouseEnter={(e) => e.currentTarget.style.background = sel ? 'rgba(64,188,243,.15)' : 'rgba(64,188,243,.05)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = sel ? 'rgba(64,188,243,.08)' : 'transparent'}>
                              <input type="checkbox" checked={sel} onChange={() => toggleMonth(yr, m)}
                                style={{ width:12, height:12, cursor:'pointer', accentColor:'var(--accent)', flexShrink:0 }} />
                              <span style={{ whiteSpace:'nowrap' }}>{m}</span>
                            </label>
                            {hasWeeks && (
                              <button onClick={() => setExpandedMonth(isMonthExpanded ? null : m)}
                                title={isMonthExpanded ? 'Hide weeks' : 'Show weeks'}
                                style={{
                                  border:'none', background:'transparent', cursor:'pointer',
                                  fontSize:10, color:'var(--muted)', padding:'2px 6px', borderRadius:4,
                                  fontFamily:'inherit'
                                }}>
                                {isMonthExpanded ? '▾' : '▸'}
                              </button>
                            )}
                          </div>
                          {isMonthExpanded && (
                            <div style={{ paddingLeft:22, display:'flex', flexDirection:'column', gap:1, marginTop:2, marginBottom:4 }}>
                              {monthWeeks.map(w => {
                                const wTicked = tickedWeeks.includes(w);
                                return (
                                  <label key={w} style={{
                                    display:'flex', alignItems:'center', gap:6,
                                    padding:'3px 6px', borderRadius:4, cursor:'pointer',
                                    fontSize:10.5, fontFamily:'inherit',
                                    background: wTicked ? 'rgba(64,188,243,.10)' : 'transparent',
                                    transition:'background .14s'
                                  }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = wTicked ? 'rgba(64,188,243,.18)' : 'rgba(64,188,243,.05)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = wTicked ? 'rgba(64,188,243,.10)' : 'transparent'}>
                                    <input type="checkbox" checked={wTicked} onChange={() => toggleWeek(yr, w, m)}
                                      style={{ width:11, height:11, cursor:'pointer', accentColor:'var(--accent)', flexShrink:0 }} />
                                    <span style={{ color: wTicked ? 'var(--accent2)' : 'var(--muted)', fontWeight: wTicked ? 600 : 500 }}>{w}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filter.years.length > 0 && (
          <>
            <div className="filter-divider"/>
            <button className="filter-clear" onClick={() => setFilter({years:[],months:{},weeks:{}})} style={{ flexShrink:0 }}>✕ Clear</button>
          </>
        )}
        {showCrossYearNotice && (
          <span style={{ fontSize:9, color:'var(--amber)', fontWeight:600, whiteSpace:'nowrap', marginLeft:'auto', paddingRight:6 }}>
            ⚠ 2025 has no weekly data — 2026 shown at {eff} level
          </span>
        )}
      </div>
      <div className="filter-meta">
        <div className="filter-meta-row">Last update: <strong>{lastUpdated}</strong></div>
        <div className="filter-meta-row">Last invoice: <strong>{maxFactuurDatum}</strong></div>
      </div>
    </div>
  );
}

/* ── KPI NOTE (small reminder above the KPI strip) ───────────── */
function KpiNote() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0, marginBottom:-2 }}>
      <span className="cp-tag" style={{ background:'rgba(64,188,243,0.08)', color:'var(--accent2)', borderColor:'rgba(64,188,243,0.25)' }}>
        Period-aware
      </span>
      <span style={{ fontSize:10, color:'var(--muted)' }}>
        KPIs match your selected period
      </span>
    </div>
  );
}

/* ── PAGES ───────────────────────────────────────────────────── */

function Overview() {
  const currentMonthEntry = monthly[monthly.length - 1];
  const currentMonth = currentMonthEntry?.m;
  const last3 = monthly.slice(-3);
  const last3WithPY = last3.map(cur => {
    const [name, yy] = cur.m.split(' ');
    const pyYear = String(parseInt(yy, 10) - 1).padStart(2, '0');
    const py = monthly.find(x => x.m === `${name} ${pyYear}`);
    return { name, cyLabel: cur.m, cy: cur.rev, py: py ? py.rev : null, pyLabel: py ? py.m : null };
  });
  const last3Names = last3.map(m => m.m);
  const cats = useMemo(() => {
    const g = {};
    categoriesRaw.filter(c => last3Names.includes(c.m)).forEach(c => {
      const k = c.n.trim();
      if (!g[k]) g[k] = { n: k, rev: 0, orders: 0 };
      g[k].rev += c.rev; g[k].orders += c.orders;
    });
    return Object.values(g).sort((a, b) => b.rev - a.rev);
  }, [last3Names.join(',')]);
  const catsTotalRev = cats.reduce((s, c) => s + c.rev, 0);

  const melkSalesmen = useMemo(() => [...new Set(melkpoederTonnage2025.map(t => t.salesman))].filter(n => n !== 'Unknown' && n !== 'Webshop').sort(), []);
  const [melkSalesman, setMelkSalesman] = useState('All');
  const melkCYMonths = useMemo(() => {
    const seen = new Set();
    tonnagePerSalesman.filter(t => t.category === 'Melkpoeder').forEach(t => (t.monthly || []).forEach(mo => seen.add(mo.m)));
    const order = monthly.map(m => m.m);
    return [...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, []);
  const melkPeriods = useMemo(() => ['Full period', ...melkCYMonths], [melkCYMonths]);
  const [melkPeriod, setMelkPeriod] = useState('Full period');
  const melkTonChartData = useMemo(() => {
    const months = melkPeriod === 'Full period' ? melkCYMonths : [melkPeriod];
    return months.map(cyM => {
      const [name, yy] = cyM.split(' ');
      const pyM = `${name} ${String(parseInt(yy, 10) - 1).padStart(2, '0')}`;
      let cyTon = 0, pyTon = null, cyRev = null, pyRev = null;
      if (melkSalesman === 'All') {
        const melkTotal = totalTonnageByCategory.find(c => c.category === 'Melkpoeder');
        const cyEntry = melkTotal?.monthly.find(x => x.m === cyM);
        cyTon = cyEntry?.tonnage ?? 0; cyRev = cyEntry?.revenue ?? null;
        const pyEntry = melkTotal?.monthly.find(x => x.m === pyM);
        pyTon = pyEntry?.tonnage ?? null;
        const pyRevSum = melkpoederTonnage2025.reduce((s, rec) => { const e = rec.monthly.find(x => x.m === pyM); return s + (e?.revenue ?? 0); }, 0);
        pyRev = pyRevSum > 0 ? pyRevSum : null;
      } else {
        const cyRec = tonnagePerSalesman.find(t => t.salesman === melkSalesman && t.category === 'Melkpoeder');
        const cyEntry = cyRec?.monthly.find(x => x.m === cyM);
        cyTon = cyEntry?.tonnage ?? 0; cyRev = cyEntry?.revenue ?? null;
        const pyRec = melkpoederTonnage2025.find(t => t.salesman === melkSalesman);
        const pyEntry = pyRec?.monthly.find(x => x.m === pyM);
        pyTon = pyEntry?.tonnage ?? null; pyRev = pyEntry?.revenue ?? null;
      }
      return { label: name, cyM, pyM, cy: cyTon, py: pyTon, cyRev, pyRev };
    });
  }, [melkSalesman, melkPeriod, melkCYMonths]);

  const fmtTon = v => (v === null || v === undefined || isNaN(v)) ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' t';
  const fmtRev = v => (v === null || v === undefined || isNaN(v)) ? '—' : '€' + v.toLocaleString('de-DE', { maximumFractionDigits: 0 });

  const melkTonOpt = useMemo(() => withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger:'axis', axisPointer:{ type:'shadow' },
      formatter: function (params) {
        const idx = params[0].dataIndex; const d = melkTonChartData[idx];
        let html = `<strong>${params[0].axisValue}</strong><br/>`;
        html += `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#73D4F2;margin-right:4px"></span>This Year &nbsp; ${fmtTon(d.cy)} &nbsp;|&nbsp; ${fmtRev(d.cyRev)}<br/>`;
        html += `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#0891B2;margin-right:4px"></span>Last Year &nbsp; ${d.py != null ? fmtTon(d.py) : '—'} &nbsp;|&nbsp; ${fmtRev(d.pyRev)}<br/>`;
        return html;
      }
    },
    legend: { bottom:2, textStyle:{ color:'#5F7078', fontSize:10 }, icon:'roundRect', selectedMode:false, padding:[0,8] },
    grid: { left:'3%', right:'4%', bottom: isMobileViewport() && melkTonChartData.length>3 ? '28%' : '22%', top:'5%', containLabel:true },
    xAxis: { type:'category', data:melkTonChartData.map(d=>d.label), axisLabel:catAxisLabel(melkTonChartData.length,9) },
    yAxis: { type:'value', minInterval:0.1, axisLabel:{ color:'#5F7078', fontSize:9, formatter: v => v.toLocaleString('de-DE',{maximumFractionDigits:0})+' t' }, splitLine:{ lineStyle:{ color:'#F0F3F4' } } },
    series: [
      { name:'Last Year', type:'bar', data:melkTonChartData.map(d=>d.py), itemStyle:{ color:'#0891B2', borderRadius:[3,3,0,0] }, barGap:'0%', barCategoryGap:'30%' },
      { name:'This Year', type:'bar', data:melkTonChartData.map(d=>d.cy), itemStyle:{ color:'#73D4F2', borderRadius:[3,3,0,0] }, barGap:'0%', barCategoryGap:'30%' },
    ]
  }), [melkTonChartData]);

  const melkTonTable = { headers:['Month','Ton TY','Rev TY','Ton LY','Rev LY'], rows:melkTonChartData.map(d=>[d.cyM,fmtTon(d.cy),fmtRev(d.cyRev),d.py!=null?fmtTon(d.py):'—',fmtRev(d.pyRev)]) };
  const melkTonControls = (
    <>
      <select className="panel-select" value={melkSalesman} onChange={e=>setMelkSalesman(e.target.value)}><option value="All">All salesmen</option>{melkSalesmen.map(n=><option key={n} value={n}>{n}</option>)}</select>
      <select className="panel-select" value={melkPeriod} onChange={e=>setMelkPeriod(e.target.value)}>{melkPeriods.map(p=><option key={p} value={p}>{p}</option>)}</select>
    </>
  );
  const melkTotCY = melkTonChartData.reduce((s,d)=>s+(d.cy||0),0);
  const melkTotPY = melkTonChartData.some(d=>d.py!=null) ? melkTonChartData.reduce((s,d)=>s+(d.py||0),0) : null;
  const melkDeltaPct = melkTotPY ? ((melkTotCY-melkTotPY)/melkTotPY*100) : null;
  const melkTonInsight = `Melkpoeder${melkSalesman!=='All'?` · ${melkSalesman.split(' ')[0]}`:''}  — ${melkPeriod}: ${fmtTon(melkTotCY)}${melkDeltaPct!=null?` · ${melkDeltaPct>=0?'▲':'▼'} ${Math.abs(melkDeltaPct).toFixed(1)}% vs last year`:''}`;

  const repsLast3Months = useMemo(() => {
    const g = {};
    salesrepsRaw.filter(r=>last3Names.includes(r.m)).forEach(r=>{const k=r.n.trim();if(!g[k])g[k]={n:k,rev:0,qty:0,orders:0};g[k].rev+=r.rev;g[k].qty+=r.qty;g[k].orders+=r.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  }, [last3Names.join(',')]);

  const cmpOpt = withDataZoom({
    tooltip:{ ...TOOLTIP_STYLE, trigger:'axis', axisPointer:{type:'shadow'}, formatter:function(params){let html=`<strong>${params[0].name}</strong><br/>`;params.forEach(p=>{const val=p.value;html+=`${p.marker} ${p.seriesName}: ${val!=null?fmtFull(val):'—'}<br/>`;});return html;}},
    legend:{bottom:2,textStyle:{color:'#5F7078',fontSize:10},icon:'roundRect',selectedMode:false,padding:[0,8]},
    grid:{left:'3%',right:'4%',bottom:'22%',top:'5%',containLabel:true},
    xAxis:{type:'category',data:last3WithPY.map(d=>d.name),axisLabel:catAxisLabel(last3WithPY.length,9)},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:[
      {name:'Last Year',type:'bar',data:last3WithPY.map(d=>d.py),itemStyle:{color:'#0891B2',borderRadius:[3,3,0,0]},barGap:'0%',barCategoryGap:'30%'},
      {name:'This Year',type:'bar',data:last3WithPY.map(d=>d.cy),itemStyle:{color:'#73D4F2',borderRadius:[3,3,0,0]},barGap:'0%',barCategoryGap:'30%'},
    ]
  });

  const repOpt = withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},
    grid:{left:'2%',right:'6%',bottom:'12%',top:'5%',containLabel:true},
xAxis:{type:'value',min:0,minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?8:9,formatter:v=>fmt(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:repsLast3Months.map(d=>d.n.split(' ')[0]),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    legend:{show:false},
    series:[{type:'bar',data:repsLast3Months.map((d,i)=>({value:d.rev,itemStyle:{color:PALETTE[i%PALETTE.length],borderRadius:[0,3,3,0]}})),barMaxWidth:22}]
  });

  const cmpTable={headers:['Month','This Year','Last Year'],rows:last3WithPY.map(d=>[d.cyLabel,fmtFull(d.cy),d.py!=null?fmtFull(d.py):'—'])};
  const repTable={headers:['#','Verkoper','Revenue','Orders'],rows:repsLast3Months.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders)])};

  const momDelta = last3.length>=2 && last3[last3.length-2].rev ? ((last3[last3.length-1].rev-last3[last3.length-2].rev)/last3[last3.length-2].rev)*100 : null;
  const turnoverInsight = momDelta!=null ? `Revenue ${momDelta>=0?'up':'down'} ${Math.abs(momDelta).toFixed(1)}% vs last month${cats[0]?` · Top category: ${cats[0].n} (${catsTotalRev>0?(cats[0].rev/catsTotalRev*100).toFixed(0):0}% of last 3 months)`:''}` : null;
  const repTotalRev = repsLast3Months.reduce((s,r)=>s+r.rev,0);
  const repInsight = repsLast3Months[0] ? `Leading over last 3 months: ${repsLast3Months[0].n} with ${fmtFull(repsLast3Months[0].rev)}${repsLast3Months.length>1?` (${repTotalRev>0?(repsLast3Months[0].rev/repTotalRev*100).toFixed(0):0}% of last 3 months' revenue)`:''}` : null;

  // Category trends chart: weekly (default) or monthly (CY vs PY)
  const [catGrain, setCatGrain] = useState('weekly');

  const catWeeklyOpt = useMemo(()=>{
    const allWeeks = [...new Set(weekly.map(w=>w.w))].sort().slice(-12);
    const series = [];
    GROUP_NAMES.forEach((grp,gi)=>{
      const cats = CATEGORY_GROUPS[grp];
      const thisYear = allWeeks.map(wk=>
        categoriesWeeklyRaw.filter(r=>r.w===wk&&cats.includes(r.n.trim())).reduce((s,r)=>s+r.rev,0)
      );
      series.push({name:`${grp}`,type:'line',data:thisYear,itemStyle:{color:GROUP_PALETTE[gi]},lineStyle:{width:2,type:'solid'},symbol:'circle',symbolSize:4});
    });
    return withCrosshair({
      tooltip:{...TOOLTIP_STYLE,trigger:'axis',confine:false,appendToBody:true,extraCssText:'border-radius:10px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:none !important;width:auto !important;white-space:nowrap;overflow:visible;',formatter:p=>{const rows=p.filter(s=>s.value!=null&&s.value!==0);const half=Math.ceil(rows.length/2);const col=(arr)=>arr.map(s=>`<div style="display:flex;align-items:center;gap:4px;line-height:1.6;white-space:nowrap">${s.marker}<span style="font-size:10px;white-space:nowrap">${s.seriesName}: ${fmtFull(s.value)}</span></div>`).join('');return`<div style="font-size:11px;font-weight:700;margin-bottom:4px">${p[0].axisValue}</div><div style="display:flex;gap:16px;white-space:nowrap"><div>${col(rows.slice(0,half))}</div><div>${col(rows.slice(half))}</div></div>`;}},
      legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:8},type:'scroll',itemWidth:10,itemHeight:10},
      grid:{left:'2%',right:'2%',bottom:'22%',top:'8%',containLabel:true},
      xAxis:{type:'category',data:allWeeks,axisLabel:{color:'#5F7078',fontSize:8,rotate:30,hideOverlap:true}},
      yAxis:{type:'value',axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
      series
    });
  },[]);

  const catMonthlyOpt = useMemo(()=>{
    // Find months present in both 2025 and 2026 by month number (1–12)
    const monthNums25 = new Set(categoriesRaw.filter(r=>r.m&&r.m.endsWith('25')).map(r=>r.m.split(' ')[0]));
    const monthNums26 = new Set(categoriesRaw.filter(r=>r.m&&r.m.endsWith('26')).map(r=>r.m.split(' ')[0]));
    const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const commonMonths = monthOrder.filter(mn=>monthNums25.has(mn)&&monthNums26.has(mn));
    const series = [];
    GROUP_NAMES.forEach((grp,gi)=>{
      const cats = CATEGORY_GROUPS[grp];
      const cy = commonMonths.map(mn=>{
        const key=`${mn} 26`;
        return categoriesRaw.filter(r=>r.m===key&&cats.includes(r.n.trim())).reduce((s,r)=>s+r.rev,0);
      });
      const py = commonMonths.map(mn=>{
        const key=`${mn} 25`;
        return categoriesRaw.filter(r=>r.m===key&&cats.includes(r.n.trim())).reduce((s,r)=>s+r.rev,0);
      });
      series.push({name:`${grp} '26`,type:'line',data:cy,itemStyle:{color:GROUP_PALETTE[gi]},lineStyle:{width:2,type:'solid'},symbol:'circle',symbolSize:4,smooth:true});
      series.push({name:`${grp} '25`,type:'line',data:py,itemStyle:{color:GROUP_PALETTE[gi]},lineStyle:{width:1.5,type:'dashed',opacity:0.6},symbol:'none',smooth:true});
    });
    return withCrosshair({
      tooltip:{...TOOLTIP_STYLE,trigger:'axis',confine:false,appendToBody:true,extraCssText:'border-radius:10px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:none !important;width:auto !important;white-space:nowrap;overflow:visible;',formatter:p=>{const rows=p.filter(s=>s.value!=null&&s.value!==0);const half=Math.ceil(rows.length/2);const col=(arr)=>arr.map(s=>`<div style="display:flex;align-items:center;gap:4px;line-height:1.6;white-space:nowrap">${s.marker}<span style="font-size:10px;white-space:nowrap">${s.seriesName}: ${fmtFull(s.value)}</span></div>`).join('');return`<div style="font-size:11px;font-weight:700;margin-bottom:4px">${p[0].axisValue}</div><div style="display:flex;gap:16px;white-space:nowrap"><div>${col(rows.slice(0,half))}</div><div>${col(rows.slice(half))}</div></div>`;}},
      legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:8},type:'scroll',itemWidth:10,itemHeight:10},
      grid:{left:'2%',right:'2%',bottom:'22%',top:'8%',containLabel:true},
      xAxis:{type:'category',data:commonMonths,axisLabel:{color:'#5F7078',fontSize:9}},
      yAxis:{type:'value',axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
      series
    });
  },[]);

  const catSubtitle = catGrain==='weekly'
    ? '4 groups · this year · prior year unavailable — click Monthly for CY vs PY'
    : '4 groups · solid = 2026, dashed = 2025 · same month comparison';

  return (
    <div className="page-area" key="overview">
      <div className="kpi-strip">
        <div className="kpi-card green"><div className="kpi-lbl">Turnover MTD</div><div className="kpi-val sm">{fmtFull(turnoverMTD)}</div><div className="kpi-chg">Revenue this month, to date</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Projected MTD</div><div className="kpi-val sm">{fmtFull(projectedMTD)}</div><div className="kpi-chg">Open MTD + Revenue MTD</div></div>
        <div className="kpi-card blue"><div className="kpi-lbl">Open Orders (Future) – Kalverhuisvesting</div><div className="kpi-val sm">{fmtFull(openOrderValueFuture)}</div><div className="kpi-chg">Due after today</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Open Value MTD</div><div className="kpi-val sm">{fmtFull(openOrderValueMTD)}</div><div className="kpi-chg">Open orders due this month</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Open Value (Full)</div><div className="kpi-val sm">{fmtFull(openOrderValuePresent)}</div><div className="kpi-chg">All open orders due today or earlier</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1.4}}>
          <Panel title="Turnover — Last 3 Months" subtitle={`This year vs last year · through ${currentMonth||'—'}`} flex={1} tableHeaders={cmpTable.headers} tableRows={cmpTable.rows} insight={turnoverInsight}><EC option={cmpOpt}/></Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Melkpoeder Tonnage" subtitle={melkSalesman==='All'?'Per month · this year vs last year':`${melkSalesman.split(' ')[0]} · this year vs last year`} flex={1} controls={melkTonControls} tableHeaders={melkTonTable.headers} tableRows={melkTonTable.rows} insight={melkTonInsight}><EC option={melkTonOpt}/></Panel>
        </div>
      </div>
      <div className="charts-row" style={{flex:0.8}}>
        <Panel title="Category Trends" subtitle={catSubtitle} flex={1} controls={
          <div className="view-tog">
            <button className={`vt-btn${catGrain==='weekly'?' active':''}`} onClick={()=>setCatGrain('weekly')}>Weekly</button>
            <button className={`vt-btn${catGrain==='monthly'?' active':''}`} onClick={()=>setCatGrain('monthly')}>Monthly</button>
          </div>
        }><EC option={catGrain==='weekly'?catWeeklyOpt:catMonthlyOpt}/></Panel>
      </div>
    </div>
  );
}

function Revenue({ fm, label, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const useYearly = effGrain === 'yearly';

  const periods = useMemo(() => {
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      return weekly.filter(w => set.has(w.w)).map(w => ({ key: w.w, rev: w.rev, orders: w.orders }));
    }
    if (useYearly) {
      return deriveYearlyFromFilter(filter, fm).map(y => ({ key: y.year, rev: y.rev, orders: y.orders }));
    }
    return fm.map(m => ({ key: m.m, rev: m.rev, orders: m.orders }));
  }, [useWeekly, useYearly, tickedWeeks, fm, filter]);

  const periodLabel = useWeekly ? 'Week' : useYearly ? 'Year' : 'Month';

  const totalRev=periods.reduce((s,m)=>s+m.rev,0);
  const totalOrders=periods.reduce((s,m)=>s+m.orders,0);
  const best=periods.length?periods.reduce((b,c)=>c.rev>b.rev?c:b,periods[0]):null;
  const avg=periods.length?totalRev/periods.length:0;
  const [selectedMonth,setSelectedMonth]=useState(null);
  const [showPrevOverlay,setShowPrevOverlay]=useState(false);
  const prevPeriod=useMemo(()=>{
    if(useWeekly || useYearly) return [];
    if(!fm.length)return[];
    const startIdx=monthly.findIndex(m=>m.m===fm[0].m);
    if(startIdx<=0)return[];
    const from=Math.max(0,startIdx-fm.length);
    return monthly.slice(from,startIdx);
  },[fm, useWeekly, useYearly]);
  const canShowPrev=!useWeekly && !useYearly && prevPeriod.length>0;
  const prevTotal=prevPeriod.reduce((s,m)=>s+m.rev,0);
  const periodDelta=(canShowPrev&&prevTotal)?((totalRev-prevTotal)/prevTotal)*100:null;

  const barOpt=withDataZoom(withCrosshair({
    tooltip:{trigger:'axis',formatter:p=>{let html=`<strong>${p[0].name}</strong><br/>`;p.forEach(s=>{html+=`${s.marker} ${s.seriesName}: ${s.value!=null?fmtFull(s.value):'—'}<br/>`;});return html;}},
    legend:showPrevOverlay&&canShowPrev?{bottom:0,textStyle:{color:'#5F7078',fontSize:10},icon:'roundRect',selectedMode:false}:undefined,
    grid:{left:'3%',right:'4%',bottom:isMobileViewport()&&periods.length>3?'28%':(showPrevOverlay&&canShowPrev?'18%':'12%'),top:'8%',containLabel:true},
    xAxis:{type:'category',data:periods.map(d=>d.key),axisLabel:catAxisLabel(periods.length,9)},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:[
      {name:'Current period',type:'bar',data:periods.map(d=>({value:d.rev,itemStyle:{color:selectedMonth&&selectedMonth!==d.key?'rgba(8,145,178,0.2)':'rgba(8,145,178,0.75)',borderRadius:[3,3,0,0]}})),barMaxWidth:28},
      ...(showPrevOverlay&&canShowPrev?[{name:'Previous period',type:'line',data:periods.map((_,i)=>prevPeriod[i]?prevPeriod[i].rev:null),smooth:true,symbol:'circle',symbolSize:5,lineStyle:{color:'#E5A93D',width:2,type:'dashed'},itemStyle:{color:'#E5A93D'}}]:[])
    ]
  }));

  const prevToggleControl=(
    <button className={`cmp-toggle${showPrevOverlay?' active':''}`} onClick={()=>setShowPrevOverlay(v=>!v)} disabled={!canShowPrev}>
      ↔ {showPrevOverlay?'Hide':'vs'} Previous period
    </button>
  );
  const revenueInsight=(()=>{const parts=[];if(periodDelta!=null)parts.push(`Revenue ${periodDelta>=0?'up':'down'} ${Math.abs(periodDelta).toFixed(1)}% vs the previous period`);if(best)parts.push(`Best ${periodLabel.toLowerCase()}: ${best.key} (${fmtFull(best.rev)})`);return parts.length?parts.join(' · '):null;})();

  const m25=fm.filter(m=>m.m.includes('25')),m26=fm.filter(m=>m.m.includes('26'));
  const order=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const n25=m25.map(m=>m.m.split(' ')[0]),n26=m26.map(m=>m.m.split(' ')[0]);
  let cMonths=(m25.length&&m26.length)?n25.filter(m=>n26.includes(m)):[...new Set([...n25,...n26])];
  cMonths.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const lineSeries=[];
  if(m25.length)lineSeries.push({name:'2025',type:'line',data:cMonths.map(m=>m25.find(d=>d.m.startsWith(m))?.rev||null),lineStyle:{color:'#0891B2',width:2,type:'dashed'},itemStyle:{color:'#0891B2'},areaStyle:{color:'rgba(8,145,178,.07)'},smooth:true});
  if(m26.length)lineSeries.push({name:'2026',type:'line',data:cMonths.map(m=>m26.find(d=>d.m.startsWith(m))?.rev||null),lineStyle:{color:'#73D4F2',width:2},itemStyle:{color:'#73D4F2'},areaStyle:{color:'rgba(115,212,242,.07)'},smooth:true});
  const cmpOpt=withDataZoom(withCrosshair({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',formatter:p=>p.map(s=>`${s.marker} ${s.seriesName}: ${s.value?fmtFull(s.value):'—'}`).join('<br/>')},
    legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:10},icon:'roundRect',selectedMode:false},
    grid:{left:'3%',right:'4%',bottom:isMobileViewport()&&cMonths.length>3?'28%':'16%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:cMonths,axisLabel:catAxisLabel(cMonths.length,9)},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:lineSeries
  }));
  const ordersOpt=withDataZoom(withCrosshair({
    tooltip:{trigger:'axis',formatter:p=>`<strong>${p[0].name}</strong><br/>Orders: ${fmtN(p[0].value)}`},
    grid:{left:'3%',right:'4%',bottom:isMobileViewport()&&periods.length>3?'28%':'12%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:periods.map(d=>d.key),axisLabel:catAxisLabel(periods.length,9),axisLine:{lineStyle:{color:'#DDE6E9'}}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmtN(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:[{type:'line',data:periods.map(d=>d.orders),step:'middle',symbol:'circle',symbolSize:(val,params)=>{const m=periods[params.dataIndex]?.key;return selectedMonth&&selectedMonth===m?8:5;},lineStyle:{color:'#0369A1',width:2},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(3,105,161,.18)'},{offset:1,color:'rgba(3,105,161,.01)'}]}},itemStyle:{color:'#0369A1',borderColor:'#fff',borderWidth:1.5},emphasis:{itemStyle:{color:'#0369A1'}}}]
  },fmtN));

  const barTbl={headers:[periodLabel,'Revenue','Orders','Avg Order Value'],rows:periods.map(m=>[m.key,fmtFull(m.rev),fmtN(m.orders),fmtFull(Math.round(m.rev/(m.orders||1)))])};
  const ordTbl={headers:[periodLabel,'Orders'],rows:periods.map(m=>[m.key,fmtN(m.orders)])};
  const handleMonthClick=(p)=>{const month=periods[p.dataIndex]?.key;setSelectedMonth(selectedMonth===month?null:month);};

  const showYearOverlay = !useWeekly && !useYearly;
  const granTag = useWeekly ? 'W' : useYearly ? 'Y' : 'M';

  return (
    <div className="page-area" key="revenue">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Revenue</div><div className="kpi-val sm">{fmtFull(totalRev)}</div><div className="kpi-chg">{fmtN(totalOrders)} transactions</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">{periodLabel}s Shown</div><div className="kpi-val sm">{periods.length}</div><div className="kpi-chg">Active period</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Best {periodLabel}</div><div className="kpi-val sm">{best?best.key:'—'}</div><div className="kpi-chg">{best?fmtFull(best.rev):''}</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Avg / {periodLabel}</div><div className="kpi-val sm">{fmtFull(avg)}</div><div className="kpi-chg">{periods.length}-{periodLabel.toLowerCase()} average</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Revenue Over Time" subtitle={`${label} · ${periods.length} ${periodLabel.toLowerCase()}${periods.length===1?'':'s'}`} tag={`${periods.length}${granTag}`} flex={1} controls={prevToggleControl} tableHeaders={barTbl.headers} tableRows={barTbl.rows} insight={revenueInsight}><EC option={barOpt} onEvents={{'click':handleMonthClick}}/></Panel>
          {showYearOverlay && <Panel title="2025 vs 2026" subtitle="Year overlay" flex={1}><EC option={cmpOpt}/></Panel>}
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Order Volume" subtitle={`Per ${periodLabel.toLowerCase()}`} flex={1} tableHeaders={ordTbl.headers} tableRows={ordTbl.rows}><EC option={ordersOpt} onEvents={{'click':handleMonthClick}}/></Panel>
        </div>
      </div>
    </div>
  );
}

function SalesReps({ fm, label, highlightQuery, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const useYearly = effGrain === 'yearly';
  const months = fm.map(m => m.m);
  const periodLabel = useWeekly ? 'Week' : useYearly ? 'Year' : 'Month';

  const [excludeJohan, setExcludeJohan] = useState(false);
  const [selRep,setSelRep]=useState(null);

  const reps=useMemo(()=>{
    let rows;
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      rows = salesrepsWeeklyRaw.filter(r => set.has(r.w));
    } else {
      rows = salesrepsRaw.filter(r=>months.includes(r.m));
    }
    const g={};
    const filtered = excludeJohan ? rows.filter(r => { const n=r.n.trim().toLowerCase(); return !n.startsWith('johan') && !n.startsWith('joahan'); }) : rows;
    filtered.forEach(r=>{const k=r.n.trim();if(!g[k])g[k]={n:k,rev:0,qty:0,orders:0};g[k].rev+=r.rev;g[k].qty+=r.qty;g[k].orders+=r.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months, useWeekly, tickedWeeks, excludeJohan]);

  const totalRev=reps.reduce((s,r)=>s+r.rev,0);
  const top3=reps.slice(0,3);

  const barOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>{const pct=totalRev>0?(p[0].value/totalRev*100).toFixed(2).replace('.',',' ):'0';return `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)} (${pct}%)`;}},
    grid:{left:'2%',right:'6%',bottom:'12%',top:'5%',containLabel:true},
xAxis:{type:'value',min:0,minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?8:9,formatter:v=>fmt(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:reps.map(d=>d.n.split(' ')[0]),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    legend:{show:false},
    series:[{type:'bar',data:reps.map((d,i)=>({value:d.rev,itemStyle:{color:selRep&&selRep!==d.n?PALETTE[i%PALETTE.length]+'44':PALETTE[i%PALETTE.length],borderRadius:[0,3,3,0]}})),barMaxWidth:18}]
  });
  const tbl={headers:['#','Verkoper','Revenue','Orders','Avg Order Value'],rows:reps.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};
  const handleRepClick=(p)=>{const repName=reps[p.dataIndex]?.n;setSelRep(selRep===repName?null:repName);};
  const leaderboardRows=selRep?tbl.rows.filter(r=>r[1]===selRep):tbl.rows;
  const repsInsight=reps[0]?`${reps[0].n} leads with ${fmtFull(reps[0].rev)}${totalRev>0?` (${(reps[0].rev/totalRev*100).toFixed(0)}% of shown revenue)`:''}`  :null;

  // Sales-per-rep-by-category stays monthly only (no weekly source)
  const smPeriods=useMemo(()=>{const seen=new Set();salesmanCategorySales.forEach(s=>(s.monthly||[]).forEach(mo=>seen.add(mo.m)));return[...seen];},[]);
  const [smPeriod,setSmPeriod]=useState('All');
  const smRevFor=(rec,period)=>{if(!rec)return 0;if(period==='All')return rec.rev;const mo=(rec.monthly||[]).find(m=>m.m===period);return mo?mo.rev:0;};
  const smOrdersFor=(rec,period)=>{if(!rec)return 0;if(period==='All')return rec.orders;const mo=(rec.monthly||[]).find(m=>m.m===period);return mo?mo.orders:0;};
  const smOrder=useMemo(()=>{const totals={};salesmanCategorySales.forEach(s=>{if(s.salesman==='Unknown')return;const nl=s.salesman.trim().toLowerCase();if(excludeJohan&&(nl.startsWith('johan')||nl.startsWith('joahan')))return;totals[s.salesman]=(totals[s.salesman]||0)+smRevFor(s,smPeriod);});return Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([n])=>n);},[smPeriod,excludeJohan]);
  const smSeries=GROUP_NAMES.map((grp,gi)=>({
    name: grp, type:'bar', stack:'total',
    data: smOrder.map(n => {
      const cats = CATEGORY_GROUPS[grp];
      return salesmanCategorySales
        .filter(s => s.salesman===n && cats.includes(s.category))
        .reduce((sum, s) => sum + smRevFor(s, smPeriod), 0);
    }),
    itemStyle:{color:GROUP_PALETTE[gi]}
  }));
  const smOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>{let html=`<strong>${p[0].name}</strong><br/>`;let sum=0;p.forEach(s=>{if(s.value){html+=`${s.marker} ${s.seriesName}: ${fmtFull(s.value)}<br/>`;sum+=s.value;}});html+=`<strong>Total: ${fmtFull(sum)}</strong>`;return html;}},
    legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:8},type:'scroll',itemWidth:10,itemHeight:10},
    grid:{left:'2%',right:'6%',bottom:'20%',top:'5%',containLabel:true},
xAxis:{type:'value',min:0,minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?8:9,formatter:v=>fmt(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:smOrder.map(n=>n.split(' ')[0]),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    series:smSeries
  });
  const smTbl={headers:['Verkoper','Category','Revenue','Orders'],rows:[...salesmanCategorySales].filter(s=>{if(s.salesman==='Unknown')return false;const nl=s.salesman.trim().toLowerCase();if(excludeJohan&&(nl.startsWith('johan')||nl.startsWith('joahan')))return false;return true;}).map(s=>({...s,_rev:smRevFor(s,smPeriod),_orders:smOrdersFor(s,smPeriod)})).filter(s=>smPeriod==='All'||s._rev!==0||s._orders!==0).sort((a,b)=>b._rev-a._rev).map(s=>[s.salesman,s.category,fmtFull(s._rev),fmtN(s._orders)])};
  const smPeriodControl=(<select className="panel-select" value={smPeriod} onChange={e=>setSmPeriod(e.target.value)}><option value="All">Full period</option>{smPeriods.map(p=><option key={p} value={p}>{p}</option>)}</select>);

  const vmSalesmen=useMemo(()=>[...new Set(tonnagePerSalesman.map(t=>t.salesman))].filter(n=>n!=='Unknown').sort(),[]);
  const [vmSalesman,setVmSalesman]=useState('All');
  const VM_CATS=['Melkpoeder','Veevoeders'];
  const vmMonths=useMemo(()=>{const seen=new Set();totalTonnageByCategory.forEach(c=>(c.monthly||[]).forEach(mo=>seen.add(mo.m)));return[...seen].sort();},[]);
  const vmMonthlyData=useMemo(()=>{
    const source=vmSalesman==='All'?totalTonnageByCategory:tonnagePerSalesman.filter(t=>t.salesman===vmSalesman);
    return vmMonths.map(mo=>{
      const row={month:mo};
      VM_CATS.forEach(cat=>{
        const rec=source.find(c=>c.category===cat);
        const m=rec?(rec.monthly||[]).find(x=>x.m===mo):null;
        row[cat+'_rev']=m?m.revenue:0;
        row[cat+'_ton']=m?m.tonnage:0;
      });
      return row;
    });
  },[vmSalesman]);
  const vmOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>{let html=`<strong>${p[0].name}</strong><br/>`;p.forEach(s=>{html+=`${s.marker} ${s.seriesName}: ${s.seriesName.includes('Tonnage')?fmtNum(s.value)+' t':fmtFull(s.value)}<br/>`;});return html;}},
    legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:9},type:'scroll',itemWidth:10,itemHeight:10},
    grid:{left:'2%',right:'6%',bottom:'22%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:vmMonths,axisLabel:{color:'#5F7078',fontSize:8,rotate:30,hideOverlap:true}},
    yAxis:[
      {type:'value',name:'Revenue',nameTextStyle:{color:'#5F7078',fontSize:9},axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
      {type:'value',name:'Tonnage (t)',nameTextStyle:{color:'#5F7078',fontSize:9},axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmtNum(v)},splitLine:{show:false}}
    ],
    series:[
      {name:'Melkpoeder Revenue',type:'bar',barGap:'10%',data:vmMonthlyData.map(r=>r['Melkpoeder_rev']),itemStyle:{color:'#40BCF3',borderRadius:[2,2,0,0]},barMaxWidth:18},
      {name:'Veevoeders Revenue',type:'bar',data:vmMonthlyData.map(r=>r['Veevoeders_rev']),itemStyle:{color:'#2E9B62',borderRadius:[2,2,0,0]},barMaxWidth:18},
      {name:'Melkpoeder Tonnage',type:'line',yAxisIndex:1,data:vmMonthlyData.map(r=>r['Melkpoeder_ton']),itemStyle:{color:'#1F3741'},lineStyle:{width:2,type:'solid'},symbol:'circle',symbolSize:5},
      {name:'Veevoeders Tonnage',type:'line',yAxisIndex:1,data:vmMonthlyData.map(r=>r['Veevoeders_ton']),itemStyle:{color:'#666'},lineStyle:{width:2,type:'dashed'},symbol:'diamond',symbolSize:5}
    ]
  });
  const vmTbl={headers:['Month','Melkpoeder Rev','Melkpoeder Ton','Veevoeders Rev','Veevoeders Ton'],rows:vmMonthlyData.map(r=>[r.month,fmtFull(r['Melkpoeder_rev']),fmtNum(r['Melkpoeder_ton'])+' t',fmtFull(r['Veevoeders_rev']),fmtNum(r['Veevoeders_ton'])+' t'])};
  const vmControls=(<select className="panel-select" value={vmSalesman} onChange={e=>setVmSalesman(e.target.value)}><option value="All">All salesmen</option>{vmSalesmen.map(n=><option key={n} value={n}>{n}</option>)}</select>);

  return (
    <div className="page-area" key="reps">
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:0}}>
        <KpiNote/>
        <button className={`cmp-toggle${excludeJohan?' active':''}`} onClick={()=>setExcludeJohan(v=>!v)}>
          {excludeJohan ? '✓ Johan excluded' : 'Exclude Johan'}
        </button>
        {excludeJohan && <span style={{fontSize:10,color:'var(--muted)'}}>Johan's rows hidden from all charts and table</span>}
      </div>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">#1 — {top3[0]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[0]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[0]?.orders||0)} orders</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">#2 — {top3[1]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[1]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[1]?.orders||0)} orders</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">#3 — {top3[2]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[2]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[2]?.orders||0)} orders</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Top 3 Share</div><div className="kpi-val sm">{totalRev>0?((top3.reduce((s,r)=>s+r.rev,0)/totalRev)*100).toFixed(0):0}%</div><div className="kpi-chg">of total revenue</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Omzet per Verkoper" subtitle={`${label} · ${periodLabel.toLowerCase()}-based`} flex={1} controls={<ExportExcelButton grain={effGrain} filename="omzet_per_verkoper.xlsx" headers={tbl.headers} rows={tbl.rows}/>} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={repsInsight}><EC option={barOpt} onEvents={{'click':handleRepClick}}/></Panel>
          <Panel title="Verkoper Leaderboard" subtitle={selRep?'Filtered · click the chart to change':'Ranked by revenue · click a bar above to drill in'} flex={1}>
            <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
              {selRep&&(<div className="drill-chip">Showing: {selRep}<button onClick={()=>setSelRep(null)} title="Clear selection">✕</button></div>)}
              <div style={{flex:1,minHeight:0}}><InlineTable headers={tbl.headers} rows={leaderboardRows} height="100%" searchable initialQuery={highlightQuery}/></div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Sales per Verkoper by Category" subtitle="Stacked by category · monthly periods" flex={1} controls={<>{smPeriodControl}<ExportExcelButton filename="sales_per_verkoper_by_category.xlsx" headers={smTbl.headers} rows={smTbl.rows}/></>} tableHeaders={smTbl.headers} tableRows={smTbl.rows}><EC option={smOpt}/></Panel>
          <Panel title="Veevoeder & Melkpoeder" subtitle={vmSalesman==='All'?'Revenue vs tonnage':`Revenue vs tonnage — ${vmSalesman}`} flex={1} controls={vmControls} tableHeaders={vmTbl.headers} tableRows={vmTbl.rows}><EC option={vmOpt}/></Panel>
        </div>
      </div>
    </div>
  );
}

function Customers({ fm, label, highlightQuery, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const months=fm.map(m=>m.m);
  const periodLabel = useWeekly ? 'Week' : effGrain === 'yearly' ? 'Year' : 'Month';

  const totalRevenue = useWeekly
    ? (() => { const set = new Set(tickedWeeks); return customersWeeklyRaw.filter(c => set.has(c.w)).reduce((s,c)=>s+c.rev,0); })()
    : fm.reduce((s,m)=>s+m.rev,0);

  const custs=useMemo(()=>{
    let rows;
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      rows = customersWeeklyRaw.filter(c => set.has(c.w));
    } else {
      rows = customersRaw.filter(c=>months.includes(c.m));
    }
    const g={};
    rows.forEach(c=>{if(!g[c.n])g[c.n]={n:c.n,rev:0,orders:0};g[c.n].rev+=c.rev;g[c.n].orders+=c.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months, useWeekly, tickedWeeks]);

  const top15=custs.slice(0,15);
  const top15Rev=top15.reduce((s,c)=>s+c.rev,0);
  const itemsPerPage=15;
  const [currentCount,setCurrentCount]=useState(15);
  const currentItems=custs.slice(0,currentCount);
  const showMore=()=>setCurrentCount(c=>Math.min(c+itemsPerPage,custs.length));
  const showLess=()=>setCurrentCount(c=>Math.max(c-itemsPerPage,itemsPerPage));
  const showAll=()=>setCurrentCount(custs.length);
  const resetToDefault=()=>setCurrentCount(itemsPerPage);

  const barOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},
    grid:{left:'2%',right:'6%',bottom:'12%',top:'5%',containLabel:true},
xAxis:{type:'value',min:0,minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?8:9,formatter:v=>fmt(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:currentItems.map(d=>d.n.length>20?d.n.slice(0,20)+'…':d.n),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    legend:{show:false},
    series:[{type:'bar',data:currentItems.map((d,i)=>({value:d.rev,itemStyle:{color:PALETTE[i%PALETTE.length]+'cc',borderRadius:[0,3,3,0]}})),barMaxWidth:16}]
  });

  const tbl={headers:['#','Customer','Revenue','Orders','Avg Order Value'],rows:currentItems.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};
  const fullTbl={headers:['#','Customer','Revenue','Orders','Avg Order Value'],rows:custs.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};
  const customersInsight=custs[0]?`Top customer: ${custs[0].n} — ${fmtFull(custs[0].rev)}${totalRevenue>0?` (${(custs[0].rev/totalRevenue*100).toFixed(1)}% of total revenue)`:''}`  :null;

  const PaginationControls=()=>(
    <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0,marginTop:'4px',padding:'4px 0',flexWrap:'wrap'}}>
      <button onClick={showLess} disabled={currentCount<=itemsPerPage} style={{padding:'3px 10px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:currentCount<=itemsPerPage?'not-allowed':'pointer',fontSize:'11px',fontFamily:'inherit',opacity:currentCount<=itemsPerPage?0.4:1,transition:'all .14s'}}>◀ Show Less</button>
      <span style={{fontSize:'10px',color:'var(--muted)',fontFamily:'JetBrains Mono, monospace',minWidth:'80px',textAlign:'center'}}>{currentCount>=custs.length?`All ${custs.length}`:`1-${currentCount} / ${custs.length}`}</span>
      <button onClick={showMore} disabled={currentCount>=custs.length} style={{padding:'3px 10px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:currentCount>=custs.length?'not-allowed':'pointer',fontSize:'11px',fontFamily:'inherit',opacity:currentCount>=custs.length?0.4:1,transition:'all .14s'}}>Show More ▶</button>
      <button onClick={currentCount>=custs.length?resetToDefault:showAll} style={{padding:'2px 8px',border:`1px solid ${currentCount>=custs.length?'var(--accent)':'var(--border)'}`,borderRadius:'4px',background:currentCount>=custs.length?'rgba(64,188,243,0.1)':'var(--surface3)',color:currentCount>=custs.length?'var(--accent2)':'var(--muted)',cursor:'pointer',fontSize:'9px',fontFamily:'inherit',marginLeft:'4px',transition:'all .14s'}}>{currentCount>=custs.length?`📋 ${itemsPerPage}`:'📋 Full'}</button>
    </div>
  );

  return (
    <div className="page-area" key="customers">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Customers</div><div className="kpi-val sm">{totalClients.toLocaleString('de-DE')}</div><div className="kpi-chg">Billing accounts</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Top Customer</div><div className="kpi-val sm">{custs[0]?.n?.slice(0,16)||'—'}</div><div className="kpi-chg">{fmtFull(custs[0]?.rev||0)}</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Top 15 Revenue</div><div className="kpi-val sm">{fmtFull(top15Rev)}</div><div className="kpi-chg">{totalRevenue>0?((top15Rev/totalRevenue)*100).toFixed(0):0}% of total</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Avg Rev / Client</div><div className="kpi-val sm">{fmtFull(Math.round(totalRevenue/totalClients))}</div><div className="kpi-chg">Across all accounts</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Customers by Revenue" subtitle={`${label} · ${periodLabel.toLowerCase()}-based`} flex={1} controls={<ExportExcelButton grain={effGrain} filename="customers_by_revenue.xlsx" headers={fullTbl.headers} rows={fullTbl.rows}/>} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={customersInsight}>
            <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
              <div style={{flex:1,minHeight:0}}><EC option={barOpt}/></div>
              <PaginationControls/>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Leaderboard" subtitle="All clients · searchable" flex={1}><InlineTable headers={fullTbl.headers} rows={fullTbl.rows} height="100%" searchable initialQuery={highlightQuery}/></Panel>
        </div>
      </div>
    </div>
  );
}

function Products({ fm, label, highlightQuery, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const months=fm.map(m=>m.m);
  const periodLabel = useWeekly ? 'Week' : effGrain === 'yearly' ? 'Year' : 'Month';

  const prods=useMemo(()=>{
    let rows;
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      rows = productsWeeklyRaw.filter(p => set.has(p.w));
    } else {
      rows = productsRaw.filter(p=>months.includes(p.m));
    }
    const g={};
    rows.forEach(p=>{const k=p.n.trim();if(!g[k])g[k]={n:k,rev:0,qty:0,orders:0};g[k].rev+=p.rev;g[k].qty+=p.qty;g[k].orders+=p.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months, useWeekly, tickedWeeks]);

  const totalRev=prods.reduce((s,p)=>s+p.rev,0);
  const top5Rev=prods.slice(0,5).reduce((s,p)=>s+p.rev,0);
  const productsInsight=prods.length?`Top product: ${prods[0].n}${totalRev>0?` (${(prods[0].rev/totalRev*100).toFixed(0)}% of revenue)`:''} · Top 5 lines make up ${totalRev>0?(top5Rev/totalRev*100).toFixed(0):0}% of total`:null;
  const [selProd,setSelProd]=useState(null);
  const [itemsPerPage]=useState(15);
  const [currentCount,setCurrentCount]=useState(15);
  useEffect(()=>{if(highlightQuery)setCurrentCount(prods.length);},[highlightQuery,prods.length]);
  const [donutItemsPerPage]=useState(10);
  const [donutCurrentCount,setDonutCurrentCount]=useState(10);
  const currentItems=prods.slice(0,currentCount);
  const donutCurrentItems=prods.slice(0,donutCurrentCount);
  const [autoZoom,setAutoZoom]=useState(true);

  const showMore=()=>setCurrentCount(c=>Math.min(c+itemsPerPage,prods.length));
  const showLess=()=>setCurrentCount(c=>Math.max(c-itemsPerPage,itemsPerPage));
  const showAll=()=>setCurrentCount(prods.length);
  const resetToDefault=()=>setCurrentCount(itemsPerPage);
  const showMoreDonut=()=>setDonutCurrentCount(c=>Math.min(c+donutItemsPerPage,prods.length));
  const showLessDonut=()=>setDonutCurrentCount(c=>Math.max(c-donutItemsPerPage,donutItemsPerPage));
  const showAllDonut=()=>setDonutCurrentCount(prods.length);
  const resetToDefaultDonut=()=>setDonutCurrentCount(donutItemsPerPage);

  const barOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},
    grid:{left:'2%',right:'6%',bottom:'12%',top:'5%',containLabel:true},
    xAxis:{type:'value',min:0,minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?8:9,formatter:v=>fmt(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}},max:(value)=>{if(autoZoom&&currentItems.length>0){const maxVal=Math.max(...currentItems.map(p=>p.rev));const minVal=Math.min(...currentItems.map(p=>p.rev));if(maxVal<60000&&maxVal>0)return maxVal*1.3;if(maxVal<200000&&maxVal>0)return maxVal*1.2;return null;}return null;}},
    yAxis:{type:'category',data:currentItems.map(d=>d.n.length>22?d.n.slice(0,22)+'…':d.n),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    legend:{show:false},
    series:[{type:'bar',data:currentItems.map((d,i)=>({value:d.rev,itemStyle:{color:selProd&&selProd!==d.n?PALETTE[i%PALETTE.length]+'44':PALETTE[i%PALETTE.length],borderRadius:[0,3,3,0]}})),barMaxWidth:18}]
  });

  const donutData=donutCurrentItems.map((d,i)=>({name:d.n.length>16?d.n.slice(0,16)+'…':d.n,fullName:d.n,value:d.rev,itemStyle:{color:selProd&&selProd!==d.n?PALETTE[i%PALETTE.length]+'44':PALETTE[i%PALETTE.length]}}));
  const donutOpt={tooltip:{...TOOLTIP_STYLE,trigger:'item',formatter:p=>`${p.name}: ${fmtFull(p.value)} (${p.percent}%)`},legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:9},type:'scroll',selectedMode:'multiple'},series:[{type:'pie',radius:['48%','70%'],center:['50%','44%'],data:donutData,itemStyle:{borderRadius:3,borderColor:'#fff',borderWidth:2},label:{show:false},emphasis:{scaleSize:6}}]};

  const tbl={headers:['#','Product','Revenue','Orders','Share'],rows:currentItems.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),((d.rev/totalRev)*100).toFixed(1).replace('.',','  )+'%'])};

  const PaginationControls=()=>(
    <div style={{display:'flex',alignItems:'center',gap:'8px',flexShrink:0,marginTop:'4px',padding:'4px 0',flexWrap:'wrap'}}>
      <button onClick={showLess} disabled={currentCount<=itemsPerPage} style={{padding:'3px 10px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:currentCount<=itemsPerPage?'not-allowed':'pointer',fontSize:'11px',fontFamily:'inherit',opacity:currentCount<=itemsPerPage?0.4:1,transition:'all .14s'}}>◀ Show Less</button>
      <span style={{fontSize:'10px',color:'var(--muted)',fontFamily:'JetBrains Mono, monospace',minWidth:'80px',textAlign:'center'}}>{currentCount>=prods.length?`All ${prods.length}`:`1-${currentCount} / ${prods.length}`}</span>
      <button onClick={showMore} disabled={currentCount>=prods.length} style={{padding:'3px 10px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:currentCount>=prods.length?'not-allowed':'pointer',fontSize:'11px',fontFamily:'inherit',opacity:currentCount>=prods.length?0.4:1,transition:'all .14s'}}>Show More ▶</button>
      <button onClick={currentCount>=prods.length?resetToDefault:showAll} style={{padding:'2px 8px',border:`1px solid ${currentCount>=prods.length?'var(--accent)':'var(--border)'}`,borderRadius:'4px',background:currentCount>=prods.length?'rgba(64,188,243,0.1)':'var(--surface3)',color:currentCount>=prods.length?'var(--accent2)':'var(--muted)',cursor:'pointer',fontSize:'9px',fontFamily:'inherit',marginLeft:'4px',transition:'all .14s'}}>{currentCount>=prods.length?`📋 ${itemsPerPage}`:'📋 Full'}</button>
      <button onClick={()=>setAutoZoom(!autoZoom)} style={{padding:'2px 8px',border:`1px solid ${autoZoom?'var(--accent)':'var(--border)'}`,borderRadius:'4px',background:autoZoom?'rgba(64,188,243,0.1)':'var(--surface3)',color:autoZoom?'var(--accent2)':'var(--muted)',cursor:'pointer',fontSize:'9px',fontFamily:'inherit',marginLeft:'4px',transition:'all .14s'}}>🔍 {autoZoom?'Auto':'Fixed'}</button>
    </div>
  );
  const DonutPaginationControls=()=>(
    <div style={{display:'flex',alignItems:'center',gap:'6px',justifyContent:'center',marginTop:'4px',padding:'2px 0',flexWrap:'wrap'}}>
      <button onClick={showLessDonut} disabled={donutCurrentCount<=donutItemsPerPage} style={{padding:'2px 8px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:donutCurrentCount<=donutItemsPerPage?'not-allowed':'pointer',fontSize:'10px',fontFamily:'inherit',opacity:donutCurrentCount<=donutItemsPerPage?0.4:1,transition:'all .14s'}}>◀</button>
      <span style={{fontSize:'9px',color:'var(--muted)',fontFamily:'JetBrains Mono, monospace',minWidth:'60px',textAlign:'center'}}>{donutCurrentCount>=prods.length?`All ${prods.length}`:`1-${donutCurrentCount} / ${prods.length}`}</span>
      <button onClick={showMoreDonut} disabled={donutCurrentCount>=prods.length} style={{padding:'2px 8px',border:'1px solid var(--border)',borderRadius:'4px',background:'var(--surface3)',color:'var(--muted)',cursor:donutCurrentCount>=prods.length?'not-allowed':'pointer',fontSize:'10px',fontFamily:'inherit',opacity:donutCurrentCount>=prods.length?0.4:1,transition:'all .14s'}}>▶</button>
      <button onClick={donutCurrentCount>=prods.length?resetToDefaultDonut:showAllDonut} style={{padding:'2px 6px',border:`1px solid ${donutCurrentCount>=prods.length?'var(--accent)':'var(--border)'}`,borderRadius:'4px',background:donutCurrentCount>=prods.length?'rgba(64,188,243,0.1)':'var(--surface3)',color:donutCurrentCount>=prods.length?'var(--accent2)':'var(--muted)',cursor:'pointer',fontSize:'8px',fontFamily:'inherit',marginLeft:'4px',transition:'all .14s'}}>{donutCurrentCount>=prods.length?`📋 ${donutItemsPerPage}`:'📋 Full'}</button>
    </div>
  );

  const allProductsTableRows=prods.map(d=>[d.n,fmtFull(d.rev),((d.rev/totalRev)*100).toFixed(1).replace('.',','  )+'%']);
  const handleBarClick=(p)=>{const item=currentItems[p.dataIndex];if(item){setSelProd(selProd===item.n?null:item.n);}};
  const handleDonutClick=(p)=>{const fullName=donutCurrentItems.find(x=>x.n.startsWith(p.name.replace('…','')))?.n;setSelProd(selProd===fullName?null:fullName||null);};
  const handleDonutLegend=(params,echartsInstance)=>{if(echartsInstance){echartsInstance.dispatchAction({type:'legendSelect',name:params.name});}const fullName=donutCurrentItems.find(x=>x.n.startsWith(params.name.replace('…','')))?.n;setSelProd(prev=>prev===(fullName||null)?null:(fullName||null));};

  return (
    <div className="page-area" key="products">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">#1 Product</div><div className="kpi-val sm">{prods[0]?.n?.split(' - ')[0]||'—'}</div><div className="kpi-chg">{fmtFull(prods[0]?.rev||0)} · {totalRev>0?((prods[0]?.rev||0)/totalRev*100).toFixed(0):0}% share</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">#2 Product</div><div className="kpi-val sm">{prods[1]?.n?.split(' - ')[0]||'—'}</div><div className="kpi-chg">{fmtFull(prods[1]?.rev||0)} · {totalRev>0?((prods[1]?.rev||0)/totalRev*100).toFixed(0):0}% share</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">#3 Product</div><div className="kpi-val sm">{prods[2]?.n?.split(' - ')[0]||'—'}</div><div className="kpi-chg">{fmtFull(prods[2]?.rev||0)} · {totalRev>0?((prods[2]?.rev||0)/totalRev*100).toFixed(0):0}% share</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Products Tracked</div><div className="kpi-val sm">{prods.length}</div><div className="kpi-chg">Active lines</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Top Products by Revenue" subtitle={`${label} · ${periodLabel.toLowerCase()}-based`} flex={1} tableHeaders={tbl.headers} tableRows={tbl.rows} defaultView={highlightQuery?'table':'chart'} searchableTable tableInitialQuery={highlightQuery} insight={productsInsight}>
            <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
              <div style={{flex:1,minHeight:0}}><EC option={barOpt} onEvents={{'click':handleBarClick}}/></div>
              <PaginationControls/>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Product Share" subtitle="Click to isolate" flex={1} tableHeaders={['Product','Revenue','Share']} tableRows={allProductsTableRows} defaultView="chart">
            <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
              <div style={{flex:1,minHeight:0}}><EC option={donutOpt} onEvents={{'click':handleDonutClick,'legendselectchanged':handleDonutLegend}}/></div>
              <DonutPaginationControls/>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Categories({ fm, label, highlightQuery, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const months=fm.map(m=>m.m);
  const periodLabel = useWeekly ? 'Week' : effGrain === 'yearly' ? 'Year' : 'Month';
  const [drillGroup, setDrillGroup] = useState(null);

  // Aggregate all raw category rows into {name, rev, orders}
  const cats=useMemo(()=>{
    let rows;
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      rows = categoriesWeeklyRaw.filter(c => set.has(c.w));
    } else {
      rows = categoriesRaw.filter(c=>months.includes(c.m));
    }
    const g={};
    rows.forEach(c=>{const k=c.n.trim();if(!g[k])g[k]={n:k,rev:0,orders:0};g[k].rev+=c.rev;g[k].orders+=c.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months, useWeekly, tickedWeeks]);

  // Group-level aggregation
  const groups=useMemo(()=>{
    const g={};
    GROUP_NAMES.forEach((grp,gi)=>{g[grp]={n:grp,rev:0,orders:0,color:GROUP_PALETTE[gi]};});
    cats.forEach(c=>{const grp=CAT_TO_GROUP[c.n]||'Kalverbenodigdheden';if(g[grp]){g[grp].rev+=c.rev;g[grp].orders+=c.orders;}});
    return GROUP_NAMES.map(n=>g[n]).sort((a,b)=>b.rev-a.rev);
  },[cats]);

  // Sub-categories within drilled group
  const subCats=useMemo(()=>{
    if(!drillGroup) return [];
    const members=CATEGORY_GROUPS[drillGroup]||[];
    return cats.filter(c=>members.includes(c.n)).sort((a,b)=>b.rev-a.rev);
  },[drillGroup, cats]);

  const displayItems = drillGroup ? subCats : groups;
  const totalRev = displayItems.reduce((s,c)=>s+c.rev, 0);

  const barOpt=withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${p[0].marker} ${fmtFull(p[0].value)}`},
    grid:{left:'2%',right:'6%',bottom:'18%',top:'5%',containLabel:true},
    xAxis:{type:'value',axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:displayItems.map(d=>d.n),axisLabel:{color:'#5F7078',fontSize:9,width:100,overflow:'truncate'},inverse:true},
    series:[{type:'bar',data:displayItems.map((d,i)=>({value:d.rev,itemStyle:{color:drillGroup?PALETTE[i%PALETTE.length]:d.color}})),barMaxWidth:28,itemStyle:{borderRadius:[0,3,3,0]}}]
  });

  const donutData=displayItems.map((d,i)=>({name:d.n,value:d.rev,itemStyle:{color:drillGroup?PALETTE[i%PALETTE.length]:d.color}}));
  const donutOpt={tooltip:{...TOOLTIP_STYLE,trigger:'item',formatter:p=>`${p.name}: ${fmtFull(p.value)} (${p.percent}%)`},legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:9},type:'scroll',selectedMode:false},series:[{type:'pie',radius:['48%','70%'],center:['50%','44%'],data:donutData,itemStyle:{borderRadius:3,borderColor:'#fff',borderWidth:2},label:{show:false},emphasis:{scaleSize:6}}]};

  const tbl={headers:['#',drillGroup?'Sub-category':'Group','Revenue','Orders','Share'],rows:displayItems.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),totalRev>0?((d.rev/totalRev)*100).toFixed(1).replace('.',','  )+'%':'—'])};
  const catsInsight=groups[0]?`${groups[0].n} leads with ${fmtFull(groups[0].rev)}${groups.reduce((s,g)=>s+g.rev,0)>0?` (${(groups[0].rev/groups.reduce((s,g)=>s+g.rev,0)*100).toFixed(0)}% share)`:''}`  :null;

  const handleBarClick=(p)=>{
    if(!drillGroup){const g=groups[p.dataIndex];if(g)setDrillGroup(g.n);}
  };
  const handleDonutClick=(p)=>{
    if(!drillGroup){const g=groups.find(x=>x.n===p.name);if(g)setDrillGroup(g.n);}
  };

  const breadcrumb = drillGroup ? (
    <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0 2px'}}>
      <button onClick={()=>setDrillGroup(null)} style={{display:'flex',alignItems:'center',gap:4,background:'var(--surface2,#EEF3F6)',border:'1px solid var(--border,#DDE6E9)',borderRadius:6,padding:'3px 10px 3px 7px',fontSize:11,color:'var(--text,#1F3741)',cursor:'pointer',fontWeight:500,lineHeight:1.4}}>
        <span style={{fontSize:13,lineHeight:1}}>←</span> All groups
      </button>
      <span style={{color:'var(--muted,#5F7078)',fontSize:11}}>›</span>
      <span style={{fontSize:11,fontWeight:600,color:'var(--accent,#0891B2)',background:'rgba(8,145,178,.08)',borderRadius:5,padding:'3px 9px'}}>{drillGroup}</span>
    </div>
  ) : null;

  return (
    <div className="page-area" key="cats">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Top {drillGroup?'Sub-cat':'Group'}</div><div className="kpi-val sm">{displayItems[0]?.n||'—'}</div><div className="kpi-chg">{fmtFull(displayItems[0]?.rev||0)} · {totalRev>0?((displayItems[0]?.rev||0)/totalRev*100).toFixed(0):0}%</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">{displayItems[1]?.n||'—'}</div><div className="kpi-val sm">{fmtFull(displayItems[1]?.rev||0)}</div><div className="kpi-chg">{totalRev>0?((displayItems[1]?.rev||0)/totalRev*100).toFixed(1):0}% share</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">{displayItems[2]?.n||'—'}</div><div className="kpi-val sm">{fmtFull(displayItems[2]?.rev||0)}</div><div className="kpi-chg">{totalRev>0?((displayItems[2]?.rev||0)/totalRev*100).toFixed(1):0}% share</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">{drillGroup?'Sub-cats':'Groups'}</div><div className="kpi-val sm">{displayItems.length}</div><div className="kpi-chg">{drillGroup?'In this group':'Category groups'}</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title={drillGroup?`${drillGroup} — Sub-categories`:'Category Groups'} subtitle={drillGroup?'Sub-category breakdown':`${label} · click a bar to drill in`} flex={1} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={!drillGroup?catsInsight:null} headerExtra={breadcrumb}>
            <EC option={barOpt} onEvents={{'click':handleBarClick}}/>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title={drillGroup?'Sub-category Split':'Group Split'} subtitle={drillGroup?'Within group':'Click a slice to drill in'} flex={1} tableHeaders={['Name','Revenue','Share']} tableRows={displayItems.map(d=>[d.n,fmtFull(d.rev),totalRev>0?((d.rev/totalRev)*100).toFixed(1).replace('.',','  )+'%':'—'])} insight={!drillGroup?catsInsight:null} headerExtra={breadcrumb}>
            <EC option={donutOpt} onEvents={{'click':handleDonutClick}}/>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Channels({ fm, label, effGrain, filter }) {
  const tickedWeeks = useMemo(() => Object.values(filter.weeks || {}).flat(), [filter.weeks]);
  const useWeekly = effGrain === 'weekly' && tickedWeeks.length > 0;
  const months=fm.map(m=>m.m);
  const periodLabel = useWeekly ? 'Week' : effGrain === 'yearly' ? 'Year' : 'Month';

  const ch=useMemo(()=>{
    let f;
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      f = salesrepsWeeklyRaw.filter(s => set.has(s.w));
    } else {
      f = salesrepsRaw.filter(s=>months.includes(s.m));
    }
    const ws=f.filter(s=>s.n==='Webshop');
    const dr=f.filter(s=>s.n!=='Webshop');
    return {dRev:dr.reduce((s,r)=>s+r.rev,0),wRev:ws.reduce((s,r)=>s+r.rev,0),dOrd:dr.reduce((s,r)=>s+r.orders,0),wOrd:ws.reduce((s,r)=>s+r.orders,0)};
  },[months, useWeekly, tickedWeeks]);

  const total=ch.dRev+ch.wRev;
  const dAOV=ch.dOrd>0?Math.round(ch.dRev/ch.dOrd):0;
  const wAOV=ch.wOrd>0?Math.round(ch.wRev/ch.wOrd):0;
  const [selChannel,setSelChannel]=useState(null);

  const donutOpt={tooltip:{...TOOLTIP_STYLE,trigger:'item',formatter:p=>`${p.name}: ${fmtFull(p.value)} (${p.percent}%)`},legend:{bottom:0,textStyle:{color:'#5F7078',fontSize:10},selectedMode:'multiple'},series:[{type:'pie',radius:['48%','70%'],center:['50%','44%'],data:[{name:'Direct Sales',value:ch.dRev,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(8,145,178,0.2)':'#0891B2'}},{name:'Webshop',value:ch.wRev,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2'}}],itemStyle:{borderRadius:3,borderColor:'#fff',borderWidth:2},label:{show:false},emphasis:{scaleSize:6}}]};
  const ordOpt=withDataZoom({tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtN(p[0].value)}`},grid:{left:'3%',right:'4%',bottom:isMobileViewport()?'22%':'12%',top:'8%',containLabel:true},xAxis:{type:'category',data:['Direct Sales','Webshop'],axisLabel:catAxisLabel(2,10,true)},yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmtN(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},legend:{show:false},series:[{type:'bar',data:[{value:ch.dOrd,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(8,145,178,0.2)':'#0891B2',borderRadius:[4,4,0,0]}},{value:ch.wOrd,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2',borderRadius:[4,4,0,0]}}],barMaxWidth:60}]});
  const aovOpt=withDataZoom({tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`${p[0].name}: ${fmtFull(p[0].value)}`},grid:{left:'3%',right:'4%',bottom:isMobileViewport()?'22%':'12%',top:'8%',containLabel:true},xAxis:{type:'category',data:['Direct Sales','Webshop'],axisLabel:catAxisLabel(2,10,true)},yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},legend:{show:false},series:[{type:'bar',data:[{value:dAOV,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(3,105,161,0.2)':'#0891B2',borderRadius:[4,4,0,0]}},{value:wAOV,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2',borderRadius:[4,4,0,0]}}],barMaxWidth:60}]});

  const leadChannel=ch.dRev>=ch.wRev?'Direct Sales':'Webshop';
  const leadShare=total>0?(Math.max(ch.dRev,ch.wRev)/total*100).toFixed(0):0;
  const aovLeader=dAOV>=wAOV?'Direct Sales':'Webshop';
  const aovGapPct=Math.min(dAOV,wAOV)>0?(Math.abs(dAOV-wAOV)/Math.min(dAOV,wAOV)*100).toFixed(0):null;
  const channelsInsight=total>0?`${leadChannel} leads with ${leadShare}% of revenue${aovGapPct?` · ${aovLeader} orders run ${aovGapPct}% larger on average`:''}`:null;
  const handleChannelClick=(p)=>{const channelName=p.name||(p.dataIndex===0?'Direct Sales':'Webshop');setSelChannel(selChannel===channelName?null:channelName);};
  const handleDonutLegend=(params,echartsInstance)=>{if(echartsInstance){echartsInstance.dispatchAction({type:'legendSelect',name:params.name});}setSelChannel(prev=>prev===params.name?null:params.name);};
  const handleDonutClick=(p)=>{setSelChannel(selChannel===p.name?null:p.name);};

  return (
    <div className="page-area" key="channels">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Direct Sales</div><div className="kpi-val sm">{fmtFull(ch.dRev)}</div><div className="kpi-chg">{total>0?((ch.dRev/total)*100).toFixed(1):0}% · {fmtN(ch.dOrd)} orders</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Webshop</div><div className="kpi-val sm">{fmtFull(ch.wRev)}</div><div className="kpi-chg">{total>0?((ch.wRev/total)*100).toFixed(1):0}% · {fmtN(ch.wOrd)} orders</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Direct Avg Order</div><div className="kpi-val sm">{fmtFull(dAOV)}</div><div className="kpi-chg">Per transaction</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Webshop Avg Order</div><div className="kpi-val sm">{fmtFull(wAOV)}</div><div className="kpi-chg">Per transaction</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1.2}}>
          <Panel title="Channel Revenue Share" subtitle={`${label} · ${periodLabel.toLowerCase()}-based`} flex={1} tableHeaders={['Channel','Revenue','Share','Orders','AOV']} tableRows={[['Direct Sales',fmtFull(ch.dRev),total>0?((ch.dRev/total)*100).toFixed(1).replace('.',','  )+'%':'—',fmtN(ch.dOrd),fmtFull(dAOV)],['Webshop',fmtFull(ch.wRev),total>0?((ch.wRev/total)*100).toFixed(1).replace('.',','  )+'%':'—',fmtN(ch.wOrd),fmtFull(wAOV)]]} insight={channelsInsight}><EC option={donutOpt} onEvents={{'click':handleDonutClick,'legendselectchanged':handleDonutLegend}}/></Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Order Volume" subtitle="By channel" flex={1}><EC option={ordOpt} onEvents={{'click':handleChannelClick}}/></Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Avg Order Value" subtitle="Direct vs Webshop" flex={1}><EC option={aovOpt} onEvents={{'click':handleChannelClick}}/></Panel>
        </div>
      </div>
    </div>
  );
}

/* ── FINANCE HELPERS ───────────────────────────────────────────── */
const FIN_CAT_ORDER=['Revenue','COGS','Personnel','Rent & Property','Premises','Vehicle & Transport','Marketing','Office & IT','General Admin','Finance','Other OpEx','Other'];
function buildWaterfallSeries(steps){let running=0;const base=[],val=[],colors=[];steps.forEach(s=>{if(s.total){base.push(Math.min(0,running));val.push(Math.abs(running));colors.push('#1F3741');}else{base.push(Math.min(running,running+s.delta));val.push(Math.abs(s.delta));colors.push(s.delta>=0?'#2E9B62':'#D95C5C');running+=s.delta;}});return{base,val,colors};}
function YoyBadge({cy,py,goodIfUp=true}){if(py===undefined||py===null)return null;const diff=cy-py;const pct=py!==0?Math.abs(diff/py)*100:null;const good=goodIfUp?diff>=0:diff<=0;return<span className={`fin-badge ${good?'good':'bad'}`}>{diff>=0?'▲':'▼'} {pct!==null?pct.toFixed(1).replace('.',','  )+'%':'—'}</span>;}
const fmtAxis=v=>{const av=Math.abs(v),sign=v<0?'-':'';if(av>=1e6)return sign+'€'+(av/1e6).toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:1})+'M';if(av>=1e3)return sign+'€'+(av/1e3).toLocaleString('de-DE',{maximumFractionDigits:0})+'K';return sign+'€'+Math.round(av).toLocaleString('de-DE');};

const mkBarOpt=(labels,vals,colorFn,lw)=>{
  const L=lw||(isMobileViewport()?105:150);
  return{
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},
    grid:{left:L,right:18,bottom:22,top:6,containLabel:false},
    xAxis:{type:'value',splitNumber:4,minInterval:1,axisLabel:{color:'#5F7078',fontSize:8,formatter:v=>fmtAxis(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}},axisTick:{show:false}},
    yAxis:{type:'category',data:labels,axisLabel:{color:'#5F7078',fontSize:8,width:L-10,overflow:'truncate',ellipsis:'…'},inverse:true,axisTick:{show:false}},
    series:[{type:'bar',barMaxWidth:12,data:vals.map((v,i)=>({value:v,itemStyle:{color:colorFn(i),borderRadius:[0,3,3,0]}}))}]
  };
};

function PLSummary() {
  const revCY=finSummary.revenue.cy,revPY=finSummary.revenue.py;
  const cogsCY=finSummary.cogs.cy,cogsPY=finSummary.cogs.py;
  const opexCY=finSummary.opex.cy,opexPY=finSummary.opex.py;
  const gpCY=revCY-cogsCY,gpPY=revPY-cogsPY;
  const ebitdaCY=gpCY-opexCY,ebitdaPY=gpPY-opexPY;
  const gmCY=revCY?(gpCY/revCY)*100:0;
  const gmPY=revPY?(gpPY/revPY)*100:0;
  const emCY=revCY?(ebitdaCY/revCY)*100:0;
  const emPY=revPY?(ebitdaPY/revPY)*100:0;
  const opexPctCY=revCY?(opexCY/revCY)*100:0;
  const hasTaxData=finSummary.tax?.cy!==undefined&&finSummary.tax?.cy!==null;
  const taxCY=hasTaxData?finSummary.tax.cy:null;
  const taxPY=hasTaxData?finSummary.tax.py:null;
  const netCY=hasTaxData?ebitdaCY-taxCY:null;
  const netPY=hasTaxData?ebitdaPY-taxPY:null;
  const nmCY=hasTaxData&&revCY?(netCY/revCY)*100:null;
  const nmPY=hasTaxData&&revPY?(netPY/revPY)*100:null;

  const wfCats=['Revenue','COGS','Gross Profit','OpEx','EBITDA'];
  const wfDisplay=[revCY,-cogsCY,gpCY,-opexCY,ebitdaCY];
  const{base:wfBase,val:wfVal,colors:wfColors}=buildWaterfallSeries([{delta:revCY},{delta:-cogsCY},{total:true},{delta:-opexCY},{total:true}]);
  const wfOpt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${wfCats[p[0].dataIndex]}</strong><br/>${fmtFull(wfDisplay[p[0].dataIndex])}`},
    grid:{left:14,right:14,bottom:isMobileViewport()?54:26,top:30,containLabel:true},
    xAxis:{type:'category',data:wfCats,axisLabel:catAxisLabel(wfCats.length,9),axisTick:{show:false}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:8,formatter:v=>fmtAxis(v)},splitLine:{lineStyle:{color:'#F0F3F4'}},axisTick:{show:false}},
    series:[
      {type:'bar',stack:'wf',data:wfBase,itemStyle:{color:'transparent'},silent:true,tooltip:{show:false}},
      {type:'bar',stack:'wf',barWidth:'55%',data:wfVal.map((v,i)=>({value:v,itemStyle:{color:wfColors[i],borderRadius:3}})),label:{show:true,position:'top',distance:4,color:'#1F3741',fontSize:8,fontWeight:700,backgroundColor:'#fff',borderColor:'#DDE6E9',borderWidth:1,borderRadius:3,padding:[3,5],formatter:p=>fmtAxis(wfDisplay[p.dataIndex])}}
    ]
  };
  const wfTable={headers:['Step','2026 (Jan–Mar)','2025 (Jan–Jun)'],rows:[['Revenue',fmtFull(revCY),fmtFull(revPY)],['COGS',fmtFull(-cogsCY),fmtFull(-cogsPY)],['Gross Profit',fmtFull(gpCY),fmtFull(gpPY)],['OpEx',fmtFull(-opexCY),fmtFull(-opexPY)],['EBITDA',fmtFull(ebitdaCY),fmtFull(ebitdaPY)]]};

  const tornCats=finCategories.map(c=>c.cat);
  const tornVals=finCategories.map(c=>c.cy-c.py);
  const tornColors=finCategories.map(c=>{const bad=c.cat==='Revenue'?(c.cy-c.py)<0:(c.cy-c.py)>0;return bad?'#D95C5C':'#2E9B62';});
  const tornOpt={tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},grid:{left:isMobileViewport()?95:120,right:16,bottom:18,top:6,containLabel:false},xAxis:{type:'value',minInterval:1,splitNumber:isMobileViewport()?4:5,axisLabel:{color:'#5F7078',fontSize:isMobileViewport()?7:8,formatter:v=>fmtAxis(v),hideOverlap:true},splitLine:{lineStyle:{color:'#F0F3F4'}},axisTick:{show:false}},yAxis:{type:'category',data:tornCats,axisLabel:{color:'#5F7078',fontSize:8,width:isMobileViewport()?88:112,overflow:'truncate'},inverse:true,axisTick:{show:false}},series:[{type:'bar',barMaxWidth:12,data:tornVals.map((v,i)=>({value:v,itemStyle:{color:tornColors[i],borderRadius:v>=0?[0,3,3,0]:[3,0,0,3]}}))}]};
  const tornTable={headers:['Category','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','YoY %'],rows:finCategories.map(c=>[c.cat,fmtFull(c.cy),fmtFull(c.py),fmtFull(c.cy-c.py),c.py?fmtPct((c.cy-c.py)/Math.abs(c.py)*100):'—'])};

  const GaugeSVG=({value,label,py})=>{
    const clamp=v=>Math.max(-30,Math.min(30,v));
    const angle=(clamp(value)+30)/60*180-90;
    const r=38,cx=50,cy2=44;
    const toXY=(deg)=>{const rad=(deg-90)*Math.PI/180;return{x:cx+r*Math.cos(rad),y:cy2+r*Math.sin(rad)};};
    const arcPath=(from,to,color,rr)=>{const a=toXY(from*3),b=toXY(to*3);const large=(to-from)*3>180?1:0;return`<path d="M ${a.x} ${a.y} A ${rr} ${rr} 0 ${large} 1 ${b.x} ${b.y}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="butt"/>`;};
    const color=value>=10?'#2E9B62':value>=0?'#E5A93D':'#D95C5C';
    const px2=toXY(angle);
    return(
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1}}>
        <svg viewBox="0 0 100 58" style={{width:'100%',maxWidth:110,overflow:'visible'}}>
          <g dangerouslySetInnerHTML={{__html:arcPath(-30,0,'#D95C5C',r)+arcPath(0,10,'#E5A93D',r)+arcPath(10,30,'#2E9B62',r)+`<line x1="${cx}" y1="${cy2}" x2="${px2.x}" y2="${px2.y}" stroke="#1F3741" stroke-width="2.5" stroke-linecap="round"/>`+`<circle cx="${cx}" cy="${cy2}" r="3.5" fill="#1F3741"/>`}}/>
        </svg>
        <div style={{fontSize:15,fontWeight:800,fontFamily:'JetBrains Mono,monospace',color,marginTop:-2}}>{value.toFixed(1).replace('.',','  )}%</div>
        <div style={{fontSize:9,color:'var(--muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',marginTop:1}}>{label}</div>
        <div style={{fontSize:9,color:'var(--muted)',marginTop:1}}>2025: {py.toFixed(1).replace('.',','  )}%</div>
      </div>
    );
  };
  const gaugeTable={headers:['Metric','2026 (Jan–Mar)','2025 (Jan–Jun)'],rows:[['Gross Margin %',gmCY.toFixed(1).replace('.',','  )+'%',gmPY.toFixed(1).replace('.',','  )+'%'],['EBITDA Margin %',emCY.toFixed(1).replace('.',','  )+'%',emPY.toFixed(1).replace('.',','  )+'%']]};
  const bridgeSteps=[{name:'Revenue',delta:revCY-revPY},{name:'COGS',delta:-(cogsCY-cogsPY)},{name:'OpEx',delta:-(opexCY-opexPY)}];
  const biggestBridgeMove=bridgeSteps.reduce((a,b)=>Math.abs(b.delta)>Math.abs(a.delta)?b:a);
  const bridgeInsight=`EBITDA margin ${emCY>=emPY?'improved':'declined'} to ${emCY.toFixed(1).replace('.',','  )}% (vs ${emPY.toFixed(1).replace('.',','  )}% PY) · Largest driver: ${biggestBridgeMove.name} (${biggestBridgeMove.delta>=0?'+':''}${fmtFull(biggestBridgeMove.delta)})`;
  const tornSorted=[...finCategories].map(c=>({cat:c.cat,delta:c.cy-c.py,bad:c.cat==='Revenue'?(c.cy-c.py)<0:(c.cy-c.py)>0}));
  const worstMover=tornSorted.filter(c=>c.bad).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
  const bestMover=tornSorted.filter(c=>!c.bad).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
  const tornadoInsight=[bestMover?`Best mover: ${bestMover.cat} (${bestMover.delta>=0?'+':''}${fmtFull(bestMover.delta)})`:null,worstMover?`Watch: ${worstMover.cat} (${worstMover.delta>=0?'+':''}${fmtFull(worstMover.delta)})`:null].filter(Boolean).join(' · ')||null;

  return (
    <div className="page-area fin-scroll" key="plsummary">
      <div className="fin-note">⚠ Partial periods: 2026 = Jan–Mar · 2025 = Jan–Jun</div>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Revenue</div><div className="kpi-val sm">{fmtFull(revCY)}</div><div className="kpi-chg"><YoyBadge cy={revCY} py={revPY} goodIfUp/></div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Gross Margin<span className="indicative-tag">Indicative</span></div><div className="kpi-val sm">{fmtFull(gpCY)}</div><div className="kpi-chg">{gmCY.toFixed(1).replace('.',','  )}% margin · vs {gmPY.toFixed(1).replace('.',','  )}% PY</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">OpEx</div><div className="kpi-val sm">{opexPctCY.toFixed(1).replace('.',','  )}%</div><div className="kpi-chg">{fmtFull(opexCY)} · of turnover</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">EBITDA<span className="indicative-tag">Indicative</span></div><div className="kpi-val sm">{fmtFull(ebitdaCY)}</div><div className="kpi-chg">{emCY.toFixed(1).replace('.',','  )}% margin · vs {emPY.toFixed(1).replace('.',','  )}% PY</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">Net Margin (after Tax)<span className="indicative-tag">Indicative</span></div>{hasTaxData?(<><div className="kpi-val sm">{fmtFull(netCY)}</div><div className="kpi-chg">{nmCY.toFixed(1).replace('.',','  )}% margin · vs {nmPY.toFixed(1).replace('.',','  )}% PY</div></>):(<><div className="kpi-val sm">—</div><div className="kpi-chg">Pending — awaiting tax data</div></>)}</div>
      </div>
      <div className="charts-row">
        <Panel title="P&L Bridge" subtitle="2026 Jan–Mar" height={420} className="fin-fixed" style={{flex:1}} tableHeaders={wfTable.headers} tableRows={wfTable.rows} insight={bridgeInsight}><EC option={wfOpt}/></Panel>
        <Panel title="Margin Health" subtitle="Gross & EBITDA margins" tag="Indicative" height={420} className="fin-fixed" style={{flex:0.8}} tableHeaders={gaugeTable.headers} tableRows={gaugeTable.rows}>
          <div style={{display:'flex',flexDirection:'column',gap:10,height:'100%',alignItems:'center',justifyContent:'center',padding:'8px 12px'}}>
            <GaugeSVG value={gmCY} label="Gross Margin" py={gmPY}/>
            <div style={{height:1,background:'var(--border)',alignSelf:'stretch',flexShrink:0}}/>
            <GaugeSVG value={emCY} label="EBITDA Margin" py={emPY}/>
          </div>
        </Panel>
        <Panel title="Category YoY Change" subtitle="Green = favorable" height={420} className="fin-fixed" style={{flex:1}} defaultView="table" tableHeaders={tornTable.headers} tableRows={tornTable.rows} insight={tornadoInsight}><EC option={tornOpt}/></Panel>
      </div>
    </div>
  );
}

function FinRevCosts() {
  const revenueLines=useMemo(()=>finLines.filter(l=>l.cat==='Revenue').sort((a,b)=>b.cy-a.cy),[]);
  const costLines=useMemo(()=>finLines.filter(l=>l.cat!=='Revenue').sort((a,b)=>b.cy-a.cy),[]);
  const anomalies=useMemo(()=>finLines.filter(l=>l.cat!=='Revenue'&&l.cy>l.py&&Math.abs(l.cy)>500).sort((a,b)=>b.yoy-a.yoy),[]);
  const topRev=revenueLines.slice(0,10);
  const topCost=costLines.slice(0,10);
  const topAnom=anomalies.slice(0,10);
  const revOpt=mkBarOpt(topRev.map(l=>l.desc),topRev.map(l=>l.cy),()=>'#40BCF3');
  const costOpt=mkBarOpt(topCost.map(l=>l.desc),topCost.map(l=>l.cy),()=>'#35A9DE');
  const anomOpt=mkBarOpt(topAnom.map(l=>l.desc),topAnom.map(l=>l.yoy),()=>'#1F3741');
  const revCY=finSummary.revenue.cy,revPY=finSummary.revenue.py;
  const cogsCY=finSummary.cogs.cy,cogsPY=finSummary.cogs.py;
  const revTbl={headers:['Acct','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','YoY %'],rows:revenueLines.slice(0,15).map(l=>[l.acct,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),l.yoyPct!==null?fmtPct(l.yoyPct):'—'])};
  const costTbl={headers:['Acct','Cat','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','% of Turnover','Relative Difference'],rows:costLines.slice(0,20).map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),revCY?fmtPct(l.cy/revCY*100):'—',l.yoyPct!==null?fmtPct(l.yoyPct):'—'])};
  const anomTbl={headers:['Acct','Cat','Description','2026 (Jan–Mar)','YoY €','% of Turnover','Relative Difference'],rows:anomalies.map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.yoy),revCY?fmtPct(l.cy/revCY*100):'—',l.yoyPct!==null?fmtPct(l.yoyPct):'—'])};
  const costCats=finCategories.filter(c=>c.cat!=='Revenue');
  const costPctPeriods=['2025 (Jan–Jun)','2026 (Jan–Mar)'];
  const costPctSeries=costCats.map((c,i)=>({name:c.cat,type:'line',symbol:'circle',symbolSize:6,lineStyle:{width:2,color:PALETTE[i%PALETTE.length]},itemStyle:{color:PALETTE[i%PALETTE.length]},data:[revPY?+(c.py/revPY*100).toFixed(2):0,revCY?+(c.cy/revCY*100).toFixed(2):0]}));
  const costPctOpt={tooltip:{...TOOLTIP_STYLE,trigger:'axis',formatter:p=>`<strong>${p[0].axisValue}</strong><br/>`+p.map(i=>`${i.marker} ${i.seriesName}: ${i.value.toFixed(1).replace('.',','  )}%`).join('<br/>')},legend:{top:0,textStyle:{color:'#5F7078',fontSize:9},itemWidth:10,itemHeight:10},grid:{left:44,right:20,bottom:isMobileViewport()?46:24,top:34,containLabel:true},xAxis:{type:'category',data:costPctPeriods,axisLabel:catAxisLabel(2,9,true),axisTick:{show:false}},yAxis:{type:'value',axisLabel:{color:'#5F7078',fontSize:8,formatter:v=>v+'%'},splitLine:{lineStyle:{color:'#F0F3F4'}},axisTick:{show:false}},series:costPctSeries};
  const costPctTbl={headers:['Category','2025 (Jan–Jun) %','2026 (Jan–Mar) %','Change (pts)'],rows:costCats.map(c=>{const pctPY=revPY?(c.py/revPY*100):0;const pctCY=revCY?(c.cy/revCY*100):0;return[c.cat,fmtPct(pctPY),fmtPct(pctCY),fmtPct(pctCY-pctPY)];})};

  return (
    <div className="page-area fin-scroll" key="finrevcosts">
      <div className="fin-note">⚠ Partial periods: 2026 = Jan–Mar · 2025 = Jan–Jun</div>
      <div className="kpi-strip">
        <div className="kpi-card teal"><div className="kpi-lbl">Revenue Lines</div><div className="kpi-val sm">{revenueLines.length}</div><div className="kpi-chg">Active accounts</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">Cost Lines</div><div className="kpi-val sm">{costLines.length}</div><div className="kpi-chg">{new Set(costLines.map(l=>l.cat)).size} categories</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Cost Increases</div><div className="kpi-val sm">{anomalies.length}</div><div className="kpi-chg">YoY watch list</div></div>
        <div className="kpi-card blue"><div className="kpi-lbl">Top Revenue</div><div className="kpi-val sm">{revenueLines[0]?.desc?.split(' ')[0]||'—'}</div><div className="kpi-chg">{fmtFull(revenueLines[0]?.cy||0)}</div></div>
        <div className="kpi-card red"><div className="kpi-lbl">Top Cost</div><div className="kpi-val sm">{costLines[0]?.desc?.split(' ')[0]||'—'}</div><div className="kpi-chg">{fmtFull(costLines[0]?.cy||0)}</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">COGS/Rev</div><div className="kpi-val sm">{revCY?((cogsCY/revCY)*100).toFixed(0):0}%</div><div className="kpi-chg">vs {revPY?((cogsPY/revPY)*100).toFixed(0):0}% PY</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}><Panel title="Top Revenue Lines" subtitle="2026 Jan–Mar, largest first" height={420} className="fin-fixed" tableHeaders={revTbl.headers} tableRows={revTbl.rows}><EC option={revOpt}/></Panel></div>
        <div className="charts-col" style={{flex:1}}><Panel title="Top Cost Lines" subtitle="2026 Jan–Mar, largest first" height={420} className="fin-fixed" tableHeaders={costTbl.headers} tableRows={costTbl.rows}><EC option={costOpt}/></Panel></div>
        <div className="charts-col" style={{flex:1}}><Panel title="Cost Increases" subtitle="YoY watch list" height={420} className="fin-fixed" tableHeaders={anomTbl.headers} tableRows={anomTbl.rows}><EC option={anomOpt}/></Panel></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}><Panel title="Cost Categories as % of Turnover" subtitle="2025 (Jan–Jun) vs 2026 (Jan–Mar)" height={340} className="fin-fixed" tableHeaders={costPctTbl.headers} tableRows={costPctTbl.rows}><EC option={costPctOpt}/></Panel></div>
      </div>
    </div>
  );
}

function FinLedger() {
  const [q,setQ]=useState('');
  const [cat,setCat]=useState('All');
  const newCosts=useMemo(()=>finLines.filter(l=>l.cat!=='Revenue'&&l.cy>0&&l.py===0&&Math.abs(l.cy)>500).sort((a,b)=>b.cy-a.cy),[]);
  const goneRevenue=useMemo(()=>finLines.filter(l=>l.cat==='Revenue'&&l.cy===0&&l.py>0).sort((a,b)=>b.py-a.py),[]);
  const cats=['All',...FIN_CAT_ORDER.filter(c=>finLines.some(l=>l.cat===c))];
  const filtered=finLines.filter(l=>(cat==='All'||l.cat===cat)&&(q.trim()===''||l.desc.toLowerCase().includes(q.toLowerCase())||String(l.acct).includes(q))).sort((a,b)=>Math.abs(b.cy)-Math.abs(a.cy));
  const revCY=finSummary.revenue.cy;
  const rows=filtered.map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),revCY?fmtPct(l.cy/revCY*100):'—',l.yoyPct!==null?fmtPct(l.yoyPct):'—']);
  const sideColRef=useRef(null);
  const [sideH,setSideH]=useState(null);
  useLayoutEffect(()=>{const el=sideColRef.current;if(!el)return;const measure=()=>setSideH(el.getBoundingClientRect().height);measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[newCosts.length,goneRevenue.length]);

  return (
    <div className="page-area fin-scroll" key="finledger">
      <div className="fin-note">⚠ Partial periods: 2026 = Jan–Mar · 2025 = Jan–Jun</div>
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Accounts</div><div className="kpi-val sm">{fmtN(finLines.length)}</div><div className="kpi-chg">All lines</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Showing</div><div className="kpi-val sm">{fmtN(filtered.length)}</div><div className="kpi-chg">After filter</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">New Costs</div><div className="kpi-val sm">{fmtN(newCosts.length)}</div><div className="kpi-chg">Not in 2025</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Revenue Lost</div><div className="kpi-val sm">{fmtN(goneRevenue.length)}</div><div className="kpi-chg">Dropped to zero</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1.8}}>
          <Panel title="Full Account Ledger" subtitle={`${fmtN(finLines.length)} lines · search & filter`} className="ledger-fixed" height={sideH||300}>
            <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
              <div className="ledger-toolbar">
                <input className="ledger-search" placeholder="Search account # or description…" value={q} onChange={e=>setQ(e.target.value)}/>
                <span className="ledger-count">{fmtN(filtered.length)} / {fmtN(finLines.length)}</span>
              </div>
              <div className="ledger-cats">{cats.map(c=>(<button key={c} className={`filter-chip${cat===c?' active':''}`} style={{fontSize:9,padding:'2px 7px'}} onClick={()=>setCat(prev => prev===c ? 'All' : c)} title={cat===c && c!=='All' ? `Clear filter (${c})` : `Filter: ${c}`}>{c}</button>))}</div>
              <div style={{flex:1,minHeight:0}}><InlineTable headers={['Acct','Category','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','% of Turnover','Relative Difference']} rows={rows} height="100%"/></div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}} ref={sideColRef}>
          <Panel title="🆕 New Costs in 2026" subtitle="Not present in 2025" className="hug">
            <div style={{display:'flex',flexDirection:'column',gap:4}}>{newCosts.length===0?<div className="watch-empty">None detected</div>:newCosts.map(l=>(<div className="watch-row" key={l.acct}><div className="watch-row-desc" title={l.desc}>{l.desc}</div><div className="watch-row-amt">{fmtFull(l.cy)} · {l.cat}</div></div>))}</div>
          </Panel>
          <Panel title="🔻 Revenue Lost" subtitle="Had 2025 revenue, now zero" className="hug">
            <div style={{display:'flex',flexDirection:'column',gap:4}}>{goneRevenue.length===0?<div className="watch-empty">None detected</div>:goneRevenue.map(l=>(<div className="watch-row" key={l.acct}><div className="watch-row-desc" title={l.desc}>{l.desc}</div><div className="watch-row-amt">was {fmtFull(l.py)}</div></div>))}</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── DEBTORS ────────────────────────────────────────────────── */
const DEBTOR_BUCKET_COLORS={'0–30 days':'#22c55e','31–60 days':'#f59e0b','61–90 days':'#f97316','91–180 days':'#ef4444','>180 days':'#b91c1c','Settled':'#94a3b8'};
const DEBTOR_RISK_COLORS={A:'#22c55e',B:'#f59e0b',C:'#f97316',D:'#ef4444'};
const DEBTOR_RISK_BG={A:'rgba(34,197,94,0.1)',B:'rgba(245,158,11,0.1)',C:'rgba(249,115,22,0.1)',D:'rgba(239,68,68,0.12)'};

function Debtors(){
  const[trendMode,setTrendMode]=useState('cohort');
  const trendData=trendMode==='cohort'?debtorTrendlineCohort:debtorTrendlineSnapshot;
  const kpi=debtorKPI||{};
  const ageingData=debtorAgeing||[];
  const ageingOpt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:105,right:115,top:16,bottom:16},
    xAxis:{type:'value',axisLabel:{fontSize:10,formatter:v=>fmtFull(v)},splitNumber:4},
    yAxis:{type:'category',data:ageingData.map(b=>b.bucket),axisLabel:{fontSize:11}},
    series:[{type:'bar',data:ageingData.map(b=>({value:b.value,itemStyle:{color:DEBTOR_BUCKET_COLORS[b.bucket]||'#40BCF3',borderRadius:[0,4,4,0]}})),label:{show:true,position:'right',formatter:p=>fmtFull(p.value),fontSize:11,color:'#475569'},barMaxWidth:36}],
  };
  const trendOpt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis'},
    grid:{left:52,right:16,top:44,bottom:60},
    legend:{data:['% ≤30d','% ≤60d','% ≤90d'],top:8,left:'center',textStyle:{fontSize:11}},
    xAxis:{type:'category',data:trendData.map(d=>d.month),axisLabel:{fontSize:10,rotate:35,interval:Math.max(0,Math.floor(trendData.length/10)-1)}},
    yAxis:{type:'value',min:0,max:100,axisLabel:{formatter:v=>v+'%',fontSize:10}},
    series:[
      {name:'% ≤30d',type:'line',data:trendData.map(d=>d.pct30!=null?+Math.min(100,Math.max(0,d.pct30)).toFixed(1):null),smooth:false,symbol:'circle',symbolSize:4,lineStyle:{width:2},itemStyle:{color:'#22c55e'},areaStyle:{color:'rgba(34,197,94,0.08)'},connectNulls:false},
      {name:'% ≤60d',type:'line',data:trendData.map(d=>d.pct60!=null?+Math.min(100,Math.max(0,d.pct60)).toFixed(1):null),smooth:false,symbol:'circle',symbolSize:4,lineStyle:{width:2},itemStyle:{color:'#f59e0b'},connectNulls:false},
      {name:'% ≤90d',type:'line',data:trendData.map(d=>d.pct90!=null?+Math.min(100,Math.max(0,d.pct90)).toFixed(1):null),smooth:false,symbol:'circle',symbolSize:4,lineStyle:{width:2},itemStyle:{color:'#f97316'},connectNulls:false},
    ],
  };
  return(
    <div className="page-area" key="debtors">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Open AR</div><div className="kpi-val sm">{fmtFull(kpi.totalDebtorValue)}</div><div className="kpi-chg">{kpi.openInvoiceCount} invoices · {kpi.customerCount} customers</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Over 30 Days</div><div className="kpi-val sm">{fmtFull(kpi.over30)}</div><div className="kpi-chg">{kpi.pctOver30!=null?kpi.pctOver30.toFixed(1):'—'}% of total AR</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">Over 90 Days</div><div className="kpi-val sm">{fmtFull(kpi.over90)}</div><div className="kpi-chg">{kpi.pctOver90!=null?kpi.pctOver90.toFixed(1):'—'}% of total AR</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Snapshot Date</div><div className="kpi-val sm" style={{fontSize:17}}>{kpi.asOf||debtorAsOf}</div><div className="kpi-chg">Latest AR posting date</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="AR Ageing Buckets" subtitle="Open receivables by age" height={420}><EC option={ageingOpt}/></Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Payment Trendline" subtitle={trendMode==='cohort'?'% invoices paid, by cohort month':'% invoices paid, last 18 month-end snapshots'} height={420}
            controls={<div className="view-tog"><button className={`vt-btn${trendMode==='cohort'?' active':''}`} onClick={()=>setTrendMode('cohort')}>Cohort</button><button className={`vt-btn${trendMode==='snapshot'?' active':''}`} onClick={()=>setTrendMode('snapshot')}>Snapshot</button></div>}>
            <EC option={trendOpt}/>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── DEBTOR CUSTOMERS ────────────────────────────────────────── */
function DebtorCustomers(){
  const[drillCustomer,setDrillCustomer]=useState(null);
  const[search,setSearch]=useState('');
  const customers=debtorCustomers||[];
  const q=search.trim().toLowerCase();
  const filtered=q?customers.filter(c=>c.name.toLowerCase().includes(q)||String(c.code).includes(q)||(c.risk||'').toLowerCase()===q):customers;

  if(drillCustomer){
    const items=(debtorOpenItems||[]).filter(i=>i.code===drillCustomer.code);
    return(
      <div className="page-area" key="items">
        <div className="drill-chip">Open items — <b>{drillCustomer.name}</b><button onClick={()=>setDrillCustomer(null)}>✕</button></div>
        <div className="charts-row" style={{flex:1}}>
          <div className="charts-col" style={{flex:1}}>
            <Panel title={`Open Invoices — ${drillCustomer.name}`} subtitle={`${items.length} open invoice(s) · As of ${debtorAsOf}`}
              flex={1} tableHeaders={['Invoice #','Invoice Date','Open Amount','Days Out','Bucket']}
              tableRows={items.map(i=>[i.invoiceNr,i.invoiceDate,fmtFull(i.openAmount),i.daysOutstanding,i.bucket])}
              defaultView="table" searchableTable><EC option={{}}/></Panel>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="page-area" key="debtorcustomers">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Customers with Open AR</div><div className="kpi-val sm">{customers.length}</div><div className="kpi-chg">As of {debtorAsOf}</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Non-Payer Flags</div><div className="kpi-val sm">{customers.filter(c=>c.nonPayer).length}</div><div className="kpi-chg">Flagged in system</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">Risk D</div><div className="kpi-val sm">{customers.filter(c=>c.risk==='D').length}</div><div className="kpi-chg">&gt;90d oldest open invoice</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Risk A</div><div className="kpi-val sm">{customers.filter(c=>c.risk==='A').length}</div><div className="kpi-chg">≤30d oldest open invoice</div></div>
      </div>
      <div style={{fontSize:11,color:'#64748b',padding:'0 0 8px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span>Risk: <b style={{color:DEBTOR_RISK_COLORS.A}}>A</b> ≤30d · <b style={{color:DEBTOR_RISK_COLORS.B}}>B</b> 31–60d · <b style={{color:DEBTOR_RISK_COLORS.C}}>C</b> 61–90d · <b style={{color:DEBTOR_RISK_COLORS.D}}>D</b> &gt;90d · Click a row → open invoices</span>
      </div>
      <div className="chart-panel" style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
        <div className="cp-head">
          <div style={{flex:1,minWidth:0}}><div className="cp-title">Customer AR Scorecard</div><div className="cp-sub">{filtered.length} of {customers.length} customers</div></div>
          <input type="text" placeholder="Search name, code or risk…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{fontSize:11,padding:'4px 10px',border:'1px solid #dde3ea',borderRadius:6,outline:'none',width:200,background:'transparent',color:'inherit'}}/>
        </div>
        <div className="cp-body" style={{flex:1,minHeight:0,overflow:'auto'}}>
          <table className="itbl">
            <thead><tr><th>Code</th><th>Name</th><th>Open Value</th><th>Open Inv.</th><th>Avg Days</th><th>Oldest (d)</th><th>Last Payment</th><th>Risk</th><th>Non-Payer</th></tr></thead>
            <tbody>{filtered.map((c,i)=>(
              <tr key={i} style={{cursor:'pointer'}}
                onClick={()=>setDrillCustomer(c)}
                onMouseEnter={e=>{e.currentTarget.style.background=DEBTOR_RISK_BG[c.risk]||'rgba(64,188,243,0.07)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='';}}>
                <td>{c.code}</td>
                <td style={{fontWeight:500,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</td>
                <td>{fmtFull(c.openValue)}</td>
                <td>{c.openInvoices}</td>
                <td>{c.avgDaysToPay!=null?Math.round(c.avgDaysToPay)+'d':'—'}</td>
                <td>{c.ageOfOldest!=null?c.ageOfOldest+'d':'—'}</td>
                <td style={{fontSize:11,color:'#64748b'}}>{c.lastPayment||'—'}</td>
                <td><span style={{background:DEBTOR_RISK_COLORS[c.risk]||'#94a3b8',color:'#fff',borderRadius:4,padding:'2px 9px',fontSize:11,fontWeight:700,display:'inline-block',minWidth:22,textAlign:'center'}}>{c.risk||'—'}</span></td>
                <td><span style={{background:c.nonPayer?'#ef4444':'#22c55e',color:'#fff',borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:700,display:'inline-block'}}>{c.nonPayer?'YES':'no'}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── DEBTOR TREND ────────────────────────────────────────────── */
function DebtorTrend(){
  const all=debtorQuarterlyYearly||[];
  const qRows=all.filter(r=>r.type==='Q');
  const yRows=all.filter(r=>r.type==='Y');
  const[daysPer,setDaysPer]=useState('Q');
  const[pctPer,setPctPer]=useState('Q');
  const daysRows=daysPer==='Q'?qRows:yRows;
  const pctRows=pctPer==='Q'?qRows:yRows;
  const isDQ=daysPer==='Q';
  const isPQ=pctPer==='Q';

  const daysOpt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:48,right:16,top:16,bottom:isDQ?60:32},
    xAxis:{type:'category',data:daysRows.map(r=>r.period),axisLabel:{fontSize:isDQ?10:11,rotate:isDQ?35:0,interval:0}},
    yAxis:{type:'value',min:0,axisLabel:{fontSize:10,formatter:v=>v+'d'}},
    series:[{type:'bar',
      data:daysRows.map(r=>r.avgDays!=null?+r.avgDays.toFixed(1):null),
      itemStyle:{color:isDQ?'#40BCF3':'#1F3741',borderRadius:[3,3,0,0]},
      barMaxWidth:isDQ?36:72,
      label:{show:true,position:'top',fontSize:isDQ?10:12,color:isDQ?'#475569':'#1F3741',
        formatter:p=>p.value!=null?p.value+'d':''}}],
  };

  const pct30Opt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis'},
    grid:{left:48,right:16,top:16,bottom:isPQ?60:32},
    xAxis:{type:'category',data:pctRows.map(r=>r.period),axisLabel:{fontSize:isPQ?10:11,rotate:isPQ?35:0,interval:0}},
    yAxis:{type:'value',min:0,max:100,axisLabel:{formatter:v=>v+'%',fontSize:10}},
    series:isPQ
      ?[{type:'line',
          data:pctRows.map(r=>r.pct30!=null?+Math.min(100,Math.max(0,r.pct30)).toFixed(1):null),
          smooth:false,symbol:'circle',symbolSize:5,connectNulls:false,
          lineStyle:{width:2,color:'#22c55e'},itemStyle:{color:'#22c55e'},
          areaStyle:{color:'rgba(34,197,94,0.10)'},
          label:{show:true,position:'top',fontSize:10,color:'#22c55e',formatter:p=>p.value!=null?p.value+'%':''}}]
      :[{type:'bar',
          data:pctRows.map(r=>r.pct30!=null?+r.pct30.toFixed(1):null),
          itemStyle:{color:'#22c55e',borderRadius:[3,3,0,0]},barMaxWidth:72,
          label:{show:true,position:'top',fontSize:12,color:'#22c55e',formatter:p=>p.value!=null?p.value+'%':''}}],
  };

  const daysTog=(
    <div className="view-tog">
      <button className={`vt-btn${isDQ?' active':''}`} onClick={()=>setDaysPer('Q')}>Quarterly</button>
      <button className={`vt-btn${!isDQ?' active':''}`} onClick={()=>setDaysPer('Y')}>Annual</button>
    </div>
  );
  const pctTog=(
    <div className="view-tog">
      <button className={`vt-btn${isPQ?' active':''}`} onClick={()=>setPctPer('Q')}>Quarterly</button>
      <button className={`vt-btn${!isPQ?' active':''}`} onClick={()=>setPctPer('Y')}>Annual</button>
    </div>
  );

  const detailOpt={
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'}},
    grid:{left:52,right:56,top:20,bottom:60},
    legend:{data:['Avg Days','% ≤30d'],bottom:4,textStyle:{fontSize:11}},
    xAxis:{type:'category',data:qRows.map(r=>r.period),axisLabel:{fontSize:10,rotate:35,interval:0}},
    yAxis:[
      {type:'value',name:'Days',min:0,axisLabel:{fontSize:10,formatter:v=>v+'d'}},
      {type:'value',name:'%',min:0,max:100,axisLabel:{fontSize:10,formatter:v=>v+'%'}}
    ],
    series:[
      {type:'bar',name:'Avg Days',yAxisIndex:0,
        data:qRows.map(r=>r.avgDays!=null?+r.avgDays.toFixed(1):null),
        itemStyle:{color:'#40BCF3',borderRadius:[3,3,0,0]},barMaxWidth:36,
        label:{show:true,position:'top',fontSize:10,formatter:p=>p.value!=null?p.value+'d':''}},
      {type:'line',name:'% ≤30d',yAxisIndex:1,
        data:qRows.map(r=>r.pct30!=null?+Math.min(100,Math.max(0,r.pct30)).toFixed(1):null),
        smooth:false,symbol:'circle',symbolSize:5,connectNulls:false,
        lineStyle:{width:2,color:'#22c55e'},itemStyle:{color:'#22c55e'},
        label:{show:true,position:'top',fontSize:10,color:'#22c55e',formatter:p=>p.value!=null?p.value+'%':''}}
    ],
  };

  return(
    <div className="page-area fin-scroll" key="debtortrend">
      <div className="kpi-strip">
        {yRows.map(r=>(
          <div className="kpi-card blue" key={r.period}>
            <div className="kpi-lbl">{r.period} Avg Days to Pay</div>
            <div className="kpi-val sm">{r.avgDays!=null?r.avgDays.toFixed(1)+'d':'—'}</div>
            <div className="kpi-chg">{r.pct30!=null?r.pct30.toFixed(1)+'% paid ≤30d':''}{r.invoiceCount?' · '+r.invoiceCount+' invoices':''}</div>
          </div>
        ))}
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Avg Days to Pay"
            subtitle={isDQ?'Average days from invoice to payment · quarterly':'Annual average from invoice to payment'}
            height={360} controls={daysTog}><EC option={daysOpt}/></Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="% Paid ≤30 Days"
            subtitle={isPQ?'Invoices settled within 30 days · quarterly':'Annual share settled within 30 days'}
            height={360} controls={pctTog}><EC option={pct30Opt}/></Panel>
        </div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Payment Detail" subtitle="Quarterly breakdown — annual totals shown in KPI cards above" height={300}
            tableHeaders={['Period','Avg Days','% ≤30d','Invoices']}
            tableRows={qRows.map(r=>[r.period,r.avgDays!=null?r.avgDays.toFixed(1)+'d':'—',r.pct30!=null?r.pct30.toFixed(1)+'%':'—',r.invoiceCount])}
            defaultView="table"><EC option={detailOpt}/></Panel>
        </div>
      </div>
    </div>
  );
}

/* ── MOBILE SCROLL HINT ──────────────────────────────────────── */
function ScrollHint({ watchKey, disabled }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const remaining = doc.scrollHeight - (window.scrollY + window.innerHeight);
      setShow(isMobileViewport() && !disabled && remaining > 60);
    };
    update();
    const t1 = setTimeout(update, 300);
    const t2 = setTimeout(update, 900);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(document.body);
    }
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro && ro.disconnect();
    };
  }, [watchKey, disabled]);

  return (
    <>
      <div className={`scroll-fade${show ? '' : ' hidden'}`} aria-hidden="true" />
      <button
        className={`scroll-hint${show ? '' : ' hidden'}`}
        aria-label="Scroll to bottom of page"
        onClick={() => {
          const doc = document.documentElement;
          const target = doc.scrollHeight - window.innerHeight;
          window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }}
      >▼</button>
    </>
  );
}

/* ── APP ────────────────────────────────────────────────────── */
const NAV = [
  {section:'Overview',items:[{id:'overview',icon:'▦',label:'Dashboard',desc:'Live KPIs & monthly trend'},{id:'revenue',icon:'↗',label:'Revenue Trends',desc:'Monthly revenue & period comparison'}]},
  {section:'Performance',items:[{id:'salesreps',icon:'◈',label:'Verkoper',desc:'Verkoper leaderboard & rankings'},{id:'customers',icon:'⬡',label:'Customers',desc:'Top customers by revenue'}]},
  {section:'Catalogue',items:[{id:'products',icon:'◻',label:'Products',desc:'Product-level revenue breakdown'},{id:'categories',icon:'⊞',label:'Categories',desc:'Category split & revenue share'}]},
  {section:'Channels',items:[{id:'channels',icon:'⇌',label:'Channel Mix',desc:'Direct sales vs webshop split'}]},
  {section:'Finance',items:[{id:'plsummary',icon:'⟡',label:'P&L Summary',desc:'Margins & profit & loss summary'},{id:'finrevcosts',icon:'↕',label:'Revenue & Costs',desc:'Revenue vs cost lines over time'},{id:'finledger',icon:'≣',label:'Ledger',desc:'Full financial ledger detail'}]},
  {section:'Debtors',items:[{id:'debtors',icon:'◎',label:'AR Overview',desc:'Open invoices & ageing buckets'},{id:'debtorcustomers',icon:'◑',label:'Customers',desc:'Customer scorecard & open invoices'},{id:'debtortrend',icon:'⌛',label:'Payment Trends',desc:'Days to pay & quarterly performance'}]},
];
const PAGE_NAMES={overview:'Overview Dashboard',revenue:'Revenue Trends',salesreps:'Verkoper',customers:'Top Customers',products:'Product Analysis',categories:'Category Breakdown',channels:'Channel Mix',plsummary:'P&L Summary',finrevcosts:'Revenue & Costs',finledger:'Ledger',debtors:'AR Overview',debtorcustomers:'Customer Scorecard',debtortrend:'Payment Trends'};

const SUGGESTED_QUESTIONS={
  overview:['How is revenue trending this month?','Which category is driving sales right now?','Who is this month\'s top verkoper?'],
  revenue:['What was our best month on record?','How does this period compare to the previous one?','What\'s the average monthly revenue?'],
  salesreps:['Who is the top-performing verkoper?','How concentrated is revenue among the top 3 reps?','Break down sales by verkoper and category'],
  customers:['Who are our top 5 customers?','What share of revenue comes from our top customers?','What\'s the average revenue per client?'],
  products:['What is our best-selling product?','How concentrated is revenue across products?','Show me products with the smallest share'],
  categories:['Which category has the biggest share of revenue?','How many active category groups are there?','Compare the top two categories'],
  channels:['Which channel drives the most revenue?','How is revenue split across channels?'],
  plsummary:['How is gross margin trending?','What is driving EBITDA this period?'],
  finrevcosts:['What are our biggest cost drivers?','How do revenue and costs compare year over year?'],
  finledger:['What are the largest YoY swings in the ledger?','Which accounts saw the biggest cost increases?'],
  debtors:['What is the total open AR?','Which customers have the oldest outstanding invoices?','How much AR is over 90 days?'],
  debtorcustomers:['Which customer has the highest open AR?','How many customers are flagged as non-payer?','Show me all Risk D customers'],
  debtortrend:['What is the average days to pay this year?','How has the % paid within 30 days changed over time?','Which quarter had the best payment performance?'],
  default:['What can you tell me about this page?','Summarize the key numbers here'],
};

const SESSION_TIMEOUT_MS=30*60*1000;
const AUTH_KEY='dairytop_auth';
const AUTH_ACTIVITY_KEY='dairytop_auth_activity';
const ACTIVITY_WRITE_THROTTLE_MS=5000;

function Sidebar({ page, setPage, sideOpen, setSideOpen, collapsed, toggleCollapsed, setHighlightQuery, dateRange, totalTx, totalClients, handleLogout }) {
  const [navFlyout,setNavFlyout]=useState(null);
  const handleNavHover=(e,item)=>{if(!collapsed)return;const rect=e.currentTarget.getBoundingClientRect();setNavFlyout({id:item.id,icon:item.icon,label:item.label,desc:item.desc,top:rect.top+rect.height/2,left:rect.right+6});};
  const handleNavLeave=()=>setNavFlyout(null);
  const goTo=(id)=>{setPage(id);setSideOpen(false);setHighlightQuery(null);};

  return (
    <>
      <div className={`sidebar${sideOpen?' open':''}${collapsed?' collapsed':''}`}>
        <div className="sidebar-inner">
          <div className="sb-logo">
            <div className="sb-brand"><span className="sb-mark">▸</span><span className="sb-brand-text">DairyTop</span></div>
            <div className="sb-tag">Business Intelligence</div>
          </div>
          <nav className="nav">
            {NAV.map((s,i)=>(
              <div key={i}>
                {i>0&&<div className="nav-divider"/>}
                <div className="nav-section">{s.section}</div>
                {s.items.map(item=>(
                  <div key={item.id} className={`nav-item${page===item.id?' active':''}${navFlyout?.id===item.id?' hovered':''}`}
                    onClick={()=>goTo(item.id)}
                    onMouseEnter={(e)=>handleNavHover(e,item)}
                    onMouseLeave={handleNavLeave}
                    role="button" tabIndex={0} onKeyDown={e=>e.key==='Enter'&&goTo(item.id)}>
                    <span className="nav-icon"><img src={`/icons/icon-${item.id}.png`} alt={item.label} draggable="false"/></span>
                    <span className="nav-label">{item.label}</span>
                    {page===item.id&&<span className="nav-pip"/>}
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-footer-stats" style={{marginBottom:8}}>
              <div className="stat-row"><span className="stat-lbl">Period</span><span className="stat-val">{dateRange}</span></div>
              <div className="stat-row"><span className="stat-lbl">Trans.</span><span className="stat-val">{totalTx.toLocaleString('de-DE')}</span></div>
              <div className="stat-row"><span className="stat-lbl">Clients</span><span className="stat-val">{totalClients.toLocaleString('de-DE')}</span></div>
            </div>
            <button className="logout-btn" onClick={handleLogout} title={collapsed?'Sign out':undefined}
              onMouseEnter={(e)=>collapsed&&handleNavHover(e,{id:'logout',icon:'↩',label:'Sign out',desc:'End your session'})}
              onMouseLeave={handleNavLeave}>
              <span>↩</span><span className="logout-btn-label"> Sign out</span>
            </button>
          </div>
        </div>
        <button className="sb-collapse-btn" onClick={toggleCollapsed} title={collapsed?'Expand sidebar':'Collapse sidebar'} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} aria-pressed={collapsed}>
          {collapsed?'›':'‹'}
        </button>
      </div>
      {navFlyout&&createPortal(
        <div key={navFlyout.id} className="nav-flyout" style={{top:navFlyout.top,left:navFlyout.left,transform:'translateY(-50%)'}}>
          <span className="nav-flyout-badge">{navFlyout.icon}</span>
          <span className="nav-flyout-text"><span className="nav-flyout-title">{navFlyout.label}</span>{navFlyout.desc&&<span className="nav-flyout-desc">{navFlyout.desc}</span>}</span>
          <span className="nav-flyout-chevron">›</span>
        </div>,
        document.body
      )}
    </>
  );
}

const AUTH_USER_KEY='dairytop_username';

export default function App() {
  const [userName,setUserName]=useState(()=>{try{return localStorage.getItem(AUTH_USER_KEY)||'';}catch{return'';}});
  const [authed,setAuthed]=useState(()=>{
    const savedAuth=localStorage.getItem(AUTH_KEY);
    const lastActivity=localStorage.getItem(AUTH_ACTIVITY_KEY);
    if(savedAuth==='true'&&lastActivity){const elapsed=Date.now()-parseInt(lastActivity,10);if(elapsed<SESSION_TIMEOUT_MS)return true;else{localStorage.removeItem(AUTH_KEY);localStorage.removeItem(AUTH_ACTIVITY_KEY);return false;}}
    return false;
  });

  const SESSION_PAGE_KEY='dairytop_last_page';
  const SESSION_FILTER_KEY='dairytop_last_filter';
  const [page,setPage]=useState(()=>sessionStorage.getItem(SESSION_PAGE_KEY)||'overview');
  const [filter,setFilter]=useState(()=>{
    try{
      const saved=sessionStorage.getItem(SESSION_FILTER_KEY);
      if(saved){
        const parsed=JSON.parse(saved);
        return {
          years: parsed.years || [],
          months: parsed.months || {},
          weeks: parsed.weeks || {}
        };
      }
    }catch{}
    return {years:[],months:{},weeks:{}};
  });
  const [sideOpen,setSideOpen]=useState(false);

  const SIDEBAR_COLLAPSE_KEY='dairytop_sidebar_collapsed';
  const [collapsed,setCollapsed]=useState(()=>{try{return JSON.parse(localStorage.getItem(SIDEBAR_COLLAPSE_KEY)||'false');}catch{return false;}});
  const toggleCollapsed=()=>{setCollapsed(v=>{const next=!v;try{localStorage.setItem(SIDEBAR_COLLAPSE_KEY,JSON.stringify(next));}catch{}return next;});};

  useEffect(()=>{
    const DURATION=340;const start=performance.now();let raf;
    const tick=(now)=>{liveChartInstances.forEach(inst=>{try{inst.resize();}catch{}});if(now-start<DURATION)raf=requestAnimationFrame(tick);};
    raf=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(raf);
  },[collapsed]);

  const resizeAllCharts=useCallback(()=>{
    liveChartInstances.forEach(inst=>{try{inst.resize();}catch{}});
  },[]);
  useEffect(()=>{
    if(!authed)return;
    const delays=[50,150,350,600,1000];
    const timers=delays.map(ms=>setTimeout(resizeAllCharts,ms));
    window.addEventListener('resize',resizeAllCharts);
    window.addEventListener('orientationchange',resizeAllCharts);
    return()=>{
      timers.forEach(clearTimeout);
      window.removeEventListener('resize',resizeAllCharts);
      window.removeEventListener('orientationchange',resizeAllCharts);
    };
  },[authed,resizeAllCharts]);
  useEffect(()=>{
    const t=setTimeout(resizeAllCharts,120);
    return()=>clearTimeout(t);
  },[page,resizeAllCharts]);

  const [time,setTime]=useState(new Date());

  useEffect(()=>{
    sessionStorage.setItem(SESSION_PAGE_KEY,page);
    window.scrollTo({top:0});
  },[page]);

  useEffect(()=>{try{sessionStorage.setItem(SESSION_FILTER_KEY,JSON.stringify(filter));}catch{}},[filter]);

  useEffect(()=>{
    document.documentElement.classList.toggle('no-scroll',sideOpen);
    return()=>document.documentElement.classList.remove('no-scroll');
  },[sideOpen]);

  const [searchQuery,setSearchQuery]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const [highlightQuery,setHighlightQuery]=useState(null);
  const searchIndex=useMemo(()=>{
    const seen=new Set();const idx=[];
    customersRaw.forEach(c=>{if(!seen.has('c:'+c.n)){seen.add('c:'+c.n);idx.push({name:c.n,type:'Customer',page:'customers'});}});
    productsRaw.forEach(p=>{if(!seen.has('p:'+p.n)){seen.add('p:'+p.n);idx.push({name:p.n,type:'Product',page:'products'});}});
    salesrepsRaw.forEach(r=>{if(!seen.has('r:'+r.n)){seen.add('r:'+r.n);idx.push({name:r.n,type:'Verkoper',page:'salesreps'});}});
    categoriesRaw.forEach(c=>{if(!seen.has('cat:'+c.n)){seen.add('cat:'+c.n);idx.push({name:c.n,type:'Category',page:'categories'});}});
    return idx;
  },[]);
  const SEARCH_GROUPS=[{type:'Customer',page:'customers',label:'Customers'},{type:'Product',page:'products',label:'Products'},{type:'Verkoper',page:'salesreps',label:'Verkopers'},{type:'Category',page:'categories',label:'Categories'}];
  const MAX_PER_GROUP=6;
  const groupedResults=useMemo(()=>{
    const q=searchQuery.trim().toLowerCase();if(!q)return[];
    return SEARCH_GROUPS.map(g=>{const matches=searchIndex.filter(i=>i.type===g.type&&i.name.toLowerCase().includes(q));return{...g,items:matches.slice(0,MAX_PER_GROUP),total:matches.length};}).filter(g=>g.items.length>0);
  },[searchQuery,searchIndex]);
  const firstResult=groupedResults[0]?.items?.[0];
  const goToSearchResult=(result)=>{setPage(result.page);setHighlightQuery(result.name);setSearchQuery(result.name);setSearchOpen(false);};

  const searchRef=useRef(null);
  const searchResultsRef=useRef(null);
  useEffect(()=>{
    const handler=(e)=>{if(searchRef.current?.contains(e.target))return;if(searchResultsRef.current?.contains(e.target))return;setSearchOpen(false);};
    document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler);
  },[]);

  const [searchPos,setSearchPos]=useState(null);
  useLayoutEffect(()=>{
    if(searchOpen&&searchQuery.trim()&&searchRef.current){const rect=searchRef.current.getBoundingClientRect();setSearchPos({top:rect.bottom+6,right:Math.max(8,window.innerWidth-rect.right),width:Math.max(rect.width,300)});}
  },[searchOpen,searchQuery,groupedResults.length]);
  useEffect(()=>{
    if(!searchOpen)return;
    const close=(e)=>{if(searchResultsRef.current?.contains(e.target))return;setSearchOpen(false);};
    window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
    return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};
  },[searchOpen]);

  useEffect(()=>{
    if(!authed)return;
    let lastWrite=0;
    const markActive=()=>{const now=Date.now();if(now-lastWrite<ACTIVITY_WRITE_THROTTLE_MS)return;lastWrite=now;localStorage.setItem(AUTH_ACTIVITY_KEY,now.toString());};
    markActive();
    const events=['mousemove','mousedown','keydown','wheel','scroll','touchstart','click'];
    events.forEach(evt=>window.addEventListener(evt,markActive,{passive:true}));
    return()=>{events.forEach(evt=>window.removeEventListener(evt,markActive));};
  },[authed]);

  useEffect(()=>{
    if(!authed)return;
    const checkSession=()=>{const lastActivity=localStorage.getItem(AUTH_ACTIVITY_KEY);if(lastActivity){const elapsed=Date.now()-parseInt(lastActivity,10);if(elapsed>=SESSION_TIMEOUT_MS){localStorage.removeItem(AUTH_KEY);localStorage.removeItem(AUTH_ACTIVITY_KEY);setAuthed(false);}}};
    const interval=setInterval(checkSession,10000);return()=>clearInterval(interval);
  },[authed]);

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),30000);return()=>clearInterval(t);},[]);

  const handleLogin=(username)=>{setAuthed(true);localStorage.setItem(AUTH_KEY,'true');localStorage.setItem(AUTH_ACTIVITY_KEY,Date.now().toString());setUserName(username||'');try{localStorage.setItem(AUTH_USER_KEY,username||'');}catch{}};
  const handleLogout=()=>{setAuthed(false);localStorage.removeItem(AUTH_KEY);localStorage.removeItem(AUTH_ACTIVITY_KEY);localStorage.removeItem(AUTH_USER_KEY);setUserName('');};

  const fm=useMemo(()=>{
    if(!filter.years||filter.years.length===0)return monthly;
    return monthly.filter(m=>{const[,yr]=m.m.split(' ');if(!filter.years.includes(yr))return false;const ym=filter.months[yr];if(!ym||ym.length===0)return true;return ym.includes(m.m);});
  },[filter]);

  const filterLabel=useMemo(()=>{
    if(!filter.years||filter.years.length===0)return'Full period';
    const eff = effGrainFor(filter);
    return filter.years.map(y=>{
      const m=filter.months[y];
      const w=filter.weeks?.[y];
      const parts = [];
      if (m && m.length) parts.push(`${m.length}m`);
      if (w && w.length) parts.push(`${w.length}w`);
      const suffix = parts.length ? ` (${parts.join(' · ')})` : (eff==='yearly' ? ' (all)' : '');
      return `20${y}${suffix}`;
    }).join(', ');
  },[filter]);

  const dateRange=useMemo(()=>{if(fm.length===0)return'No data';return`${fm[0].m} – ${fm[fm.length-1].m}`;},[fm]);
  const totalTx=useMemo(()=>fm.reduce((s,m)=>s+m.orders,0),[fm]);

  if(!authed)return(<><style>{css}</style><Login onLogin={handleLogin}/></>);

  const effGrain = effGrainFor(filter);

  const renderPage=()=>{
    const props={fm,label:filterLabel,effGrain,filter};
    const searchProps={highlightQuery};
    switch(page){
      case'overview':return<Overview/>;
      case'revenue':return<Revenue{...props}/>;
      case'salesreps':return<SalesReps{...props}{...searchProps}/>;
      case'customers':return<Customers{...props}{...searchProps}/>;
      case'products':return<Products{...props}{...searchProps}/>;
      case'categories':return<Categories{...props}{...searchProps}/>;
      case'channels':return<Channels{...props}/>;
      case'plsummary':return<PLSummary/>;
      case'finrevcosts':return<FinRevCosts/>;
      case'finledger':return<FinLedger/>;
      case'debtors':return<Debtors/>;
      case'debtorcustomers':return<DebtorCustomers/>;
      case'debtortrend':return<DebtorTrend/>;
      default:return<Overview{...props}/>;
    }
  };

  const handleExportPage=()=>window.print();

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <button className="mob-toggle" onClick={()=>setSideOpen(v=>!v)} aria-label="Menu">{sideOpen?'✕':'☰'}</button>
        <div className={`mob-overlay${sideOpen?' open':''}`} onClick={()=>setSideOpen(false)}/>

        <Sidebar
          page={page} setPage={setPage} sideOpen={sideOpen} setSideOpen={setSideOpen}
          collapsed={collapsed} toggleCollapsed={toggleCollapsed} setHighlightQuery={setHighlightQuery}
          dateRange={dateRange} totalTx={totalTx} totalClients={totalClients} handleLogout={handleLogout}
        />

        <div className="main">
          <div className={`topbar${page==='overview'?' topbar-overview':''}`}>
            <div className="tb-row1">
              <div className="tb-titlewrap">
                <div className="tb-title">{PAGE_NAMES[page]}</div>
                <div className="tb-sub">
                  {page==='overview'?(
                    <span>Live · Current month{monthly.length?` (${monthly[monthly.length-1].m})`:''}</span>
                  ):(
                    <><span>{filterLabel}</span><span className="tb-sep">·</span><span>{dateRange}</span><span className="tb-sep">·</span><span>All products</span></>
                  )}
                </div>
              </div>
              <div className="tb-right">
                <button className="tb-print-btn" onClick={handleExportPage} title="Export this page as a PDF via your browser's print dialog">⬇ Export</button>
                <div className="tb-refresh">Updated <strong>{lastUpdated}</strong></div>
                <div className="tb-time">{time.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
                <div className="live-badge"><span className="blink-dot"/>Live</div>
              </div>
            </div>
            {page!=='overview'&&(
              <div className="tb-search" ref={searchRef}>
                <span className="tb-search-icon">🔍</span>
                <input type="text" placeholder="Find a customer, product, verkoper…" value={searchQuery}
                  onChange={e=>{setSearchQuery(e.target.value);setSearchOpen(true);}}
                  onFocus={()=>setSearchOpen(true)}
                  onKeyDown={e=>{if(e.key==='Enter'&&firstResult)goToSearchResult(firstResult);if(e.key==='Escape')setSearchOpen(false);}}
                  aria-label="Global search"/>
                {searchOpen&&searchQuery.trim()&&searchPos&&createPortal(
                  <div ref={searchResultsRef} className="tb-search-results" style={{top:searchPos.top,right:searchPos.right,width:searchPos.width}}>
                    {groupedResults.length===0?(<div className="tb-search-empty">No matches in customers, products, or verkopers</div>):groupedResults.map(g=>(
                      <div key={g.type} className="tb-search-group">
                        <div className="tb-search-group-head"><span><strong>{g.label}</strong> ({g.total})</span><span className="tb-search-group-dest">→ {PAGE_NAMES[g.page]}</span></div>
                        {g.items.map((r,i)=>(<div key={i} className="tb-search-item" onClick={()=>goToSearchResult(r)}><span className="tb-search-item-name" title={r.name}>{r.name}</span><span className="tb-search-item-arrow">→</span></div>))}
                        {g.total>g.items.length&&(<div className="tb-search-empty" style={{padding:'5px 12px',fontStyle:'normal'}}>+{g.total-g.items.length} more — refine your search</div>)}
                      </div>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>
          {page!=='overview'&&<DateFilterBar filter={filter} setFilter={setFilter}/>}
          {renderPage()}
        </div>

        <ChatBot
          context={{page,pageName:PAGE_NAMES[page],filterLabel,dateRange,effectiveGrain:effGrain}}
          suggestedQuestions={SUGGESTED_QUESTIONS[page]||SUGGESTED_QUESTIONS.default}
          userName={formatDisplayName(userName)}
        />
        <ScrollHint watchKey={page+JSON.stringify(filter)} disabled={sideOpen}/>
      </div>
    </>
  );
}

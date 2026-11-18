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
  fmtPct
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
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;}

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
.nav-icon{width:22px;height:22px;flex-shrink:0;opacity:.82;transition:transform .15s ease-out,opacity .15s ease-out;display:flex;align-items:center;justify-content:center;}.nav-icon img{width:32px;height:32px;object-fit:contain;display:block;}
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
.kpi-card.clickable{cursor:pointer;}
.kpi-card.clickable:hover{background:var(--surface2);box-shadow:0 2px 8px rgba(64,188,243,0.12);}
.kpi-card.blue{--kpi-accent:var(--accent);--kpi-label:#0A6E9B;}
.kpi-card.teal{--kpi-accent:var(--accent2);--kpi-label:#14708F;}
.kpi-card.navy{--kpi-accent:var(--accent3);--kpi-label:#2A5570;}
.kpi-card.green{--kpi-accent:var(--green);--kpi-label:#1A6E43;}
.kpi-card.amber{--kpi-accent:var(--amber);--kpi-label:#8E610D;}
.kpi-card.sky{--kpi-accent:#63C4EE;--kpi-label:#12718F;}
.kpi-card.red{--kpi-accent:var(--red);--kpi-label:#9E3838;}
.kpi-icon{position:absolute;right:10px;top:10px;font-size:16px;opacity:.3;}
.kpi-lbl{
  font-size:10.5px;color:var(--kpi-label,var(--muted2));
  text-transform:uppercase;letter-spacing:.09em;font-weight:800;
  margin-bottom:5px;position:relative;
}
.kpi-val{font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1;color:var(--text);word-break:break-all;position:relative;letter-spacing:-.2px;}
.kpi-val.sm{font-size:16px;}
.kpi-chg{font-size:11px;color:var(--muted);margin-top:5px;font-weight:500;position:relative;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
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

.login-screen {
  --login-scene:url("data:image/webp;base64,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");
  --login-glass:url("data:image/webp;base64,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");
  position:fixed; inset:0; z-index:1000; isolation:isolate;
  display:flex; flex-direction:column; overflow:auto; overscroll-behavior:contain;
  scroll-padding-block:20px;
  top:var(--login-viewport-top,0px); height:var(--login-viewport-height,100%); bottom:auto;
  padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
    calc(16px + env(safe-area-inset-bottom) + clamp(0px,1.5vh,14px)) calc(16px + env(safe-area-inset-left));
  background:#cbdbea; color:#062039;
}
.login-scene {
  position:fixed; inset:0; z-index:-1; overflow:hidden; pointer-events:none;
  background:var(--login-scene) center / cover no-repeat;
}
.login-scene svg {
  position:absolute; inset:0; width:100%; height:100%; overflow:visible;
}
.login-box {
  position:relative; isolation:isolate; margin:auto; flex:none;
  font-size:clamp(6px, min(.598086vw, 1.0627vh), 13px);
  width:75em; max-width:100%; min-height:75.5em;
  padding:6.6em 8.6em 4.3em; border-radius:3.9em;
  background:#e5eff8 var(--login-glass) center / 100% 100% no-repeat;
  box-shadow:0 2.8em 5.5em rgba(12,57,88,.27), inset 0 0 0 1px rgba(255,255,255,.94);
}
.login-box::before, .login-box::after {
  content:''; position:absolute; inset:0; z-index:-1; border-radius:inherit; pointer-events:none;
  background-repeat:no-repeat;
}
.login-box::before {
  background-image:radial-gradient(ellipse, #fff 0%, #bafaff 18%, rgba(86,243,255,.48) 41%, transparent 70%);
  background-size:40% 1.7em; background-position:0% -.65em;
  animation:login-rim-sweep 7s ease-in-out infinite alternate;
}
.login-box::after {
  background-image:radial-gradient(ellipse, #fff 0%, #a3fcff 21%, rgba(78,227,255,.45) 45%, transparent 72%);
  background-size:44% 2em; background-position:85% calc(100% + .8em);
  animation:login-rim-sweep 9s ease-in-out infinite alternate-reverse;
}
@keyframes login-rim-sweep {
  from { background-position-x:0%; opacity:.62; }
  to { background-position-x:100%; opacity:1; }
}
.login-logo {
  display:flex; align-items:center; gap:.9em;
  color:#007fa1; font-size:1.9em; font-weight:800; letter-spacing:.19em;
  line-height:1.45; text-transform:uppercase;
}
.login-logo::before { content:''; width:.18em; height:1.14em; background:#00bddf; flex:none; }
.login-title {
  margin:.34em 0 .19em; color:#052038; font-size:5.6em;
  font-weight:800; line-height:1.1; letter-spacing:-.035em;
}
.login-sub { color:#425970; font-size:2.45em; font-weight:500; line-height:1.4; }
.login-form { margin-top:4.55em; }
.login-field + .login-field { margin-top:3em; }
.login-field label {
  display:block; color:#3b5269; margin-bottom:.48em;
  font-size:1.95em; font-weight:800; letter-spacing:.065em; text-transform:uppercase;
}
.login-input { position:relative; }
.login-input > svg {
  position:absolute; top:50%; left:2.55em; transform:translateY(-50%);
  width:3.2em; height:3.2em; color:#365875; pointer-events:none;
}
.login-input input {
  display:block; width:100%; height:2.65em; border-radius:.57em;
  border:1px solid #c4d4e7; border-bottom-color:#fff;
  background:linear-gradient(112deg,rgba(233,242,252,.92),rgba(215,226,245,.72));
  box-shadow:inset 0 2px 4px #bdcde16b,inset 0 -2px 4px #f8fbffb3,0 .3em .47em #2548641b;
  color:#071f38; line-height:1.2;
  font-family:inherit; font-size:2.55em; font-weight:600;
  padding:0 .65em 0 3.1em; outline:none;
  transition:border-color .2s,box-shadow .2s;
}
#login-password { padding-right:2.2em; }
#login-password[type="password"] { letter-spacing:.15em; }
.login-password-toggle {
  position:absolute; top:50%; right:1em; transform:translateY(-50%);
  display:grid; place-items:center; width:4.8em; height:4.8em;
  min-width:44px; min-height:44px; padding:.35em;
  border:0; border-radius:12px; background:transparent; color:#285470;
  font:inherit; cursor:pointer;
}
.login-password-toggle:hover:not(:disabled) { background:#d3eefb; }
.login-password-toggle:focus-visible { outline:2px solid #007a9a; outline-offset:-2px; }
.login-password-toggle:disabled { opacity:.48; cursor:not-allowed; }
.login-password-toggle svg { display:block; width:100%; height:100%; }
.login-cow-hoof { transition:transform .24s ease; }
.login-password-toggle[data-visible="true"] .login-cow-hoof-left { transform:translate(-5px, 7px) rotate(9deg); }
.login-password-toggle[data-visible="true"] .login-cow-hoof-right { transform:translate(5px, 7px) rotate(-9deg); }
.login-input input::placeholder { color:#4b637a; font-weight:500; letter-spacing:0; }
.login-input input:focus { border-color:#159dbd; box-shadow:0 0 0 3px #00b9e447, 0 .3em .47em #2548641b; }
.login-btn {
  position:relative; isolation:isolate; display:flex; align-items:center; justify-content:center; gap:.48em;
  width:calc(100% + .9em); min-height:2.9em; padding:.4em;
  margin:1.55em -.45em 0; border:1px solid #326783; border-bottom-color:#52ecff; border-radius:.48em;
  color:#fff; font-family:inherit; font-size:2.85em; font-weight:800; cursor:pointer;
  background:radial-gradient(ellipse at 100% 105%,#004a70,transparent 47%),linear-gradient(155deg,#195078,#031c32 41%,#042139);
  box-shadow:0 .46em .72em #0d607553; transition:filter .2s, transform .18s;
}
.login-btn::after {
  content:''; position:absolute; inset:0; z-index:-1; pointer-events:none; border-radius:inherit;
  background:radial-gradient(ellipse,#fff 0%,#a8ffff 13%,#02dffe 29%,#00a4e242 54%,transparent 73%) 80% calc(100% + .55em) / 64% 1.1em no-repeat;
  animation:login-rim-sweep 5s ease-in-out infinite alternate;
}
.login-btn:hover:not(:disabled) { filter:brightness(1.17); transform:translateY(-1px); }
.login-btn:active:not(:disabled) { transform:translateY(1px); }
.login-btn:focus-visible, .login-lock button:focus-visible { outline:2px solid #007a9a; outline-offset:4px; }
.login-btn:disabled { opacity:.65; cursor:not-allowed; }
.login-btn svg { width:.9em; height:.9em; flex:none; }
.login-err { margin-top:.6em; color:#992831; font-size:1.6em; font-weight:650; }
.login-lock {
  margin-top:1em; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.5em;
  padding:.55em .7em; border-radius:.4em; background:#ffebee; color:#992831; font-size:1.55em;
}
.login-lock button {
  border:0; border-radius:.3em; padding:.35em .65em; color:#fff; background:#ab2831;
  font:inherit; cursor:pointer;
}
.login-lock + .login-form { margin-top:2em; }
.login-credit {
  display:flex; align-items:center; gap:1.1em; margin-top:1.97em;
  color:#405972; font-size:2.1em; font-weight:500; white-space:nowrap;
}
.login-credit::before, .login-credit::after { content:''; flex:1; height:1px; background:#b6cbe1; }
.login-credit strong { color:#062039; font-weight:800; }
@media (prefers-reduced-motion:reduce) {
  .login-box::before, .login-box::after, .login-btn::after { animation:none; }
  .login-scene svg { display:none; }
  .login-btn, .login-input input, .login-cow-hoof { transition:none; }
}

.login-box.welcome-box {
  width:78.2em; min-height:71.5em; padding:6.8em 5.7em 4.8em;
  background-image:url("data:image/webp;base64,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"); background-size:100% 100%;
}
.welcome-heading {
  max-width:76%; margin:.54em 0 0; min-height:2.24em;
  color:#071c38; font-size:4.35em; font-weight:800; line-height:1.12;
  letter-spacing:-.035em; overflow-wrap:anywhere;
}
.welcome-ring {
  position:relative; display:grid; place-items:center;
  width:18.4em; height:18.4em; margin:4.5em auto 0;
  border:1px solid #fff; border-radius:50%;
  background:linear-gradient(145deg,#f4fcff,#b4d9f2);
  box-shadow:0 1em 2em #4d8fb734,inset 0 0 1em #fff;
}
.welcome-ring::before {
  content:''; position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg,#63ffff,#00c6f2 22%,transparent 24%);
  mask:radial-gradient(farthest-side,transparent calc(100% - 1.8em),#000 calc(100% - 1.7em));
  animation:welcome-spin 1.3s linear infinite;
}
.welcome-ring::after {
  content:''; position:absolute; inset:10.5%; border-radius:50%;
  background:linear-gradient(145deg,#dbeefa,#f9feff);
  box-shadow:inset 0 .4em .9em #9bc1e666,0 0 .5em #fff;
}
.welcome-ring svg {
  position:relative; z-index:1; display:block; width:35%; height:35%;
}
.welcome-status {
  margin:.72em auto 0; min-height:1.4em; text-align:center;
  font-size:2.85em; line-height:1.4; font-weight:800; letter-spacing:-.025em;
}
.welcome-progress {
  width:91%; height:3.3em; margin:3.2em auto 0; padding:2px;
  overflow:hidden; border:1px solid #fff; border-radius:100px;
  background:#d3e6fa; box-shadow:inset 0 2px 4px #91b6dc80,0 0 1.4em #73efff55;
}
.welcome-progress span {
  display:block; height:100%; border-radius:inherit; transform-origin:left;
  background:linear-gradient(#c2ffff,#02c6f0 55%,#00acd9 77%,#91fcff);
  box-shadow:0 0 1em #0de0ff;
  animation:welcome-progress var(--welcome-duration) linear both;
}
.welcome-box .login-credit { margin:2.6em 4.2% 0; }
@keyframes welcome-spin { to { transform:rotate(1turn); } }
@keyframes welcome-progress { from { transform:scaleX(.02); } to { transform:scaleX(1); } }
@media (prefers-reduced-motion:reduce) {
  .welcome-ring::before,.welcome-progress span { animation:none; }
  .welcome-progress span { transform:scaleX(var(--welcome-progress)); }
}

@media (max-width:900px), (max-height:600px) {
  .login-screen {
    --login-gutter:clamp(10px,3vw,20px);
    padding:calc(var(--login-gutter) + env(safe-area-inset-top))
      calc(var(--login-gutter) + env(safe-area-inset-right))
      calc(var(--login-gutter) + env(safe-area-inset-bottom))
      calc(var(--login-gutter) + env(safe-area-inset-left));
  }
  .login-box, .login-box.welcome-box {
    width:100%; max-width:480px; min-height:0; font-size:8px;
    padding:clamp(22px,5vw,36px); border-radius:clamp(22px,5vw,32px);
    background-size:100% 100%;
  }
  .login-logo { font-size:clamp(10px,2.65vw,14px); letter-spacing:.13em; }
  .login-title { font-size:clamp(28px,8vw,42px); }
  .login-sub { max-width:27ch; font-size:clamp(14px,3.7vw,18px); }
  .login-form { margin-top:26px; }
  .login-field + .login-field { margin-top:18px; }
  .login-field label { font-size:13px; }
  .login-input > svg { left:14px; width:22px; height:22px; }
  .login-input input { min-height:50px; font-size:16px; padding-left:46px; }
  #login-password { padding-right:58px; }
  .login-password-toggle { right:3px; }
  .login-btn { width:100%; min-height:48px; margin:24px 0 0; font-size:18px; }
  .login-lock button { min-height:44px; }
  .login-credit { gap:10px; font-size:clamp(12px,3.3vw,16px); margin-top:24px; }
  .welcome-heading { max-width:80%; min-height:0; font-size:clamp(23px,6vw,36px); }
  .welcome-ring { width:clamp(84px,25vw,132px); height:auto; aspect-ratio:1; margin-top:24px; }
  .welcome-status { max-width:100%; min-height:2.8em; font-size:clamp(15px,4.2vw,21px); }
  .welcome-progress { width:100%; height:18px; margin-top:8px; }
  .welcome-box .login-credit { margin:22px 0 0; }
}

@media (max-width:380px) {
  .login-box, .login-box.welcome-box {
    padding-inline:18px;
    background-image:linear-gradient(115deg,#f2faff,#d6e8f6);
  }
  .welcome-heading { max-width:100%; }
}

@media (orientation:landscape) and (max-height:500px) and (min-width:540px) {
  .login-box:not(.welcome-box) {
    display:grid; grid-template-columns:minmax(0,1fr) minmax(240px,1.25fr);
    align-items:center; column-gap:20px; max-width:690px; padding:18px 24px;
    background-image:linear-gradient(115deg,#f2faff,#d6e8f6);
  }
  .login-box:not(.welcome-box) .login-form { grid-column:2; grid-row:1; margin-top:0; }
  .login-box:not(.welcome-box) .login-lock { grid-column:1 / -1; grid-row:2; }
  .login-box:not(.welcome-box) .login-credit { grid-column:1 / -1; margin-top:16px; }
  .login-field + .login-field { margin-top:12px; }
  .login-btn { margin-top:14px; }
  .login-box.welcome-box { max-width:570px; padding:16px 24px; }
  .welcome-heading { font-size:clamp(21px,6vh,30px); }
  .welcome-ring { width:clamp(55px,20vh,92px); margin-top:12px; }
  .welcome-status { min-height:1.4em; font-size:16px; }
  .welcome-progress { height:14px; }
  .welcome-box .login-credit { margin-top:12px; }
}

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
  .kpi-val{font-size:17px;}
  .kpi-val.sm{font-size:14px;}
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
  .kpi-lbl{font-size:9px;margin-bottom:3px;}
  .kpi-val{font-size:15px;}
  .kpi-val.sm{font-size:13px;}
  .kpi-chg{font-size:9px;margin-top:3px;}

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

  .watch-split{flex-direction:column;}
  .fin-note{font-size:9px;padding:4px 10px;}
  .gauge-val{font-size:16px;}
  .ledger-search{font-size:10px;}
  .ledger-count{font-size:8px;}

  .page-area,
  .sidebar.collapsed ~ .main .page-area{padding:12px !important;}

  .kpi-strip{grid-template-columns:repeat(2,1fr);gap:6px;}
  .kpi-card{padding:8px 10px;}
  .kpi-val.sm{font-size:13px;}
  .kpi-chg{font-size:9px;}
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
.back-btn{
  display:inline-flex;align-items:center;gap:5px;flex-shrink:0;
  font-size:11px;font-weight:600;color:var(--accent2);
  background:rgba(64,188,243,0.08);border:1px solid var(--accent);
  border-radius:6px;padding:5px 12px;margin-bottom:8px;cursor:pointer;
  transition:background .14s,color .14s;
}
.back-btn:hover{background:var(--accent);color:#fff;}

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
  const screenRef = useRef(null);

  useEffect(() => {
    const screen = screenRef.current;
    const viewport = window.visualViewport;
    if (!screen || !viewport) return;

    const syncViewport = () => {
      if (viewport.scale !== 1) {
        screen.style.removeProperty('--login-viewport-height');
        screen.style.removeProperty('--login-viewport-top');
        return;
      }
      screen.style.setProperty('--login-viewport-height', viewport.height + 'px');
      screen.style.setProperty('--login-viewport-top', viewport.offsetTop + 'px');
    };

    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
    };
  }, []);

  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
                  (u === 'Johan.dairytop' && p === 'Johan@123') ||
                  (u === 'Leon.dairytop' && p === 'LeonJonge@123');
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
        setShowPassword(false);
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
    <main ref={screenRef} className="login-screen" aria-labelledby="login-heading">
      <div className="login-scene" aria-hidden="true">
        <svg viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" focusable="false">
          <defs>
            <radialGradient id="login-light">
              <stop stopColor="#fff" />
              <stop offset=".18" stopColor="#dcffff" stopOpacity=".95" />
              <stop offset=".46" stopColor="#69efff" stopOpacity=".5" />
              <stop offset="1" stopColor="#37deff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r="24" fill="url(#login-light)">
            <animateMotion dur="8s" repeatCount="indefinite" path="M1222 596 C1303 496 1349 445 1407 472 S1491 502 1530 480 S1633 386 1674 366" />
            <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.13;.62;.79;1" dur="8s" repeatCount="indefinite" />
          </circle>
          <ellipse rx="92" ry="14" fill="url(#login-light)">
            <animateMotion dur="12s" repeatCount="indefinite" rotate="auto" path="M1220 766 C1370 665 1511 611 1674 587" />
            <animate attributeName="opacity" values="0;.85;.85;0;0" keyTimes="0;.18;.69;.87;1" dur="12s" repeatCount="indefinite" />
          </ellipse>
          <ellipse rx="68" ry="11" fill="url(#login-light)">
            <animateMotion dur="11s" repeatCount="indefinite" rotate="auto" path="M-50 781 C141 718 309 704 468 759" />
            <animate attributeName="opacity" values="0;.75;.75;0;0" keyTimes="0;.15;.69;.87;1" dur="11s" repeatCount="indefinite" />
          </ellipse>
        </svg>
      </div>
      <section className="login-box">
        <header>
          <div className="login-logo">Business Intelligence</div>
          <h1 id="login-heading" className="login-title">Dashboard</h1>
          <p className="login-sub">Sign in to access your analytics</p>
        </header>
        {locked && (
          <div className="login-lock">
            <span>Locked for {fmt_t(timeLeft)}</span>
            <button type="button" onClick={clearLockout}>Clear Lockout (Dev)</button>
          </div>
        )}
        <form className="login-form" onSubmit={handle}>
          <div className="login-field">
            <label htmlFor="login-username">Username</label>
            <div className="login-input">
              <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="16" cy="9" r="6.4" />
                <path d="M3 29v-2.5c0-5 5.8-8.4 13-8.4s13 3.4 13 8.4V29H3Z" strokeLinejoin="round" />
              </svg>
              <input id="login-username" name="username" autoComplete="username" type="text"
                value={u} onChange={e=>{setU(e.target.value);setErr(false);}}
                placeholder="Enter username" disabled={locked} aria-invalid={err && !locked} />
            </div>
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <div className="login-input">
              <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="13" width="24" height="18" rx="2" />
                <path d="M8 13V9a8 8 0 0 1 16 0v4m-8 10v3" />
                <circle cx="16" cy="21" r="1.4" />
              </svg>
              <input id="login-password" name="password" autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={p} onChange={e=>{setP(e.target.value);setErr(false);}}
                placeholder="Enter password" disabled={locked} aria-invalid={err && !locked} />
              <button
                type="button"
                className="login-password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-controls="login-password"
                data-visible={showPassword}
                disabled={locked}
                onClick={() => setShowPassword(visible => !visible)}
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                  <path d="M14 15c-5-2-6-7-5-10 3 4 5 5 9 5m12 0c4 0 6-1 9-5 1 3 0 8-5 10" fill="#b5d5e8" />
                  <path d="M13 14C8 10 3 13 2 17c3 4 7 5 11 3m22-6c5-4 10-1 11 3-3 4-7 5-11 3" fill="#9ec9e0" />
                  <path d="M24 9c9 0 14 5 14 13v7c0 8-6 13-14 13s-14-5-14-13v-7c0-8 5-13 14-13Z" fill="#f6fcff" />
                  <path d="M11 19c2-5 5-7 9-8 2 2 2 6-1 8-3 1-3 4-7 5l-1 1Zm26 6c-4-1-5-3-5-6 0-2 1-3 2-4 2 3 3 5 3 10Z" fill="#5888a6" stroke="none" />
                  <ellipse cx="18" cy="23" rx="1.9" ry="2.3" fill="#082b45" stroke="none" />
                  <ellipse cx="30" cy="23" rx="1.9" ry="2.3" fill="#082b45" stroke="none" />
                  <rect x="13" y="28" width="22" height="12" rx="6" fill="#c9e9f7" />
                  <path d="M19 33h1m8 0h1m-7 3c1.3 1 2.7 1 4 0" strokeLinecap="round" />
                  <path className="login-cow-hoof login-cow-hoof-left" d="M9 30c-1-2 0-4 2-6l5-4c2-1 5 0 5 2 1 2 0 4-2 5l-5 4c-2 1-4 1-5-1Z" fill="#6b9bb6" />
                  <path className="login-cow-hoof login-cow-hoof-right" d="M39 30c1-2 0-4-2-6l-5-4c-2-1-5 0-5 2-1 2 0 4 2 5l5 4c2 1 4 1 5-1Z" fill="#6b9bb6" />
                </svg>
              </button>
            </div>
          </div>
          <button type="submit" className="login-btn" disabled={locked}>
            {locked ? `Locked — wait ${fmt_t(timeLeft)}` : 'Sign In'}
            {!locked && (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h20m-7-7 7 7-7 7" />
              </svg>
            )}
          </button>
          {err && <div className="login-err" role="alert">{locked ? `Locked. Wait ${fmt_t(timeLeft)}.` : 'Invalid credentials.'}</div>}
        </form>
        <footer className="login-credit"><span>Powered by <strong>Knitworks</strong></span></footer>
      </section>
    </main>
  );
}

const WELCOME_DURATION_MS = 2500;
const WELCOME_MESSAGES = [
  'Preparing your analytics',
  'Loading your dashboard',
  'Getting your reports ready',
  'Opening your workspace',
  'Setting up your dashboard',
];

function getWelcomeGreeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function pickWelcomeMessages() {
  const remaining = [...WELCOME_MESSAGES];
  return Array.from({ length: 3 }, () => {
    const index = Math.floor(Math.random() * remaining.length);
    return remaining.splice(index, 1)[0];
  });
}

function DashboardWelcome({ userName, onComplete }) {
  const [messages] = useState(pickWelcomeMessages);
  const [greeting] = useState(() => getWelcomeGreeting(new Date().getHours()));
  const [step, setStep] = useState(0);
  const displayName = formatDisplayName(userName);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 800),
      setTimeout(() => setStep(2), 1600),
      setTimeout(onComplete, WELCOME_DURATION_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <main className="login-screen" aria-labelledby="welcome-heading">
      <div className="login-scene" aria-hidden="true" />
      <section
        className="login-box welcome-box"
        style={{
          '--welcome-duration': WELCOME_DURATION_MS + 'ms',
          '--welcome-progress': (step + 1) / 3,
        }}
      >
        <div className="login-logo">Business Intelligence</div>
        <h1 className="welcome-heading" id="welcome-heading">
          {greeting}{displayName ? ' ' + displayName : ''}, welcome back.
        </h1>
        <div className="welcome-ring" aria-hidden="true">
          <svg viewBox="0 0 60 60" fill="#73cdec" focusable="false">
            <rect x="2" y="32" width="15" height="25" rx="2" />
            <rect x="22" y="18" width="15" height="39" rx="2" />
            <rect x="42" y="3" width="15" height="54" rx="2" />
          </svg>
        </div>
        <p className="welcome-status" role="status">{messages[step]}</p>
        <div className="welcome-progress" aria-hidden="true"><span /></div>
        <footer className="login-credit"><span>Powered by <strong>Knitworks</strong></span></footer>
      </section>
    </main>
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

function Panel({ title, subtitle, tag, controls, flex, height, style, className, children, defaultView = 'chart', tableHeaders, tableRows, insight, searchableTable, tableInitialQuery, headerExtra, hideToggle }) {
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
  const hasToggle = tableHeaders && tableRows && !hideToggle;
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
      {!hideToggle && expandBtn}
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
  /* Detect if user has applied a specific filter (vs default all-data view) */
  const filterApplied = useWeekly || useYearly || (filter.years?.length > 0);

  /* ── LTM: last 12 months trailing from monthly dataset ───────── */
  const ltmMonths = useMemo(() => monthly.slice(-12), []);
  const ltmRev = ltmMonths.reduce((s, m) => s + m.rev, 0);
  const ltmOrders = ltmMonths.reduce((s, m) => s + m.orders, 0);
  const ltmAvg = ltmMonths.length ? ltmRev / ltmMonths.length : 0;

  /* ── YTD: current calendar year months ───────────────────────── */
  const allYears = [...new Set(monthly.map(m => m.m.split(' ')[1]))].sort();
  const latestYear = allYears[allYears.length - 1] || '26';
  const prevYear = String(parseInt(latestYear, 10) - 1).padStart(2, '0');
  const ytdMonths = monthly.filter(m => m.m.endsWith(latestYear));
  const ytdMonthNames = ytdMonths.map(m => m.m.split(' ')[0]);
  const ytdRev = ytdMonths.reduce((s, m) => s + m.rev, 0);
  const prevYtdRev = monthly.filter(m => m.m.endsWith(prevYear) && ytdMonthNames.includes(m.m.split(' ')[0])).reduce((s, m) => s + m.rev, 0);
  const ytdDelta = prevYtdRev > 0 ? ((ytdRev - prevYtdRev) / prevYtdRev) * 100 : null;

  /* ── Periods: LTM default, filter-specific when applied ──────── */
  const periods = useMemo(() => {
    if (useWeekly) {
      const set = new Set(tickedWeeks);
      return weekly.filter(w => set.has(w.w)).map(w => ({ key: w.w, rev: w.rev, orders: w.orders }));
    }
    if (useYearly) {
      return deriveYearlyFromFilter(filter, fm).map(y => ({ key: y.year, rev: y.rev, orders: y.orders }));
    }
    if (!filterApplied) {
      /* Default: LTM */
      return ltmMonths.map(m => ({ key: m.m, rev: m.rev, orders: m.orders }));
    }
    return fm.map(m => ({ key: m.m, rev: m.rev, orders: m.orders }));
  }, [useWeekly, useYearly, filterApplied, tickedWeeks, fm, filter, ltmMonths]);

  const periodLabel = useWeekly ? 'Week' : useYearly ? 'Year' : 'Month';
  const isLTM = !filterApplied && !useWeekly && !useYearly;

  const totalRev = periods.reduce((s, m) => s + m.rev, 0);
  const totalOrders = periods.reduce((s, m) => s + m.orders, 0);
  const best = periods.length ? periods.reduce((b, c) => c.rev > b.rev ? c : b, periods[0]) : null;

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [showPrevOverlay, setShowPrevOverlay] = useState(false);
  const prevPeriod = useMemo(() => {
    if (useWeekly || useYearly || isLTM) return [];
    if (!fm.length) return [];
    const startIdx = monthly.findIndex(m => m.m === fm[0].m);
    if (startIdx <= 0) return [];
    const from = Math.max(0, startIdx - fm.length);
    return monthly.slice(from, startIdx);
  }, [fm, useWeekly, useYearly, isLTM]);
  const canShowPrev = !useWeekly && !useYearly && prevPeriod.length > 0;
  const prevTotal = prevPeriod.reduce((s, m) => s + m.rev, 0);
  const periodDelta = (canShowPrev && prevTotal) ? ((totalRev - prevTotal) / prevTotal) * 100 : null;

  const granTag = useWeekly ? 'W' : useYearly ? 'Y' : 'M';

  /* ── Main Revenue Bar chart ──────────────────────────────────── */
  const barOpt = withDataZoom(withCrosshair({
    tooltip: { trigger: 'axis', formatter: p => { let html = `<strong>${p[0].name}</strong><br/>`; p.forEach(s => { html += `${s.marker} ${s.seriesName}: ${s.value != null ? fmtFull(s.value) : '—'}<br/>`; }); return html; } },
    legend: showPrevOverlay && canShowPrev ? { bottom: 0, textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect', selectedMode: false } : undefined,
    grid: { left: '3%', right: '4%', bottom: isMobileViewport() && periods.length > 3 ? '28%' : (showPrevOverlay && canShowPrev ? '18%' : '12%'), top: '8%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(d => d.key), axisLabel: catAxisLabel(periods.length, 9) },
    yAxis: { type: 'value', splitNumber: 5, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v), hideOverlap: true }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { name: isLTM ? 'LTM Revenue' : 'Current period', type: 'bar', data: periods.map(d => ({ value: d.rev, itemStyle: { color: selectedMonth && selectedMonth !== d.key ? 'rgba(8,145,178,0.2)' : 'rgba(8,145,178,0.75)', borderRadius: [3, 3, 0, 0] } })), barMaxWidth: 28 },
      ...(showPrevOverlay && canShowPrev ? [{ name: 'Previous period', type: 'line', data: periods.map((_, i) => prevPeriod[i] ? prevPeriod[i].rev : null), smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { color: '#E5A93D', width: 2, type: 'dashed' }, itemStyle: { color: '#E5A93D' } }] : [])
    ]
  }));

  /* ── Cumulative YoY chart (center panel) ─────────────────────── */
  const MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const all25 = monthly.filter(m => m.m.endsWith('25'));
  const all26 = monthly.filter(m => m.m.endsWith('26'));
  const yoyMonths = [...new Set([...all25.map(m => m.m.split(' ')[0]), ...all26.map(m => m.m.split(' ')[0])])].sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
  let cum25 = 0, cum26 = 0;
  const cumData25 = [], cumData26 = [];
  yoyMonths.forEach(mo => {
    const e25 = all25.find(m => m.m.startsWith(mo)); const e26 = all26.find(m => m.m.startsWith(mo));
    if (e25) cum25 += e25.rev; if (e26) cum26 += e26.rev;
    cumData25.push(e25 ? cum25 : null);
    cumData26.push(e26 ? cum26 : null);
  });
  const cumYoYOpt = withCrosshair({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => p.filter(s=>s.value!=null).map(s => `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}`).join('<br/>') },
    legend: { bottom: 4, data: [{ name: '2025', icon: 'path://M0,3 L10,3 L10,9 L0,9 Z M12,3 L22,3 L22,9 L12,9 Z M24,3 L34,3 L34,9 L24,9 Z' }, { name: '2026', icon: 'path://M0,3 L34,3 L34,9 L0,9 Z' }], textStyle: { color: '#5F7078', fontSize: 10 }, selectedMode: false },
    grid: { left: '3%', right: '4%', bottom: '22%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: yoyMonths, axisLabel: catAxisLabel(yoyMonths.length, 9) },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { name: '2025', type: 'line', data: cumData25, smooth: true, symbol: 'none', lineStyle: { color: '#0891B2', width: 2, type: 'dashed' }, itemStyle: { color: '#0891B2' }, areaStyle: { color: 'rgba(8,145,178,.07)' }, connectNulls: false },
      { name: '2026', type: 'line', data: cumData26, smooth: true, symbol: 'none', lineStyle: { color: '#40BCF3', width: 2 }, itemStyle: { color: '#40BCF3' }, areaStyle: { color: 'rgba(64,188,243,.08)' }, connectNulls: false },
    ]
  });

  /* ── Monthly overlay (left bottom panel) ────────────────────── */
  const n25 = all25.map(m => m.m.split(' ')[0]), n26 = all26.map(m => m.m.split(' ')[0]);
  let cMonths = (all25.length && all26.length) ? n25.filter(m => n26.includes(m)) : [...new Set([...n25, ...n26])];
  cMonths.sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
  const lineSeries = [];
  if (all25.length) lineSeries.push({ name: '2025', type: 'line', symbol: 'none', data: cMonths.map(m => all25.find(d => d.m.startsWith(m))?.rev || null), lineStyle: { color: '#0891B2', width: 2, type: 'dashed' }, itemStyle: { color: '#0891B2' }, areaStyle: { color: 'rgba(8,145,178,.07)' }, smooth: true });
  if (all26.length) lineSeries.push({ name: '2026', type: 'line', symbol: 'none', data: cMonths.map(m => all26.find(d => d.m.startsWith(m))?.rev || null), lineStyle: { color: '#73D4F2', width: 2 }, itemStyle: { color: '#73D4F2' }, areaStyle: { color: 'rgba(115,212,242,.07)' }, smooth: true });
  const cmpOpt = withDataZoom(withCrosshair({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => p.filter(s=>s.value!=null).map(s => `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}`).join('<br/>') },
    legend: { bottom: 4, data: [{ name: '2025', icon: 'path://M0,3 L10,3 L10,9 L0,9 Z M12,3 L22,3 L22,9 L12,9 Z M24,3 L34,3 L34,9 L24,9 Z' }, { name: '2026', icon: 'path://M0,3 L34,3 L34,9 L0,9 Z' }], textStyle: { color: '#5F7078', fontSize: 10 }, selectedMode: false },
    grid: { left: '3%', right: '4%', bottom: isMobileViewport() && cMonths.length > 3 ? '28%' : '26%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: cMonths, axisLabel: catAxisLabel(cMonths.length, 9) },
    yAxis: { type: 'value', splitNumber: 5, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v), hideOverlap: true }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: lineSeries
  }));

  /* ── Order Volume chart ──────────────────────────────────────── */
  const ordersOpt = withDataZoom(withCrosshair({
    tooltip: { trigger: 'axis', formatter: p => `<strong>${p[0].name}</strong><br/>Orders: ${fmtN(p[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: isMobileViewport() && periods.length > 3 ? '28%' : '12%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(d => d.key), axisLabel: catAxisLabel(periods.length, 9), axisLine: { lineStyle: { color: '#DDE6E9' } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmtN(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ type: 'line', data: periods.map(d => d.orders), step: 'middle', symbol: 'circle', symbolSize: (val, params) => { const m = periods[params.dataIndex]?.key; return selectedMonth && selectedMonth === m ? 8 : 5; }, lineStyle: { color: '#0369A1', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(3,105,161,.18)' }, { offset: 1, color: 'rgba(3,105,161,.01)' }] } }, itemStyle: { color: '#0369A1', borderColor: '#fff', borderWidth: 1.5 }, emphasis: { itemStyle: { color: '#0369A1' } } }]
  }, fmtN));

  const prevToggleControl = (
    <button className={`cmp-toggle${showPrevOverlay ? ' active' : ''}`} onClick={() => setShowPrevOverlay(v => !v)} disabled={!canShowPrev}>
      ↔ {showPrevOverlay ? 'Hide' : 'vs'} Previous period
    </button>
  );
  const revenueInsight = (() => { const parts = []; if (periodDelta != null) parts.push(`Revenue ${periodDelta >= 0 ? 'up' : 'down'} ${Math.abs(periodDelta).toFixed(1)}% vs the previous period`); if (best) parts.push(`Best ${periodLabel.toLowerCase()}: ${best.key} (${fmtFull(best.rev)})`); return parts.length ? parts.join(' · ') : null; })();

  const barTbl = { headers: [periodLabel, 'Revenue', 'Orders', 'Avg Order Value'], rows: periods.map(m => [m.key, fmtFull(m.rev), fmtN(m.orders), fmtFull(Math.round(m.rev / (m.orders || 1)))]) };
  const ordTbl = { headers: [periodLabel, 'Orders'], rows: periods.map(m => [m.key, fmtN(m.orders)]) };
  const handleMonthClick = (p) => { const month = periods[p.dataIndex]?.key; setSelectedMonth(selectedMonth === month ? null : month); };

  return (
    <div className="page-area" key="revenue">
      <KpiNote/>
      <div className="kpi-strip">
        <div className="kpi-card blue">
          <div className="kpi-lbl">Turnover YTD ({latestYear.startsWith('2') ? latestYear : '20'+latestYear})</div>
          <div className="kpi-val sm">{fmtFull(ytdRev)}</div>
          <div className="kpi-chg">
            {ytdDelta != null ? (
              <span className={`kpi-trend ${ytdDelta >= 0 ? 'up' : 'down'}`}>{ytdDelta >= 0 ? '▲' : '▼'} {Math.abs(ytdDelta).toFixed(1)}% vs {prevYear.startsWith('2') ? prevYear : '20'+prevYear}</span>
            ) : null}
            <span>{ytdMonths.length}m · vs same period prior year</span>
          </div>
        </div>
        <div className="kpi-card teal">
          <div className="kpi-lbl">Last 12 Months (LTM)</div>
          <div className="kpi-val sm">{fmtFull(ltmRev)}</div>
          <div className="kpi-chg">{fmtN(ltmOrders)} transactions · trailing 12m</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-lbl">Best {periodLabel} {isLTM ? '(LTM)' : `(${label})`}</div>
          <div className="kpi-val sm">{best ? best.key : '—'}</div>
          <div className="kpi-chg">{best ? fmtFull(best.rev) : ''}</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-lbl">Avg / Month (LTM)</div>
          <div className="kpi-val sm">{fmtFull(ltmAvg)}</div>
          <div className="kpi-chg">12-month trailing average</div>
        </div>
      </div>
      {/* Layout: 4-col grid matching KPI strip — 50% | 25% | 25% */}
      <div className="charts-row" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gridTemplateRows:'1fr 1fr',alignItems:'stretch'}}>
        <Panel title={isLTM ? 'Revenue — Last 12 Months' : 'Revenue Over Time'} subtitle={isLTM ? `LTM · ${periods.length} months · ${ltmMonths[0]?.m} → ${ltmMonths[ltmMonths.length-1]?.m}` : `${label} · ${periods.length} ${periodLabel.toLowerCase()}${periods.length===1?'':'s'}`} tag={isLTM ? 'LTM' : `${periods.length}${granTag}`} flex={1} controls={!isLTM?prevToggleControl:undefined} tableHeaders={barTbl.headers} tableRows={barTbl.rows} insight={revenueInsight} style={{gridColumn:'1/span 2',gridRow:'1',minWidth:0}}><EC option={barOpt} onEvents={{ 'click': handleMonthClick }}/></Panel>
        <Panel title="2025 vs 2026 Monthly" subtitle="Same-month comparison" flex={1} style={{gridColumn:'1/span 2',gridRow:'2',minWidth:0}}><EC option={cmpOpt}/></Panel>
        <Panel title="Cumulative Revenue YoY" subtitle="Running total by calendar month" flex={1} style={{gridColumn:'3',gridRow:'1/span 2',minWidth:0}}><EC option={cumYoYOpt}/></Panel>
        <Panel title="Order Volume" subtitle={`Per ${periodLabel.toLowerCase()}${isLTM?' · LTM':''}`} flex={1} style={{gridColumn:'4',gridRow:'1/span 2',minWidth:0}} tableHeaders={ordTbl.headers} tableRows={ordTbl.rows}><EC option={ordersOpt} onEvents={{ 'click': handleMonthClick }}/></Panel>
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
];
const PAGE_NAMES={overview:'Overview Dashboard',revenue:'Revenue Trends',salesreps:'Verkoper',customers:'Top Customers',products:'Product Analysis',categories:'Category Breakdown',channels:'Channel Mix',plsummary:'P&L Summary',finrevcosts:'Revenue & Costs',finledger:'Ledger'};

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
  const [showWelcome,setShowWelcome]=useState(false);
  const finishWelcome=useCallback(()=>setShowWelcome(false),[]);
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
    if(!authed||showWelcome)return;
    const delays=[50,150,350,600,1000];
    const timers=delays.map(ms=>setTimeout(resizeAllCharts,ms));
    window.addEventListener('resize',resizeAllCharts);
    window.addEventListener('orientationchange',resizeAllCharts);
    return()=>{
      timers.forEach(clearTimeout);
      window.removeEventListener('resize',resizeAllCharts);
      window.removeEventListener('orientationchange',resizeAllCharts);
    };
  },[authed,showWelcome,resizeAllCharts]);
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

  const handleLogin=(username)=>{setShowWelcome(true);setAuthed(true);localStorage.setItem(AUTH_KEY,'true');localStorage.setItem(AUTH_ACTIVITY_KEY,Date.now().toString());setUserName(username||'');try{localStorage.setItem(AUTH_USER_KEY,username||'');}catch{}};
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

  if(showWelcome)return(<><style>{css}</style><DashboardWelcome userName={userName} onComplete={finishWelcome}/></>);

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

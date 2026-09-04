import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import ReactECharts from "echarts-for-react";
import * as XLSX from 'xlsx';
import ChatBot from './ChatBot.jsx';

// Import all data from data.js
import { 
  monthly, 
  salesreps as salesrepsRaw,
  categories as categoriesRaw,
  customers as customersRaw,
  products as productsRaw,
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

/* Turns a login username like "Jan.spiker" or "Joahan.dairytop" into a
   friendly first name ("Jan", "Joahan") for greetings in the topbar and
   chatbot. Falls back gracefully for the generic/shared accounts. */
function formatDisplayName(username) {
  if (!username) return '';
  const first = username.split(/[.\s_-]+/)[0];
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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

/* Crosshair + axis marker option builder */
function withCrosshair(option, yFormatter = fmt) {
  return {
    ...option,
    tooltip: {
      ...option.tooltip,
      ...TOOLTIP_STYLE,
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
            if (p.axisDimension === 'y') {
              return yFormatter(p.value);
            }
            return p.value;
          }
        },
      },
    },
  };
}

/* DataZoom for touchpad zoom (no visual controls) */
function withDataZoom(option) {
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

/* ── APP SHELL ── */
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

/* ── SIDEBAR ── */
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
.nav-icon{font-size:13px;width:16px;text-align:center;flex-shrink:0;opacity:.75;transition:transform .15s ease-out;}
.nav-item.hovered .nav-icon{transform:scale(1.12);opacity:1;}
.nav-pip{margin-left:auto;width:5px;height:5px;border-radius:50%;background:var(--accent);opacity:.8;}
.sidebar.collapsed .nav-item{justify-content:center;padding:11px 0;gap:0;}
.sidebar.collapsed .nav-icon{font-size:16px;width:auto;}
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

/* ── TOPBAR ── */
.topbar{
  height:var(--topbar-h);background:var(--surface);
  border-bottom:var(--hairline);padding:0 20px;
  margin:0;border-radius:0;
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;gap:12px;
  box-shadow:none;
  transition:margin .32s cubic-bezier(.34,1.3,.44,1),border-radius .32s cubic-bezier(.34,1.3,.44,1);
}
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

/* ── DATE FILTER BAR ── */
.filter-bar{
  height:var(--filter-h);background:var(--surface);border-bottom:1px solid var(--border);
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

/* ── PAGE CONTENT AREA ── */
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

/* ── KPI STRIP ── */
.kpi-strip{display:flex;gap:10px;flex-shrink:0;}
.kpi-card{
  flex:1;min-width:0;background:var(--surface);
  border:var(--hairline);border-left:2.5px solid var(--kpi-accent,var(--accent));border-radius:var(--r-sm);
  padding:11px 14px;position:relative;overflow:hidden;
  box-shadow:none;transition:background .16s,border-color .16s;
}
.kpi-card:hover{background:var(--surface3);border-color:var(--border2);border-left-color:var(--kpi-accent,var(--accent));}
.kpi-card.blue{--kpi-accent:var(--accent);}
.kpi-card.teal{--kpi-accent:var(--accent2);}
.kpi-card.navy{--kpi-accent:var(--accent3);}
.kpi-card.green{--kpi-accent:var(--green);}
.kpi-card.amber{--kpi-accent:var(--amber);}
.kpi-card.sky{--kpi-accent:#63C4EE;}
.kpi-card.red{--kpi-accent:var(--red);}
.kpi-icon{position:absolute;right:10px;top:10px;font-size:16px;opacity:.3;}
.kpi-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:5px;position:relative;}
.kpi-val{font-size:17px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1;color:var(--text);word-break:break-all;position:relative;letter-spacing:-.2px;}
.kpi-val.sm{font-size:13px;}
.kpi-chg{font-size:9.5px;color:var(--muted);margin-top:5px;font-weight:500;position:relative;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.kpi-trend{display:inline-flex;align-items:center;gap:2px;font-weight:800;font-size:9.5px;padding:1px 6px 1px 5px;border-radius:20px;font-family:'JetBrains Mono',monospace;}
.kpi-trend.up{color:#1C7A46;background:rgba(46,155,98,0.12);}
.kpi-trend.down{color:#B23D3D;background:rgba(217,92,92,0.12);}
.kpi-spark{position:absolute;right:12px;bottom:10px;opacity:.85;pointer-events:none;}

/* ── CHART AREA ── */
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

/* ── LOGIN ── */
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

/* ── SECTION TITLE ── */
.sec-title{font-size:10px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:7px;text-transform:uppercase;letter-spacing:.09em;flex-shrink:0;margin-bottom:4px;}
.sec-dot{width:6px;height:6px;border-radius:50%;background:#8FD5F5;border:2px solid var(--accent);flex-shrink:0;}

/* ── SCROLLBAR ── */
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:#C7D5D9;border-radius:2px;}

/* ── PAGE TRANSITION ── */
.page-area{animation:fadeIn .22s cubic-bezier(.4,0,.2,1);}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}

/* ── DONUT LEGEND ── */
.donut-legend-wrapper{overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:4px 0;margin-top:4px;scrollbar-width:thin;}
.donut-legend-wrapper::-webkit-scrollbar{height:3px;}
.donut-legend-wrapper::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

/* ── FINANCE PAGES ── */
.page-area.fin-scroll{overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;}
.page-area.fin-scroll .charts-row{flex:none;}
.page-area.fin-scroll .chart-panel{min-height:300px !important;}
.page-area.fin-scroll .kpi-strip{flex-shrink:0;}
.page-area.fin-scroll .chart-panel.hug{flex:none !important;min-height:0 !important;height:auto !important;}
.page-area.fin-scroll .chart-panel.hug .cp-body{flex:none !important;}
.page-area.fin-scroll .chart-panel.ledger-fixed{min-height:0 !important;}
.page-area.fin-scroll .chart-panel.fin-fixed{min-height:0 !important;height:var(--fin-fixed-h) !important;}

/* ── FINANCE COMPONENTS ── */
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

/* ── MOBILE TOGGLE ── */
.mob-toggle{display:none;position:fixed;top:12px;left:12px;z-index:300;width:38px;height:38px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);cursor:pointer;font-size:15px;color:var(--accent3);box-shadow:var(--shadow-md);align-items:center;justify-content:center;}
.mob-overlay{display:none;position:fixed;inset:0;background:rgba(31,55,65,.5);z-index:200;backdrop-filter:blur(2px);}

/* ── TABLET 901-1200 ── */
@media(max-width:1200px) and (min-width:901px){
  :root{--sidebar-w:190px;}
  .page-area{padding:10px 12px;gap:8px;}
  .kpi-val{font-size:14px;}
  .kpi-val.sm{font-size:12px;}
  .chart-panel{padding:10px 12px;}
  .cp-title{font-size:11px;}
}

/* ── MOBILE ≤900px: sidebar becomes drawer, everything stacks ── */
@media(max-width:900px){
  html,body,#root{height:auto;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;}
  .app{height:auto;min-height:100vh;min-height:100dvh;overflow:visible;}
  .main{overflow:visible;min-height:0;}

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
  .sidebar.collapsed ~ .main .topbar{position:sticky;top:0;z-index:60;margin:0;border-radius:0;border:none;border-bottom:1px solid var(--border);padding-left:56px;padding-right:12px;height:auto;min-height:var(--topbar-h);flex-wrap:wrap;box-shadow:none;background:var(--surface);}
  .tb-title{font-size:13px;}
  .tb-sub{font-size:9px;flex-wrap:wrap;}
  .tb-right .tb-time{font-size:9px;}
  .tb-right .live-badge{font-size:8px;padding:2px 6px;}
  .tb-right{flex-wrap:wrap;gap:6px;row-gap:6px;}
  .tb-search input{width:120px;font-size:10px;}
  .tb-search input:focus{width:150px;}
  .tb-refresh{display:none;}
  .tb-print-btn{padding:5px 8px;font-size:9px;}

  .filter-bar,
  .sidebar.collapsed ~ .main .filter-bar{position:sticky;top:var(--topbar-h);z-index:55;height:auto;padding:6px 12px;flex-wrap:nowrap;gap:6px;margin:0;border-radius:0;box-shadow:none;background:var(--surface);}
  .filter-chips{gap:5px;}
  .filter-chip{font-size:9px;padding:3px 8px;min-height:auto;}
  .filter-label{font-size:9px;}
  .filter-meta{display:none;}
  .filter-clear{padding:4px 8px;font-size:8px;}

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

.tb-print-btn,
.tb-time,
.live-badge {
  display: none !important;
}

.tb-search input {
  width: 100px !important;
}
.tb-search input:focus {
  width: 130px !important;
}

.filter-bar,
.sidebar.collapsed ~ .main .filter-bar {
  position: relative !important;
  top: auto !important;
  z-index: 50;
  padding: 6px 12px;
}

.page-area,
.sidebar.collapsed ~ .main .page-area {
  padding: 12px !important;
}

.kpi-strip {
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.kpi-card {
  padding: 8px 10px;
}
.kpi-val.sm {
  font-size: 12px;
}
.kpi-chg {
  font-size: 8px;
}
}

@media(max-width:480px){
  .kpi-strip{grid-template-columns:repeat(2,1fr);gap:5px;}
  .topbar{padding-left:50px;}
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

/* ── ADDITIVE ENHANCEMENTS ── */
.itbl thead th{position:sticky;top:0;z-index:2;box-shadow:0 1px 0 var(--border);}

.cp-insight{
  display:flex;align-items:center;gap:7px;flex-shrink:0;
  font-size:10.5px;color:#1B5E82;font-weight:600;
  background:var(--surface3);
  border:var(--hairline);border-left:2.5px solid var(--accent);
  border-radius:var(--r-sm);padding:6px 10px;margin-bottom:7px;line-height:1.4;
}
.cp-insight-icon{flex-shrink:0;opacity:.9;font-size:11px;}

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
    
    const valid = (u === 'knitworks' && p === 'knitworks') || 
                  (u === 'admin' && p === '1234') ||
                  (u === 'Jan.spiker' && p === 'Janspiker@123') || 
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
          src="/favicon.png" 
          alt="DairyTop Logo" 
          style={{
            position: 'absolute',
            top: '45px',
            right: '24px',
            width: '62px',
            height: '62px',
          }}
        />
        
        <div className="login-logo">▸ Business Intelligence</div>
        <div className="login-title">Dashboard</div>
        <div className="login-sub">Sign in to access your analytics</div>
        
        {locked && (
          <div style={{ 
            background: '#ffebee', 
            padding: '8px 12px', 
            borderRadius: '4px', 
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#c62828', fontSize: '12px' }}>
              🔒 Locked for {fmt_t(timeLeft)}
            </span>
            <button 
              onClick={clearLockout}
              style={{
                padding: '4px 12px',
                background: '#d32f2f',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px'
              }}
            >
              Clear Lockout (Dev)
            </button>
          </div>
        )}
        
        <form onSubmit={handle}>
          <div className="field">
            <label>Username</label>
            <input 
              type="text" 
              value={u} 
              onChange={e=>{setU(e.target.value);setErr(false);}} 
              placeholder="Enter username" 
              disabled={locked}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input 
              type="password" 
              value={p} 
              onChange={e=>{setP(e.target.value);setErr(false);}} 
              placeholder="Enter password" 
              disabled={locked}
            />
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

/* Inline sortable table. */
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
          <input
            type="text"
            placeholder="Search this table…"
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="Search table"
          />
          {q.trim() && <span className="tbl-search-count">{sorted.length}/{rows.length}</span>}
        </div>
      )}
      <div style={{flex:1, minHeight:0, overflow:'auto'}}>
      <table className="itbl">
        <thead><tr>{headers.map((h,i) => <th key={i} onClick={()=>handleSort(i)}>{h} <span style={{opacity:.5,fontSize:8}}>{sc===i?(sd==='asc'?'↑':'↓'):'⇅'}</span></th>)}</tr></thead>
        <tbody>{sorted.map((row,ri) => {
          return (
            <tr key={ri}>
              {row.map((cell,ci) => {
                if (ci === 0 && (headers[0] === '#' || typeof cell === 'number' || /^\d+$/.test(String(cell)))) {
                  return <td key={ci}><span className={`rank ${ri===0?'r1':ri===1?'r2':ri===2?'r3':'rn'}`}>{cell}</span></td>;
                }
                return <td key={ci}>{cell}</td>;
              })}
            </tr>
          );
        })}</tbody>
      </table>
      </div>
    </div>
  );
}

/* Chart panel wrapper. */
function Panel({ title, subtitle, tag, controls, flex, height, style, className, children, defaultView = 'chart', tableHeaders, tableRows, insight, searchableTable, tableInitialQuery }) {
  const [view, setView] = useState(defaultView);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 260);
    return () => clearTimeout(t);
  }, []);
  const hasToggle = tableHeaders && tableRows;
  const panelStyle = { ...(height != null ? { flex: '0 0 auto', height } : flex ? { flex } : {}), ...style };
  const fixedVars = height != null ? { '--fin-fixed-h': typeof height === 'number' ? `${height}px` : height } : undefined;

  return (
    <div
      className={`chart-panel${className ? ' ' + className : ''}`}
      style={{ ...panelStyle, ...(fixedVars || {}) }}
    >
      <div className="cp-head">
        <div>
          <div className="cp-title">{title}</div>
          {subtitle && <div className="cp-sub">{subtitle}</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,flexWrap:'wrap'}}>
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
        </div>
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
  );
}

const liveChartInstances = new Set();

function EC({ option, onEvents }) {
  const instRef = useRef(null);
  const handleReady = (inst) => {
    instRef.current = inst;
    liveChartInstances.add(inst);
  };
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
  a.href = url;
  a.download = filename.replace(/\.xlsx$/i, '.csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function ExportExcelButton({ filename, headers, rows }) {
  const handleExport = () => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, filename);
  };
  return (
    <span style={{display:'inline-flex',gap:5}}>
      <button className="panel-btn" onClick={handleExport} title="Export to Excel">
        ⬇ Excel
      </button>
      <button
        className="panel-btn"
        style={{color:'var(--accent2)',background:'rgba(64,188,243,0.08)',borderColor:'rgba(64,188,243,0.25)'}}
        onClick={() => downloadCSV(filename, headers, rows)}
        title="Export to CSV"
      >
        ⬇ CSV
      </button>
    </span>
  );
}

/* ── DATE FILTER ─────────────────────────────────────────────── */
function DateFilterBar({ filter, setFilter }) {
  const years = [...new Set(monthly.map(m => m.m.split(' ')[1]))].sort();
  const [expandedYear, setExpandedYear] = useState(null);
  const popRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { 
      if (popRef.current && !popRef.current.contains(e.target)) {
        setExpandedYear(null); 
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleYear = (yr) => {
    const newYears = filter.years.includes(yr) ? filter.years.filter(y=>y!==yr) : [...filter.years,yr];
    const newMonths = {...filter.months};
    if (!newYears.includes(yr)) delete newMonths[yr];
    setFilter({years:newYears,months:newMonths});
  };

  const toggleMonth = (yr, m) => {
    const ym = filter.months[yr] || [];
    const newYm = ym.includes(m) ? ym.filter(x=>x!==m) : [...ym,m];
    setFilter({...filter,months:{...filter.months,[yr]:newYm}});
  };

  const selectAllMonths = (yr) => {
    const allMonths = monthly.filter(m => m.m.includes(yr)).map(m => m.m);
    setFilter({...filter, months:{...filter.months,[yr]:allMonths}});
  };

  const clearMonths = (yr) => {
    setFilter({...filter, months:{...filter.months,[yr]:[]}});
  };

  return (
    <div 
      className="filter-bar" 
      ref={popRef}
      style={{ 
        position: 'relative',
        overflow: 'visible',
        zIndex: 100
      }}
    >
      <span className="filter-label">🔍 Filter</span>
      <div 
        className="filter-chips" 
        style={{ 
          display: 'flex', 
          gap: '6px', 
          flexWrap: 'nowrap', 
          alignItems: 'center', 
          overflow: 'visible',
          padding: '4px 0',
          flex: 1,
          minWidth: 0,
          position: 'relative'
        }}
      >
        {years.map(yr => {
          const active = filter.years.includes(yr);
          const mc = (filter.months[yr]||[]).length;
          const isExpanded = expandedYear === yr;
          
          return (
            <div 
              key={yr} 
              style={{ 
                position: 'relative', 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: 3,
                zIndex: isExpanded ? 9999 : 1
              }}
            >
              <button
                className={`filter-chip${active?' active':''}`}
                onClick={() => toggleYear(yr)}
                style={{ whiteSpace: 'nowrap' }}
              >
                {active ? '☑' : '☐'} 20{yr}{active && mc > 0 ? ` (${mc}m)` : ''}
              </button>
              {active && (
                <button
                  style={{
                    padding: '2px 5px',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'var(--surface3)',
                    cursor: 'pointer',
                    fontSize: 9,
                    color: 'var(--muted)',
                    flexShrink: 0
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedYear(isExpanded ? null : yr);
                  }}
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
              )}
              {isExpanded && (
                <div 
                  style={{
                    position: 'fixed',
                    top: 'auto',
                    left: 'auto',
                    marginTop: '4px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 10,
                    zIndex: 99999,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                    minWidth: 220,
                    maxWidth: 320,
                    maxHeight: 350,
                    overflowY: 'auto',
                    transform: 'translateY(4px)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                  ref={(el) => {
                    if (el) {
                      const rect = el.parentElement.getBoundingClientRect();
                      el.style.top = (rect.bottom + window.scrollY + 4) + 'px';
                      el.style.left = (rect.left + window.scrollX) + 'px';
                    }
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button 
                      onClick={() => selectAllMonths(yr)} 
                      style={{
                        padding: '3px 10px',
                        border: '1px solid var(--accent)',
                        borderRadius: 4,
                        background: 'rgba(64,188,243,0.08)',
                        color: 'var(--accent2)',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: 'inherit'
                      }}
                    >
                      Select All
                    </button>
                    <button 
                      onClick={() => clearMonths(yr)} 
                      style={{
                        padding: '3px 10px',
                        border: '1px solid var(--muted)',
                        borderRadius: 4,
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontFamily: 'inherit'
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr', 
                    gap: 2,
                    maxHeight: 200,
                    overflowY: 'auto'
                  }}>
                    {monthly.filter(m => m.m.includes(yr)).map(({m}) => {
                      const sel = (filter.months[yr]||[]).includes(m);
                      return (
                        <label 
                          key={m} 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 6px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            background: sel ? 'rgba(64,188,243,.08)' : 'transparent',
                            fontSize: 10,
                            fontFamily: 'inherit',
                            transition: 'background .14s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = sel ? 'rgba(64,188,243,.15)' : 'rgba(64,188,243,.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = sel ? 'rgba(64,188,243,.08)' : 'transparent'}
                        >
                          <input 
                            type="checkbox" 
                            checked={sel} 
                            onChange={() => toggleMonth(yr, m)} 
                            style={{
                              width: 12,
                              height: 12,
                              cursor: 'pointer',
                              accentColor: 'var(--accent)',
                              flexShrink: 0
                            }}
                          />
                          <span style={{ whiteSpace: 'nowrap' }}>{m}</span>
                        </label>
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
            <button 
              className="filter-clear" 
              onClick={() => setFilter({years:[],months:{}})}
              style={{ flexShrink: 0 }}
            >
              ✕ Clear
            </button>
          </>
        )}
      </div>
      <div className="filter-meta">
        <div className="filter-meta-row">Last update: <strong>{lastUpdated}</strong></div>
        <div className="filter-meta-row">Last invoice: <strong>{maxFactuurDatum}</strong></div>
      </div>
    </div>
  );
}

/* ── PAGES ───────────────────────────────────────────────────── */

function Overview() {
  const orderIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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

  const repsCurrentMonth = useMemo(() => {
    const g = {};
    salesrepsRaw.filter(r => r.m === currentMonth).forEach(r => {
      const k = r.n.trim();
      if (!g[k]) g[k] = { n: k, rev: 0, qty: 0, orders: 0 };
      g[k].rev += r.rev; g[k].qty += r.qty; g[k].orders += r.orders;
    });
    return Object.values(g).sort((a, b) => b.rev - a.rev);
  }, [currentMonth]);

  const cmpOpt = withDataZoom({
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: function (params) {
        let html = `<strong>${params[0].name}</strong><br/>`;
        params.forEach(p => {
          const val = p.value;
          html += `${p.marker} ${p.seriesName}: ${val != null ? fmtFull(val) : '—'}<br/>`;
        });
        return html;
      }
    },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect', selectedMode: false },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '5%', containLabel: true },
    xAxis: { type: 'category', data: last3WithPY.map(d => d.name), axisLabel: { color: '#5F7078', fontSize: 9 } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { name: 'Last Year', type: 'bar', data: last3WithPY.map(d => d.py), itemStyle: { color: '#0891B2', borderRadius: [3,3,0,0] }, barGap: '0%', barCategoryGap: '30%' },
      { name: 'This Year', type: 'bar', data: last3WithPY.map(d => d.cy), itemStyle: { color: '#73D4F2', borderRadius: [3,3,0,0] }, barGap: '0%', barCategoryGap: '30%' },
    ]
  });

  const catBarOpt = withDataZoom({
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)} (${catsTotalRev > 0 ? (p[0].value / catsTotalRev * 100).toFixed(1).replace('.', ',') : 0}%)`
    },
    grid: { left: '3%', right: '4%', bottom: '22%', top: '5%', containLabel: true },
    xAxis: {
      type: 'category',
      data: cats.map(c => c.n.length > 12 ? c.n.slice(0, 12) + '…' : c.n),
      axisLabel: { color: '#5F7078', fontSize: 8, interval: 0, rotate: 30 }
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{
      type: 'bar',
      data: cats.map((c, i) => ({ value: c.rev, itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [3,3,0,0] } })),
      barMaxWidth: 30
    }]
  });

  const repOpt = withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}` },
    grid: { left: '2%', right: '6%', bottom: '12%', top: '5%', containLabel: true },
    xAxis: { type: 'value', min: 0, minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    yAxis: { type: 'category', data: repsCurrentMonth.map(d => d.n.split(' ')[0]), axisLabel: { color: '#5F7078', fontSize: 9 }, inverse: true },
    legend: { show: false },
    series: [{
      type: 'bar',
      data: repsCurrentMonth.map((d, i) => ({ value: d.rev, itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0,3,3,0] } })),
      barMaxWidth: 22
    }]
  });

  const cmpTable = { headers: ['Month', 'This Year', 'Last Year'], rows: last3WithPY.map(d => [d.cyLabel, fmtFull(d.cy), d.py != null ? fmtFull(d.py) : '—']) };
  const catTable = { headers: ['Category', 'Revenue', 'Share'], rows: cats.map(d => [d.n, fmtFull(d.rev), catsTotalRev > 0 ? (d.rev / catsTotalRev * 100).toFixed(1).replace('.', ',') + '%' : '—']) };
  const repTable = { headers: ['#', 'Verkoper', 'Revenue', 'Orders'], rows: repsCurrentMonth.map((d, i) => [i + 1, d.n, fmtFull(d.rev), fmtN(d.orders)]) };

  const catSplitInsight = cats.length
    ? `${cats[0].n} leads with ${catsTotalRev > 0 ? (cats[0].rev / catsTotalRev * 100).toFixed(0) : 0}% share${cats.length > 1 ? ` · ${cats.length} categories active over this window` : ''}`
    : null;

  const momDelta = last3.length >= 2 && last3[last3.length - 2].rev
    ? ((last3[last3.length - 1].rev - last3[last3.length - 2].rev) / last3[last3.length - 2].rev) * 100
    : null;
  const turnoverInsight = momDelta != null
    ? `Revenue ${momDelta >= 0 ? 'up' : 'down'} ${Math.abs(momDelta).toFixed(1)}% vs last month${cats[0] ? ` · Top category: ${cats[0].n} (${catsTotalRev > 0 ? (cats[0].rev / catsTotalRev * 100).toFixed(0) : 0}% of last 3 months)` : ''}`
    : null;
  const repInsight = repsCurrentMonth[0]
    ? `Leading this month: ${repsCurrentMonth[0].n} with ${fmtFull(repsCurrentMonth[0].rev)}${repsCurrentMonth.length > 1 ? ` (${(repsCurrentMonth[0].rev / repsCurrentMonth.reduce((s,r)=>s+r.rev,0) * 100).toFixed(0)}% of this month's revenue)` : ''}`
    : null;

  return (
    <div className="page-area" key="overview">
      <div className="kpi-strip">
        <div className="kpi-card green">
          <div className="kpi-lbl">Turnover MTD</div>
          <div className="kpi-val sm">{fmtFull(turnoverMTD)}</div>
          <div className="kpi-chg">Revenue this month, to date</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-lbl">Projected MTD</div>
          <div className="kpi-val sm">{fmtFull(projectedMTD)}</div>
          <div className="kpi-chg">Open MTD + Revenue MTD</div>
        </div>
        <div className="kpi-card blue">
          <div className="kpi-lbl">Open Orders (Future)</div>
          <div className="kpi-val sm">{fmtFull(openOrderValueFuture)}</div>
          <div className="kpi-chg">Due after today</div>
        </div>
        <div className="kpi-card sky">
          <div className="kpi-lbl">Open Value MTD</div>
          <div className="kpi-val sm">{fmtFull(openOrderValueMTD)}</div>
          <div className="kpi-chg">Open orders due this month</div>
        </div>
        <div className="kpi-card teal">
          <div className="kpi-lbl">Open Value (Full)</div>
          <div className="kpi-val sm">{fmtFull(openOrderValuePresent)}</div>
          <div className="kpi-chg">All open orders due today or earlier</div>
        </div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1.4}}>
          <Panel title="Turnover — Last 3 Months" subtitle={`This year vs last year · through ${currentMonth || '—'}`} flex={1} tableHeaders={cmpTable.headers} tableRows={cmpTable.rows} insight={turnoverInsight}>
            <EC option={cmpOpt}/>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Category Split" subtitle={`Last 3 months · through ${currentMonth || '—'}`} flex={1} tableHeaders={catTable.headers} tableRows={catTable.rows} insight={catSplitInsight}>
            <EC option={catBarOpt} />
          </Panel>
        </div>
      </div>
      <div className="charts-row" style={{flex:0.8}}>
        <Panel title="Verkoper Prestaties" subtitle={`Actual month · ${currentMonth || '—'}`} flex={1} tableHeaders={repTable.headers} tableRows={repTable.rows} insight={repInsight}>
          <EC option={repOpt} />
        </Panel>
      </div>
    </div>
  );
}


function Revenue({ fm, label }) {
  const totalRev = fm.reduce((s,m)=>s+m.rev,0);
  const totalOrders = fm.reduce((s,m)=>s+m.orders,0);
  const best = fm.length?fm.reduce((b,c)=>c.rev>b.rev?c:b,fm[0]):null;
  const avg = fm.length?totalRev/fm.length:0;

  const [selectedMonth, setSelectedMonth] = useState(null);

  const [showPrevOverlay, setShowPrevOverlay] = useState(false);
  const prevPeriod = useMemo(() => {
    if (!fm.length) return [];
    const startIdx = monthly.findIndex(m => m.m === fm[0].m);
    if (startIdx <= 0) return [];
    const from = Math.max(0, startIdx - fm.length);
    return monthly.slice(from, startIdx);
  }, [fm]);
  const canShowPrev = prevPeriod.length > 0;
  const prevTotal = prevPeriod.reduce((s,m)=>s+m.rev,0);
  const periodDelta = (canShowPrev && prevTotal) ? ((totalRev - prevTotal) / prevTotal) * 100 : null;

  const barOpt = withDataZoom(withCrosshair({
    tooltip:{
      trigger:'axis',
      formatter:p=>{
        let html = `<strong>${p[0].name}</strong><br/>`;
        p.forEach(s => { html += `${s.marker} ${s.seriesName}: ${s.value != null ? fmtFull(s.value) : '—'}<br/>`; });
        return html;
      }
    },
    legend: showPrevOverlay && canShowPrev ? { bottom: 0, textStyle:{color:'#5F7078',fontSize:10}, icon:'roundRect', selectedMode:false } : undefined,
    grid:{left:'3%',right:'4%',bottom: showPrevOverlay && canShowPrev ? '18%' : '12%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:fm.map(d=>d.m),axisLabel:{color:'#5F7078',fontSize:9}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:[
      {
        name: 'Current period',
        type:'bar',
        data:fm.map(d => ({
          value: d.rev,
          itemStyle: {
            color: selectedMonth && selectedMonth !== d.m ? 'rgba(8,145,178,0.2)' : 'rgba(8,145,178,0.75)',
            borderRadius: [3,3,0,0]
          }
        })),
        barMaxWidth:28
      },
      ...(showPrevOverlay && canShowPrev ? [{
        name: 'Previous period',
        type: 'line',
        data: fm.map((_, i) => prevPeriod[i] ? prevPeriod[i].rev : null),
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#E5A93D', width: 2, type: 'dashed' },
        itemStyle: { color: '#E5A93D' }
      }] : [])
    ]
  }));

  const prevToggleControl = (
    <button
      className={`cmp-toggle${showPrevOverlay ? ' active' : ''}`}
      onClick={() => setShowPrevOverlay(v => !v)}
      disabled={!canShowPrev}
      title={canShowPrev ? 'Overlay the previous equal-length period' : 'No earlier data available to compare'}
    >
      ↔ {showPrevOverlay ? 'Hide' : 'vs'} Previous period
    </button>
  );

  const revenueInsight = (() => {
    const parts = [];
    if (periodDelta != null) parts.push(`Revenue ${periodDelta >= 0 ? 'up' : 'down'} ${Math.abs(periodDelta).toFixed(1)}% vs the previous ${fm.length}-month period`);
    if (best) parts.push(`best month: ${best.m} (${fmtFull(best.rev)})`);
    return parts.length ? parts.join(' · ') : null;
  })();

  const m25=fm.filter(m=>m.m.includes('25')),m26=fm.filter(m=>m.m.includes('26'));
  const order=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const n25=m25.map(m=>m.m.split(' ')[0]),n26=m26.map(m=>m.m.split(' ')[0]);
  let cMonths=(m25.length&&m26.length)?n25.filter(m=>n26.includes(m)):[...new Set([...n25,...n26])];
  cMonths.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  
  const lineSeries=[];
  if(m25.length)lineSeries.push({name:'2025',type:'line',data:cMonths.map(m=>m25.find(d=>d.m.startsWith(m))?.rev||null),
    lineStyle:{color:'#0891B2',width:2},
    itemStyle:{color:'#0891B2'},areaStyle:{color:'rgba(8,145,178,.07)'},smooth:true});
  if(m26.length)lineSeries.push({name:'2026',type:'line',data:cMonths.map(m=>m26.find(d=>d.m.startsWith(m))?.rev||null),
    lineStyle:{color:'#73D4F2',width:2,type:'dashed'},
    itemStyle:{color:'#73D4F2'},areaStyle:{color:'rgba(115,212,242,.07)'},smooth:true});
  
  const cmpOpt = withDataZoom(withCrosshair({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',formatter:p=>p.map(s=>`${s.marker} ${s.seriesName}: ${s.value?fmtFull(s.value):'—'}`).join('<br/>')},
    legend:{
      bottom:0,
      textStyle:{color:'#5F7078',fontSize:10},
      icon:'roundRect',
      selectedMode: false
    },
    grid:{left:'3%',right:'4%',bottom:'16%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:cMonths,axisLabel:{color:'#5F7078',fontSize:9}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:lineSeries
  }));

  const ordersOpt = withDataZoom(withCrosshair({
    tooltip:{trigger:'axis',formatter:p=>`<strong>${p[0].name}</strong><br/>Orders: ${fmtN(p[0].value)}`},
    grid:{left:'3%',right:'4%',bottom:'12%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:fm.map(d=>d.m),axisLabel:{color:'#5F7078',fontSize:9},axisLine:{lineStyle:{color:'#DDE6E9'}}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmtN(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    series:[{
      type:'line',
      data:fm.map(d => d.orders),
      step:'middle',
      symbol:'circle',
      symbolSize:(val,params)=>{
        const m = fm[params.dataIndex]?.m;
        return selectedMonth && selectedMonth === m ? 8 : 5;
      },
      lineStyle:{color:'#0369A1',width:2},
      areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(3,105,161,.18)'},{offset:1,color:'rgba(3,105,161,.01)'}]}},
      itemStyle:{
        color:'#0369A1',
        borderColor:'#fff',
        borderWidth:1.5
      },
      emphasis:{itemStyle:{color:'#0369A1'}}
    }]
  },fmtN));

  const barTbl={headers:['Month','Revenue','Orders','Avg Order Value'],rows:fm.map(m=>[m.m,fmtFull(m.rev),fmtN(m.orders),fmtFull(Math.round(m.rev/(m.orders||1)))])};
  const ordTbl={headers:['Month','Orders'],rows:fm.map(m=>[m.m,fmtN(m.orders)])};

  const handleMonthClick = (p) => {
    const month = fm[p.dataIndex]?.m;
    setSelectedMonth(selectedMonth === month ? null : month);
  };

  return (
    <div className="page-area" key="revenue">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Revenue</div><div className="kpi-val sm">{fmtFull(totalRev)}</div><div className="kpi-chg">{fmtN(totalOrders)} transactions</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Months Shown</div><div className="kpi-val sm">{fm.length}</div><div className="kpi-chg">Active period</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Best Month</div><div className="kpi-val sm">{best?best.m:'—'}</div><div className="kpi-chg">{best?fmtFull(best.rev):''}</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Avg Monthly</div><div className="kpi-val sm">{fmtFull(avg)}</div><div className="kpi-chg">{fm.length}-month average</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Monthly Revenue" subtitle={label} tag={`${fm.length}m`} flex={1} controls={prevToggleControl} tableHeaders={barTbl.headers} tableRows={barTbl.rows} insight={revenueInsight}>
            <EC option={barOpt} onEvents={{'click': handleMonthClick}}/>
          </Panel>
          <Panel title="2025 vs 2026" subtitle="Year overlay" flex={1}>
            <EC option={cmpOpt}/>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Order Volume" subtitle="Monthly transactions" flex={1} tableHeaders={ordTbl.headers} tableRows={ordTbl.rows}>
            <EC option={ordersOpt} onEvents={{'click': handleMonthClick}}/>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SalesReps({ fm, label, highlightQuery }) {
  const months = fm.map(m=>m.m);
  const reps = useMemo(()=>{
    const g={};
    salesrepsRaw.filter(r=>months.includes(r.m)).forEach(r=>{
      const k=r.n.trim();if(!g[k])g[k]={n:k,rev:0,qty:0,orders:0};
      g[k].rev+=r.rev;g[k].qty+=r.qty;g[k].orders+=r.orders;
    });
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months]);

  const totalRev=reps.reduce((s,r)=>s+r.rev,0);
  const top3=reps.slice(0,3);
  const [selRep,setSelRep] = useState(null);

  const barOpt = withDataZoom({
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const pct = totalRev > 0 ? (p[0].value / totalRev * 100).toFixed(2).replace('.', ',') : '0';
        return `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)} (${pct}%)`;
      }
    },
    grid: { left: '2%', right: '6%', bottom: '12%', top: '5%', containLabel: true },
    xAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) },
      splitLine: { lineStyle: { color: '#F0F3F4' } }
    },
    yAxis: {
      type: 'category',
      data: reps.map(d => d.n.split(' ')[0]),
      axisLabel: { color: '#5F7078', fontSize: 9 },
      inverse: true
    },
    legend: { show: false },
    series: [{
      type: 'bar',
      data: reps.map((d, i) => ({
        value: d.rev,
        itemStyle: {
          color: selRep && selRep !== d.n ? PALETTE[i % PALETTE.length] + '44' : PALETTE[i % PALETTE.length],
          borderRadius: [0, 3, 3, 0]
        }
      })),
      barMaxWidth: 18
    }]
  });

  const tbl={headers:['#','Verkoper','Revenue','Orders','Avg Order Value'],rows:reps.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};

  const handleRepClick = (p) => {
    const repName = reps[p.dataIndex]?.n;
    setSelRep(selRep === repName ? null : repName);
  };

  const leaderboardRows = selRep ? tbl.rows.filter(r => r[1] === selRep) : tbl.rows;

  const repsInsight = reps[0]
    ? `${reps[0].n} leads with ${fmtFull(reps[0].rev)}${totalRev > 0 ? ` (${(reps[0].rev/totalRev*100).toFixed(0)}% of shown revenue)` : ''}`
    : null;

  const smPeriods = useMemo(() => {
    const seen = new Set();
    salesmanCategorySales.forEach(s => (s.monthly || []).forEach(mo => seen.add(mo.m)));
    return [...seen];
  }, []);
  const [smPeriod, setSmPeriod] = useState('All');

  const smRevFor = (rec, period) => {
    if (!rec) return 0;
    if (period === 'All') return rec.rev;
    const mo = (rec.monthly || []).find(m => m.m === period);
    return mo ? mo.rev : 0;
  };
  const smOrdersFor = (rec, period) => {
    if (!rec) return 0;
    if (period === 'All') return rec.orders;
    const mo = (rec.monthly || []).find(m => m.m === period);
    return mo ? mo.orders : 0;
  };

  const smCats = useMemo(() => [...new Set(salesmanCategorySales.map(s => s.category))], []);
  const smOrder = useMemo(() => {
    const totals = {};
    salesmanCategorySales.forEach(s => {
      if (s.salesman === 'Unknown') return;
      totals[s.salesman] = (totals[s.salesman] || 0) + smRevFor(s, smPeriod);
    });
    return Object.entries(totals).sort((a,b) => b[1]-a[1]).map(([n]) => n);
  }, [smPeriod]);

  const smSeries = smCats.map((cat, i) => ({
    name: cat,
    type: 'bar',
    stack: 'total',
    data: smOrder.map(n => {
      const rec = salesmanCategorySales.find(s => s.salesman === n && s.category === cat);
      return smRevFor(rec, smPeriod);
    }),
    itemStyle: { color: PALETTE[i % PALETTE.length] }
  }));

  const smOpt = withDataZoom({
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        let html = `<strong>${p[0].name}</strong><br/>`;
        let sum = 0;
        p.forEach(s => { if (s.value) { html += `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}<br/>`; sum += s.value; } });
        html += `<strong>Total: ${fmtFull(sum)}</strong>`;
        return html;
      }
    },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 8 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
    grid: { left: '2%', right: '6%', bottom: '20%', top: '5%', containLabel: true },
    xAxis: {
      type: 'value', min: 0, minInterval: 1,
      axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) },
      splitLine: { lineStyle: { color: '#F0F3F4' } }
    },
    yAxis: {
      type: 'category',
      data: smOrder.map(n => n.split(' ')[0]),
      axisLabel: { color: '#5F7078', fontSize: 9 },
      inverse: true
    },
    series: smSeries
  });

  const smTbl = {
    headers: ['Verkoper','Category','Revenue','Orders'],
    rows: [...salesmanCategorySales]
      .filter(s => s.salesman !== 'Unknown')
      .map(s => ({ ...s, _rev: smRevFor(s, smPeriod), _orders: smOrdersFor(s, smPeriod) }))
      .filter(s => smPeriod === 'All' || s._rev !== 0 || s._orders !== 0)
      .sort((a,b) => b._rev - a._rev)
      .map(s => [s.salesman, s.category, fmtFull(s._rev), fmtN(s._orders)])
  };

  const smPeriodControl = (
    <select className="panel-select" value={smPeriod} onChange={e => setSmPeriod(e.target.value)} aria-label="Period">
      <option value="All">Full period</option>
      {smPeriods.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  );

  const vmPeriods = useMemo(() => {
    const seen = new Set();
    totalTonnageByCategory.forEach(c => (c.monthly || []).forEach(mo => seen.add(mo.m)));
    return [...seen];
  }, []);
  const [vmPeriod, setVmPeriod] = useState('All');

  const vmSalesmen = useMemo(
    () => [...new Set(tonnagePerSalesman.map(t => t.salesman))].filter(n => n !== 'Unknown').sort(),
    []
  );
  const [vmSalesman, setVmSalesman] = useState('All');

  const VM_CATS = ['Melkpoeder', 'Veevoeders'];

  const vmData = useMemo(() => {
    const source = vmSalesman === 'All'
      ? totalTonnageByCategory
      : tonnagePerSalesman.filter(t => t.salesman === vmSalesman);

    return VM_CATS.map(cat => {
      const rec = source.find(c => c.category === cat);
      if (!rec) return { category: cat, revenue: 0, tonnage: 0, orders: 0 };
      if (vmPeriod === 'All') return rec;
      const mo = (rec.monthly || []).find(m => m.m === vmPeriod);
      return {
        category: cat,
        revenue: mo ? mo.revenue : 0,
        tonnage: mo ? mo.tonnage : 0,
        orders: mo ? (mo.orders ?? rec.orders) : 0,
      };
    });
  }, [vmPeriod, vmSalesman]);

  const vmOpt = {
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        let html = `<strong>${p[0].name}</strong><br/>`;
        p.forEach(s => {
          html += `${s.marker} ${s.seriesName}: ${s.seriesName === 'Tonnage' ? fmtNum(s.value) + ' t' : fmtFull(s.value)}<br/>`;
        });
        return html;
      }
    },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 10 } },
    grid: { left: '12%', right: '12%', bottom: '18%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: vmData.map(c => c.category), axisLabel: { color: '#5F7078', fontSize: 10 } },
    yAxis: [
      { type: 'value', name: 'Revenue', nameTextStyle: { color: '#5F7078', fontSize: 9 }, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
      { type: 'value', name: 'Tonnage', nameTextStyle: { color: '#5F7078', fontSize: 9 }, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmtNum(v) }, splitLine: { show: false } }
    ],
    series: [
      { name: 'Revenue', type: 'bar', data: vmData.map(c => c.revenue), itemStyle: { color: '#40BCF3', borderRadius: [3,3,0,0] }, barMaxWidth: 50 },
      { name: 'Tonnage', type: 'line', yAxisIndex: 1, data: vmData.map(c => c.tonnage), itemStyle: { color: '#1F3741' }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 7 }
    ]
  };

  const vmTbl = {
    headers: ['Category','Revenue','Tonnage','Orders'],
    rows: vmData.map(c => [c.category, fmtFull(c.revenue), fmtNum(c.tonnage) + ' t', fmtN(c.orders)])
  };

  const vmControls = (
    <>
      <select className="panel-select" value={vmSalesman} onChange={e => setVmSalesman(e.target.value)} aria-label="Salesman">
        <option value="All">All salesmen</option>
        {vmSalesmen.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <select className="panel-select" value={vmPeriod} onChange={e => setVmPeriod(e.target.value)} aria-label="Period">
        <option value="All">Full period</option>
        {vmPeriods.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </>
  );

  return (
    <div className="page-area" key="reps">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">#1 — {top3[0]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[0]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[0]?.orders||0)} orders</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">#2 — {top3[1]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[1]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[1]?.orders||0)} orders</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">#3 — {top3[2]?.n?.split(' ')[0]||'—'}</div><div className="kpi-val sm">{fmtFull(top3[2]?.rev||0)}</div><div className="kpi-chg">{fmtN(top3[2]?.orders||0)} orders</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Top 3 Share</div><div className="kpi-val sm">{totalRev>0?((top3.reduce((s,r)=>s+r.rev,0)/totalRev)*100).toFixed(0):0}%</div><div className="kpi-chg">of total revenue</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Omzet per Verkoper" subtitle={label} flex={1} controls={<ExportExcelButton filename="omzet_per_verkoper.xlsx" headers={tbl.headers} rows={tbl.rows} />} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={repsInsight}>
            <EC option={barOpt} onEvents={{'click': handleRepClick}}/>
          </Panel>
          <Panel title="Verkoper Leaderboard" subtitle={selRep ? `Filtered · click the chart to change` : 'Ranked by revenue · click a bar above to drill in'} flex={1}>
            <div style={{display:'flex', flexDirection:'column', height:'100%'}}>
              {selRep && (
                <div className="drill-chip">
                  Showing: {selRep}
                  <button onClick={() => setSelRep(null)} title="Clear selection">✕</button>
                </div>
              )}
              <div style={{flex:1, minHeight:0}}>
                <InlineTable headers={tbl.headers} rows={leaderboardRows} height="100%" searchable initialQuery={highlightQuery}/>
              </div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Sales per Verkoper by Category" subtitle="Stacked by category" flex={1} controls={<>{smPeriodControl}<ExportExcelButton filename="sales_per_verkoper_by_category.xlsx" headers={smTbl.headers} rows={smTbl.rows} /></>} tableHeaders={smTbl.headers} tableRows={smTbl.rows}>
            <EC option={smOpt} />
          </Panel>
          <Panel title="Veevoeder & Melkpoeder" subtitle={vmSalesman === 'All' ? 'Revenue vs tonnage' : `Revenue vs tonnage — ${vmSalesman}`} flex={1} controls={vmControls} tableHeaders={vmTbl.headers} tableRows={vmTbl.rows}>
            <EC option={vmOpt} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Customers({ fm, label, highlightQuery }) {
  const months=fm.map(m=>m.m);
  const totalRevenue=fm.reduce((s,m)=>s+m.rev,0);

  const custs=useMemo(()=>{
    const g={};
    customersRaw.filter(c=>months.includes(c.m)).forEach(c=>{if(!g[c.n])g[c.n]={n:c.n,rev:0,orders:0};g[c.n].rev+=c.rev;g[c.n].orders+=c.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months]);

  const top15 = custs.slice(0,15);
  const top15Rev = top15.reduce((s,c)=>s+c.rev,0);

  const itemsPerPage = 15;
  const [currentCount, setCurrentCount] = useState(15);
  const currentItems = custs.slice(0, currentCount);

  const showMore = () => setCurrentCount(c => Math.min(c + itemsPerPage, custs.length));
  const showLess = () => setCurrentCount(c => Math.max(c - itemsPerPage, itemsPerPage));
  const showAll = () => setCurrentCount(custs.length);
  const resetToDefault = () => setCurrentCount(itemsPerPage);

  const barOpt = withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`},
    grid:{left:'2%',right:'6%',bottom:'12%',top:'5%',containLabel:true},
    xAxis:{type:'value',min:0,minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    yAxis:{type:'category',data:currentItems.map(d=>d.n.length>20?d.n.slice(0,20)+'…':d.n),axisLabel:{color:'#5F7078',fontSize:9},inverse:true},
    legend:{show:false},
    series:[{
      type:'bar',
      data:currentItems.map((d,i)=>({
        value:d.rev,
        itemStyle:{
          color:PALETTE[i%PALETTE.length]+'cc',
          borderRadius:[0,3,3,0]
        }
      })),
      barMaxWidth:16
    }]
  });

  const tbl={headers:['#','Customer','Revenue','Orders','Avg Order Value'],rows:currentItems.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};
  const fullTbl={headers:['#','Customer','Revenue','Orders','Avg Order Value'],rows:custs.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),fmtFull(Math.round(d.rev/(d.orders||1)))])};

  const customersInsight = custs[0]
    ? `Top customer: ${custs[0].n} — ${fmtFull(custs[0].rev)}${totalRevenue > 0 ? ` (${(custs[0].rev/totalRevenue*100).toFixed(1)}% of total revenue)` : ''}`
    : null;

  const PaginationControls = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
      marginTop: '4px',
      padding: '4px 0',
      flexWrap: 'wrap'
    }}>
      <button onClick={showLess} disabled={currentCount <= itemsPerPage} style={{
        padding: '3px 10px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: currentCount <= itemsPerPage ? 'not-allowed' : 'pointer',
        fontSize: '11px', fontFamily: 'inherit',
        opacity: currentCount <= itemsPerPage ? 0.4 : 1, transition: 'all .14s'
      }}>◀ Show Less</button>

      <span style={{
        fontSize: '10px', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace',
        minWidth: '80px', textAlign: 'center'
      }}>
        {currentCount >= custs.length ? `All ${custs.length}` : `1-${currentCount} / ${custs.length}`}
      </span>

      <button onClick={showMore} disabled={currentCount >= custs.length} style={{
        padding: '3px 10px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: currentCount >= custs.length ? 'not-allowed' : 'pointer',
        fontSize: '11px', fontFamily: 'inherit',
        opacity: currentCount >= custs.length ? 0.4 : 1, transition: 'all .14s'
      }}>Show More ▶</button>

      <button onClick={currentCount >= custs.length ? resetToDefault : showAll} style={{
        padding: '2px 8px',
        border: `1px solid ${currentCount >= custs.length ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '4px',
        background: currentCount >= custs.length ? 'rgba(64,188,243,0.1)' : 'var(--surface3)',
        color: currentCount >= custs.length ? 'var(--accent2)' : 'var(--muted)',
        cursor: 'pointer', fontSize: '9px', fontFamily: 'inherit', marginLeft: '4px',
        transition: 'all .14s'
      }}>{currentCount >= custs.length ? `📋 ${itemsPerPage}` : '📋 Full'}</button>
    </div>
  );

  return (
    <div className="page-area" key="customers">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Total Customers</div><div className="kpi-val sm">{totalClients.toLocaleString('de-DE')}</div><div className="kpi-chg">Billing accounts</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Top Customer</div><div className="kpi-val sm">{custs[0]?.n?.slice(0,16)||'—'}</div><div className="kpi-chg">{fmtFull(custs[0]?.rev||0)}</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Top 15 Revenue</div><div className="kpi-val sm">{fmtFull(top15Rev)}</div><div className="kpi-chg">{totalRevenue>0?((top15Rev/totalRevenue)*100).toFixed(0):0}% of total</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Avg Rev / Client</div><div className="kpi-val sm">{fmtFull(Math.round(totalRevenue/totalClients))}</div><div className="kpi-chg">Across all accounts</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Customers by Revenue" subtitle={label} flex={1} controls={<ExportExcelButton filename="customers_by_revenue.xlsx" headers={fullTbl.headers} rows={fullTbl.rows} />} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={customersInsight}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <EC option={barOpt}/>
              </div>
              <PaginationControls />
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
<Panel title="Leaderboard" subtitle="All clients · searchable" flex={1}>
  <InlineTable headers={fullTbl.headers} rows={fullTbl.rows} height="100%" searchable initialQuery={highlightQuery}/>
</Panel>
        </div>
      </div>
    </div>
  );
}

function Products({ fm, label, highlightQuery }) {
  const months = fm.map(m => m.m);
  const prods = useMemo(() => {
    const g = {};
    productsRaw.filter(p => months.includes(p.m)).forEach(p => {
      const k = p.n.trim();
      if (!g[k]) g[k] = { n: k, rev: 0, qty: 0, orders: 0 };
      g[k].rev += p.rev;
      g[k].qty += p.qty;
      g[k].orders += p.orders;
    });
    return Object.values(g).sort((a, b) => b.rev - a.rev);
  }, [months]);

  const totalRev = prods.reduce((s, p) => s + p.rev, 0);
  const top5Rev = prods.slice(0, 5).reduce((s, p) => s + p.rev, 0);
  const productsInsight = prods.length
    ? `Top product: ${prods[0].n}${totalRev > 0 ? ` (${(prods[0].rev / totalRev * 100).toFixed(0)}% of revenue)` : ''} · Top 5 lines make up ${totalRev > 0 ? (top5Rev / totalRev * 100).toFixed(0) : 0}% of total`
    : null;
  const [selProd, setSelProd] = useState(null);
  
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [currentCount, setCurrentCount] = useState(15);
  useEffect(() => { if (highlightQuery) setCurrentCount(prods.length); }, [highlightQuery, prods.length]);
  const [donutItemsPerPage, setDonutItemsPerPage] = useState(10);
  const [donutCurrentCount, setDonutCurrentCount] = useState(10);
  
  const currentItems = prods.slice(0, currentCount);
  const donutCurrentItems = prods.slice(0, donutCurrentCount);
  
  const [autoZoom, setAutoZoom] = useState(true);
  
  const showMore = () => {
    const newCount = Math.min(currentCount + itemsPerPage, prods.length);
    setCurrentCount(newCount);
  };

  const showLess = () => {
    const newCount = Math.max(currentCount - itemsPerPage, itemsPerPage);
    setCurrentCount(newCount);
  };

  const showAll = () => {
    setCurrentCount(prods.length);
  };

  const resetToDefault = () => {
    setCurrentCount(itemsPerPage);
  };

  const showMoreDonut = () => {
    const newCount = Math.min(donutCurrentCount + donutItemsPerPage, prods.length);
    setDonutCurrentCount(newCount);
  };

  const showLessDonut = () => {
    const newCount = Math.max(donutCurrentCount - donutItemsPerPage, donutItemsPerPage);
    setDonutCurrentCount(newCount);
  };

  const showAllDonut = () => {
    setDonutCurrentCount(prods.length);
  };

  const resetToDefaultDonut = () => {
    setDonutCurrentCount(donutItemsPerPage);
  };

  const barOpt = withDataZoom({
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}`
    },
    grid: {
      left: '2%',
      right: '6%',
      bottom: '12%',
      top: '5%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) },
      splitLine: { lineStyle: { color: '#F0F3F4' } },
      max: (value) => {
        if (autoZoom && currentItems.length > 0) {
          const maxVal = Math.max(...currentItems.map(p => p.rev));
          const minVal = Math.min(...currentItems.map(p => p.rev));
          if (maxVal < 60000 && maxVal > 0) return maxVal * 1.3;
          if (maxVal < 200000 && maxVal > 0) return maxVal * 1.2;
          return null;
        }
        return null;
      }
    },
    yAxis: {
      type: 'category',
      data: currentItems.map(d => d.n.length > 22 ? d.n.slice(0, 22) + '…' : d.n),
      axisLabel: { color: '#5F7078', fontSize: 9 },
      inverse: true
    },
    legend: { show: false },
    series: [{
      type: 'bar',
      data: currentItems.map((d, i) => ({
        value: d.rev,
        itemStyle: {
          color: selProd && selProd !== d.n ? PALETTE[i % PALETTE.length] + '44' : PALETTE[i % PALETTE.length],
          borderRadius: [0, 3, 3, 0]
        }
      })),
      barMaxWidth: 18
    }]
  });

const donutData = donutCurrentItems.map((d, i) => ({
  name: d.n.length > 16 ? d.n.slice(0, 16) + '…' : d.n,
  fullName: d.n,
  value: d.rev,
  itemStyle: {
    color: selProd && selProd !== d.n ? PALETTE[i % PALETTE.length] + '44' : PALETTE[i % PALETTE.length]
  }
}));

 
const donutOpt = {
  tooltip: {
    ...TOOLTIP_STYLE,
    trigger: 'item',
    formatter: p => `${p.name}: ${fmtFull(p.value)} (${p.percent}%)`
  },
  legend: {
    bottom: 0,
    textStyle: { color: '#5F7078', fontSize: 9 },
    type: 'scroll',
    selectedMode: 'multiple'
  },
  series: [{
    type: 'pie',
    radius: ['48%', '70%'],
    center: ['50%', '44%'],
    data: donutData,
    itemStyle: { borderRadius: 3, borderColor: '#fff', borderWidth: 2 },
    label: { show: false },
    emphasis: { scaleSize: 6 }
  }]
};

  const tbl = {
    headers: ['#', 'Product', 'Revenue', 'Orders', 'Share'],
    rows: currentItems.map((d, i) => [
      i + 1,
      d.n,
      fmtFull(d.rev),
      fmtN(d.orders),
      ((d.rev / totalRev) * 100).toFixed(1).replace('.',',') + '%'
    ])
  };

  const PaginationControls = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
      marginTop: '4px',
      padding: '4px 0',
      flexWrap: 'wrap'
    }}>
      <button onClick={showLess} disabled={currentCount <= itemsPerPage} style={{
        padding: '3px 10px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: currentCount <= itemsPerPage ? 'not-allowed' : 'pointer',
        fontSize: '11px', fontFamily: 'inherit',
        opacity: currentCount <= itemsPerPage ? 0.4 : 1, transition: 'all .14s'
      }}>◀ Show Less</button>
      
      <span style={{
        fontSize: '10px', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace',
        minWidth: '80px', textAlign: 'center'
      }}>
        {currentCount >= prods.length ? `All ${prods.length}` : `1-${currentCount} / ${prods.length}`}
      </span>
      
      <button onClick={showMore} disabled={currentCount >= prods.length} style={{
        padding: '3px 10px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: currentCount >= prods.length ? 'not-allowed' : 'pointer',
        fontSize: '11px', fontFamily: 'inherit',
        opacity: currentCount >= prods.length ? 0.4 : 1, transition: 'all .14s'
      }}>Show More ▶</button>

      <button onClick={currentCount >= prods.length ? resetToDefault : showAll} style={{
        padding: '2px 8px',
        border: `1px solid ${currentCount >= prods.length ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '4px',
        background: currentCount >= prods.length ? 'rgba(64,188,243,0.1)' : 'var(--surface3)',
        color: currentCount >= prods.length ? 'var(--accent2)' : 'var(--muted)',
        cursor: 'pointer', fontSize: '9px', fontFamily: 'inherit', marginLeft: '4px',
        transition: 'all .14s'
      }}>{currentCount >= prods.length ? `📋 ${itemsPerPage}` : '📋 Full'}</button>

      <button onClick={() => setAutoZoom(!autoZoom)} style={{
        padding: '2px 8px',
        border: `1px solid ${autoZoom ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '4px',
        background: autoZoom ? 'rgba(64,188,243,0.1)' : 'var(--surface3)',
        color: autoZoom ? 'var(--accent2)' : 'var(--muted)',
        cursor: 'pointer', fontSize: '9px', fontFamily: 'inherit', marginLeft: '4px',
        transition: 'all .14s'
      }}>🔍 {autoZoom ? 'Auto' : 'Fixed'}</button>
    </div>
  );

  const DonutPaginationControls = () => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center',
      marginTop: '4px', padding: '2px 0', flexWrap: 'wrap'
    }}>
      <button onClick={showLessDonut} disabled={donutCurrentCount <= donutItemsPerPage} style={{
        padding: '2px 8px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: donutCurrentCount <= donutItemsPerPage ? 'not-allowed' : 'pointer',
        fontSize: '10px', fontFamily: 'inherit',
        opacity: donutCurrentCount <= donutItemsPerPage ? 0.4 : 1, transition: 'all .14s'
      }}>◀</button>
      
      <span style={{
        fontSize: '9px', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace',
        minWidth: '60px', textAlign: 'center'
      }}>
        {donutCurrentCount >= prods.length ? `All ${prods.length}` : `1-${donutCurrentCount} / ${prods.length}`}
      </span>
      
      <button onClick={showMoreDonut} disabled={donutCurrentCount >= prods.length} style={{
        padding: '2px 8px', border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface3)', color: 'var(--muted)',
        cursor: donutCurrentCount >= prods.length ? 'not-allowed' : 'pointer',
        fontSize: '10px', fontFamily: 'inherit',
        opacity: donutCurrentCount >= prods.length ? 0.4 : 1, transition: 'all .14s'
      }}>▶</button>

      <button onClick={donutCurrentCount >= prods.length ? resetToDefaultDonut : showAllDonut} style={{
        padding: '2px 6px',
        border: `1px solid ${donutCurrentCount >= prods.length ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '4px',
        background: donutCurrentCount >= prods.length ? 'rgba(64,188,243,0.1)' : 'var(--surface3)',
        color: donutCurrentCount >= prods.length ? 'var(--accent2)' : 'var(--muted)',
        cursor: 'pointer', fontSize: '8px', fontFamily: 'inherit', marginLeft: '4px',
        transition: 'all .14s'
      }}>{donutCurrentCount >= prods.length ? `📋 ${donutItemsPerPage}` : '📋 Full'}</button>
    </div>
  );

  const allProductsTableRows = prods.map(d => [d.n, fmtFull(d.rev), ((d.rev / totalRev) * 100).toFixed(1).replace('.',',') + '%']);

  const handleBarClick = (p) => {
    const item = currentItems[p.dataIndex];
    if (item) {
      setSelProd(selProd === item.n ? null : item.n);
    }
  };

const [selectedCategory, setSelectedCategory] = useState(null);


const handleDonutClick = (p) => {
  const fullName = donutCurrentItems.find(x => x.n.startsWith(p.name.replace('…', '')))?.n;
  setSelProd(selProd === fullName ? null : fullName || null);
};

const handleDonutLegend = (params, echartsInstance) => {
  if (echartsInstance) {
    echartsInstance.dispatchAction({ type: 'legendSelect', name: params.name });
  }
  const fullName = donutCurrentItems.find(x => x.n.startsWith(params.name.replace('…', '')))?.n;
  setSelProd(prev => prev === (fullName || null) ? null : (fullName || null));
};

  return (
    <div className="page-area" key="products">
      <div className="kpi-strip">
        <div className="kpi-card blue">
          <div className="kpi-lbl">#1 Product</div>
          <div className="kpi-val sm">{prods[0]?.n?.split(' - ')[0] || '—'}</div>
          <div className="kpi-chg">{fmtFull(prods[0]?.rev || 0)} · {totalRev > 0 ? ((prods[0]?.rev || 0) / totalRev * 100).toFixed(0) : 0}% share</div>
        </div>
        <div className="kpi-card teal">
          <div className="kpi-lbl">#2 Product</div>
          <div className="kpi-val sm">{prods[1]?.n?.split(' - ')[0] || '—'}</div>
          <div className="kpi-chg">{fmtFull(prods[1]?.rev || 0)} · {totalRev > 0 ? ((prods[1]?.rev || 0) / totalRev * 100).toFixed(0) : 0}% share</div>
        </div>
        <div className="kpi-card navy">
          <div className="kpi-lbl">#3 Product</div>
          <div className="kpi-val sm">{prods[2]?.n?.split(' - ')[0] || '—'}</div>
          <div className="kpi-chg">{fmtFull(prods[2]?.rev || 0)} · {totalRev > 0 ? ((prods[2]?.rev || 0) / totalRev * 100).toFixed(0) : 0}% share</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-lbl">Products Tracked</div>
          <div className="kpi-val sm">{prods.length}</div>
          <div className="kpi-chg">Active lines</div>
        </div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 2 }}>
          <Panel title="Top Products by Revenue" subtitle={label} flex={1} tableHeaders={tbl.headers} tableRows={tbl.rows} defaultView={highlightQuery ? 'table' : 'chart'} searchableTable tableInitialQuery={highlightQuery} insight={productsInsight}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <EC option={barOpt} onEvents={{ 'click': handleBarClick }}/>
              </div>
              <PaginationControls />
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Product Share" subtitle="Click to isolate" flex={1} tableHeaders={['Product', 'Revenue', 'Share']} tableRows={allProductsTableRows} defaultView="chart">
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <EC 
                  option={donutOpt} 
                  onEvents={{
                    'click': handleDonutClick,
                    'legendselectchanged': handleDonutLegend
                  }}
                />
              </div>
              <DonutPaginationControls />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Categories({ fm, label, highlightQuery }) {
  const months=fm.map(m=>m.m);

  const cats=useMemo(()=>{
    const g={};
    categoriesRaw.filter(c=>months.includes(c.m)).forEach(c=>{const k=c.n.trim();if(!g[k])g[k]={n:k,rev:0,orders:0};g[k].rev+=c.rev;g[k].orders+=c.orders;});
    return Object.values(g).sort((a,b)=>b.rev-a.rev);
  },[months]);
  const totalRev=cats.reduce((s,c)=>s+c.rev,0);

const donutData=cats.map((d,i)=>({
  name:d.n,
  value:d.rev,
  itemStyle:{ color:PALETTE[i%PALETTE.length] }
}));

const donutOpt={
  tooltip:{...TOOLTIP_STYLE,trigger:'item',formatter:p=>`${p.name}: ${fmtFull(p.value)} (${p.percent}%)`},
  legend:{
    bottom:0,
    textStyle:{color:'#5F7078',fontSize:9},
    type:'scroll',
    selectedMode:false
  },
  series:[{
    type:'pie',
    radius:['48%','70%'],
    center:['50%','44%'],
    data:donutData,
    itemStyle:{borderRadius:3,borderColor:'#fff',borderWidth:2},
    label:{show:false},
    emphasis:{scaleSize:6}
  }]
};

  const tbl={headers:['#','Category','Revenue','Orders','Share'],rows:cats.map((d,i)=>[i+1,d.n,fmtFull(d.rev),fmtN(d.orders),((d.rev/totalRev)*100).toFixed(1).replace('.',',')+'%'])};

  const [selectedCat, setSelectedCat] = useState(highlightQuery || null);
  useEffect(() => { if (highlightQuery) setSelectedCat(highlightQuery); }, [highlightQuery]);
  const handleCatDonutClick = (p) => setSelectedCat(prev => prev === p.name ? null : p.name);
  const catRows = selectedCat ? tbl.rows.filter(r => r[1] === selectedCat) : tbl.rows;

  const catsInsight = cats[0]
    ? `${cats[0].n} leads with ${fmtFull(cats[0].rev)}${totalRev > 0 ? ` (${(cats[0].rev/totalRev*100).toFixed(0)}% share)` : ''}`
    : null;

  return (
    <div className="page-area" key="cats">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Top Category</div><div className="kpi-val sm">{cats[0]?.n||'—'}</div><div className="kpi-chg">{fmtFull(cats[0]?.rev||0)} · {totalRev>0?((cats[0]?.rev||0)/totalRev*100).toFixed(0):0}%</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">{cats[1]?.n||'—'}</div><div className="kpi-val sm">{fmtFull(cats[1]?.rev||0)}</div><div className="kpi-chg">{totalRev>0?((cats[1]?.rev||0)/totalRev*100).toFixed(1):0}% share</div></div>
        <div className="kpi-card navy"><div className="kpi-lbl">{cats[2]?.n||'—'}</div><div className="kpi-val sm">{fmtFull(cats[2]?.rev||0)}</div><div className="kpi-chg">{totalRev>0?((cats[2]?.rev||0)/totalRev*100).toFixed(1):0}% share</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Categories</div><div className="kpi-val sm">{cats.length}</div><div className="kpi-chg">Active groups</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:2}}>
          <Panel title="Category Revenue" subtitle={selectedCat ? `Filtered · click the donut to change` : label} flex={1}>
            <div style={{display:'flex', flexDirection:'column', height:'100%'}}>
              {selectedCat && (
                <div className="drill-chip">
                  Showing: {selectedCat}
                  <button onClick={() => setSelectedCat(null)} title="Clear selection">✕</button>
                </div>
              )}
              <div style={{flex:1, minHeight:0}}>
                <InlineTable headers={tbl.headers} rows={catRows} height="100%"/>
              </div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Category Split" subtitle="Click a slice to drill in" flex={1} tableHeaders={['Category','Revenue','Share']} tableRows={cats.map(d=>[d.n,fmtFull(d.rev),((d.rev/totalRev)*100).toFixed(1).replace('.',',')+'%'])} insight={catsInsight}>
            <EC option={donutOpt} onEvents={{'click': handleCatDonutClick}} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Channels({ fm, label }) {
  const months=fm.map(m=>m.m);
  const ch=useMemo(()=>{
    const f=salesrepsRaw.filter(s=>months.includes(s.m));
    const ws=f.filter(s=>s.n==='Webshop');
    const dr=f.filter(s=>s.n!=='Webshop');
    return {dRev:dr.reduce((s,r)=>s+r.rev,0),wRev:ws.reduce((s,r)=>s+r.rev,0),dOrd:dr.reduce((s,r)=>s+r.orders,0),wOrd:ws.reduce((s,r)=>s+r.orders,0)};
  },[months]);
  const total=ch.dRev+ch.wRev;
  const dAOV=ch.dOrd>0?Math.round(ch.dRev/ch.dOrd):0;
  const wAOV=ch.wOrd>0?Math.round(ch.wRev/ch.wOrd):0;

  const [selChannel, setSelChannel] = useState(null);

const donutOpt={
  tooltip:{...TOOLTIP_STYLE,trigger:'item',formatter:p=>`${p.name}: ${fmtFull(p.value)} (${p.percent}%)`},
  legend:{
    bottom:0,
    textStyle:{color:'#5F7078',fontSize:10},
    selectedMode:'multiple'
  },
  series:[{
    type:'pie',
    radius:['48%','70%'],
    center:['50%','44%'],
    data:[
      {name:'Direct Sales',value:ch.dRev,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(8,145,178,0.2)':'#0891B2'}},
      {name:'Webshop',value:ch.wRev,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2'}}
    ],
    itemStyle:{borderRadius:3,borderColor:'#fff',borderWidth:2},
    label:{show:false},
    emphasis:{scaleSize:6}
  }]
};
  
  const ordOpt = withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`<strong>${p[0].name}</strong><br/>${fmtN(p[0].value)}`},
    grid:{left:'3%',right:'4%',bottom:'12%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:['Direct Sales','Webshop'],axisLabel:{color:'#5F7078',fontSize:10}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmtN(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    legend:{show:false},
    series:[{
      type:'bar',
      data:[
        {value:ch.dOrd,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(8,145,178,0.2)':'#0891B2',borderRadius:[4,4,0,0]}},
        {value:ch.wOrd,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2',borderRadius:[4,4,0,0]}}
      ],
      barMaxWidth:60
    }]
  });
  
  const aovOpt = withDataZoom({
    tooltip:{...TOOLTIP_STYLE,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`${p[0].name}: ${fmtFull(p[0].value)}`},
    grid:{left:'3%',right:'4%',bottom:'12%',top:'8%',containLabel:true},
    xAxis:{type:'category',data:['Direct Sales','Webshop'],axisLabel:{color:'#5F7078',fontSize:10}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#5F7078',fontSize:9,formatter:v=>fmt(v)},splitLine:{lineStyle:{color:'#F0F3F4'}}},
    legend:{show:false},
    series:[{
      type:'bar',
      data:[
        {value:dAOV,itemStyle:{color:selChannel&&selChannel!=='Direct Sales'?'rgba(3,105,161,0.2)':'#0891B2',borderRadius:[4,4,0,0]}},
        {value:wAOV,itemStyle:{color:selChannel&&selChannel!=='Webshop'?'rgba(115,212,242,0.2)':'#73D4F2',borderRadius:[4,4,0,0]}}
      ],
      barMaxWidth:60
    }]
  });

  const leadChannel = ch.dRev >= ch.wRev ? 'Direct Sales' : 'Webshop';
  const leadShare = total > 0 ? (Math.max(ch.dRev, ch.wRev) / total * 100).toFixed(0) : 0;
  const aovLeader = dAOV >= wAOV ? 'Direct Sales' : 'Webshop';
  const aovGapPct = Math.min(dAOV, wAOV) > 0 ? (Math.abs(dAOV - wAOV) / Math.min(dAOV, wAOV) * 100).toFixed(0) : null;
  const channelsInsight = total > 0
    ? `${leadChannel} leads with ${leadShare}% of revenue${aovGapPct ? ` · ${aovLeader} orders run ${aovGapPct}% larger on average` : ''}`
    : null;

  const handleChannelClick = (p) => {
    const channelName = p.name || (p.dataIndex === 0 ? 'Direct Sales' : 'Webshop');
    setSelChannel(selChannel === channelName ? null : channelName);
  };

const handleDonutLegend = (params, echartsInstance) => {
  if (echartsInstance) {
    echartsInstance.dispatchAction({ type: 'legendSelect', name: params.name });
  }
  setSelChannel(prev => prev === params.name ? null : params.name);
};

const handleDonutClick = (p) => {
  setSelChannel(selChannel === p.name ? null : p.name);
};

  return (
    <div className="page-area" key="channels">
      <div className="kpi-strip">
        <div className="kpi-card blue"><div className="kpi-lbl">Direct Sales</div><div className="kpi-val sm">{fmtFull(ch.dRev)}</div><div className="kpi-chg">{total>0?((ch.dRev/total)*100).toFixed(1):0}% · {fmtN(ch.dOrd)} orders</div></div>
        <div className="kpi-card green"><div className="kpi-lbl">Webshop</div><div className="kpi-val sm">{fmtFull(ch.wRev)}</div><div className="kpi-chg">{total>0?((ch.wRev/total)*100).toFixed(1):0}% · {fmtN(ch.wOrd)} orders</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Direct Avg Order</div><div className="kpi-val sm">{fmtFull(dAOV)}</div><div className="kpi-chg">Per transaction</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Webshop Avg Order</div><div className="kpi-val sm">{fmtFull(wAOV)}</div><div className="kpi-chg">Per transaction</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1.2}}>
          <Panel title="Channel Revenue Share" subtitle={label} flex={1} tableHeaders={['Channel','Revenue','Share','Orders','AOV']} tableRows={[['Direct Sales',fmtFull(ch.dRev),total>0?((ch.dRev/total)*100).toFixed(1).replace('.',',')+'%':'—',fmtN(ch.dOrd),fmtFull(dAOV)],['Webshop',fmtFull(ch.wRev),total>0?((ch.wRev/total)*100).toFixed(1).replace('.',',')+'%':'—',fmtN(ch.wOrd),fmtFull(wAOV)]]} insight={channelsInsight}>
            <EC 
              option={donutOpt} 
              onEvents={{
                'click': handleChannelClick,
                'legendselectchanged': handleDonutLegend
              }}
            />
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Order Volume" subtitle="By channel" flex={1}>
            <EC option={ordOpt} onEvents={{'click': handleChannelClick}}/>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Avg Order Value" subtitle="Direct vs Webshop" flex={1}>
            <EC option={aovOpt} onEvents={{'click': handleChannelClick}}/>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── FINANCE HELPERS ───────────────────────────────────────────── */
const FIN_CAT_ORDER = ['Revenue','COGS','Personnel','Rent & Property','Premises',
  'Vehicle & Transport','Marketing','Office & IT','General Admin','Finance','Other OpEx','Other'];

function buildWaterfallSeries(steps) {
  let running = 0;
  const base = [], val = [], colors = [];
  steps.forEach(s => {
    if (s.total) {
      base.push(Math.min(0, running)); val.push(Math.abs(running)); colors.push('#1F3741');
    } else {
      base.push(Math.min(running, running + s.delta)); val.push(Math.abs(s.delta));
      colors.push(s.delta >= 0 ? '#2E9B62' : '#D95C5C'); running += s.delta;
    }
  });
  return { base, val, colors };
}

function YoyBadge({ cy, py, goodIfUp = true }) {
  if (py === undefined || py === null) return null;
  const diff = cy - py;
  const pct = py !== 0 ? Math.abs(diff / py) * 100 : null;
  const good = goodIfUp ? diff >= 0 : diff <= 0;
  return <span className={`fin-badge ${good ? 'good' : 'bad'}`}>{diff >= 0 ? '▲' : '▼'} {pct !== null ? pct.toFixed(1).replace('.',',') + '%' : '—'}</span>;
}

const fmtAxis = v => {
  const av = Math.abs(v), sign = v < 0 ? '-' : '';
  if (av >= 1e6) return sign + '€' + (av / 1e6).toLocaleString('de-DE', {minimumFractionDigits:0, maximumFractionDigits:1}) + 'M';
  if (av >= 1e3) return sign + '€' + (av / 1e3).toLocaleString('de-DE', {maximumFractionDigits:0}) + 'K';
  return sign + '€' + Math.round(av).toLocaleString('de-DE');
};

const mkBarOpt = (labels, vals, colorFn, lw) => ({
  tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' },
    formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}` },
  grid: { left: lw || 150, right: 18, bottom: 22, top: 6, containLabel: false },
  xAxis: { type: 'value', splitNumber: 4, minInterval: 1,
    axisLabel: { color: '#5F7078', fontSize: 8, formatter: v => fmtAxis(v), hideOverlap: true },
    splitLine: { lineStyle: { color: '#F0F3F4' } }, axisTick: { show: false } },
  yAxis: { type: 'category', data: labels,
    axisLabel: { color: '#5F7078', fontSize: 8, width: (lw||150)-10, overflow: 'truncate', ellipsis: '…' },
    inverse: true, axisTick: { show: false } },
  series: [{ type: 'bar', barMaxWidth: 12,
    data: vals.map((v, i) => ({ value: v, itemStyle: { color: colorFn(i), borderRadius: [0,3,3,0] } })) }]
});

function PLSummary() {
  const revCY = finSummary.revenue.cy, revPY = finSummary.revenue.py;
  const cogsCY = finSummary.cogs.cy, cogsPY = finSummary.cogs.py;
  const opexCY = finSummary.opex.cy, opexPY = finSummary.opex.py;
  const gpCY = revCY - cogsCY, gpPY = revPY - cogsPY;
  const ebitdaCY = gpCY - opexCY, ebitdaPY = gpPY - opexPY;
  const gmCY = revCY ? (gpCY / revCY) * 100 : 0;
  const gmPY = revPY ? (gpPY / revPY) * 100 : 0;
  const emCY = revCY ? (ebitdaCY / revCY) * 100 : 0;
  const emPY = revPY ? (ebitdaPY / revPY) * 100 : 0;
  const opexPctCY = revCY ? (opexCY / revCY) * 100 : 0;
  const opexPctPY = revPY ? (opexPY / revPY) * 100 : 0;

  const hasTaxData = finSummary.tax?.cy !== undefined && finSummary.tax?.cy !== null;
  const taxCY = hasTaxData ? finSummary.tax.cy : null;
  const taxPY = hasTaxData ? finSummary.tax.py : null;
  const netCY = hasTaxData ? ebitdaCY - taxCY : null;
  const netPY = hasTaxData ? ebitdaPY - taxPY : null;
  const nmCY = hasTaxData && revCY ? (netCY / revCY) * 100 : null;
  const nmPY = hasTaxData && revPY ? (netPY / revPY) * 100 : null;

  const wfCats = ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'EBITDA'];
  const wfDisplay = [revCY, -cogsCY, gpCY, -opexCY, ebitdaCY];
  const { base: wfBase, val: wfVal, colors: wfColors } = buildWaterfallSeries([
    { delta: revCY }, { delta: -cogsCY }, { total: true }, { delta: -opexCY }, { total: true }
  ]);
  const wfOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: p => `<strong>${wfCats[p[0].dataIndex]}</strong><br/>${fmtFull(wfDisplay[p[0].dataIndex])}` },
    grid: { left: 14, right: 14, bottom: 26, top: 30, containLabel: true },
    xAxis: { type: 'category', data: wfCats, axisLabel: { color: '#5F7078', fontSize: 9 }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 8, formatter: v => fmtAxis(v) },
      splitLine: { lineStyle: { color: '#F0F3F4' } }, axisTick: { show: false } },
    series: [
      { type: 'bar', stack: 'wf', data: wfBase, itemStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
      { type: 'bar', stack: 'wf', barWidth: '55%',
        data: wfVal.map((v, i) => ({ value: v, itemStyle: { color: wfColors[i], borderRadius: 3 } })),
        label: { show: true, position: 'top', distance: 4, color: '#1F3741', fontSize: 8, fontWeight: 700,
          backgroundColor: '#fff', borderColor: '#DDE6E9', borderWidth: 1, borderRadius: 3, padding: [3, 5],
          formatter: p => fmtAxis(wfDisplay[p.dataIndex]) } }
    ]
  };
  const wfTable = { headers: ['Step','2026 (Jan–Mar)','2025 (Jan–Jun)'],
    rows: [['Revenue',fmtFull(revCY),fmtFull(revPY)],['COGS',fmtFull(-cogsCY),fmtFull(-cogsPY)],['Gross Profit',fmtFull(gpCY),fmtFull(gpPY)],['OpEx',fmtFull(-opexCY),fmtFull(-opexPY)],['EBITDA',fmtFull(ebitdaCY),fmtFull(ebitdaPY)]] };

  const tornCats = finCategories.map(c => c.cat);
  const tornVals = finCategories.map(c => c.cy - c.py);
  const tornColors = finCategories.map(c => {
    const bad = c.cat==='Revenue' ? (c.cy-c.py)<0 : (c.cy-c.py)>0;
    return bad ? '#D95C5C' : '#2E9B62';
  });
  const tornOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}` },
    grid: { left: 120, right: 16, bottom: 18, top: 6, containLabel: false },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 8, formatter: v => fmtAxis(v) },
      splitLine: { lineStyle: { color: '#F0F3F4' } }, axisTick: { show: false } },
    yAxis: { type: 'category', data: tornCats,
      axisLabel: { color: '#5F7078', fontSize: 8, width: 112, overflow: 'truncate' },
      inverse: true, axisTick: { show: false } },
    series: [{ type: 'bar', barMaxWidth: 12,
      data: tornVals.map((v,i) => ({ value: v, itemStyle: { color: tornColors[i], borderRadius: v>=0?[0,3,3,0]:[3,0,0,3] } })) }]
  };
  const tornTable = { headers: ['Category','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','YoY %'],
    rows: finCategories.map(c => [c.cat, fmtFull(c.cy), fmtFull(c.py), fmtFull(c.cy-c.py),
      c.py ? fmtPct((c.cy-c.py)/Math.abs(c.py)*100) : '—']) };

  const GaugeSVG = ({ value, label, py }) => {
  const clamp = v => Math.max(-30, Math.min(30, v));
  const angle = (clamp(value) + 30) / 60 * 180 - 90;
  const r = 44;
  const cx = 58;
  const cy2 = 52;
  
  const toXY = (deg) => {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy2 + r * Math.sin(rad) };
  };
  
  const arcPath = (from, to, color, rr) => {
    const a = toXY(from * 3), b = toXY(to * 3);
    const large = (to - from) * 3 > 180 ? 1 : 0;
    return `<path d="M ${a.x} ${a.y} A ${rr} ${rr} 0 ${large} 1 ${b.x} ${b.y}" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="butt"/>`;
  };
  
  const color = value >= 10 ? '#2E9B62' : value >= 0 ? '#E5A93D' : '#D95C5C';
  const px2 = toXY(angle);
  
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:1 }}>
      <svg viewBox="0 0 116 68" style={{ width:'100%', maxWidth:150,overflow:'visible' }}>
        <g dangerouslySetInnerHTML={{ __html:
          arcPath(-30,0,'#D95C5C',r) + arcPath(0,10,'#E5A93D',r) + arcPath(10,30,'#2E9B62',r) +
          `<line x1="${cx}" y1="${cy2}" x2="${px2.x}" y2="${px2.y}" stroke="#1F3741" stroke-width="3" stroke-linecap="round"/>`+
          `<circle cx="${cx}" cy="${cy2}" r="4" fill="#1F3741"/>`
        }} />
      </svg>
      <div style={{ fontSize:19, fontWeight:800, fontFamily:'JetBrains Mono,monospace', color, marginTop:-4 }}>{value.toFixed(1).replace('.',',')}%</div>
      <div style={{ fontSize:10, color:'var(--muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginTop:2 }}>{label}</div>
      <div style={{ fontSize:10, color:'var(--muted)', marginTop:1 }}>2025: {py.toFixed(1).replace('.',',')}%</div>
    </div>
  );
};
  const gaugeTable = { headers: ['Metric','2026 (Jan–Mar)','2025 (Jan–Jun)'],
    rows: [['Gross Margin %', gmCY.toFixed(1).replace('.',',')+'%', gmPY.toFixed(1).replace('.',',')+'%'],
           ['EBITDA Margin %', emCY.toFixed(1).replace('.',',')+'%', emPY.toFixed(1).replace('.',',')+'%']] };

  const bridgeSteps = [
    { name: 'Revenue', delta: revCY - revPY },
    { name: 'COGS', delta: -(cogsCY - cogsPY) },
    { name: 'OpEx', delta: -(opexCY - opexPY) },
  ];
  const biggestBridgeMove = bridgeSteps.reduce((a, b) => Math.abs(b.delta) > Math.abs(a.delta) ? b : a);
  const bridgeInsight = `EBITDA margin ${emCY >= emPY ? 'improved' : 'declined'} to ${emCY.toFixed(1).replace('.',',')}% (vs ${emPY.toFixed(1).replace('.',',')}% PY) · Largest driver: ${biggestBridgeMove.name} (${biggestBridgeMove.delta >= 0 ? '+' : ''}${fmtFull(biggestBridgeMove.delta)})`;

  const tornSorted = [...finCategories].map(c => ({ cat: c.cat, delta: c.cy - c.py, bad: c.cat==='Revenue' ? (c.cy-c.py)<0 : (c.cy-c.py)>0 }));
  const worstMover = tornSorted.filter(c => c.bad).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta))[0];
  const bestMover = tornSorted.filter(c => !c.bad).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta))[0];
  const tornadoInsight = [
    bestMover ? `Best mover: ${bestMover.cat} (${bestMover.delta >= 0 ? '+' : ''}${fmtFull(bestMover.delta)})` : null,
    worstMover ? `Watch: ${worstMover.cat} (${worstMover.delta >= 0 ? '+' : ''}${fmtFull(worstMover.delta)})` : null,
  ].filter(Boolean).join(' · ') || null;

  return (
    <div className="page-area fin-scroll" key="plsummary">
      <div className="fin-note">⚠ Partial periods: 2026 = Jan–Mar · 2025 = Jan–Jun</div>
      <div className="kpi-strip">
        <div className="kpi-card blue">
          <div className="kpi-lbl">Revenue</div>
          <div className="kpi-val sm">{fmtFull(revCY)}</div>
          <div className="kpi-chg"><YoyBadge cy={revCY} py={revPY} goodIfUp /></div>
        </div>
        <div className="kpi-card sky">
          <div className="kpi-lbl">Gross Margin<span className="indicative-tag">Indicative</span></div>
          <div className="kpi-val sm">{fmtFull(gpCY)}</div>
          <div className="kpi-chg">{gmCY.toFixed(1).replace('.',',')}% margin · vs {gmPY.toFixed(1).replace('.',',')}% PY</div>
        </div>
        <div className="kpi-card amber">
          <div className="kpi-lbl">OpEx</div>
          <div className="kpi-val sm">{opexPctCY.toFixed(1).replace('.',',')}%</div>
          <div className="kpi-chg">{fmtFull(opexCY)} · of turnover</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-lbl">EBITDA<span className="indicative-tag">Indicative</span></div>
          <div className="kpi-val sm">{fmtFull(ebitdaCY)}</div>
          <div className="kpi-chg">{emCY.toFixed(1).replace('.',',')}% margin · vs {emPY.toFixed(1).replace('.',',')}% PY</div>
        </div>
        <div className="kpi-card navy">
          <div className="kpi-lbl">Net Margin (after Tax)<span className="indicative-tag">Indicative</span></div>
          {hasTaxData ? (
            <>
              <div className="kpi-val sm">{fmtFull(netCY)}</div>
              <div className="kpi-chg">{nmCY.toFixed(1).replace('.',',')}% margin · vs {nmPY.toFixed(1).replace('.',',')}% PY</div>
            </>
          ) : (
            <>
              <div className="kpi-val sm">—</div>
              <div className="kpi-chg">Pending — awaiting tax data</div>
            </>
          )}
        </div>
      </div>

      <div className="charts-row">
        <Panel title="P&L Bridge" subtitle="2026 Jan–Mar" height={420} className="fin-fixed" style={{flex:1}} tableHeaders={wfTable.headers} tableRows={wfTable.rows} insight={bridgeInsight}>
          <EC option={wfOpt} />
        </Panel>
        <Panel title="Margin Health" subtitle="Gross & EBITDA margins" tag="Indicative" height={420} className="fin-fixed" style={{flex:0.8}} tableHeaders={gaugeTable.headers} tableRows={gaugeTable.rows}>
          <div style={{display:'flex', flexDirection:'column', gap:18, height:'100%', alignItems:'center', justifyContent:'center', padding:'4px 0'}}>
            <GaugeSVG value={gmCY} label="Gross Margin" py={gmPY} />
            <div style={{height:1, background:'var(--border)', alignSelf:'stretch'}} />
            <GaugeSVG value={emCY} label="EBITDA Margin" py={emPY} />
          </div>
        </Panel>
        <Panel title="Category YoY Change" subtitle="Green = favorable" height={420} className="fin-fixed" style={{flex:1}} defaultView="table" tableHeaders={tornTable.headers} tableRows={tornTable.rows} insight={tornadoInsight}>
          <EC option={tornOpt} />
        </Panel>
      </div>
    </div>
  );
}

/* ── PAGE: REVENUE & COSTS ──────────────────────────────────── */
function FinRevCosts() {
  const revenueLines = useMemo(() => finLines.filter(l => l.cat === 'Revenue').sort((a,b) => b.cy - a.cy), []);
  const costLines = useMemo(() => finLines.filter(l => l.cat !== 'Revenue').sort((a,b) => b.cy - a.cy), []);
  const anomalies = useMemo(() => finLines.filter(l => l.cat!=='Revenue' && l.cy>l.py && Math.abs(l.cy)>500).sort((a,b) => b.yoy - a.yoy), []);
  const topRev = revenueLines.slice(0,10);
  const topCost = costLines.slice(0,10);
  const topAnom = anomalies.slice(0,10);

  const revOpt = mkBarOpt(topRev.map(l=>l.desc), topRev.map(l=>l.cy), () => '#40BCF3');
  const costOpt = mkBarOpt(topCost.map(l=>l.desc), topCost.map(l=>l.cy), () => '#35A9DE');
  const anomOpt = mkBarOpt(topAnom.map(l=>l.desc), topAnom.map(l=>l.yoy), () => '#1F3741');

  const revCY = finSummary.revenue.cy, revPY = finSummary.revenue.py;
  const cogsCY = finSummary.cogs.cy, cogsPY = finSummary.cogs.py;

  const revTbl = { headers:['Acct','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','YoY %'],
    rows: revenueLines.slice(0,15).map(l=>[l.acct,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),l.yoyPct!==null?fmtPct(l.yoyPct):'—']) };
  const costTbl = { headers:['Acct','Cat','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','% of Turnover','Relative Difference'],
    rows: costLines.slice(0,20).map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),
      revCY?fmtPct(l.cy/revCY*100):'—', l.yoyPct!==null?fmtPct(l.yoyPct):'—']) };
  const anomTbl = { headers:['Acct','Cat','Description','2026 (Jan–Mar)','YoY €','% of Turnover','Relative Difference'],
    rows: anomalies.map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.yoy),
      revCY?fmtPct(l.cy/revCY*100):'—', l.yoyPct!==null?fmtPct(l.yoyPct):'—']) };

  const costCats = finCategories.filter(c => c.cat !== 'Revenue');
  const costPctPeriods = ['2025 (Jan–Jun)', '2026 (Jan–Mar)'];
  const costPctSeries = costCats.map((c, i) => ({
    name: c.cat,
    type: 'line',
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
    itemStyle: { color: PALETTE[i % PALETTE.length] },
    data: [
      revPY ? +(c.py / revPY * 100).toFixed(2) : 0,
      revCY ? +(c.cy / revCY * 100).toFixed(2) : 0,
    ],
  }));
  const costPctOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis',
      formatter: p => `<strong>${p[0].axisValue}</strong><br/>` + p.map(i => `${i.marker} ${i.seriesName}: ${i.value.toFixed(1).replace('.',',')}%`).join('<br/>') },
    legend: { top: 0, textStyle: { color: '#5F7078', fontSize: 9 }, itemWidth: 10, itemHeight: 10 },
    grid: { left: 44, right: 20, bottom: 24, top: 34, containLabel: true },
    xAxis: { type: 'category', data: costPctPeriods, axisLabel: { color: '#5F7078', fontSize: 9 }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 8, formatter: v => v + '%' },
      splitLine: { lineStyle: { color: '#F0F3F4' } }, axisTick: { show: false } },
    series: costPctSeries,
  };
  const costPctTbl = { headers: ['Category', '2025 (Jan–Jun) %', '2026 (Jan–Mar) %', 'Change (pts)'],
    rows: costCats.map(c => {
      const pctPY = revPY ? (c.py / revPY * 100) : 0;
      const pctCY = revCY ? (c.cy / revCY * 100) : 0;
      return [c.cat, fmtPct(pctPY), fmtPct(pctCY), fmtPct(pctCY - pctPY)];
    }) };

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
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Top Revenue Lines" subtitle="2026 Jan–Mar, largest first" height={420} className="fin-fixed" tableHeaders={revTbl.headers} tableRows={revTbl.rows}>
            <EC option={revOpt} />
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Top Cost Lines" subtitle="2026 Jan–Mar, largest first" height={420} className="fin-fixed" tableHeaders={costTbl.headers} tableRows={costTbl.rows}>
            <EC option={costOpt} />
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Cost Increases" subtitle="YoY watch list" height={420} className="fin-fixed" tableHeaders={anomTbl.headers} tableRows={anomTbl.rows}>
            <EC option={anomOpt} />
          </Panel>
        </div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{flex:1}}>
          <Panel title="Cost Categories as % of Turnover" subtitle="2025 (Jan–Jun) vs 2026 (Jan–Mar)" height={340} className="fin-fixed" tableHeaders={costPctTbl.headers} tableRows={costPctTbl.rows}>
            <EC option={costPctOpt} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ── PAGE: LEDGER & ANOMALIES ────────────────────────────────── */
function FinLedger() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const newCosts = useMemo(()=>finLines.filter(l=>l.cat!=='Revenue'&&l.cy>0&&l.py===0&&Math.abs(l.cy)>500).sort((a,b)=>b.cy-a.cy),[]);
  const goneRevenue = useMemo(()=>finLines.filter(l=>l.cat==='Revenue'&&l.cy===0&&l.py>0).sort((a,b)=>b.py-a.py),[]);
  const cats = ['All', ...FIN_CAT_ORDER.filter(c => finLines.some(l => l.cat === c))];
  const filtered = finLines.filter(l =>
    (cat==='All'||l.cat===cat) &&
    (q.trim()===''||l.desc.toLowerCase().includes(q.toLowerCase())||String(l.acct).includes(q))
  ).sort((a,b)=>Math.abs(b.cy)-Math.abs(a.cy));
  const revCY = finSummary.revenue.cy;
  const rows = filtered.map(l=>[l.acct,l.cat,l.desc,fmtFull(l.cy),fmtFull(l.py),fmtFull(l.yoy),
    revCY?fmtPct(l.cy/revCY*100):'—', l.yoyPct!==null?fmtPct(l.yoyPct):'—']);

  const sideColRef = useRef(null);
  const [sideH, setSideH] = useState(null);
  useLayoutEffect(() => {
    const el = sideColRef.current;
    if (!el) return;
    const measure = () => setSideH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [newCosts.length, goneRevenue.length]);

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
          <Panel title="Full Account Ledger" subtitle={`${fmtN(finLines.length)} lines · search & filter`}
            className="ledger-fixed" height={sideH || 300}>
            <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
              <div className="ledger-toolbar">
                <input className="ledger-search" placeholder="Search account # or description…" value={q} onChange={e=>setQ(e.target.value)} />
                <span className="ledger-count">{fmtN(filtered.length)} / {fmtN(finLines.length)}</span>
              </div>
              <div className="ledger-cats">
                {cats.map(c=>(
                  <button key={c} className={`filter-chip${cat===c?' active':''}`} style={{fontSize:9,padding:'2px 7px'}} onClick={()=>setCat(c)}>{c}</button>
                ))}
              </div>
              <div style={{flex:1,minHeight:0}}>
                <InlineTable headers={['Acct','Category','Description','2026 (Jan–Mar)','2025 (Jan–Jun)','YoY €','% of Turnover','Relative Difference']} rows={rows} height="100%" />
              </div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{flex:1}} ref={sideColRef}>
          <Panel title="🆕 New Costs in 2026" subtitle="Not present in 2025" className="hug">
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {newCosts.length===0 ? <div className="watch-empty">None detected</div> :
                newCosts.map(l=>(
                  <div className="watch-row" key={l.acct}>
                    <div className="watch-row-desc" title={l.desc}>{l.desc}</div>
                    <div className="watch-row-amt">{fmtFull(l.cy)} · {l.cat}</div>
                  </div>
                ))}
            </div>
          </Panel>
          <Panel title="🔻 Revenue Lost" subtitle="Had 2025 revenue, now zero" className="hug">
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {goneRevenue.length===0 ? <div className="watch-empty">None detected</div> :
                goneRevenue.map(l=>(
                  <div className="watch-row" key={l.acct}>
                    <div className="watch-row-desc" title={l.desc}>{l.desc}</div>
                    <div className="watch-row-amt">was {fmtFull(l.py)}</div>
                  </div>
                ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
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
const PAGE_NAMES = {overview:'Overview Dashboard',revenue:'Revenue Trends',salesreps:'Verkoper',customers:'Top Customers',products:'Product Analysis',categories:'Category Breakdown',channels:'Channel Mix',plsummary:'P&L Summary',finrevcosts:'Revenue & Costs',finledger:'Ledger'};

const SUGGESTED_QUESTIONS = {
  overview: ['How is revenue trending this month?', 'Which category is driving sales right now?', 'Who is this month\'s top verkoper?'],
  revenue: ['What was our best month on record?', 'How does this period compare to the previous one?', 'What\'s the average monthly revenue?'],
  salesreps: ['Who is the top-performing verkoper?', 'How concentrated is revenue among the top 3 reps?', 'Break down sales by verkoper and category'],
  customers: ['Who are our top 5 customers?', 'What share of revenue comes from our top customers?', 'What\'s the average revenue per client?'],
  products: ['What is our best-selling product?', 'How concentrated is revenue across products?', 'Show me products with the smallest share'],
  categories: ['Which category has the biggest share of revenue?', 'How many active category groups are there?', 'Compare the top two categories'],
  channels: ['Which channel drives the most revenue?', 'How is revenue split across channels?'],
  plsummary: ['How is gross margin trending?', 'What is driving EBITDA this period?'],
  finrevcosts: ['What are our biggest cost drivers?', 'How do revenue and costs compare year over year?'],
  finledger: ['What are the largest YoY swings in the ledger?', 'Which accounts saw the biggest cost increases?'],
  default: ['What can you tell me about this page?', 'Summarize the key numbers here'],
};

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const AUTH_KEY = 'dairytop_auth';
const AUTH_ACTIVITY_KEY = 'dairytop_auth_activity';
const ACTIVITY_WRITE_THROTTLE_MS = 5000;

function Sidebar({ page, setPage, sideOpen, setSideOpen, collapsed, toggleCollapsed, setHighlightQuery, dateRange, totalTx, totalClients, handleLogout }) {
  const [navFlyout, setNavFlyout] = useState(null);
  const handleNavHover = (e, item) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setNavFlyout({ id: item.id, icon: item.icon, label: item.label, desc: item.desc, top: rect.top + rect.height / 2, left: rect.right + 6 });
  };
  const handleNavLeave = () => setNavFlyout(null);
  const goTo = (id) => { setPage(id); setSideOpen(false); setHighlightQuery(null); };

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
                {i>0 && <div className="nav-divider"/>}
                <div className="nav-section">{s.section}</div>
                {s.items.map(item=>(
                  <div key={item.id} className={`nav-item${page===item.id?' active':''}${navFlyout?.id===item.id?' hovered':''}`}
                    onClick={()=>goTo(item.id)}
                    onMouseEnter={(e)=>handleNavHover(e,item)}
                    onMouseLeave={handleNavLeave}
                    role="button" tabIndex={0} onKeyDown={e=>e.key==='Enter'&&goTo(item.id)}>
                    <span className="nav-icon">{item.icon}</span>
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
            <button className="logout-btn" onClick={handleLogout} title={collapsed ? 'Sign out' : undefined}
              onMouseEnter={(e)=>collapsed && handleNavHover(e,{id:'logout',icon:'↩',label:'Sign out',desc:'End your session'})}
              onMouseLeave={handleNavLeave}>
              <span>↩</span><span className="logout-btn-label"> Sign out</span>
            </button>
          </div>
        </div>
        <button
          className="sb-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {navFlyout && createPortal(
        <div key={navFlyout.id} className="nav-flyout" style={{ top: navFlyout.top, left: navFlyout.left, transform: 'translateY(-50%)' }}>
          <span className="nav-flyout-badge">{navFlyout.icon}</span>
          <span className="nav-flyout-text">
            <span className="nav-flyout-title">{navFlyout.label}</span>
            {navFlyout.desc && <span className="nav-flyout-desc">{navFlyout.desc}</span>}
          </span>
          <span className="nav-flyout-chevron">›</span>
        </div>,
        document.body
      )}
    </>
  );
}

const AUTH_USER_KEY = 'dairytop_username';

export default function App() {
  const [userName, setUserName] = useState(() => {
    try { return localStorage.getItem(AUTH_USER_KEY) || ''; } catch { return ''; }
  });
  const [authed, setAuthed] = useState(() => {
    const savedAuth = localStorage.getItem(AUTH_KEY);
    const lastActivity = localStorage.getItem(AUTH_ACTIVITY_KEY);

    if (savedAuth === 'true' && lastActivity) {
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed < SESSION_TIMEOUT_MS) {
        return true;
      } else {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(AUTH_ACTIVITY_KEY);
        return false;
      }
    }
    return false;
  });
  
  const SESSION_PAGE_KEY = 'dairytop_last_page';
  const SESSION_FILTER_KEY = 'dairytop_last_filter';
  const [page, setPage] = useState(() => sessionStorage.getItem(SESSION_PAGE_KEY) || 'overview');
  const [filter, setFilter] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_FILTER_KEY);
      return saved ? JSON.parse(saved) : { years: [], months: {} };
    } catch { return { years: [], months: {} }; }
  });
  const [sideOpen, setSideOpen] = useState(false);

  const SIDEBAR_COLLAPSE_KEY = 'dairytop_sidebar_collapsed';
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) || 'false'); } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  useEffect(() => {
    const DURATION = 340;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      liveChartInstances.forEach(inst => { try { inst.resize(); } catch { /* instance may have just unmounted */ } });
      if (now - start < DURATION) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [collapsed]);

  const [time, setTime] = useState(new Date());

  useEffect(() => { sessionStorage.setItem(SESSION_PAGE_KEY, page); }, [page]);
  useEffect(() => { try { sessionStorage.setItem(SESSION_FILTER_KEY, JSON.stringify(filter)); } catch {} }, [filter]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightQuery, setHighlightQuery] = useState(null);
  const searchIndex = useMemo(() => {
    const seen = new Set();
    const idx = [];
    customersRaw.forEach(c => { if (!seen.has('c:'+c.n)) { seen.add('c:'+c.n); idx.push({ name: c.n, type: 'Customer', page: 'customers' }); } });
    productsRaw.forEach(p => { if (!seen.has('p:'+p.n)) { seen.add('p:'+p.n); idx.push({ name: p.n, type: 'Product', page: 'products' }); } });
    salesrepsRaw.forEach(r => { if (!seen.has('r:'+r.n)) { seen.add('r:'+r.n); idx.push({ name: r.n, type: 'Verkoper', page: 'salesreps' }); } });
    categoriesRaw.forEach(c => { if (!seen.has('cat:'+c.n)) { seen.add('cat:'+c.n); idx.push({ name: c.n, type: 'Category', page: 'categories' }); } });
    return idx;
  }, []);
  const SEARCH_GROUPS = [
    { type: 'Customer', page: 'customers', label: 'Customers' },
    { type: 'Product', page: 'products', label: 'Products' },
    { type: 'Verkoper', page: 'salesreps', label: 'Verkopers' },
    { type: 'Category', page: 'categories', label: 'Categories' },
  ];
  const MAX_PER_GROUP = 6;
  const groupedResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_GROUPS
      .map(g => {
        const matches = searchIndex.filter(i => i.type === g.type && i.name.toLowerCase().includes(q));
        return { ...g, items: matches.slice(0, MAX_PER_GROUP), total: matches.length };
      })
      .filter(g => g.items.length > 0);
  }, [searchQuery, searchIndex]);
  const firstResult = groupedResults[0]?.items?.[0];
  const goToSearchResult = (result) => {
    setPage(result.page);
    setHighlightQuery(result.name);
    setSearchQuery(result.name);
    setSearchOpen(false);
  };

  const searchRef = useRef(null);
  const searchResultsRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current?.contains(e.target)) return;
      if (searchResultsRef.current?.contains(e.target)) return;
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [searchPos, setSearchPos] = useState(null);
  useLayoutEffect(() => {
    if (searchOpen && searchQuery.trim() && searchRef.current) {
      const rect = searchRef.current.getBoundingClientRect();
      setSearchPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
        width: Math.max(rect.width, 300),
      });
    }
  }, [searchOpen, searchQuery, groupedResults.length]);
  useEffect(() => {
    if (!searchOpen) return;
    const close = (e) => {
      if (searchResultsRef.current?.contains(e.target)) return;
      setSearchOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!authed) return;

    let lastWrite = 0;
    const markActive = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      localStorage.setItem(AUTH_ACTIVITY_KEY, now.toString());
    };

    markActive();

    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'click'];
    events.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    return () => {
      events.forEach(evt => window.removeEventListener(evt, markActive));
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;

    const checkSession = () => {
      const lastActivity = localStorage.getItem(AUTH_ACTIVITY_KEY);
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed >= SESSION_TIMEOUT_MS) {
          localStorage.removeItem(AUTH_KEY);
          localStorage.removeItem(AUTH_ACTIVITY_KEY);
          setAuthed(false);
        }
      }
    };

    const interval = setInterval(checkSession, 10000);
    return () => clearInterval(interval);
  }, [authed]);

  useEffect(() => { 
    const t = setInterval(()=>setTime(new Date()),30000); 
    return ()=>clearInterval(t); 
  }, []);

  const handleLogin = (username) => {
    setAuthed(true);
    localStorage.setItem(AUTH_KEY, 'true');
    localStorage.setItem(AUTH_ACTIVITY_KEY, Date.now().toString());
    setUserName(username || '');
    try { localStorage.setItem(AUTH_USER_KEY, username || ''); } catch {}
  };

  const handleLogout = () => {
    setAuthed(false);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_ACTIVITY_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setUserName('');
  };

  const fm = useMemo(()=>{
    if(!filter.years||filter.years.length===0)return monthly;
    return monthly.filter(m=>{
      const [,yr]=m.m.split(' ');
      if(!filter.years.includes(yr))return false;
      const ym=filter.months[yr];
      if(!ym||ym.length===0)return true;
      return ym.includes(m.m);
    });
  },[filter]);

  const filterLabel = useMemo(()=>{
    if(!filter.years||filter.years.length===0)return 'Full period';
    return filter.years.map(y=>{const m=filter.months[y];return m&&m.length?`20${y} (${m.length}m)`:`20${y} (all)`;}).join(', ');
  },[filter]);

  const dateRange = useMemo(()=>{
    if(fm.length===0)return 'No data';
    return `${fm[0].m} – ${fm[fm.length-1].m}`;
  },[fm]);

  const totalTx = useMemo(()=>fm.reduce((s,m)=>s+m.orders,0),[fm]);

  if(!authed)return(<><style>{css}</style><Login onLogin={handleLogin}/></>);

  const renderPage = () => {
    const props={fm,label:filterLabel};
    const searchProps={highlightQuery};
    switch(page){
      case 'overview': return <Overview/>;
      case 'revenue': return <Revenue {...props}/>;
      case 'salesreps': return <SalesReps {...props} {...searchProps}/>;
      case 'customers': return <Customers {...props} {...searchProps}/>;
      case 'products': return <Products {...props} {...searchProps}/>;
      case 'categories': return <Categories {...props} {...searchProps}/>;
      case 'channels': return <Channels {...props}/>;
      case 'plsummary': return <PLSummary/>;
      case 'finrevcosts': return <FinRevCosts/>;
      case 'finledger': return <FinLedger/>;
      default: return <Overview {...props}/>;
    }
  };

  const handleExportPage = () => window.print();

  return (
    <>
            <style>{css}</style>
      <div className="app">
        <button className="mob-toggle" onClick={()=>setSideOpen(v=>!v)} aria-label="Menu">{sideOpen?'✕':'☰'}</button>
        <div className={`mob-overlay${sideOpen?' open':''}`} onClick={()=>setSideOpen(false)}/>

        <Sidebar
          page={page}
          setPage={setPage}
          sideOpen={sideOpen}
          setSideOpen={setSideOpen}
          collapsed={collapsed}
          toggleCollapsed={toggleCollapsed}
          setHighlightQuery={setHighlightQuery}
          dateRange={dateRange}
          totalTx={totalTx}
          totalClients={totalClients}
          handleLogout={handleLogout}
        />

        <div className="main">
          <div className="topbar">
            <div>
              <div className="tb-title">{PAGE_NAMES[page]}</div>
              <div className="tb-sub">
                {page === 'overview' ? (
                  <span>Live · Current month{monthly.length ? ` (${monthly[monthly.length-1].m})` : ''}</span>
                ) : (
                  <>
                    <span>{filterLabel}</span>
                    <span className="tb-sep">·</span>
                    <span>{dateRange}</span>
                    <span className="tb-sep">·</span>
                    <span>All products</span>
                  </>
                )}
              </div>
            </div>
            <div className="tb-right">
              <div className="tb-search" ref={searchRef}>
                <span className="tb-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Find a customer, product, verkoper…"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={e => { if (e.key === 'Enter' && firstResult) goToSearchResult(firstResult); if (e.key === 'Escape') setSearchOpen(false); }}
                  aria-label="Global search"
                />
                {searchOpen && searchQuery.trim() && searchPos && createPortal(
                  <div ref={searchResultsRef} className="tb-search-results" style={{ top: searchPos.top, right: searchPos.right, width: searchPos.width }}>
                    {groupedResults.length === 0 ? (
                      <div className="tb-search-empty">No matches in customers, products, or verkopers</div>
                    ) : groupedResults.map(g => (
                      <div key={g.type} className="tb-search-group">
                        <div className="tb-search-group-head">
                          <span><strong>{g.label}</strong> ({g.total})</span>
                          <span className="tb-search-group-dest">→ {PAGE_NAMES[g.page]}</span>
                        </div>
                        {g.items.map((r, i) => (
                          <div key={i} className="tb-search-item" onClick={() => goToSearchResult(r)}>
                            <span className="tb-search-item-name" title={r.name}>{r.name}</span>
                            <span className="tb-search-item-arrow">→</span>
                          </div>
                        ))}
                        {g.total > g.items.length && (
                          <div className="tb-search-empty" style={{padding:'5px 12px', fontStyle:'normal'}}>
                            +{g.total - g.items.length} more — refine your search
                          </div>
                        )}
                      </div>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
              <button className="tb-print-btn" onClick={handleExportPage} title="Export this page as a PDF via your browser's print dialog">
                ⬇ Export page
              </button>
              <div className="tb-refresh">Updated <strong>{lastUpdated}</strong></div>
              <div className="tb-time">{time.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
              <div className="live-badge"><span className="blink-dot"/>Live</div>
            </div>
          </div>
          {page !== 'overview' && <DateFilterBar filter={filter} setFilter={setFilter}/>}
          {renderPage()}
          
        </div>

        <ChatBot
          context={{ page, pageName: PAGE_NAMES[page], filterLabel, dateRange }}
          suggestedQuestions={SUGGESTED_QUESTIONS[page] || SUGGESTED_QUESTIONS.default}
          userName={formatDisplayName(userName)}
        />
      </div>
    </>
  );
}
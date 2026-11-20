/* ════════════════════════════════════════════════════════════════════════
   DairyTop Business Intelligence — the whole dashboard in one file.
   Data:     src/dash.json (schema 5.0.0) is the only source of figures.
   Chatbot:  src/ChatBot.jsx + src/utils/chat*.js (gets the data model as a prop).
   Sections: format · data model · typography · UI kit · shell (CSS, login) ·
             filters · pages · app shell.
   ════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import ReactECharts from 'echarts-for-react';
import * as XLSX from 'xlsx';
import RAW from './dash.json';
import ChatBot from './ChatBot.jsx';

/* ══════════════════════════════════════════════════════════════════════
   format.js
   ══════════════════════════════════════════════════════════════════════ */
/* Number formatting shared by every page (European style: € 1.234.567, 12,5 t). */
const PALETTE = [
  '#40BCF3', '#1F3741', '#35A9DE', '#8FD5F5', '#5B8FA3', '#C8EAF9',
  '#2E9B62', '#E5A93D', '#D95C5C', '#6C7A80', '#8A9AA1', '#17303A',
];
const EU = 'de-DE';
const bad = n => n === null || n === undefined || Number.isNaN(n);

function fmtFull(n) {
  if (bad(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '€' + Math.abs(Math.round(n)).toLocaleString(EU);
}
function fmt(n) {
  if (bad(n)) return '—';
  const sign = n < 0 ? '-' : '', abs = Math.abs(n);
  if (abs >= 1e6) return sign + '€' + (abs / 1e6).toLocaleString(EU, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + 'M';
  return sign + '€' + Math.round(abs).toLocaleString(EU);
}
function fmtN(n) {
  if (bad(n)) return '—';
  return Math.round(n).toLocaleString(EU);
}
function fmtNum(n) {
  if (bad(n)) return '—';
  const sign = n < 0 ? '-' : '', abs = Math.abs(n);
  if (abs >= 1e6) return sign + (abs / 1e6).toLocaleString(EU, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + 'M';
  return sign + Math.round(abs).toLocaleString(EU);
}
const fmtPct = n => bad(n) ? '—' : (n >= 0 ? '+' : '') + n.toLocaleString(EU, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const fmtEur2 = n => bad(n) ? '—' : (n < 0 ? '-' : '') + '€' + Math.abs(n).toLocaleString(EU, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShare = x => bad(x) || !Number.isFinite(x) ? '—' : x.toLocaleString(EU, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const growth = (a, b) => (b == null || b <= 0 || a == null) ? null : (a - b) / b * 100;

/* ══════════════════════════════════════════════════════════════════════
   model.js
   ══════════════════════════════════════════════════════════════════════ */
/* ─────────────────────────────────────────────────────────────────────────
   DairyTop data model — dash.json is the ONLY source of figures.
   All amounts in dash.json are cents excl. VAT; this module returns euros
   unless a name ends in "C" (cents).
   ───────────────────────────────────────────────────────────────────────── */
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUPS = ['Milk powder', 'Feed', 'Calf housing', 'Calf supplies', 'Perfect Udder', 'Other'];
const GROUP_COLORS = ['#40BCF3', '#2E9B62', '#E5A93D', '#D95C5C', '#5B8FA3', '#8A9AA1'];
const AGE = ['Current', '1–30', '31–60', '61–90', '91+'];
const AGE_COLORS = ['#2E9B62', '#40BCF3', '#E5A93D', '#E07B39', '#D95C5C'];
const DAY = 864e5;

const pad = n => String(n).padStart(2, '0');
const isoOfT = t => new Date(t * DAY).toISOString().slice(0, 10);
const dLab = iso => { const x = new Date(iso + 'T00:00:00Z'); return x.getUTCDate() + ' ' + MN[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };
const mLong = ym => MN[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
const mShort = ym => MN[+ym.slice(5) - 1] + ' ' + ym.slice(2, 4);
const tOf = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const ddmmyy = t => { const d = new Date(t * DAY); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + String(d.getUTCFullYear()).slice(2); };

/* ISO week of a day serial → { key:'W15 26', mon:serial } */
function isoWeek(t) {
  const wd = (new Date(t * DAY).getUTCDay() + 6) % 7;      // Mon=0
  const thu = t - wd + 3, yr = new Date(thu * DAY).getUTCFullYear();
  const wk = 1 + Math.floor((thu - Date.UTC(yr, 0, 1) / DAY) / 7);
  return { key: 'W' + pad(wk) + ' ' + String(yr).slice(2), mon: t - wd };
}

function prepare(R) {
  const X = R, F = R.facts, n = F.r.length;
  X.n = n;
  X.gOfCat = R.categories.map(c => { const g = GROUPS.indexOf(c[1]); return g < 0 ? 5 : g; });
  X.mkts = [...new Set(R.customers.map(c => c[1]))].sort();
  X.cMkt = R.customers.map(c => X.mkts.indexOf(c[1]));
  X.repIdx = new Map(R.verkopers.map((v, i) => [v, i]));
  F.G = F.g.map(g => X.gOfCat[g] ?? 5);
  F.M = F.c.map(c => X.cMkt[c]);
  X.nM = R.months.length;
  X.mLabel = R.months.map(mShort);
  X.portal = new Set(R.meta.portalMonths);
  X.isPortalM = R.months.map(m => X.portal.has(m));
  X.firstDaily = X.isPortalM.indexOf(false);               // first month with day detail
  const lt = R.meta.ledgerThrough, lastM = lt.slice(0, 7);
  const dim = new Date(Date.UTC(+lastM.slice(0, 4), +lastM.slice(5), 0)).getUTCDate();
  X.partial = { m: R.months.indexOf(lastM), day: +lt.slice(8), dim };
  if (X.partial.day >= dim) X.partial.m = -1;
  X.lastFull = X.partial.m >= 0 ? X.partial.m - 1 : X.nM - 1;
  X.ltT = tOf(lt);
  // products sold by weight
  const pk = new Map();
  for (let i = 0; i < n; i++) if (F.k[i]) pk.set(F.p[i], (pk.get(F.p[i]) || 0) + F.k[i]);
  X.kgProd = new Set([...pk].filter(([, k]) => k > 0).map(([p]) => p));
  // day serial + ISO week per fact (Microfas months only)
  F.T = new Array(n); F.W = new Array(n);
  X.weekMon = new Map();
  for (let i = 0; i < n; i++) {
    if (!F.d[i]) { F.T[i] = null; F.W[i] = null; continue; }
    const ym = R.months[F.m[i]];
    const t = Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, F.d[i]) / DAY;
    const w = isoWeek(t);
    F.T[i] = t; F.W[i] = w.key; X.weekMon.set(w.key, w.mon);
  }
  X.weeks = [...X.weekMon.keys()].sort((a, b) => X.weekMon.get(a) - X.weekMon.get(b));
  X.reps = [...new Set([...R.verkopers, ...R.customers.map(c => c[2])])].sort((a, b) => a.localeCompare(b));
  // invoices: one entry per invoice number
  const inv = new Map();
  for (const r of R.invoices) {
    let x = inv.get(r[0]);
    if (!x) { x = { no: r[0], m: r[1], d: r[2], c: r[3], groups: new Set(), cents: 0 }; inv.set(r[0], x); }
    x.groups.add(r[4]); x.cents += r[5];
  }
  X.inv = [...inv.values()];
  X.snapshotLabel = dLab(R.meta.snapshot);
  X.ledgerLabel = dLab(lt);
  return X;
}

const X = prepare(RAW);

/* ── Filters ────────────────────────────────────────────────────────────── */
const DEFAULT_PRESET = 'ytdNow';
function presetList() {
  const L = X.lastFull, ly = X.months[L].slice(0, 4), pm = X.partial.m;
  const out = [];
  if (pm >= 0) out.push(['ytdNow', `Year to date ${X.months[pm].slice(0, 4)} (Jan–${MN[+X.months[pm].slice(5) - 1]} ${X.partial.day})`]);
  out.push(['ytd', `Year to date ${ly} (Jan–${MN[+X.months[L].slice(5) - 1]}, complete months)`]);
  out.push(['lm', `Last complete month (${mLong(X.months[L])})`], ['l3', 'Last 3 complete months'], ['l12', 'Last 12 complete months']);
  if (pm >= 0) out.push(['mtd', `${mLong(X.months[pm])} so far (1–${X.partial.day})`]);
  for (const y of [...new Set(X.months.map(m => m.slice(0, 4)))]) if (X.months.filter(m => m.startsWith(y)).length === 12) out.push(['y' + y, 'Full year ' + y]);
  out.push(['all', `Full period (${mShort(X.months[0])} – ${mShort(X.months[X.nM - 1])})`], ['custom', 'Custom months']);
  return out;
}
function applyPreset(f, p) {
  const L = X.lastFull, pm = X.partial.m, last = X.nM - 1, g = { ...f, preset: p };
  const idx = ym => X.months.indexOf(ym);
  if (p === 'ytdNow') { g.from = idx(X.months[last].slice(0, 4) + '-01'); g.to = last; }
  else if (p === 'ytd') { g.from = idx(X.months[L].slice(0, 4) + '-01'); g.to = L; }
  else if (p === 'lm') { g.from = g.to = L; }
  else if (p === 'l3') { g.from = Math.max(0, L - 2); g.to = L; }
  else if (p === 'l12') { g.from = Math.max(0, L - 11); g.to = L; }
  else if (p === 'mtd') { g.from = g.to = pm; }
  else if (p === 'all') { g.from = 0; g.to = last; }
  else if (p[0] === 'y') { const y = p.slice(1); g.from = idx(y + '-01'); g.to = idx(y + '-12'); }
  if (g.from < 0) g.from = 0;
  return g;
}
function defaultFilter() {
  return applyPreset({ cmp: 'none', reps: [], grps: [], mkts: [], grain: 'month' }, DEFAULT_PRESET);
}
const filterKey = f => JSON.stringify([f.from, f.to, f.cmp, f.reps, f.grps, f.mkts]);
const dimsKey = f => JSON.stringify([f.reps || [], f.grps || [], f.mkts || []]);

function dimText(f) {
  const p = [];
  if (f.reps?.length) p.push('Verkoper: ' + f.reps.join(', '));
  if (f.grps?.length) p.push('Group: ' + f.grps.join(', '));
  if (f.mkts?.length) p.push('Market: ' + f.mkts.join(', '));
  return p.join(' · ') || 'All verkopers, groups and markets';
}

/* Fact predicate for the dimension filters */
function dimPred(f) {
  const F = X.facts;
  const rs = f.reps?.length ? new Set(f.reps.map(r => X.repIdx.get(r)).filter(v => v != null)) : null;
  const gs = f.grps?.length ? new Set(f.grps.map(g => GROUPS.indexOf(g))) : null;
  const ms = f.mkts?.length ? new Set(f.mkts.map(m => X.mkts.indexOf(m))) : null;
  if (f.reps?.length && !rs.size) return () => false;
  return i => (!rs || rs.has(F.v[i])) && (!gs || gs.has(F.G[i])) && (!ms || ms.has(F.M[i]));
}
/* Customer predicate (for receivables, orders, invoices): verkoper + market only */
function custPred(f) {
  const rs = f.reps?.length ? new Set(f.reps) : null, ms = f.mkts?.length ? new Set(f.mkts) : null;
  return c => c >= 0 && (!rs || rs.has(X.customers[c][2])) && (!ms || ms.has(X.customers[c][1]));
}

/* ── Periods (current + comparison) ─────────────────────────────────────── */
function period(f) {
  const cur = [];
  for (let m = f.from; m <= f.to; m++) cur.push({ m, cap: m === X.partial.m ? X.partial.day : 99 });
  const lab = (a, b) => a === b ? mLong(X.months[a]) : mLong(X.months[a]) + ' – ' + mLong(X.months[b]);
  const P = { cur, cmp: null, curCmp: cur, note: '', label: lab(f.from, f.to) + (f.to === X.partial.m ? ` (to ${X.partial.day})` : '') };
  P.months = cur.map(c => c.m);
  if (f.cmp === 'none') { P.note = 'No comparison selected.'; return P; }
  const shift = f.cmp === 'py' ? 12 : cur.length, cmp = [], used = [];
  for (const c of cur) {
    const m = c.m - shift;
    if (m < 0) { P.note = f.cmp === 'py' ? `No data for the same months a year earlier (data starts ${mLong(X.months[0])}).` : `No data before ${mLong(X.months[0])}.`; return P; }
    if (c.cap < 99 && X.isPortalM[m]) {
      P.note = `${mLong(X.months[c.m])} runs to day ${c.cap}, ${mLong(X.months[m])} has monthly totals only, so it is left out of the change.`;
      continue;
    }
    cmp.push({ m, cap: c.cap }); used.push(c);
  }
  if (!cmp.length) return P;
  P.cmp = cmp; P.curCmp = used;
  P.cmpLabel = lab(cmp[0].m, cmp[cmp.length - 1].m) + (cmp[cmp.length - 1].cap < 99 ? ` (days 1–${cmp[cmp.length - 1].cap})` : '');
  return P;
}

/* Fact indexes for a list of {m,cap} with an extra predicate */
const _monIdx = (() => {
  const by = Array.from({ length: X.nM }, () => []);
  for (let i = 0; i < X.n; i++) by[X.facts.m[i]].push(i);
  return by;
})();
function pick(list, pred) {
  if (!list) return null;
  const F = X.facts, out = [];
  for (const { m, cap } of list) for (const i of _monIdx[m]) {
    if (cap < 99 && F.d[i] > cap) continue;
    if (pred && !pred(i)) continue;
    out.push(i);
  }
  return out;
}
const sumCol = (ix, col) => { if (!ix) return null; const a = X.facts[col]; let s = 0; for (const i of ix) s += a[i]; return s; };
function by(ix, keyFn, col = 'r') { const m = new Map(); if (!ix) return m; const a = X.facts[col]; for (const i of ix) { const k = keyFn(i); m.set(k, (m.get(k) || 0) + a[i]); } return m; }

/* Sales KPI for a filter (+ optional extra predicate) */
function sales(f, extra) {
  const P = period(f), dp = dimPred(f), pred = extra ? i => dp(i) && extra(i) : dp;
  const cur = pick(P.cur, pred), curC = P.cmp ? pick(P.curCmp, pred) : null, cmp = pick(P.cmp, pred);
  return {
    P, cur, cmp, curC,
    rev: sumCol(cur, 'r') / 100, revC: cmp ? sumCol(cmp, 'r') / 100 : null, revCur4Cmp: curC ? sumCol(curC, 'r') / 100 : null,
    kg: sumCol(cur, 'k'), kgC: cmp ? sumCol(cmp, 'k') : null, kgCur4Cmp: curC ? sumCol(curC, 'k') : null,
    q: sumCol(cur, 'q') / X.qScale, qC: cmp ? sumCol(cmp, 'q') / X.qScale : null, qCur4Cmp: curC ? sumCol(curC, 'q') / X.qScale : null,
  };
}

/* Invoices (orders) for a filter — Microfas months only */
function invoices(f, monthsList) {
  const cp = custPred(f), gs = f.grps?.length ? new Set(f.grps.map(g => GROUPS.indexOf(g))) : null;
  const ms = new Set(monthsList);
  return X.inv.filter(v => ms.has(v.m) && cp(v.c) && (!gs || [...v.groups].some(g => gs.has(g))));
}

/* Volume of a fact in its own unit (kg for weight products, pieces otherwise) */
const qtyOf = i => X.kgProd.has(X.facts.p[i]) ? X.facts.k[i] : X.facts.q[i] / X.qScale;

/* ── Legacy-shaped series (what the original pages consume) ──────────────
   Built once per dimension filter; every page then slices by month/week. */
const _legacyCache = new Map();
function legacy(f) {
  const key = dimsKey(f);
  if (_legacyCache.has(key)) return _legacyCache.get(key);
  const F = X.facts, pred = dimPred(f), cp = custPred(f);
  const gs = f.grps?.length ? new Set(f.grps.map(g => GROUPS.indexOf(g))) : null;
  const M = X.mLabel;
  const mk = () => new Map();
  const add = (map, k, r, qty, kg, extra) => { let x = map.get(k); if (!x) { x = { rev: 0, qty: 0, kg: 0, ...extra }; map.set(k, x); } x.rev += r; x.qty += qty; x.kg += kg; return x; };
  const mon = mk(), wk = mk(), dy = mk(), repM = mk(), repW = mk(), cuM = mk(), cuW = mk(), prM = mk(), prW = mk(), caM = mk(), caW = mk(), grM = mk(), mkM = mk();
  const daySets = new Map(); // product/category order-days
  const ds = (k, c, t) => { let s = daySets.get(k); if (!s) { s = new Set(); daySets.set(k, s); } s.add(c + ':' + t); };
  for (let i = 0; i < X.n; i++) {
    if (!pred(i)) continue;
    const r = F.r[i] / 100, kg = F.k[i], qty = qtyOf(i), m = F.m[i];
    const rep = X.verkopers[F.v[i]], cu = X.customers[F.c[i]][0], pr = X.products[F.p[i]][0], ca = X.categories[F.g[i]][0];
    add(mon, m, r, qty, kg); add(grM, F.G[i] + '|' + m, r, qty, kg); add(mkM, F.M[i] + '|' + m, r, qty, kg);
    add(repM, rep + '|' + m, r, qty, kg); add(cuM, cu + '|' + m, r, qty, kg); add(prM, pr + '|' + m, r, qty, kg, { cat: ca }); add(caM, ca + '|' + m, r, qty, kg);
    if (F.T[i] != null) {
      const w = F.W[i], t = F.T[i];
      add(wk, w, r, qty, kg); add(dy, t, r, qty, kg);
      add(repW, rep + '|' + w, r, qty, kg); add(cuW, cu + '|' + w, r, qty, kg); add(prW, pr + '|' + w, r, qty, kg); add(caW, ca + '|' + w, r, qty, kg);
      ds('pm|' + pr + '|' + m, F.c[i], t); ds('pw|' + pr + '|' + w, F.c[i], t);
      ds('cm|' + ca + '|' + m, F.c[i], t); ds('cw|' + ca + '|' + w, F.c[i], t);
    }
  }
  // invoices → order counts (total, per rep, per customer) by month / week / day
  const oM = new Map(), oW = new Map(), oD = new Map(), oRepM = new Map(), oRepW = new Map(), oCuM = new Map(), oCuW = new Map();
  const inc = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const v of X.inv) {
    if (!cp(v.c) || (gs && ![...v.groups].some(g => gs.has(g)))) continue;
    const ym = X.months[v.m], t = Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, v.d) / DAY, w = isoWeek(t).key;
    const rep = X.customers[v.c][2], cu = X.customers[v.c][0];
    inc(oM, v.m); inc(oW, w); inc(oD, t); inc(oRepM, rep + '|' + v.m); inc(oRepW, rep + '|' + w); inc(oCuM, cu + '|' + v.m); inc(oCuW, cu + '|' + w);
  }
  const ordM = m => X.isPortalM[m] ? null : (oM.get(m) || 0);
  const r0 = v => Math.round(v);
  const monthly = X.months.map((ym, m) => { const x = mon.get(m) || { rev: 0, qty: 0, kg: 0 }; return { m: M[m], mi: m, iso: ym, rev: r0(x.rev), orders: ordM(m), qty: x.qty, kg: x.kg }; });
  const weekly = X.weeks.map(w => { const x = wk.get(w) || { rev: 0, qty: 0, kg: 0 }, mon0 = X.weekMon.get(w); return { w, mon: mon0, start: ddmmyy(mon0), end: ddmmyy(mon0 + 6), rev: r0(x.rev), orders: oW.get(w) || 0, qty: x.qty, kg: x.kg }; });
  const daily = [...dy.keys()].sort((a, b) => a - b).map(t => { const x = dy.get(t); return { d: ddmmyy(t), t, iso: isoOfT(t), rev: r0(x.rev), orders: oD.get(t) || 0, qty: x.qty, kg: x.kg }; });
  const flatM = (map, oMap, daysKey) => [...map].map(([k, x]) => { const [n, mm] = k.split('|'); const m = +mm; return { n, m: M[m], mi: m, rev: r0(x.rev), qty: x.qty, kg: x.kg, cat: x.cat, orders: X.isPortalM[m] ? null : (oMap ? (oMap.get(n + '|' + m) || 0) : (daySets.get(daysKey + '|' + n + '|' + m)?.size || 0)) }; });
  const flatW = (map, oMap, daysKey) => [...map].map(([k, x]) => { const [n, w] = k.split('|'); return { n, w, rev: r0(x.rev), qty: x.qty, kg: x.kg, orders: oMap ? (oMap.get(n + '|' + w) || 0) : (daySets.get(daysKey + '|' + n + '|' + w)?.size || 0) }; });
  const out = {
    monthly, weekly, daily,
    salesreps: flatM(repM, oRepM), salesrepsWeekly: flatW(repW, oRepW),
    customers: flatM(cuM, oCuM), customersWeekly: flatW(cuW, oCuW),
    products: flatM(prM, null, 'pm'), productsWeekly: flatW(prW, null, 'pw'),
    categories: flatM(caM, null, 'cm'), categoriesWeekly: flatW(caW, null, 'cw'),
    groupsMonthly: [...grM].map(([k, x]) => { const [g, m] = k.split('|').map(Number); return { g, n: GROUPS[g], mi: m, m: M[m], rev: r0(x.rev), kg: x.kg, qty: x.qty }; }),
    marketsMonthly: [...mkM].map(([k, x]) => { const [g, m] = k.split('|').map(Number); return { k: g, n: X.mkts[g], mi: m, m: M[m], rev: r0(x.rev), kg: x.kg }; }),
  };
  _legacyCache.set(key, out);
  return out;
}



/* ── Receivables ───────────────────────────────────────────────────────── */
function arKPI(f, inPeriod) {
  const cp = custPred(f);
  let R = X.ar.filter(a => cp(a[0]));
  if (inPeriod) { const lo = X.months[f.from], hi = X.months[f.to]; R = R.filter(a => a[2].slice(0, 7) >= lo && a[2].slice(0, 7) <= hi); }
  let open = 0, over = 0, over30 = 0, credit = 0, nOpen = 0, billed = 0;
  const byAge = new Map(AGE.map(a => [a, 0]));
  for (const a of R) {
    billed += a[4];
    const b = a[6];
    if (b > 0) { open += b; nOpen++; byAge.set(a[7], (byAge.get(a[7]) || 0) + b); if (a[7] !== 'Current') over += b; if (a[7] !== 'Current' && a[7] !== '1–30') over30 += b; }
    if (b < 0) credit += b;
  }
  return { R, open: open / 100, over: over / 100, over30: over30 / 100, credit: credit / 100, nOpen, net: (open + credit) / 100, billed: billed / 100, byAge: new Map([...byAge].map(([k, v]) => [k, v / 100])) };
}


/* Open order value (needs dash.json ≥ 5.0.0: order lines carry € values) */
const hasOrderValues = (X.openLines || []).some(l => l.length >= 12);
function orderValue(O) {
  const sg = new Map(O.map(o => [o[0], o[12]])); let del = 0, left = 0, unp = 0; const rows = [];
  for (const l of X.openLines || []) {
    const g = sg.get(l[0]); if (g !== 'toDeliver' && g !== 'deliveredNotInvoiced') continue;
    if (!l[11]) { unp++; continue; }
    const vd = l[10], vr = Math.max(0, l[9] - l[10]); del += vd; left += vr; rows.push({ l, g, vd: vd / 100, vr: vr / 100 });
  }
  return { del: del / 100, left: left / 100, tot: (del + left) / 100, rows, unp };
}
/* Receivables tie-out, whichever dash.json schema is loaded */
function reconSteps() {
  const R = X.recon;
  if ('legacyOpenCents' in R) {
    const ex = R.cohortBalanceCents + R.legacyOpenCents + R.unallocatedOpenCents, inc = ex + R.vatInOpenItemsCents, tot = inc + R.matchedResidualCents;
    return { steps: [['Open from invoices since ' + dLab(X.meta.arStart), R.cohortBalanceCents, '+'], ['Open from before ' + dLab(X.meta.arStart), R.legacyOpenCents, R.unallocatedOpenCents < 0 ? '−' : '+'], ['Open items without an invoice', Math.abs(R.unallocatedOpenCents), '='], ['Receivables excl. VAT', ex, '+', true], ['VAT on these items', R.vatInOpenItemsCents, '='], ['Open items incl. VAT', inc, '+', true], ['Matched items that do not net to zero', R.matchedResidualCents, '='], ['Debtors account 132000', R.controlCents, '', true]], ok: tot === R.controlCents, diff: R.controlCents - tot };
  }
  const ex = R.cohortBalanceCents + R.legacyOpeningCents + R.legacySettlementCents + R.unallocatedCents + (R.unmatchedInvoiceCents || 0), inc = ex + R.vatInOpenItemsCents;
  return { steps: [['Open from invoices since ' + dLab(X.meta.arStart), R.cohortBalanceCents, '+'], ['Opening balance (before ' + dLab(X.meta.arStart) + ')', R.legacyOpeningCents, '−'], ['Settled from opening balance', -R.legacySettlementCents, '−'], ['Open items without an invoice', -R.unallocatedCents, '='], ['Receivables excl. VAT', ex, '+', true], ['VAT on these items', R.vatInOpenItemsCents, '='], ['Debtors account 132000', R.controlCents, '', true]], ok: inc === R.controlCents, diff: R.controlCents - inc };
}
/* Product group of a product (falls back to the product lines for products without a category) */
const LINE_GRP = { proElite: 0, milkPowder: 0, feed: 1, calfPens: 2, calfHousing: 2, calfSupplies: 3, perfectUdder: 4 };
let _pg = null;
function groupOfProduct(p) {
  if (!_pg) { _pg = new Map(); for (const l of X.lines || []) if (LINE_GRP[l.key] != null) for (const q of l.products) _pg.set(q, LINE_GRP[l.key]); }
  const c = X.products[p][1];
  return c >= 0 ? (X.gOfCat[c] ?? 5) : (_pg.has(p) ? _pg.get(p) : 5);
}

/* ── Reorder radar (same rules as the Business Cockpit) ───────────────── */
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function reorder(f, inPeriod) {
  const snap = X.meta.ledgerThrough, F = X.facts, cp = custPred(f);
  const gs = f.grps?.length ? new Set(f.grps) : null;
  let W = null;
  if (inPeriod) {
    const a = X.months[f.from] + '-01', e = X.months[f.to];
    const end = e + '-' + pad(new Date(+e.slice(0, 4), +e.slice(5), 0).getDate());
    W = [a, end < snap ? end : snap];
  }
  const msF = X.months.map((m, i) => i).filter(i => !X.isPortalM[i] && i !== X.partial.m);
  const win = new Set(msF.slice(-6)), rv = new Map();
  for (let i = 0; i < X.n; i++) if (win.has(F.m[i])) { const k = F.c[i] + '|' + F.p[i]; rv.set(k, (rv.get(k) || 0) + F.r[i]); }
  const out = [];
  for (const [c, p, n, last, gap] of X.cadence) {
    const g = X.gOfCat[X.products[p][1]] ?? 5;
    if (!cp(c) || (gs && !gs.has(GROUPS[g]))) continue;
    const since = days(last, snap), due = Math.round(since - gap), fell = addDays(last, Math.floor(1.5 * gap) + 1);
    if (W && (fell < W[0] || fell > W[1])) continue;
    if (since > 1.5 * gap && since <= 120) out.push({ c, p, n, last, gap, since, due, fell, g, mrev: Math.round((rv.get(c + '|' + p) || 0) / win.size) / 100 });
  }
  return { rows: out.sort((a, b) => b.mrev - a.mrev), window: W };
}


/* ── Overview (live view, not filtered) ────────────────────────────────── */
function liveMonth() {
  const m = X.nM - 1, F = X.facts;
  let rev = 0;
  for (const i of _monIdx[m]) rev += F.r[i];
  return { m, label: X.mLabel[m], iso: X.months[m], day: X.partial.m === m ? X.partial.day : null, rev: rev / 100 };
}

const totals = (() => {
  const F = X.facts; let r = 0; for (let i = 0; i < X.n; i++) r += F.r[i];
  return { revenue: r / 100, customers: X.customers.length, invoices: X.inv.length };
})();

/* ── Entity aggregation straight from facts (exact, respects partial-month caps) ── */
function aggregate(ix, keyFn) {
  const F = X.facts, m = new Map();
  if (!ix) return m;
  for (const i of ix) {
    const k = keyFn(i);
    let x = m.get(k);
    if (!x) { x = { k, rev: 0, revO: 0, kg: 0, qty: 0, pcs: 0, days: new Set(), cust: new Set() }; m.set(k, x); }
    const r = F.r[i] / 100;
    x.rev += r; x.kg += F.k[i]; x.qty += qtyOf(i); if (!X.kgProd.has(F.p[i])) x.pcs += F.q[i] / X.qScale;
    if (!X.isPortalM[F.m[i]]) { x.revO += r; if (F.T[i] != null) x.days.add(F.c[i] + ':' + F.T[i]); }
    if (F.r[i] > 0) x.cust.add(F.c[i]);
  }
  return m;
}
/* Invoice counts per key over Microfas months of a period list */
function invoiceCounts(f, list, keyFn) {
  const ms = (list || []).map(x => x.m).filter(m => !X.isPortalM[m]);
  const m = new Map();
  for (const v of invoices(f, ms)) { const k = keyFn(v); m.set(k, (m.get(k) || 0) + 1); }
  return { map: m, known: ms.length > 0, total: [...m.values()].reduce((s, v) => s + v, 0) };
}
const ordersCoverage = list => {
  const ms = (list || []).map(x => x.m), known = ms.filter(m => !X.isPortalM[m]);
  if (!known.length) return 'Orders not available for portal months (Jan 2025 – Mar 2026)';
  if (known.length === ms.length) return '';
  return `Orders & avg order value from ${mLong(X.months[known[0]])} (portal months have no invoice detail)`;
};
const repName = i => X.verkopers[X.facts.v[i]];

/* The data model handed to the chatbot (it answers from the same dash.json) */
// eslint-disable-next-line react-refresh/only-export-components
export const DASH = { X, GROUPS, sales, applyPreset, defaultFilter, aggregate, arKPI, reorder, liveMonth, mLong, invoices, legacy, orderValue, hasOrderValues, fmtFull, fmtN, fmtShare, growth };

/* ══════════════════════════════════════════════════════════════════════
   typography.js
   ══════════════════════════════════════════════════════════════════════ */
/* Typography shared with the migrated cockpit pages. */
const SCALE_POINTS=[[6, 10], [7, 10.5], [8, 11], [9, 12], [10, 12.5], [11, 13], [12, 13.5], [13, 14], [14, 15], [15, 16], [16, 18], [20, 24], [28, 32], [40, 44]];
function scaleFont(px){const P=SCALE_POINTS;if(px<=P[0][0])return P[0][1];for(let i=1;i<P.length;i++){const[x0,y0]=P[i-1],[x1,y1]=P[i];if(px<=x1)return Math.round((y0+(y1-y0)*(px-x0)/(x1-x0))*10)/10}return Math.round(px*11)/10}
/* Returns a copy of an ECharts option with every fontSize moved onto the same scale and Inter as the chart font. */
function scaleChartFonts(option){const seen=new WeakMap();const walk=v=>{if(Array.isArray(v)){if(seen.has(v))return seen.get(v);const a=[];seen.set(v,a);v.forEach(x=>a.push(walk(x)));return a}if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){if(seen.has(v))return seen.get(v);const o={};seen.set(v,o);for(const k in v){const x=v[k];o[k]=k==='fontSize'&&typeof x==='number'?scaleFont(x):walk(x)}return o}return v};const o=walk(option);if(o&&typeof o==='object'&&!Array.isArray(o)){o.textStyle={fontFamily:"Inter, system-ui, sans-serif",fontSize:12,...(o.textStyle||{})}}return o}
const TYPO_CSS=`/* Uniform typography: Lakshman's pages on the DairyTop cockpit type scale (Inter text, JetBrains Mono figures).
   Generated from the sizes in App.jsx; sidebar, top bar and login keep their own sizes. */
.page-area,.filter-bar{font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif}
.filter-label{font-size:12.5px}
.filter-chip{font-size:13.0px}
.filter-meta-row{font-size:12.5px}
.filter-clear{font-size:12.0px}
.kpi-icon{font-size:18.0px}
.kpi-lbl{font-size:12.8px}
.kpi-val{font-size:24.0px}
.kpi-val.sm{font-size:18.0px}
.kpi-chg{font-size:13.0px}
.kpi-trend{font-size:12.2px}
.kpi-mini .kpi-val.sm{font-size:13.5px}
.cp-title{font-size:12.8px}
.cp-sub{font-size:12.5px}
.cp-tag{font-size:12.0px}
.panel-select{font-size:12.2px}
.panel-btn{font-size:12.2px}
.vt-btn{font-size:12.5px}
.itbl{font-size:13.0px}
.itbl th{font-size:12.0px}
.rank{font-size:12.5px}
}

.sec-title{font-size:12.5px}
.fin-note{font-size:12.5px}
.fin-badge{font-size:12.0px}
.indicative-tag{font-size:10.8px}
.gauge-label{font-size:12.0px}
.gauge-val{font-size:24.0px}
.gauge-py{font-size:12.5px}
.ledger-search{font-size:13.0px}
.ledger-count{font-size:12.0px}
.watch-col-title{font-size:12.0px}
.watch-row-desc{font-size:12.2px}
.watch-row-amt{font-size:12.0px}
.watch-empty{font-size:12.5px}
@media(max-width:1200px) and (min-width:901px){
.kpi-val{font-size:19.5px}
.kpi-val.sm{font-size:15.0px}
.cp-title{font-size:13.0px}
}
@media(max-width:900px){
.filter-chip{font-size:12.0px}
.filter-label{font-size:12.0px}
.filter-clear{font-size:11.0px}
.filter-meta-row{font-size:11.0px}
.kpi-icon{font-size:14.0px}
.kpi-lbl{font-size:12.0px}
.kpi-val{font-size:16.0px}
.kpi-val.sm{font-size:14.0px}
.kpi-chg{font-size:12.0px}
.cp-title{font-size:13.0px}
.cp-sub{font-size:12.0px}
.vt-btn{font-size:12.0px}
.itbl{font-size:12.0px}
.rank{font-size:11.0px}
.fin-note{font-size:12.0px}
.gauge-val{font-size:18.0px}
.ledger-search{font-size:12.5px}
.ledger-count{font-size:11.0px}
.kpi-val.sm{font-size:14.0px}
.kpi-chg{font-size:12.0px}
}
.cp-insight{font-size:12.8px}
.cp-insight-icon{font-size:13.0px}
.cp-expand-btn{font-size:13.5px}
.cfs-title{font-size:16.0px}
.cfs-sub{font-size:13.0px}
.cfs-close{font-size:18.0px}
.delta{font-size:12.2px}
.cmp-toggle{font-size:12.2px}
.drill-chip{font-size:12.5px}
.drill-chip button{font-size:12.0px}
.back-btn{font-size:13.0px}
.tbl-search-wrap input{font-size:13.0px}
.tbl-search-count{font-size:12.0px}
`;

/* ══════════════════════════════════════════════════════════════════════
   ui.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Shared UI: Panel (chart/table toggle, chart magnifier, enlarge), EC (ECharts),
   InlineTable, KPI helpers, export buttons. Styles live in App.jsx's css. */
function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
}

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
      ...TOOLTIP_STYLE, ...option.tooltip,
      axisPointer: {
        type: 'cross',
        crossStyle: { color: 'rgba(64,188,243,0.5)', width: 1, type: 'dashed' },
        label: { backgroundColor: '#1F3741', color: '#40BCF3', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', padding: [4, 8], borderRadius: 4,
          formatter: p => p.axisDimension === 'y' ? yFormatter(p.value) : p.value },
      },
    },
  };
}

/* Pinch (trackpad / touch) or Ctrl + wheel zooms the time window; plain wheel scrolls the page. */
function withDataZoom(option, axis = 'x') {
  return {
    ...option,
    dataZoom: [{ type: 'inside', [axis === 'y' ? 'yAxisIndex' : 'xAxisIndex']: 0, minSpan: 5, maxSpan: 100,
      zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: true, preventDefaultMouseMove: false }],
  };
}

function catAxisLabel(count, baseFontSize, forceRotate) {
  const mobile = isMobileViewport(), fs = baseFontSize || 9, crowded = mobile && (forceRotate || count > 3);
  return { color: '#5F7078', fontSize: mobile ? Math.max(7, fs - 1) : fs, hideOverlap: true, interval: 0, rotate: crowded ? 40 : 0, margin: crowded ? 10 : 8 };
}

/* ── Chart magnifier: scales fonts, bars and markers of every chart inside a Panel ── */
const ChartScale = createContext(1);
const SCALE_KEYS = new Set(['fontSize', 'barMaxWidth', 'symbolSize', 'itemWidth', 'itemHeight', 'barWidth']);
function scaleOption(o, s) {
  if (s === 1) return o;
  const seen = new WeakMap();
  const walk = v => {
    if (Array.isArray(v)) { if (seen.has(v)) return seen.get(v); const a = []; seen.set(v, a); v.forEach(x => a.push(walk(x))); return a; }
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      if (seen.has(v)) return seen.get(v);
      const r = {}; seen.set(v, r);
      for (const k in v) { const x = v[k]; r[k] = SCALE_KEYS.has(k) && typeof x === 'number' ? Math.round(x * s * 10) / 10 : (k === 'width' && typeof x === 'number' && x < 8 ? x * s : walk(x)); }
      return r;
    }
    return v;
  };
  const r = walk(o);
  if (r && r.textStyle) r.textStyle = { ...r.textStyle, fontSize: Math.round(12 * s) };
  return r;
}

/* Keep a bottom legend clear of the x-axis labels: reserve fixed pixels below the grid. */
function legendSpace(o) {
  const lg = Array.isArray(o.legend) ? o.legend[0] : o.legend;
  if (!lg || lg.show === false || lg.bottom == null || !o.grid || Array.isArray(o.grid)) return o;
  const rot = [].concat(o.xAxis || []).some(a => a?.axisLabel?.rotate);
  const need = rot ? 58 : 44, b = o.grid.bottom;
  const px = typeof b === 'number' ? b : null;
  if (px != null && px >= need) return o;
  return { ...o, grid: { ...o.grid, bottom: need, containLabel: true }, legend: Array.isArray(o.legend) ? o.legend : { ...lg, bottom: 2 } };
}
const liveChartInstances = new Set();
/* Legend click highlights a series (others fade) instead of hiding it. Click again to clear. */
function legendHighlight(o, hl) {
  if (!o.legend || !o.series) return o;
  const ser = [].concat(o.series);
  const names = new Set();
  ser.forEach(x => { if (x.type === 'pie') (x.data || []).forEach(d => names.add(d.name)); else if (x.name) names.add(x.name); });
  const legend = [].concat(o.legend).map(l => ({ ...l, selectedMode: true, selected: Object.fromEntries([...names].map(n => [n, true])) }));
  const dim = x => ({ ...x, itemStyle: { ...(x.itemStyle || {}), opacity: 0.18 }, lineStyle: x.lineStyle ? { ...x.lineStyle, opacity: 0.18 } : undefined, areaStyle: x.areaStyle ? { ...x.areaStyle, opacity: 0.04 } : undefined, label: x.label ? { ...x.label, show: false } : undefined, z: 1 });
  const series = !hl || !names.has(hl) ? ser : ser.map(x => {
    if (x.type === 'pie') return { ...x, data: (x.data || []).map(d => d.name === hl ? d : { ...d, itemStyle: { ...(d.itemStyle || {}), opacity: 0.25 } }) };
    if (x.name === hl) return { ...x, z: 5, lineStyle: x.lineStyle ? { ...x.lineStyle, width: (x.lineStyle.width || 2) + 1 } : x.lineStyle };
    if (!x.name) return x;
    return { ...dim(x), data: Array.isArray(x.data) ? x.data.map(d => d && typeof d === 'object' && !Array.isArray(d) && d.itemStyle ? { ...d, itemStyle: { ...d.itemStyle, opacity: 0.18 } } : d) : x.data };
  });
  return { ...o, legend: Array.isArray(o.legend) ? legend : legend[0], series };
}

function EC({ option, onEvents, style, onAxisClick }) {
  const s = useContext(ChartScale);
  const [hl, setHl] = useState(null);
  const scaled = useMemo(() => scaleOption(scaleChartFonts(legendSpace(legendHighlight(option, hl))), s), [option, s, hl]);
  const inst = useRef(null);
  /* handlers always see the latest props (echarts-for-react keeps the first bound functions) */
  const live = useRef({});
  useEffect(() => { live.current = { onEvents: onEvents || {}, onAxisClick }; });
  const ready = i => {
    inst.current = i; liveChartInstances.add(i);
    i.getZr().on('click', e => {
      const cb = live.current.onAxisClick; if (!cb) return;
      const pt = [e.offsetX, e.offsetY];
      try { if (!i.containPixel('grid', pt)) return; const v = i.convertFromPixel({ seriesIndex: 0 }, pt); if (v && v[0] != null) cb(Math.round(v[0])); } catch { /* ignore */ }
    });
  };
  useEffect(() => () => { if (inst.current) liveChartInstances.delete(inst.current); }, []);
  useEffect(() => { const t = setTimeout(() => { try { inst.current?.resize(); } catch { /* ignore */ } }, 60); return () => clearTimeout(t); }, [s]);
  const keys = Object.keys(onEvents || {}).sort().join('|');
  const events = useMemo(() => {
    const ev = { legendselectchanged: e => setHl(h => h === e.name ? null : e.name) };
    for (const k of keys ? keys.split('|') : []) ev[k] = (...a) => live.current.onEvents[k]?.(...a);
    return ev;
  }, [keys]);
  return <ReactECharts option={scaled} style={{ height: '100%', width: '100%', ...style }} opts={{ renderer: 'svg' }} notMerge onEvents={events} onChartReady={ready} />;
}

function InlineTable({ headers, rows, height, searchable, initialQuery, onRowClick, footer }) {
  const [sc, setSc] = useState(null);
  const [sd, setSd] = useState('asc');
  const [q, setQ] = useState(initialQuery || '');
  const s = useContext(ChartScale);
  const [prevIQ, setPrevIQ] = useState(initialQuery);
  if (initialQuery !== prevIQ) { setPrevIQ(initialQuery); if (initialQuery !== undefined) setQ(initialQuery || ''); }
  const sort = i => { if (sc === i) setSd(d => d === 'asc' ? 'desc' : 'asc'); else { setSc(i); setSd('asc'); } };
  const indexed = rows.map((r, i) => [r, i]);
  const filtered = searchable && q.trim() ? indexed.filter(([row]) => row.some(c => String(c).toLowerCase().includes(q.trim().toLowerCase()))) : indexed;
  const num = v => parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  const sorted = [...filtered].sort((A, B) => {
    if (sc === null) return 0;
    const a = A[0][sc], b = B[0][sc], an = num(a), bn = num(b);
    const c = !isNaN(an) && !isNaN(bn) ? an - bn : String(a).localeCompare(String(b));
    return sd === 'asc' ? c : -c;
  });
  return (
    <div className="tbl-wrap" style={{ height, display: 'flex', flexDirection: 'column' }}>
      {searchable && (
        <div className="tbl-search-wrap">
          <input type="text" placeholder="Search this table…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search table" />
          {q.trim() && <span className="tbl-search-count">{sorted.length}/{rows.length}</span>}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="itbl" style={s !== 1 ? { zoom: s } : undefined}>
          <thead><tr>{headers.map((h, i) => <th key={i} onClick={() => sort(i)}>{h} <span style={{ opacity: .5, fontSize: 11 }}>{sc === i ? (sd === 'asc' ? '↑' : '↓') : '⇅'}</span></th>)}</tr></thead>
          <tbody>{sorted.map(([row, oi], ri) => (
            <tr key={oi} onClick={onRowClick ? () => onRowClick(oi) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>{row.map((cell, ci) => {
              if (ci === 0 && headers[0] === '#') return <td key={ci}><span className={`rank ${ri === 0 ? 'r1' : ri === 1 ? 'r2' : ri === 2 ? 'r3' : 'rn'}`}>{cell}</span></td>;
              return <td key={ci}>{cell}</td>;
            })}</tr>
          ))}</tbody>
          {footer && <tfoot><tr className="tot">{footer.map((c, i) => <td key={i}>{c}</td>)}</tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

const ICON_EXPAND = <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 5V2a1 1 0 0 1 1-1h3M9 1h3a1 1 0 0 1 1 1v3M13 9v3a1 1 0 0 1-1 1H9M5 13H2a1 1 0 0 1-1-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
const ICON_CHART = <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor" /><rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor" /><rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor" /></svg>;
const ICON_TABLE = <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="2.5" rx="1" fill="currentColor" /><rect x="1" y="5.5" width="12" height="2" rx=".5" fill="currentColor" opacity=".6" /><rect x="1" y="9.5" width="12" height="2" rx=".5" fill="currentColor" opacity=".4" /></svg>;
const Mag = ({ plus }) => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="6.8" cy="6.8" r="4.8" /><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4" />{plus && <path d="M6.8 4.6v4.4" />}</svg>;

/* Panel = the chart/table card used on every page. */
function Panel({ title, subtitle, tag, controls, flex, height, style, className, children, defaultView = 'chart', tableHeaders, tableRows, insight, searchableTable, tableInitialQuery, headerExtra, hideToggle, onRowClick, noZoom }) {
  const [view, setView] = useState(defaultView);
  const [ready, setReady] = useState(false);
  const [full, setFull] = useState(false);
  const [cz, setCz] = useState(1);
  useEffect(() => { const t = setTimeout(() => setReady(true), 260); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!full) return;
    const k = e => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [full]);
  const hasToggle = tableHeaders && tableRows && !hideToggle;
  const base = height != null ? { flex: '0 0 auto', height } : flex ? { flex } : {};
  const grow = cz > 1 ? { minHeight: Math.round(320 * cz), flex: base.flex ? `${(parseFloat(base.flex) || 1) * cz} 0 auto` : undefined } : {};
  const fixedVars = height != null ? { '--fin-fixed-h': typeof height === 'number' ? `${height * Math.max(1, cz)}px` : height } : undefined;
  const step = d => setCz(z => Math.min(1.6, Math.max(0.8, Math.round((z + d) * 10) / 10)));

  const zoomBtns = !noZoom && (
    <div className="cp-zoom" role="group" aria-label="Chart size">
      <button className="cp-expand-btn" title="Smaller chart text" onClick={() => step(-0.1)} disabled={cz <= 0.8}><Mag /></button>
      {cz !== 1 && <button className="cp-zoom-val" title="Reset chart size" onClick={() => setCz(1)}>{Math.round(cz * 100)}%</button>}
      <button className="cp-expand-btn" title="Bigger chart text" onClick={() => step(0.1)} disabled={cz >= 1.6}><Mag plus /></button>
    </div>
  );
  const toggle = hasToggle && (
    <div className="view-tog">
      <button className={`vt-btn${view === 'chart' ? ' active' : ''}`} onClick={() => setView('chart')}>{ICON_CHART}Chart</button>
      <button className={`vt-btn${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>{ICON_TABLE}Table</button>
    </div>
  );
  const body = view === 'chart' || !hasToggle ? children
    : <InlineTable headers={tableHeaders} rows={tableRows} height="100%" searchable={searchableTable} initialQuery={tableInitialQuery} onRowClick={onRowClick} />;

  return (
    <>
      <div className={`chart-panel${className ? ' ' + className : ''}${cz > 1 ? ' cp-grown' : ''}`} style={{ ...base, ...grow, ...style, ...(fixedVars || {}) }}>
        <div className="cp-head">
          <div style={{ flex: '1 1 180px', minWidth: 0 }}>
            <div className="cp-title">{title}</div>
            {subtitle && <div className="cp-sub">{subtitle}</div>}
            {headerExtra && <div style={{ marginTop: 4 }}>{headerExtra}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0, maxWidth: '100%', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            {controls}
            {tag && <div className="cp-tag">{tag}</div>}
            {toggle}
            {zoomBtns}
            <button className="cp-expand-btn" title="Enlarge" onClick={() => setFull(true)}>{ICON_EXPAND}</button>
          </div>
        </div>
        {insight && <div className="cp-insight"><span className="cp-insight-icon">💡</span><span>{insight}</span></div>}
        <div className="cp-body">
          {!ready && view === 'chart' && (
            <div className="cp-skeleton" aria-hidden="true">
              {[40, 70, 55, 85, 30].map((h, i) => <div key={i} className="cp-skeleton-bar" style={{ height: h + '%' }} />)}
            </div>
          )}
          <ChartScale.Provider value={cz}>{body}</ChartScale.Provider>
        </div>
      </div>
      {full && createPortal(
        <div className="cfs-overlay" onClick={e => { if (e.target === e.currentTarget) setFull(false); }}>
          <div className="cfs-panel">
            <div className="cfs-hdr">
              <div className="cfs-titles">
                <div className="cfs-title">{title}</div>
                {subtitle && <div className="cfs-sub">{subtitle}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{controls}{toggle}{zoomBtns}</div>
              <button className="cfs-close" onClick={() => setFull(false)} title="Close (Esc)">✕</button>
            </div>
            <div className="cfs-body"><ChartScale.Provider value={cz}>{body}</ChartScale.Provider></div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function KpiNote({ text = 'KPIs match your selected period and filters', extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginBottom: -2, flexWrap: 'wrap' }}>
      <span className="cp-tag" style={{ background: 'rgba(64,188,243,0.08)', color: 'var(--accent2)', borderColor: 'rgba(64,188,243,0.25)' }}>Period-aware</span>
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{text}</span>
      {extra && <span style={{ fontSize: 12, color: 'var(--muted2)' }}>· {extra}</span>}
    </div>
  );
}

/* KPI card: clickable → opens the "how this number is built" panel */
function Kpi({ color = 'blue', label, value, sub, onClick, title }) {
  return (
    <div className={`kpi-card ${color}${onClick ? ' clickable' : ''}`} onClick={onClick} title={title || (onClick ? 'Click to see how this number is built' : undefined)} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? e => e.key === 'Enter' && onClick() : undefined}>
      <div className="kpi-lbl">{label}</div>
      <div className="kpi-val sm">{value}</div>
      {sub != null && <div className="kpi-chg">{sub}</div>}
    </div>
  );
}
function Trend({ g, inv, suffix }) {
  if (g == null) return <span className="kpi-trend" style={{ color: 'var(--muted2)' }}>No comparison</span>;
  const good = inv ? g <= 0 : g >= 0;
  return <span className={`kpi-trend ${good ? 'up' : 'down'}`}>{g >= 0 ? '▲' : '▼'} {Math.abs(g).toFixed(1).replace('.', ',')}%{suffix ? ' ' + suffix : ''}</span>;
}

const csvEscape = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function downloadCSV(filename, headers, rows) {
  const lines = [headers, ...rows].map(r => r.map(csvEscape).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename.replace(/\.xlsx$/i, '.csv');
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function ExportExcelButton({ filename, headers, rows }) {
  const xl = () => { const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data'); XLSX.writeFile(wb, filename); };
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      <button className="panel-btn" onClick={xl} title="Export to Excel">⬇ Excel</button>
      <button className="panel-btn" style={{ color: 'var(--accent2)', background: 'rgba(64,188,243,0.08)', borderColor: 'rgba(64,188,243,0.25)' }} onClick={() => downloadCSV(filename, headers, rows)} title="Export to CSV">⬇ CSV</button>
    </span>
  );
}

/* Pagination used by the long ranking charts */
function Pager({ count, total, step, setCount, extra }) {
  const b = (dis) => ({ padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface3)', color: 'var(--muted)', cursor: dis ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', opacity: dis ? .5 : 1 });
  const all = count >= total;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 4, padding: '4px 0', flexWrap: 'wrap' }}>
      <button onClick={() => setCount(c => Math.max(c - step, step))} disabled={count <= step} style={b(count <= step)}>‹ Less</button>
      <span style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 80, textAlign: 'center' }}>{all ? `All ${total}` : `1-${count} / ${total}`}</span>
      <button onClick={() => setCount(c => Math.min(c + step, total))} disabled={all} style={b(all)}>More ›</button>
      <button onClick={() => setCount(all ? step : total)} style={{ ...b(false), borderColor: all ? 'var(--accent)' : 'var(--border)', color: all ? 'var(--accent2)' : 'var(--muted)' }}>{all ? 'Reset' : 'Show all'}</button>
      {extra}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   shell.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Shell pieces kept from the original app: global CSS, Login, Welcome, ScrollHint. */
function formatDisplayName(username) {
  if (!username) return '';
  const first = username.split(/[.\s_-]+/)[0];
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

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
  --login-glass:url("data:image/webp;base64,UklGRgwrAABXRUJQVlA4IAArAAAQMAGdASrvAvMCPjkcjUSiIaEioJTYOFAHCWlu/BwXwwoBz1Vsr0JDfDyKOmN5e/9TDzeT/J/XemrNV+Dvkk0iO3/5vnoc4/4j8tP9b83/S9/YfUF/UP/H/mr3DvMZ+w37c+87/1v2x94n+I9QT+c/3fraPQT/Z/03v26+Hr+yf7r9m/Z3/5usMfB//z6dPif+p5Z/jfuAUqCbf9j+YPKftmcJuADeG08eZh/hvRs0qPn/+z/8vuH/rd/0OyAB1wBlaWmOR9btAjzuwiEmtSuqNiE5nrNvOZ3gnlKA0z5W4OURv7BGLQUXbWwIPbehEnJLMYc/zlHOuYS+jKZpZ6Odcv6dKZ+KLO+Pwx04xKKvBMJLzZ+iQqT+fdvuGyv1bkRYk61dn+BdotI3gZf4K7M0Nhdp/6CYNw9Ie5h/pnx/fwbfT+qycXY0XPMrvQog0KL0ylGvevF57Ua0gEK91NVVwnbuonrujRXYGvi/rskVir5dTNaf5bfpmeroQcAafWeHsamMiSSzenT2N4O8wf1+tRVxFv/qdKSXOCMPiJZLQ4SG6DbgYHtOIsZj+k/pFI6pHU2Dxulu/FQ+CNKnclJC7bXS+FSLKFrCBZ4FVSQxhFzPlgApFZe4SEqxKy2K+ax8YSxsMmJ3TtxkS9JKhUh4aHWYM8DpOP/GA4onoZv7Lr0ZOT1dZOzfAgHEU0CIVEWJE4D1T/+rYaiYDYauVsfiXwvKWrTfO4dqSQH+LmC9p5vHgF2uhVzXTl0Hto7hog70MELzdcIzSUs3gkM429STxEhA/BwmNRZE/X6njzfr6Dj4Vf9lbsmCsyM+o4ebRzRf5v+bRnnSwo980yWeFkHO7tZkycT1WqxedfHd9zzQr+8jjC6iIsO6YnANFc5uqKBhzXRk2j1UyGB3BxTxOlwO3uHXazpteimqjY6oF0jvsfvhz2kfLw6lS228vfYK4dCkuCVeelSjBFXbvn8JoRJUtmudFyDHXZkaBHMTu66DFlxbZRtfcP4jL/ooJ+0YvrWV9JeINk9SPFnjHkyblyoTl0lYwBcC6F/2tfMMV4jngkVnLiWImltXCgMkwcDmWBgYC6KRbopM38rV3gYm9jEABd/mBFXSqwNyjk7ATE1SrIV41Y0GTayuB6tThi91J4236/eE9LyuY7DgN6aPJ5ZrkAyVQLvZpTm/H3cIG/mLS63+HLOK8Rqak8UrrmjklxHEM3Jm2J6LLHi75+MsS/yk7eSGjiWlFrB60lIzAfo6Z0+dgHyQVBmdxPZahxJRTPl4euL++3XsVD3vIexLSI8lovsEhw1QoYTBvAyamF0FaieQLvgB5Y31hWNeKAZ9Mh5dfwliDm2t7DD4UF68MjfrrEGiPySplFPRpeyXuwg+ag9itaEe5pyQUAASgvi4++7AyBjNgT2gS5/aoY6h7WMLse13yiVJBR3MNPayfjeWKa0Ww90YMZR6+KpFl/3NsR7jtJyqbg+vXsCqDrS0OFHZ3Zq+F3/DX/EWPZyQt5qUXeL2rzirGJX8gp0x0GEGIXSPG8ZILBz3AoId7XubT9WQWsqN8Q46vJ88RwFvyP/Zvqnlanaomz8HyWVOIXEzSUTAXugIh8pe6ydxIF2hLAsCwD9ChpJnNnoTIvCYC9Jyknfhjx4xPDfu+pLrHbZyw+6Bux4usXPG7+Jp+DCEgTKB32S04yBGLYKUSuU0O2XLWTSJvSIWDr7e5u9EtiyNK4GUL3O6Pc2O9+ehB/RvzuJSxsmnob1+enTVBZZoY7OaY+rw16B1y7l1AAv5oRz24cgPRra6/uwowbiZDycNg3JOD9l+RCm2X5Cxm1suXen7CTwO+0HbxG9nv1Ehilgk5rPe4zHrMVD6/xvNLsLyr9hWZ71as2O35wlIXNm7+dRw64zVXTMRet+zWBx+88MLKjJpk7FprdkFBfiDkeVquAdXDroi7CTw3eVC2UxqCCQfkQbrtyoMpoYm5euRbh5AjEUobtKXuB/r/50YvkHZLLij9JPrjxVGT18MiuyUCTqTVZD4As2bdklOnTsHr36xJut4/z+JVudVg9RTVss/ELFi7s/NFatWp2CE1gsZiN/T5k8YhU3pmRB7kT9S0a+ohf+67BziOkwXACOyxPl/WyDwqDsfJcTMcEoqQ83TteQQIEkBfkjF6FcATIeeauVV0329k6yE43Kc7ZOq91isPXiJJw7bbIWLCV3UEevH+rHdE/WkwoERmr3xunUETnUpObNmwqZZ9SElMYIIHn4pMc9YkZCA5ISQ6O81FNlOoqX6aY4YFmWNha7fGCX0mOqF1L0rFMUy9fJvQwLUjx6Uo4cDfRHYAoOb4dvWzg9kAZS9lR82EUoOVlXZs2bNnMzuZtx4S/M034XVl/PW6zGK+BCkfBo0cp6dOoIsu3i89Jrt1yDZ3p+0YlY/JaOpeNMt24cpbitsLZynDVs7jk4I1aCmxu2lAWPo3Yfor9ZTNXQf6+9CKakmme0L60+eyOYnUHXKYmGNb+4Puw63ilmWxmeSpdvF82f45hHWmYXZfStsF4/MxYK5CFvBDfOO7Vc+4EqSKhEYCNyfmmHVqb69gx33BjF4LJio7cGkRdBtPpVaOuAlMlkCwBT4pwsHq6+UTOJc7QeRz6vzLt8fEQFzWFm6rct1wYKrRyx6XxVgqJWAIDavt2dO3BR4yPQNFV6JgeTFM1AEjtCIgpynUUwgHei7+KDiimv4w9Dlkpl8IPcy3/NsPrcSzGU2XSW2Vf4yuSbeL5t63WKlDDjkSvurcUpeCTkgrraursm8XLfscOuRHlW0y3owOA5dttosUlIeU4fYA7GppW6KxGY8nWYhL8o9Kv1xJxwKkfeNVjAGyWAhBLhdqbCPeUlA4SubG8AEUJyBwULZ5JkWmVoJIZA58Z3OHSQLgMcg4JnJ0sPULxhOD8tHfY/hz15BMTmgikTEdOsLkPOJLlPUhw4U3SM/T4NQ7eUVRWGz9kSXqqgYKE+bsPMGlWWqGaFwU9Ng5guQHBlEJWI2r2H7jydwB4eDygKGBSyxNNbF2uL+jdKUMaepJV1K8wSHF8Kt5IP7GrQKiKNaqN0qUtw+NHMH5IFRnpQBoNCznGm9lW86IgRchJEPA+46uJ1KrPaHpuPFi1nuYQsEaTKXOTyBE7GX7cGBCMOmw8ft8XrN/CXAyJNdjQI4AERMXIBzY/FAvTOcsPmCJ/MOzRhV6SiTQBTrtiz+BwqF1Lc8GVQLqAL1ELFXM7l5JUEcAX42eM1KAAD+/89tVlNY+0ccXHahJh7eOZ2G/wXqvhmcGgt/pvuy0X5d7df2vOpxUct9K6SGurIKkrWZzHlLAfdEtcr7ufuCmBg8WHff01vPs+DzBwIuqXp8gTLW3zwzkiBwvr2NOzMj4+4xEugFC0krLUyafMrbKpTQBdBBw5PLj8s/rd3tJV+vapDXgZMN3Ofl2rwfZ+CK3DGpkNpWrZWbt2ia31gfpgmO56TL+1C36t4o/bsbEQ6KDft+z82P7NxYRjDjclF7PHSMpSAVR7pChcNQeUl7I5VEVcDpCwLFcBXsrm0L8SJdXiwZKkbnhvXH39G2SAGaXdJWn/poDVt7bmhhIrfXAk/Aj0D9IwjvHs7D82kH9XuBoUGs+9M2IwLQjqC8LrbzmDVdrJHP0o+cQREQYjR4uhP1UAdQuHI9JUPACsxYVJjqnIJngaZqKRBxkZVKCtQ5LgGFRD3o29A53owvVSxODBiIWh4vau7PFq+T4N8E2loe/AVtKq9ZOMmLGt97XVS7t+inAVeYzT8BpqV2zLr4ElbWQXVyCkBvvEo5/YPARzMhV9ezNImeYsd2c1lJuN+8MhTHPlOVujdTMT65PiOxcVNf3XBHmDydIbbsu3N7EEcelz3xZNpzBolqHR7mblmTmG2QvUERszdknnyBooN1+lgn8ol5G7MBdCZWBDoaMtxb+A1HKhyrag56MeQh5fs9Ae4MuD+JpbyviE78k2IHt+/K9mllR5qgJnL8QFORI0eHNzdaSolNr+D+WSLWavA11lI6eK/FQ5Y9VJqUSVPFdn41/X9FueL8Fv+Jh2M4GwYr0XEuMmUxw591zOmzXC8iYelRdb0HZYJKmEsl3db6efAcne0Fvm5+TndIRAV78pxGeO6zDDXAOIMkXxAOiwe+NFlTcotCBI5T1BNjSRg8k4EHR04kQRjSO7ddQ3PEk2euzRjGSLDvaZ5nOlxgqvS1BcUKGf6g7JfkIM9EF85X27zuUYDvESiFmkRmY0GQVAsUKZkp2XJeRU81uBzGR8RBZqywZqgNP0tUKgdorAduA1y1XO2hAjrpp2HZ2WioZmSifu+kpARq2KMav5RpglsIYn4uq3m6asOyKfKHUiRXypZiNwG8RUZHbEXt+spnDKE+ovUh9Qd3BHHnAsbH6E3+btj8/54MlTobCRlHvqsVfw/31d+GIY235Q4DTVdix3XKTZ+aO+rT2ysqXiSy6/dP758FpMbOOd/gGTLOiuFGJaJFZZqKI63nEYO0zoupms5MpN+ET4XMI+aL9rqbOVGKyE3OZ0H3WFFFU/MeRQGLp9MT2KJJdVUgx3sKtC7Ijx6LsahhO3sV+MANWPOf65Ek+1x+Yo8NvbOH2ToVpw4YcIWZWY29xgKXVETOYQKfLQNEtuowy0R1EV51KuxVbqI0ixNbcTJL7resyZAoX94j3XRRjvzQnM0JD1Xl6TZNYW8pXhL9ODYTja2z9s/l6aKdtxX6nb0uxzK8ESPdBRrS8f2cxG1LyRQYCKRBXzbbmMZjLouUdZGOhgV2HYobW88Hf8vjhFjRGQaO9FljBW4mGX/PsisnzxRY+xM/0r4J+uaZefKF/31AK8EKrhuCv/Ro+mXQTEZsKaU5gObzMJtrdrECBsNR5b8aM93unovsJlsQ2nafBr3uBBmvDQCGoJLpFOdYvsG47Mdb+QMt14G/t/WAZ+1RyeVYqAUCOHqdASSKZb4BqeYUmuUoMidm6z1M00efxbrE09gh4BFLf1PtYwd1pdTYX8AdIzWF4IKzhm1rVHoTtrCi1T+a1B27BzaqcEMDq/+R78OAd+RMGnbBZTYlSN/4cxGu/9HvLgQ3WE14prgtl2LgOJnbiDDtlre/SjTqUFgcBh54VbP3SH8RWx3q4FihN6YF52cU5Jv95EQzWzmc9gNGgpDc6qNCp1O+3iUa0vt1XPcPiRjA9WC2rzHgkB14FhNphT4JvEXHHf6PAIdStqyrm4eEUGcp8QXslKm8nCiow8dCi5c+pFXuYOTWH7ZzpwGQ58aof/NVXTOK01pXvwjwe5BlI2MyYHwseTBdtkIXHIowgT8oU/CJ6xdfyP75cTzVD+E3hudP7BPF7GWYMxTyHXDKO6z51mx2QDw+6TGTxxhDsHQwr2+//IlB2uavy8AJpva3q7jtIpzn8zCzmj4xYRnG2qc5ECR5mce34ifReXvzzzTzl+VrYruxUcUX+q/J1WyQYv1udSojz2hjcbHKcunlAko+3MaftXVCFvqxn7drqAMushHSXvTNQp/wmhfo/lqj5BecYE1jj7Va+cN0c5F0paDXsIom9Ygfwdx1Kz7zc9nVJ7iDFcd3jhKNO/9UQPuRABQmbME+dti8gSJuguUyhcFUr/P2yv/7vE6IkobC57OGCQAFTnuFKUUd0jeE9vBigXBqiWsV+uvDL0qtN2/gl2NiwVmUt1aMloR0CDrteR3ZWdRof+0ScrysqUGECf83WketfGVQTu9P8uCZiYI4x8ouxmezwUH9KIiFoQGutI1vJeEnv6+DVxfuGo3Ad81NkP3mTjH3+UEpOdwEhzndRH7vpElB81xP0RpD8MWfAvClNPUEbg0AwHji9Xf22j+4isEwBNX0QLeEX8+qVE6l/2N5qPO6W6Fr4zD2ALtmBRNLPCKQ8kBGi/ny5DyHheBCpqBBrnjSnWSHTYsucyqMt9Wkz8NYG1nxGwptDzbpt/O97m3CpfG+IWkjvSjPAA6Zx7vjJp2E4MSgPNZmdWuyp5UL3yzFiJe8qbGEI2ybfZTgzxS5pYO9j9//YHaBoYGVcQcUNd4gSLz/w3dInp7Ed2bspq75/eYp7ZtD4UtfJ/cTU6wVy7/jMJGZEZ11WR6OUX/9v1fK4zq83kh9ySyXvL6XwrSS32P0f9eMrDlFeRcu4ehbl8ycTAinLIfBg2WmM36krUuQ+x1sV0Nk3/0L9JfwPeUyx9m8J+sceZwQcqGZRwBNTXtQCVHca6oQalsa4LrjAK/IriXLLMkIw8knydOmhpm+APenz3KOELO6H/l8tXWnNpsZQRstlJP51+X0z13rpfce9dkgp56Jr55mZx2EUWDarImzdQlTi/7rNpwnzK26pRmUOpnF1fzPzylog3s+UfWYaiPc/kOA+Bs0ALMOjepZLCfacKJzuNwEdKnf/9+IChy+5YNnwYKjWHGkJbmk6jFLgIhb9ycJ8YFMGIsu/FobgCuU8Lw4ELp9F0kWFEyrbybDNohFrkjd/m0Eu4J1OptnBYRaVlFrySbstjizMj4tj+bzDEVO9hMkFwq0DQBCU6X29h6GD6D50+s99iVEevc/QmOaD5OA5osrR+qPP23fIn/oLHwK/lH+2RBjhPayXrNs0yqhNFzu/47/A8pQRmnzaiy/YTdyoRQHQcYjDvK9RhByvza8Icg0h/QWuS7NAxP4x2acPqVRXSmYSysM7LQXfzeaRxQsiVoRbHbTA+kHJgr8KGZ9NVof9I44voLk8GovmxNE9requSJLgDyKFHFQ9aBj3CI3X6V9DkKkfcszi0WIggRBuihi9JIC1FLEc4h5MzMXyONge1r6j+Ebc87Bo1PtJ+5UCTzrpsQXrYP5fhhArs9TK6XVRgpXua+ZL8rNwLweZLZPAL9LDY7jkjKdvzH6AmKMMldGqcdGiO02lSWbKmzFXhmoZumkvb4i6VdrhW399C1jx3MDq4gLU/34GELohxKGaNF9e9uJC6GdSPVsR2g3oQfDRejaCgVy++PnljXol0JstJnAXVWzL73LVNiq9P8c9OB8D35CeTQDy6G1v1htq7NWRwIVqSaYdFddl0HSIdO8VTqW27e1eoec1LGw4Q8M2BI09RE54Ea0CH2YxCj4Ez2GSnGWCatvC4kEEVnZOtoWgc7B9T9jGKT246ksBCEik6+gIhltbwoN+ThhUWbPWnqHMGEu0yvlIyLwkimcmBrMyQQBS7WrUS9rqjabzuWMrXgsppDJ1mx7oLJbaB+iePf67IQGMgQQlhZe7CqhvqB+yXQwcKEI3GXK0ZtJCT+TzBVspdwVwXw+TJQBx5Doe8iDiJtF/BoAb4HgW+SxcmiTFc6sG2Lj91My+IpiNXiD6Gv5WZqNKLX0yiwApMCUY56c2QsEBclqdujDQ26vdKGR7PePMfubFYs5A9Fyf0UY5jGlO4vmXL620i3tZ/iBtvzIuhscndUY92/mEs/kJwZiTKyX5VwXIf283kMr8qGP0GujJ12ZiXmHKyEqfv5B7PKSlFEEtNucbPqCqxNOfg03NitkCzOjn45ByBOCVO/gCppAzMhM7ucc3V8npt+eA7f2KngDtVhTLiO5Ffgv66Ja2NZrWLRS3qnMd2fWle8cT4rpsJZ/Dyb2kbEnW8YxAf0Dkvf5Phpc4iAwP/NuvA81WREB+imEregJrxPQcmi/OHEfG57KoCp5HMLDl9b+BMTlzxtVRzPhdhMhJDcnAHwu6/+mEzhVtqnoHdCvT4cH6rBBYDobbRUA7u6ymoSWbJZxucWXOiLzT9q95sV/Efw+b8RrfVjKfaTVIJnyCVugVWrmPRQuBgnfKlidMl4n6E5IlTv3rbYFtMpP9tv5mutjXBx3GIAr0NqTeEcz8xrCgs6/WC2QRBtoY8/7OrvZ7xi/PcbOqYY2hkqWCi8Os5uRc/1X6odmRkvHUMaPHvOdZXJ/9Zo6NXUbvBky9agvxqrgNdch9Kv8h9gzo7R/aKCvj+IkBblNhvXRDt37w/hY4RW2dMY3/LUYFtBVSqFtQcBzbvrdxY0t2paMzPzNtdBeP15tvVlVXGieXkYkNFI8nX29xN9K+EcB9chNRixy1Ut8YdahrWTS4+V9WV1aVtk8IJV0QAXGyRfzt/afry76gQta2IcZBRNwefs1Ptb1BV2uqBtqckIZK774Aq/pejQnyUUQ3SEuhpbaQacSRiS8GiOIMdc3s7Fy/UqmTuyQ9adqoletCzMkJD+fyqat31WeBvrfrAUxRxg6ttTee2pxTN6HLe0PVSsIDaUixZ12ej5gtr8u8SVDouVDhMrmXvRiVLJL0HF2EwToJDGfI0+YQEpo9p1ktaVBH11eu6DB7IQCnzQPL3lMpsciayotUPOwGT24sr55ZRA8ZLxeaF6kN9UcD9HLHzkaDLDztORzuSWPaZ96ryLwXZT2wefDVDrsSlbVFw8SeoONJr+Eafxexa274ddtBlPwOQLxYznCZzYnEfNGw2GpHOyOpqAa7KjomUldRr+L5bphMxruIkzrE4V3BwnxDw2dIELURyLfeSd7ghrkTYr68Zp44Lxn+R+3dv+LHGCOYxdFEUScyC5+RVnsCwPxTWqf7kt8n5MgN8VGHE8Uh2e203l4XLZBekzLpH37HNUua3EwbM+QTAjpk4vXd9Tva7HHUOjckrRccOzS63ZRWCXhoc8pAfsQGlKBIDAgllBfz58PXBGCOFFLn7ClAlKVWTx2HGzvEOVGWw376b9KQd6T17rZ3ZNUu4eNXl4vzxHsnwLFN/nojTttbKOQRWY5CDu54yZ/7t+0yWTUlnL3oQ3JfamLu+MLqQP8LIJymI9ky7pLjxOW3+Peg9cfFsg0XSR2WRm1NwIOMwit2/MFwvgMmyFDbccdvHTV0fzrBOG5jElRJMWLmlgrtJJ1HOmTqixiqaIzbXnPu1jA6SFchTnMmveoWlosUeP7RXkjsB2ZZ4HVbe65+mDyWMBPRSMyu4qMvPWAkaatu9HpMrVk5xl1OHuFEgNCva15YFGycpwpKeqXFLgL57I7MhlfLWyN69D8oUAxU8zaAuv2ddm9hcrspHCulWbwBZb0N7vofRAnQwsR6LisQ3WpHCuXLv3fkJCCa+mlQYrTG/WsIo7raMzLPo4wu3yzTR9/876VM2On99Cc0Jz9LCveIRh5+az2ycGKhi/Y5ahxeE5eJKYn8CM+5vC+XxWuPLt+kfkglNA4DfraevaXKL6Gx2hUwiWdow9TB96aN48GDfXZ6FWMF4bWWIT04wMN6MZ9ge3Docsq/3ibuFIx1nLwXFdQ5Ag9O9+cQ0Q4HWee+hTLoAtsL2+R8ul4SBsFk8oMF5WF+V+gd/iXfQ6SDYwTizfXuMFkQyhbLuEaUeqLjtIToWxA7z3wRAw0RmIjpLxLRdllgMHk0y+8xvzswZCPwI5aY1kV9UwJiNRJjcZL8OWkaELywo6NzThnlY5TWYOlzQNso/j02rndq8JAbvb0KTFZxAdixuvKs+O838MuoW5gGYVITnoAUT9LG5vuLCnAIFX3dx7gSbsMMdjR4GF5LrcswvLBtI1GVzsys4griG+lvkBLk33RDd4bvVv8ErOq8IYJTQ4lqbqMhR4RtHvjY0gjn+M9FbLIPJ5mTsIeVpsGMDV4suwNRIvJLDzAilQwQo5YHm5QEteregiJ96hCF2dOPM87OmEwBDZ44+5h6MgtjXihp/6gsVUeoPPlWcby1PwyHkyHOJUDf8ATReoFWrSDQ8qulIRDJETwZJveArbp8QhSkZdviMUyTZXLEiXdO9eXjf7QV3lmYEa/xH8Eo5KgsnoVWWlZNT8MVLLsTtZKXTvGNcEtAIUSbEVfTLiK6iBIRQuyYsaPJUQEvqtbpgWnAQZ2TnyLl/zSpnJidPq3zu3EGIY7peFgQPZPMkl0w+l8tpxtPoL5SVkizjuegeuI7xKqmMA4cv25+0rsblAPVJhLNezmwBUSnHwXyuBHLCWz7PoAWtVDAAZmkA8ZgxwRGr4wWkCt3uyYUuTRq+0wLciCSbAs1xBWVg0YixnAPkPEf/i5mnIHeYoxCtUd4/Xd2T+HNBC6Snv15tlDpX03N80Zk9O4iDWQ55iDPLk/vy/z1m86W76V1yn3IgX3raqwaPn9yKvi1mV7P3t7P8rXa85XfHrpvjRDc9WlORp4wuNs5UlEabjLcors7WUUHs2ePjB+Z9tbiI1hOfPcS7tyZuGMs1GLVk8e3OcrOOlRvXS3A9lavYOb5v+gR+tdA/8T7SeVgA7iKPqBmYO0Z/TMu0lKy4CJ2m5jiN1KPctj0RrIUy7yT0FL5Fc23eVMbvEjzsUabm5PBi+Mm7uPftvDyuvw1mMdAsraiKLGbUDV7G+wUAVrWvPl35rM2ZIzYHfuNB/hv+t0HWNgbPOCd7uhGIHCP2csMUeVoWfrZTXjt6+E03RocG0SmwY9De4Mq4M2dm6H1KeKwcqlaBwYGbEYxcNPuS6lD/r23kzZX2Jqz1UDx5dhG3nnDFb3XgBPfonFA5NGLSl3L4cuUDO4q4IzTjzFC79I2iPH/wMqMJKyaUJn8h75NhXxz9VvrNFJEj8Hz6cZ3+jQgnOFXhxUoyXLiThNhE2HkGfokml68wfeAOdqV4J+uNza2CR+Enf9medalwOxQ4HwwRcFQ8gs2tI6WNK5tM802LTwDYuBHP31mOZNjTQj0jIUUg+PxjQ9Qso4SuIGrYI+z2cV5ZGQCYReDp6aJap3xpKMfkNggEMSAU6Y0Ky6BLH5kVB6RxI4DOiNzaXd0C4mzsiADN88TRAZWfeHsXJZN0+UN8RGGl5eQLtYeQBVtXvOJ74qrwQowXnsSAX71w2IrvM6ccTTlQ8vFM80TbAayDgX5RK9uHJ3XoxxD0AxB2zQNqojmphYBqziz0DmBSHBhA4tiB6tzxZtO9tX1nDYG8vDqhLExdwMUtIE6m0RwkGi0FrQwcMuU9r8j1qqidJdU8WK1LQes8SJ0g5CLhkNwZ0ze8nj0sM3rRxCs/7rKifwYhRycRvtRzk9HWz8CtenAJBkzb1dcZAlpcfHaBnG7EpVco+AoflrodKPbMPiwBX3wrurlIfKl940OhgWruNEfheBqiwWmQfIMQP8Lv8lZmCVZLcNTZ0gAAppgwBxx+wAHf+de+aagX+UmcjM1d80vfrnAC9pf2fECqGWbawdZ77Jpctk5N20bfi9Ask4h18je6B2YyOzT3PpeIAJKNJ3qk1uWmoVfIGD45ec6mW1IlLXTeShoymqLloUShIxIXTf3n7K+TVRjT0LOmFyEThpIaJBCIhQEHhdmKuO07Uwy4JFl+aAEettb2pRXzElshlX+2H/vf9qun5v02h18cHBqj4mO9niVDsZ6KVVXdZr5GowYiWHJUHAznyYeiOhiv6SLzS2noAAAHTb1EKOtLQbkRP6b4O4wTLw3hJzb99Bhbx1PExyUJSzUSj9bfoDVKfmXh67uIALoP8QAXVCqVQEa6wwu/UiRE9uPpkMOrq1M52HgafdPTyfchXlsARzU5tJhesGkH+SAAKfzQwAAAq702pr5x98QXcMT7yyfjXPa0qvTCp5GUNdctxO4QFvXh3QwdYJdV/wfDUh1ZN3KEVCqUQAAFd/bu1KQ7TKdMiAAB4Yw3TgWHCoAcgyaRE3UE5OIzzYEhEjaAu7q/lJoSrOx/yHfbIudekuJU8O/U0P0OB/etjzM5kDmH4Wob/Bqpbsml7OxtavnupPlQauKRL7j3eLeYL1N4qtaEHGPtkpZD7iNX7xEijaG3khn/nBpOAn2axxv7ipTa7mPFyUZz6BT/YOLntV4hcmXVCPshhYqRa28AZNgcSdFj49BoaxB0prQQNMVnTpPBtDbj7NJRMgw1idVE3HNe67BYQXOvuNVQIAUeuw6GyUFfkiR4FAJPMUmlCWAAUcKvJIppQrUOOTF6difoo6GaZRuef3ozAC4Q4uEvXGLAhuhMOcBz1Pivm9j2kBzngWMJCMoUOrGc5/fl1ZknOWj6hIkSQ9C3Nbu48qnk6BaRDosoxeYtc7/JIlgOlM4ivMLdDOjmV/ycjgsM5NhiV8Tkz/sWkk9UMmQ9CXNmxod8sV4vGNe6m9FGdl0Z09hvbLNAltTqzx55i0r3Gww9QBE0gvfg/87umzayjVYZjd4CXGkwyLVWhEbYrw4B/KsgN+NJOI+q6wIA9L4ML+kjBAk6Qc3LnL5+ifnBjClyPmAALuQ7AAACINb0JCLfhKHXUEM2wwV2w4+NNYUukI6SrCInyFTWsg76rxsg7DGOwOw72CgsTZXX/V6TQr+scLfQC2Olj3JWRJAH6Uufjvr12vlKK7kYPWmMpvsixW6VOdXWDkQpcw3d61Wjd3KTDVEbGhfU+1dO+5p5ouQ/vRFkGsLgOAFKzKW6XTbM3c+pwJpuaWu7KDr0ZY9ZMckPLp48dz5qn8DW3NBdtlZyH/OnOUvg5VSdURs2HjMuGI4fn4DQiLwIX2PuZe40yqT8limoiybEi5UF7ynIAHawSmChnQpuxP0v3lwizdvjBl50dDcgMFGd/P+meNqkt6EpMsZDPVSo8wVP6uwMzUziYd4TnH3JxI3opc6F07KcrWOZoZ9fgwfE6z2n88hK9x2CTGWL/K3gSajKDS3bUok7XzcBSqrcGINYquNj5ylG5Sygq2zLrGM9A/1OPQSECBnFX4EJrVPxxl+r9C1mabdadCh7/Ge8HZgMhckKzY98ItLcooAHMJtCAESTGRm9ZGlPt1PetcPecS2i+kSYoFrVtJn0LlGGKfvSLa+W2PrKT5bnDzXtg1KHnrBXfKrmm+BMav5fnAH6/rVbETrs4CUZplcRIl3MHc1vzlkXZp62SaFCc/T3b59etiyIhEI/CB1x4phFzzxlf6E1aGxEweNIdtlCw6gnZhN0m8kWk9sLOXDxr9NzhC6ZBMwj/CzEq2ML4XNhZPUaRHXH/Thf0DC0JplVN83D3Wm6eEZKr+9enovz5DgN+xatNENwRLeGtXfXuV1PJtFkaHhrdcKrUdyciRWtBS6023a1154eh5DY+thXERK/iM1UUz5rBWMujf50TvX1ZeBjFbhKsXRuXDW42MBSkpS4SzUzkJgmvauDXbrNudl+Fee8evPbYsz/dqJ/+1xmDTA2CRKxVo0EXiQd0kte3YoZA8PrklcMYk/IA0yDXf1R0JrSmNXMjBJK2rNXEiGmdv4OdMfd/c6Q5Lb5GFeXXsd+5R53UcQjFFr4BQ3FU802gUI9ilM0D04zLSSriENgYjb60kcuQqB8tusGTb4xRwXuY1mIZjsftSgbuZOvg666qrcs+YEhSxJVlAafFmBtjdipIcBmcQrCOLu2/ZA/0cVBs4MyHibIyseXjve0rF9alk69B/p45jHM7jGLWjcQZef2r0SEaB1JYDwI0G1ndbO3CB/UziAYtGqQYsDn54MfYPLHDT0RpdnygQytY4cYtodxvfdNjSiiFUShI2cAydUesHYiW2+TPcr8+or9p15pYxCtrNyUQRNcJMBhvGdhjDxgpMsG9vTjNDBQbS00/QQ1mt1PppNX99Nauk3g4NMechMOWShEsHWhvcLGLBXNjf9Pze3b304jIVeHl81i09Wyfdcef+LSRkE1SZy3vzlc89uWlIer9afauXJw6u5EOu7IQSFumWRjRYfxyfoDhTv0dRISFktlyYGYFWkM1aNmUZTPn4Tn1Vc/hQYz5/KY7MvhzU6P5q2TkrmOAYrtr+7k94AZfluHCHl0RA76rnkwVoSyZD6fEZAYpQYc4wg1HqLZUaibN/IdIqvO0a4NShi+AuOwrWJXdL/N0d3IRQJUAWloM9PCwLRqyqUq7UC7LfQLl3oywd24EKr/RuSp/oRWfK+5IE0uD80TgkW4PAVbk6ON7jjX1YOxApOr+/zh/OU5/+pkTC3bnYRE+vvvxtkV6lVOtE5LKV1c3wYr7TEJQ1V8Ps9hp1iF824dYOD5A6U/ZWAxBFH/pf2vprHSVbfOMWNSVMrxMtPHUP4D221SJoIYRJKsnR2mDnrJYc/vsPWmESQyw3SKLjPhVhnx2XfN8iJEJsHLEGzc33vYI3/tAt8nMQWGDpDxuPzv3Dt/8Y0TBSvKR0xMd4oWwO/rPVvN3Yo/93KZCnyh/9yc2usPvxYiez4QqqO/KkRSwhxW0WdDUwMKEih6lS/ZNVwjcFFMlhCMEo+J74cvo9gRhL70zottJy0aMenGhbfJk5lvZCcFKqNl1RIYHe5yEcH6G+bqtSqOOAf2S9hvhYD9iFwTlk1L7aEwNnRK2CqYKp0gRhplBkNxIyCqEnPWYbDNsPldUUm8Ellpg7OMRKjpx2GZwHFIf0wZfDtYBdEOpW2GKG+fvi7m0qyjw62SUjYPwqavL1P0YWuDt4qi2ACBiV5DVIIAqnIdIyaLghleKSVb6LrLNXjLS0yURT07x0UP4vNrrg0kRAeCvMSCtK9xMOLb9o0qmteS0SgKNjH2bIeqA/Z129xkoDItx0PqWXF6YdJB1lGjG34FmR7aQU89dGjjYYY/Cs/V1Xlhv5tBD+73ElYT62Vj+PfMDCl26zw6bVzgZpYUjT65gykj25siwnQp+LO761SXo//bFjP/O52Jio35Yc6hQI0QhnfzvVEnOf5Vdj4IRumWRlTrz1O4xYhJWyz0mejfik0KxliPdwk856r/u3Ny1OQMgnVCd7L6idT1KoSStGQpOCPF0waAAA");
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

/* ══════════════════════════════════════════════════════════════════════
   extra.css.js
   ══════════════════════════════════════════════════════════════════════ */
/* Styles for the v2 additions (filter bar, zoom, proof drawer, tie-out strip). */
const EXTRA_CSS = `
.zoom-root{transform-origin:0 0;width:100%;height:100%;}
/* sidebar: closed by default, opens while hovered (overlays the page, no reflow) */
@media(min-width:901px){
.sidebar.collapsed.peek{width:var(--sidebar-w);margin-right:calc(14px + var(--sidebar-w-collapsed) - var(--sidebar-w));z-index:60;}
.sidebar.collapsed.peek .sb-logo{padding:20px 18px 16px;display:block;}
.sidebar.collapsed.peek .sb-mark{display:inline;}
.sidebar.collapsed.peek .sb-tag,.sidebar.collapsed.peek .sb-brand-text,.sidebar.collapsed.peek .nav-section,.sidebar.collapsed.peek .sb-footer-stats{display:block;}
.sidebar.collapsed.peek .nav-label,.sidebar.collapsed.peek .logout-btn-label{display:inline;}
.sidebar.collapsed.peek .nav-divider{display:none;}
.sidebar.collapsed.peek .nav-item{justify-content:flex-start;padding:8px 18px;gap:9px;}
.sidebar.collapsed.peek .nav-pip{position:static;transform:none;margin-left:auto;}
.sidebar.collapsed.peek .sb-footer{display:block;padding:10px 16px;}
}
.sb-collapse-btn{display:none !important;}
/* visible dropdown arrows */
.panel-select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23107fb0' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;background-repeat:no-repeat !important;background-position:right 7px center !important;background-size:10px 6px !important;padding-right:24px !important;}
.fb-multi{background-image:none !important;padding-right:8px !important;}
.fb-caret{opacity:1;color:var(--accent2);font-size:0;width:10px;height:6px;flex-shrink:0;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23107fb0' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/10px 6px;}
/* page zoom: floating control, bottom-left corner */
.tb-zoom{background:var(--surface);}
.fb-corner{position:absolute;top:7px;right:20px;z-index:2;}
.fb .fb-row{padding-right:150px;}
/* top bar: title left; search, export and last-update pushed to the right */
.topbar .tb-titlewrap{flex:1 1 auto;min-width:0;order:0;}
.topbar .tb-search{order:1;}
.topbar .tb-right{order:2;}
.sidebar.collapsed.peek{z-index:400 !important;}
.wk-chk{font-size:12px;}
.wk-chk.up b{color:var(--green);}
.wk-tbl th{white-space:nowrap;vertical-align:bottom;}
.wk-tbl .wk-h1{display:block;}
.wk-tbl .wk-h2{display:block;font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted2);font-size:10.5px;}
.wk-tbl td:not(:first-child),.wk-tbl th:not(:first-child){text-align:right;}
/* sizes never follow content: the body of each card has a fixed box */
.chart-panel{min-width:0;}
.chart-panel:not(.hug) .cp-body{contain:size;}
.chart-panel .cp-body .tbl-wrap{height:100%;max-height:100%;overflow:hidden;}
.rc-strip{width:100%;min-width:0;box-sizing:border-box;}
.rc-strip .rc-box{min-width:170px;flex:1 1 170px;}
.chart-panel.hug .cp-body{display:block;min-width:0;}
.page-area.fin-scroll .charts-row > .chart-panel.hug{flex:1 1 0% !important;min-width:0;}
.rc-strip{row-gap:8px;}
.cp-title-desc{font-size:11px;font-weight:500;color:var(--muted);text-transform:none;letter-spacing:0;}
.compact-tbl .itbl th,.compact-tbl .itbl td{padding-left:6px;padding-right:6px;}
.compact-tbl .itbl{table-layout:auto;width:100%;}
.compact-tbl .itbl td{white-space:normal;}
.compact-tbl .itbl td:nth-child(1),.compact-tbl .itbl td:nth-child(2){min-width:150px;max-width:230px;}
.compact-tbl .itbl td:nth-child(n+4),.compact-tbl .itbl th:nth-child(n+4){white-space:nowrap;}
.compact-tbl .itbl th:nth-child(7){white-space:normal;min-width:95px;}
.zoom-root .app{height:100%;}
.page-area{overflow-y:auto;overflow-x:hidden;}
/* never squash charts: rows keep their content height and the page scrolls instead */
.page-area .charts-row,.page-area .charts-col{min-height:auto;flex-shrink:0;}
.page-area .kpi-strip{flex-shrink:0;flex-wrap:wrap;}
.page-area .kpi-strip>.kpi-card{min-width:150px;}
.chart-panel:not(.hug):not(.fin-fixed){min-height:300px;}
.chart-panel:not(.hug) .cp-body{min-height:190px;}
.chart-panel .cp-head{flex-wrap:wrap;}
.ar-cmp-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:2px 0 -4px;}
.charts-row:has(.cp-grown),.charts-col:has(.cp-grown){min-height:auto;flex-shrink:0;}
.page-area:has(.cp-grown) .charts-row{flex-shrink:0;}
.zoomed .page-area:not(.fin-scroll) .charts-row{min-height:300px;flex-shrink:0;}

/* top bar */
.tb-zoom{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:20px;background:var(--surface3);overflow:hidden;flex-shrink:0;}
.tb-zoom button{border:none;background:transparent;color:var(--accent2);padding:5px 8px;cursor:pointer;display:inline-flex;align-items:center;font-family:inherit;}
.tb-zoom button:hover:not(:disabled){background:rgba(64,188,243,0.10);}
.tb-zoom button:disabled{opacity:.35;cursor:not-allowed;}
.tb-zoom .tb-zoom-val{font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--text);min-width:42px;justify-content:center;border-left:1px solid var(--border);border-right:1px solid var(--border);}
.live-badge{gap:6px;}
.live-badge .tb-time-in{font-family:'JetBrains Mono',monospace;font-weight:700;}
.live-badge .tb-snap{font-weight:600;color:#8E3A3A;}
@media(max-width:1100px){.live-badge .tb-snap{display:none;}}

/* filter bar */
.filter-bar.fb{flex-direction:column;align-items:stretch;gap:4px;padding:7px 20px 6px;min-height:0;}
.fb-local{box-shadow:inset 3px 0 0 var(--accent);}
.fb-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 10px;}
.fb-field{display:flex;flex-direction:column;gap:2px;min-width:0;}
.fb-field .panel-select{max-width:260px;}
.fb-multi{display:inline-flex;align-items:center;justify-content:space-between;gap:6px;text-align:left;cursor:pointer;}
.fb-multi.on{border-color:var(--accent);background:rgba(64,188,243,0.08);color:var(--accent2);font-weight:700;}
.fb-multi-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fb-caret{opacity:.6;font-size:9px;}
.fb-seg{display:flex;gap:4px;}
.fb-seg .filter-chip{padding:3px 9px;}
.fb-reset{align-self:flex-end;margin-bottom:2px;}
.fb-meta{display:flex;flex-wrap:wrap;gap:3px 14px;font-size:10.5px;color:var(--muted);line-height:1.4;}
.fb-meta b{color:var(--text);}
.fb-warn{color:#8E610D;}
.fb-dims{color:var(--accent2);font-weight:600;}
.fb-badge{color:var(--accent2);font-weight:700;}
.fb-asof{margin-left:auto;}
.fb-pop{position:fixed;z-index:10050;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 32px rgba(20,40,50,.18);width:260px;max-height:340px;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
.fb-pop-search{margin:8px 8px 4px;padding:6px 9px;border:1px solid var(--border);border-radius:5px;font-size:12px;font-family:inherit;outline:none;}
.fb-pop-search:focus{border-color:var(--accent);}
.fb-pop-actions{display:flex;gap:6px;padding:4px 8px 6px;border-bottom:1px solid var(--border);}
.fb-pop-actions button{font-size:11px;font-weight:700;color:var(--accent2);background:rgba(64,188,243,0.08);border:1px solid rgba(64,188,243,0.25);border-radius:4px;padding:2px 8px;cursor:pointer;font-family:inherit;}
.fb-pop-list{overflow:auto;padding:4px 0;}
.fb-pop-item{display:flex;align-items:center;gap:7px;padding:5px 10px;font-size:12.5px;color:var(--text);cursor:pointer;}
.fb-pop-item:hover{background:var(--surface2);}
.fb-pop-item.on{font-weight:700;color:var(--accent2);}
.fb-pop-empty{padding:10px;font-size:12px;color:var(--muted);text-align:center;}
.nav-local{color:var(--accent);font-size:8px;margin-left:5px;vertical-align:middle;}

/* panel controls */
.cp-zoom{display:inline-flex;align-items:center;gap:3px;}
.cp-zoom .cp-expand-btn:disabled{opacity:.35;cursor:not-allowed;}
.cp-zoom-val{font-size:9.5px;font-weight:700;font-family:'JetBrains Mono',monospace;border:1px solid var(--accent);color:var(--accent2);background:rgba(64,188,243,0.08);border-radius:4px;padding:1px 5px;cursor:pointer;}
.kpi-card .kpi-chg{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;}
.itbl td.up,.up{color:var(--green);}
.itbl td.down,.down{color:var(--red);}
.itbl tr.tot td{font-weight:700;background:var(--surface3);border-top:1px solid var(--border2);}
.itbl.tree td:first-child{white-space:nowrap;}

/* receivables tie-out */
.rc-strip{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px;}
.rc-box{display:flex;flex-direction:column;justify-content:space-between;gap:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface3);min-width:120px;flex:1;font-size:11px;color:var(--muted);}
.rc-box b{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text);}
.rc-box.eq{background:rgba(64,188,243,0.08);border-color:rgba(64,188,243,0.35);}
.rc-op{align-self:center;font-weight:800;color:var(--muted2);font-size:15px;}
.rc-ok{align-self:center;font-weight:800;color:var(--green);font-size:13px;padding:0 6px;}
.rc-ok.bad{color:var(--red);}

/* "how this number is built" drawer */
.pf-shade{position:fixed;inset:0;background:rgba(15,35,45,.35);z-index:9990;}
.pf-drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,96vw);background:var(--surface);z-index:9991;box-shadow:-12px 0 40px rgba(0,0,0,.2);display:flex;flex-direction:column;padding:16px 18px;gap:10px;font-family:Inter,system-ui,sans-serif;animation:pfIn .22s cubic-bezier(.4,0,.2,1);}
@keyframes pfIn{from{transform:translateX(30px);opacity:0;}to{transform:none;opacity:1;}}
.pf-top{display:flex;gap:10px;align-items:flex-start;}
.pf-dims{display:flex;flex-wrap:wrap;gap:5px;align-items:center;}
.pf-kpis{display:flex;gap:8px;}
.pf-kpis>div{flex:1;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:7px 10px;display:flex;flex-direction:column;gap:2px;}
.pf-kpis span{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
.pf-kpis b{font-family:'JetBrains Mono',monospace;font-size:15px;}
.pf-note{font-size:11.5px;color:#8E610D;background:rgba(229,169,61,.1);border-radius:6px;padding:6px 9px;}
.itbl tfoot td{position:sticky;bottom:0;}
.pf-check{font-size:12px;color:var(--green);font-weight:600;}
.pf-table{flex:1;min-height:0;}
.pf-foot{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted2);}

/* chatbot text follows the page zoom a little (window size unchanged) */
.cb-msgs,.cb-suggestions,.cb-empty,.cb-textarea-row,.cb-followups{zoom:var(--chat-text-zoom,1);}
@media print{.filter-bar.fb .fb-row{display:none;}.tb-zoom{display:none;}}
`;

/* ══════════════════════════════════════════════════════════════════════
   FilterContext.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Filters are per page: each page keeps its own selection; nothing is shared. */
const Ctx = createContext(null);
const KEY = 'dairytop_v2_page_filters';

function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object' && Object.values(s).every(f => f && f.to < X.nM)) return s;
  } catch { /* ignore */ }
  return {};
}

function FilterProvider({ children }) {
  const [pages, setPages] = useState(load);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(pages)); } catch { /* ignore */ } }, [pages]);
  return <Ctx.Provider value={{ pages, setPages }}>{children}</Ctx.Provider>;
}

function usePageFilter(page) {
  const { pages, setPages } = useContext(Ctx);
  const f = pages[page] || defaultFilter();
  const setF = useCallback(upd => setPages(p => {
    const cur = p[page] || defaultFilter();
    return { ...p, [page]: typeof upd === 'function' ? upd(cur) : upd };
  }), [page, setPages]);
  const resetAll = useCallback(() => setPages(p => { const n = { ...p }; delete n[page]; return n; }), [page, setPages]);
  return { f, setF, resetAll, local: true, setLocal: () => {}, localPages: [] };
}

/* ══════════════════════════════════════════════════════════════════════
   FilterBar.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Uniform filter bar for every page (except Overview, which is the live view).
   Same filters as the DairyTop Business Cockpit, plus multi-select, drill-down
   and an "All pages / This page" scope switch. */
function MultiSelect({ label, allLabel, options, value, onChange, width = 170 }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const btn = useRef(null), pop = useRef(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 270) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (btn.current?.contains(e.target) || pop.current?.contains(e.target)) return; setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const sel = new Set(value);
  const shown = options.filter(o => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()));
  const txt = !value.length ? allLabel : value.length === 1 ? value[0] : `${value.length} selected`;
  const toggle = o => onChange(sel.has(o) ? value.filter(v => v !== o) : [...value, o]);
  return (
    <label className="fb-field">
      <span className="filter-label">{label}</span>
      <button ref={btn} type="button" className={`panel-select fb-multi${value.length ? ' on' : ''}`} style={{ width }} onClick={() => setOpen(v => !v)} aria-haspopup="listbox" aria-expanded={open} title={value.join(', ') || allLabel}>
        <span className="fb-multi-txt">{txt}</span><span className="fb-caret">▾</span>
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="fb-pop" style={{ top: pos.top, left: pos.left }} role="listbox" aria-multiselectable="true">
          {options.length > 8 && <input className="fb-pop-search" autoFocus placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />}
          <div className="fb-pop-actions">
            <button type="button" onClick={() => onChange([])}>{allLabel}</button>
            {q.trim() && <button type="button" onClick={() => onChange([...new Set([...value, ...shown])])}>Select shown</button>}
          </div>
          <div className="fb-pop-list">
            {shown.map(o => (
              <label key={o} className={`fb-pop-item${sel.has(o) ? ' on' : ''}`}>
                <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} /> <span>{o}</span>
              </label>
            ))}
            {!shown.length && <div className="fb-pop-empty">No match</div>}
          </div>
        </div>, document.body)}
    </label>
  );
}

const GRAINS = [['year', 'Year'], ['month', 'Month'], ['week', 'Week'], ['day', 'Day']];

function FilterBar({ f, setF, resetAll, ignores, grainUsed = true, corner }) {
  const P = period(f);
  const months = X.months.map((m, i) => [i, mLong(m) + (i === X.partial.m ? ` (to ${X.partial.day})` : '')]);
  const daily0 = X.months[X.firstDaily], drillTxt = `Week & day drill-down: ${mLong(daily0)} – ${X.ledgerLabel}`;
  const portalInRange = f.from < X.firstDaily;
  const set = patch => setF(p => ({ ...p, ...patch }));
  const dimsActive = f.reps.length + f.grps.length + f.mkts.length;
  return (
    <div className="filter-bar fb">
      {corner && <div className="fb-corner">{corner}</div>}
      <div className="fb-row">
        <label className="fb-field"><span className="filter-label">Period</span>
          <select className="panel-select" value={f.preset} onChange={e => setF(p => applyPreset(p, e.target.value))}>
            {presetList().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="fb-field"><span className="filter-label">From</span>
          <select className="panel-select" value={f.from} onChange={e => { const v = +e.target.value; set({ from: v, to: Math.max(v, f.to), preset: 'custom' }); }}>
            {months.map(([i, l]) => <option key={i} value={i}>{l}</option>)}
          </select>
        </label>
        <label className="fb-field"><span className="filter-label">To</span>
          <select className="panel-select" value={f.to} onChange={e => { const v = +e.target.value; set({ to: v, from: Math.min(v, f.from), preset: 'custom' }); }}>
            {months.map(([i, l]) => <option key={i} value={i}>{l}</option>)}
          </select>
        </label>
        <label className="fb-field"><span className="filter-label">Compare with</span>
          <select className="panel-select" value={f.cmp} onChange={e => set({ cmp: e.target.value })}>
            <option value="py">Same period last year</option><option value="pp">Previous period</option><option value="none">No comparison</option>
          </select>
        </label>
        <div className="filter-divider" />
        <MultiSelect label="Verkoper" allLabel="All verkopers" options={X.reps} value={f.reps} onChange={v => set({ reps: v })} />
        <MultiSelect label="Product group" allLabel="All product groups" options={GROUPS.slice(0, 5)} value={f.grps} onChange={v => set({ grps: v })} width={150} />
        <MultiSelect label="Market" allLabel="All markets" options={X.mkts} value={f.mkts} onChange={v => set({ mkts: v })} width={140} />
        <div className="filter-divider" />
        <div className="fb-field"><span className="filter-label" title={drillTxt}>Drill-down</span>
          <div className="fb-seg" role="group" aria-label="Time drill-down">
            {GRAINS.map(([k, l]) => (
              <button key={k} type="button" className={`filter-chip${f.grain === k ? ' active' : ''}`} onClick={() => set({ grain: k })}
                title={k === 'week' || k === 'day' ? drillTxt : `Show time charts per ${l.toLowerCase()}`}>{l}</button>
            ))}
          </div>
        </div>
        <button type="button" className="filter-clear fb-reset" onClick={resetAll}>Reset filters</button>
      </div>
      <div className="fb-meta">
        <span><b>Showing</b> {P.label}{P.cmp ? <> vs {P.cmpLabel}</> : null}</span>
        {P.note && <span className="fb-warn">{P.note}</span>}
        {dimsActive > 0 && <span className="fb-dims">{dimText(f)}</span>}
        {ignores && <span className="fb-warn">{ignores}</span>}
        {(f.grain === 'week' || f.grain === 'day') && grainUsed && <span className={portalInRange ? 'fb-warn' : ''}>{drillTxt}{portalInRange ? ' · earlier months have monthly totals only' : ''}</span>}
        <span className="fb-asof">All amounts excl. VAT · Last Invoice <b>{X.ledgerLabel}</b></span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   common.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Helpers shared by the pages: period views, time series by drill-down level,
   chart option builders and the "how this number is built" drawer. */
const AX = { color: '#5F7078', fontSize: 9 };
const SPLIT = { lineStyle: { color: '#F0F3F4' } };
const CY = '#73D4F2', PY = '#0891B2';

/* Memoised by a string key so filter objects with equal content reuse the result */
function useSales(f, extra, deps = []) {
  const key = filterKey(f) + '|' + deps.join('|');
  return useMemo(() => sales(f, extra), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
function useLegacy(f) {
  const key = dimsKey(f);
  return useMemo(() => legacy(f), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* Time series for the current period at the chosen drill-down level */
function timeSeries(f, L, grain) {
  const P = period(f), ms = new Set(P.months);
  const fm = L.monthly.filter(r => ms.has(r.mi));
  if (grain === 'year') {
    const g = new Map();
    for (const r of fm) { const y = r.iso.slice(0, 4); const x = g.get(y) || { key: y, label: y, rev: 0, orders: null, kg: 0, months: [] }; x.rev += r.rev; x.kg += r.kg; if (r.orders != null) x.orders = (x.orders || 0) + r.orders; x.months.push(r.mi); g.set(y, x); }
    return { grain, unit: 'Year', rows: [...g.values()] };
  }
  if (grain === 'week' || grain === 'day') {
    const lo = Date.UTC(+X.months[f.from].slice(0, 4), +X.months[f.from].slice(5) - 1, 1) / 864e5;
    const e = X.months[f.to], hi = Date.UTC(+e.slice(0, 4), +e.slice(5), 0) / 864e5;
    if (grain === 'week') return { grain, unit: 'Week', rows: L.weekly.filter(w => w.mon + 6 >= lo && w.mon <= hi).map(w => ({ key: w.w, label: w.w, sub: `${w.start} – ${w.end}`, rev: w.rev, orders: w.orders, kg: w.kg })) };
    return { grain, unit: 'Day', rows: L.daily.filter(d => d.t >= lo && d.t <= hi).map(d => ({ key: d.iso, label: d.d, rev: d.rev, orders: d.orders, kg: d.kg })) };
  }
  return { grain: 'month', unit: 'Month', rows: fm.map(r => ({ key: r.iso, label: r.m, mi: r.mi, rev: r.rev, orders: r.orders, kg: r.kg })) };
}

/* Horizontal bar ranking (used by many pages) */
function hbarOpt(rows, { color, colors, fmtV = fmtFull, cmp, labelW, sel } = {}) {
  const mob = isMobileViewport();
  return withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
      const r = rows[p[0].dataIndex], gg = r.g !== undefined ? r.g : growth(r.v, r.c); return `<strong>${r.full || r.n}</strong><br/>${fmtV(r.v)}${r.c != null ? `<br/><span style="opacity:.75">Comparison: ${fmtV(r.c)} (${gg == null ? '—' : (gg >= 0 ? '+' : '') + gg.toFixed(1).replace('.', ',') + '%'} on comparable months)</span>` : ''}${r.extra ? '<br/>' + r.extra : ''}`;
    } },
    grid: { left: '2%', right: '6%', bottom: '8%', top: '3%', containLabel: true },
    xAxis: { type: 'value', min: 0, splitNumber: mob ? 4 : 5, axisLabel: { ...AX, formatter: v => fmtV === fmtFull ? fmt(v) : fmtV(v), hideOverlap: true }, splitLine: SPLIT },
    yAxis: { type: 'category', data: rows.map(r => (r.n || '').length > (labelW || 22) ? r.n.slice(0, labelW || 22) + '…' : r.n), axisLabel: { ...AX, interval: rows.length <= 12 ? 0 : 'auto' }, inverse: true },
    series: [
      { type: 'bar', data: rows.map((r, i) => ({ value: r.v, itemStyle: { color: (colors ? colors[i] : color || PALETTE[i % PALETTE.length]) + (sel && sel !== r.n ? '44' : ''), borderRadius: [0, 3, 3, 0] } })), barMaxWidth: 18, z: 2 },
      ...(cmp ? [{ type: 'scatter', symbol: 'rect', symbolSize: [3, 14], data: rows.map((r, i) => [r.c, i]), itemStyle: { color: '#1F3741' }, z: 3, tooltip: { show: false } }] : []),
    ],
  }, 'y');
}

/* Vertical columns, current vs comparison */
function colOpt(labels, cur, cmp, { fmtV = fmtFull, axisFmt, curName = 'This period', cmpName = 'Comparison', curColor = CY, cmpColor = PY, line } = {}) {
  return withDataZoom(withCrosshair({
    tooltip: { trigger: 'axis', formatter: p => `<strong>${p[0].name}</strong><br/>` + p.map(s => `${s.marker} ${s.seriesName}: ${s.value != null ? fmtV(s.value) : '—'}`).join('<br/>') },
    legend: cmp ? { bottom: 2, textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect', selectedMode: false } : undefined,
    grid: { left: '3%', right: '4%', bottom: cmp ? '16%' : '10%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: catAxisLabel(labels.length, 9) },
    yAxis: { type: 'value', scale: !!line, axisLabel: { ...AX, formatter: axisFmt || (v => fmtV === fmtFull ? fmt(v) : fmtV(v)) }, splitLine: SPLIT },
    series: [
      ...(cmp ? [{ name: cmpName, type: line ? 'line' : 'bar', data: cmp, itemStyle: { color: cmpColor, borderRadius: [3, 3, 0, 0] }, lineStyle: line ? { type: 'dashed', width: 2, color: cmpColor } : undefined, symbol: 'circle', symbolSize: 4, barGap: '0%', barCategoryGap: '30%' }] : []),
      { name: curName, type: line ? 'line' : 'bar', data: cur, itemStyle: { color: curColor, borderRadius: [3, 3, 0, 0] }, lineStyle: line ? { width: 2.5, color: curColor } : undefined, symbol: 'circle', symbolSize: 5, barGap: '0%', barCategoryGap: '30%' },
    ],
  }, axisFmt || (v => fmtV(v))));
}

function donutOpt(items, { sel, legend = true } = {}) {
  return {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'item', formatter: p => `${p.data.full || p.name}: ${fmtFull(p.value)} (${p.percent}%)` },
    legend: legend ? { bottom: 0, textStyle: { color: '#5F7078', fontSize: 9 }, type: 'scroll', selectedMode: false } : undefined,
    series: [{ type: 'pie', radius: ['48%', '70%'], center: ['50%', legend ? '44%' : '50%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      data: items.map((d, i) => ({ name: d.n, full: d.full, value: Math.max(0, d.v), itemStyle: { color: (d.color || PALETTE[i % PALETTE.length]) + (sel && sel !== d.n ? '44' : '') } })) }],
  };
}

/* ── "How this number is built" drawer ─────────────────────────────────── */
const ProofCtx = createContext(() => {});
const useProof = () => useContext(ProofCtx);

const DIMS = {
  month: { n: 'Month', f: i => X.facts.m[i], l: k => mLong(X.months[k]) },
  week: { n: 'Week', f: i => X.facts.W[i] || '~portal', l: k => k === '~portal' ? 'Jan 2025 – Mar 2026 (monthly totals only, no weeks)' : `${k} (${isoWk(k)})` },
  group: { n: 'Product group', f: i => X.facts.G[i], l: k => GROUPS[k] },
  category: { n: 'Category', f: i => X.facts.g[i], l: k => X.categories[k][0] },
  verkoper: { n: 'Verkoper', f: i => X.facts.v[i], l: k => X.verkopers[k] },
  customer: { n: 'Customer', f: i => X.facts.c[i], l: k => X.customers[k][0] },
  product: { n: 'Product', f: i => X.facts.p[i], l: k => X.products[k][0] },
  market: { n: 'Market', f: i => X.facts.M[i], l: k => X.mkts[k] },
};
const isoWk = k => { const t = X.weekMon.get(k); if (t == null) return ''; const d = a => { const x = new Date(a * 864e5); return x.getUTCDate() + ' ' + MN[x.getUTCMonth()]; }; return d(t) + ' – ' + d(t + 6); };
const COLS = { r: ['Revenue', v => fmtFull(v / 100)], k: ['Tonnes', v => (v / 1e6).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t'], q: ['Pieces', v => fmtN(v / X.qScale)] };

function ProofProvider({ children }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    if (!cfg) return;
    const k = e => { if (e.key === 'Escape') setCfg(null); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [cfg]);
  return (
    <ProofCtx.Provider value={setCfg}>
      {children}
      {cfg && createPortal(<ProofDrawer cfg={cfg} close={() => setCfg(null)} />, document.body)}
    </ProofCtx.Provider>
  );
}

function ProofDrawer({ cfg, close }) {
  const dims0 = cfg.dims || ['month', 'group', 'verkoper', 'customer', 'product', 'market', 'category'];
  const dims = dims0.includes('week') ? dims0 : (dims0.includes('month') ? [...dims0.slice(0, dims0.indexOf('month') + 1), 'week', ...dims0.slice(dims0.indexOf('month') + 1)] : [...dims0, 'week']);
  const [dim, setDim] = useState(dims[0]);
  const isList = !!cfg.list;
  const col = cfg.col || 'r';
  const K = useMemo(() => isList ? null : sales(cfg.f, cfg.extra), [cfg, isList]);
  const rows = useMemo(() => {
    if (isList) return null;
    const d = DIMS[dim], a = by(K.cur, d.f, col), b = by(K.cmp, d.f, col), s = by(K.curC, d.f, col);
    const tot = [...a.values()].reduce((x, v) => x + v, 0);
    const list = [...new Set([...a.keys(), ...b.keys()])].map(k => ({ k, l: d.l(k), v: a.get(k) || 0, c: K.cmp ? (b.get(k) || 0) : null, g: K.cmp ? growth(s.get(k) || 0, b.get(k) || 0) : null })).filter(r => r.v || r.c);
    const wkey = k => k === '~portal' ? -1 : (X.weekMon.get(k) ?? 0);
    if (dim === 'month') list.sort((x, y) => x.k - y.k); else if (dim === 'week') list.sort((x, y) => wkey(x.k) - wkey(y.k)); else list.sort((x, y) => y.v - x.v);
    return { tot, totC: K.cmp ? [...b.values()].reduce((x, v) => x + v, 0) : null, totB: K.cmp ? [...s.values()].reduce((x, v) => x + v, 0) : null, list };
  }, [K, dim, col, isList]);
  const [fmtC] = [COLS[col][1]];
  const head = isList ? cfg.list.head : [DIMS[dim].n, COLS[col][0], ...(K?.cmp ? ['Comparison', 'Change'] : []), 'Share'];
  const body = isList ? cfg.list.rows : rows.list.map(r => [r.l, fmtC(r.v), ...(K.cmp ? [fmtC(r.c), pctTxt(r.g)] : []), rows.tot ? fmtShare(r.v / rows.tot * 100) : '—']);
  const check = isList ? cfg.list.check : `✓ ${rows.list.length} rows add up to ${fmtC(rows.tot)}`;
  const parseNum = v => { const t = String(v).trim(); if (!/^-?(€\s?)?-?[\d.]+(,\d+)?( t| d| pcs)?$/.test(t)) return null; return parseFloat(t.replace(/[€\s]|t$|d$|pcs$/g, '').replace(/\./g, '').replace(',', '.')); };
  const listFooter = () => {
    const skip = /date|invoice|due|status|month|last|gap|days|since|late|orders|bank|%|€\/kg|share/i;
    return head.map((h, ci) => {
      if (ci === 0) return 'Total';
      if (skip.test(h)) return '';
      const vals = body.map(r => parseNum(r[ci])); if (!vals.length || vals.some(v => v == null)) return '';
      const sum = vals.reduce((x, v) => x + v, 0), ex = String(body[0][ci]);
      return ex.includes('€') ? fmtEur2(sum) : ex.endsWith(' t') ? sum.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t' : fmtN(sum);
    });
  };
  const footer = isList ? listFooter() : ['Total', fmtC(rows.tot), ...(K.cmp ? [fmtC(rows.totC), pctTxt(growth(rows.totB, rows.totC))] : []), rows.tot ? '100,0%' : '—'];
  const weekNote = !isList && dim === 'week' && K.P.cur.some(c => X.isPortalM[c.m]) ? 'Weeks exist from Apr 2026. Jan 2025 – Mar 2026 come from the former portal with monthly totals only, so they are shown as one line.' : null;
  const copy = () => { const t = [head, ...body].map(r => r.join('\t')).join('\n'); try { navigator.clipboard.writeText(t); } catch { /* ignore */ } };
  return (
    <>
      <div className="pf-shade" onClick={close} />
      <aside className="pf-drawer" aria-label="How this number is built">
        <div className="pf-top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cp-title" style={{ fontSize: 15 }}>{cfg.title}</div>
            <div className="cp-sub">{cfg.def}</div>
            {!isList && <div className="cp-sub" style={{ marginTop: 4 }}><b>{K.P.label}</b>{K.cmp ? ` vs ${K.P.cmpLabel}` : ''} · {dimText(cfg.f)}</div>}
          </div>
          <button className="cfs-close" onClick={close} title="Close (Esc)">✕</button>
        </div>
        {!isList && (
          <div className="pf-dims">
            <span className="filter-label">Break down by</span>
            {dims.map(d => <button key={d} className={`filter-chip${dim === d ? ' active' : ''}`} onClick={() => setDim(d)}>{DIMS[d].n}</button>)}
          </div>
        )}
        {!isList && (
          <div className="pf-kpis">
            <div><span>Total</span><b>{fmtC(rows.tot)}</b></div>
            {K.cmp && <div><span>Comparison</span><b>{fmtC(rows.totC)}</b></div>}
            {K.cmp && <div><span>Change</span><b className={rows.totB >= rows.totC ? 'up' : 'down'}>{pctTxt(growth(rows.totB, rows.totC))}</b></div>}
          </div>
        )}
        <div className="pf-check" dangerouslySetInnerHTML={{ __html: check }} />
        {weekNote && <div className="pf-note">{weekNote}</div>}
        <div className="pf-table"><InlineTable headers={head} rows={body} height="100%" searchable footer={footer} /></div>
        <div className="pf-foot"><button className="panel-btn" onClick={copy}>Copy table</button><span>Source: dash.json · excl. VAT</span></div>
      </aside>
    </>
  );
}

/* Small helpers */
const pctTxt = g => g == null ? '—' : (g >= 0 ? '+' : '') + g.toFixed(1).replace('.', ',') + '%';

/* ══════════════════════════════════════════════════════════════════════
   Overview.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Overview — the live view. Layout kept exactly as before; figures from dash.json.
   Not affected by the filter bar. */
const ALL = { reps: [], grps: [], mkts: [] };
const fmtTonT = v => (v === null || v === undefined || isNaN(v)) ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' t';
const fmtRev = v => (v === null || v === undefined || isNaN(v)) ? '—' : '€' + v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
const MP = 0; // Milk powder group

function Overview() {
  const L = useMemo(() => legacy(ALL), []);
  const monthly = L.monthly;
  const live = liveMonth();
  const currentMonth = live.label + (live.day ? ` (to ${live.day})` : '');

  /* Last 3 complete months, this year vs last year */
  const last3 = monthly.slice(X.lastFull - 2, X.lastFull + 1);
  const last3WithPY = last3.map(cur => { const py = monthly[cur.mi - 12]; return { name: cur.m.split(' ')[0], cyLabel: cur.m, cy: cur.rev, py: py ? py.rev : null, pyLabel: py ? py.m : null }; });
  const last3Idx = new Set(last3.map(m => m.mi));
  const cats = useMemo(() => {
    const ix = pick([...last3Idx].map(m => ({ m, cap: 99 })));
    const g = by(ix, i => X.facts.G[i]);
    return [...g].map(([k, v]) => ({ n: GROUPS[k], rev: v / 100 })).sort((a, b) => b.rev - a.rev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const catsTotalRev = cats.reduce((s, c) => s + c.rev, 0);

  /* Open orders: value of open order lines (delivered-not-billed + still to deliver), excl. VAT */
  const tiles = useMemo(() => {
    const O = X.orders.filter(o => o[5]);
    const OV = orderValue(O), curM = X.months[X.nM - 1], snap = X.meta.snapshot;
    const sum = pred => OV.rows.filter(r => pred(r.l)).reduce((s, r) => s + r.vd + r.vr, 0);
    const fut = sum(l => (l[8] || '') > snap && groupOfProduct(l[3]) === 2);
    const mtd = sum(l => (l[8] || '').startsWith(curM));
    const full = sum(l => (l[8] || '') <= snap);
    const cnt = pred => new Set(OV.rows.filter(r => pred(r.l)).map(r => r.l[0])).size;
    return { fut, mtd, full, nFut: cnt(l => (l[8] || '') > snap && groupOfProduct(l[3]) === 2), nMtd: cnt(l => (l[8] || '').startsWith(curM)), nFull: cnt(l => (l[8] || '') <= snap), unp: OV.unp };
  }, []);

  /* Melkpoeder tonnage — this year vs last year, per verkoper */
  const melkSalesmen = useMemo(() => {
    const s = new Set(); const F = X.facts;
    for (let i = 0; i < X.n; i++) if (F.G[i] === MP && F.k[i] > 0) s.add(X.verkopers[F.v[i]]);
    return [...s].filter(n => n !== 'Webshop' && n !== 'Unassigned').sort();
  }, []);
  const [melkSalesman, setMelkSalesman] = useState('All');
  const cyYear = X.months[X.nM - 1].slice(0, 4);
  const melkCYMonths = useMemo(() => monthly.filter(m => m.iso.startsWith(cyYear)).map(m => m.m), [monthly, cyYear]);
  const melkPeriods = ['Full period', ...melkCYMonths];
  const [melkPeriod, setMelkPeriod] = useState('Full period');
  const melkTonChartData = useMemo(() => {
    const repI = melkSalesman === 'All' ? null : X.repIdx.get(melkSalesman);
    const F = X.facts, kg = new Map(), rv = new Map();
    for (let i = 0; i < X.n; i++) {
      if (F.G[i] !== MP || (repI != null && F.v[i] !== repI)) continue;
      kg.set(F.m[i], (kg.get(F.m[i]) || 0) + F.k[i]); rv.set(F.m[i], (rv.get(F.m[i]) || 0) + F.r[i]);
    }
    const months = melkPeriod === 'Full period' ? melkCYMonths : [melkPeriod];
    return months.map(cyM => {
      const mi = X.mLabel.indexOf(cyM), pi = mi - 12, [name] = cyM.split(' ');
      return { label: name, cyM, pyM: pi >= 0 ? X.mLabel[pi] : '—', cy: (kg.get(mi) || 0) / 1000, py: pi >= 0 ? (kg.get(pi) || 0) / 1000 : null, cyRev: (rv.get(mi) || 0) / 100, pyRev: pi >= 0 ? (rv.get(pi) || 0) / 100 : null };
    });
  }, [melkSalesman, melkPeriod, melkCYMonths]);

  const melkTonOpt = useMemo(() => withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => {
      const d = melkTonChartData[params[0].dataIndex];
      return `<strong>${params[0].axisValue}</strong><br/><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#73D4F2;margin-right:4px"></span>This Year &nbsp; ${fmtTonT(d.cy)} &nbsp;|&nbsp; ${fmtRev(d.cyRev)}<br/><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#0891B2;margin-right:4px"></span>Last Year &nbsp; ${d.py != null ? fmtTonT(d.py) : '—'} &nbsp;|&nbsp; ${fmtRev(d.pyRev)}<br/>`;
    } },
    legend: { bottom: 2, textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect', selectedMode: false, padding: [0, 8] },
    grid: { left: '3%', right: '4%', bottom: isMobileViewport() && melkTonChartData.length > 3 ? '28%' : '22%', top: '5%', containLabel: true },
    xAxis: { type: 'category', data: melkTonChartData.map(d => d.label), axisLabel: catAxisLabel(melkTonChartData.length, 9) },
    yAxis: { type: 'value', minInterval: 0.1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => v.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' t' }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { name: 'Last Year', type: 'bar', data: melkTonChartData.map(d => d.py), itemStyle: { color: '#0891B2', borderRadius: [3, 3, 0, 0] }, barGap: '0%', barCategoryGap: '30%' },
      { name: 'This Year', type: 'bar', data: melkTonChartData.map(d => d.cy), itemStyle: { color: '#73D4F2', borderRadius: [3, 3, 0, 0] }, barGap: '0%', barCategoryGap: '30%' },
    ],
  }), [melkTonChartData]);
  const melkTonTable = { headers: ['Month', 'Ton TY', 'Rev TY', 'Ton LY', 'Rev LY'], rows: melkTonChartData.map(d => [d.cyM, fmtTonT(d.cy), fmtRev(d.cyRev), d.py != null ? fmtTonT(d.py) : '—', fmtRev(d.pyRev)]) };
  const melkTonControls = (
    <>
      <select className="panel-select" value={melkSalesman} onChange={e => setMelkSalesman(e.target.value)}><option value="All">All salesmen</option>{melkSalesmen.map(n => <option key={n} value={n}>{n}</option>)}</select>
      <select className="panel-select" value={melkPeriod} onChange={e => setMelkPeriod(e.target.value)}>{melkPeriods.map(p => <option key={p} value={p}>{p}</option>)}</select>
    </>
  );
  const melkTotCY = melkTonChartData.reduce((s, d) => s + (d.cy || 0), 0);
  const melkTotPY = melkTonChartData.some(d => d.py != null) ? melkTonChartData.reduce((s, d) => s + (d.py || 0), 0) : null;
  const melkDeltaPct = melkTotPY ? ((melkTotCY - melkTotPY) / melkTotPY * 100) : null;
  const melkTonInsight = `Melkpoeder${melkSalesman !== 'All' ? ` · ${melkSalesman.split(' ')[0]}` : ''}  — ${melkPeriod}: ${fmtTonT(melkTotCY)}${melkDeltaPct != null ? ` · ${melkDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(melkDeltaPct).toFixed(1)}% vs last year` : ''}`;

  const cmpOpt = withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => { let h = `<strong>${params[0].name}</strong><br/>`; params.forEach(p => { h += `${p.marker} ${p.seriesName}: ${p.value != null ? fmtFull(p.value) : '—'}<br/>`; }); return h; } },
    legend: { bottom: 2, textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect', selectedMode: false, padding: [0, 8] },
    grid: { left: '3%', right: '4%', bottom: '22%', top: '5%', containLabel: true },
    xAxis: { type: 'category', data: last3WithPY.map(d => d.name), axisLabel: catAxisLabel(last3WithPY.length, 9) },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { name: 'Last Year', type: 'bar', data: last3WithPY.map(d => d.py), itemStyle: { color: '#0891B2', borderRadius: [3, 3, 0, 0] }, barGap: '0%', barCategoryGap: '30%' },
      { name: 'This Year', type: 'bar', data: last3WithPY.map(d => d.cy), itemStyle: { color: '#73D4F2', borderRadius: [3, 3, 0, 0] }, barGap: '0%', barCategoryGap: '30%' },
    ],
  });
  const cmpTable = { headers: ['Month', 'This Year', 'Last Year'], rows: last3WithPY.map(d => [d.cyLabel, fmtFull(d.cy), d.py != null ? fmtFull(d.py) : '—']) };
  const momDelta = last3.length >= 2 && last3[1].rev ? ((last3[2].rev - last3[1].rev) / last3[1].rev) * 100 : null;
  const turnoverInsight = momDelta != null ? `Revenue ${momDelta >= 0 ? 'up' : 'down'} ${Math.abs(momDelta).toFixed(1)}% vs last month${cats[0] ? ` · Top category: ${cats[0].n} (${catsTotalRev > 0 ? (cats[0].rev / catsTotalRev * 100).toFixed(0) : 0}% of last 3 complete months)` : ''}` : null;

  /* Category trends: weekly (last 12 weeks) or monthly CY vs PY */
  const [catGrain, setCatGrain] = useState('weekly');
  const groupsWithData = useMemo(() => { const s = new Set(L.groupsMonthly.filter(r => r.rev).map(r => r.g)); return [0, 1, 2, 3, 4, 5].filter(g => s.has(g)); }, [L]);
  const LOG_MIN = 100;
  const logPt = v => { const r = Math.round(v || 0); return { value: r > 0 ? Math.max(r, LOG_MIN) : null, raw: r }; };
  const logAxis = floor => ({ type: 'log', logBase: 10, min: floor, max: v => v.max * 1.6, axisLabel: { color: '#5F7078', fontSize: 9, showMaxLabel: false, formatter: v => fmt(v) }, splitLine: { lineStyle: { color: '#F0F3F4' } }, minorSplitLine: { show: false } });
  const LOG_AXIS = logAxis(LOG_MIN);
  const tipFmt = p => { const rows = p.filter(s => s.data && s.data.raw != null && s.data.raw !== 0).map(s => ({ ...s, value: s.data.raw })); const half = Math.ceil(rows.length / 2); const col = arr => arr.map(s => `<div style="display:flex;align-items:center;gap:4px;line-height:1.6;white-space:nowrap">${s.marker}<span style="font-size:10px;white-space:nowrap">${s.seriesName}: ${fmtFull(s.value)}</span></div>`).join(''); return `<div style="font-size:11px;font-weight:700;margin-bottom:4px">${p[0].axisValue}</div><div style="display:flex;gap:16px;white-space:nowrap"><div>${col(rows.slice(0, half))}</div><div>${col(rows.slice(half))}</div></div>`; };
  const tipBase = { ...TOOLTIP_STYLE, trigger: 'axis', confine: false, appendToBody: true, extraCssText: 'border-radius:10px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:none !important;width:auto !important;white-space:nowrap;overflow:visible;', formatter: tipFmt };
  const catWeeklyOpt = useMemo(() => {
    const weeks = X.weeks.slice(-12), F = X.facts, wi = new Map(weeks.map((w, i) => [w, i]));
    const data = groupsWithData.map(() => new Array(weeks.length).fill(0));
    for (let i = 0; i < X.n; i++) { const k = wi.get(F.W[i]); if (k == null) continue; const gi = groupsWithData.indexOf(F.G[i]); if (gi >= 0) data[gi][k] += F.r[i] / 100; }
    return withCrosshair({
      tooltip: tipBase,
      legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 8 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
      grid: { left: '2%', right: '2%', bottom: '22%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: weeks, axisLabel: { color: '#5F7078', fontSize: 8, rotate: 30, hideOverlap: true } },
      yAxis: LOG_AXIS,
      series: groupsWithData.map((g, gi) => ({ name: GROUPS[g], type: 'line', connectNulls: false, data: data[gi].map(logPt), itemStyle: { color: GROUP_COLORS[g] }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 4 })),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsWithData]);
  const catMonthlyOpt = useMemo(() => {
    const y1 = +cyYear, y0 = y1 - 1;
    const common = MN.filter((mn, k) => X.months.includes(`${y0}-${String(k + 1).padStart(2, '0')}`) && X.months.includes(`${y1}-${String(k + 1).padStart(2, '0')}`));
    const val = (g, y, mn) => { const mi = X.months.indexOf(`${y}-${String(MN.indexOf(mn) + 1).padStart(2, '0')}`); const r = L.groupsMonthly.find(x => x.g === g && x.mi === mi); return r ? r.rev : 0; };
    const series = [];
    groupsWithData.forEach(g => {
      series.push({ name: `${GROUPS[g]} '${String(y1).slice(2)}`, type: 'line', data: common.map(mn => logPt(val(g, y1, mn))), itemStyle: { color: GROUP_COLORS[g] }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 4, smooth: true });
      series.push({ name: `${GROUPS[g]} '${String(y0).slice(2)}`, type: 'line', data: common.map(mn => logPt(val(g, y0, mn))), itemStyle: { color: GROUP_COLORS[g] }, lineStyle: { width: 1.5, type: 'dashed', opacity: 0.6 }, symbol: 'none', smooth: true });
    });
    return withCrosshair({
      tooltip: tipBase,
      legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 8 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
      grid: { left: '2%', right: '2%', bottom: '22%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: common, axisLabel: { color: '#5F7078', fontSize: 9 } },
      yAxis: logAxis(Math.pow(10, Math.floor(Math.log10(Math.max(LOG_MIN, Math.min(...series.flatMap(x => x.data.map(d => d.raw).filter(v => v > 0)))))))),
      series,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsWithData, L]);
  const nG = groupsWithData.length;
  const catSubtitle = catGrain === 'weekly'
    ? `${nG} groups · last 12 weeks · weeks start ${X.months[X.firstDaily] ? MN[+X.months[X.firstDaily].slice(5) - 1] + ' ' + X.months[X.firstDaily].slice(0, 4) : ''} — click Monthly for CY vs PY`
    : `${nG} groups · solid = ${cyYear}, dashed = ${+cyYear - 1} · same month comparison`;

  const T = tiles, nv = !hasOrderValues;
  return (
    <div className="page-area" key="overview">
      <div className="kpi-strip">
        <div className="kpi-card green"><div className="kpi-lbl">Turnover MTD</div><div className="kpi-val sm">{fmtFull(live.rev)}</div><div className="kpi-chg">Revenue this month, to date{live.day ? ` (1–${live.day} ${live.label.split(' ')[0]})` : ''}</div></div>
        <div className="kpi-card amber"><div className="kpi-lbl">Projected MTD</div><div className="kpi-val sm">{nv ? '—' : fmtFull(live.rev + T.mtd)}</div><div className="kpi-chg">{nv ? 'Needs order-line € values (dash.json ≥ 5.0.0)' : 'Open MTD + Revenue MTD'}</div></div>
        <div className="kpi-card blue"><div className="kpi-lbl">Open Orders (Future) – Kalverhuisvesting</div><div className="kpi-val sm">{nv ? '—' : fmtFull(T.fut)}</div><div className="kpi-chg">Due after today · {fmtN(T.nFut)} orders</div></div>
        <div className="kpi-card sky"><div className="kpi-lbl">Open Value MTD</div><div className="kpi-val sm">{nv ? '—' : fmtFull(T.mtd)}</div><div className="kpi-chg">Open orders due this month · {fmtN(T.nMtd)} orders</div></div>
        <div className="kpi-card teal"><div className="kpi-lbl">Open Value (Full)</div><div className="kpi-val sm">{nv ? '—' : fmtFull(T.full)}</div><div className="kpi-chg">All open orders due today or earlier · {fmtN(T.nFull)} orders</div></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1.4 }}>
          <Panel title="Turnover — Last 3 Complete Months" subtitle={`This year vs last year · ${last3[0]?.m} – ${last3[2]?.m} · current month ${currentMonth} not included`} flex={1} tableHeaders={cmpTable.headers} tableRows={cmpTable.rows} insight={turnoverInsight}><EC option={cmpOpt} /></Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Melkpoeder Tonnage" subtitle={melkSalesman === 'All' ? 'Per month · this year vs last year' : `${melkSalesman.split(' ')[0]} · this year vs last year`} flex={1} controls={melkTonControls} tableHeaders={melkTonTable.headers} tableRows={melkTonTable.rows} insight={melkTonInsight}><EC option={melkTonOpt} /></Panel>
        </div>
      </div>
      <div className="charts-row" style={{ flex: 0.8 }}>
        <Panel title="Category Trends" subtitle={catSubtitle} flex={1} controls={
          <div className="view-tog">
            <button className={`vt-btn${catGrain === 'weekly' ? ' active' : ''}`} onClick={() => setCatGrain('weekly')}>Weekly</button>
            <button className={`vt-btn${catGrain === 'monthly' ? ' active' : ''}`} onClick={() => setCatGrain('monthly')}>Monthly</button>
          </div>
        }><EC option={catGrain === 'weekly' ? catWeeklyOpt : catMonthlyOpt} /></Panel>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Revenue.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Revenue Trends */
const LEGEND_ICON_DASH = 'path://M0,3 L10,3 L10,9 L0,9 Z M12,3 L22,3 L22,9 L12,9 Z M24,3 L34,3 L34,9 L24,9 Z';
const LEGEND_ICON_LINE = 'path://M0,3 L34,3 L34,9 L0,9 Z';

function Revenue({ f, setF }) {
  const L = useLegacy(f), K = useSales(f), P = K.P, proof = useProof();
  const TS = useMemo(() => timeSeries(f, L, f.grain), [f, L]);
  const [selected, setSelected] = useState(null);
  const [weekFocus0, setWeekFocus] = useState(null);
  const weekFocus = f.grain === 'day' ? weekFocus0 : null;
  const periods = TS.grain === 'day' && weekFocus ? TS.rows.filter(r => { const t = Date.UTC(+r.key.slice(0, 4), +r.key.slice(5, 7) - 1, +r.key.slice(8, 10)) / 864e5, wm = X.weekMon.get(weekFocus); return wm == null || (t >= wm && t <= wm + 6); }) : TS.rows;


  /* YTD and LTM (calendar facts, same dimension filters) */
  /* YTD is always this calendar year up to the latest data, whatever period is selected */
  const y = X.months[X.nM - 1].slice(0, 4), ytdF = { ...f, from: X.months.indexOf(y + '-01'), to: X.nM - 1, cmp: 'py' };
  const ytdKey = JSON.stringify(ytdF);
  const YTD = useMemo(() => sales(JSON.parse(ytdKey)), [ytdKey]);
  const ltmTo = Math.min(f.to, X.lastFull), ltmF = { ...f, from: Math.max(0, ltmTo - 11), to: ltmTo, cmp: 'none' };
  const ltmKey = JSON.stringify(ltmF);
  const LTM = useMemo(() => sales(JSON.parse(ltmKey)), [ltmKey]);
  const ltmMonths = ltmTo - Math.max(0, ltmTo - 11) + 1;

  const best = periods.length ? periods.reduce((b, c) => c.rev > b.rev ? c : b, periods[0]) : null;
  const g = growth(K.revCur4Cmp, K.revC);
  const cov = ordersCoverage(P.cur);

  /* drill: year → month → week → day */
  /* drill-down: click a column (year → months → weeks → days); "Back" climbs up again */
  const [stack, setStack] = useState([]);
  const [msg, setMsg] = useState(null);
  const push = next => { setStack(st => [...st, { from: f.from, to: f.to, grain: f.grain, preset: f.preset }]); setSelected(null); setMsg(null); setF(x => ({ ...x, ...next, preset: 'custom' })); };
  const back = () => { setWeekFocus(null);
     const prev = stack[stack.length - 1]; if (!prev) return; setStack(st => st.slice(0, -1)); setSelected(null); setMsg(null); setF(x => ({ ...x, ...prev })); };
  const drill = p => {
    const r = periods[typeof p === 'number' ? p : p.dataIndex]; if (!r) return;
    if (TS.grain === 'year') { const ms = X.months.map((m, i) => [m, i]).filter(([m]) => m.startsWith(r.key)).map(([, i]) => i); push({ from: ms[0], to: ms[ms.length - 1], grain: 'month' }); return; }
    if (TS.grain === 'month') {
      if (X.isPortalM[r.mi]) { setSelected(r.key); setMsg(`${mLong(r.key)} comes from the former portal (monthly total only), so it has no weeks. Weeks start in ${mLong(X.months[X.firstDaily])}.`); return; }
      push({ from: r.mi, to: r.mi, grain: 'week' }); return;
    }
    if (TS.grain === 'week') { const wm = X.weekMon.get(r.key); const m0 = X.months.indexOf(new Date(wm * 864e5).toISOString().slice(0, 7)), m1 = X.months.indexOf(new Date((wm + 6) * 864e5).toISOString().slice(0, 7)); setSelected(null); push({ from: m0 < 0 ? f.from : m0, to: m1 < 0 ? m0 : m1, grain: 'day' }); setWeekFocus(r.key); return; }
    setSelected(selected === r.key ? null : r.key);
  };

  const barOpt = withDataZoom(withCrosshair({
    tooltip: { trigger: 'axis', formatter: p => { let h = `<strong>${p[0].name}</strong>${periods[p[0].dataIndex]?.sub ? ' · ' + periods[p[0].dataIndex].sub : ''}<br/>`; p.forEach(s => { h += `${s.marker} ${s.seriesName}: ${s.value != null ? fmtFull(s.value) : '—'}<br/>`; }); return h + `<span style="opacity:.7;font-size:10px">Click to drill down</span>`; } },
    legend: { bottom: 0, data: ['Revenue'], textStyle: { color: '#5F7078', fontSize: 10 }, icon: 'roundRect' },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(d => d.label), axisLabel: catAxisLabel(periods.length, 9) },
    yAxis: { type: 'value', min: 0, splitNumber: 5, axisLabel: { ...AX, formatter: v => fmt(v), hideOverlap: true }, splitLine: SPLIT },
    series: [
      { name: 'Revenue', type: 'bar', itemStyle: { color: 'rgba(8,145,178,0.75)' }, data: periods.map(d => ({ value: d.rev, itemStyle: { color: selected && selected !== d.key ? 'rgba(8,145,178,0.2)' : 'rgba(8,145,178,0.75)', borderRadius: [3, 3, 0, 0] } })), barMaxWidth: 28 },
    ],
  }));

  /* Same-month and cumulative year comparison */
  const years = [...new Set(X.months.map(m => m.slice(0, 4)))];
  const [y0, y1] = years.slice(-2);
  const byYM = new Map(L.monthly.map(r => [r.iso, r.rev]));
  const val = (yy, k) => byYM.get(`${yy}-${String(k + 1).padStart(2, '0')}`);
  const cMonths = MN.filter((_, k) => val(y0, k) != null && val(y1, k) != null);
  const cmpLine = (yy, dashed, color) => ({ name: yy, type: 'line', symbol: 'none', data: cMonths.map(mn => val(yy, MN.indexOf(mn)) ?? null), lineStyle: { color, width: 2, type: dashed ? 'dashed' : 'solid' }, itemStyle: { color }, areaStyle: { color: dashed ? 'rgba(8,145,178,.07)' : 'rgba(115,212,242,.07)' }, smooth: true });
  const legendY = { bottom: 4, data: [{ name: y0, icon: LEGEND_ICON_DASH }, { name: y1, icon: LEGEND_ICON_LINE }], textStyle: { color: '#5F7078', fontSize: 10 }, selectedMode: false };
  const yoyOpt = withDataZoom(withCrosshair({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => p.filter(s => s.value != null).map(s => `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}`).join('<br/>') },
    legend: legendY, grid: { left: '3%', right: '4%', bottom: '26%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: cMonths, axisLabel: catAxisLabel(cMonths.length, 9) },
    yAxis: { type: 'value', splitNumber: 5, axisLabel: { ...AX, formatter: v => fmt(v), hideOverlap: true }, splitLine: SPLIT },
    series: [cmpLine(y0, true, '#0891B2'), cmpLine(y1, false, '#73D4F2')],
  }));
  const cum = yy => { let s = 0; return MN.map((_, k) => { const v = val(yy, k); if (v == null) return null; s += v; return s; }); };
  const cumOpt = withCrosshair({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => p.filter(s => s.value != null).map(s => `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}`).join('<br/>') },
    legend: legendY, grid: { left: '3%', right: '4%', bottom: '22%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: MN, axisLabel: catAxisLabel(12, 9) },
    yAxis: { type: 'value', axisLabel: { ...AX, formatter: v => fmt(v) }, splitLine: SPLIT },
    series: [
      { name: y0, type: 'line', data: cum(y0), smooth: true, symbol: 'none', lineStyle: { color: '#0891B2', width: 2, type: 'dashed' }, itemStyle: { color: '#0891B2' }, areaStyle: { color: 'rgba(8,145,178,.07)' } },
      { name: y1, type: 'line', data: cum(y1), smooth: true, symbol: 'none', lineStyle: { color: '#40BCF3', width: 2 }, itemStyle: { color: '#40BCF3' }, areaStyle: { color: 'rgba(64,188,243,.08)' } },
    ],
  });

  const ordRows = periods.filter(r => r.orders != null);
  const ordersOpt = withDataZoom(withCrosshair({
    tooltip: { trigger: 'axis', formatter: p => `<strong>${p[0].name}</strong><br/>Orders (invoices): ${fmtN(p[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: ordRows.map(d => d.label), axisLabel: catAxisLabel(ordRows.length, 9), axisLine: { lineStyle: { color: '#DDE6E9' } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { ...AX, formatter: v => fmtN(v) }, splitLine: SPLIT },
    series: [{ type: 'line', data: ordRows.map(d => d.orders), step: 'middle', symbol: 'circle', symbolSize: 5, lineStyle: { color: '#0369A1', width: 2 }, itemStyle: { color: '#0369A1' }, areaStyle: { color: 'rgba(3,105,161,0.08)' } }],
  }, fmtN));

  const unit = TS.unit;
  const barTbl = { headers: [unit, 'Revenue', 'Orders', 'Avg Order Value'], rows: periods.map(m => [m.label, fmtFull(m.rev), m.orders == null ? '—' : fmtN(m.orders), m.orders ? fmtFull(Math.round(m.rev / m.orders)) : '—']) };
  const ordTbl = { headers: [unit, 'Orders (invoices)'], rows: ordRows.map(m => [m.label, fmtN(m.orders)]) };
  const insight = [g != null ? `Revenue ${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(1)}% vs ${P.cmpLabel}` : null, best ? `Best ${unit.toLowerCase()}: ${best.label} (${fmtFull(best.rev)})` : null].filter(Boolean).join(' · ') || null;
  const drillHint = { year: 'click a year to see its months', month: 'click a month to see its weeks (from Apr 2026)', week: 'click a week to see its days', day: weekFocus ? `days of ${weekFocus}` : 'daily detail' }[TS.grain];
  const ytdG = growth(YTD.revCur4Cmp, YTD.revC);

  return (
    <div className="page-area" key="revenue">
      <KpiNote extra={cov} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Turnover (selected period)" value={fmtFull(K.rev)} sub={<><Trend g={g} /><span>{P.cmp ? `vs ${P.cmpLabel}` : P.note || 'No comparison'}</span></>} onClick={() => proof({ title: 'Turnover', def: 'Revenue excl. VAT for the selected period and filters.', f })} />
        <Kpi color="teal" label={`Turnover YTD (${y})`} value={fmtFull(YTD.rev)} sub={<><Trend g={ytdG} suffix={`vs ${+y - 1}`} /><span>{YTD.P.cur.length}m{YTD.P.note ? ' · Nov compared on complete months' : ''}</span></>} onClick={() => proof({ title: `Turnover YTD ${y}`, def: 'Revenue from 1 January to the end of the selected period.', f: ytdF })} />
        <Kpi color="green" label={`Best ${unit} in period`} value={best ? best.label : '—'} sub={best ? fmtFull(best.rev) : ''} />
        <Kpi color="amber" label="Avg / Month (LTM)" value={fmtFull(LTM.rev / ltmMonths)} sub={`${fmtFull(LTM.rev)} over ${LTM.P.label}`} onClick={() => proof({ title: 'Last 12 complete months', def: 'Revenue of the 12 complete months up to the selected end month.', f: ltmF, dims: ['month', 'group', 'verkoper', 'market'] })} />
      </div>
      <div className="charts-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gridTemplateRows: 'minmax(320px,1fr) minmax(320px,1fr)', alignItems: 'stretch' }}>
        <Panel title="Revenue Over Time" subtitle={`${P.label} · per ${unit.toLowerCase()} · ${drillHint}`} tag={`${periods.length}${unit[0]}`} flex={1} style={{ gridColumn: '1/span 2', gridRow: '1', minWidth: 0 }} tableHeaders={barTbl.headers} tableRows={barTbl.rows} insight={msg || insight}
          controls={stack.length ? <button className="panel-btn" onClick={back} title="Go back up one level">◂ Back</button> : null}>
          <EC option={barOpt} onAxisClick={drill} />
        </Panel>
        <Panel title={`${y0} vs ${y1} Monthly`} subtitle="Same-month comparison · follows verkoper, group & market filters" flex={1} style={{ gridColumn: '1/span 2', gridRow: '2', minWidth: 0 }}><EC option={yoyOpt} /></Panel>
        <Panel title="Cumulative Revenue YoY" subtitle="Running total by calendar month" flex={1} style={{ gridColumn: '3', gridRow: '1/span 2', minWidth: 0 }}><EC option={cumOpt} /></Panel>
        <Panel title="Order Volume" subtitle={`Invoices per ${unit.toLowerCase()}${cov ? ' · from Apr 2026' : ''}`} flex={1} style={{ gridColumn: '4', gridRow: '1/span 2', minWidth: 0 }} tableHeaders={ordTbl.headers} tableRows={ordTbl.rows}><EC option={ordersOpt} /></Panel>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   SalesReps.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Verkoper (sales team) */
function SalesReps({ f, highlightQuery }) {
  const K = useSales(f), P = K.P, proof = useProof();
  const [excludeJohan, setExcludeJohan] = useState(false);
  const [selRep, setSelRep] = useState(null);
  const isJohan = n => /^jo(h)?an/i.test(n.trim());

  const reps = useMemo(() => {
    const a = aggregate(K.cur, repName), b = aggregate(K.cmp, repName), s = aggregate(K.curC, repName);
    const o = invoiceCounts(f, P.cur, v => X.customers[v.c][2]);
    return [...a.values()].filter(x => !excludeJohan || !isJohan(x.k)).map(x => ({
      n: x.k, rev: x.rev, kg: x.kg, revO: x.revO, c: K.cmp ? (b.get(x.k)?.rev || 0) : null, g: K.cmp ? growth(s.get(x.k)?.rev || 0, b.get(x.k)?.rev || 0) : null,
      orders: o.known ? (o.map.get(x.k) || 0) : null, buyers: x.cust.size,
    })).sort((x, y) => y.rev - x.rev);
  }, [K, f, P, excludeJohan]);
  const totalRev = reps.reduce((s, r) => s + r.rev, 0);
  const top3 = reps.slice(0, 3);
  const aov = r => r.orders ? fmtFull(Math.round(r.revO / r.orders)) : '—';

  const barRows = reps.map(r => ({ n: r.n.split(' ')[0], full: r.n, v: r.rev, c: r.c, g: r.g, extra: totalRev ? `${(r.rev / totalRev * 100).toFixed(1).replace('.', ',')}% of shown revenue` : '' }));
  const barOpt = hbarOpt(barRows, { cmp: !!K.cmp, sel: selRep ? selRep.split(' ')[0] : null });
  const tbl = { headers: ['#', 'Verkoper', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Tonnes', 'Buyers', 'Orders', 'Avg Order Value'],
    rows: reps.map((d, i) => [i + 1, d.n, fmtFull(d.rev), ...(K.cmp ? [fmtFull(d.c), pctTxt(d.g)] : []), fmtNum(d.kg / 1000) + ' t', fmtN(d.buyers), fmtN(d.orders), aov(d)]) };
  const leaderRows = selRep ? tbl.rows.filter(r => r[1] === selRep) : tbl.rows;
  const insight = reps[0] ? `${reps[0].n} leads with ${fmtFull(reps[0].rev)}${totalRev > 0 ? ` (${(reps[0].rev / totalRev * 100).toFixed(0)}% of shown revenue)` : ''}` : null;

  /* stacked by product group */
  const smOrder = reps.map(r => r.n);
  const byRG = useMemo(() => aggregate(K.cur, i => repName(i) + '|' + X.facts.G[i]), [K]);
  const gs = [0, 1, 2, 3, 4, 5].filter(g => smOrder.some(n => byRG.get(n + '|' + g)?.rev));
  const smOpt = withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => { let h = `<strong>${smOrder[p[0].dataIndex]}</strong><br/>`, s = 0; p.forEach(x => { if (x.value) { h += `${x.marker} ${x.seriesName}: ${fmtFull(x.value)}<br/>`; s += x.value; } }); return h + `<strong>Total: ${fmtFull(s)}</strong>`; } },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 8 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
    grid: { left: '2%', right: '6%', bottom: '14%', top: '3%', containLabel: true },
    xAxis: { type: 'value', min: 0, splitNumber: isMobileViewport() ? 4 : 5, axisLabel: { ...AX, formatter: v => fmt(v), hideOverlap: true }, splitLine: SPLIT },
    yAxis: { type: 'category', data: smOrder.map(n => n.split(' ')[0]), axisLabel: AX, inverse: true },
    series: gs.map(g => ({ name: GROUPS[g], type: 'bar', stack: 'total', data: smOrder.map(n => Math.round(byRG.get(n + '|' + g)?.rev || 0)), itemStyle: { color: GROUP_COLORS[g] } })),
  }, 'y');
  const smTbl = { headers: ['Verkoper', 'Product group', 'Revenue', 'Tonnes'], rows: smOrder.flatMap(n => gs.filter(g => byRG.get(n + '|' + g)?.rev).map(g => [n, GROUPS[g], fmtFull(byRG.get(n + '|' + g).rev), fmtNum(byRG.get(n + '|' + g).kg / 1000) + ' t'])) };

  /* Feed & milk powder: revenue vs tonnage per month */
  const [vmSalesman, setVmSalesman] = useState('All');
  const vm = useMemo(() => {
    const ri = vmSalesman === 'All' ? null : X.repIdx.get(vmSalesman), dp = dimPred(f);
    const ix = pick(P.cur, i => dp(i) && (ri == null || X.facts.v[i] === ri) && (X.facts.G[i] === 0 || X.facts.G[i] === 1));
    const a = aggregate(ix, i => X.facts.m[i] + '|' + X.facts.G[i]);
    return P.cur.map(c => ({ month: X.mLabel[c.m], mp: a.get(c.m + '|0') || { rev: 0, kg: 0 }, fd: a.get(c.m + '|1') || { rev: 0, kg: 0 } }));
  }, [f, P, vmSalesman]);
  const vmOpt = withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `<strong>${p[0].name}</strong><br/>` + p.map(s => `${s.marker} ${s.seriesName}: ${s.seriesName.includes('Tonnage') ? fmtNum(s.value) + ' t' : fmtFull(s.value)}`).join('<br/>') },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 9 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
    grid: { left: '2%', right: '6%', bottom: '22%', top: '10%', containLabel: true },
    xAxis: { type: 'category', data: vm.map(r => r.month), axisLabel: { color: '#5F7078', fontSize: 8, rotate: 30, hideOverlap: true } },
    yAxis: [
      { type: 'value', name: 'Revenue', nameTextStyle: { color: '#5F7078', fontSize: 9 }, axisLabel: { ...AX, formatter: v => fmt(v) }, splitLine: SPLIT },
      { type: 'value', name: 'Tonnage (t)', nameTextStyle: { color: '#5F7078', fontSize: 9 }, axisLabel: { ...AX, formatter: v => fmtNum(v) }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Milk powder Revenue', type: 'bar', barGap: '10%', data: vm.map(r => Math.round(r.mp.rev)), itemStyle: { color: '#40BCF3', borderRadius: [2, 2, 0, 0] }, barMaxWidth: 18 },
      { name: 'Feed Revenue', type: 'bar', data: vm.map(r => Math.round(r.fd.rev)), itemStyle: { color: '#2E9B62', borderRadius: [2, 2, 0, 0] }, barMaxWidth: 18 },
      { name: 'Milk powder Tonnage', type: 'line', yAxisIndex: 1, data: vm.map(r => +(r.mp.kg / 1000).toFixed(2)), itemStyle: { color: '#1F3741' }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 5 },
      { name: 'Feed Tonnage', type: 'line', yAxisIndex: 1, data: vm.map(r => +(r.fd.kg / 1000).toFixed(2)), itemStyle: { color: '#666' }, lineStyle: { width: 2, type: 'dashed' }, symbol: 'diamond', symbolSize: 5 },
    ],
  });
  const vmTbl = { headers: ['Month', 'Milk powder Rev', 'Milk powder Ton', 'Feed Rev', 'Feed Ton'], rows: vm.map(r => [r.month, fmtFull(r.mp.rev), fmtNum(r.mp.kg / 1000) + ' t', fmtFull(r.fd.rev), fmtNum(r.fd.kg / 1000) + ' t']) };
  const vmSalesmen = reps.map(r => r.n);

  const repProof = n => proof({ title: `${n} · revenue`, def: 'Revenue of one verkoper (current customer assignment).', f: { ...f, reps: [n] }, dims: ['customer', 'group', 'product', 'month', 'market'] });
  const onBar = p => { const r = reps[p.dataIndex]; if (r) setSelRep(selRep === r.n ? null : r.n); };
  const top3Share = totalRev > 0 ? (top3.reduce((s, r) => s + r.rev, 0) / totalRev * 100) : 0;

  return (
    <div className="page-area" key="reps">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0, flexWrap: 'wrap' }}>
        <KpiNote extra={ordersCoverage(P.cur)} />
        <button className={`cmp-toggle${excludeJohan ? ' active' : ''}`} onClick={() => setExcludeJohan(v => !v)}>{excludeJohan ? '✓ Johan excluded' : 'Exclude Johan'}</button>
        {excludeJohan && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Johan's rows hidden from all charts and table</span>}
      </div>
      <div className="kpi-strip">
        {['blue', 'teal', 'navy'].map((c, i) => (
          <Kpi key={i} color={c} label={`#${i + 1} — ${top3[i]?.n?.split(' ')[0] || '—'}`} value={fmtFull(top3[i]?.rev || 0)}
            sub={<>{K.cmp && top3[i] ? <Trend g={top3[i].g} /> : null}<span>{top3[i]?.orders != null ? fmtN(top3[i].orders) + ' orders' : `${fmtN(top3[i]?.buyers || 0)} buyers`}</span></>}
            onClick={top3[i] ? () => repProof(top3[i].n) : undefined} />
        ))}
        <Kpi color="amber" label="Top 3 Share" value={`${top3Share.toFixed(0)}%`} sub="of shown revenue" />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Omzet per Verkoper" subtitle={`${P.label}${K.cmp ? ' · tick = ' + P.cmpLabel : ''} · click a bar to focus`} flex={1}
            controls={<ExportExcelButton filename="omzet_per_verkoper.xlsx" headers={tbl.headers} rows={tbl.rows} />} tableHeaders={tbl.headers} tableRows={tbl.rows} insight={insight}>
            <EC option={barOpt} onEvents={{ click: onBar }} />
          </Panel>
          <Panel title="Verkoper Leaderboard" subtitle={selRep ? 'Filtered · click the chart to change' : 'Ranked by revenue · click a row for its breakdown'} flex={1}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {selRep && (<div className="drill-chip">Showing: {selRep}<button onClick={() => setSelRep(null)} title="Clear selection">✕</button></div>)}
              <div style={{ flex: 1, minHeight: 0 }}><InlineTable headers={tbl.headers} rows={leaderRows} height="100%" searchable initialQuery={highlightQuery} onRowClick={i => repProof(leaderRows[i][1])} /></div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Sales per Verkoper by Product Group" subtitle={`Stacked by group · ${P.label}`} flex={1} controls={<ExportExcelButton filename="sales_per_verkoper_by_group.xlsx" headers={smTbl.headers} rows={smTbl.rows} />} tableHeaders={smTbl.headers} tableRows={smTbl.rows}><EC option={smOpt} /></Panel>
          <Panel title="Feed & Milk Powder" subtitle={vmSalesman === 'All' ? 'Revenue vs tonnage per month' : `Revenue vs tonnage — ${vmSalesman}`} flex={1}
            controls={<select className="panel-select" value={vmSalesman} onChange={e => setVmSalesman(e.target.value)}><option value="All">All verkopers</option>{vmSalesmen.map(n => <option key={n} value={n}>{n}</option>)}</select>}
            tableHeaders={vmTbl.headers} tableRows={vmTbl.rows}><EC option={vmOpt} /></Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Customers.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Customers */
function Customers({ f, highlightQuery }) {
  const K = useSales(f), P = K.P, proof = useProof();
  const custs = useMemo(() => {
    const a = aggregate(K.cur, i => X.facts.c[i]), b = aggregate(K.cmp, i => X.facts.c[i]), s = aggregate(K.curC, i => X.facts.c[i]);
    const o = invoiceCounts(f, P.cur, v => v.c);
    return [...a.values()].map(x => ({ c: x.k, n: X.customers[x.k][0], mkt: X.customers[x.k][1], rep: X.customers[x.k][2], rev: x.rev, revO: x.revO, c2: K.cmp ? (b.get(x.k)?.rev || 0) : null, g: K.cmp ? growth(s.get(x.k)?.rev || 0, b.get(x.k)?.rev || 0) : null, orders: o.known ? (o.map.get(x.k) || 0) : null }))
      .filter(x => x.rev !== 0).sort((p, q) => q.rev - p.rev);
  }, [K, f, P]);
  /* new / lost customers vs comparison */
  const nl = useMemo(() => {
    if (!K.cmp) return null;
    const a = new Set(custs.filter(c => c.rev > 0).map(c => c.c)), b = aggregate(K.cmp, i => X.facts.c[i]);
    const prev = new Set([...b.values()].filter(x => x.rev > 0).map(x => x.k));
    return { neu: [...a].filter(c => !prev.has(c)).length, lost: [...prev].filter(c => !a.has(c)).length };
  }, [K, custs]);
  const totalRev = custs.reduce((s, c) => s + c.rev, 0);
  const active = custs.filter(c => c.rev > 0).length;
  const top15Rev = custs.slice(0, 15).reduce((s, c) => s + c.rev, 0);
  const [count, setCount] = useState(15);
  const items = custs.slice(0, highlightQuery ? custs.length : count);
  const barOpt = hbarOpt(items.map(d => ({ n: d.n, v: d.rev, c: d.c2, g: d.g, extra: `${d.rep} · ${d.mkt}` })), { cmp: !!K.cmp, labelW: 20 });
  const aov = d => d.orders ? fmtFull(Math.round(d.revO / d.orders)) : '—';
  const head = ['#', 'Customer', 'Market', 'Verkoper', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Orders', 'Avg Order Value'];
  const row = (d, i) => [i + 1, d.n, d.mkt, d.rep, fmtFull(d.rev), ...(K.cmp ? [fmtFull(d.c2), pctTxt(d.g)] : []), fmtN(d.orders), aov(d)];
  const tblRows = items.map(row), fullRows = custs.map(row);
  const insight = custs[0] ? `Top customer: ${custs[0].n} — ${fmtFull(custs[0].rev)}${totalRev > 0 ? ` (${(custs[0].rev / totalRev * 100).toFixed(1)}% of revenue)` : ''}${nl ? ` · ${nl.neu} new, ${nl.lost} stopped vs comparison` : ''}` : null;
  const card = c => {
    const d = custs.find(x => x.c === c);
    proof({ title: X.customers[c][0], def: `Customer card · ${X.customers[c][1]} · verkoper ${X.customers[c][2]}${X.customers[c][3] != null ? ` · terms ${X.customers[c][3]} days` : ''}${d ? ` · ${fmtFull(d.rev)} in the period` : ''}`, f, extra: i => X.facts.c[i] === c, dims: ['product', 'month', 'group'] });
  };
  const allTime = useMemo(() => { const dp = dimPred({ ...f }); const ix = pick(X.months.map((_, m) => ({ m, cap: 99 })), dp); return new Set(ix.map(i => X.facts.c[i])).size; }, [f]);

  return (
    <div className="page-area" key="customers">
      <KpiNote extra={ordersCoverage(P.cur)} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Active Customers" value={fmtN(active)} sub={`with revenue in ${P.label} · ${fmtN(allTime)} ever bought`} onClick={() => proof({ title: 'Revenue by customer', def: 'Every customer with revenue in the period.', f, dims: ['customer', 'market', 'verkoper'] })} />
        <Kpi color="sky" label="Top Customer" value={custs[0]?.n?.slice(0, 18) || '—'} sub={<>{custs[0] && K.cmp ? <Trend g={custs[0].g} /> : null}<span>{fmtFull(custs[0]?.rev || 0)}</span></>} onClick={custs[0] ? () => card(custs[0].c) : undefined} />
        <Kpi color="green" label="Top 15 Revenue" value={fmtFull(top15Rev)} sub={`${totalRev > 0 ? ((top15Rev / totalRev) * 100).toFixed(0) : 0}% of total`} />
        <Kpi color="amber" label="Avg Rev / Active Customer" value={fmtFull(active ? totalRev / active : 0)} sub={nl ? `${fmtN(nl.neu)} new · ${fmtN(nl.lost)} stopped vs comparison` : 'No comparison'} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 2 }}>
          <Panel title="Customers by Revenue" subtitle={`${P.label}${K.cmp ? ' · tick = comparison' : ''} · click a bar for the customer card`} flex={1}
            controls={<ExportExcelButton filename="customers_by_revenue.xlsx" headers={head} rows={fullRows} />} tableHeaders={head} tableRows={tblRows} insight={insight} onRowClick={i => card(items[i].c)}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}><EC option={barOpt} onEvents={{ click: p => items[p.dataIndex] && card(items[p.dataIndex].c) }} /></div>
              <Pager count={count} total={custs.length} step={15} setCount={setCount} />
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1.2 }}>
          <Panel title="Leaderboard" subtitle="Top 15 customers · click a row for the customer card" flex={1}>
            <InlineTable headers={head} rows={highlightQuery ? fullRows : fullRows.slice(0, 15)} height="100%" searchable initialQuery={highlightQuery} onRowClick={i => card(custs[i].c)} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Products.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Product Analysis */
function Products({ f, highlightQuery }) {
  const K = useSales(f), P = K.P, proof = useProof();
  const prods = useMemo(() => {
    const a = aggregate(K.cur, i => X.facts.p[i]), b = aggregate(K.cmp, i => X.facts.p[i]), s = aggregate(K.curC, i => X.facts.p[i]);
    return [...a.values()].map(x => {
      const cat = X.products[x.k][1];
      return { p: x.k, n: X.products[x.k][0], cat: cat >= 0 ? X.categories[cat][0] : '—', grp: cat >= 0 ? GROUPS[X.gOfCat[cat]] : 'Other', rev: x.rev, c: K.cmp ? (b.get(x.k)?.rev || 0) : null, g: K.cmp ? growth(s.get(x.k)?.rev || 0, b.get(x.k)?.rev || 0) : null, kg: x.kg, pcs: x.pcs, byKg: X.kgProd.has(x.k), days: x.days.size, buyers: x.cust.size };
    }).filter(x => x.rev !== 0).sort((p, q) => q.rev - p.rev);
  }, [K]);
  const totalRev = prods.reduce((s, p) => s + p.rev, 0);
  const top5Rev = prods.slice(0, 5).reduce((s, p) => s + p.rev, 0);
  const [sel, setSel] = useState(null);
  const [count, setCount] = useState(15);
  const [dCount, setDCount] = useState(10);
  const items = prods.slice(0, highlightQuery ? prods.length : count), dItems = prods.slice(0, dCount);
  const qtyTxt = d => d.byKg ? fmtNum(d.kg / 1000) + ' t' : fmtN(d.pcs) + ' pcs';
  const barOpt = hbarOpt(items.map(d => ({ n: d.n, v: d.rev, c: d.c, g: d.g, extra: `${d.cat} · ${qtyTxt(d)}` })), { cmp: !!K.cmp, sel });
  const share = d => totalRev ? (d.rev / totalRev * 100).toFixed(1).replace('.', ',') + '%' : '—';
  const head = ['#', 'Product', 'Category', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Quantity', 'Buyers', 'Order days', 'Share'];
  const row = (d, i) => [i + 1, d.n, d.cat, fmtFull(d.rev), ...(K.cmp ? [fmtFull(d.c), pctTxt(d.g)] : []), qtyTxt(d), fmtN(d.buyers), d.days ? fmtN(d.days) : '—', share(d)];
  const insight = prods.length ? `Top product: ${prods[0].n}${totalRev > 0 ? ` (${(prods[0].rev / totalRev * 100).toFixed(0)}% of revenue)` : ''} · Top 5 lines make up ${totalRev > 0 ? (top5Rev / totalRev * 100).toFixed(0) : 0}% of total` : null;
  const card = d => proof({ title: d.n, def: `${d.cat} · ${d.grp} · ${qtyTxt(d)} sold in the period`, f, extra: i => X.facts.p[i] === d.p, dims: ['customer', 'verkoper', 'month', 'market'], col: d.byKg ? 'r' : 'r' });
  const donut = donutOpt(dItems.map(d => ({ n: d.n.length > 16 ? d.n.slice(0, 16) + '…' : d.n, full: d.n, v: d.rev })), { sel: sel ? (sel.length > 16 ? sel.slice(0, 16) + '…' : sel) : null });

  return (
    <div className="page-area" key="products">
      <KpiNote extra="Order days = distinct customer-days with the product (from Apr 2026)" />
      <div className="kpi-strip">
        {['blue', 'teal', 'navy'].map((c, i) => (
          <Kpi key={i} color={c} label={`#${i + 1} Product`} value={prods[i]?.n?.split(' - ')[0] || '—'}
            sub={<>{prods[i] && K.cmp ? <Trend g={prods[i].g} /> : null}<span>{fmtFull(prods[i]?.rev || 0)} · {prods[i] ? share(prods[i]) : ''}</span></>}
            onClick={prods[i] ? () => card(prods[i]) : undefined} />
        ))}
        <Kpi color="green" label="Products Sold" value={fmtN(prods.length)} sub={`Active lines in ${P.label}`} onClick={() => proof({ title: 'Revenue by product', def: 'Every product with revenue in the period.', f, dims: ['product', 'category', 'group'] })} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 2 }}>
          <Panel title="Top Products by Revenue" subtitle={`${P.label}${K.cmp ? ' · tick = comparison' : ''} · click a bar to isolate, table row for detail`} flex={1} tableHeaders={head} tableRows={items.map(row)} defaultView={highlightQuery ? 'table' : 'chart'} searchableTable tableInitialQuery={highlightQuery} insight={insight} onRowClick={i => card(items[i])}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}><EC option={barOpt} onEvents={{ click: p => { const d = items[p.dataIndex]; if (d) setSel(sel === d.n ? null : d.n); } }} /></div>
              <Pager count={count} total={prods.length} step={15} setCount={setCount} />
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Product Share" subtitle="Click to isolate" flex={1} tableHeaders={['Product', 'Revenue', 'Share']} tableRows={prods.map(d => [d.n, fmtFull(d.rev), share(d)])}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 0 }}><EC option={donut} onEvents={{ click: p => { const d = dItems[p.dataIndex]; if (d) setSel(sel === d.n ? null : d.n); } }} /></div>
              <Pager count={dCount} total={prods.length} step={10} setCount={setDCount} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Categories.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Category Breakdown — 9 Microfas categories, coloured by their product group */
function Categories({ f }) {
  const K = useSales(f), P = K.P, proof = useProof();
  const [grp, setGrp] = useState(null);  // optional group focus
  const cats = useMemo(() => {
    const a = aggregate(K.cur, i => X.facts.g[i]), b = aggregate(K.cmp, i => X.facts.g[i]), s = aggregate(K.curC, i => X.facts.g[i]);
    return [...a.values()].map(x => ({ g: x.k, n: X.categories[x.k][0], grp: GROUPS[X.gOfCat[x.k]], gi: X.gOfCat[x.k], rev: x.rev, c: K.cmp ? (b.get(x.k)?.rev || 0) : null, b: s.get(x.k)?.rev || 0, kg: x.kg, days: x.days.size, buyers: x.cust.size }))
      .filter(x => x.rev !== 0).sort((p, q) => q.rev - p.rev);
  }, [K]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of cats) { const x = m.get(c.gi) || { n: c.grp, gi: c.gi, rev: 0, b: 0, c: K.cmp ? 0 : null, color: GROUP_COLORS[c.gi], cats: 0 }; x.rev += c.rev; x.b += c.b; if (K.cmp) x.c += c.c; x.cats++; m.set(c.gi, x); }
    return [...m.values()].sort((p, q) => q.rev - p.rev);
  }, [cats, K]);
  const shown = grp ? cats.filter(c => c.grp === grp) : cats;
  const totalRev = shown.reduce((s, c) => s + c.rev, 0), allRev = cats.reduce((s, c) => s + c.rev, 0);
  const barOpt = hbarOpt(shown.map(d => ({ n: d.n, v: d.rev, c: d.c, g: growth(d.b, d.c), extra: `Group: ${d.grp}` })), { cmp: !!K.cmp, colors: shown.map(d => GROUP_COLORS[d.gi]), labelW: 26 });
  const donut = donutOpt((grp ? shown.map(d => ({ n: d.n, v: d.rev, color: GROUP_COLORS[d.gi] })) : groups.map(g => ({ n: g.n, v: g.rev, color: g.color }))));
  const head = ['#', 'Category', 'Group', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Tonnes', 'Buyers', 'Share'];
  const rows = shown.map((d, i) => [i + 1, d.n, d.grp, fmtFull(d.rev), ...(K.cmp ? [fmtFull(d.c), pctTxt(growth(d.b, d.c))] : []), d.kg ? fmtNum(d.kg / 1000) + ' t' : '—', fmtN(d.buyers), totalRev ? (d.rev / totalRev * 100).toFixed(1).replace('.', ',') + '%' : '—']);
  const insight = groups[0] ? `${groups[0].n} leads with ${fmtFull(groups[0].rev)} (${allRev ? (groups[0].rev / allRev * 100).toFixed(0) : 0}% share) · top category ${cats[0]?.n}` : null;
  const card = d => proof({ title: `${d.n} (${d.grp})`, def: 'Revenue of one Microfas category.', f, extra: i => X.facts.g[i] === d.g, dims: ['product', 'customer', 'verkoper', 'month', 'market'] });
  const chips = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="filter-label">Group</span>
      <button className={`filter-chip${!grp ? ' active' : ''}`} onClick={() => setGrp(null)}>All groups</button>
      {groups.map(g => <button key={g.n} className={`filter-chip${grp === g.n ? ' active' : ''}`} onClick={() => setGrp(grp === g.n ? null : g.n)} style={{ borderLeft: `3px solid ${g.color}` }}>{g.n}</button>)}
    </div>
  );
  return (
    <div className="page-area" key="cats">
      <KpiNote />
      <div className="kpi-strip">
        <Kpi color="blue" label="Top Category" value={shown[0]?.n || '—'} sub={<>{shown[0] && K.cmp ? <Trend g={growth(shown[0].b, shown[0].c)} /> : null}<span>{fmtFull(shown[0]?.rev || 0)} · {shown[0]?.grp}</span></>} onClick={shown[0] ? () => card(shown[0]) : undefined} />
        <Kpi color="teal" label={shown[1]?.n || '—'} value={fmtFull(shown[1]?.rev || 0)} sub={`${totalRev > 0 ? ((shown[1]?.rev || 0) / totalRev * 100).toFixed(1) : 0}% share · ${shown[1]?.grp || ''}`} onClick={shown[1] ? () => card(shown[1]) : undefined} />
        <Kpi color="navy" label="Top Group" value={groups[0]?.n || '—'} sub={<>{groups[0] && K.cmp ? <Trend g={growth(groups[0].b, groups[0].c)} /> : null}<span>{fmtFull(groups[0]?.rev || 0)}</span></>} onClick={() => proof({ title: 'Revenue by product group', def: 'Categories roll up into product groups.', f, dims: ['group', 'category'] })} />
        <Kpi color="amber" label="Categories" value={fmtN(shown.length)} sub={`${groups.length} product groups`} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 2 }}>
          <Panel title={grp ? `${grp} — Categories` : 'Categories by Revenue'} subtitle={`${P.label} · bar colour = product group${K.cmp ? ' · tick = comparison' : ''}`} flex={1} tableHeaders={head} tableRows={rows} insight={grp ? null : insight} headerExtra={chips} onRowClick={i => card(shown[i])}>
            <EC option={barOpt} onEvents={{ click: p => shown[p.dataIndex] && card(shown[p.dataIndex]) }} />
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title={grp ? 'Category Split' : 'Group Split'} subtitle={grp ? `Within ${grp}` : 'Click a slice to focus a group'} flex={1}
            tableHeaders={['Name', 'Revenue', 'Share']} tableRows={(grp ? shown : groups).map(d => [d.n, fmtFull(d.rev), (grp ? totalRev : allRev) ? (d.rev / (grp ? totalRev : allRev) * 100).toFixed(1).replace('.', ',') + '%' : '—'])}>
            <EC option={donut} onEvents={{ click: p => { if (!grp) setGrp(p.name); } }} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Channels.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Channel Mix — Webshop (verkoper "Webshop") vs Direct (everyone else) */
const ch = n => n === 'Webshop' ? 'Webshop' : 'Direct Sales';
const COL = { 'Direct Sales': '#40BCF3', Webshop: '#2E9B62' };

function Channels({ f }) {
  const K = useSales(f), P = K.P, proof = useProof();
  const [sel, setSel] = useState(null);
  const d = useMemo(() => {
    const a = aggregate(K.cur, i => ch(repName(i))), b = aggregate(K.cmp, i => ch(repName(i))), s = aggregate(K.curC, i => ch(repName(i)));
    const o = invoiceCounts(f, P.cur, v => ch(X.customers[v.c][2]));
    const row = n => ({ n, rev: a.get(n)?.rev || 0, revO: a.get(n)?.revO || 0, c: K.cmp ? (b.get(n)?.rev || 0) : null, g: K.cmp ? growth(s.get(n)?.rev || 0, b.get(n)?.rev || 0) : null, orders: o.known ? (o.map.get(n) || 0) : null, buyers: a.get(n)?.cust.size || 0 });
    return [row('Direct Sales'), row('Webshop')];
  }, [K, f, P]);
  const [D, W] = d, total = D.rev + W.rev;
  const aov = r => r.orders ? Math.round(r.revO / r.orders) : null;
  const opt = (vals, fmtV, name) => withDataZoom({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `<strong>${p[0].name}</strong><br/>${name}: ${fmtV(p[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
    xAxis: { type: 'category', data: ['Direct Sales', 'Webshop'], axisLabel: catAxisLabel(2, 9) },
    yAxis: { type: 'value', axisLabel: { ...AX, formatter: v => fmtV === fmtFull ? fmt(v) : fmtV(v) }, splitLine: SPLIT },
    series: [{ type: 'bar', barMaxWidth: 60, data: vals.map((v, i) => ({ value: v, itemStyle: { color: COL[d[i].n] + (sel && sel !== d[i].n ? '44' : ''), borderRadius: [4, 4, 0, 0] } })) }],
  });
  const donut = donutOpt(d.map(r => ({ n: r.n, v: r.rev, color: COL[r.n] })), { sel });
  const lead = D.rev >= W.rev ? D : W;
  const aD = aov(D), aW = aov(W);
  const insight = total > 0 ? `${lead.n} leads with ${(lead.rev / total * 100).toFixed(0)}% of revenue${aD && aW ? ` · ${aD >= aW ? 'Direct' : 'Webshop'} orders run ${(Math.abs(aD - aW) / Math.min(aD, aW) * 100).toFixed(0)}% larger on average` : ''}` : null;
  const click = p => { const n = p.name || d[p.dataIndex]?.n; setSel(sel === n ? null : n); };
  const cov = ordersCoverage(P.cur);
  const chProof = n => proof({ title: n, def: n === 'Webshop' ? 'Revenue booked on verkoper “Webshop”.' : 'Revenue of every verkoper except “Webshop”.', f, extra: i => ch(repName(i)) === n, dims: ['month', 'group', 'customer', 'market', 'verkoper'] });
  return (
    <div className="page-area" key="channels">
      <KpiNote extra={cov} />
      <div className="kpi-strip">
        {[D, W].map((r, i) => (
          <Kpi key={r.n} color={i ? 'green' : 'blue'} label={r.n} value={fmtFull(r.rev)} onClick={() => chProof(r.n)}
            sub={<>{K.cmp ? <Trend g={r.g} /> : null}<span>{total > 0 ? ((r.rev / total) * 100).toFixed(1) : 0}% · {r.orders != null ? fmtN(r.orders) + ' orders' : fmtN(r.buyers) + ' buyers'}</span></>} />
        ))}
        <Kpi color="teal" label="Direct Avg Order" value={aD != null ? fmtFull(aD) : '—'} sub={cov ? 'Per invoice · from Apr 2026' : 'Per invoice'} />
        <Kpi color="amber" label="Webshop Avg Order" value={aW != null ? fmtFull(aW) : '—'} sub={cov ? 'Per invoice · from Apr 2026' : 'Per invoice'} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1.2 }}>
          <Panel title="Channel Revenue Share" subtitle={`${P.label} · click a slice to highlight`} flex={1} insight={insight}
            tableHeaders={['Channel', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Share', 'Orders', 'AOV']}
            tableRows={d.map(r => [r.n, fmtFull(r.rev), ...(K.cmp ? [fmtFull(r.c), pctTxt(r.g)] : []), total ? (r.rev / total * 100).toFixed(1).replace('.', ',') + '%' : '—', fmtN(r.orders), aov(r) != null ? fmtFull(aov(r)) : '—'])}>
            <EC option={donut} onEvents={{ click }} />
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Order Volume" subtitle={`Invoices by channel${cov ? ' · from Apr 2026' : ''}`} flex={1}><EC option={opt(d.map(r => r.orders), fmtN, 'Orders')} onEvents={{ click }} /></Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Avg Order Value" subtitle="Direct vs Webshop" flex={1}><EC option={opt(d.map(aov), fmtFull, 'AOV')} onEvents={{ click }} /></Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Cockpit.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Pages migrated from the DairyTop Business Cockpit, rebuilt in the dashboard's
   own style (Panel cards, KPI tiles, ECharts) — same calculations as the cockpit. */
const ton = kg => fmtNum(kg / 1000) + ' t';
const tonD = kg => (kg / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t';
const pcs = q => fmtN(q) + ' pcs';

const sd = t => { const d = new Date(t * 864e5); return d.getUTCDate() + ' ' + MN[d.getUTCMonth()]; };
function WeekTable({ T, qf, onCell }) {
  const L = T.weeks.length - 1, fq = v => v ? qf(v) : '—';
  const chg = (a, b) => b > 0 ? <span className={a >= b ? 'up' : 'down'}>{pctTxt(growth(a, b))}</span> : '—';
  if (!T.reps.length) return <div className="watch-empty">No sales of the selected products in these weeks.</div>;
  const hl = j => j === L ? { background: 'rgba(64,188,243,0.09)' } : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
      <div className={`wk-chk ${T.ok ? 'up' : 'down'}`}>{T.ok ? <><b>✓ Weeks and verkopers add up</b> to {qf(T.gt)} over {T.weeks.length} weeks ({sd(T.meta[0].a)} – {dLab(isoOfT(T.meta[L].e))}).</> : <b>✗ Weekly totals do not add up.</b>}</div>
      <div className="tbl-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="itbl wk-tbl">
          <thead><tr><th>Verkoper</th>{T.meta.map((m, j) => <th key={m.w} style={hl(j)}><span className="wk-h1">{m.w.split(' ')[0]}{j === L ? ' · this week' : j === L - 1 ? ' · last week' : ''}</span><span className="wk-h2">{sd(m.a)}–{sd(m.e)}{m.full ? '' : ` (${m.n} day${m.n > 1 ? 's' : ''} so far)`}</span></th>)}<th>Total</th>{L >= 2 && <th title="Last full week vs the week before">Last week vs week before</th>}</tr></thead>
          <tbody>
            {T.reps.map(v => <tr key={v}><td style={{ whiteSpace: 'nowrap' }}>{X.verkopers[v]}</td>{T.weeks.map((w, j) => <td key={w} style={{ cursor: 'pointer', ...(hl(j) || {}) }} onClick={() => onCell(j, v)}>{fq(T.cell.get(v + '|' + j) || 0)}</td>)}<td><b>{qf(T.rt.get(v))}</b></td>{L >= 2 && <td>{chg(T.cell.get(v + '|' + (L - 1)) || 0, T.cell.get(v + '|' + (L - 2)) || 0)}</td>}</tr>)}
          </tbody>
          <tfoot><tr className="tot"><td>Total</td>{T.weeks.map((w, j) => <td key={w} style={{ cursor: 'pointer' }} onClick={() => onCell(j, null)}>{fq(T.ct[j])}</td>)}<td>{qf(T.gt)}</td>{L >= 2 && <td>{chg(T.ct[L - 1], T.ct[L - 2])}</td>}</tr></tfoot>
        </table>
      </div>
    </div>
  );
}

/* ══ Volumes per verkoper ═════════════════════════════════════════════ */
function Volumes({ f, setF }) {
  const proof = useProof();
  const gset = f.grps.length ? new Set(f.grps.map(g => GROUPS.indexOf(g))) : null;
  const grpKey = f.grps.join('|');
  const lines = useMemo(() => {
    const inG = p => !gset || gset.has(groupOfProduct(p));
    const all = new Set(X.products.map((_, i) => i).filter(inG));
    return [['all', gset ? `All ${f.grps.join(' + ')}` : 'All products', gset ? all : null], ...X.lines.map(l => [l.key, l.label, new Set(l.products.filter(inG))]).filter(l => l[2].size && (!gset || l[2].size !== all.size))];
  }, [grpKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [presetPick, setPreset] = useState('milkPowder');
  const preset = lines.some(l => l[0] === presetPick) ? presetPick : lines[1]?.[0] || 'all';
  const [unitPick, setUnitPick] = useState(null);
  const [wk, setWk] = useState(8);
  const [cq, setCq] = useState('');
  const line = lines.find(l => l[0] === preset) || lines[0];
  const sel = line[2];
  const extra = sel ? i => sel.has(X.facts.p[i]) : null;
  const K = useSales(f, extra, [preset, f.grps.join('|')]);
  const P = K.P;
  const kgP = K.kg !== 0 || K.kgC, qP = K.q !== 0 || K.qC;
  const revKg = useMemo(() => { let a = 0, b = 0; for (const i of K.cur) X.kgProd.has(X.facts.p[i]) ? a += X.facts.r[i] : b += X.facts.r[i]; return [a, b]; }, [K]);
  const auto = !kgP ? 'q' : !qP ? 'k' : revKg[0] >= revKg[1] ? 'k' : 'q';
  const unit = kgP && qP && unitPick ? unitPick : auto;
  const uv = i => unit === 'k' ? X.facts.k[i] : X.facts.q[i] / X.qScale;
  const qf = v => unit === 'k' ? ton(v) : pcs(v);
  const tot = unit === 'k' ? K.kg : K.q, totC = unit === 'k' ? K.kgC : K.qC, totB = unit === 'k' ? K.kgCur4Cmp : K.qCur4Cmp;

  const reps = useMemo(() => {
    const a = new Map(), b = new Map(), s = new Map(), buyA = new Map(), buyB = new Map();
    const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    const buyers = (ix, M) => { const cm = new Map(); for (const i of ix || []) add(cm, X.facts.v[i] + '|' + X.facts.c[i], uv(i)); for (const [k, v] of cm) if (v > 0) { const [r, c] = k.split('|').map(Number); if (!M.has(r)) M.set(r, new Set()); M.get(r).add(c); } };
    const rv = new Map();
    for (const i of K.cur) { add(a, X.facts.v[i], uv(i)); add(rv, X.facts.v[i], X.facts.r[i] / 100); }
    for (const i of K.cmp || []) add(b, X.facts.v[i], uv(i));
    for (const i of K.curC || []) add(s, X.facts.v[i], uv(i));
    buyers(K.cur, buyA); buyers(K.cmp, buyB);
    return [...new Set([...a.keys(), ...b.keys()])].map(v => {
      const A = buyA.get(v) || new Set(), B = buyB.get(v) || new Set();
      return { v, n: X.verkopers[v], q: a.get(v) || 0, c: K.cmp ? (b.get(v) || 0) : null, g: K.cmp ? growth(s.get(v) || 0, b.get(v) || 0) : null, rev: rv.get(v) || 0, buyers: A.size, neu: [...A].filter(c => !B.has(c)).length, lost: [...B].filter(c => !A.has(c)).length };
    }).filter(r => r.q || r.c).sort((x, y) => y.q - x.q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [K, unit]);
  const allBuyers = useMemo(() => { const s = new Set(); for (const i of K.cur) if (uv(i) > 0) s.add(X.facts.c[i]); return s; }, [K, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = reps[0];

  /* over time: top 5 verkopers + others */
  const weekly = f.grain === 'week' || f.grain === 'day';
  const ts = useMemo(() => {
    const top5 = reps.slice(0, 5).map(r => r.v);
    const key = i => weekly ? X.facts.W[i] : X.facts.m[i];
    const keys = weekly ? [...new Set(K.cur.map(i => X.facts.W[i]).filter(Boolean))].sort((a, b) => X.weekMon.get(a) - X.weekMon.get(b)) : P.months;
    const m = new Map();
    for (const i of K.cur) { const k = key(i); if (k == null) continue; const r = top5.includes(X.facts.v[i]) ? X.facts.v[i] : -1; const kk = r + '|' + k; m.set(kk, (m.get(kk) || 0) + uv(i)); }
    const ser = [...top5, -1].map((r, j) => ({ name: r < 0 ? 'Others' : X.verkopers[r], type: 'bar', stack: 'v', itemStyle: { color: r < 0 ? '#C8D8DE' : ['#40BCF3', '#1F3741', '#2E9B62', '#E5A93D', '#5B8FA3'][j] }, data: keys.map(k => +((m.get(r + '|' + k) || 0) / (unit === 'k' ? 1000 : 1)).toFixed(2)) }));
    return { labels: keys.map(k => weekly ? k : X.mLabel[k]), ser };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [K, reps, unit, weekly, P]);
  const tsOpt = withDataZoom(withCrosshair({
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => `<strong>${p[0].name}</strong><br/>` + p.filter(s => s.value).map(s => `${s.marker} ${s.seriesName}: ${fmtNum(s.value)}${unit === 'k' ? ' t' : ' pcs'}`).join('<br/>') },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 9 }, type: 'scroll', itemWidth: 10, itemHeight: 10 },
    grid: { left: '3%', right: '3%', bottom: '16%', top: '6%', containLabel: true },
    xAxis: { type: 'category', data: ts.labels, axisLabel: catAxisLabel(ts.labels.length, 9) },
    yAxis: { type: 'value', axisLabel: { ...AX, formatter: v => fmtNum(v) + (unit === 'k' ? ' t' : '') }, splitLine: SPLIT },
    series: ts.ser,
  }, v => fmtNum(v)));

  const mk = useMemo(() => { const a = new Map(), b = new Map(), s = new Map(); for (const i of K.cur) a.set(X.facts.M[i], (a.get(X.facts.M[i]) || 0) + uv(i)); for (const i of K.cmp || []) b.set(X.facts.M[i], (b.get(X.facts.M[i]) || 0) + uv(i)); for (const i of K.curC || []) s.set(X.facts.M[i], (s.get(X.facts.M[i]) || 0) + uv(i)); return [...a].filter(([, v]) => v > 0).map(([k, v]) => ({ k, n: X.mkts[k], v, c: K.cmp ? (b.get(k) || 0) : null, g: K.cmp ? growth(s.get(k) || 0, b.get(k) || 0) : null })).sort((x, y) => y.v - x.v); }, [K, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const mkOpt = hbarOpt(mk.slice(0, 12), { cmp: !!K.cmp, fmtV: qf, color: '#35A9DE' });

  const head = ['Verkoper', unit === 'k' ? 'Tonnes' : 'Pieces', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Revenue', 'Avg price', 'Share', 'Buyers', ...(K.cmp ? ['New', 'Stopped'] : [])];
  const price = r => r.q ? (unit === 'k' ? fmtEur2(r.rev / r.q) + '/kg' : fmtEur2(r.rev / r.q) + '/pc') : '—';
  const rows = reps.map(r => [r.n, qf(r.q), ...(K.cmp ? [qf(r.c), pctTxt(r.g)] : []), fmtFull(r.rev), price(r), tot ? fmtShare(r.q / tot * 100) : '—', fmtN(r.buyers), ...(K.cmp ? [fmtN(r.neu), fmtN(r.lost)] : [])]);

  /* week by week (ignores the period: most recent weeks) */
  /* week by week (ignores the period: the most recent Monday–Sunday weeks) */
  const wkTbl = useMemo(() => {
    const WL = X.weeks, weeks = wk ? WL.slice(-wk) : WL, idx = new Map(weeks.map((w, j) => [w, j]));
    const dp = dimPred(f), cell = new Map(), rt = new Map(), ct = weeks.map(() => 0); let gt = 0;
    for (let i = 0; i < X.n; i++) {
      const j = idx.get(X.facts.W[i]); if (j == null || !dp(i) || (sel && !sel.has(X.facts.p[i]))) continue;
      const v = X.facts.v[i], x = uv(i), k = v + '|' + j;
      cell.set(k, (cell.get(k) || 0) + x); rt.set(v, (rt.get(v) || 0) + x); ct[j] += x; gt += x;
    }
    const reps = [...rt.keys()].sort((x, y) => rt.get(y) - rt.get(x));
    const meta = weeks.map(w => { const a = X.weekMon.get(w), e = Math.min(a + 6, X.ltT); return { w, a, e, full: a + 6 <= X.ltT, n: e - a + 1 }; });
    const ok = Math.abs(reps.reduce((x, v) => x + rt.get(v), 0) - gt) < 1e-6 && Math.abs(ct.reduce((x, v) => x + v, 0) - gt) < 1e-6;
    return { weeks, meta, cell, rt, ct, gt, reps, ok };
  }, [f, sel, unit, wk]); // eslint-disable-line react-hooks/exhaustive-deps

  const custRows = useMemo(() => {
    const a = new Map(), b = new Map(); for (const i of K.cur) a.set(X.facts.c[i], (a.get(X.facts.c[i]) || 0) + uv(i)); for (const i of K.cmp || []) b.set(X.facts.c[i], (b.get(X.facts.c[i]) || 0) + uv(i));
    return [...new Set([...a.keys(), ...b.keys()])].map(c => ({ c, q: a.get(c) || 0, p: b.get(c) || 0 })).filter(r => r.q > 0 || (K.cmp && r.p > 0)).sort((x, y) => y.q - x.q)
      .map(r => [X.customers[r.c][0], X.customers[r.c][2], X.customers[r.c][1], qf(r.q), ...(K.cmp ? [qf(r.p), r.q > 0 && r.p <= 0 ? 'New' : r.q <= 0 ? 'Stopped' : pctTxt(growth(r.q, r.p))] : [])]);
  }, [K, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const wkLab = m => `${m.w.split(' ')[0]} · ${sd(m.a)}–${sd(m.e)}${m.full ? '' : ' (so far)'}`;
  const wkProof = (j, v) => { const m = wkTbl.meta[j], mi = X.months.indexOf(isoOfT(m.a).slice(0, 7)), mj = X.months.indexOf(isoOfT(m.e).slice(0, 7));
    proof({ title: `${v != null ? X.verkopers[v] : 'All verkopers'} · ${line[1]} · ${wkLab(m)}`, def: 'Quantities of the selected products sold in this week, net of returns.', f: { ...f, from: mi, to: mj, cmp: 'none' }, extra: i => (!extra || extra(i)) && X.facts.W[i] === m.w && (v == null || X.facts.v[i] === v), dims: ['customer', 'product', 'verkoper', 'market'], col: unit }); };
  const copyWk = () => { const T = wkTbl, dv = unit === 'k' ? 1000 : 1; const rows = [['Verkoper', ...T.meta.map(m => `${m.w} ${isoOfT(m.a)}${m.full ? '' : ' (so far)'}`), 'Total'], ...T.reps.map(v => [X.verkopers[v], ...T.weeks.map((_, j) => (T.cell.get(v + '|' + j) || 0) / dv), T.rt.get(v) / dv]), ['Total', ...T.ct.map(x => x / dv), T.gt / dv]];
    try { navigator.clipboard.writeText(rows.map(r => r.join('\t')).join('\n')); } catch { /* ignore */ } };
  const vp = (title, ex, col) => proof({ title, def: `Quantities of ${line[1].toLowerCase()}.`, f, extra: ex ? i => (!extra || extra(i)) && ex(i) : extra, dims: ['customer', 'product', 'month', 'market', 'verkoper'], col });
  return (
    <div className="page-area fin-scroll" key="volumes">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <span className="filter-label">Product line</span>
        {lines.map(l => <button key={l[0]} className={`filter-chip${l[0] === preset ? ' active' : ''}`} onClick={() => { setPreset(l[0]); setUnitPick(null); }}>{l[1]}{l[2] ? <span style={{ opacity: .6 }}> ({l[2].size})</span> : null}</button>)}
        {!!(kgP && qP) && <><div className="filter-divider" /><span className="filter-label">Show in</span>
          <button className={`filter-chip${unit === 'k' ? ' active' : ''}`} onClick={() => setUnitPick('k')}>Tonnes</button>
          <button className={`filter-chip${unit === 'q' ? ' active' : ''}`} onClick={() => setUnitPick('q')}>Pieces</button></>}
      </div>
      <KpiNote text={`${line[1]}: ${qf(tot)} sold in ${P.label}${K.cmp && totC ? `, ${pctTxt(growth(totB, totC))} vs ${P.cmpLabel}` : ''}`} extra="Lines may overlap — never add lines together" />
      <div className="kpi-strip">
        {kgP ? <Kpi color="blue" label="Tonnes" value={tonD(K.kg)} sub={<><Trend g={growth(K.kgCur4Cmp, K.kgC)} /><span>Net of returns</span></>} onClick={() => vp('Tonnes · ' + line[1], null, 'k')} /> : null}
        {qP ? <Kpi color="sky" label="Pieces" value={fmtN(K.q)} sub={<><Trend g={growth(K.qCur4Cmp, K.qC)} /><span>Units sold per piece</span></>} onClick={() => vp('Pieces · ' + line[1], null, 'q')} /> : null}
        <Kpi color="green" label="Revenue" value={fmtFull(K.rev)} sub={<><Trend g={growth(K.revCur4Cmp, K.revC)} /><span>{unit === 'k' && K.kg ? `avg ${fmtEur2(revKg[0] / 100 / K.kg)}/kg` : ''}</span></>} onClick={() => vp('Revenue · ' + line[1], null, 'r')} />
        <Kpi color="teal" label="Buyers" value={fmtN(allBuyers.size)} sub="Customers with positive quantity" />
        {top && <Kpi color="amber" label="Top verkoper" value={top.n.split(' ')[0]} sub={`${qf(top.q)} · ${tot ? fmtShare(top.q / tot * 100) : '—'} of the volume`} onClick={() => vp(`${top.n} · ${line[1]}`, i => X.facts.v[i] === top.v, unit)} />}
      </div>
      <div className="charts-row">
        <Panel title={`${unit === 'k' ? 'Tonnes' : 'Pieces'} per Verkoper over Time`} subtitle={`Top five verkopers, others combined · per ${weekly ? 'week (from Apr 2026)' : 'month'} · Drill-down Week/Day in the filter bar for weekly`} height={360} className="fin-fixed" style={{ flex: 2 }}
          tableHeaders={['Period', ...ts.ser.map(s => s.name)]} tableRows={ts.labels.map((l, i) => [l, ...ts.ser.map(s => fmtNum(s.data[i]))])}><EC option={tsOpt} /></Panel>
        <Panel title={`${unit === 'k' ? 'Tonnes' : 'Pieces'} per Market`} subtitle="Click a market to filter this page's market" height={360} className="fin-fixed" style={{ flex: 1 }}
          tableHeaders={['Market', 'Quantity', ...(K.cmp ? ['Comparison'] : [])]} tableRows={mk.map(r => [r.n, qf(r.v), ...(K.cmp ? [qf(r.c)] : [])])}>
          <EC option={mkOpt} onEvents={{ click: p => { const r = mk[p.dataIndex]; if (r) setF(x => ({ ...x, mkts: [r.n] })); } }} />
        </Panel>
      </div>
      <div className="charts-row">
        <Panel title="Volume per Verkoper" subtitle="Avg price = revenue ÷ quantity in that unit · New/Stopped = buyers vs comparison · click a row" height={340} className="fin-fixed" style={{ flex: 1 }} hideToggle
          controls={<ExportExcelButton filename="volume_per_verkoper.xlsx" headers={head} rows={rows} />}>
          <InlineTable headers={head} rows={rows} height="100%" onRowClick={i => vp(`${reps[i].n} · ${line[1]}`, j => X.facts.v[j] === reps[i].v, unit)} />
        </Panel>
      </div>
      <div className="charts-row">
        <Panel title={`${unit === 'k' ? 'Tonnes' : 'Pieces'} per Verkoper, Week by Week`} subtitle={`Monday–Sunday weeks up to the last invoice (${X.ledgerLabel}); the current week is still running. Ignores the period and shows the most recent weeks; daily data starts Apr 2026. Click a cell for the customers and products behind it.`} height={480} className="fin-fixed" style={{ flex: 1 }} hideToggle
          controls={<><div className="view-tog">{[[4, '4 weeks'], [8, '8 weeks'], [13, '13 weeks'], [26, '26 weeks'], [0, 'All weeks']].map(([n, l]) => <button key={n} className={`vt-btn${wk === n ? ' active' : ''}`} onClick={() => setWk(n)}>{l}</button>)}</div>
            <button className="panel-btn" onClick={copyWk}>Copy table</button></>}>
          <WeekTable T={wkTbl} qf={qf} onCell={wkProof} />
        </Panel>
      </div>
      <div className="charts-row">
        <Panel title="Volume per Customer" subtitle="Who buys the selected products" height={340} className="fin-fixed" style={{ flex: 1 }} hideToggle
          controls={<input className="ledger-search" style={{ width: 200 }} placeholder="Search customer" value={cq} onChange={e => setCq(e.target.value)} />}>
          <InlineTable headers={['Customer', 'Verkoper', 'Market', 'Quantity', ...(K.cmp ? ['Comparison', 'Change'] : [])]} rows={cq.trim() ? custRows.filter(r => r[0].toLowerCase().includes(cq.trim().toLowerCase())) : custRows} height="100%" />
        </Panel>
      </div>
    </div>
  );
}

/* ══ Receivables ══════════════════════════════════════════════════════ */
function arPeriodStats(R) {
  const m = new Map(); let billed = 0, open = 0, n = 0, dSum = 0, dN = 0;
  for (const a of R) {
    const k = a[2].slice(0, 7); const x = m.get(k) || { billed: 0, open: 0, n: 0, dSum: 0, dN: 0 };
    x.billed += a[4] / 100; x.open += Math.max(0, a[6]) / 100; if (a[4] > 0) x.n++;
    if (a[4] > 0 && a[8] != null) { x.dSum += a[8]; x.dN++; }
    m.set(k, x); billed += a[4] / 100; open += Math.max(0, a[6]) / 100; if (a[4] > 0) n++; if (a[4] > 0 && a[8] != null) { dSum += a[8]; dN++; }
  }
  return { byMonth: m, billed, open, n, days: dN ? dSum / dN : null, share: billed ? open / billed * 100 : null };
}
function Receivables({ f }) {
  const proof = useProof();
  const P = period(f);
  const A = useMemo(() => arKPI(f), [f]);
  const AP = useMemo(() => arKPI(f, true), [f]);
  const cmpF = P.cmp ? { ...f, from: P.cmp[0].m, to: P.cmp[P.cmp.length - 1].m } : null;
  const AC = cmpF ? arKPI(cmpF, true) : null;
  const S = arPeriodStats(AP.R), SC = AC ? arPeriodStats(AC.R) : null;
  const cmpOK = SC && SC.n > 0;
  const cmpNote = !P.cmp ? (P.note || 'No comparison selected') : !cmpOK ? `No invoices in ${P.cmpLabel} — receivables start ${dLab(X.meta.arStart)}; choose “Previous period”` : `vs invoices of ${P.cmpLabel}`;
  const RD = X.ledgerLabel, S0 = dLab(X.meta.arStart);
  const RC = reconSteps();
  const cust = useMemo(() => { const m = new Map(); for (const a of A.R) if (a[6] > 0) m.set(a[0], (m.get(a[0]) || 0) + a[6] / 100); return [...m].sort((a, b) => b[1] - a[1]); }, [A]);
  const list = (title, def, R2) => proof({ title, def, list: { head: ['Customer', 'Invoice', 'Date', 'Due', 'Status', 'Open'], rows: R2.sort((a, b) => b[6] - a[6]).map(a => [X.customers[a[0]][0], a[1], a[2], a[3] || '—', a[7], fmtEur2(a[6] / 100)]), check: `✓ ${R2.length} items add up to <b>${fmtEur2(R2.reduce((s, a) => s + a[6], 0) / 100)}</b>` } });
  const open = A.R.filter(a => a[6] > 0);
  const kp = { over: open.filter(a => a[7] !== 'Current'), over30: open.filter(a => a[7] !== 'Current' && a[7] !== '1–30'), credit: A.R.filter(a => a[6] < 0) };
  const ageRows = AGE.map(a => ({ n: a === 'Current' ? 'Not yet due' : a + ' days late', v: A.byAge.get(a) || 0, k: a }));
  const ageOpt = hbarOpt(ageRows.map(r => ({ n: r.n, v: r.v, extra: A.open ? fmtShare(r.v / A.open * 100) + ' of open' : '' })), { colors: AGE_COLORS, labelW: 18 });
  const topOpt = hbarOpt(cust.slice(0, 12).map(([c, v]) => ({ n: X.customers[c][0], v, extra: `${X.customers[c][2]} · ${X.customers[c][1]}` })), { color: '#5B8FA3' });
  /* unpaid share per invoice month, current vs comparison (aligned by position) */
  const shareOf = (st, ym) => { const x = st?.byMonth.get(ym); return x && x.billed ? +(x.open / x.billed * 100).toFixed(1) : null; };
  const pairs = P.cur.map((c, i) => [X.months[c.m], P.cmp && P.cmp[i] ? X.months[P.cmp[i].m] : null]).filter(([ym]) => S.byMonth.has(ym));
  const payOpt = colOpt(pairs.map(([ym]) => MN[+ym.slice(5) - 1] + ' ' + ym.slice(2, 4)), pairs.map(([ym]) => shareOf(S, ym)), cmpOK ? pairs.map(([, c]) => c ? shareOf(SC, c) : null) : null,
    { fmtV: v => fmtShare(v), axisFmt: v => v + '%', curName: 'Still open · period', cmpName: 'Still open · comparison', curColor: '#E5A93D', cmpColor: '#C8D8DE' });
  const cOK = c => (!f.reps.length || f.reps.includes(X.customers[c][2])) && (!f.mkts.length || f.mkts.includes(X.customers[c][1]));
  const LG = X.legacy.filter(x => cOK(x[0])), UA = X.unallocated.filter(x => cOK(x[0]));
  const filtered = f.reps.length || f.mkts.length;
  return (
    <div className="page-area fin-scroll" key="receivables">
      <KpiNote text={`Position in Microfas on ${RD} · invoices from ${S0} · verkoper & market filters apply; product group does not`} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Open invoices" value={fmtFull(A.open)} sub={`${fmtN(A.nOpen)} invoices`} onClick={() => list('Open invoices', 'Invoices Microfas still shows as not (fully) paid.', open)} />
        <Kpi color="red" label="Overdue" value={fmtFull(A.over)} sub={`${fmtShare(A.open ? A.over / A.open * 100 : 0)} of open`} onClick={() => list('Overdue', 'Open invoices past their due date.', kp.over)} />
        <Kpi color="amber" label="More than 30 days late" value={fmtFull(A.over30)} sub={`${fmtShare(A.open ? A.over30 / A.open * 100 : 0)} of open`} onClick={() => list('More than 30 days late', 'Overdue by more than 30 days.', kp.over30)} />
        <Kpi color="sky" label="Open credits" value={fmtFull(-A.credit)} sub={`${fmtN(kp.credit.length)} items`} onClick={() => list('Open credits', 'Credit notes and overpayments still open.', kp.credit)} />
        <Kpi color="navy" label="Owed after credits" value={fmtFull(A.net)} sub="Open invoices − open credits" />
      </div>
      <div className="charts-row">
        <Panel title="Ageing of Open Invoices" subtitle={`Days past due on ${RD} · click a bucket for its invoices`} height={320} className="fin-fixed" style={{ flex: 1 }}
          tableHeaders={['Bucket', 'Open', 'Share']} tableRows={ageRows.map(r => [r.n, fmtFull(r.v), A.open ? fmtShare(r.v / A.open * 100) : '—'])}>
          <EC option={ageOpt} onEvents={{ click: p => { const r = ageRows[p.dataIndex]; if (r) list(r.n, 'Open invoices in one ageing bucket.', open.filter(a => a[7] === r.k)); } }} />
        </Panel>
        <Panel title="Largest Open Balances" subtitle="Click a customer for their open items" height={320} className="fin-fixed" style={{ flex: 1 }}
          tableHeaders={['Customer', 'Verkoper', 'Open']} tableRows={cust.map(([c, v]) => [X.customers[c][0], X.customers[c][2], fmtFull(v)])}>
          <EC option={topOpt} onEvents={{ click: p => { const c = cust[p.dataIndex]?.[0]; if (c != null) list(X.customers[c][0], 'Open items of one customer.', A.R.filter(a => a[0] === c && a[6] !== 0)); } }} />
        </Panel>
      </div>
      <div className="charts-row">
        <Panel title="Still Unpaid, by Invoice Month" subtitle={`Share of each month's billed value still open on ${RD} · ${cmpNote}`} height={320} className="fin-fixed" style={{ flex: 1.3 }}
          tableHeaders={['Invoice month', 'Billed', 'Still open', 'Share', ...(cmpOK ? ['Comparison month', 'Comparison share'] : [])]}
          tableRows={pairs.map(([ym, c]) => { const x = S.byMonth.get(ym); return [mLong(ym), fmtFull(x.billed), fmtFull(x.open), fmtShare(shareOf(S, ym)), ...(cmpOK ? [c ? mLong(c) : '—', c && SC.byMonth.get(c) ? fmtShare(shareOf(SC, c)) : '—'] : [])]; })}>
          {pairs.length ? <EC option={payOpt} onEvents={{ click: p => { const m = pairs[p.dataIndex]?.[p.seriesName?.includes('comparison') ? 1 : 0]; if (m) list('Still open · invoices of ' + mLong(m), 'Invoices of one month still open.', (p.seriesName?.includes('comparison') ? AC : AP).R.filter(a => a[2].startsWith(m) && a[6] > 0)); } }} /> : <div className="watch-empty">No invoices in this period — receivables start with invoices of {S0}.</div>}
        </Panel>
        <Panel title="Open Items not in the Tiles" subtitle="Part of the tie-out below" height={320} className="fin-fixed" style={{ flex: 1 }} hideToggle noZoom>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <p style={{ margin: 0 }}>Microfas still shows <b>{LG.length} items for {fmtFull(LG.reduce((s, x) => s + x[2], 0) / 100)}</b> from before {S0}, and <b>{UA.length} items for {fmtFull(UA.reduce((s, x) => s + x[3], 0) / 100)}</b> with no matching invoice — mostly payments received on account.</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="panel-btn" onClick={() => proof({ title: 'Open from before ' + S0, def: 'Items still open from the opening balance, excl. VAT.', list: { head: ['Customer', 'Invoice', 'Open'], rows: LG.map(x => [X.customers[x[0]][0], x[1], fmtEur2(x[2] / 100)]), check: `✓ ${LG.length} rows` } })}>Items from before {S0}</button>
              <button className="panel-btn" onClick={() => proof({ title: 'Open items without an invoice', def: 'Customer postings without an invoice reference, excl. VAT.', list: { head: ['Customer', 'Date', 'Bank', 'Amount'], rows: UA.map(x => [X.customers[x[0]][0], x[1], x[2], fmtEur2(x[3] / 100)]), check: `✓ ${UA.length} rows` } })}>Items without an invoice</button>
            </div>
          </div>
        </Panel>
      </div>
      <div className="charts-row">
        <Panel title="From Open Items to the Debtors Account" subtitle={filtered ? 'Whole company — ignores the verkoper and market filters' : 'How the receivables tie to debtors account 132000 in Microfas, to the cent'} className="hug" style={{ flex: 1 }} hideToggle noZoom>
          <div className="rc-strip">
            {RC.steps.map(([l, v, op, eq], i) => <span key={i} style={{ display: 'contents' }}><div className={`rc-box${eq ? ' eq' : ''}`}><span>{l}</span><b>{fmtEur2(v / 100)}</b></div>{op && <span className="rc-op">{op}</span>}</span>)}
            <div className={`rc-ok${RC.ok ? '' : ' bad'}`}>{RC.ok ? '✓ exact' : '✗ off by ' + fmtEur2(RC.diff / 100)}</div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ══ Reorder radar ════════════════════════════════════════════════════ */
function Reorder({ f }) {
  const proof = useProof();
  const Rr = useMemo(() => reorder(f, true), [f]);
  const R = Rr.rows, tot = R.reduce((s, r) => s + r.mrev, 0);
  const custs = new Set(R.map(r => r.c));
  const byRep = useMemo(() => { const m = new Map(); for (const r of R) { const k = X.customers[r.c][2]; m.set(k, (m.get(k) || 0) + r.mrev); } return [...m].sort((a, b) => b[1] - a[1]); }, [R]);
  const head = ['Customer', 'Product', 'Verkoper', 'Orders', 'Gap', 'Last order', 'Expected Reorder Date', 'Since', 'Late', '€ / Month'];
  const rows = R.map(r => [X.customers[r.c][0], X.products[r.p][0], X.customers[r.c][2], r.n, fmtN(r.gap) + ' d', r.last, r.fell, r.since, r.due, fmtFull(r.mrev)]);
  const win = Rr.window ? (Rr.window[0] === Rr.window[1] ? dLab(Rr.window[0]) : `${dLab(Rr.window[0])} – ${dLab(Rr.window[1])}`) : '';
  const card = r => proof({ title: X.customers[r.c][0], def: `Customer card · ${X.products[r.p][0]} usually every ${fmtN(r.gap)} days, last ordered ${r.last}`, f: { ...f, from: 0, to: X.nM - 1, preset: 'all' }, extra: i => X.facts.c[i] === r.c, dims: ['product', 'month'] });
  return (
    <div className="page-area fin-scroll" key="reorder">
      <KpiNote text={`Pairs that became late ${win} and are still not reordered on ${X.ledgerLabel}`} extra="Regular = 3+ order days since Apr 2026 · late = more than 1,5× the usual gap, up to 120 days" />
      <div className="kpi-strip">
        <Kpi color="blue" label="Customers to call" value={fmtN(custs.size)} sub={`${fmtN(byRep.length)} verkopers involved`} />
        <Kpi color="teal" label="Avg days late" value={R.length ? fmtN(R.reduce((s, r) => s + r.due, 0) / R.length) : '—'} sub="beyond the usual gap" />
        <Kpi color="red" label="Late reorders" value={fmtN(R.length)} sub="customer-product pairs" />
        <Kpi color="amber" label="Value at risk / month" value={fmtFull(tot)} sub="average monthly revenue, last 6 complete months" />
      </div>
      <div className="charts-row">
        <Panel title={<>Call List <span className="cp-title-desc">(Customers to be called who were past the expected reorder date)</span></>} subtitle="Sorted by monthly value · Gap = usual days between orders · Since / Late in days · click a row for the customer card" height={560} className="fin-fixed" style={{ flex: 1 }} hideToggle
          controls={<ExportExcelButton filename="reorder_call_list.xlsx" headers={head} rows={rows} />}>
          {R.length ? <div className="compact-tbl" style={{ height: '100%' }}><InlineTable headers={head} rows={rows} height="100%" searchable onRowClick={i => card(R[i])} /></div> : <div className="watch-empty">Nothing overdue for this selection.</div>}
        </Panel>
      </div>
    </div>
  );
}

/* ══ Products & price ═════════════════════════════════════════════════ */
function ProductsPrice({ f, setF }) {
  const proof = useProof();
  const K = useSales(f), P = K.P;
  const w = i => X.kgProd.has(X.facts.p[i]);
  const mpF = { ...f, grps: ['Milk powder'] }, fdF = { ...f, grps: ['Feed'] };
  const MP = useSales(mpF, w), FD = useSales(fdF, w);
  const ppk = (r, k) => k ? r / k : null;
  const ms = P.months, cm = P.cmp ? P.cmp.map(c => c.m) : null;
  const cK = by(MP.cur, i => X.facts.m[i], 'k'), cR = by(MP.cur, i => X.facts.m[i], 'r'), pK = by(MP.cmp, i => X.facts.m[i], 'k'), pR = by(MP.cmp, i => X.facts.m[i], 'r');
  const labels = ms.map(m => X.mLabel[m]);
  const tOpt = colOpt(labels, ms.map(m => +((cK.get(m) || 0) / 1000).toFixed(1)), cm ? cm.map(m => +((pK.get(m) || 0) / 1000).toFixed(1)) : null, { fmtV: v => fmtNum(v) + ' t', axisFmt: v => fmtNum(v) + ' t', curColor: '#40BCF3', cmpColor: '#C8D8DE' });
  const pOpt = colOpt(labels, ms.map(m => cK.get(m) ? +((cR.get(m) || 0) / 100 / cK.get(m)).toFixed(3) : null), cm ? cm.map(m => pK.get(m) ? +((pR.get(m) || 0) / 100 / pK.get(m)).toFixed(3) : null) : null, { fmtV: v => '€ ' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), axisFmt: v => '€' + v.toLocaleString('de-DE', { minimumFractionDigits: 2 }), line: true, curName: '€/kg', curColor: '#40BCF3', cmpColor: '#8A9AA1' });
  const gr = useMemo(() => aggregate(K.cur, i => X.facts.G[i]), [K]), grC = useMemo(() => aggregate(K.cmp, i => X.facts.G[i]), [K]), grB = useMemo(() => aggregate(K.curC, i => X.facts.G[i]), [K]);
  const mix = [0, 1, 2, 3, 4, 5].filter(g => gr.get(g)?.rev || grC.get(g)?.rev).map(gi => ({ gi, n: GROUPS[gi], v: gr.get(gi)?.rev || 0, c: K.cmp ? (grC.get(gi)?.rev || 0) : null, g: K.cmp ? growth(grB.get(gi)?.rev || 0, grC.get(gi)?.rev || 0) : null }));
  const [open, setOpen] = useState(new Set());
  const tree = useMemo(() => {
    const cr = aggregate(K.cur, i => X.facts.g[i]), cc = aggregate(K.cmp, i => X.facts.g[i]), pr = aggregate(K.cur, i => X.facts.p[i]), pc = aggregate(K.cmp, i => X.facts.p[i]);
    const cb = aggregate(K.curC, i => X.facts.g[i]), pb = aggregate(K.curC, i => X.facts.p[i]), gb = aggregate(K.curC, i => X.facts.G[i]);
    const out = [];
    for (const m of mix) {
      out.push({ lvl: 0, key: 'g' + m.gi, l: m.n, v: m.v, c: m.c, b: gb.get(m.gi)?.rev || 0, kg: gr.get(m.gi)?.kg || 0, pcs: gr.get(m.gi)?.pcs || 0 });
      if (!open.has('g' + m.gi)) continue;
      X.categories.forEach((ct, ci) => {
        if (X.gOfCat[ci] !== m.gi) return; const v = cr.get(ci)?.rev || 0, c = cc.get(ci)?.rev || 0; if (!v && !c) return;
        out.push({ lvl: 1, key: 'c' + ci, l: ct[0], v, c: K.cmp ? c : null, b: cb.get(ci)?.rev || 0, kg: cr.get(ci)?.kg || 0, pcs: cr.get(ci)?.pcs || 0 });
        if (!open.has('c' + ci)) return;
        [...new Set([...pr.keys(), ...pc.keys()])].filter(p => X.products[p][1] === ci).sort((a, b) => (pr.get(b)?.rev || 0) - (pr.get(a)?.rev || 0))
          .forEach(p => out.push({ lvl: 2, l: X.products[p][0], v: pr.get(p)?.rev || 0, c: K.cmp ? (pc.get(p)?.rev || 0) : null, b: pb.get(p)?.rev || 0, kg: pr.get(p)?.kg || 0, pcs: X.kgProd.has(p) ? 0 : (pr.get(p)?.pcs || 0), byKg: X.kgProd.has(p) }));
      });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [K, open, gr]);
  const toggle = k => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const fdP = ppk(FD.rev, FD.kg), fdPC = ppk(FD.revC, FD.kgC);
  const fdB = ppk(FD.revCur4Cmp, FD.kgCur4Cmp);
  /* latest milk powder price: the current (latest) month only, vs the month before */
  const lastM = X.nM - 1;
  const MPL = useSales({ ...mpF, from: lastM, to: lastM, preset: 'custom', cmp: 'pp' }, w);
  const mpL = ppk(MPL.rev, MPL.kg), mpLP = ppk(MPL.revC, MPL.kgC);
  const e2 = v => v == null ? '—' : '€ ' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const feedByProduct = () => { const a = aggregate(FD.cur, i => X.facts.p[i]); proof({ title: 'Feed price by product', def: 'Revenue ÷ kg per feed product in the period.', list: { head: ['Product', 'Tonnes', 'Revenue', '€/kg'], rows: [...a.values()].filter(x => x.kg).sort((x, y) => y.kg - x.kg).map(x => [X.products[x.k][0], tonD(x.kg), fmtFull(x.rev), e2(x.rev / x.kg)]), check: `✓ ${a.size} products · total ${tonD(FD.kg)}` } }); };
  return (
    <div className="page-area fin-scroll" key="ckproducts">
      <KpiNote text={`${P.label} · price per kg uses products sold by weight; totals are ratios of sums`} />
      <div className="kpi-strip">
        <Kpi color="blue" label={`Milk powder € / kg · ${X.mLabel[lastM]}`} value={e2(mpL)} sub={<><Trend g={growth(mpL, mpLP)} /><span>latest month{X.partial.m === lastM ? ` (1–${X.partial.day})` : ''}{mpLP != null ? ` · ${X.mLabel[lastM - 1]} ${e2(mpLP)}` : ''}</span></>} onClick={() => proof({ title: `Milk powder · ${mLong(X.months[lastM])}`, def: 'Milk powder sold by weight in the latest month; price = revenue ÷ kg.', f: { ...mpF, from: lastM, to: lastM, cmp: 'none' }, extra: w, col: 'k', dims: ['product', 'customer', 'verkoper', 'week'] })} />
        <Kpi color="teal" label="Milk powder tonnes" value={tonD(MP.kg)} sub={<><Trend g={growth(MP.kgCur4Cmp, MP.kgC)} /><span>{MP.kgC != null ? 'vs ' + tonD(MP.kgC) : 'No comparison'}</span></>} />
        <Kpi color="green" label="Feed € / kg" value={e2(fdP)} sub={<><Trend g={growth(fdB, fdPC)} /><span>{tonD(FD.kg)}</span></>} onClick={feedByProduct} />
        <Kpi color="amber" label="Revenue" value={fmtFull(K.rev)} sub={<><Trend g={growth(K.revCur4Cmp, K.revC)} /><span>all groups</span></>} onClick={() => proof({ title: 'Revenue by product group', def: 'Revenue for the selection.', f, dims: ['group', 'category', 'product'] })} />
      </div>
      <div className="charts-row">
        <Panel title="Milk Powder: Tonnes per Month" subtitle={P.cmp ? `vs ${P.cmpLabel}` : 'No comparison'} height={300} className="fin-fixed" style={{ flex: 1 }} tableHeaders={['Month', 'Tonnes', 'Comparison']} tableRows={ms.map((m, i) => [X.mLabel[m], tonD(cK.get(m) || 0), cm ? tonD(pK.get(cm[i]) || 0) : '—'])}><EC option={tOpt} /></Panel>
        <Panel title="Milk Powder: € per kg per Month" subtitle="Axis starts near the lowest price so movements are visible" height={300} className="fin-fixed" style={{ flex: 1 }} tableHeaders={['Month', '€/kg', 'Comparison']} tableRows={ms.map((m, i) => [X.mLabel[m], e2(cK.get(m) ? (cR.get(m) || 0) / 100 / cK.get(m) : null), cm ? e2(pK.get(cm[i]) ? (pR.get(cm[i]) || 0) / 100 / pK.get(cm[i]) : null) : '—'])}><EC option={pOpt} /></Panel>
      </div>
      <div className="charts-row">
        <Panel title="Group → Category → Product" subtitle="Click a group or category to open it · every level adds up to the level above" height={420} className="fin-fixed" style={{ flex: 1.6 }} hideToggle>
          <div className="tbl-wrap" style={{ height: '100%', overflow: 'auto' }}>
            <table className="itbl tree">
              <thead><tr><th>Group / category / product</th><th>Revenue</th>{K.cmp && <><th>Comparison</th><th>Change</th></>}<th>Share</th><th>Tonnes</th><th>Pieces</th></tr></thead>
              <tbody>
                {tree.map((r, i) => (
                  <tr key={i} onClick={r.key ? () => toggle(r.key) : undefined} style={r.key ? { cursor: 'pointer' } : undefined}>
                    <td style={{ paddingLeft: 8 + r.lvl * 18, fontWeight: r.lvl === 0 ? 700 : 400 }}>{r.key ? (open.has(r.key) ? '▾ ' : '▸ ') : ''}{r.l}</td>
                    <td>{fmtFull(r.v)}</td>{K.cmp && <><td>{fmtFull(r.c)}</td><td className={r.b >= r.c ? 'up' : 'down'}>{pctTxt(growth(r.b, r.c))}</td></>}
                    <td>{K.rev ? fmtShare(r.v / K.rev * 100) : '—'}</td><td>{r.lvl === 2 ? (r.byKg ? tonD(r.kg) : '—') : (r.kg ? tonD(r.kg) : '—')}</td><td>{r.lvl === 2 ? (r.byKg ? '—' : fmtN(r.pcs)) : (r.pcs ? fmtN(r.pcs) : '—')}</td>
                  </tr>
                ))}
                <tr className="tot"><td>Total</td><td>{fmtFull(K.rev)}</td>{K.cmp && <><td>{fmtFull(K.revC)}</td><td>{pctTxt(growth(K.revCur4Cmp, K.revC))}</td></>}<td>100,0%</td><td>{tonD(K.kg)}</td><td>{fmtN([...gr.values()].reduce((s, x) => s + x.pcs, 0))}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="Feed: Tonnes and Price" subtitle="Products sold by weight" className="hug" hideToggle noZoom>
            {FD.kg ? <div style={{ fontSize: 13 }}><p style={{ margin: '0 0 8px' }}>{tonD(FD.kg)} at <b>{e2(fdP)}/kg</b>{FD.kgC ? <> · comparison {tonD(FD.kgC)} at {e2(fdPC)}/kg</> : null}.</p><button className="panel-btn" onClick={feedByProduct}>Show feed price by product</button></div> : <div className="watch-empty">No feed sold by weight in this selection.</div>}
          </Panel>
          <Panel title="Product Mix by Group" subtitle="Click a group to filter this page" height={260} className="fin-fixed" tableHeaders={['Group', 'Revenue', 'Share']} tableRows={mix.map(m => [m.n, fmtFull(m.v), K.rev ? fmtShare(m.v / K.rev * 100) : '—'])}>
            <EC option={hbarOpt(mix, { cmp: !!K.cmp, colors: mix.map(m => GROUP_COLORS[m.gi]) })} onEvents={{ click: p => { const m = mix[p.dataIndex]; if (m && m.gi < 5) setF(x => ({ ...x, grps: [m.n] })); } }} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══ Markets ══════════════════════════════════════════════════════════ */
function Markets({ f, setF }) {
  const proof = useProof();
  const K = useSales(f), P = K.P;
  const rows = useMemo(() => {
    const a = aggregate(K.cur, i => X.facts.M[i]), b = aggregate(K.cmp, i => X.facts.M[i]), s = aggregate(K.curC, i => X.facts.M[i]);
    return [...new Set([...a.keys(), ...b.keys()])].map(k => ({ k, n: X.mkts[k], v: a.get(k)?.rev || 0, c: K.cmp ? (b.get(k)?.rev || 0) : null, g: K.cmp ? growth(s.get(k)?.rev || 0, b.get(k)?.rev || 0) : null, buyers: a.get(k)?.cust.size || 0, kg: a.get(k)?.kg || 0 })).filter(r => r.v || r.c).sort((x, y) => y.v - x.v);
  }, [K]);
  const tot = rows.reduce((s, r) => s + r.v, 0), top = rows[0];
  const nl = rows.find(r => r.n === 'Netherlands');
  const hm = useMemo(() => aggregate(K.cur, i => X.facts.M[i] + '|' + X.facts.G[i]), [K]);
  const gs = [0, 1, 2, 3, 4, 5].filter(g => rows.some(r => hm.get(r.k + '|' + g)?.rev));
  const max = Math.max(1, ...rows.flatMap(r => gs.map(g => hm.get(r.k + '|' + g)?.rev || 0)));
  const cell = (k, g) => proof({ title: `${X.mkts[k]} · ${GROUPS[g]}`, def: 'Revenue of one market and product group.', f: { ...f, mkts: [X.mkts[k]], grps: g < 5 ? [GROUPS[g]] : f.grps }, extra: g === 5 ? i => X.facts.G[i] === 5 : undefined, dims: ['customer', 'product', 'verkoper', 'month'] });
  return (
    <div className="page-area fin-scroll" key="markets">
      <KpiNote text={`${P.label} · market = customer's delivery country in the master data`} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Top market" value={top ? top.n : '—'} sub={top ? <><Trend g={top.g} /><span>{fmtShare(top.v / tot * 100)} of revenue</span></> : ''} onClick={top ? () => proof({ title: top.n, def: 'Revenue of one market.', f: { ...f, mkts: [top.n] }, dims: ['group', 'customer', 'verkoper', 'month'] }) : undefined} />
        <Kpi color="teal" label="Markets with revenue" value={fmtN(rows.filter(r => r.v > 0).length)} sub={`of ${X.mkts.length} in the master data`} />
        <Kpi color="green" label="Export share" value={nl ? fmtShare((tot - nl.v) / tot * 100) : '—'} sub="Revenue outside the Netherlands" />
        <Kpi color="amber" label="Revenue" value={fmtFull(tot)} sub={<><Trend g={growth(K.revCur4Cmp, K.revC)} /><span>{P.cmp ? 'vs ' + P.cmpLabel : 'No comparison'}</span></>} onClick={() => proof({ title: 'Revenue by market', def: 'Revenue per delivery country.', f, dims: ['market', 'group', 'month'] })} />
      </div>
      <div className="charts-row">
        <Panel title="Revenue by Market" subtitle={`${K.cmp ? 'Tick = comparison · ' : ''}click a market to filter this page`} height={520} className="fin-fixed" style={{ flex: 1 }}
          tableHeaders={['Market', 'Revenue', ...(K.cmp ? ['Comparison', 'Change'] : []), 'Share', 'Buyers', 'Tonnes']} tableRows={rows.map(r => [r.n, fmtFull(r.v), ...(K.cmp ? [fmtFull(r.c), pctTxt(r.g)] : []), tot ? fmtShare(r.v / tot * 100) : '—', fmtN(r.buyers), ton(r.kg)])}>
          <EC option={hbarOpt(rows, { cmp: !!K.cmp, color: '#40BCF3' })} onEvents={{ click: p => { const r = rows[p.dataIndex]; if (r) setF(x => ({ ...x, mkts: x.mkts.length === 1 && x.mkts[0] === r.n ? [] : [r.n] })); } }} />
        </Panel>
        <Panel title="Market × Product Group" subtitle="Click a cell for its rows" height={520} className="fin-fixed" style={{ flex: 1.4 }} hideToggle>
          <div className="tbl-wrap" style={{ height: '100%', overflow: 'auto' }}>
            <table className="itbl">
              <thead><tr><th>Market</th>{gs.map(g => <th key={g}>{GROUPS[g]}</th>)}<th>Total</th></tr></thead>
              <tbody>
                {rows.map(r => <tr key={r.k}><td>{r.n}</td>{gs.map(g => { const v = hm.get(r.k + '|' + g)?.rev || 0; return <td key={g} onClick={() => cell(r.k, g)} style={{ cursor: 'pointer', background: v ? `rgba(64,188,243,${0.06 + 0.5 * v / max})` : undefined }}>{v ? fmt(v) : '·'}</td>; })}<td><b>{fmt(r.v)}</b></td></tr>)}
                <tr className="tot"><td>Total</td>{gs.map(g => <td key={g}>{fmt(rows.reduce((s, r) => s + (hm.get(r.k + '|' + g)?.rev || 0), 0))}</td>)}<td>{fmt(tot)}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Finance.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* Finance pages — the books (P&L postings) from dash.json.
   Books start 1 April 2026; verkoper / group / market filters do not apply. */
const COST_ORDER = ['Purchases', 'Personnel', 'Transport', 'Housing', 'Sales & marketing', 'Office & admin', 'Finance & tax', 'Other'];
const fmtAxis = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; if (a >= 1e6) return s + '€' + (a / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + 'M'; if (a >= 1e3) return s + '€' + (a / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + 'K'; return s + '€' + Math.round(a).toLocaleString('de-DE'); };
const pct1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1).replace('.', ',') + '%';

/* Books for the filter period and its comparison */
function useBooks(f) {
  return useMemo(() => {
    const P = period(f), start = X.meta.booksOpening.slice(0, 7);
    const inM = ms => { const s = new Set(ms.map(m => X.months[m])); return X.pnl.filter(r => r[0] >= start && s.has(r[0])); };
    const cur = inM(P.months);
    let cmp = null, cmpLabel = null, note = '';
    if (P.cmp) {
      const cm = P.cmp.map(c => c.m);
      if (X.months[cm[0]] < start) note = `Books start ${dLab(X.meta.booksOpening)} — no comparison for ${P.cmpLabel}. Choose “Previous period” for a later range.`;
      else { cmp = inM(cm); cmpLabel = P.cmpLabel; }
    }
    const months = [...new Set(cur.map(r => r[0]))].sort();
    const sum = (R, pred) => R.reduce((s, r) => s + (pred(r) ? r[4] : 0), 0) / 100;
    const kpis = R => { if (!R) return null; const rev = sum(R, r => r[2] === 'Revenue'), pur = -sum(R, r => r[2] === 'Purchases'), opex = -sum(R, r => r[2] !== 'Revenue' && r[2] !== 'Purchases'); return { rev, pur, opex, gp: rev - pur, res: rev - pur - opex }; };
    const cats = R => { const m = new Map(); for (const r of R || []) m.set(r[2], (m.get(r[2]) || 0) + r[4] / 100); return m; };
    const accts = R => { const m = new Map(); for (const r of R || []) { const k = r[1]; const x = m.get(k) || { acct: k, cat: r[2], v: 0 }; x.v += r[4] / 100; m.set(k, x); } return m; };
    return { P, cur, cmp, cmpLabel, note, months, K: kpis(cur), KC: kpis(cmp), C: cats(cur), CC: cmp ? cats(cmp) : null, A: accts(cur), AC: cmp ? accts(cmp) : null,
      label: months.length ? (months.length === 1 ? mLong(months[0]) : `${mLong(months[0])} – ${mLong(months[months.length - 1])}`) : 'No booked months in this period' };
  }, [f]);
}

function FinNote({ B }) {
  return <div className="fin-note">⚠ Books: {B.label}{B.cmpLabel ? ` vs ${B.cmpLabel}` : ''} · purchases are booked when bought, not when sold, so monthly results swing with purchase timing{B.note ? ` · ${B.note}` : ''}</div>;
}
function YoyBadge({ cy, py, goodIfUp = true }) {
  if (py == null) return <span className="fin-badge" style={{ color: 'var(--muted2)' }}>no comparison</span>;
  const d = cy - py, p = py !== 0 ? Math.abs(d / py) * 100 : null, good = goodIfUp ? d >= 0 : d <= 0;
  return <span className={`fin-badge ${good ? 'good' : 'bad'}`}>{d >= 0 ? '▲' : '▼'} {p != null ? p.toFixed(1).replace('.', ',') + '%' : '—'}</span>;
}
const mkBarOpt = (labels, vals, colorFn, lw) => {
  const L = lw || (isMobileViewport() ? 105 : 150);
  return {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `<strong>${p[0].name}</strong><br/>${fmtFull(p[0].value)}` },
    grid: { left: L, right: 18, bottom: 22, top: 6, containLabel: false },
    xAxis: { type: 'value', splitNumber: 4, axisLabel: { color: '#5F7078', fontSize: 8, formatter: fmtAxis, hideOverlap: true }, splitLine: { lineStyle: { color: '#F0F3F4' } }, axisTick: { show: false } },
    yAxis: { type: 'category', data: labels, axisLabel: { color: '#5F7078', fontSize: 8, width: L - 10, overflow: 'truncate', ellipsis: '…' }, inverse: true, axisTick: { show: false } },
    series: [{ type: 'bar', barMaxWidth: 12, data: vals.map((v, i) => ({ value: Math.round(v), itemStyle: { color: colorFn(i, v), borderRadius: [0, 3, 3, 0] } })) }],
  };
};

/* Margin gauge used on the P&L Summary page */
function Gauge({ value, label, py }) {
  const clamp = v => Math.max(-30, Math.min(30, v)), angle = (clamp(value) + 30) / 60 * 180 - 90, r = 38, cx = 50, cy = 44;
  const xy = d => { const rad = (d - 90) * Math.PI / 180; return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }; };
  const arc = (a, b, c) => { const p = xy(a * 3), q = xy(b * 3); return `<path d="M ${p.x} ${p.y} A ${r} ${r} 0 0 1 ${q.x} ${q.y}" stroke="${c}" stroke-width="7" fill="none"/>`; };
  const color = value >= 10 ? '#2E9B62' : value >= 0 ? '#E5A93D' : '#D95C5C', n = xy(angle);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <svg viewBox="0 0 100 58" style={{ width: '100%', maxWidth: 110, overflow: 'visible' }}><g dangerouslySetInnerHTML={{ __html: arc(-30, 0, '#D95C5C') + arc(0, 10, '#E5A93D') + arc(10, 30, '#2E9B62') + `<line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" stroke="#1F3741" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#1F3741"/>` }} /></svg>
      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'JetBrains Mono,monospace', color, marginTop: -2 }}>{pct1(value)}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Comparison: {pct1(py)}</div>
    </div>
  );
}

/* ══ P&L Summary ══ */
function PLSummary({ f }) {
  const B = useBooks(f), K = B.K, KC = B.KC, proof = useProof();
  const gm = K.rev ? K.gp / K.rev * 100 : 0, em = K.rev ? K.res / K.rev * 100 : 0;
  const gmC = KC?.rev ? KC.gp / KC.rev * 100 : null, emC = KC?.rev ? KC.res / KC.rev * 100 : null;
  /* bridge: revenue → each cost category → result (cockpit bridge chart) */
  const steps = [{ n: 'Revenue', v: K.rev, tot: true }, ...COST_ORDER.filter(c => B.C.get(c)).map(c => ({ n: c, v: B.C.get(c) })), { n: 'Result', v: K.res, tot: true }];
  let run = 0; const base = [], val = [], col = [];
  steps.forEach((s, i) => { if (s.tot) { base.push(Math.min(0, s.v)); val.push(Math.abs(s.v)); col.push(i === 0 ? '#40BCF3' : (s.v >= 0 ? '#2E9B62' : '#D95C5C')); run = s.v; } else { base.push(Math.min(run, run + s.v)); val.push(Math.abs(s.v)); col.push(s.v >= 0 ? '#2E9B62' : '#D95C5C'); run += s.v; } });
  const wfOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `<strong>${steps[p[0].dataIndex].n}</strong><br/>${fmtFull(steps[p[0].dataIndex].v)}` },
    grid: { left: 14, right: 14, bottom: isMobileViewport() ? 54 : 40, top: 30, containLabel: true },
    xAxis: { type: 'category', data: steps.map(s => s.n), axisLabel: { ...catAxisLabel(steps.length, 8), rotate: 25 }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 8, formatter: fmtAxis }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [
      { type: 'bar', stack: 'wf', data: base, itemStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
      { type: 'bar', stack: 'wf', barWidth: '55%', data: val.map((v, i) => ({ value: v, itemStyle: { color: col[i], borderRadius: 3 } })), label: { show: true, position: 'top', distance: 4, color: '#1F3741', fontSize: 8, fontWeight: 700, formatter: p => fmtAxis(steps[p.dataIndex].v) } },
    ],
  };
  const wfTable = { headers: ['Step', B.label, ...(KC ? [B.cmpLabel] : [])], rows: steps.map(s => [s.n, fmtFull(s.v), ...(KC ? [fmtFull(s.n === 'Revenue' ? KC.rev : s.n === 'Result' ? KC.res : B.CC.get(s.n) || 0)] : [])]) };

  const cats = COST_ORDER.filter(c => B.C.get(c) || B.CC?.get(c));
  const monthly = B.months.map(m => { const R = B.cur.filter(r => r[0] === m); const rev = R.filter(r => r[2] === 'Revenue').reduce((s, r) => s + r[4], 0) / 100, cost = -R.filter(r => r[2] !== 'Revenue').reduce((s, r) => s + r[4], 0) / 100; return { m, rev, cost, res: rev - cost }; });
  const resOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => `<strong>${p[0].name}</strong><br/>` + p.map(s => `${s.marker} ${s.seriesName}: ${fmtFull(s.value)}`).join('<br/>') },
    legend: { bottom: 0, textStyle: { color: '#5F7078', fontSize: 9 } }, grid: { left: 10, right: 14, bottom: 34, top: 14, containLabel: true },
    xAxis: { type: 'category', data: monthly.map(r => MN[+r.m.slice(5) - 1] + ' ' + r.m.slice(2, 4)), axisLabel: catAxisLabel(monthly.length, 8) },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 8, formatter: fmtAxis }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: [{ name: 'Revenue', type: 'bar', data: monthly.map(r => Math.round(r.rev)), itemStyle: { color: '#40BCF3', borderRadius: [3, 3, 0, 0] } }, { name: 'Costs', type: 'bar', data: monthly.map(r => Math.round(r.cost)), itemStyle: { color: '#C8D8DE', borderRadius: [3, 3, 0, 0] } }, { name: 'Result', type: 'line', data: monthly.map(r => Math.round(r.res)), itemStyle: { color: '#1F3741' }, lineStyle: { width: 2 } }],
  };
  const catProof = c => proof({ title: c, def: `Booked postings in category “${c}”.`, list: { head: ['Month', 'Account', 'Amount'], rows: B.cur.filter(r => r[2] === c).sort((a, b) => a[0].localeCompare(b[0]) || a[4] - b[4]).map(r => [r[0], r[1], fmtFull(r[4] / 100)]), check: `✓ adds up to <b>${fmtFull((B.C.get(c) || 0))}</b>` } });
  return (
    <div className="page-area fin-scroll" key="plsummary">
      <FinNote B={B} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Revenue (books)" value={fmtFull(K.rev)} sub={<YoyBadge cy={K.rev} py={KC?.rev} />} onClick={() => catProof('Revenue')} />
        <Kpi color="sky" label={<>Gross Margin<span className="indicative-tag">Indicative</span></>} value={fmtFull(K.gp)} sub={`${pct1(gm)} margin${gmC != null ? ' · vs ' + pct1(gmC) : ''}`} onClick={() => catProof('Purchases')} />
        <Kpi color="amber" label="OpEx" value={pct1(K.rev ? K.opex / K.rev * 100 : null)} sub={`${fmtFull(K.opex)} · of revenue`} />
        <Kpi color="green" label={<>Result<span className="indicative-tag">Indicative</span></>} value={fmtFull(K.res)} sub={`${pct1(em)} margin${emC != null ? ' · vs ' + pct1(emC) : ''}`} />
        <Kpi color="navy" label="Booked months" value={fmtN(B.months.length)} sub={`Books from ${dLab(X.meta.booksOpening)}`} />
      </div>
      <div className="charts-row">
        <Panel title="P&L Bridge" subtitle={`${B.label} · revenue → cost categories → result`} height={420} className="fin-fixed" style={{ flex: 1.3 }} tableHeaders={wfTable.headers} tableRows={wfTable.rows}><EC option={wfOpt} onEvents={{ click: p => { const s = steps[p.dataIndex]; if (s && s.n !== 'Result') catProof(s.n); } }} /></Panel>
        <Panel title="Margin Health" subtitle="Gross & result margins" tag="Indicative" height={420} className="fin-fixed" style={{ flex: 0.7 }} tableHeaders={['Metric', B.label, 'Comparison']} tableRows={[['Gross margin %', pct1(gm), pct1(gmC)], ['Result margin %', pct1(em), pct1(emC)]]}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', alignItems: 'center', justifyContent: 'center', padding: '8px 12px' }}><Gauge value={gm} label="Gross Margin" py={gmC} /><div style={{ height: 1, background: 'var(--border)', alignSelf: 'stretch' }} /><Gauge value={em} label="Result Margin" py={emC} /></div>
        </Panel>
        <Panel title="Revenue, Costs & Result per Month" subtitle="Booked months in the period" height={420} className="fin-fixed" style={{ flex: 1 }} tableHeaders={['Month', 'Revenue', 'Costs', 'Result']} tableRows={monthly.map(r => [mLong(r.m), fmtFull(r.rev), fmtFull(r.cost), fmtFull(r.res)])}><EC option={resOpt} /></Panel>
      </div>
      <div className="charts-row">
        <Panel title="Category Change vs Comparison" subtitle={B.CC ? `${B.label} vs ${B.cmpLabel} · green = favourable` : 'Needs a comparison inside the books — choose “Previous period”'} height={300} className="fin-fixed" style={{ flex: 1 }} defaultView={B.CC ? 'chart' : 'table'}
          tableHeaders={['Category', B.label, 'Comparison', 'Change €', 'Change %']} tableRows={['Revenue', ...cats].map(c => { const a = B.C.get(c) || 0, b = B.CC?.get(c); return [c, fmtFull(a), b != null ? fmtFull(b) : '—', b != null ? fmtFull(a - b) : '—', b ? fmtPct((a - b) / Math.abs(b) * 100) : '—']; })}>
          {B.CC ? <EC option={mkBarOpt(['Revenue', ...cats], ['Revenue', ...cats].map(c => (B.C.get(c) || 0) - (B.CC.get(c) || 0)), (i, v) => v >= 0 ? '#2E9B62' : '#D95C5C', 120)} /> : <div className="watch-empty">No comparison inside the books for this period.</div>}
        </Panel>
      </div>
    </div>
  );
}

/* ══ Revenue & Costs ══ */
function FinRevCosts({ f }) {
  const B = useBooks(f);
  const all = [...B.A.values()];
  const revL = all.filter(l => l.cat === 'Revenue').sort((a, b) => b.v - a.v);
  const costL = all.filter(l => l.cat !== 'Revenue').map(l => ({ ...l, c: -l.v })).sort((a, b) => b.c - a.c);
  const inc = B.AC ? costL.map(l => ({ ...l, p: -(B.AC.get(l.acct)?.v || 0) })).filter(l => l.c > l.p && l.c > 500).map(l => ({ ...l, d: l.c - l.p })).sort((a, b) => b.d - a.d) : [];
  const rev = B.K.rev;
  const cmpV = (acct, sign = 1) => B.AC ? fmtFull(sign * (B.AC.get(acct)?.v || 0)) : '—';
  const pctTurn = v => rev ? fmtPct(v / rev * 100) : '—';
  const months = B.months, cats = COST_ORDER.filter(c => B.C.get(c));
  const byMC = useMemo(() => { const m = new Map(); for (const r of B.cur) m.set(r[0] + '|' + r[2], (m.get(r[0] + '|' + r[2]) || 0) + r[4] / 100); return m; }, [B]);
  const pctOpt = {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', formatter: p => `<strong>${p[0].axisValue}</strong><br/>` + p.map(i => `${i.marker} ${i.seriesName}: ${pct1(i.value)}`).join('<br/>') },
    legend: { top: 0, textStyle: { color: '#5F7078', fontSize: 9 }, itemWidth: 10, itemHeight: 10, type: 'scroll' },
    grid: { left: 44, right: 20, bottom: 24, top: 34, containLabel: true },
    xAxis: { type: 'category', data: months.map(m => MN[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), axisLabel: catAxisLabel(months.length, 9) },
    yAxis: { type: 'value', axisLabel: { color: '#5F7078', fontSize: 9, formatter: v => v + '%' }, splitLine: { lineStyle: { color: '#F0F3F4' } } },
    series: cats.map((c, i) => ({ name: c, type: 'line', symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] }, itemStyle: { color: PALETTE[i % PALETTE.length] }, data: months.map(m => { const r = byMC.get(m + '|Revenue') || 0; return r ? +(-(byMC.get(m + '|' + c) || 0) / r * 100).toFixed(2) : null; }) })),
  };
  const short = s => s.length > 28 ? s.slice(0, 28) + '…' : s;
  return (
    <div className="page-area fin-scroll" key="finrevcosts">
      <FinNote B={B} />
      <div className="kpi-strip">
        <Kpi color="teal" label="Revenue Accounts" value={fmtN(revL.length)} sub="Active in the books" />
        <Kpi color="navy" label="Cost Accounts" value={fmtN(costL.length)} sub={`${new Set(costL.map(l => l.cat)).size} categories`} />
        <Kpi color="amber" label="Cost Increases" value={B.AC ? fmtN(inc.length) : '—'} sub={B.AC ? 'vs comparison · watch list' : 'Needs a comparison in the books'} />
        <Kpi color="blue" label="Top Revenue" value={short(revL[0]?.acct || '—')} sub={fmtFull(revL[0]?.v || 0)} />
        <Kpi color="red" label="Top Cost" value={short(costL[0]?.acct || '—')} sub={fmtFull(costL[0]?.c || 0)} />
        <Kpi color="sky" label="Purchases / Revenue" value={rev ? pct1(B.K.pur / rev * 100) : '—'} sub={B.KC?.rev ? 'vs ' + pct1(B.KC.pur / B.KC.rev * 100) : 'booked when bought'} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1 }}><Panel title="Top Revenue Accounts" subtitle={`${B.label}, largest first`} height={420} className="fin-fixed" tableHeaders={['Account', 'Amount', 'Comparison', '% of revenue']} tableRows={revL.map(l => [l.acct, fmtFull(l.v), cmpV(l.acct), pctTurn(l.v)])}><EC option={mkBarOpt(revL.slice(0, 10).map(l => l.acct), revL.slice(0, 10).map(l => l.v), () => '#40BCF3')} /></Panel></div>
        <div className="charts-col" style={{ flex: 1 }}><Panel title="Top Cost Accounts" subtitle={`${B.label}, largest first`} height={420} className="fin-fixed" tableHeaders={['Account', 'Category', 'Amount', 'Comparison', '% of revenue']} tableRows={costL.map(l => [l.acct, l.cat, fmtFull(l.c), cmpV(l.acct, -1), pctTurn(l.c)])}><EC option={mkBarOpt(costL.slice(0, 10).map(l => l.acct), costL.slice(0, 10).map(l => l.c), () => '#35A9DE')} /></Panel></div>
        <div className="charts-col" style={{ flex: 1 }}><Panel title="Cost Increases" subtitle={B.AC ? `vs ${B.cmpLabel}` : 'Needs a comparison inside the books'} height={420} className="fin-fixed" tableHeaders={['Account', 'Category', 'Amount', 'Comparison', 'Increase']} tableRows={inc.map(l => [l.acct, l.cat, fmtFull(l.c), fmtFull(l.p), fmtFull(l.d)])}>
          {inc.length ? <EC option={mkBarOpt(inc.slice(0, 10).map(l => l.acct), inc.slice(0, 10).map(l => l.d), () => '#1F3741')} /> : <div className="watch-empty">{B.AC ? 'No cost increases above €500.' : 'Choose “Previous period” to compare inside the books.'}</div>}
        </Panel></div>
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1 }}><Panel title="Cost Categories as % of Revenue" subtitle="Per booked month" height={340} className="fin-fixed" tableHeaders={['Category', ...months.map(m => MN[+m.slice(5) - 1] + ' ' + m.slice(2, 4))]} tableRows={cats.map(c => [c, ...months.map(m => { const r = byMC.get(m + '|Revenue') || 0; return r ? pct1(-(byMC.get(m + '|' + c) || 0) / r * 100) : '—'; })])}><EC option={pctOpt} /></Panel></div>
      </div>
    </div>
  );
}

/* ══ Ledger ══ */
function FinLedger({ f }) {
  const B = useBooks(f);
  const [q, setQ] = useState(''), [cat, setCat] = useState('All');
  const lines = [...B.A.values()];
  const cats = ['All', 'Revenue', ...COST_ORDER.filter(c => lines.some(l => l.cat === c))];
  const filt = lines.filter(l => (cat === 'All' || l.cat === cat) && (!q.trim() || l.acct.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const rev = B.K.rev;
  const newCosts = B.AC ? lines.filter(l => l.cat !== 'Revenue' && l.v < -500 && !B.AC.get(l.acct)).sort((a, b) => a.v - b.v) : [];
  const gone = B.AC ? [...B.AC.values()].filter(l => l.cat === 'Revenue' && l.v > 0 && !(B.A.get(l.acct)?.v)).sort((a, b) => b.v - a.v) : [];
  const head = ['Account', 'Category', B.label, 'Comparison', 'Change €', '% of revenue'];
  const rows = filt.map(l => { const c = B.AC ? (B.AC.get(l.acct)?.v || 0) : null; return [l.acct, l.cat, fmtFull(l.v), c != null ? fmtFull(c) : '—', c != null ? fmtFull(l.v - c) : '—', rev ? fmtPct(Math.abs(l.v) / rev * 100) : '—']; });
  return (
    <div className="page-area fin-scroll" key="finledger">
      <FinNote B={B} />
      <div className="kpi-strip">
        <Kpi color="blue" label="Accounts" value={fmtN(lines.length)} sub="with postings in the period" />
        <Kpi color="teal" label="Showing" value={fmtN(filt.length)} sub="After filter" />
        <Kpi color="amber" label="New Costs" value={B.AC ? fmtN(newCosts.length) : '—'} sub={B.AC ? 'Not in the comparison' : 'Needs a comparison in the books'} />
        <Kpi color="sky" label="Revenue Lost" value={B.AC ? fmtN(gone.length) : '—'} sub={B.AC ? 'Had revenue, now zero' : 'Needs a comparison in the books'} />
      </div>
      <div className="charts-row">
        <div className="charts-col" style={{ flex: 1.8 }}>
          <Panel title="Full Account Ledger" subtitle={`${fmtN(lines.length)} accounts · search & filter`} className="ledger-fixed" height={520} hideToggle>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div className="ledger-toolbar"><input className="ledger-search" placeholder="Search account…" value={q} onChange={e => setQ(e.target.value)} /><span className="ledger-count">{fmtN(filt.length)} / {fmtN(lines.length)}</span></div>
              <div className="ledger-cats">{cats.map(c => <button key={c} className={`filter-chip${cat === c ? ' active' : ''}`} style={{ fontSize: 12, padding: '2px 7px' }} onClick={() => setCat(p => p === c ? 'All' : c)}>{c}</button>)}</div>
              <div style={{ flex: 1, minHeight: 0 }}><InlineTable headers={head} rows={rows} height="100%" /></div>
            </div>
          </Panel>
        </div>
        <div className="charts-col" style={{ flex: 1 }}>
          <Panel title="🆕 New Costs" subtitle={B.AC ? `Not booked in ${B.cmpLabel}` : 'Needs a comparison in the books'} className="hug" hideToggle noZoom>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{!newCosts.length ? <div className="watch-empty">None detected</div> : newCosts.map(l => <div className="watch-row" key={l.acct}><div className="watch-row-desc" title={l.acct}>{l.acct}</div><div className="watch-row-amt">{fmtFull(-l.v)} · {l.cat}</div></div>)}</div>
          </Panel>
          <Panel title="🔻 Revenue Lost" subtitle="Had revenue in the comparison, now zero" className="hug" hideToggle noZoom>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{!gone.length ? <div className="watch-empty">None detected</div> : gone.map(l => <div className="watch-row" key={l.acct}><div className="watch-row-desc" title={l.acct}>{l.acct}</div><div className="watch-row-amt">was {fmtFull(l.v)}</div></div>)}</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   App.jsx
   ══════════════════════════════════════════════════════════════════════ */
/* DairyTop Business Intelligence — app shell.
   Every figure comes from dash.json (src/data/model.js). */
const ICONS = Object.fromEntries(Object.entries(import.meta.glob('./assets/icons/*.png', { eager: true, import: 'default' })).map(([k, v]) => [k.split('/').pop().replace(/^icon-|\.png$/g, ''), v]));

const NAV = [
  { section: 'Overview', items: [{ id: 'overview', icon: '▦', label: 'Dashboard', desc: 'Live KPIs & monthly trend' }, { id: 'revenue', icon: '↗', label: 'Revenue Trends', desc: 'Revenue over time & period comparison' }] },
  { section: 'Performance', items: [{ id: 'salesreps', icon: '◈', label: 'Verkoper', desc: 'Verkoper leaderboard & rankings' }, { id: 'ck-volumes', icon: '▤', label: 'Sales per Verkoper', desc: 'Tonnes and pieces per verkoper and product line' }, { id: 'ck-reorder', icon: '↻', label: 'Reorder Radar', desc: 'Regular buyers who are late to reorder' }, { id: 'customers', icon: '⬡', label: 'Customers', desc: 'Customers by revenue' }] },
  { section: 'Catalogue', items: [{ id: 'products', icon: '◻', label: 'Products', desc: 'Product-level revenue breakdown' }, { id: 'ck-products', icon: '◫', label: 'Products & Prices', desc: 'Product groups, price per kg and mix' }, { id: 'categories', icon: '⊞', label: 'Categories', desc: 'Categories & product groups' }, { id: 'ck-markets', icon: '◎', label: 'Markets', desc: 'Revenue by country' }] },
  { section: 'Channels', items: [{ id: 'channels', icon: '⇌', label: 'Channel Mix', desc: 'Direct sales vs webshop split' }] },
  { section: 'Debtors', items: [{ id: 'ck-receivables', icon: '€', label: 'Receivables', desc: 'Open invoices, ageing and the debtors tie-out' }] },
  { section: 'Finance', items: [{ id: 'plsummary', icon: '⟡', label: 'P&L Summary', desc: 'Margins & result from the books' }, { id: 'finrevcosts', icon: '↕', label: 'Revenue & Costs', desc: 'Revenue vs cost accounts' }, { id: 'finledger', icon: '≣', label: 'Ledger', desc: 'Every account in the books' }] },
];
const PAGE_NAMES = { 'ck-volumes': 'Sales per Verkoper', 'ck-receivables': 'Receivables', 'ck-reorder': 'Reorder Radar', 'ck-products': 'Products & Prices', 'ck-markets': 'Markets', overview: 'Overview Dashboard', revenue: 'Revenue Trends', salesreps: 'Verkoper', customers: 'Customers', products: 'Product Analysis', categories: 'Category Breakdown', channels: 'Channel Mix', plsummary: 'P&L Summary', finrevcosts: 'Revenue & Costs', finledger: 'Ledger' };

const SUGGESTED_QUESTIONS = {
  overview: ['How much have we sold this month so far?', 'What is our open order value?', 'How did the last 3 complete months compare with last year?', 'How much milk powder did we sell this year?'],
  revenue: ['What was our best month?', 'How does this year compare with last year?', 'What is the average monthly revenue?'],
  salesreps: ['Who is the top verkoper?', 'How concentrated is revenue in the top 3 verkopers?', 'Which verkoper sells the most milk powder?'],
  customers: ['Who are our top 5 customers?', 'How many customers bought this year?', 'What share of revenue comes from the top 15 customers?'],
  products: ['What is our best-selling product?', 'Which product groups grow fastest?', 'How many products did we sell?'],
  categories: ['Which category has the biggest share of revenue?', 'How does each product group compare?'],
  channels: ['How is revenue split between webshop and direct?', 'What is the webshop average order value?'],
  'ck-volumes': ['How many tonnes of milk powder did we sell?', 'Who sells the most tonnes?'],
  'ck-receivables': ['How much is still open?', 'How much is overdue more than 30 days?', 'Which customers owe us the most?'],
  'ck-reorder': ['Which customers are late to reorder?', 'How much monthly revenue is at risk?'],
  'ck-products': ['What is the milk powder price per kg?', 'What is the feed price per kg?'],
  'ck-markets': ['Which market is the biggest?', 'What share of revenue is export?'],
  plsummary: ['What is the result in the books?', 'What is the gross margin?'],
  finrevcosts: ['What are our biggest cost accounts?', 'How big are purchases compared with revenue?'],
  finledger: ['What are the biggest cost accounts?', 'How many accounts are in the books?'],
  default: ['What can you tell me about this page?'],
};

const SESSION_TIMEOUT_MS = 30 * 60 * 1000, AUTH_KEY = 'dairytop_auth', AUTH_ACTIVITY_KEY = 'dairytop_auth_activity', AUTH_USER_KEY = 'dairytop_username';
const ZOOM_KEY = 'dairytop_zoom', ZMIN = 0.7, ZMAX = 1.5;
const FINANCE = new Set(['plsummary', 'finrevcosts', 'finledger']);
const IGNORES = {
  'ck-receivables': 'Product group does not apply to receivables',
  'ck-reorder': 'Compare with does not apply to the reorder radar',
  plsummary: 'Books are company-wide: verkoper, group and market filters do not apply',
  finrevcosts: 'Books are company-wide: verkoper, group and market filters do not apply',
  finledger: 'Books are company-wide: verkoper, group and market filters do not apply',
};

function Sidebar({ page, setPage, sideOpen, setSideOpen, setHighlightQuery, stats, handleLogout, localPages }) {
  const [peek, setPeek] = useState(false);
  const collapsed = !peek;
  const [fly, setFly] = useState(null);
  const hover = (e, item) => { if (!collapsed) return; const r = e.currentTarget.getBoundingClientRect(); setFly({ ...item, top: r.top + r.height / 2, left: r.right + 6 }); };
  const goTo = id => { setPage(id); setSideOpen(false); setHighlightQuery(null); };
  return (
    <>
      <div className={`sidebar collapsed${peek ? ' peek' : ''}${sideOpen ? ' open' : ''}`} onMouseEnter={() => { setPeek(true); document.body.classList.add('sb-peek'); }} onMouseLeave={() => { setPeek(false); setFly(null); document.body.classList.remove('sb-peek'); }}>
        <div className="sidebar-inner">
          <div className="sb-logo">
            <div className="sb-brand"><span className="sb-mark">▸</span><span className="sb-brand-text">DairyTop</span></div>
            <div className="sb-tag">Business Intelligence</div>
          </div>
          <nav className="nav">
            {NAV.map((s, i) => (
              <div key={i}>
                {i > 0 && <div className="nav-divider" />}
                <div className="nav-section">{s.section}</div>
                {s.items.map(item => (
                  <div key={item.id} className={`nav-item${page === item.id ? ' active' : ''}${fly?.id === item.id ? ' hovered' : ''}`} onClick={() => goTo(item.id)}
                    onMouseEnter={e => hover(e, item)} onMouseLeave={() => setFly(null)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && goTo(item.id)}>
                    <span className="nav-icon">{ICONS[item.id] ? <img src={ICONS[item.id]} alt={item.label} draggable="false" /> : item.icon}</span>
                    <span className="nav-label">{item.label}{localPages.includes(item.id) && <span className="nav-local" title="This page uses its own filters">●</span>}</span>
                    {page === item.id && <span className="nav-pip" />}
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-footer-stats" style={{ marginBottom: 8 }}>
              <div className="stat-row"><span className="stat-lbl">Period</span><span className="stat-val">{stats.period}</span></div>
              <div className="stat-row"><span className="stat-lbl">Invoices</span><span className="stat-val">{stats.invoices}</span></div>
              <div className="stat-row"><span className="stat-lbl">Customers</span><span className="stat-val">{stats.customers}</span></div>
            </div>
            <button className="logout-btn" onClick={handleLogout} title={collapsed ? 'Sign out' : undefined}><span>↩</span><span className="logout-btn-label"> Sign out</span></button>
          </div>
        </div>
      </div>
      {fly && createPortal(
        <div className="nav-flyout" style={{ top: fly.top, left: fly.left, transform: 'translateY(-50%)' }}>
          <span className="nav-flyout-badge">{fly.icon}</span>
          <span className="nav-flyout-text"><span className="nav-flyout-title">{fly.label}</span>{fly.desc && <span className="nav-flyout-desc">{fly.desc}</span>}</span>
          <span className="nav-flyout-chevron">›</span>
        </div>, document.body)}
    </>
  );
}

function PageZoom({ z, setZ }) {
  const step = d => setZ(v => Math.min(ZMAX, Math.max(ZMIN, Math.round((v + d) * 10) / 10)));
  return (
    <div className="tb-zoom" role="group" aria-label="Page zoom">
      <button onClick={() => step(-0.1)} disabled={z <= ZMIN} title="Zoom out (whole page)" aria-label="Zoom out"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="6.8" cy="6.8" r="4.8" /><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4" /></svg></button>
      <button className="tb-zoom-val" onClick={() => setZ(1)} title="Reset to 100%">{Math.round(z * 100)}%</button>
      <button onClick={() => step(0.1)} disabled={z >= ZMAX} title="Zoom in (whole page)" aria-label="Zoom in"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="6.8" cy="6.8" r="4.8" /><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4M6.8 4.6v4.4" /></svg></button>
    </div>
  );
}

function Shell({ userName, handleLogout }) {
  const [page, setPage] = useState(() => sessionStorage.getItem('dairytop_last_page') || 'overview');
  const PF = usePageFilter(page);
  const { f, setF } = PF;
  const [sideOpen, setSideOpen] = useState(false);
  const [z, setZ] = useState(() => { const v = parseFloat(localStorage.getItem(ZOOM_KEY)); return v >= ZMIN && v <= ZMAX ? v : 1; });
  useEffect(() => {
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* ignore */ }
    document.documentElement.style.setProperty('--chat-text-zoom', String(1 + (z - 1) * 0.5));
    const t = setTimeout(() => liveChartInstances.forEach(i => { try { i.resize(); } catch { /* ignore */ } }), 80);
    return () => clearTimeout(t);
  }, [z]);
  useEffect(() => { sessionStorage.setItem('dairytop_last_page', page); }, [page]);
  useEffect(() => {
    const go = () => liveChartInstances.forEach(i => { try { i.resize(); } catch { /* ignore */ } });
    const ts = [60, 200, 400, 800].map(ms => setTimeout(go, ms));
    window.addEventListener('resize', go);
    return () => { ts.forEach(clearTimeout); window.removeEventListener('resize', go); };
  }, [page, f]);
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 15000); return () => clearInterval(t); }, []);

  /* search box: customers, products, verkopers, categories */
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [hl, setHl] = useState(null);
  const index = useMemo(() => [
    ...X.customers.map(c => ({ name: c[0], type: 'Customer', page: 'customers' })),
    ...[...new Set(X.products.map(p => p[0]))].map(n => ({ name: n, type: 'Product', page: 'products' })),
    ...X.reps.map(n => ({ name: n, type: 'Verkoper', page: 'salesreps' })),
    ...X.categories.map(c => ({ name: c[0], type: 'Category', page: 'categories' })),
  ], []);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return [['Customer', 'Customers', 'customers'], ['Product', 'Products', 'products'], ['Verkoper', 'Verkopers', 'salesreps'], ['Category', 'Categories', 'categories']]
      .map(([t, l, p]) => { const m = index.filter(i => i.type === t && i.name.toLowerCase().includes(s)); return { type: t, label: l, page: p, items: m.slice(0, 6), total: m.length }; }).filter(g => g.items.length);
  }, [q, index]);
  const sRef = useRef(null), rRef = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => { if (open && q.trim() && sRef.current) { const r = sRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), width: Math.max(r.width, 300) }); } }, [open, q, groups.length]);
  useEffect(() => { const h = e => { if (sRef.current?.contains(e.target) || rRef.current?.contains(e.target)) return; setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const goResult = r => { setPage(r.page); setHl(r.name); setQ(r.name); setOpen(false); };

  const P = period(f);
  const stats = useMemo(() => ({ period: `${X.mLabel[f.from]} – ${X.mLabel[f.to]}`, invoices: invoices(f, P.months.filter(m => !X.isPortalM[m])).length.toLocaleString('de-DE'), customers: (f.reps.length || f.mkts.length ? X.customers.filter(c => (!f.reps.length || f.reps.includes(c[2])) && (!f.mkts.length || f.mkts.includes(c[1]))).length : totals.customers).toLocaleString('de-DE') }), [f, P]);
  const live = liveMonth();
  const isOv = page === 'overview';
  const props = { f, setF, highlightQuery: hl, page };
  const render = () => {
    switch (page) {
      case 'overview': return <Overview />;
      case 'revenue': return <Revenue {...props} />;
      case 'salesreps': return <SalesReps {...props} />;
      case 'customers': return <Customers {...props} />;
      case 'products': return <Products {...props} />;
      case 'categories': return <Categories {...props} />;
      case 'channels': return <Channels {...props} />;
      case 'ck-volumes': return <Volumes {...props} />;
      case 'ck-receivables': return <Receivables {...props} />;
      case 'ck-reorder': return <Reorder {...props} />;
      case 'ck-products': return <ProductsPrice {...props} />;
      case 'ck-markets': return <Markets {...props} />;
      case 'plsummary': return <PLSummary {...props} />;
      case 'finrevcosts': return <FinRevCosts {...props} />;
      case 'finledger': return <FinLedger {...props} />;
      default: return <Overview />;
    }
  };

  return (
    <>
      <div className={`zoom-root${z > 1 ? ' zoomed' : ''}`} style={z !== 1 ? { transform: `scale(${z})`, width: `${100 / z}%`, height: `${100 / z}%` } : undefined}>
        <div className="app">
          <button className="mob-toggle" onClick={() => setSideOpen(v => !v)} aria-label="Menu">{sideOpen ? '✕' : '☰'}</button>
          <div className={`mob-overlay${sideOpen ? ' open' : ''}`} onClick={() => setSideOpen(false)} />
          <Sidebar page={page} setPage={setPage} sideOpen={sideOpen} setSideOpen={setSideOpen} setHighlightQuery={setHl} stats={stats} handleLogout={handleLogout} localPages={PF.localPages} />
          <div className="main">
            <div className={`topbar${isOv ? ' topbar-overview' : ''}`}>
              <div className="tb-row1">
                <div className="tb-titlewrap">
                  <div className="tb-title">{PAGE_NAMES[page]}</div>
                  <div className="tb-sub">
                    {isOv ? <span>Live view · Current month ({live.label}{live.day ? `, to ${live.day}` : ''}) · not affected by filters</span>
                      : <><span>{P.label}</span>{P.cmp && <><span className="tb-sep">·</span><span>vs {P.cmpLabel}</span></>}<span className="tb-sep">·</span><span>{f.grps.length ? f.grps.join(', ') : 'All products'}</span></>}
                  </div>
                </div>
                <div className="tb-right">
                  {isOv && <PageZoom z={z} setZ={setZ} />}
                  <button className="tb-print-btn" onClick={() => window.print()} title="Export this page as a PDF via your browser's print dialog">⬇ Export</button>
                  <div className="live-badge" title={`Data snapshot ${X.snapshotLabel} · last invoice ${X.ledgerLabel}`}><span className="blink-dot" /><span className="tb-time-in">{time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span><span className="tb-snap">Last Update · {X.snapshotLabel}</span></div>
                </div>
              </div>
              {!isOv && (
                <div className="tb-search" ref={sRef}>
                  <span className="tb-search-icon">🔍</span>
                  <input type="text" placeholder="Find a customer, product, verkoper…" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
                    onKeyDown={e => { if (e.key === 'Enter' && groups[0]?.items[0]) goResult(groups[0].items[0]); if (e.key === 'Escape') setOpen(false); }} aria-label="Global search" />
                  {open && q.trim() && pos && createPortal(
                    <div ref={rRef} className="tb-search-results" style={{ top: pos.top, right: pos.right, width: pos.width }}>
                      {!groups.length ? <div className="tb-search-empty">No matches in customers, products, verkopers or categories</div> : groups.map(g => (
                        <div key={g.type} className="tb-search-group">
                          <div className="tb-search-group-head"><span><strong>{g.label}</strong> ({g.total})</span><span className="tb-search-group-dest">→ {PAGE_NAMES[g.page]}</span></div>
                          {g.items.map((r, i) => <div key={i} className="tb-search-item" onClick={() => goResult(r)}><span className="tb-search-item-name" title={r.name}>{r.name}</span><span className="tb-search-item-arrow">→</span></div>)}
                        </div>))}
                    </div>, document.body)}
                </div>
              )}
            </div>
            {!isOv && <FilterBar f={f} setF={setF} corner={<PageZoom z={z} setZ={setZ} />} resetAll={PF.resetAll} ignores={IGNORES[page]} grainUsed={!FINANCE.has(page)} />}
            {render()}
          </div>
          <ScrollHint watchKey={page} disabled={sideOpen} />
        </div>
      </div>
      <ChatBot liveData={DASH} context={{ page, pageName: PAGE_NAMES[page], filterLabel: P.label, dateRange: P.label }} suggestedQuestions={SUGGESTED_QUESTIONS[page] || SUGGESTED_QUESTIONS.default} userName={formatDisplayName(userName)} />
    </>
  );
}

export default function App() {
  const [showWelcome, setShowWelcome] = useState(false);
  const finishWelcome = useCallback(() => setShowWelcome(false), []);
  const [userName, setUserName] = useState(() => { try { return localStorage.getItem(AUTH_USER_KEY) || ''; } catch { return ''; } });
  const [authed, setAuthed] = useState(() => {
    const a = localStorage.getItem(AUTH_KEY), t = localStorage.getItem(AUTH_ACTIVITY_KEY);
    if (a === 'true' && t && Date.now() - parseInt(t, 10) < SESSION_TIMEOUT_MS) return true;
    localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ACTIVITY_KEY); return false;
  });
  useEffect(() => {
    if (!authed) return;
    let last = 0;
    const mark = () => { const n = Date.now(); if (n - last < 5000) return; last = n; localStorage.setItem(AUTH_ACTIVITY_KEY, String(n)); };
    mark();
    const ev = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'click'];
    ev.forEach(e => window.addEventListener(e, mark, { passive: true }));
    const iv = setInterval(() => { const t = localStorage.getItem(AUTH_ACTIVITY_KEY); if (t && Date.now() - parseInt(t, 10) >= SESSION_TIMEOUT_MS) { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ACTIVITY_KEY); setAuthed(false); } }, 10000);
    return () => { ev.forEach(e => window.removeEventListener(e, mark)); clearInterval(iv); };
  }, [authed]);
  const handleLogin = u => { setShowWelcome(true); setAuthed(true); localStorage.setItem(AUTH_KEY, 'true'); localStorage.setItem(AUTH_ACTIVITY_KEY, String(Date.now())); setUserName(u || ''); try { localStorage.setItem(AUTH_USER_KEY, u || ''); } catch { /* ignore */ } };
  const handleLogout = () => { setAuthed(false); localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_ACTIVITY_KEY); localStorage.removeItem(AUTH_USER_KEY); setUserName(''); };
  const style = <style>{css + TYPO_CSS + EXTRA_CSS}</style>;
  if (!authed) return <>{style}<Login onLogin={handleLogin} /></>;
  if (showWelcome) return <>{style}<DashboardWelcome userName={userName} onComplete={finishWelcome} /></>;
  return (
    <>
      {style}
      <FilterProvider><ProofProvider><Shell userName={userName} handleLogout={handleLogout} /></ProofProvider></FilterProvider>
    </>
  );
}

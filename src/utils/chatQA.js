/* ══════════════════════════════════════════════════════════════════════
   DairyTop assistant: local question bank + answer engine
   ----------------------------------------------------------------------
   • No free text, no AI, no network: every question is chosen from a list
     and answered in the browser from the same data the dashboard uses.
   • Future-proof: periods, customers, verkopers, products, markets and
     groups are picked from the data each time it loads (largest first),
     so new customers or reps appear automatically and leavers drop out.
   • Bilingual: every question and answer exists in English and Dutch.
   ══════════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const GROUPS = ['Milk powder', 'Feed', 'Calf housing', 'Calf supplies', 'Perfect Udder', 'Other'];
const GROUP_NL = { 'Milk powder': 'Melkpoeder', Feed: 'Voer', 'Calf housing': 'Kalverhuisvesting', 'Calf supplies': 'Kalverbenodigdheden', 'Perfect Udder': 'Perfect Udder', Other: 'Overig' };
const COSTGRP_NL = { Purchases: 'Inkopen', Transport: 'Transport', Personnel: 'Personeel', 'Office & admin': 'Kantoor & administratie', 'Sales & marketing': 'Verkoop & marketing', Housing: 'Huisvesting', 'Finance & tax': 'Financieel & belasting', Other: 'Overig' };
const MKT_NL = { Germany: 'Duitsland', Netherlands: 'Nederland', Belgium: 'België', Hungary: 'Hongarije', Austria: 'Oostenrijk', Switzerland: 'Zwitserland', Denmark: 'Denemarken', Luxembourgh: 'Luxemburg', Luxembourg: 'Luxemburg', France: 'Frankrijk', Poland: 'Polen', 'Czech Republic': 'Tsjechië', Italy: 'Italië', Spain: 'Spanje', 'United Kingdom': 'Verenigd Koninkrijk', Sweden: 'Zweden', Norway: 'Noorwegen', Ireland: 'Ierland' };
const MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], nl: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] };
const MONL = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'] };
const AGES = ['Current', '1–30', '31–60', '61–90', '91+'];
const AGE_LBL = { en: { Current: 'Not yet due', '1–30': '1–30 days late', '31–60': '31–60 days late', '61–90': '61–90 days late', '91+': '91+ days late' }, nl: { Current: 'Nog niet vervallen', '1–30': '1–30 dagen te laat', '31–60': '31–60 dagen te laat', '61–90': '61–90 dagen te laat', '91+': '91+ dagen te laat' } };

export const TILES = [
  { id: 'overview',   icon: 'grid',    en: 'Overview & Turnover',   nl: 'Overzicht & Omzet',          sub: { en: 'Turnover, trends, highlights', nl: 'Omzet, trends, hoogtepunten' } },
  { id: 'verkopers',  icon: 'users',   en: 'Verkopers',              nl: 'Verkopers',                  sub: { en: 'Per salesperson', nl: 'Per verkoper' } },
  { id: 'customers',  icon: 'user',    en: 'Customers',              nl: 'Klanten',                    sub: { en: 'Top, new and quiet customers', nl: 'Top, nieuwe en stille klanten' } },
  { id: 'products',   icon: 'box',     en: 'Products & Prices',      nl: 'Producten & Prijzen',        sub: { en: 'Best sellers, volumes, prices', nl: 'Bestsellers, volumes, prijzen' } },
  { id: 'categories', icon: 'layers',  en: 'Product groups',         nl: 'Productgroepen',             sub: { en: 'Milk powder, feed, housing …', nl: 'Melkpoeder, voer, huisvesting …' } },
  { id: 'markets',    icon: 'globe',   en: 'Markets & Channels',     nl: 'Markten & Kanalen',          sub: { en: 'Countries, webshop vs direct', nl: 'Landen, webshop vs direct' } },
  { id: 'receivables',icon: 'wallet',  en: 'Receivables',            nl: 'Debiteuren',                 sub: { en: 'Open, overdue, who owes what', nl: 'Open, te laat, wie wat schuldig is' } },
  { id: 'finance',    icon: 'chart',   en: 'Finance (P&L)',          nl: 'Financiën (W&V)',            sub: { en: 'Revenue, costs, result', nl: 'Omzet, kosten, resultaat' } },
  { id: 'orders',     icon: 'truck',   en: 'Orders & Data',          nl: 'Orders & Gegevens',          sub: { en: 'Open orders, data dates, rules', nl: 'Open orders, datums, regels' } },
];

/* ── formatting ───────────────────────────────────────────────────────── */
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => (v < 0 ? '−€' : '€') + (Math.abs(v) >= 1000 ? nf0 : nf2).format(Math.abs(v));
const num = v => nf0.format(v);
const tons = kg => nf1.format(kg / 1000) + ' t';
const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v)) + '%';
const share = (v, t) => (t ? nf1.format(v / t * 100) : '0,0') + '%';
const dLong = (iso, L) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[L][m - 1]} ${y}`; };
const mLabel = (iso, L) => { const [y, m] = iso.split('-').map(Number); return `${MON[L][m - 1]} ${y}`; };
const mLong = (iso, L) => { const [y, m] = iso.split('-').map(Number); return `${MONL[L][m - 1]} ${y}`; };
const isoOfT = t => new Date(t * DAY).toISOString().slice(0, 10);
const grpName = (g, L) => L === 'nl' ? (GROUP_NL[g] || g) : g;
const mktName = (m, L) => L === 'nl' ? (MKT_NL[m] || m) : m;
const list = rows => rows.length ? rows.map((r, i) => `${i + 1}. ${r}`).join('\n') : '—';
const T = (L, en, nl) => (L === 'nl' ? nl : en);

/* ── context built once per data load ────────────────────────────────── */
let _ctx = null, _ctxFor = null;
function context(M) {
  const X = M && M.X;
  if (!X || !X.facts) return null;
  if (_ctx && _ctxFor === X) return _ctx;
  const F = X.facts, n = F.r.length, nM = X.months.length;
  const byM = Array.from({ length: nM }, () => []);
  for (let i = 0; i < n; i++) byM[F.m[i]].push(i);
  const lt = X.meta.ledgerThrough, cur = nM - 1, curIso = X.months[cur];
  const dim = new Date(Date.UTC(+curIso.slice(0, 4), +curIso.slice(5), 0)).getUTCDate();
  const partialDay = lt.slice(0, 7) === curIso && +lt.slice(8) < dim ? +lt.slice(8) : null;
  const year = +curIso.slice(0, 4);
  const idxYear = y => X.months.map((m, i) => (+m.slice(0, 4) === y ? i : -1)).filter(i => i >= 0);
  const lastFull = partialDay ? cur - 1 : cur;
  const ytd = idxYear(year), py = idxYear(year - 1);
  const ytdc = ytd.filter(i => i <= lastFull);
  const pyc = py.filter(i => ytdc.some(j => X.months[j].slice(5) === X.months[i].slice(5)));
  const ltT = Date.UTC(+lt.slice(0, 4), +lt.slice(5, 7) - 1, +lt.slice(8)) / DAY;
  const mkts = X.mkts || [...new Set(X.customers.map(c => c[1]))].sort();
  const cMkt = X.cMkt || X.customers.map(c => mkts.indexOf(c[1]));
  const G = F.G || F.g.map(g => { const k = GROUPS.indexOf(X.categories[g] && X.categories[g][1]); return k < 0 ? 5 : k; });
  // kg-products (sold by weight)
  const kgProd = X.kgProd || new Set(F.p.filter((_, i) => F.k[i] > 0));
  // day serial per fact (Microfas months only)
  const Tday = F.T || F.d.map((d, i) => (d ? Date.UTC(+X.months[F.m[i]].slice(0, 4), +X.months[F.m[i]].slice(5) - 1, d) / DAY : null));
  _ctx = { X, F, n, byM, cur, curIso, partialDay, year, lastFull, ytd, py, ytdc, pyc, lt, ltT, mkts, cMkt, G, kgProd, Tday, M };
  _ctxFor = X;
  return _ctx;
}

/* periods: list of month indexes + label */
function period(C, key, L) {
  const X = C.X, cur = C.cur;
  const P = {
    mtd: () => ({ ms: [cur], label: C.partialDay ? T(L, `${mLong(C.curIso, L)} so far (1–${C.partialDay})`, `${mLong(C.curIso, L)} tot nu (1–${C.partialDay})`) : mLong(C.curIso, L) }),
    lm: () => { const i = C.partialDay ? cur - 1 : cur - 1; return { ms: [i], label: mLong(X.months[i], L) }; },
    ytd: () => ({ ms: C.ytd, label: T(L, `${C.year} so far`, `${C.year} tot nu`) }),
    py: () => ({ ms: C.py, label: String(C.year - 1) }),
  };
  return P[key]();
}
const facts = (C, ms, pred) => { const out = []; for (const m of ms) for (const i of C.byM[m]) if (!pred || pred(i)) out.push(i); return out; };
const sumR = (C, ix) => ix.reduce((s, i) => s + C.F.r[i], 0) / 100;
const sumK = (C, ix) => ix.reduce((s, i) => s + (C.F.k[i] || 0), 0);
function rank(C, ix, keyFn, nameFn, top = 5, val = i => C.F.r[i] / 100) {
  const m = new Map();
  for (const i of ix) { const k = keyFn(i); m.set(k, (m.get(k) || 0) + val(i)); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ k, name: nameFn(k), v }));
}
const footer = (C, L, extra) => '\n\n' + T(L, `Excl. VAT · data through ${dLong(C.lt, L)}`, `Excl. btw · gegevens t/m ${dLong(C.lt, L)}`) + (extra ? ` · ${extra}` : '');
const portalNote = (C, ms, L) => ms.some(m => C.X.meta.portalMonths.includes(C.X.months[m])) ? T(L, 'Jan 2025 – Mar 2026 come from the Portal export (monthly totals).', 'jan 2025 – mrt 2026 komen uit de Portal-export (maandtotalen).') : '';

/* ── entity helpers (picked from the data, largest first) ────────────── */
function topEntities(C, keyFn, n, ms = C.ytd) {
  const m = new Map();
  for (const mm of ms) for (const i of C.byM[mm]) { const k = keyFn(i); m.set(k, (m.get(k) || 0) + C.F.r[i]); }
  return [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
const custName = (C, c) => C.X.customers[c] ? C.X.customers[c][0] : '?';
const prodName = (C, p) => C.X.products[p] ? C.X.products[p][0] : '?';
const repName = (C, v) => C.X.verkopers[v] || '?';

/* ── receivables helpers ─────────────────────────────────────────────── */
function arRows(C, pred) { return (C.X.ar || []).filter(a => !pred || pred(a)); }
function arSum(rows) {
  let open = 0, credit = 0, nOpen = 0, over = 0, over30 = 0; const byAge = Object.fromEntries(AGES.map(a => [a, 0]));
  for (const a of rows) { const b = a[6] / 100; if (b > 0) { open += b; nOpen++; byAge[a[7]] = (byAge[a[7]] || 0) + b; if (a[7] !== 'Current') over += b; if (a[7] !== 'Current' && a[7] !== '1–30') over30 += b; } else if (b < 0) credit += b; }
  return { open, credit, net: open + credit, nOpen, over, over30, byAge };
}
const arNote = (C, L) => T(L, `Invoices from ${dLong(C.X.meta.arStart, L)} onwards`, `Facturen vanaf ${dLong(C.X.meta.arStart, L)}`);

/* ── orders helpers ──────────────────────────────────────────────────── */
function orderLines(C, pred) {
  const X = C.X, sg = new Map((X.orders || []).filter(o => o[5]).map(o => [o[0], o]));
  const out = [];
  for (const l of X.openLines || []) {
    const o = sg.get(l[0]); if (!o) continue; const g = o[12];
    if (g !== 'toDeliver' && g !== 'deliveredNotInvoiced') continue;
    if (pred && !pred(o)) continue;
    const priced = !!l[11], vd = priced ? l[10] / 100 : 0, vr = priced ? Math.max(0, l[9] - l[10]) / 100 : 0;
    out.push({ l, o, g, priced, vd, vr, v: vd + vr });
  }
  return out;
}
function ordersStale(C, L) {
  const last = (C.X.orders || []).reduce((m, o) => (o[1] > m ? o[1] : m), '');
  if (!last) return T(L, 'No order data in the export.', 'Geen ordergegevens in de export.');
  const days = Math.round((C.ltT - Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8)) / DAY));
  return days > 7 ? '\n⚠ ' + T(L, `The order data in the Microfas export was last updated with orders from ${dLong(last, L)}; newer orders are missing until Microfas fixes the export.`, `De ordergegevens in de Microfas-export bevatten orders t/m ${dLong(last, L)}; nieuwere orders ontbreken tot Microfas de export herstelt.`) : '';
}
const stageNm = (g, L) => ({ toDeliver: T(L, 'still to deliver', 'nog te leveren'), deliveredNotInvoiced: T(L, 'delivered, not invoiced', 'geleverd, niet gefactureerd') }[g] || g);

/* ── P&L helpers ─────────────────────────────────────────────────────── */
function pnlPeriod(C, key, L) {
  const books = C.X.meta.booksOpening.slice(0, 7), months = [...new Set((C.X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort();
  const curM = C.curIso, full = months.filter(m => m < curM || !C.partialDay);
  const q = m => Math.ceil(+m.slice(5) / 3), y = m => m.slice(0, 4);
  if (key === 'lm') { const m = full.filter(x => x < curM).at(-1) || full.at(-1); return { ms: [m], label: mLong(m, L) }; }
  if (key === 'ytd') { const ms = months.filter(m => y(m) === String(C.year)); return { ms, label: T(L, `${C.year} so far (books from ${mLabel(books, L)})`, `${C.year} tot nu (boeken vanaf ${mLabel(books, L)})`) }; }
  if (key === 'lq') { const lastQ = full.filter(m => q(m) !== q(curM) || y(m) !== y(curM)).at(-1); if (!lastQ) return { ms: [], label: '—' }; const ms = full.filter(m => y(m) === y(lastQ) && q(m) === q(lastQ)); return { ms, label: `Q${q(lastQ)} ${y(lastQ)}` }; }
  if (key === 'cq') { const ms = months.filter(m => y(m) === y(curM) && q(m) === q(curM)); return { ms, label: T(L, `Q${q(curM)} ${y(curM)} so far`, `Q${q(curM)} ${y(curM)} tot nu`) }; }
}
function pnlTotals(C, ms) {
  const rows = (C.X.pnl || []).filter(r => ms.includes(r[0]));
  let rev = 0, pur = 0, other = 0; const groups = new Map(), accts = new Map();
  for (const r of rows) {
    const v = r[4] / 100;
    if (r[2] === 'Revenue') rev += v;
    else { if (r[2] === 'Purchases') pur += -v; else other += -v; groups.set(r[2], (groups.get(r[2]) || 0) - v); accts.set(r[1], (accts.get(r[1]) || 0) - v); }
  }
  return { rows, rev, pur, other, gross: rev - pur, result: rev - pur - other, groups, accts };
}
const pnlNote = L => T(L, 'Purchases are booked when bought, not when sold, so the result is indicative.', 'Inkopen worden geboekt bij inkoop, niet bij verkoop; het resultaat is daarom indicatief.');

/* ══════════════════════════════════════════════════════════════════════
   Question builders. Each returns { id, tile, g (group key for follow-ups),
   q: L => text, a: L => answer }.
   ══════════════════════════════════════════════════════════════════════ */
function buildAll(C) {
  const Q = [];
  const add = (tile, g, id, q, a) => Q.push({ id: `${tile}.${id}`, tile, g, q, a });
  const X = C.X, F = C.F;
  const per = k => L => period(C, k, L);
  const PER = ['mtd', 'lm', 'ytd', 'py'];
  const perTxt = { mtd: ['this month', 'deze maand'], lm: ['last month', 'vorige maand'], ytd: ['this year', 'dit jaar'], py: ['last year', 'vorig jaar'] };

  /* ───────────── Overview & Turnover ───────────── */
  for (const k of PER) add('overview', 'rev', `rev.${k}`,
    L => T(L, `What is our turnover ${perTxt[k][0]}?`, `Wat is onze omzet ${perTxt[k][1]}?`),
    L => { const p = per(k)(L), ix = facts(C, p.ms); return `**${eur(sumR(C, ix))}**\n${T(L, 'Turnover', 'Omzet')} · ${p.label}` + footer(C, L, portalNote(C, p.ms, L)); });
  add('overview', 'cmp', 'yoy', L => T(L, 'How does this year compare with last year?', 'Hoe verhoudt dit jaar zich tot vorig jaar?'), L => {
    const a = sumR(C, facts(C, C.ytdc)), b = sumR(C, facts(C, C.pyc));
    const rng = C.ytdc.length ? `${MON[L][+X.months[C.ytdc[0]].slice(5) - 1]}–${MON[L][+X.months[C.ytdc.at(-1)].slice(5) - 1]}` : '—';
    return `**${b ? pct((a - b) / Math.abs(b) * 100) : '—'}**\n${rng} ${C.year}: ${eur(a)}\n${rng} ${C.year - 1}: ${eur(b)}\n${T(L, 'Difference', 'Verschil')}: ${eur(a - b)}\n\n${T(L, 'Complete months only, so the comparison is like-for-like.', 'Alleen volledige maanden, zodat de vergelijking eerlijk is.')}` + footer(C, L);
  });
  add('overview', 'cmp', 'mtdlm', L => T(L, 'Is this month ahead of last month at the same point?', 'Loopt deze maand voor op vorige maand op hetzelfde moment?'), L => {
    const day = C.partialDay || 31, a = sumR(C, facts(C, [C.cur])), b = sumR(C, facts(C, [C.cur - 1], i => !F.d[i] || F.d[i] <= day));
    const portal = X.meta.portalMonths.includes(X.months[C.cur - 1]);
    if (portal) return T(L, 'Last month has no daily detail, so a same-day comparison is not possible.', 'Vorige maand heeft geen dagdetail; een vergelijking op dezelfde dag kan niet.') + footer(C, L);
    return `**${b ? pct((a - b) / Math.abs(b) * 100) : '—'}**\n${mLabel(C.curIso, L)} 1–${day}: ${eur(a)}\n${mLabel(X.months[C.cur - 1], L)} 1–${day}: ${eur(b)}` + footer(C, L);
  });
  add('overview', 'cmp', 'lmly', L => T(L, 'How did last month compare with the same month last year?', 'Hoe was vorige maand vergeleken met dezelfde maand vorig jaar?'), L => {
    const m = C.cur - 1, iso = X.months[m], prev = X.months.indexOf(`${+iso.slice(0, 4) - 1}${iso.slice(4)}`);
    if (prev < 0) return T(L, 'No data for the same month last year.', 'Geen gegevens voor dezelfde maand vorig jaar.') + footer(C, L);
    const a = sumR(C, facts(C, [m])), b = sumR(C, facts(C, [prev]));
    return `**${pct((a - b) / Math.abs(b) * 100)}**\n${mLabel(iso, L)}: ${eur(a)}\n${mLabel(X.months[prev], L)}: ${eur(b)}` + footer(C, L);
  });
  add('overview', 'trend', 'monthly', L => T(L, 'Show turnover per month this year', 'Toon de omzet per maand dit jaar'), L => {
    const rows = C.ytd.map(m => `${mLabel(X.months[m], L)}: ${eur(sumR(C, facts(C, [m])))}${m === C.cur && C.partialDay ? T(L, ' (so far)', ' (tot nu)') : ''}`);
    return rows.join('\n') + `\n\n**${T(L, 'Total', 'Totaal')}: ${eur(sumR(C, facts(C, C.ytd)))}**` + footer(C, L, portalNote(C, C.ytd, L));
  });
  add('overview', 'trend', 'best', L => T(L, 'Which was our best month this year?', 'Wat was onze beste maand dit jaar?'), L => {
    const r = C.ytdc.map(m => [m, sumR(C, facts(C, [m]))]).sort((a, b) => b[1] - a[1]);
    if (!r.length) return '—';
    return `**${mLong(X.months[r[0][0]], L)}: ${eur(r[0][1])}**\n${T(L, 'Weakest', 'Zwakste')}: ${mLong(X.months[r.at(-1)[0]], L)} (${eur(r.at(-1)[1])})\n${T(L, 'Average per month', 'Gemiddeld per maand')}: ${eur(r.reduce((s, x) => s + x[1], 0) / r.length)}` + footer(C, L, T(L, 'complete months', 'volledige maanden'));
  });
  add('overview', 'trend', 'weeks', L => T(L, 'Show turnover per week for the last 8 weeks', 'Toon de omzet per week voor de laatste 8 weken'), L => {
    const wk = new Map();
    for (let i = 0; i < C.n; i++) { const t = C.Tday[i]; if (t == null || t > C.ltT || t < C.ltT - 62) continue; const d = new Date(t * DAY), mon = t - ((d.getUTCDay() + 6) % 7); wk.set(mon, (wk.get(mon) || 0) + F.r[i] / 100); }
    const rows = [...wk].sort((a, b) => a[0] - b[0]).slice(-8).map(([mon, v]) => { const s = isoOfT(mon), e = isoOfT(Math.min(mon + 6, C.ltT)); return `${dLong(s, L).replace(/ \d{4}$/, '')} – ${dLong(e, L).replace(/ \d{4}$/, '')}: ${eur(v)}`; });
    return rows.join('\n') + '\n\n' + T(L, 'Weeks run Monday to Sunday; the last week may still be running.', 'Weken lopen van maandag t/m zondag; de laatste week kan nog lopen.') + footer(C, L);
  });
  add('overview', 'trend', 'bestday', L => T(L, 'Which day this month had the highest turnover?', 'Welke dag deze maand had de hoogste omzet?'), L => {
    const by = new Map(); for (const i of C.byM[C.cur]) if (F.d[i]) by.set(F.d[i], (by.get(F.d[i]) || 0) + F.r[i] / 100);
    const r = [...by].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return r.length ? `**${r[0][0]} ${MONL[L][+C.curIso.slice(5) - 1]}: ${eur(r[0][1])}**\n` + list(r.slice(1).map(([d, v]) => `${d} ${MON[L][+C.curIso.slice(5) - 1]}: ${eur(v)}`)) + footer(C, L) : '—';
  });
  for (const k of ['mtd', 'ytd']) {
    add('overview', 'top', `topc.${k}`, L => T(L, `Who are our top 10 customers ${perTxt[k][0]}?`, `Wie zijn onze top 10 klanten ${perTxt[k][1]}?`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
    add('overview', 'top', `topp.${k}`, L => T(L, `What are our top 10 products ${perTxt[k][0]}?`, `Wat zijn onze top 10 producten ${perTxt[k][1]}?`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => F.p[i], q => prodName(C, q), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  }
  add('overview', 'mix', 'groups', L => T(L, 'How is turnover split by product group this year?', 'Hoe is de omzet verdeeld over productgroepen dit jaar?'), L => { const ix = facts(C, C.ytd), t = sumR(C, ix); return list(rank(C, ix, i => C.G[i], g => grpName(GROUPS[g], L), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('overview', 'mix', 'reps', L => T(L, 'How much did each verkoper sell this year?', 'Hoeveel heeft elke verkoper dit jaar verkocht?'), L => { const ix = facts(C, C.ytd), t = sumR(C, ix); return list(rank(C, ix, i => F.v[i], v => repName(C, v), 30).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('overview', 'mix', 'markets', L => T(L, 'How much did we sell per country this year?', 'Hoeveel hebben we per land verkocht dit jaar?'), L => { const ix = facts(C, C.ytd), t = sumR(C, ix); return list(rank(C, ix, i => C.cMkt[F.c[i]], m => mktName(C.mkts[m], L), 30).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('overview', 'mix', 'top10share', L => T(L, 'How dependent are we on our 10 largest customers?', 'Hoe afhankelijk zijn we van onze 10 grootste klanten?'), L => { const ix = facts(C, C.ytd), t = sumR(C, ix), top = rank(C, ix, i => F.c[i], c => c, 10).reduce((s, r) => s + r.v, 0); return `**${share(top, t)}**\n${T(L, `The 10 largest customers bought ${eur(top)} of ${eur(t)} this year.`, `De 10 grootste klanten kochten dit jaar ${eur(top)} van ${eur(t)}.`)}` + footer(C, L); });
  for (const k of ['mtd', 'ytd']) {
    add('overview', 'kpi', `active.${k}`, L => T(L, `How many customers bought ${perTxt[k][0]}?`, `Hoeveel klanten kochten ${perTxt[k][1]}?`), L => { const p = per(k)(L); const s = new Set(facts(C, p.ms, i => F.r[i] > 0).map(i => F.c[i])); return `**${num(s.size)}**\n${T(L, 'Customers with at least one sale', 'Klanten met minstens één verkoop')} · ${p.label}` + footer(C, L); });
    add('overview', 'kpi', `mp.${k}`, L => T(L, `How many tonnes of milk powder did we sell ${perTxt[k][0]}?`, `Hoeveel ton melkpoeder hebben we ${perTxt[k][1]} verkocht?`), L => { const p = per(k)(L), ix = facts(C, p.ms, i => C.G[i] === 0); return `**${tons(sumK(C, ix))}**\n${T(L, 'Turnover', 'Omzet')}: ${eur(sumR(C, ix))} · ${p.label}` + footer(C, L); });
  }
  add('overview', 'kpi', 'invoices', L => T(L, 'How many invoices did we send this month, and what is the average?', 'Hoeveel facturen hebben we deze maand verstuurd, en wat is het gemiddelde?'), L => { const inv = new Map(); for (const r of X.invoices || []) if (r[1] === C.cur) inv.set(r[0], (inv.get(r[0]) || 0) + r[5]); const vals = [...inv.values()]; const t = vals.reduce((s, v) => s + v, 0) / 100; return `**${num(vals.length)} ${T(L, 'invoices', 'facturen')}**\n${T(L, 'Total', 'Totaal')}: ${eur(t)}\n${T(L, 'Average per invoice', 'Gemiddeld per factuur')}: ${eur(vals.length ? t / vals.length : 0)}` + footer(C, L, period(C, 'mtd', L).label); });
  add('overview', 'kpi', 'arlink', L => T(L, 'How much do customers owe us right now?', 'Hoeveel zijn klanten ons nu schuldig?'), L => { const s = arSum(arRows(C)); return `**${eur(s.net)}**\n${T(L, 'Open invoices', 'Open facturen')}: ${eur(s.open)}\n${T(L, 'Credits', 'Tegoeden')}: ${eur(s.credit)}\n${T(L, 'Overdue', 'Te laat')}: ${eur(s.over)}` + footer(C, L, arNote(C, L)); });

  add('overview', 'rev', 'rev.q', L => T(L, 'What is our turnover this quarter and last quarter?', 'Wat is onze omzet dit kwartaal en vorig kwartaal?'), L => {
    const qOf = m => `${X.months[m].slice(0, 4)}-Q${Math.ceil(+X.months[m].slice(5) / 3)}`, cq = qOf(C.cur);
    const ms = X.months.map((_, i) => i), cur = ms.filter(m => qOf(m) === cq), prevKey = qOf(cur[0] - 1), prev = ms.filter(m => qOf(m) === prevKey);
    return `**${eur(sumR(C, facts(C, cur)))}** · ${cq.replace('-', ' ')}${C.partialDay ? T(L, ' so far', ' tot nu') : ''}\n${prevKey.replace('-', ' ')}: ${eur(sumR(C, facts(C, prev)))}` + footer(C, L);
  });
  add('overview', 'rev', 'rev.12m', L => T(L, 'What was our turnover over the last 12 months?', 'Wat was onze omzet over de laatste 12 maanden?'), L => {
    const end = C.lastFull, a = Array.from({ length: 12 }, (_, i) => end - i).filter(i => i >= 0), b = Array.from({ length: 12 }, (_, i) => end - 12 - i).filter(i => i >= 0);
    const va = sumR(C, facts(C, a)), vb = b.length === 12 ? sumR(C, facts(C, b)) : 0;
    return `**${eur(va)}**\n${mLabel(X.months[a.at(-1)], L)} – ${mLabel(X.months[end], L)}` + (vb ? `\n${T(L, 'Previous 12 months', 'Voorgaande 12 maanden')}: ${eur(vb)} (${pct((va - vb) / Math.abs(vb) * 100)})` : '') + footer(C, L, portalNote(C, a, L));
  });
  add('overview', 'kpi', 'credits', L => T(L, 'How much was credited to customers this year?', 'Hoeveel is er dit jaar aan klanten gecrediteerd?'), L => { const ix = facts(C, C.ytd, i => F.r[i] < 0); return `**${eur(sumR(C, ix))}**\n${T(L, 'Credit note and return lines, already deducted from turnover', 'Creditnota- en retourregels, al afgetrokken van de omzet')}` + footer(C, L, T(L, 'Portal months show net totals only', 'Portal-maanden tonen alleen nettototalen')); });
  add('overview', 'kpi', 'avgcust', L => T(L, 'What is the average turnover per customer this year?', 'Wat is de gemiddelde omzet per klant dit jaar?'), L => { const ix = facts(C, C.ytd), n = new Set(ix.filter(i => F.r[i] > 0).map(i => F.c[i])).size; return `**${eur(n ? sumR(C, ix) / n : 0)}**\n${num(n)} ${T(L, 'buying customers', 'kopende klanten')} · ${eur(sumR(C, ix))}` + footer(C, L, period(C, 'ytd', L).label); });
  add('overview', 'mix', 'groups.mtd', L => T(L, 'How is turnover split by product group this month?', 'Hoe is de omzet verdeeld over productgroepen deze maand?'), L => { const ix = facts(C, [C.cur]), t = sumR(C, ix); return `${period(C, 'mtd', L).label}\n` + list(rank(C, ix, i => C.G[i], g => grpName(GROUPS[g], L), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('overview', 'mix', 'reps.mtd', L => T(L, 'How much has each verkoper sold this month?', 'Hoeveel heeft elke verkoper deze maand verkocht?'), L => { const ix = facts(C, [C.cur]), t = sumR(C, ix); return `${period(C, 'mtd', L).label}\n` + list(rank(C, ix, i => F.v[i], v => repName(C, v), 30).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('overview', 'kpi', 'newmtd', L => T(L, 'How many first-time customers bought this month?', 'Hoeveel nieuwe klanten kochten deze maand voor het eerst?'), L => { const first = new Map(); for (let i = 0; i < C.n; i++) if (F.r[i] > 0) { const c = F.c[i]; if (!first.has(c) || F.m[i] < first.get(c)) first.set(c, F.m[i]); } const nw = [...first].filter(([, m]) => m === C.cur).map(([c]) => c); const ix = facts(C, [C.cur], i => nw.includes(F.c[i])); return `**${num(nw.length)}**\n` + list(rank(C, ix, i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'mtd', L).label); });

  /* ───────────── Verkopers ───────────── */
  for (const k of PER) add('verkopers', 'rank', `rank.${k}`, L => T(L, `Ranking of verkopers by turnover ${perTxt[k][0]}`, `Ranglijst van verkopers op omzet ${perTxt[k][1]}`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => F.v[i], v => repName(C, v), 30).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L, portalNote(C, p.ms, L)); });
  add('verkopers', 'rank', 'growth', L => T(L, 'Which verkopers grew the most compared with last year?', 'Welke verkopers groeiden het meest ten opzichte van vorig jaar?'), L => {
    const a = new Map(rank(C, facts(C, C.ytdc), i => F.v[i], v => v, 99).map(r => [r.k, r.v])), b = new Map(rank(C, facts(C, C.pyc), i => F.v[i], v => v, 99).map(r => [r.k, r.v]));
    const rows = [...new Set([...a.keys(), ...b.keys()])].map(v => [v, (a.get(v) || 0) - (b.get(v) || 0), a.get(v) || 0, b.get(v) || 0]).filter(r => Math.abs(r[2]) >= 1 || Math.abs(r[3]) >= 1).sort((x, y) => y[1] - x[1]);
    return list(rows.map(([v, d, x, y]) => `${repName(C, v)}: ${eur(d)} (${eur(y)} → ${eur(x)})`)) + '\n\n' + T(L, 'Complete months this year vs the same months last year.', 'Volledige maanden dit jaar vs dezelfde maanden vorig jaar.') + footer(C, L);
  });
  for (const v of topEntities(C, i => F.v[i], 6)) {
    const nm = repName(C, v), mine = i => F.v[i] === v, g = `rep${v}`;
    add('verkopers', g, `r${v}.ytd`, L => T(L, `What did ${nm} sell this year?`, `Wat heeft ${nm} dit jaar verkocht?`), L => { const ix = facts(C, C.ytd, mine), all = sumR(C, facts(C, C.ytd)); return `**${eur(sumR(C, ix))}**\n${T(L, 'Share of total', 'Aandeel van totaal')}: ${share(sumR(C, ix), all)}\n${T(L, 'Customers', 'Klanten')}: ${num(new Set(ix.filter(i => F.r[i] > 0).map(i => F.c[i])).size)}` + footer(C, L, period(C, 'ytd', L).label); });
    add('verkopers', g, `r${v}.mtd`, L => T(L, `What has ${nm} sold this month?`, `Wat heeft ${nm} deze maand verkocht?`), L => { const ix = facts(C, [C.cur], mine), ixl = facts(C, [C.cur - 1], mine); return `**${eur(sumR(C, ix))}**\n${period(C, 'mtd', L).label}\n${T(L, 'Last month (full)', 'Vorige maand (volledig)')}: ${eur(sumR(C, ixl))}` + footer(C, L); });
    add('verkopers', g, `r${v}.monthly`, L => T(L, `Show ${nm}'s turnover per month this year`, `Toon de omzet van ${nm} per maand dit jaar`), L => C.ytd.map(m => `${mLabel(X.months[m], L)}: ${eur(sumR(C, facts(C, [m], mine)))}`).join('\n') + footer(C, L, portalNote(C, C.ytd, L)));
    add('verkopers', g, `r${v}.cust`, L => T(L, `Who are ${nm}'s top 10 customers this year?`, `Wie zijn de top 10 klanten van ${nm} dit jaar?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L));
    add('verkopers', g, `r${v}.prod`, L => T(L, `What are ${nm}'s best-selling products this year?`, `Wat zijn de best verkochte producten van ${nm} dit jaar?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.p[i], p => prodName(C, p), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L));
    add('verkopers', g, `r${v}.ar`, L => T(L, `How much do ${nm}'s customers owe us, and how much is overdue?`, `Hoeveel zijn de klanten van ${nm} ons schuldig, en hoeveel is te laat?`), L => { const s = arSum(arRows(C, a => X.customers[a[0]] && X.customers[a[0]][2] === nm)); return `**${eur(s.net)}**\n${T(L, 'Overdue', 'Te laat')}: ${eur(s.over)}\n${T(L, 'More than 30 days late', 'Meer dan 30 dagen te laat')}: ${eur(s.over30)}\n${T(L, 'Open invoices', 'Open facturen')}: ${num(s.nOpen)}` + footer(C, L, arNote(C, L)); });
  }

  /* ───────────── Customers ───────────── */
  for (const k of ['mtd', 'lm', 'ytd', 'py']) add('customers', 'top', `top.${k}`, L => T(L, `Who were our top 10 customers ${perTxt[k][0]}?`, `Wie waren onze top 10 klanten ${perTxt[k][1]}?`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('customers', 'life', 'new', L => T(L, 'Which customers are new this year?', 'Welke klanten zijn nieuw dit jaar?'), L => {
    const first = new Map(); for (let i = 0; i < C.n; i++) if (F.r[i] > 0) { const c = F.c[i], m = F.m[i]; if (!first.has(c) || m < first.get(c)) first.set(c, m); }
    const ys = new Set(C.ytd), nw = [...first].filter(([, m]) => ys.has(m)).map(([c]) => c), ix = facts(C, C.ytd, i => nw.includes(F.c[i]));
    return `**${num(nw.length)}**\n` + list(rank(C, ix, i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + '\n\n' + T(L, 'First sale in this year, none before (data from Jan 2025).', 'Eerste verkoop dit jaar, geen eerder (gegevens vanaf jan 2025).') + footer(C, L);
  });
  add('customers', 'life', 'quiet', L => T(L, 'Which regular customers have not bought for 60+ days?', 'Welke vaste klanten kopen al 60+ dagen niet meer?'), L => {
    const last = new Map(), days = new Map(); for (let i = 0; i < C.n; i++) { const t = C.Tday[i]; if (t != null && F.r[i] > 0 && t <= C.ltT) { last.set(F.c[i], Math.max(last.get(F.c[i]) || 0, t)); if (t > C.ltT - 365) { if (!days.has(F.c[i])) days.set(F.c[i], new Set()); days.get(F.c[i]).add(t); } } }
    const ytdRev = new Map(rank(C, facts(C, C.ytd), i => F.c[i], c => c, 99999).map(r => [r.k, r.v]));
    const rows = [...last].filter(([c, t]) => C.ltT - t >= 60 && (ytdRev.get(c) || 0) > 0 && (days.get(c) || new Set()).size >= 3).sort((a, b) => (ytdRev.get(b[0]) || 0) - (ytdRev.get(a[0]) || 0));
    return `**${num(rows.length)}**\n` + list(rows.slice(0, 15).map(([c, t]) => `${custName(C, c)}: ${T(L, 'last sale', 'laatste verkoop')} ${dLong(isoOfT(t), L)} (${num(C.ltT - t)} ${T(L, 'days', 'dagen')}) · ${T(L, 'this year', 'dit jaar')} ${eur(ytdRev.get(c))}`)) + '\n\n' + T(L, 'Regular = bought on at least 3 different days in the last 12 months. Sorted by turnover this year.', 'Vast = kocht op minstens 3 verschillende dagen in de laatste 12 maanden. Gesorteerd op omzet dit jaar.') + footer(C, L);
  });
  add('customers', 'life', 'decline', L => T(L, 'Which large customers bought less than last year?', 'Welke grote klanten kochten minder dan vorig jaar?'), L => {
    const a = new Map(rank(C, facts(C, C.ytdc), i => F.c[i], c => c, 99999).map(r => [r.k, r.v])), b = new Map(rank(C, facts(C, C.pyc), i => F.c[i], c => c, 99999).map(r => [r.k, r.v]));
    const rows = [...b].map(([c, v]) => [c, (a.get(c) || 0) - v, v, a.get(c) || 0]).filter(r => r[1] < 0).sort((x, y) => x[1] - y[1]).slice(0, 10);
    return list(rows.map(([c, d, y, x]) => `${custName(C, c)}: ${eur(d)} (${eur(y)} → ${eur(x)})`)) + '\n\n' + T(L, 'Complete months this year vs the same months last year.', 'Volledige maanden dit jaar vs dezelfde maanden vorig jaar.') + footer(C, L);
  });
  add('customers', 'life', 'growth', L => T(L, 'Which customers grew the most compared with last year?', 'Welke klanten groeiden het meest ten opzichte van vorig jaar?'), L => {
    const a = new Map(rank(C, facts(C, C.ytdc), i => F.c[i], c => c, 99999).map(r => [r.k, r.v])), b = new Map(rank(C, facts(C, C.pyc), i => F.c[i], c => c, 99999).map(r => [r.k, r.v]));
    const rows = [...a].map(([c, v]) => [c, v - (b.get(c) || 0), b.get(c) || 0, v]).filter(r => r[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 10);
    return list(rows.map(([c, d, y, x]) => `${custName(C, c)}: +${eur(d)} (${eur(y)} → ${eur(x)})`)) + '\n\n' + T(L, 'Complete months this year vs the same months last year.', 'Volledige maanden dit jaar vs dezelfde maanden vorig jaar.') + footer(C, L);
  });
  for (const c of topEntities(C, i => F.c[i], 6)) {
    const nm = custName(C, c), mine = i => F.c[i] === c, g = `cus${c}`;
    add('customers', g, `c${c}.ytd`, L => T(L, `How much did ${nm} buy this year and last year?`, `Hoeveel kocht ${nm} dit jaar en vorig jaar?`), L => { const a = sumR(C, facts(C, C.ytd, mine)), b = sumR(C, facts(C, C.py, mine)); return `**${eur(a)}** · ${period(C, 'ytd', L).label}\n${C.year - 1}: ${eur(b)}\n${T(L, 'Verkoper', 'Verkoper')}: ${X.customers[c][2]} · ${mktName(X.customers[c][1], L)}` + footer(C, L); });
    add('customers', g, `c${c}.monthly`, L => T(L, `Show ${nm}'s purchases per month`, `Toon de aankopen van ${nm} per maand`), L => C.ytd.map(m => `${mLabel(X.months[m], L)}: ${eur(sumR(C, facts(C, [m], mine)))}`).join('\n') + footer(C, L, portalNote(C, C.ytd, L)));
    add('customers', g, `c${c}.prod`, L => T(L, `What does ${nm} buy most?`, `Wat koopt ${nm} het meest?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.p[i], p => prodName(C, p), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
    add('customers', g, `c${c}.last`, L => T(L, `When did ${nm} last buy?`, `Wanneer kocht ${nm} voor het laatst?`), L => { let t = 0; for (let i = 0; i < C.n; i++) if (F.c[i] === c && F.r[i] > 0 && C.Tday[i] != null && C.Tday[i] <= C.ltT) t = Math.max(t, C.Tday[i]); if (!t) return T(L, 'No daily sales detail for this customer (only Portal months).', 'Geen dagdetail voor deze klant (alleen Portal-maanden).') + footer(C, L); const ix = facts(C, C.ytd, i => mine(i) && C.Tday[i] === t); return `**${dLong(isoOfT(t), L)}** (${num(C.ltT - t)} ${T(L, 'days ago', 'dagen geleden')})\n${T(L, 'Value', 'Waarde')}: ${eur(sumR(C, ix))}` + footer(C, L); });
    add('customers', g, `c${c}.ar`, L => T(L, `What does ${nm} owe us?`, `Wat is ${nm} ons schuldig?`), L => { const rows = arRows(C, a => a[0] === c), s = arSum(rows); const open = rows.filter(a => a[6] > 0).sort((a, b) => a[3] < b[3] ? -1 : 1).slice(0, 8).map(a => `${a[1]} · ${T(L, 'due', 'vervalt')} ${dLong(a[3], L)} · ${eur(a[6] / 100)} · ${AGE_LBL[L][a[7]] || a[7]}`); return `**${eur(s.net)}**\n${T(L, 'Overdue', 'Te laat')}: ${eur(s.over)}\n` + (open.length ? open.join('\n') : T(L, 'No open invoices.', 'Geen open facturen.')) + footer(C, L, arNote(C, L)); });
  }

  /* ───────────── Products & Prices ───────────── */
  for (const k of ['mtd', 'lm', 'ytd', 'py']) add('products', 'top', `top.${k}`, L => T(L, `What were our best-selling products ${perTxt[k][0]}?`, `Wat waren onze best verkochte producten ${perTxt[k][1]}?`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => F.p[i], q => prodName(C, q), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('products', 'top', 'kg', L => T(L, 'Which products sold the most kilograms this year?', 'Welke producten verkochten de meeste kilo’s dit jaar?'), L => list(rank(C, facts(C, C.ytd, i => C.kgProd.has(F.p[i])), i => F.p[i], p => prodName(C, p), 10, i => F.k[i] || 0).map(r => `${r.name}: ${tons(r.v)}`)) + footer(C, L));
  add('products', 'price', 'mpprice', L => T(L, 'What was the average milk powder price per kg each month?', 'Wat was de gemiddelde melkpoederprijs per kg per maand?'), L => C.ytd.map(m => { const ix = facts(C, [m], i => C.G[i] === 0 && C.kgProd.has(F.p[i])), kg = sumK(C, ix); return `${mLabel(X.months[m], L)}: ${kg ? '€' + nf2.format(sumR(C, ix) / kg) + '/kg' : '—'} (${tons(kg)})`; }).join('\n') + '\n\n' + T(L, 'Turnover ÷ kg for milk powder sold by weight; credits included.', 'Omzet ÷ kg voor melkpoeder verkocht per gewicht; creditnota’s meegerekend.') + footer(C, L));
  add('products', 'top', 'count', L => T(L, 'How many different products did we sell this year?', 'Hoeveel verschillende producten hebben we dit jaar verkocht?'), L => `**${num(new Set(facts(C, C.ytd, i => F.r[i] > 0).map(i => F.p[i])).size)}**` + footer(C, L, period(C, 'ytd', L).label));
  for (const p of topEntities(C, i => F.p[i], 6)) {
    const nm = prodName(C, p), mine = i => F.p[i] === p, g = `prd${p}`, kg = C.kgProd.has(p);
    add('products', g, `p${p}.ytd`, L => T(L, `How is ${nm} selling this year?`, `Hoe verkoopt ${nm} dit jaar?`), L => { const ix = facts(C, C.ytd, mine), b = sumR(C, facts(C, C.pyc, mine)), a = sumR(C, facts(C, C.ytdc, mine)); return `**${eur(sumR(C, ix))}**${kg ? ` · ${tons(sumK(C, ix))}` : ''}\n${T(L, 'Customers', 'Klanten')}: ${num(new Set(ix.filter(i => F.r[i] > 0).map(i => F.c[i])).size)}\n${T(L, 'vs last year (complete months)', 'vs vorig jaar (volledige maanden)')}: ${b ? pct((a - b) / Math.abs(b) * 100) : '—'}` + footer(C, L, period(C, 'ytd', L).label); });
    add('products', g, `p${p}.monthly`, L => T(L, `Show ${nm} per month this year`, `Toon ${nm} per maand dit jaar`), L => C.ytd.map(m => { const ix = facts(C, [m], mine); return `${mLabel(X.months[m], L)}: ${eur(sumR(C, ix))}${kg ? ` · ${tons(sumK(C, ix))}` : ''}`; }).join('\n') + footer(C, L, portalNote(C, C.ytd, L)));
    add('products', g, `p${p}.cust`, L => T(L, `Who buys the most ${nm}?`, `Wie koopt de meeste ${nm}?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
    add('products', g, `p${p}.price`, L => T(L, kg ? `What is the average price per kg of ${nm}?` : `What is the average turnover per order line of ${nm}?`, kg ? `Wat is de gemiddelde prijs per kg van ${nm}?` : `Wat is de gemiddelde omzet per orderregel van ${nm}?`), L => {
      if (!kg) { const ix = facts(C, C.ytd, i => mine(i) && F.r[i] > 0); return `**${eur(ix.length ? sumR(C, ix) / ix.length : 0)}**\n${T(L, 'Average per sales line this year', 'Gemiddeld per verkoopregel dit jaar')} (${num(ix.length)})` + footer(C, L); }
      return C.ytd.map(m => { const ix = facts(C, [m], mine), k = sumK(C, ix); return `${mLabel(X.months[m], L)}: ${k ? '€' + nf2.format(sumR(C, ix) / k) + '/kg' : '—'}`; }).join('\n') + footer(C, L);
    });
  }

  /* ───────────── Product groups ───────────── */
  for (const k of ['mtd', 'ytd', 'py']) add('categories', 'mix', `mix.${k}`, L => T(L, `Turnover per product group ${perTxt[k][0]}`, `Omzet per productgroep ${perTxt[k][1]}`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => C.G[i], g => grpName(GROUPS[g], L), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('categories', 'mix', 'mix.lm', L => T(L, 'Turnover per product group last month', 'Omzet per productgroep vorige maand'), L => { const p = period(C, 'lm', L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => C.G[i], g => grpName(GROUPS[g], L), 10).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  add('categories', 'mix', 'tons', L => T(L, 'How many tonnes did we sell per product group this year?', 'Hoeveel ton hebben we per productgroep dit jaar verkocht?'), L => list(rank(C, facts(C, C.ytd, i => C.kgProd.has(F.p[i])), i => C.G[i], g => grpName(GROUPS[g], L), 10, i => F.k[i] || 0).map(r => `${r.name}: ${tons(r.v)}`)) + '\n\n' + T(L, 'Products sold by weight only.', 'Alleen producten die per gewicht worden verkocht.') + footer(C, L));
  add('categories', 'mix', 'yoy', L => T(L, 'Which product groups grew compared with last year?', 'Welke productgroepen groeiden ten opzichte van vorig jaar?'), L => GROUPS.map((gn, g) => { const a = sumR(C, facts(C, C.ytdc, i => C.G[i] === g)), b = sumR(C, facts(C, C.pyc, i => C.G[i] === g)); return [gn, a, b]; }).filter(r => r[1] || r[2]).sort((x, y) => (y[1] - y[2]) - (x[1] - x[2])).map(([gn, a, b]) => `${grpName(gn, L)}: ${b ? pct((a - b) / Math.abs(b) * 100) : '—'} (${eur(b)} → ${eur(a)})`).join('\n') + '\n\n' + T(L, 'Complete months this year vs the same months last year.', 'Volledige maanden dit jaar vs dezelfde maanden vorig jaar.') + footer(C, L));
  for (const g of topEntities(C, i => C.G[i], 6)) {
    const gn = GROUPS[g], mine = i => C.G[i] === g, key = `grp${g}`;
    add('categories', key, `g${g}.ytd`, L => T(L, `How much ${grpName(gn, L)} did we sell this year?`, `Hoeveel ${grpName(gn, L)} hebben we dit jaar verkocht?`), L => { const ix = facts(C, C.ytd, mine), k = sumK(C, ix); return `**${eur(sumR(C, ix))}**${k ? ` · ${tons(k)}` : ''}\n${T(L, 'Share of total', 'Aandeel van totaal')}: ${share(sumR(C, ix), sumR(C, facts(C, C.ytd)))}` + footer(C, L, period(C, 'ytd', L).label); });
    add('categories', key, `g${g}.mtd`, L => T(L, `How much ${grpName(gn, L)} have we sold this month?`, `Hoeveel ${grpName(gn, L)} hebben we deze maand verkocht?`), L => { const ix = facts(C, [C.cur], mine), k = sumK(C, ix); return `**${eur(sumR(C, ix))}**${k ? ` · ${tons(k)}` : ''}\n${period(C, 'mtd', L).label}\n${T(L, 'Last month', 'Vorige maand')}: ${eur(sumR(C, facts(C, [C.cur - 1], mine)))}` + footer(C, L); });
    add('categories', key, `g${g}.monthly`, L => T(L, `Show ${grpName(gn, L)} per month this year`, `Toon ${grpName(gn, L)} per maand dit jaar`), L => C.ytd.map(m => { const ix = facts(C, [m], mine), k = sumK(C, ix); return `${mLabel(X.months[m], L)}: ${eur(sumR(C, ix))}${k ? ` · ${tons(k)}` : ''}`; }).join('\n') + footer(C, L, portalNote(C, C.ytd, L)));
    add('categories', key, `g${g}.prod`, L => T(L, `Which ${grpName(gn, L)} products sell best?`, `Welke ${grpName(gn, L)}-producten verkopen het best?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.p[i], p => prodName(C, p), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
    add('categories', key, `g${g}.cust`, L => T(L, `Who are the largest ${grpName(gn, L)} customers?`, `Wie zijn de grootste ${grpName(gn, L)}-klanten?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
  }

  /* ───────────── Markets & Channels ───────────── */
  for (const k of ['mtd', 'ytd', 'py']) add('markets', 'rank', `rank.${k}`, L => T(L, `Turnover per country ${perTxt[k][0]}`, `Omzet per land ${perTxt[k][1]}`), L => { const p = per(k)(L), ix = facts(C, p.ms), t = sumR(C, ix); return `${p.label}\n` + list(rank(C, ix, i => C.cMkt[F.c[i]], m => mktName(C.mkts[m], L), 30).map(r => `${r.name}: ${eur(r.v)} (${share(r.v, t)})`)) + footer(C, L); });
  const webIdx = X.verkopers.indexOf('Webshop');
  for (const k of ['mtd', 'ytd']) add('markets', 'chan', `chan.${k}`, L => T(L, `How much came through the webshop vs direct sales ${perTxt[k][0]}?`, `Hoeveel kwam via de webshop vs directe verkoop ${perTxt[k][1]}?`), L => { const p = per(k)(L), ix = facts(C, p.ms), w = sumR(C, ix.filter(i => F.v[i] === webIdx)), t = sumR(C, ix); return `Webshop: ${eur(w)} (${share(w, t)})\n${T(L, 'Direct', 'Direct')}: ${eur(t - w)} (${share(t - w, t)})\n${T(L, 'Webshop customers', 'Webshopklanten')}: ${num(new Set(ix.filter(i => F.v[i] === webIdx && F.r[i] > 0).map(i => F.c[i])).size)}` + footer(C, L, p.label); });
  add('markets', 'rank', 'yoy', L => T(L, 'Which countries grew compared with last year?', 'Welke landen groeiden ten opzichte van vorig jaar?'), L => { const a = new Map(rank(C, facts(C, C.ytdc), i => C.cMkt[F.c[i]], m => m, 99).map(r => [r.k, r.v])), b = new Map(rank(C, facts(C, C.pyc), i => C.cMkt[F.c[i]], m => m, 99).map(r => [r.k, r.v])); return [...new Set([...a.keys(), ...b.keys()])].map(m => [m, a.get(m) || 0, b.get(m) || 0]).sort((x, y) => (y[1] - y[2]) - (x[1] - x[2])).map(([m, x, y]) => `${mktName(C.mkts[m], L)}: ${y ? pct((x - y) / Math.abs(y) * 100) : T(L, 'new', 'nieuw')} (${eur(y)} → ${eur(x)})`).join('\n') + '\n\n' + T(L, 'Complete months this year vs the same months last year.', 'Volledige maanden dit jaar vs dezelfde maanden vorig jaar.') + footer(C, L); });
  add('markets', 'rank', 'custs', L => T(L, 'How many customers bought in each country this year?', 'Hoeveel klanten kochten er per land dit jaar?'), L => { const m = new Map(); for (const i of facts(C, C.ytd, i => F.r[i] > 0)) { const k = C.cMkt[F.c[i]]; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(F.c[i]); } return list([...m].sort((a, b) => b[1].size - a[1].size).map(([k, set]) => `${mktName(C.mkts[k], L)}: ${num(set.size)}`)) + footer(C, L, period(C, 'ytd', L).label); });
  add('markets', 'rank', 'avg', L => T(L, 'What is the average turnover per customer in each country?', 'Wat is de gemiddelde omzet per klant per land?'), L => { const m = new Map(); for (const i of facts(C, C.ytd)) { const k = C.cMkt[F.c[i]]; const e = m.get(k) || { v: 0, c: new Set() }; e.v += F.r[i] / 100; if (F.r[i] > 0) e.c.add(F.c[i]); m.set(k, e); } return list([...m].filter(([, e]) => e.c.size).map(([k, e]) => [k, e.v / e.c.size, e.c.size]).sort((a, b) => b[1] - a[1]).map(([k, v, n]) => `${mktName(C.mkts[k], L)}: ${eur(v)} (${num(n)} ${T(L, 'customers', 'klanten')})`)) + footer(C, L, period(C, 'ytd', L).label); });
  for (const mk of topEntities(C, i => C.cMkt[F.c[i]], 6)) {
    const nm = C.mkts[mk], mine = i => C.cMkt[F.c[i]] === mk, g = `mkt${mk}`;
    add('markets', g, `m${mk}.ytd`, L => T(L, `How much did we sell in ${mktName(nm, L)} this year?`, `Hoeveel hebben we dit jaar in ${mktName(nm, L)} verkocht?`), L => { const ix = facts(C, C.ytd, mine); return `**${eur(sumR(C, ix))}**\n${T(L, 'Share of total', 'Aandeel van totaal')}: ${share(sumR(C, ix), sumR(C, facts(C, C.ytd)))}\n${T(L, 'Customers buying', 'Kopende klanten')}: ${num(new Set(ix.filter(i => F.r[i] > 0).map(i => F.c[i])).size)}\n${C.year - 1}: ${eur(sumR(C, facts(C, C.py, mine)))}` + footer(C, L, period(C, 'ytd', L).label); });
    add('markets', g, `m${mk}.monthly`, L => T(L, `Show ${mktName(nm, L)} per month this year`, `Toon ${mktName(nm, L)} per maand dit jaar`), L => C.ytd.map(m => `${mLabel(X.months[m], L)}: ${eur(sumR(C, facts(C, [m], mine)))}`).join('\n') + footer(C, L, portalNote(C, C.ytd, L)));
    add('markets', g, `m${mk}.cust`, L => T(L, `Who are our largest customers in ${mktName(nm, L)}?`, `Wie zijn onze grootste klanten in ${mktName(nm, L)}?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.c[i], c => custName(C, c), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
    add('markets', g, `m${mk}.prod`, L => T(L, `What do we sell most in ${mktName(nm, L)}?`, `Wat verkopen we het meest in ${mktName(nm, L)}?`), L => list(rank(C, facts(C, C.ytd, mine), i => F.p[i], p => prodName(C, p), 10).map(r => `${r.name}: ${eur(r.v)}`)) + footer(C, L, period(C, 'ytd', L).label));
  }

  /* ───────────── Receivables ───────────── */
  const AR = () => arRows(C);
  add('receivables', 'tot', 'total', L => T(L, 'How much do customers owe us in total?', 'Hoeveel zijn klanten ons in totaal schuldig?'), L => { const s = arSum(AR()); return `**${eur(s.net)}**\n${T(L, 'Open invoices', 'Open facturen')}: ${eur(s.open)} (${num(s.nOpen)})\n${T(L, 'Credits and credit notes', 'Tegoeden en creditnota’s')}: ${eur(s.credit)}` + footer(C, L, arNote(C, L)); });
  add('receivables', 'tot', 'ageing', L => T(L, 'How old are our open invoices?', 'Hoe oud zijn onze open facturen?'), L => { const s = arSum(AR()); return AGES.map(a => `${AGE_LBL[L][a]}: ${eur(s.byAge[a] || 0)} (${share(s.byAge[a] || 0, s.open)})`).join('\n') + `\n\n**${T(L, 'Open invoices', 'Open facturen')}: ${eur(s.open)}**` + footer(C, L, arNote(C, L)); });
  add('receivables', 'tot', 'overdue', L => T(L, 'How much is overdue?', 'Hoeveel is te laat?'), L => { const s = arSum(AR()); return `**${eur(s.over)}** (${share(s.over, s.open)} ${T(L, 'of open invoices', 'van open facturen')})\n${T(L, 'More than 30 days late', 'Meer dan 30 dagen te laat')}: ${eur(s.over30)}\n${T(L, 'More than 90 days late', 'Meer dan 90 dagen te laat')}: ${eur(s.byAge['91+'] || 0)}` + footer(C, L, arNote(C, L)); });
  add('receivables', 'list', 'old', L => T(L, 'Which invoices are more than 90 days late?', 'Welke facturen zijn meer dan 90 dagen te laat?'), L => { const r = AR().filter(a => a[6] > 0 && a[7] === '91+').sort((a, b) => b[6] - a[6]); return `**${num(r.length)} · ${eur(r.reduce((s, a) => s + a[6], 0) / 100)}**\n` + list(r.slice(0, 15).map(a => `${a[1]} · ${custName(C, a[0])} · ${T(L, 'due', 'vervallen')} ${dLong(a[3], L)} · ${eur(a[6] / 100)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'list', 'topopen', L => T(L, 'Which customers owe us the most?', 'Welke klanten zijn ons het meest schuldig?'), L => { const m = new Map(); for (const a of AR()) m.set(a[0], (m.get(a[0]) || 0) + a[6] / 100); return list([...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => `${custName(C, c)}: ${eur(v)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'list', 'topover', L => T(L, 'Which customers have the most overdue?', 'Welke klanten hebben het meeste te laat?'), L => { const m = new Map(); for (const a of AR()) if (a[6] > 0 && a[7] !== 'Current') m.set(a[0], (m.get(a[0]) || 0) + a[6] / 100); return list([...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => `${custName(C, c)}: ${eur(v)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'list', 'largest', L => T(L, 'What are the 10 largest open invoices?', 'Wat zijn de 10 grootste open facturen?'), L => list(AR().filter(a => a[6] > 0).sort((a, b) => b[6] - a[6]).slice(0, 10).map(a => `${a[1]} · ${custName(C, a[0])} · ${eur(a[6] / 100)} · ${AGE_LBL[L][a[7]] || a[7]}`)) + footer(C, L, arNote(C, L)));
  add('receivables', 'list', 'due7', L => T(L, 'Which invoices fall due in the next 7 days?', 'Welke facturen vervallen in de komende 7 dagen?'), L => { const hi = isoOfT(C.ltT + 7); const r = AR().filter(a => a[6] > 0 && a[3] && a[3] > C.lt && a[3] <= hi).sort((a, b) => a[3] < b[3] ? -1 : 1); return `**${num(r.length)} · ${eur(r.reduce((s, a) => s + a[6], 0) / 100)}**\n` + list(r.slice(0, 15).map(a => `${dLong(a[3], L)} · ${a[1]} · ${custName(C, a[0])} · ${eur(a[6] / 100)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'list', 'credits', L => T(L, 'Which customers have a credit balance with us?', 'Welke klanten hebben een tegoed bij ons?'), L => { const m = new Map(); for (const a of AR()) if (a[6] < 0) m.set(a[0], (m.get(a[0]) || 0) + a[6] / 100); return list([...m].sort((a, b) => a[1] - b[1]).slice(0, 10).map(([c, v]) => `${custName(C, c)}: ${eur(v)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'pay', 'dso', L => T(L, 'How quickly do customers pay on average?', 'Hoe snel betalen klanten gemiddeld?'), L => { const lo = isoOfT(C.ltT - 180), r = AR().filter(a => a[7] === 'Settled' && a[2] >= lo && a[8] != null && a[4] > 0); const avg = r.reduce((s, a) => s + a[8], 0) / (r.length || 1); const w = r.reduce((s, a) => s + a[8] * a[4], 0) / (r.reduce((s, a) => s + a[4], 0) || 1); return `**${num(avg)} ${T(L, 'days', 'dagen')}**\n${T(L, 'Weighted by invoice value', 'Gewogen naar factuurbedrag')}: ${num(w)} ${T(L, 'days', 'dagen')}\n${T(L, 'Based on', 'Gebaseerd op')} ${num(r.length)} ${T(L, 'paid invoices from the last 6 months', 'betaalde facturen van de laatste 6 maanden')}` + footer(C, L); });
  add('receivables', 'pay', 'slow', L => T(L, 'Which customers pay slowest?', 'Welke klanten betalen het traagst?'), L => { const lo = isoOfT(C.ltT - 180), m = new Map(); for (const a of AR()) if (a[7] === 'Settled' && a[2] >= lo && a[8] != null && a[4] > 0) { const x = m.get(a[0]) || [0, 0]; x[0] += a[8]; x[1]++; m.set(a[0], x); } return list([...m].filter(([, x]) => x[1] >= 3).map(([c, x]) => [c, x[0] / x[1], x[1]]).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, d, n]) => `${custName(C, c)}: ${num(d)} ${T(L, 'days', 'dagen')} (${n} ${T(L, 'invoices', 'facturen')})`)) + '\n\n' + T(L, 'Customers with at least 3 paid invoices in the last 6 months.', 'Klanten met minstens 3 betaalde facturen in de laatste 6 maanden.') + footer(C, L); });
  add('receivables', 'by', 'byrep', L => T(L, 'Receivables per verkoper', 'Debiteuren per verkoper'), L => { const m = new Map(); for (const a of AR()) { const r = X.customers[a[0]] ? X.customers[a[0]][2] : '?'; const x = m.get(r) || [0, 0]; x[0] += a[6] / 100; if (a[6] > 0 && a[7] !== 'Current') x[1] += a[6] / 100; m.set(r, x); } return list([...m].sort((a, b) => b[1][0] - a[1][0]).map(([r, x]) => `${r}: ${eur(x[0])} · ${T(L, 'overdue', 'te laat')} ${eur(x[1])}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'by', 'bymkt', L => T(L, 'Receivables per country', 'Debiteuren per land'), L => { const m = new Map(); for (const a of AR()) { const k = X.customers[a[0]] ? X.customers[a[0]][1] : '?'; m.set(k, (m.get(k) || 0) + a[6] / 100); } return list([...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${mktName(k, L)}: ${eur(v)}`)) + footer(C, L, arNote(C, L)); });
  add('receivables', 'rule', 'why7apr', L => T(L, 'Why do receivables only include invoices from 7 April 2026?', 'Waarom bevatten de debiteuren alleen facturen vanaf 7 april 2026?'), L => T(L, `Microfas took over invoicing on ${dLong(X.meta.arStart, L)}, and DairyTop asked to track receivables from that date. Older open items from the previous system are shown separately on the Receivables page, under "Open items not in the tiles".`, `Microfas nam de facturatie over op ${dLong(X.meta.arStart, L)} en DairyTop vroeg om de debiteuren vanaf die datum te volgen. Oudere openstaande posten uit het vorige systeem staan apart op de pagina Debiteuren, onder "Open posten niet in de tegels".`) + footer(C, L));
  add('receivables', 'rule', 'recon', L => T(L, 'How do receivables tie to the ledger?', 'Hoe sluiten de debiteuren aan op het grootboek?'), L => { const R = X.recon || {}; const v = k => eur((R[k] || 0) / 100); return `${T(L, 'Receivables (excl. VAT)', 'Debiteuren (excl. btw)')}: ${v('cohortBalanceCents')}\n+ ${T(L, 'open from before', 'open van vóór')} ${dLong(X.meta.arStart, L)}: ${v('legacyOpenCents')}\n+ ${T(L, 'payments without an invoice', 'betalingen zonder factuur')}: ${v('unallocatedOpenCents')}\n+ ${T(L, 'VAT on open items', 'btw op open posten')}: ${v('vatInOpenItemsCents')}\n+ ${T(L, 'other differences', 'overige verschillen')}: ${v('matchedResidualCents')}\n= **${T(L, 'Debtors ledger account', 'Grootboekrekening debiteuren')}: ${v('controlCents')}**` + footer(C, L); });
  add('receivables', 'rule', 'ageing', L => T(L, 'How is "days late" calculated?', 'Hoe wordt "dagen te laat" berekend?'), L => T(L, `Due date = invoice date + the customer's payment term. Days late = ${dLong(C.lt, L)} (the last data day) minus the due date. Customers with a 0-day term are due on the invoice date itself.`, `Vervaldatum = factuurdatum + betalingstermijn van de klant. Dagen te laat = ${dLong(C.lt, L)} (laatste gegevensdag) min de vervaldatum. Klanten met 0 dagen termijn moeten op de factuurdatum betalen.`) + footer(C, L));
  const repsAR = (() => { const m = new Map(); for (const a of AR()) if (a[6] > 0) { const r = X.customers[a[0]] ? X.customers[a[0]][2] : null; if (r) m.set(r, (m.get(r) || 0) + a[6]); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r]) => r); })();
  for (const r of repsAR) {
    const mine = a => X.customers[a[0]] && X.customers[a[0]][2] === r, g = `arrep${r}`;
    add('receivables', g, `ar.${r}.tot`, L => T(L, `What do ${r}'s customers owe us?`, `Wat zijn de klanten van ${r} ons schuldig?`), L => { const s = arSum(AR().filter(mine)); return `**${eur(s.net)}**\n` + AGES.map(a => `${AGE_LBL[L][a]}: ${eur(s.byAge[a] || 0)}`).join('\n') + footer(C, L, arNote(C, L)); });
    add('receivables', g, `ar.${r}.over`, L => T(L, `Which of ${r}'s invoices are overdue?`, `Welke facturen van ${r} zijn te laat?`), L => { const rr = AR().filter(a => mine(a) && a[6] > 0 && a[7] !== 'Current').sort((a, b) => b[6] - a[6]); return `**${num(rr.length)} · ${eur(rr.reduce((s, a) => s + a[6], 0) / 100)}**\n` + list(rr.slice(0, 12).map(a => `${a[1]} · ${custName(C, a[0])} · ${eur(a[6] / 100)} · ${AGE_LBL[L][a[7]]}`)) + footer(C, L, arNote(C, L)); });
  }
  const topDebt = (() => { const m = new Map(); for (const a of AR()) m.set(a[0], (m.get(a[0]) || 0) + a[6]); return [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c); })();
  for (const c of topDebt) add('receivables', `ardebt${c}`, `ar.c${c}`, L => T(L, `Which invoices of ${custName(C, c)} are still open?`, `Welke facturen van ${custName(C, c)} staan nog open?`), L => { const rr = AR().filter(a => a[0] === c && a[6] !== 0).sort((a, b) => a[2] < b[2] ? -1 : 1); const s = arSum(rr); return `**${eur(s.net)}** · ${T(L, 'overdue', 'te laat')} ${eur(s.over)}\n` + list(rr.slice(0, 15).map(a => `${a[1]} · ${dLong(a[2], L)} · ${eur(a[6] / 100)} · ${AGE_LBL[L][a[7]] || T(L, 'credit', 'tegoed')}`)) + footer(C, L, arNote(C, L)); });

  /* ───────────── Finance (P&L) ───────────── */
  const pkT = { lm: ['last month', 'vorige maand'], cq: ['this quarter', 'dit kwartaal'], lq: ['last quarter', 'vorig kwartaal'], ytd: ['this year', 'dit jaar'] };
  for (const k of ['lm', 'cq', 'lq', 'ytd']) {
    const g = `fin${k}`;
    add('finance', g, `res.${k}`, L => T(L, `What was our result ${pkT[k][0]}?`, `Wat was ons resultaat ${pkT[k][1]}?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms); return `**${eur(t.result)}** · ${p.label}\n${T(L, 'Revenue', 'Omzet')}: ${eur(t.rev)}\n− ${T(L, 'Purchases', 'Inkopen')}: ${eur(t.pur)}\n− ${T(L, 'Other costs', 'Overige kosten')}: ${eur(t.other)}\n\n${pnlNote(L)}` + footer(C, L); });
    add('finance', g, `gross.${k}`, L => T(L, `What was our gross margin ${pkT[k][0]}?`, `Wat was onze brutomarge ${pkT[k][1]}?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms); return `**${eur(t.gross)}** (${t.rev > 0 ? nf1.format(t.gross / t.rev * 100) + '%' : '—'}) · ${p.label}\n${T(L, 'Revenue', 'Omzet')}: ${eur(t.rev)}\n${T(L, 'Purchases', 'Inkopen')}: ${eur(t.pur)}\n\n${pnlNote(L)}` + footer(C, L); });
    add('finance', g, `costs.${k}`, L => T(L, `Where did our costs go ${pkT[k][0]}?`, `Waar gingen onze kosten naartoe ${pkT[k][1]}?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms), tot = t.pur + t.other; return `${p.label}\n` + list([...t.groups].sort((a, b) => b[1] - a[1]).map(([gname, v]) => `${T(L, gname, COSTGRP_NL[gname] || gname)}: ${eur(v)} (${share(v, tot)})`)) + `\n\n**${T(L, 'Total costs', 'Totale kosten')}: ${eur(tot)}**` + footer(C, L); });
    add('finance', g, `acct.${k}`, L => T(L, `What were the 10 largest cost items ${pkT[k][0]}?`, `Wat waren de 10 grootste kostenposten ${pkT[k][1]}?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms); return `${p.label}\n` + list([...t.accts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, v]) => `${a}: ${eur(v)}`)) + footer(C, L); });
  }
  for (const k of ['lm', 'cq', 'lq', 'ytd']) {
    add('finance', `fin${k}`, `rev.${k}`, L => T(L, `What was our booked revenue ${pkT[k][0]}?`, `Wat was onze geboekte omzet ${pkT[k][1]}?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms); return `**${eur(t.rev)}** · ${p.label}\n${T(L, 'From the revenue accounts in the ledger; can differ slightly from invoiced turnover because of corrections.', 'Uit de omzetrekeningen in het grootboek; kan iets afwijken van de gefactureerde omzet door correcties.')}` + footer(C, L); });
    add('finance', `fin${k}`, `pur.${k}`, L => T(L, `How much did we purchase ${pkT[k][0]}?`, `Hoeveel hebben we ${pkT[k][1]} ingekocht?`), L => { const p = pnlPeriod(C, k, L); if (!p.ms.length) return '—'; const t = pnlTotals(C, p.ms); const acc = (C.X.pnl || []).filter(r => p.ms.includes(r[0]) && r[2] === 'Purchases'); const m = new Map(); for (const r of acc) m.set(r[1], (m.get(r[1]) || 0) - r[4] / 100); return `**${eur(t.pur)}** · ${p.label}\n` + list([...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, v]) => `${a}: ${eur(v)}`)) + `\n\n${pnlNote(L)}` + footer(C, L); });
  }
  add('finance', 'fintrend', 'ratio', L => T(L, 'What share of revenue goes to costs each month?', 'Welk deel van de omzet gaat per maand naar kosten?'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort(); return ms.map(m => { const t = pnlTotals(C, [m]); return `${mLabel(m, L)}: ${T(L, 'purchases', 'inkopen')} ${share(t.pur, t.rev)} · ${T(L, 'other costs', 'overige kosten')} ${share(t.other, t.rev)}`; }).join('\n') + `\n\n${pnlNote(L)}` + footer(C, L); });
  add('finance', 'fintrend', 'office', L => T(L, 'How much did office & admin cost per month?', 'Hoeveel kostten kantoor & administratie per maand?'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort(); return ms.map(m => `${mLabel(m, L)}: ${eur(pnlTotals(C, [m]).groups.get('Office & admin') || 0)}`).join('\n') + footer(C, L); });
  add('finance', 'fintrend', 'monthly', L => T(L, 'Show revenue, costs and result per month', 'Toon omzet, kosten en resultaat per maand'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort(); return ms.map(m => { const t = pnlTotals(C, [m]); return `${mLabel(m, L)}: ${T(L, 'revenue', 'omzet')} ${eur(t.rev)} · ${T(L, 'costs', 'kosten')} ${eur(t.pur + t.other)} · ${T(L, 'result', 'resultaat')} ${eur(t.result)}`; }).join('\n') + `\n\n${pnlNote(L)}` + footer(C, L); });
  add('finance', 'fintrend', 'bestres', L => T(L, 'Which month had the best result?', 'Welke maand had het beste resultaat?'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books && (m < C.curIso || !C.partialDay)).sort(); const r = ms.map(m => [m, pnlTotals(C, [m]).result]).sort((a, b) => b[1] - a[1]); return r.length ? `**${mLong(r[0][0], L)}: ${eur(r[0][1])}**\n${T(L, 'Weakest', 'Zwakste')}: ${mLong(r.at(-1)[0], L)} (${eur(r.at(-1)[1])})\n\n${pnlNote(L)}` + footer(C, L) : '—'; });
  add('finance', 'fintrend', 'transport', L => T(L, 'How much did transport cost per month?', 'Hoeveel kostte transport per maand?'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort(); return ms.map(m => { const t = pnlTotals(C, [m]); const v = t.groups.get('Transport') || 0; return `${mLabel(m, L)}: ${eur(v)} (${share(v, t.rev)} ${T(L, 'of revenue', 'van omzet')})`; }).join('\n') + footer(C, L); });
  add('finance', 'fintrend', 'personnel', L => T(L, 'How much did personnel cost per month?', 'Hoeveel kostte personeel per maand?'), L => { const books = X.meta.booksOpening.slice(0, 7); const ms = [...new Set((X.pnl || []).map(r => r[0]))].filter(m => m >= books).sort(); return ms.map(m => `${mLabel(m, L)}: ${eur(pnlTotals(C, [m]).groups.get('Personnel') || 0)}`).join('\n') + footer(C, L); });
  add('finance', 'finrule', 'pnlrule', L => T(L, 'Why is the result only indicative?', 'Waarom is het resultaat alleen indicatief?'), L => T(L, `The P&L uses Microfas bookings from ${dLong(X.meta.booksOpening, L)}. Purchases are booked when goods are bought, not when they are sold, and stock changes are not in the export. A month with large purchases can therefore look weaker than it really was. Purchase prices per product are not yet in the export, so true product margins cannot be calculated.`, `De W&V gebruikt Microfas-boekingen vanaf ${dLong(X.meta.booksOpening, L)}. Inkopen worden geboekt bij inkoop, niet bij verkoop, en voorraadmutaties zitten niet in de export. Een maand met grote inkopen kan er daardoor zwakker uitzien dan hij was. Inkoopprijzen per product zitten nog niet in de export, dus echte productmarges zijn niet te berekenen.`) + footer(C, L));

  /* ───────────── Orders & Data ───────────── */
  add('orders', 'ord', 'open', L => T(L, 'How many open orders do we have, and what are they worth?', 'Hoeveel open orders hebben we, en wat zijn ze waard?'), L => { const ol = orderLines(C), ords = new Set(ol.map(x => x.o[0])), unp = ol.filter(x => !x.priced).length; return `**${num(ords.size)} ${T(L, 'orders', 'orders')} · ${eur(ol.reduce((s, x) => s + x.v, 0))}**\n${T(L, 'Still to deliver', 'Nog te leveren')}: ${eur(ol.reduce((s, x) => s + x.vr, 0))}\n${T(L, 'Delivered, not invoiced', 'Geleverd, niet gefactureerd')}: ${eur(ol.reduce((s, x) => s + x.vd, 0))}\n${T(L, 'Lines without a price (not in the value)', 'Regels zonder prijs (niet in de waarde)')}: ${num(unp)}` + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'mtd', L => T(L, 'Which open orders are due this month?', 'Welke open orders moeten deze maand geleverd worden?'), L => { const ol = orderLines(C, o => (o[6] || '').startsWith(C.curIso)); const by = new Map(); for (const x of ol) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur(ol.reduce((s, x) => s + x.v, 0))}**\n` + list([...by.values()].sort((a, b) => b.v - a.v).slice(0, 12).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'late', L => T(L, 'Which open orders are past their delivery date?', 'Welke open orders zijn over hun leverdatum?'), L => { const ol = orderLines(C, o => o[6] && o[6] < C.lt); const by = new Map(); for (const x of ol) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur(ol.reduce((s, x) => s + x.v, 0))}**\n` + list([...by.values()].sort((a, b) => a.o[6] < b.o[6] ? -1 : 1).slice(0, 15).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${stageNm(e.o[12], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'dni', L => T(L, 'What has been delivered but not yet invoiced?', 'Wat is geleverd maar nog niet gefactureerd?'), L => { const ol = orderLines(C, o => o[12] === 'deliveredNotInvoiced'); const by = new Map(); for (const x of ol) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur(ol.reduce((s, x) => s + x.v, 0))}**\n` + list([...by.values()].sort((a, b) => b.v - a.v).slice(0, 15).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'byrep', L => T(L, 'Open order value per verkoper', 'Open orderwaarde per verkoper'), L => { const m = new Map(); for (const x of orderLines(C)) m.set(x.o[3], (m.get(x.o[3]) || 0) + x.v); return list([...m].sort((a, b) => b[1] - a[1]).map(([r, v]) => `${r}: ${eur(v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'kvh', L => T(L, 'What are the open calf-housing orders?', 'Wat zijn de open orders voor kalverhuisvesting?'), L => { const groupOf = p => (C.M.groupOfProduct ? C.M.groupOfProduct(p) : 5); const ol = orderLines(C).filter(x => groupOf(x.l[3]) === 2); const by = new Map(); for (const x of ol) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur(ol.reduce((s, x) => s + x.v, 0))}**\n` + list([...by.values()].sort((a, b) => b.v - a.v).slice(0, 15).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'largest', L => T(L, 'What are the 10 largest open orders?', 'Wat zijn de 10 grootste open orders?'), L => { const by = new Map(); for (const x of orderLines(C)) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return list([...by.values()].sort((a, b) => b.v - a.v).slice(0, 10).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${stageNm(e.o[12], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'fresh', L => T(L, 'Is the order data up to date?', 'Zijn de ordergegevens actueel?'), L => { const last = (X.orders || []).reduce((m, o) => (o[1] > m ? o[1] : m), ''); const s = ordersStale(C, L); return `${T(L, 'Newest order in the export', 'Nieuwste order in de export')}: **${dLong(last, L)}**\n${T(L, 'Data through', 'Gegevens t/m')}: ${dLong(C.lt, L)}` + (s || '\n' + T(L, 'The order data is current.', 'De ordergegevens zijn actueel.')); });
  add('orders', 'ord', 'bycust', L => T(L, 'Which customers have the most open order value?', 'Welke klanten hebben de meeste open orderwaarde?'), L => { const m = new Map(); for (const x of orderLines(C)) m.set(x.o[2], (m.get(x.o[2]) || 0) + x.v); return list([...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => `${custName(C, c)}: ${eur(v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'bygroup', L => T(L, 'Open order value per product group', 'Open orderwaarde per productgroep'), L => { const groupOf = p => (C.M.groupOfProduct ? C.M.groupOfProduct(p) : 5), m = new Map(); for (const x of orderLines(C)) { const g = groupOf(x.l[3]); m.set(g, (m.get(g) || 0) + x.v); } return list([...m].sort((a, b) => b[1] - a[1]).map(([g, v]) => `${grpName(GROUPS[g], L)}: ${eur(v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'todeliver', L => T(L, 'Which orders are still to be delivered?', 'Welke orders moeten nog geleverd worden?'), L => { const by = new Map(); for (const x of orderLines(C, o => o[12] === 'toDeliver')) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)}**\n` + list([...by.values()].sort((a, b) => (a.o[6] || '') < (b.o[6] || '') ? -1 : 1).slice(0, 15).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'unpriced', L => T(L, 'Which open order lines have no price?', 'Welke open orderregels hebben geen prijs?'), L => { const ol = orderLines(C).filter(x => !x.priced); return `**${num(ol.length)}**\n` + list(ol.slice(0, 15).map(x => `${x.o[0]} · ${custName(C, x.o[2])} · ${prodName(C, x.l[3])}`)) + '\n\n' + T(L, 'Lines without a price count as €0 in the open order value.', 'Regels zonder prijs tellen als €0 in de open orderwaarde.') + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'bymonth', L => T(L, 'Open order value per delivery month', 'Open orderwaarde per levermaand'), L => { const m = new Map(); for (const x of orderLines(C)) { const k = (x.o[6] || '').slice(0, 7) || '—'; m.set(k, (m.get(k) || 0) + x.v); } return [...m].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => `${k === '—' ? T(L, 'no date', 'geen datum') : mLabel(k, L)}: ${eur(v)}`).join('\n') + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'howvalue', L => T(L, 'How is the open order value calculated?', 'Hoe wordt de open orderwaarde berekend?'), L => T(L, 'Open orders are orders still to be delivered, or delivered but not yet invoiced. Each line is valued at delivered value plus the remaining quantity × net price (after line discounts). Lines without a price count as €0.', 'Open orders zijn orders die nog geleverd moeten worden, of geleverd maar nog niet gefactureerd. Elke regel wordt gewaardeerd op geleverde waarde plus resterende hoeveelheid × nettoprijs (na regelkorting). Regels zonder prijs tellen als €0.') + ordersStale(C, L));
  add('orders', 'ord', 'next', L => T(L, 'Which open orders are due next month?', 'Welke open orders moeten volgende maand geleverd worden?'), L => { const [y, mo] = C.curIso.split('-').map(Number), nx = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`; const by = new Map(); for (const x of orderLines(C, o => (o[6] || '').startsWith(nx))) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur([...by.values()].reduce((s2, e) => s2 + e.v, 0))}** · ${mLong(nx, L)}\n` + list([...by.values()].sort((a2, b2) => b2.v - a2.v).slice(0, 12).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${dLong(e.o[6], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  add('orders', 'ord', 'stages', L => T(L, 'How many orders are in each stage?', 'Hoeveel orders staan er in elke fase?'), L => { const m = new Map(); for (const o of (X.orders || []).filter(o => o[5])) m.set(o[12], (m.get(o[12]) || 0) + 1); const nm = { toDeliver: T(L, 'Still to deliver', 'Nog te leveren'), deliveredNotInvoiced: T(L, 'Delivered, not invoiced', 'Geleverd, niet gefactureerd'), invoiced: T(L, 'Invoiced, order still open', 'Gefactureerd, order nog open'), noLines: T(L, 'No order lines', 'Geen orderregels') }; return [...m].sort((a2, b2) => b2[1] - a2[1]).map(([k, v]) => `${nm[k] || k}: ${num(v)}`).join('\n') + ordersStale(C, L) + footer(C, L); });
  const ordReps = (() => { const m = new Map(); for (const x of orderLines(C)) m.set(x.o[3], (m.get(x.o[3]) || 0) + x.v); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r]) => r); })();
  for (const r of ordReps) add('orders', `ordrep${r}`, `rep.${r}`, L => T(L, `What are ${r}'s open orders?`, `Wat zijn de open orders van ${r}?`), L => { const by = new Map(); for (const x of orderLines(C, o => o[3] === r)) { const e = by.get(x.o[0]) || { o: x.o, v: 0 }; e.v += x.v; by.set(x.o[0], e); } return `**${num(by.size)} · ${eur([...by.values()].reduce((s, e) => s + e.v, 0))}**\n` + list([...by.values()].sort((a, b) => b.v - a.v).slice(0, 12).map(e => `${e.o[0]} · ${custName(C, e.o[2])} · ${stageNm(e.o[12], L)} · ${eur(e.v)}`)) + ordersStale(C, L) + footer(C, L); });
  const ordCust = (() => { const m = new Map(); for (const x of orderLines(C)) m.set(x.o[2], (m.get(x.o[2]) || 0) + x.v); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c); })();
  for (const c of ordCust) add('orders', `ordcus${c}`, `cus.${c}`, L => T(L, `What are the open orders of ${custName(C, c)}?`, `Wat zijn de open orders van ${custName(C, c)}?`), L => { const by = new Map(); for (const x of orderLines(C, o => o[2] === c)) { const e = by.get(x.o[0]) || { o: x.o, v: 0, lines: [] }; e.v += x.v; e.lines.push(prodName(C, x.l[3])); by.set(x.o[0], e); } return list([...by.values()].map(e => `${e.o[0]} · ${dLong(e.o[6], L)} · ${stageNm(e.o[12], L)} · ${eur(e.v)}\n   ${[...new Set(e.lines)].slice(0, 4).join(', ')}`)) + ordersStale(C, L) + footer(C, L); });
  const about = [
    ['dates', ['How up to date is the data?', 'Hoe actueel zijn de gegevens?'], L => T(L, `Data runs through **${dLong(C.lt, L)}**, from the Microfas export of ${dLong(X.meta.snapshot, L)}. The dashboard is refreshed every morning from Monday to Saturday.`, `De gegevens lopen t/m **${dLong(C.lt, L)}**, uit de Microfas-export van ${dLong(X.meta.snapshot, L)}. Het dashboard wordt elke ochtend van maandag t/m zaterdag ververst.`)],
    ['sources', ['Where does the data come from?', 'Waar komen de gegevens vandaan?'], L => T(L, `January 2025 – March 2026 come from the Portal export (monthly totals per customer and product). From ${dLong(X.meta.arStart, L)} everything comes from Microfas: invoices, payments, orders and the ledger.`, `Januari 2025 – maart 2026 komen uit de Portal-export (maandtotalen per klant en product). Vanaf ${dLong(X.meta.arStart, L)} komt alles uit Microfas: facturen, betalingen, orders en het grootboek.`)],
    ['turnover', ['What counts as turnover?', 'Wat telt als omzet?'], L => T(L, 'Turnover is the invoiced amount excluding VAT, by invoice date. Credit notes are deducted. All amounts in the dashboard and in these answers exclude VAT.', 'Omzet is het gefactureerde bedrag exclusief btw, op factuurdatum. Creditnota’s worden afgetrokken. Alle bedragen in het dashboard en in deze antwoorden zijn exclusief btw.')],
    ['partial', ['Why is this month lower than other months?', 'Waarom is deze maand lager dan andere maanden?'], L => T(L, `This month is still running: data so far runs through ${dLong(C.lt, L)}. Much of the invoicing usually happens at the end of the month, so compare it with the same days of last month instead.`, `Deze maand loopt nog: de gegevens lopen t/m ${dLong(C.lt, L)}. Veel facturen worden meestal aan het eind van de maand verstuurd; vergelijk daarom met dezelfde dagen van vorige maand.`)],
    ['detail', ['Why are there no weekly or daily figures before April 2026?', 'Waarom zijn er geen week- of dagcijfers vóór april 2026?'], L => T(L, 'The Portal export for January 2025 – March 2026 only has monthly totals. Weekly, daily, receivables and order detail start when Microfas took over in April 2026.', 'De Portal-export voor januari 2025 – maart 2026 bevat alleen maandtotalen. Week-, dag-, debiteuren- en orderdetail beginnen toen Microfas in april 2026 de administratie overnam.')],
    ['stock', ['Can I see stock levels or product margins?', 'Kan ik voorraad of productmarges zien?'], L => T(L, `Not yet. Microfas does not export stock levels, and purchase prices are only available for ${num((X.costs || []).length)} product records. Both have been requested from Microfas.`, `Nog niet. Microfas exporteert geen voorraad, en inkoopprijzen zijn er maar voor ${num((X.costs || []).length)} productregels. Beide zijn bij Microfas aangevraagd.`)],
    ['attribution', ['How are sales assigned to a verkoper?', 'Hoe wordt verkoop aan een verkoper toegewezen?'], L => T(L, 'Each invoice line is assigned to the verkoper recorded on the sale. Receivables and open orders use the verkoper currently assigned to the customer.', 'Elke factuurregel hoort bij de verkoper die bij de verkoop is vastgelegd. Debiteuren en open orders gebruiken de verkoper die nu aan de klant is gekoppeld.')],
    ['privacy', ['Is my data sent to an AI service?', 'Worden mijn gegevens naar een AI-dienst gestuurd?'], L => T(L, 'No. Every answer is calculated in your browser from the dashboard data. Nothing you click is sent anywhere.', 'Nee. Elk antwoord wordt in je browser berekend uit de dashboardgegevens. Niets van wat je aanklikt wordt ergens naartoe gestuurd.')],
  ];
  for (const [id, q, a] of about) add('orders', 'about', `about.${id}`, L => T(L, q[0], q[1]), L => a(L) + (id === 'privacy' ? '' : footer(C, L)));

  /* ── follow-ups: same subject first, then same tile ── */
  const byTile = new Map();
  for (const q of Q) { if (!byTile.has(q.tile)) byTile.set(q.tile, []); byTile.get(q.tile).push(q); }
  for (const q of Q) {
    const tile = byTile.get(q.tile), at = tile.indexOf(q);
    const same = tile.filter(o => o !== q && o.g === q.g);
    const near = [...tile.slice(at + 1), ...tile.slice(0, at)].filter(o => o.g !== q.g);
    const seenG = new Set(); const spread = [];
    for (const o of near) if (!seenG.has(o.g)) { seenG.add(o.g); spread.push(o); }
    q.fu = [...same.slice(0, 3), ...spread, ...near].filter((o, i, a) => a.indexOf(o) === i).slice(0, 5).map(o => o.id);
  }
  return Q;
}

/* ── public API ───────────────────────────────────────────────────────── */
let _bank = null, _bankFor = null;
export function questionBank(M) {
  const C = context(M);
  if (!C) return { tiles: TILES, questions: [], byId: new Map() };
  if (_bank && _bankFor === C) return _bank;
  const questions = buildAll(C);
  _bank = { tiles: TILES, questions, byId: new Map(questions.map(q => [q.id, q])) };
  _bankFor = C;
  return _bank;
}
export function questionText(M, id, L) { const q = questionBank(M).byId.get(id); return q ? q.q(L) : ''; }
export function answer(M, id, L) {
  const b = questionBank(M), q = b.byId.get(id);
  if (!q) return { text: T(L, 'This question is no longer available.', 'Deze vraag is niet meer beschikbaar.'), followups: [] };
  let text;
  try { text = q.a(L); if (/NaN|Infinity|undefined/.test(text)) throw new Error('bad value'); }
  catch { text = T(L, 'This answer cannot be calculated from the current data.', 'Dit antwoord kan niet worden berekend uit de huidige gegevens.'); }
  return { text, followups: q.fu };
}

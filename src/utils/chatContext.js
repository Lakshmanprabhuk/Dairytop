/* DairyTop assistant — answers straight from dash.json (passed in as `data`, the
   model API built in App.jsx). Questions it can answer locally never leave the
   browser; anything else goes to the Gemini proxy (api/chat.js) with a compact
   dash.json summary as context. */

import { QUESTION_NL } from './chatSuggestions.js';

let _cache = null, _cacheFor = null;
function engine(M) {
  if (_cacheFor === M && _cache) return _cache;
  const { X, GROUPS, sales, applyPreset, defaultFilter, aggregate, arKPI, reorder, liveMonth, mLong, invoices, legacy, orderValue, hasOrderValues, fmtFull, fmtN, fmtShare, growth } = M;
  const ALL = { reps: [], grps: [], mkts: [] };
  const F = (preset, extra = {}) => applyPreset({ ...defaultFilter(), ...extra }, preset);
  const pc = g => g == null ? '—' : (g >= 0 ? '+' : '') + g.toFixed(1).replace('.', ',') + '%';
  const t1 = kg => (kg / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t';
  const e2 = v => '€ ' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const yr = X.months[X.nM - 1].slice(0, 4);
  const ytd = () => sales(F('ytd'));          // complete months of this year, vs same months last year
  const ytdNow = () => sales(F('ytdNow'));
  const rankBy = (K, key, n = 5) => [...aggregate(K.cur, key).values()].sort((a, b) => b.rev - a.rev).slice(0, n);
  const list = rows => rows.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const src = `\n\nSource: dash.json · excl. VAT · last invoice ${X.ledgerLabel}`;
  
  
  const A = {
    mtd: () => { const L = liveMonth(); return `**${fmtFull(L.rev)}** sold in ${mLong(L.iso)} so far (1–${L.day}).\nNovember 2025 only has a monthly total (former portal), so a same-days comparison is not possible.`; },
    last3: () => { const M = legacy(ALL).monthly; const r = [X.lastFull - 2, X.lastFull - 1, X.lastFull].map(m => `${X.mLabel[m]}: **${fmtFull(M[m].rev)}** vs ${fmtFull(M[m - 12].rev)} (${pc(growth(M[m].rev, M[m - 12].rev))})`); return `Last 3 complete months vs the same months last year:\n${list(r)}`; },
    mpYear: () => { const K = sales(F('ytd', { grps: ['Milk powder'] })), N = sales(F('ytdNow', { grps: ['Milk powder'] })); return `Milk powder in ${yr}: **${t1(N.kg)}** for **${fmtFull(N.rev)}** (to ${X.ledgerLabel}).\nOn complete months (${K.P.label}): ${t1(K.kg)}, ${pc(growth(K.kg, K.kgC))} vs ${t1(K.kgC)} a year earlier.`; },
    best: () => { const M = legacy(ALL).monthly.filter(m => m.mi <= X.lastFull); const b = M.reduce((a, c) => c.rev > a.rev ? c : a); return `Best month: **${mLong(b.iso)}** with **${fmtFull(b.rev)}**.`; },
    yoy: () => { const K = ytd(); return `${K.P.label}: **${fmtFull(K.rev)}** vs ${fmtFull(K.revC)} in ${K.P.cmpLabel} → **${pc(growth(K.rev, K.revC))}**.\nNovember ${yr} so far adds ${fmtFull(liveMonth().rev)}.`; },
    avg: () => { const K = sales(F('l12')); return `Average monthly revenue over the last 12 complete months (${K.P.label}): **${fmtFull(K.rev / 12)}** (total ${fmtFull(K.rev)}).`; },
    topRep: () => { const K = ytdNow(), r = rankBy(K, i => X.verkopers[X.facts.v[i]], 5); return `Top verkopers in ${yr} (to ${X.ledgerLabel}):\n${list(r.map(x => `${x.k}: **${fmtFull(x.rev)}**`))}`; },
    top3: () => { const K = ytdNow(), r = rankBy(K, i => X.verkopers[X.facts.v[i]], 99), t = r.reduce((s, x) => s + x.rev, 0), s3 = r.slice(0, 3).reduce((s, x) => s + x.rev, 0); return `The top 3 verkopers bring **${fmtShare(s3 / t * 100)}** of ${yr} revenue (${fmtFull(s3)} of ${fmtFull(t)}): ${r.slice(0, 3).map(x => x.k).join(', ')}.`; },
    mpRep: () => { const K = sales(F('ytdNow', { grps: ['Milk powder'] })), r = [...aggregate(K.cur, i => X.verkopers[X.facts.v[i]]).values()].sort((a, b) => b.kg - a.kg).slice(0, 5); return `Milk powder tonnes by verkoper in ${yr}:\n${list(r.map(x => `${x.k}: **${t1(x.kg)}** (${fmtFull(x.rev)})`))}`; },
    topCust: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.c[i]); return `Top 5 customers in ${yr}:\n${list(r.map(x => `${X.customers[x.k][0]} (${X.customers[x.k][1]}): **${fmtFull(x.rev)}**`))}`; },
    custCount: () => { const K = ytdNow(), n = [...aggregate(K.cur, i => X.facts.c[i]).values()].filter(x => x.rev > 0).length; return `**${fmtN(n)} customers** bought in ${yr} (to ${X.ledgerLabel}), out of ${fmtN(X.customers.length)} in the customer list.`; },
    top15: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.c[i], 9999), t = r.reduce((s, x) => s + x.rev, 0), s = r.slice(0, 15).reduce((a, x) => a + x.rev, 0); return `The top 15 customers bring **${fmtShare(s / t * 100)}** of ${yr} revenue (${fmtFull(s)}).`; },
    topProd: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.p[i]); return `Best-selling products in ${yr}:\n${list(r.map(x => `${X.products[x.k][0]}: **${fmtFull(x.rev)}**`))}`; },
    grpGrowth: () => { const K = ytd(), a = aggregate(K.cur, i => X.facts.G[i]), b = aggregate(K.cmp, i => X.facts.G[i]); const r = [...a.values()].map(x => ({ n: GROUPS[x.k], g: growth(x.rev, b.get(x.k)?.rev) })).filter(x => x.g != null).sort((p, q) => q.g - p.g); return `Growth by product group, ${K.P.label} vs ${K.P.cmpLabel}:\n${list(r.map(x => `${x.n}: **${pc(x.g)}**`))}`; },
    prodCount: () => { const K = ytdNow(); return `**${fmtN([...aggregate(K.cur, i => X.facts.p[i]).values()].filter(x => x.rev > 0).length)} products** sold in ${yr}.`; },
    topCat: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.g[i], 9), t = K.rev; return `Revenue by category in ${yr}:\n${list(r.map(x => `${X.categories[x.k][0]} (${X.categories[x.k][1]}): **${fmtFull(x.rev)}** · ${fmtShare(x.rev / t * 100)}`))}`; },
    groups: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.G[i], 6), t = K.rev; return `Product groups in ${yr}:\n${list(r.map(x => `${GROUPS[x.k]}: **${fmtFull(x.rev)}** · ${fmtShare(x.rev / t * 100)}`))}`; },
    channel: () => { const K = ytdNow(), a = aggregate(K.cur, i => X.verkopers[X.facts.v[i]] === 'Webshop' ? 'Webshop' : 'Direct'); const w = a.get('Webshop')?.rev || 0, d = a.get('Direct')?.rev || 0; return `${yr} revenue: Direct **${fmtFull(d)}** (${fmtShare(d / (d + w) * 100)}) · Webshop **${fmtFull(w)}** (${fmtShare(w / (d + w) * 100)}).`; },
    webAov: () => { const f = F('ytdNow', { reps: ['Webshop'] }), K = sales(f), ms = K.P.months.filter(m => !X.isPortalM[m]), n = invoices(f, ms).length, r = [...aggregate(K.cur, () => 1).values()][0]?.revO || 0; return `Webshop average order value (invoices from Apr ${yr}): **${fmtFull(n ? r / n : 0)}** over ${fmtN(n)} invoices.`; },
    mpTonnes: () => A.mpYear(),
    topTonRep: () => { const K = ytdNow(), r = [...aggregate(K.cur, i => X.verkopers[X.facts.v[i]]).values()].sort((a, b) => b.kg - a.kg).slice(0, 5); return `Most tonnes sold in ${yr} (all products sold by weight):\n${list(r.map(x => `${x.k}: **${t1(x.kg)}**`))}`; },
    arOpen: () => { const a = arKPI(ALL); return `On ${X.ledgerLabel} customers owe **${fmtFull(a.net)}** after credits: ${fmtFull(a.open)} in ${fmtN(a.nOpen)} open invoices, minus ${fmtFull(-a.credit)} open credits (excl. VAT).`; },
    ar30: () => { const a = arKPI(ALL); return `**${fmtFull(a.over30)}** is more than 30 days past due (${fmtShare(a.over30 / a.open * 100)} of open invoices). 91+ days: ${fmtFull(a.byAge.get('91+'))}.`; },
    arTop: () => { const a = arKPI(ALL), m = new Map(); for (const r of a.R) if (r[6] > 0) m.set(r[0], (m.get(r[0]) || 0) + r[6] / 100); const t = [...m].sort((x, y) => y[1] - x[1]).slice(0, 5); return `Largest open balances:\n${list(t.map(([c, v]) => `${X.customers[c][0]}: **${fmtFull(v)}**`))}`; },
    late: () => { const R = reorder(ALL, false).rows; return `**${R.length} customer-product pairs** are late to reorder. Biggest:\n${list(R.slice(0, 5).map(r => `${X.customers[r.c][0]} – ${X.products[r.p][0]}: ${r.since} days since last order (usually ${Math.round(r.gap)})`))}`; },
    risk: () => { const R = reorder(ALL, false).rows; return `About **${fmtFull(R.reduce((s, r) => s + r.mrev, 0))} per month** of revenue sits with buyers who are late to reorder (${R.length} pairs).`; },
    mpPrice: () => { const K = sales(F('ytd', { grps: ['Milk powder'] }), i => X.kgProd.has(X.facts.p[i])); return `Milk powder averages **${e2(K.rev / K.kg)}/kg** in ${K.P.label} (${t1(K.kg)}), vs ${e2(K.revC / K.kgC)}/kg a year earlier.`; },
    feedPrice: () => { const K = sales(F('ytd', { grps: ['Feed'] }), i => X.kgProd.has(X.facts.p[i])); return `Feed averages **${e2(K.rev / K.kg)}/kg** in ${K.P.label} (${t1(K.kg)})${K.kgC ? `, vs ${e2(K.revC / K.kgC)}/kg a year earlier` : ''}.`; },
    topMkt: () => { const K = ytdNow(), r = rankBy(K, i => X.facts.M[i]); return `Biggest markets in ${yr}:\n${list(r.map(x => `${X.mkts[x.k]}: **${fmtFull(x.rev)}** · ${fmtShare(x.rev / K.rev * 100)}`))}`; },
    export: () => { const K = ytdNow(), nl = aggregate(K.cur, i => X.mkts[X.facts.M[i]] === 'Netherlands' ? 'NL' : 'X'); const x = nl.get('X')?.rev || 0; return `Export (outside the Netherlands) is **${fmtShare(x / K.rev * 100)}** of ${yr} revenue (${fmtFull(x)}).`; },
    books: () => { const R = X.pnl.filter(r => r[0] >= X.meta.booksOpening.slice(0, 7)); const s = p => R.filter(p).reduce((a, r) => a + r[4], 0) / 100; const rev = s(r => r[2] === 'Revenue'), cost = -s(r => r[2] !== 'Revenue'); return `Books ${mLong(X.meta.booksOpening.slice(0, 7))} – ${X.ledgerLabel}: revenue **${fmtFull(rev)}**, costs ${fmtFull(cost)}, result **${fmtFull(rev - cost)}**.\nPurchases are booked when bought, not when sold, so this is indicative.`; },
    gm: () => { const R = X.pnl.filter(r => r[0] >= X.meta.booksOpening.slice(0, 7)); const s = c => R.filter(r => r[2] === c).reduce((a, r) => a + r[4], 0) / 100; const rev = s('Revenue'), pur = -s('Purchases'); return `Indicative gross margin in the books: **${fmtFull(rev - pur)}** (${fmtShare((rev - pur) / rev * 100)}) — revenue ${fmtFull(rev)} minus purchases ${fmtFull(pur)}.`; },
    costs: () => { const m = new Map(); for (const r of X.pnl) if (r[0] >= X.meta.booksOpening.slice(0, 7) && r[2] !== 'Revenue') m.set(r[1], (m.get(r[1]) || 0) - r[4] / 100); const t = [...m].sort((a, b) => b[1] - a[1]).slice(0, 5); return `Biggest cost accounts since ${mLong(X.meta.booksOpening.slice(0, 7))}:\n${list(t.map(([k, v]) => `${k}: **${fmtFull(v)}**`))}`; },
    purch: () => { const R = X.pnl.filter(r => r[0] >= X.meta.booksOpening.slice(0, 7)); const s = c => R.filter(r => r[2] === c).reduce((a, r) => a + r[4], 0) / 100; return `Purchases are **${fmtShare(-s('Purchases') / s('Revenue') * 100)}** of booked revenue (${fmtFull(-s('Purchases'))} of ${fmtFull(s('Revenue'))}).`; },
    accts: () => `The books hold **${fmtN(new Set(X.pnl.filter(r => r[0] >= X.meta.booksOpening.slice(0, 7)).map(r => r[1])).size)} accounts** with postings since ${mLong(X.meta.booksOpening.slice(0, 7))}.`,
    openVal: () => { if (!hasOrderValues) return 'This dash.json has no € values on order lines.'; const v = orderValue(X.orders.filter(o => o[5])); return `Open order value: **${fmtFull(v.tot)}** — ${fmtFull(v.del)} delivered but not yet invoiced, ${fmtFull(v.left)} still to deliver (excl. VAT, order-line prices).`; },
    summary: () => { const K = ytdNow(), a = arKPI(ALL); return `Key numbers (${yr} to ${X.ledgerLabel}):\n• Revenue **${fmtFull(K.rev)}**\n• Milk powder ${t1(sales(F('ytdNow', { grps: ['Milk powder'] })).kg)}\n• Owed after credits ${fmtFull(a.net)} (${fmtFull(a.over30)} > 30 days late)\n• ${reorder(ALL, false).rows.length} buyers late to reorder`; },
  };
  
  /* entity lookups: customers, verkopers, products, categories, markets, groups */
  const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ents = [];
  X.customers.forEach((c, i) => ents.push({ t: 'customer', i, n: c[0], k: norm(c[0]) }));
  X.verkopers.forEach((v, i) => ents.push({ t: 'verkoper', i, n: v, k: norm(v) }));
  [...new Set(X.products.map(p => p[0]))].forEach(n => ents.push({ t: 'product', n, k: norm(n), ids: X.products.map((p, i) => p[0] === n ? i : -1).filter(i => i >= 0) }));
  X.categories.forEach((c, i) => ents.push({ t: 'category', i, n: c[0], k: norm(c[0]) }));
  X.mkts.forEach((m, i) => ents.push({ t: 'market', i, n: m, k: norm(m) }));
  GROUPS.slice(0, 5).forEach((g, i) => ents.push({ t: 'group', i, n: g, k: norm(g) }));
  const first = new Map(); X.verkopers.forEach((v, i) => { const f = norm(v.split(' ')[0]); if (f.length >= 3 && !first.has(f)) first.set(f, i); });
  const findEntity = q => {
    const nq = ' ' + norm(q) + ' ';
    let best = null;
    for (const e of ents) if (e.k.length >= 4 && nq.includes(' ' + e.k + ' ') && (!best || e.k.length > best.k.length)) best = e;
    if (best) return best;
    for (const [f, i] of first) if (nq.includes(' ' + f + ' ')) return ents.find(e => e.t === 'verkoper' && e.i === i);
    for (const e of ents) if (e.k.length >= 6 && e.t !== 'customer' && nq.includes(' ' + e.k.split(' ')[0] + ' ') && e.k.split(' ')[0].length >= 6) return e;
    return null;
  };
  const predOf = e => e.t === 'customer' ? i => X.facts.c[i] === e.i : e.t === 'verkoper' ? i => X.facts.v[i] === e.i : e.t === 'product' ? (s => i => s.has(X.facts.p[i]))(new Set(e.ids)) : e.t === 'category' ? i => X.facts.g[i] === e.i : e.t === 'market' ? i => X.facts.M[i] === e.i : i => X.facts.G[i] === e.i;
  const entityAnswer = e => {
    const pred = predOf(e), N = sales(F('ytdNow'), pred), C = sales(F('ytd', { cmp: 'py' }), pred), L12 = sales(F('l12'), pred);
    const lines = [`**${e.n}** (${e.t}) — ${yr} to ${X.ledgerLabel}: **${fmtFull(N.rev)}**${N.kg ? ` · ${t1(N.kg)}` : ''}.`];
    if (C.revC) lines.push(`Complete months ${C.P.label}: ${fmtFull(C.rev)} vs ${fmtFull(C.revC)} a year earlier (${pc(growth(C.rev, C.revC))}).`);
    lines.push(`Last 12 complete months: ${fmtFull(L12.rev)}.`);
    const top = (key, lab, nm) => { const r = [...aggregate(N.cur, key).values()].sort((a, b) => b.rev - a.rev).slice(0, 3).filter(x => x.rev > 0); if (r.length) lines.push(`Top ${lab}: ${r.map(x => `${nm(x.k)} ${fmtFull(x.rev)}`).join(' · ')}.`); };
    if (e.t === 'customer') {
      const c = X.customers[e.i]; lines.splice(1, 0, `Market ${c[1]} · verkoper ${c[2]}.`);
      const a = arKPI({ reps: [], mkts: [] }); let open = 0; for (const r of a.R) if (r[0] === e.i && r[6] > 0) open += r[6] / 100;
      if (open) lines.push(`Still open (unpaid invoices): ${fmtFull(open)}.`);
      top(i => X.facts.p[i], 'products', k => X.products[k][0]);
    } else if (e.t === 'verkoper') top(i => X.facts.c[i], 'customers', k => X.customers[k][0]);
    else if (e.t === 'market' || e.t === 'group' || e.t === 'category') top(i => X.facts.c[i], 'customers', k => X.customers[k][0]);
    else top(i => X.facts.c[i], 'buyers', k => X.customers[k][0]);
    return lines.join('\n') + src;
  };
  /* "revenue in March 2026", "revenue 2025" */
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const periodAnswer = q => {
    const nq = norm(q); if (!/(revenue|turnover|sales|omzet|sold)/.test(nq)) return null;
    const ym = nq.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (20\d\d)\b/);
    if (ym) { const m = X.months.indexOf(`${ym[2]}-${String(MONTHS.indexOf(ym[1]) + 1).padStart(2, '0')}`); if (m < 0) return `There is no data for that month (data runs ${mLong(X.months[0])} – ${mLong(X.months[X.nM - 1])}).`; const r = legacy(ALL).monthly[m]; return `${mLong(X.months[m])}: **${fmtFull(r.rev)}**${m === X.partial.m ? ` (to ${X.partial.day})` : ''}${m >= 12 ? ` vs ${fmtFull(legacy(ALL).monthly[m - 12].rev)} a year earlier` : ''}.` + src; }
    const y = nq.match(/\b(20\d\d)\b/);
    if (y) { const ms = X.months.map((v, i) => [v, i]).filter(([v]) => v.startsWith(y[1])); if (!ms.length) return null; const tot = ms.reduce((s, [, i]) => s + legacy(ALL).monthly[i].rev, 0); return `${y[1]}: **${fmtFull(tot)}** over ${ms.length} month${ms.length > 1 ? 's' : ''}${ms.length < 12 ? ` (${mLong(ms[0][0])} – ${mLong(ms[ms.length - 1][0])})` : ''}.` + src; }
    return null;
  };
  _cache = { A, findEntity, entityAnswer, periodAnswer, X, GROUPS, sales, F, aggregate, arKPI, reorder, legacy, orderValue, hasOrderValues, fmtFull, fmtN, fmtShare, growth, mLong, t1, yr, ALL };
  _cacheFor = M;
  return _cache;
}

const Q = {
  'How much have we sold this month so far?': 'mtd', 'How did the last 3 complete months compare with last year?': 'last3', 'How much milk powder did we sell this year?': 'mpYear',
  'What was our best month?': 'best', 'How does this year compare with last year?': 'yoy', 'What is the average monthly revenue?': 'avg',
  'Who is the top verkoper?': 'topRep', 'How concentrated is revenue in the top 3 verkopers?': 'top3', 'Which verkoper sells the most milk powder?': 'mpRep',
  'Who are our top 5 customers?': 'topCust', 'How many customers bought this year?': 'custCount', 'What share of revenue comes from the top 15 customers?': 'top15',
  'What is our best-selling product?': 'topProd', 'Which product groups grow fastest?': 'grpGrowth', 'How many products did we sell?': 'prodCount',
  'Which category has the biggest share of revenue?': 'topCat', 'How does each product group compare?': 'groups',
  'How is revenue split between webshop and direct?': 'channel', 'What is the webshop average order value?': 'webAov',
  'How many tonnes of milk powder did we sell?': 'mpTonnes', 'Who sells the most tonnes?': 'topTonRep',
  'How much is still open?': 'arOpen', 'How much is overdue more than 30 days?': 'ar30', 'Which customers owe us the most?': 'arTop',
  'Which customers are late to reorder?': 'late', 'How much monthly revenue is at risk?': 'risk',
  'What is the milk powder price per kg?': 'mpPrice', 'What is the feed price per kg?': 'feedPrice',
  'Which market is the biggest?': 'topMkt', 'What share of revenue is export?': 'export',
  'What is the result in the books?': 'books', 'What is the gross margin?': 'gm', 'What are our biggest cost accounts?': 'costs', 'What are the biggest cost accounts?': 'costs',
  'How big are purchases compared with revenue?': 'purch', 'How many accounts are in the books?': 'accts',
  'What can you tell me about this page?': 'summary', 'What is our open order value?': 'openVal', 'Summarize the key numbers': 'summary',
};
const TOPIC = { mtd: 'revenue', last3: 'revenue', best: 'revenue', yoy: 'revenue', avg: 'revenue', mpYear: 'tonnage', mpTonnes: 'tonnage', topTonRep: 'tonnage', mpRep: 'tonnage', topRep: 'salesreps', top3: 'salesreps', topCust: 'customers', custCount: 'customers', top15: 'customers', topProd: 'products', grpGrowth: 'products', prodCount: 'products', topCat: 'categories', groups: 'categories', channel: 'channels', webAov: 'channels', arOpen: 'debtor', ar30: 'debtor', arTop: 'debtor', late: 'orders', risk: 'orders', mpPrice: 'products', feedPrice: 'products', topMkt: 'general', export: 'general', books: 'finance', gm: 'finance', costs: 'finance', purch: 'finance', accts: 'finance', summary: 'general', openVal: 'orders' };

const normQ = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const NQ = new Map(Object.entries(Q).map(([k, v]) => [normQ(k), v]));
/* Dutch chip prompts map back to the same answers */
for (const [en, nlq] of Object.entries(QUESTION_NL)) if (Q[en]) NQ.set(normQ(nlq), Q[en]);
const TOPIC_OF_ENTITY = { customer: 'customers', verkoper: 'salesreps', product: 'products', category: 'categories', market: 'general', group: 'categories' };

/** Local answer, or { answer: null } when the question needs the AI. */
export function resolve(question, _opts, data) {
  if (!data || !data.X) return { answer: null, topic: 'general' };
  const E = engine(data);
  const k = NQ.get(normQ(question));
  if (k) return { answer: E.A[k](), topic: TOPIC[k] || 'general', subject: [] };
  const p = E.periodAnswer(question); if (p) return { answer: p, topic: 'revenue' };
  const e = E.findEntity(question);
  if (e) return { answer: E.entityAnswer(e), topic: TOPIC_OF_ENTITY[e.t] || 'general', subject: [e.n] };
  return { answer: null, topic: 'general' };
}

/** When the AI is not reachable. */
export function buildFallbackAnswer(_question, opts = {}) {
  const nl = opts.lang === 'nl';
  return nl ? 'Die vraag kan ik nu niet beantwoorden zonder de AI-assistent. Probeer een van de voorgestelde vragen, of noem een klant, verkoper, product, markt of maand.'
    : "I can't answer that one without the AI assistant right now. Try one of the suggested questions, or name a customer, verkoper, product, market or month.";
}

/** Compact dash.json summary for the AI. */
export function buildDataContext(_queryText, data) {
  const E = engine(data), { X, GROUPS, sales, F, aggregate, arKPI, reorder, legacy, orderValue, hasOrderValues, fmtFull, t1 } = E;
  const out = [];
  out.push(`Source: dash.json snapshot ${X.snapshotLabel}; last invoice ${X.ledgerLabel}; amounts EUR excl. VAT. ${X.mLabel[X.nM - 1]} is incomplete (to day ${X.partial.day}). Jan 2025 – Mar 2026 are monthly totals only (no weeks/days/invoices).`);
  out.push('MONTHLY REVENUE|' + legacy({ reps: [], grps: [], mkts: [] }).monthly.map(r => `${r.m} ${Math.round(r.rev)}`).join('|'));
  const N = sales(F('ytdNow')), C = sales(F('ytd', { cmp: 'py' }));
  out.push(`YTD ${E.yr} to ${X.ledgerLabel}: ${Math.round(N.rev)} · complete months ${C.P.label}: ${Math.round(C.rev)} vs ${Math.round(C.revC)} (${C.P.cmpLabel})`);
  const tbl = (title, key, name, n = 15) => out.push(title + '|' + [...aggregate(N.cur, key).values()].sort((a, b) => b.rev - a.rev).slice(0, n).map(x => `${name(x.k)} ${Math.round(x.rev)}${x.kg ? ' ' + Math.round(x.kg / 1000) + 't' : ''}`).join('|'));
  tbl('GROUPS YTD', i => X.facts.G[i], k => GROUPS[k], 6);
  tbl('VERKOPERS YTD', i => X.facts.v[i], k => X.verkopers[k], 20);
  tbl('TOP CUSTOMERS YTD', i => X.facts.c[i], k => `${X.customers[k][0]} (${X.customers[k][1]}, ${X.customers[k][2]})`, 15);
  tbl('TOP PRODUCTS YTD', i => X.facts.p[i], k => X.products[k][0], 15);
  tbl('MARKETS YTD', i => X.facts.M[i], k => X.mkts[k], 12);
  const a = arKPI({ reps: [], mkts: [] });
  out.push(`RECEIVABLES on ${X.ledgerLabel}: open invoices ${Math.round(a.open)} (${a.nOpen}), overdue ${Math.round(a.over)}, >30 days late ${Math.round(a.over30)}, open credits ${Math.round(-a.credit)}, owed after credits ${Math.round(a.net)}`);
  const R = reorder({ reps: [], mkts: [] }, false).rows;
  out.push(`REORDER RADAR: ${R.length} late customer-product pairs, ${Math.round(R.reduce((s, r) => s + r.mrev, 0))} EUR/month at risk|` + R.slice(0, 10).map(r => `${X.customers[r.c][0]} – ${X.products[r.p][0]} ${r.since}d since (usual ${Math.round(r.gap)}d)`).join('|'));
  if (hasOrderValues) { const v = orderValue(X.orders.filter(o => o[5])); out.push(`OPEN ORDERS: ${Math.round(v.tot)} (delivered not invoiced ${Math.round(v.del)}, still to deliver ${Math.round(v.left)})`); }
  const B = X.pnl.filter(r => r[0] >= X.meta.booksOpening.slice(0, 7)), cat = new Map(); for (const r of B) cat.set(r[2], (cat.get(r[2]) || 0) + r[4] / 100);
  out.push(`BOOKS since ${X.meta.booksOpening} by category|` + [...cat].map(([k, v]) => `${k} ${Math.round(v)}`).join('|'));
  void fmtFull; void t1;
  return out.join('\n');
}

const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch', de: 'German' };
export function buildSystemPrompt(lang = 'en', queryText = '', data, opts = {}) {
  let ctx; try { ctx = buildDataContext(queryText, data); } catch { ctx = 'Data context could not be built.'; }
  const c = opts.context;
  const page = c?.pageName ? `The user is on the "${c.pageName}" page${c.dateRange ? `, period shown ${c.dateRange}` : ''}.` : '';
  return `You are the DairyTop sales & finance dashboard assistant. Answer ONLY from DATA below.
Rules:
1. Never invent figures that are not in DATA. If DATA lacks what is needed, say in one sentence what is missing.
2. Amounts are EUR excl. VAT; write them like €1.234.567. Weights in tonnes.
3. The latest month is incomplete — say so whenever you use it.
4. For "why" questions, point to the biggest movers in DATA; label anything beyond the figures as a possible explanation.
5. Be brief: at most 6 short lines. Plain text; **bold** only for key figures.
6. Decline anything unrelated to this dashboard in one sentence.
7. Reply in ${LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en}.
${page}
DATA (pipe-separated):
${ctx}`;
}

/** Keep the conversation sent to the model short: last few turns, trimmed. */
export function compactHistory(messages, maxTurns = 6, maxChars = 500) {
  return (messages || []).filter(m => m.role === 'user' || m.role === 'bot').slice(-maxTurns).map(m => ({ role: m.role, text: String(m.text || '').slice(0, maxChars) }));
}

/** Every prefilled question, for tests and chips. */
export const KNOWN_QUESTIONS = Object.keys(Q);

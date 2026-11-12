/* ── CHATBOT AI CONTEXT ──────────────────────────────────────────────────
   Only used when the local engine (chatFallback.js) cannot answer — i.e.
   "why / predict / recommend" questions or wording it does not understand.

   The prompt is built from SLICES: a small always-on base (months, KPIs,
   sales reps, categories) plus only the tables the question actually needs.
   Typical size is 1–4k tokens instead of the whole dataset (~150k before).
   All figures are pre-aggregated here, so the model explains — it does not
   have to add up thousands of rows.
   This file is identical in knitworks-dashboard and knitworks-dashboard-1.
   ───────────────────────────────────────────────────────────────────── */
import { parseQuestion } from './chatLanguage.js';
import { makeEnv, buildPeriods, rowsFor, group, previousOf, monthId, debtorRisk, debtorNonPayer } from './chatFallback.js';

export { resolve, answerFromData, buildFallbackAnswer } from './chatFallback.js';

const r0 = n => Math.round(Number(n) || 0);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mLabel = id => `${MON[id % 12]} ${String(Math.floor(id / 12) % 100).padStart(2, '0')}`;
const todayStr = () => { const n = new Date(); return `${String(n.getDate()).padStart(2, '0')}/${String(n.getMonth() + 1).padStart(2, '0')}/${n.getFullYear()}`; };
const table = (title, header, rows) => rows.length ? `\n## ${title}\n${header}\n${rows.join('\n')}` : '';
const topRows = (groups, n) => [...groups].sort((a, b) => b.rev - a.rev).slice(0, n).map(g => `${g.name}|${r0(g.rev)}|${g.orders}`);

/** Which slices does this question need? `text` = current question + the last couple of user turns. */
function wanted(text, d, prevSubject = []) {
  const { tags, unknown } = parseQuestion(text, d);
  const all = [...prevSubject, ...tags];
  const has = (k, v) => all.some(t => t.k === k && (v === undefined || t.v === v));
  const type = v => has('dim', v) || all.some(t => t.k === 'ent' && t.e.type === v);
  return {
    tags: all, unknown,
    customers: type('customers'), products: type('products'), salesreps: type('salesreps'), categories: type('categories'),
    debtor: has('dom', 'debtor') || has('debtor'), finance: has('dom', 'finance') || has('fin') || type('fincat'),
    orders: has('dom', 'openorders') || has('dom', 'mtd'), tonnage: has('metric', 'tonnage'),
    weeks: has('gran', 'week') || has('time', 'thisweek') || has('time', 'lastweek'),
    days: has('gran', 'day') || has('time', 'today') || has('time', 'yesterday') || has('date'),
    reasoning: has('ai') || has('predict'),
    ents: all.filter(t => t.k === 'ent').map(t => t.e),
  };
}

/**
 * Compact, pre-aggregated data for the model. Pipe-separated tables, EUR rounded.
 * @param {string} queryText  current question (+ recent user turns)
 * @param {object} d          dashboard data
 * @param {{prev?:Array, context?:object}} opts
 */
export function buildDataContext(queryText = '', d = {}, opts = {}) {
  const env = makeEnv(d || {}, opts, 'en');
  if (!env.monthIds.length) return 'No sales data is loaded.';
  const w = wanted(queryText, env.d, opts.prev);
  const { latest, latestYear } = env;
  const ytd = { g: 'm', from: latestYear * 12, to: latest }, all = { g: 'all', from: env.first, to: latest };
  const period = buildPeriods(w.tags, env).list.find(p => p.g === 'm' && p.kind !== 'all') || null;
  const out = [];

  out.push(`today=${todayStr()} | data refreshed=${d.lastUpdated || '?'} | last invoice date=${d.maxFactuurDatum || '?'} | latest month=${mLabel(latest)} (INCOMPLETE — never compare it with full months without saying so)`);
  out.push(table('Monthly totals (all months)', 'month|revenue|orders', (d.monthly || []).map(m => `${m.m}|${r0(m.rev)}|${m.orders}`)));
  const kpi = [];
  if (d.openOrderValuePresent != null) kpi.push(`open orders present=${r0(d.openOrderValuePresent)} future=${r0(d.openOrderValueFuture)}`);
  if (d.projectedMTD != null) kpi.push(`MTD invoiced=${r0(d.turnoverMTD)} projected month=${r0(d.projectedMTD)}`);
  if (d.totalClients) kpi.push(`total clients=${d.totalClients}`);
  if (kpi.length) out.push(`\n## KPIs\n${kpi.join(' | ')}`);

  const repsAll = group(rowsFor(env, 'salesreps', all)), repsYtd = new Map(group(rowsFor(env, 'salesreps', ytd)).map(g => [g.name, g]));
  out.push(table(`Sales reps ("Webshop" = webshop channel, the rest = direct sales)`, `name|revenue all-time|orders all-time|revenue ${latestYear} YTD`, [...repsAll].sort((a, b) => b.rev - a.rev).map(g => `${g.name}|${r0(g.rev)}|${g.orders}|${r0(repsYtd.get(g.name)?.rev)}`)));
  const catsAll = group(rowsFor(env, 'categories', all)), catsYtd = new Map(group(rowsFor(env, 'categories', ytd)).map(g => [g.name, g]));
  out.push(table('Categories', `name|revenue all-time|orders all-time|revenue ${latestYear} YTD`, [...catsAll].sort((a, b) => b.rev - a.rev).map(g => `${g.name}|${r0(g.rev)}|${g.orders}|${r0(catsYtd.get(g.name)?.rev)}`)));

  // What moved between the asked month/period and the one before — the raw material for "why" questions.
  const focus = period || (w.reasoning ? { g: 'm', from: latest - 1, to: latest - 1, label: mLabel(latest - 1), kind: 'range' } : null);
  if (focus) {
    const prev = previousOf(focus, env);
    if (prev) {
      const movers = (type, n) => {
        const a = new Map(group(rowsFor(env, type, focus)).map(g => [g.name, g.rev])), b = new Map(group(rowsFor(env, type, prev)).map(g => [g.name, g.rev]));
        return [...new Set([...a.keys(), ...b.keys()])].map(name => ({ name, a: a.get(name) || 0, b: b.get(name) || 0 }))
          .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, n).map(x => `${x.name}|${r0(x.a)}|${r0(x.b)}|${r0(x.a - x.b)}`);
      };
      const head = `name|${focus.label}|${prev.label}|change`;
      out.push(table(`Biggest movers — categories (${focus.label} vs ${prev.label})`, head, movers('categories', 8)));
      out.push(table('Biggest movers — sales reps', head, movers('salesreps', 8)));
      out.push(table('Biggest movers — customers', head, movers('customers', 12)));
      if (w.products || w.reasoning) out.push(table('Biggest movers — products', head, movers('products', 12)));
    }
  }

  const entityRows = type => w.ents.filter(e => e.type === type).flatMap(e => (d[type] || []).filter(row => e.names.includes(String(row.n).trim())).map(row => `${e.name}|${row.m}|${r0(row.rev)}|${row.orders}`));
  for (const type of ['customers', 'products']) {
    if (!w[type]) continue;
    const allG = group(rowsFor(env, type, all)), ytdG = group(rowsFor(env, type, ytd));
    out.push(table(`Top 25 ${type} all-time (${allG.length} in total, revenue ${r0(allG.reduce((s, g) => s + g.rev, 0))})`, 'name|revenue|orders', topRows(allG, 25)));
    out.push(table(`Top 25 ${type} ${latestYear} YTD (${ytdG.length} active)`, 'name|revenue|orders', topRows(ytdG, 25)));
    if (period) out.push(table(`Top 15 ${type} in ${period.label}`, 'name|revenue|orders', topRows(group(rowsFor(env, type, period)), 15)));
    out.push(table(`Named ${type} by month`, 'name|month|revenue|orders', entityRows(type)));
  }
  const last13 = id => id >= latest - 12;
  if (w.salesreps) out.push(table('Sales reps by month (last 13 months)', 'name|month|revenue|orders', (d.salesreps || []).filter(row => last13(monthId(row.m))).map(row => `${String(row.n).trim()}|${row.m}|${r0(row.rev)}|${row.orders}`)));
  if (w.categories) out.push(table('Categories by month (last 13 months)', 'name|month|revenue|orders', (d.categories || []).filter(row => last13(monthId(row.m))).map(row => `${String(row.n).trim()}|${row.m}|${r0(row.rev)}|${row.orders}`)));
  if (w.salesreps && w.categories) out.push(table('Sales rep × category', 'rep|category|revenue|orders', (d.salesmanCategorySales || []).map(row => `${row.salesman}|${row.category}|${r0(row.rev)}|${row.orders}`)));
  if (w.weeks) out.push(table('Weekly totals (last 12 weeks, latest may be incomplete)', 'week|start|revenue|orders', env.weeks.slice(-12).map(x => `${x.w}|${x.start}|${r0(x.rev)}|${x.orders}`)));
  if (w.days) out.push(table('Daily totals (last 14 invoicing days)', 'date|revenue|orders', env.days.slice(-14).map(x => `${x.label}|${r0(x.rev)}|${x.orders}`)));
  if (w.tonnage) {
    out.push(table('Tonnage by category', 'category|tonnes|revenue', (d.totalTonnageByCategory || []).map(row => `${row.category}|${row.tonnage}|${r0(row.revenue)}`)));
    out.push(table('Tonnage by sales rep and category', 'rep|category|tonnes|revenue', (d.tonnagePerSalesman || []).map(row => `${row.salesman}|${row.category}|${row.tonnage}|${r0(row.revenue)}`)));
  }
  if (w.finance && d.finSummary) {
    const f = d.finSummary;
    out.push(`\n## Finance (P&L) — periods: ${d.finPeriodLabel || '?'} (UNEQUAL lengths: compare margins/monthly averages, not totals)\nrevenue cy=${r0(f.revenue.cy)} py=${r0(f.revenue.py)} | COGS cy=${r0(f.cogs.cy)} py=${r0(f.cogs.py)} | OPEX cy=${r0(f.opex.cy)} py=${r0(f.opex.py)} | gross profit = revenue − COGS | EBITDA = gross profit − OPEX`);
    out.push(table('Finance categories', 'category|cy|py', (d.finCategories || []).map(c => `${c.cat}|${r0(c.cy)}|${r0(c.py)}`)));
    const lines = d.finLines || [];
    const pick = new Set([...[...lines].sort((a, b) => Math.abs(b.cy) - Math.abs(a.cy)).slice(0, 20), ...[...lines].sort((a, b) => Math.abs(b.yoy || 0) - Math.abs(a.yoy || 0)).slice(0, 12)]);
    out.push(table('Ledger lines (largest by value and by change)', 'account|category|description|cy|py', [...pick].map(l => `${l.acct}|${l.cat}|${l.desc}|${r0(l.cy)}|${r0(l.py)}`)));
  }
  if (w.debtor && (d.debtorKPI || d.debtorCustomers)) {
    const custs = (d.debtorCustomers || []).map(c => ({ ...c, risk: debtorRisk(c), nonPayer: debtorNonPayer(c) }));
    const k = d.debtorKPI || {};
    out.push(`\n## Accounts receivable as of ${d.debtorAsOf || '?'}\ntotal open=${r0(k.totalDebtorValue)} | over 30 days=${r0(k.over30)} | over 90 days=${r0(k.over90)} | open invoices=${k.openInvoiceCount} | customers=${custs.length} | non-payers (oldest invoice >60 days)=${custs.filter(c => c.nonPayer).length} | risk A/B/C/D=${['A', 'B', 'C', 'D'].map(x => custs.filter(c => c.risk === x).length).join('/')} (A <30d, B 30–60d, C 60+d under €5k, D 90+d and ≥€5k)`);
    out.push(table('Ageing', 'bucket (days)|value|invoices', (d.debtorAgeing || []).map(b => `${b.bucket}|${r0(b.value)}|${b.count}`)));
    out.push(table('Top 20 open balances', 'customer|open|oldest invoice age (days)|avg days to pay|risk', [...custs].sort((a, b) => b.openValue - a.openValue).slice(0, 20).map(c => `${c.name}|${r0(c.openValue)}|${c.ageOfOldest}|${c.avgDaysToPay ?? ''}|${c.risk}`)));
    out.push(table('Payment behaviour by period', 'period|avg days to pay|% paid within 30 days|invoices', (d.debtorQuarterlyYearly || []).map(x => `${x.period}|${x.avgDays}|${x.pct30}|${x.invoiceCount}`)));
    const named = w.ents.filter(e => e.type === 'customers').flatMap(e => custs.filter(c => e.names.includes(c.name)));
    out.push(table('Named customers — receivables', 'customer|open|invoices|oldest age|avg days to pay|risk', named.map(c => `${c.name}|${r0(c.openValue)}|${c.openInvoices}|${c.ageOfOldest}|${c.avgDaysToPay ?? ''}|${c.risk}`)));
  }
  return out.filter(Boolean).join('\n');
}

const LANGUAGE_NAMES = { en: 'English', nl: 'Dutch (Nederlands)' };
const CTX_FOCUS = {
  overview: '', sales: 'Focus on revenue, customers, products and sales reps.', finance: 'Focus on the P&L: COGS, OPEX, gross profit, EBITDA.',
  orders: 'Focus on open orders and month-to-date vs projection.', reps: 'Focus on sales rep performance.',
};

/**
 * System prompt for the AI call.
 * @param {'en'|'nl'} lang
 * @param {string} queryText  current question + recent user turns
 * @param {object} d          dashboard data
 * @param {{prev?:Array, context?:object, ctxKey?:string}} opts
 */
export function buildSystemPrompt(lang = 'en', queryText = '', d = {}, opts = {}) {
  let data;
  try { data = buildDataContext(queryText, d, opts); } catch { data = 'Data context could not be built.'; }
  const ctx = opts.context;
  const page = ctx?.pageName ? `The user is on the "${ctx.pageName}" page${ctx.dateRange ? `, period shown ${ctx.dateRange}` : ''}. ${CTX_FOCUS[opts.ctxKey] || ''}` : (CTX_FOCUS[opts.ctxKey] || '');
  return `You are the DairyTop sales & finance dashboard assistant. Answer ONLY from DATA below.
Rules:
1. Never invent figures about the past or present that are not in DATA. If DATA lacks what is needed, say in one sentence what is missing.
1b. When the user asks for a forecast, prediction or estimate, DO give one: project it from the monthly trend and year-over-year change in DATA, state the number, the simple method used and that it is an estimate. Never refuse a forecast because future data is missing.
2. Amounts are EUR; write them like €1.234.567. Month codes: "Jan 25" = January 2025.
3. The latest month is incomplete — say so whenever you use it.
4. For "why" questions, point to the biggest movers in DATA; label anything beyond the figures as a possible explanation, not a fact.
5. Be brief: at most 6 short lines. Plain text; **bold** only for key figures. No headings, tables or code.
6. Decline anything unrelated to this dashboard in one sentence.
7. Reply in ${LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en}.
${page}
DATA (tables are pipe-separated):
${data}`;
}

/** Keep the conversation sent to the model short: last few turns, trimmed. */
export function compactHistory(messages, maxTurns = 6, maxChars = 500) {
  return (messages || []).filter(m => m.role === 'user' || m.role === 'bot').slice(-maxTurns)
    .map(m => ({ role: m.role, text: String(m.text || '').slice(0, maxChars) }));
}

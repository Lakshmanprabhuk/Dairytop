/* ── CHATBOT DATA CONTEXT ────────────────────────────────────────
   Builds a compact JSON summary of everything in data.js and turns
   it into a system prompt for the Gemini chatbot. The raw arrays in
   data.js (customers, products) run into the thousands of rows, so
   we aggregate + cap them here rather than sending the raw data —
   otherwise a single request would be megabytes of JSON.

   IMPORTANT: this file is the single source of truth for what the
   chatbot is allowed to know. If you want the bot to be able to
   answer a new kind of question, add the relevant aggregate here —
   do NOT let the bot fall back on general knowledge.
   ------------------------------------------------------------------ */

import {
  monthly,
  salesreps as salesrepsRaw,
  categories as categoriesRaw,
  customers as customersRaw,
  products as productsRaw,
  totalClients,
  lastUpdated,
  maxFactuurDatum,
  finSummary,
  finCategories,
  finLines,
} from './data.js';

// Groups raw {n, m, rev, orders, qty} rows by name and sums rev/orders/qty.
function aggregate(rawArr, keyFn) {
  const g = {};
  rawArr.forEach(r => {
    const k = keyFn(r);
    if (!g[k]) g[k] = { name: k, revenue: 0, orders: 0, qty: 0 };
    g[k].revenue += r.rev || 0;
    g[k].orders += r.orders || 0;
    g[k].qty += r.qty || 0;
  });
  return Object.values(g).sort((a, b) => b.revenue - a.revenue);
}

const TOP_CUSTOMERS_LIMIT = 30;
const TOP_PRODUCTS_LIMIT = 30;
const TOP_FIN_LINES_LIMIT = 40;

/**
 * Returns a plain JS object — the ONLY data the chatbot is allowed
 * to reference. Everything here is derived from data.js exports.
 */
export function buildDataSummary() {
  const totalRevenue = monthly.reduce((s, m) => s + m.rev, 0);
  const totalOrders = monthly.reduce((s, m) => s + m.orders, 0);

  const reps = aggregate(salesrepsRaw, r => r.n.trim());
  const cats = aggregate(categoriesRaw, c => c.n.trim());
  const custs = aggregate(customersRaw, c => c.n);
  const prods = aggregate(productsRaw, p => p.n.trim());

  // Direct vs Webshop channel split (same logic as the Channels page)
  const webshop = salesrepsRaw.filter(r => r.n === 'Webshop');
  const direct = salesrepsRaw.filter(r => r.n !== 'Webshop');
  const channels = {
    directSales: {
      revenue: Math.round(direct.reduce((s, r) => s + r.rev, 0)),
      orders: direct.reduce((s, r) => s + r.orders, 0),
    },
    webshop: {
      revenue: Math.round(webshop.reduce((s, r) => s + r.rev, 0)),
      orders: webshop.reduce((s, r) => s + r.orders, 0),
    },
  };

  return {
    periodCovered: {
      from: monthly[0]?.m,
      to: monthly[monthly.length - 1]?.m,
      lastUpdated,
      lastInvoiceDate: maxFactuurDatum,
    },
    totals: {
      totalRevenueEUR: Math.round(totalRevenue),
      totalOrders,
      totalClients,
    },
    monthlyRevenue: monthly.map(m => ({
      month: m.m,
      revenueEUR: Math.round(m.rev),
      orders: m.orders,
    })),
    salesReps: reps.map(r => ({
      name: r.name,
      revenueEUR: Math.round(r.revenue),
      orders: r.orders,
    })),
    categories: cats.map(c => ({
      name: c.name,
      revenueEUR: Math.round(c.revenue),
      orders: c.orders,
    })),
    channels,
    topCustomers: {
      note: `Top ${TOP_CUSTOMERS_LIMIT} of ${custs.length} total customers, by revenue`,
      totalCustomerCount: custs.length,
      list: custs.slice(0, TOP_CUSTOMERS_LIMIT).map(c => ({
        name: c.name,
        revenueEUR: Math.round(c.revenue),
        orders: c.orders,
      })),
    },
    topProducts: {
      note: `Top ${TOP_PRODUCTS_LIMIT} of ${prods.length} total product lines, by revenue`,
      totalProductCount: prods.length,
      list: prods.slice(0, TOP_PRODUCTS_LIMIT).map(p => ({
        name: p.name,
        revenueEUR: Math.round(p.revenue),
        orders: p.orders,
        qty: p.qty,
      })),
    },
    finance: {
      comparisonPeriod: '2026 Jan-Mar (current year) vs 2025 Jan-Jun (prior year) — NOTE: these are unequal-length partial periods, not a fair like-for-like comparison',
      revenue: { currentYearEUR: Math.round(finSummary.revenue.cy), priorYearEUR: Math.round(finSummary.revenue.py) },
      cogs: { currentYearEUR: Math.round(finSummary.cogs.cy), priorYearEUR: Math.round(finSummary.cogs.py) },
      opex: { currentYearEUR: Math.round(finSummary.opex.cy), priorYearEUR: Math.round(finSummary.opex.py) },
      categories: finCategories.map(c => ({
        category: c.cat,
        currentYearEUR: Math.round(c.cy),
        priorYearEUR: Math.round(c.py),
      })),
      topLines: {
        note: `Top ${TOP_FIN_LINES_LIMIT} of ${finLines.length} total ledger lines, by absolute current-year value`,
        totalLineCount: finLines.length,
        list: finLines
          .slice()
          .sort((a, b) => Math.abs(b.cy) - Math.abs(a.cy))
          .slice(0, TOP_FIN_LINES_LIMIT)
          .map(l => ({
            account: l.acct,
            category: l.cat,
            description: l.desc,
            currentYearEUR: Math.round(l.cy),
            priorYearEUR: Math.round(l.py),
          })),
      },
    },
  };
}

/**
 * Builds the full system prompt sent to Gemini on every request.
 * Recomputed each time buildSystemPrompt() is called — cheap enough
 * (a handful of array reduces) that it doesn't need memoizing.
 */
export function buildSystemPrompt() {
  const summary = buildDataSummary();
  return `You are the data assistant embedded in the DairyTop Sales & Finance Dashboard.

STRICT RULES — follow these without exception:
1. Answer ONLY using the JSON data provided below under "DASHBOARD DATA". This is the complete and only dataset available to you.
2. Never invent, estimate, guess, or infer numbers that are not directly present in the data. If a calculation is needed (e.g. a sum, average, or percentage), compute it only from figures actually present in the data below, and show your working briefly.
3. If the answer cannot be determined from this data, say clearly: "I don't have that information in the dashboard data." Do not speculate.
4. Do not answer questions unrelated to this sales/finance data — no general knowledge, no coding help, no information about other companies, no current events. Politely redirect to what you can help with.
5. "topCustomers" and "topProducts" are capped lists (see their "note" field) — if asked to rank beyond what's listed, say the list is limited and mention the total count instead of guessing further entries.
6. All monetary figures in the data are in EUR. Format currency in your replies the European way, e.g. €1.234.567 (period for thousands). Use a comma for decimals if needed, e.g. €1.234.567,89.
7. Month codes like "Jan 25" mean January 2025, and "Jan 26" means January 2026.
8. Keep answers concise and always cite the actual figures you used from the data.
9. The finance comparison period (finance.comparisonPeriod) is NOT a fair like-for-like comparison — 2026 covers Jan-Mar only while 2025 covers Jan-Jun. Mention this caveat whenever you compare finance current-year vs prior-year figures.
10. FORMATTING: plain text only, no headings, no bullet/numbered lists, no code blocks. The only formatting you may use is **double asterisks** to bold a key figure or name — nothing else renders in this chat widget.

DASHBOARD DATA:
${JSON.stringify(summary)}`;
}
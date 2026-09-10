/* ── CHATBOT DATA CONTEXT ────────────────────────────────────────
   Builds a JSON summary of data.js and turns it into a system
   prompt for the Gemini chatbot.

   Sending the ENTIRE raw dataset on every request (~250k tokens)
   blows through the Gemini free-tier per-request input token limit
   (250,000). So instead of shipping every month for every entity
   every time, we send:
     - lifetime TOTALS for every customer/product/rep/category,
       uncapped (cheap: ~30k tokens combined) — covers "who's our
       biggest customer", "total revenue for X", etc.
     - full month-level detail for the CURRENT calendar year for
       ALL entities (bounded, ~90k tokens) — covers "this month",
       "last month", "revenue in June", trends, etc.
     - full month-level detail across ALL years for any
       customer/product that is actually named in the user's
       question (detected via simple substring matching against
       the question text) — covers "Kalverhuisvesting revenue in
       Sep 2026" or any other specific entity+month lookup, without
       needing to ship every OTHER entity's full history too.
     - if the question mentions a different year (e.g. "2025",
       "last year"), that year's full detail is sent instead of the
       current year's.

   This keeps every request comfortably under the token limit while
   still answering specific entity+month questions exactly, because
   the filtering is driven by what the user actually asked.

   IMPORTANT: this file is the single source of truth for what the
   chatbot is allowed to know. If you want the bot to be able to
   answer a new kind of question, add the relevant data here — do
   NOT let the bot fall back on general knowledge.
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

// Groups raw {n, m, rev, orders, qty} rows by name and sums rev/orders/qty
// across all months. Used only for convenience "lifetime total" views —
// the raw per-month rows are ALSO sent separately (see buildDataSummary),
// so no information is lost by also including these totals.
function aggregateTotals(rawArr, keyFn) {
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

// Strips accents/diacritics and lowercases, so "Bärbel" matches "barbel"
// and matching is forgiving of how the user typed a name.
function normalize(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Returns the set of entity names (from `names`) that appear as a
// substring of `queryText`. Only names of 4+ chars are considered, to
// avoid short names matching on noise.
function matchNamesInText(names, queryText) {
  const q = normalize(queryText);
  const matched = new Set();
  if (!q) return matched;
  for (const name of names) {
    if (name.length >= 4 && q.includes(normalize(name))) matched.add(name);
  }
  return matched;
}

// Looks for an explicit year (matching a year present in the data) or a
// "last year" / "vorig jaar" style phrase in the query text. Falls back
// to `currentSuffix` (e.g. '26') when nothing is found.
function detectTargetYearSuffix(queryText, availableSuffixes, currentSuffix) {
  const q = (queryText || '').toLowerCase();
  for (const suf of availableSuffixes) {
    if (q.includes(`20${suf}`)) return suf;
  }
  if (/\b(last year|previous year|vorig jaar|afgelopen jaar)\b/.test(q)) {
    const idx = availableSuffixes.indexOf(currentSuffix);
    if (idx > 0) return availableSuffixes[idx - 1];
  }
  return currentSuffix;
}

/**
 * Returns a plain JS object — the ONLY data the chatbot is allowed
 * to reference. Everything here is derived from data.js exports.
 *
 * @param {string} queryText - the user's current question (plus,
 *   ideally, their last couple of messages) — used only to decide
 *   which month-level detail to include (see file header). Does not
 *   affect the totals, which are always sent in full.
 */
export function buildDataSummary(queryText = '') {
  const totalRevenue = monthly.reduce((s, m) => s + m.rev, 0);
  const totalOrders = monthly.reduce((s, m) => s + m.orders, 0);

  const repTotals = aggregateTotals(salesrepsRaw, r => r.n.trim());
  const catTotals = aggregateTotals(categoriesRaw, c => c.n.trim());
  const custTotals = aggregateTotals(customersRaw, c => c.n);
  const prodTotals = aggregateTotals(productsRaw, p => p.n.trim());

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

  // The `monthly` array is ordered chronologically and its LAST entry is
  // always the current, still-in-progress month (partial data, since it
  // only covers invoices up to `maxFactuurDatum`). We surface this
  // explicitly so the model never has to guess what "this month" /
  // "last month" / "current month" means.
  const currentMonthEntry = monthly[monthly.length - 1] || null;
  const previousMonthEntry = monthly[monthly.length - 2] || null;

  // ── Query-aware filtering for customer/product month-level detail ──
  const availableYearSuffixes = [...new Set(monthly.map(m => m.m.split(' ')[1]))];
  const currentYearSuffix = currentMonthEntry ? currentMonthEntry.m.split(' ')[1] : availableYearSuffixes[availableYearSuffixes.length - 1];
  const targetYearSuffix = detectTargetYearSuffix(queryText, availableYearSuffixes, currentYearSuffix);
  const targetYearLabel = `20${targetYearSuffix}`;

  const matchedCustomerNames = matchNamesInText(custTotals.map(c => c.name), queryText);
  const matchedProductNames = matchNamesInText(prodTotals.map(p => p.name), queryText);
  const matchedEntityNames = [...matchedCustomerNames, ...matchedProductNames];

  const filteredCustomersByMonth = customersRaw
    .filter(c => c.m.endsWith(` ${targetYearSuffix}`) || matchedCustomerNames.has(c.n))
    .map(c => ({ name: c.n, month: c.m, revenueEUR: Math.round(c.rev), orders: c.orders, qty: c.qty ?? null }));

  const filteredProductsByMonth = productsRaw
    .filter(p => p.m.endsWith(` ${targetYearSuffix}`) || matchedProductNames.has(p.n.trim()))
    .map(p => ({ name: p.n.trim(), month: p.m, revenueEUR: Math.round(p.rev), orders: p.orders, qty: p.qty ?? null }));

  return {
    asOf: {
      lastUpdated,
      lastInvoiceDate: maxFactuurDatum,
      note: `Data is current as of ${lastUpdated}. The LAST entry in monthlyRevenue (${currentMonthEntry?.month}) is the current, still in-progress month — it will look artificially low compared to full months because the month has not finished yet. The second-to-last entry (${previousMonthEntry?.month}) is the most recent fully completed month.`,
      currentMonth: currentMonthEntry ? { month: currentMonthEntry.m, revenueEUR: Math.round(currentMonthEntry.rev), orders: currentMonthEntry.orders, partial: true } : null,
      previousMonth: previousMonthEntry ? { month: previousMonthEntry.m, revenueEUR: Math.round(previousMonthEntry.rev), orders: previousMonthEntry.orders } : null,
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
    channels,

    // Lifetime totals per entity (uncapped — every rep/category/customer/
    // product appears, not just a "top N").
    salesRepsTotals: repTotals.map(r => ({ name: r.name, revenueEUR: Math.round(r.revenue), orders: r.orders })),
    categoriesTotals: catTotals.map(c => ({ name: c.name, revenueEUR: Math.round(c.revenue), orders: c.orders })),
    customersTotals: {
      note: `Lifetime total per customer, summed across all months. All ${custTotals.length} customers included, sorted by revenue descending.`,
      totalCustomerCount: custTotals.length,
      list: custTotals.map(c => ({ name: c.name, revenueEUR: Math.round(c.revenue), orders: c.orders })),
    },
    productsTotals: {
      note: `Lifetime total per product, summed across all months. All ${prodTotals.length} products included, sorted by revenue descending.`,
      totalProductCount: prodTotals.length,
      list: prodTotals.map(p => ({ name: p.name, revenueEUR: Math.round(p.revenue), orders: p.orders, qty: p.qty })),
    },

    // Per-month raw rows — required to answer any question about a
    // SPECIFIC month for a specific rep/category/customer/product (e.g.
    // "Kalverhuisvesting revenue in Sep 2026"). Sum the matching rows
    // yourself; do not rely on the *Totals lists above for month-specific
    // questions, since those are summed across all months.
    //
    // Sales reps and categories are few enough (13 reps, ~15 categories)
    // that their full month history is always included in full. Customers
    // (1,413) and products (466) are filtered — see byMonthNote below and
    // the file header — to stay within the Gemini free-tier token limit.
    salesRepsByMonth: salesrepsRaw.map(r => ({ name: r.n.trim(), month: r.m, revenueEUR: Math.round(r.rev), orders: r.orders, qty: r.qty ?? null })),
    categoriesByMonth: categoriesRaw.map(c => ({ name: c.n.trim(), month: c.m, revenueEUR: Math.round(c.rev), orders: c.orders, qty: c.qty ?? null })),
    customersByMonth: filteredCustomersByMonth,
    productsByMonth: filteredProductsByMonth,
    byMonthNote: `customersByMonth/productsByMonth include full month-level detail for ${targetYearLabel} for ALL customers/products, PLUS the complete multi-year month-level history for any customer/product named in the user's current question (matched: ${matchedEntityNames.length ? matchedEntityNames.join(', ') : 'none this turn'}). If the user asks about a different specific year or names a different customer/product, that data will be included automatically on their next message once they mention it. For a lifetime total of ANY customer/product regardless of year, use customersTotals/productsTotals instead, which always include everyone.`,

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
      lines: {
        note: `All ${finLines.length} ledger lines included.`,
        totalLineCount: finLines.length,
        list: finLines
          .slice()
          .sort((a, b) => Math.abs(b.cy) - Math.abs(a.cy))
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

const LANGUAGE_NAMES = {
  en: 'English',
  nl: 'Dutch (Nederlands)',
};

/**
 * Builds the full system prompt sent to Gemini on every request.
 * Recomputed each time buildSystemPrompt() is called — cheap enough
 * (a handful of array reduces) that it doesn't need memoizing.
 *
 * @param {'en'|'nl'} lang - language the reply must be written in,
 *   independent of what language the user typed their question in.
 * @param {string} queryText - the user's current question (and,
 *   ideally, their last message or two), used to decide which
 *   customer/product month-level detail to include. See file header.
 */
export function buildSystemPrompt(lang = 'en', queryText = '') {
  const summary = buildDataSummary(queryText);
  const languageName = LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en;

  return `You are the data assistant embedded in the DairyTop Sales & Finance Dashboard.

STRICT RULES — follow these without exception:
1. Answer ONLY using the JSON data provided below under "DASHBOARD DATA". Lifetime totals (the *Totals fields) cover EVERY customer, product, rep and category — never capped. Month-level breakdowns (the *ByMonth fields) cover every rep/category always, and cover every customer/product for the year described in byMonthNote, PLUS full multi-year history for any customer/product named in the user's current message (also listed in byMonthNote). If a customer/product isn't in customersByMonth/productsByMonth for the month/year being asked about, but IS in customersTotals/productsTotals, you have their lifetime total but not that specific month's breakdown — say so, and mention that naming them explicitly (or naming the year) in the question will bring in the full detail.
2. Never invent, estimate, guess, or infer numbers that are not directly present or directly computable from the data below. For month-specific questions about one rep/category/customer/product (e.g. "X's revenue in month Y"), find the matching row(s) in the relevant *ByMonth array and sum them yourself; show your working briefly. For "revenue across several months" or "revenue this year", sum the matching monthlyRevenue or *ByMonth entries.
3. If the answer genuinely cannot be determined from this data (per rule 1's guidance), say clearly (translated into the response language) that you don't have that specific breakdown in the dashboard data. Do not speculate.
4. Do not answer questions unrelated to this sales/finance data — no general knowledge, no coding help, no information about other companies, no current events. Politely redirect to what you can help with, in the response language.
5. "asOf.currentMonth" and "asOf.previousMonth" tell you exactly which month is "current"/"this month" and which is "last month"/"previous month" — always use those, never guess based on today's real-world date. The current month is PARTIAL/in-progress, so its revenue will look low compared to completed months; mention that it's still in progress if the user seems to be comparing it to full months.
6. All monetary figures in the data are in EUR. Format currency the European way, e.g. €1.234.567 (period for thousands). Use a comma for decimals if needed, e.g. €1.234.567,89.
7. Month codes like "Jan 25" mean January 2025, and "Jan 26" means January 2026.
8. Keep answers concise and always cite the actual figures you used from the data.
9. The finance comparison period (finance.comparisonPeriod) is NOT a fair like-for-like comparison — 2026 covers Jan-Mar only while 2025 covers Jan-Jun. Mention this caveat whenever you compare finance current-year vs prior-year figures.
10. FORMATTING: plain text only, no headings, no bullet/numbered lists, no code blocks. The only formatting you may use is **double asterisks** to bold a key figure or name — nothing else renders in this chat widget.
11. RESPONSE LANGUAGE: Always write your entire reply in ${languageName}, regardless of what language the user's question was written in. Numbers/currency formatting still follows rule 6 either way.

DASHBOARD DATA:
${JSON.stringify(summary)}`;
}
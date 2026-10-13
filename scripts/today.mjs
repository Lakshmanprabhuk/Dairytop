// scripts/today.mjs
// Reads the current snapshot from src/utils/data.js and appends one entry
// to data/history/daily-log.json. Idempotent for the current UTC day.
//
// Run manually:  node scripts/today.mjs
// Runs in CI:    .github/workflows/daily-snapshot.yml

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  monthly, salesreps, customers,
  totalClients,
  openOrderValueFuture, openOrderValuePresent,
  projectedMTD, turnoverMTD, openOrderValueMTD,
} from '../src/utils/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH  = path.resolve(__dirname, '..', 'data', 'history', 'daily-log.json');

const today = new Date().toISOString().slice(0, 10);       // YYYY-MM-DD (UTC)
const cur   = monthly[monthly.length - 1];
const month = cur.m;

// ── Read existing log (or start empty) ────────────────────────────
let log = [];
try {
  log = JSON.parse(await fs.readFile(LOG_PATH, 'utf8'));
  if (!Array.isArray(log)) throw new Error('log is not an array');
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`⚠️  could not read log: ${e.message}`);
}

// ── Find the most recent *prior* entry (ignore today for idempotency) ──
const priorEntries = log.filter(e => e.date < today);
const prev = priorEntries.at(-1) ?? null;
const monthReset = prev ? prev.month !== month : false;

// ── Compute deltas ────────────────────────────────────────────────
const prevKpi = prev?.kpi ?? null;
const dailyRev    = monthReset ? cur.rev    : cur.rev    - (prevKpi?.mtd_rev    ?? 0);
const dailyOrders = monthReset ? cur.orders : cur.orders - (prevKpi?.mtd_orders ?? 0);

const repDelta = (currList, prevList) => {
  const pm = Object.fromEntries((prevList ?? []).map(r => [r.n, r]));
  return currList
    .map(r => {
      const base = (monthReset || !pm[r.n]) ? { rev: 0, orders: 0 } : pm[r.n];
      const daily_rev    = r.rev    - base.rev;
      const daily_orders = r.orders - base.orders;
      return {
        n: r.n,
        mtd_rev: r.rev,
        daily_rev,
        mtd_orders: r.orders,
        daily_orders,
      };
    })
    .filter(r => r.daily_rev !== 0 || r.daily_orders !== 0);
};

const repRows  = repDelta(
  salesreps.filter(r => r.m === month),
  prev?.reps?.map(x => ({ n: x.n, rev: x.mtd_rev, orders: x.mtd_orders })),
);

const custRows = repDelta(
  customers.filter(c => c.m === month),
  prev?.customers?.map(x => ({ n: x.n, rev: x.mtd_rev, orders: x.mtd_orders })),
);

const topRep  = [...repRows ].sort((a, b) => b.daily_rev - a.daily_rev)[0] ?? null;
const topCust = [...custRows].sort((a, b) => b.daily_rev - a.daily_rev)[0] ?? null;

// ── Build the entry ───────────────────────────────────────────────
const entry = {
  date: today,
  month,
  kpi: {
    mtd_rev:         cur.rev,
    daily_rev:       dailyRev,
    mtd_orders:      cur.orders,
    daily_orders:    dailyOrders,
    pipeline:        openOrderValuePresent,
    pipeline_future: openOrderValueFuture,
    proj_mtd:        projectedMTD,
    turnover_mtd:    turnoverMTD,
    open_mtd:        openOrderValueMTD,
    clients_total:   totalClients,
    top_rep:  topRep  ? { n: topRep.n,  daily_rev: topRep.daily_rev  } : null,
    top_cust: topCust ? { n: topCust.n, daily_rev: topCust.daily_rev } : null,
  },
  reps:      repRows,
  customers: custRows,
};

// ── Append (replacing today's entry if the script already ran) ────
const nextLog = [...log.filter(e => e.date !== today), entry]
  .sort((a, b) => a.date.localeCompare(b.date));

await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
await fs.writeFile(LOG_PATH, JSON.stringify(nextLog, null, 2) + '\n', 'utf8');

// ── Console summary ───────────────────────────────────────────────
const fmt = n => '€' + Math.round(n).toLocaleString('de-DE');
console.log('─'.repeat(56));
console.log(`  date           ${entry.date}  (${entry.month})`);
console.log(`  daily revenue  ${fmt(dailyRev)}${monthReset ? '   ← month reset' : ''}`);
console.log(`  mtd revenue    ${fmt(cur.rev)}`);
console.log(`  daily orders   ${dailyOrders}`);
console.log(`  top rep        ${topRep ? `${topRep.n} (${fmt(topRep.daily_rev)})` : '—'}`);
console.log(`  top customer   ${topCust ? `${topCust.n} (${fmt(topCust.daily_rev)})` : '—'}`);
console.log(`  reps moved     ${repRows.length}`);
console.log(`  customers moved ${custRows.length}`);
console.log(`  log entries    ${nextLog.length}`);
console.log('─'.repeat(56));
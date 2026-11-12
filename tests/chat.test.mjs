import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerFromData, resolve, buildFallbackAnswer } from '../src/utils/chatFallback.js';
import { buildSystemPrompt, buildDataContext, compactHistory } from '../src/utils/chatContext.js';
import { getLanguageIndex } from '../src/utils/chatLanguage.js';
import { requestWithDeadline, AI_TIMEOUT_MS } from '../src/utils/chatRequest.js';
import * as real from '../src/utils/data.js';

const d = {
  monthly: [{ m: 'Dec 25', rev: 100, orders: 1 }, { m: 'Jan 26', rev: 80, orders: 2 }, { m: 'Feb 26', rev: 20, orders: 1 }],
  customers: [{ n: 'Alpha Farm', m: 'Dec 25', rev: 100, orders: 1 }, { n: 'Alpha Farm', m: 'Jan 26', rev: 30, orders: 1 }, { n: 'Beta Farm', m: 'Jan 26', rev: 50, orders: 1 }, { n: 'Beta Farm', m: 'Feb 26', rev: 20, orders: 1 }],
  products: [{ n: 'Milk', m: 'Jan 26', rev: 80, orders: 2, qty: 4 }], salesreps: [], categories: [], lastUpdated: '04/02/2026',
};
const TODAY = { today: '2026-11-06' };
const answer = (q, data = d, opts = {}) => answerFromData(q, { ...TODAY, ...opts }, data);
const ask = (q, opts = {}) => answerFromData(q, { ...TODAY, ...opts }, real);

test('ranks aggregated customers, not individual monthly rows', () => {
  assert.match(answer('top 1 customers'), /Alpha Farm — €130/);
  assert.doesNotMatch(answer('top 1 customers'), /Beta Farm — €70\*\*/);
});
test('explicit year, month, quarter and relative periods restrict rows', () => {
  assert.match(answer('top 1 customers in 2026'), /Beta Farm — €70/);
  assert.match(answer('top 1 customers January 2026'), /Beta Farm — €50/);
  assert.match(answer('revenue last month'), /€80/);
  assert.match(answer('revenue last year'), /€100/);
  assert.match(answer('revenue Q1 2026'), /€100/);
  assert.match(answer('revenue 2024'), /no sales data/i);
});
test('ranges, "since" and "last N months" are real periods', () => {
  assert.match(answer('revenue from December 2025 to January 2026'), /€180/);
  assert.match(answer('revenue between december 2025 and february 2026'), /€200/);
  assert.match(answer('revenue since january'), /€100/);
  assert.match(answer('revenue last 2 months'), /€180/);            // complete months only
});
test('named entity, Dutch, negative revenue', () => {
  assert.match(answer('revenue Alpha Farm January 2026'), /€30/);
  assert.match(answerFromData('top 1 klanten in 2026', { lang: 'nl', ...TODAY }, d), /Top klant — omzet/);
  assert.match(answer('bottom 1 customers', { ...d, customers: [{ n: 'Refund', m: 'Jan 26', rev: -5 }] }), /-€5/);
});
test('questions that need reasoning or unknown qualifiers go to AI (null), never to a wrong local answer', () => {
  for (const q of ['why did revenue drop?', 'forecast revenue for Alpha Farm', 'top customers in Germany', 'top customers excluding Alpha Farm', 'top products without Milk', 'what should we do about customers'])
    assert.equal(answer(q), null, q);
});
test('impossible joins are explained instead of invented', () => {
  assert.match(answer('top 10 customers and their products'), /does not link/);
  assert.match(answer('profit per customer', { ...d, finSummary: { revenue: { cy: 1, py: 1 }, cogs: { cy: 1, py: 1 }, opex: { cy: 0, py: 0 } } }), /only exist company-wide/);
});
test('small talk, help and off-topic never need AI', () => {
  for (const q of ['hello', 'thanks!', 'thank you', 'good morning', 'who are you?', 'help', 'what can you do?', 'bye']) assert.ok(answer(q), q);
  assert.match(answer('what is the weather today?'), /can only help/);
  assert.match(answer('asdfgh'), /can only help/);
});

/* ── regressions found in the November 2026 audit (real data) ── */
test('non-payer and risk use the same rules as the Customer Scorecard page', () => {
  const custs = real.debtorCustomers;
  const nonPayers = custs.filter(c => (c.ageOfOldest || 0) > 60).length;
  const riskD = custs.filter(c => (c.ageOfOldest || 0) > 90 && (c.openValue || 0) >= 5000).length;
  assert.ok(nonPayers > 0 && nonPayers < custs.length);
  assert.match(ask('How many customers are flagged as non-payer?'), new RegExp(`\\*\\*${nonPayers} of ${custs.length} customers\\*\\*`));
  assert.match(ask('non payers'), new RegExp(`${nonPayers} of ${custs.length}`));
  assert.match(ask('Show me all Risk D customers'), new RegExp(`\\*\\*${riskD} Risk D customers\\*\\*`));
  assert.match(ask('high risk customers'), new RegExp(`${riskD} Risk D`));
});
test('week numbers resolve to the week, not the year', () => {
  const w = real.weekly[real.weekly.length - 2];
  const n = /W(\d+)/.exec(w.w)[1];
  assert.match(ask(`revenue week ${n}`), new RegExp(`€${Math.round(w.rev).toLocaleString('de-DE')}`));
});
test('quarters, "mar 25", worst month and per-rep questions no longer fall back to the all-time total', () => {
  const total = `€${Math.round(real.monthly.reduce((s, m) => s + m.rev, 0)).toLocaleString('de-DE')}`;
  for (const q of ['revenue last quarter', 'revenue this quarter', 'worst month', 'revenue per rep', 'revenue by rep', 'revenue mar 25'])
    assert.ok(!ask(q).includes(`**${total}**`), q);
  assert.match(ask('revenue mar 25'), /Period: Mar 25/);
  const mar25 = real.monthly.find(m => m.m === 'Mar 25').rev;
  assert.match(ask('revenue mar 25'), new RegExp(`€${Math.round(mar25).toLocaleString('de-DE')}`));
});
test('counts are honoured', () => {
  assert.equal((ask('top 10 customers').match(/^\d+\. /gm) || []).length, 10);
  assert.equal((ask('10 best customers').match(/^\d+\. /gm) || []).length, 10);
  assert.equal((ask('who are the top sales reps?').match(/^\d+\. /gm) || []).length, 5);
});
test('real data rankings agree with an independent aggregation', () => {
  const totals = new Map();
  for (const r of real.customers) totals.set(r.n, (totals.get(r.n) || 0) + r.rev);
  const [name, value] = [...totals].sort((a, b) => b[1] - a[1])[0];
  const reply = ask('top 1 customers');
  assert.ok(reply.includes(name));
  assert.ok(reply.includes(Math.round(value).toLocaleString('de-DE')));
  assert.match(ask('accounts receivable'), new RegExp(real.debtorAsOf));
  assert.match(ask('finance totals'), /EBITDA/);
});
test('every customer, product, sales rep and category can be asked for by its full name', () => {
  const failures = [];
  for (const e of getLanguageIndex(real).entities) {
    if (e.type === 'fincat') continue;
    const r = resolve(`revenue ${e.name}`, TODAY, real);
    if (!r.answer || /Which one do you mean|can only help/.test(r.answer)) failures.push(e.name);
  }
  assert.deepEqual(failures.slice(0, 10), []);
});
test('typos and partial names', () => {
  assert.match(ask('top 5 custmers'), /Top 5 customers/);
  assert.match(ask('revenu this year'), /Revenue: \*\*€/);
  const rep = [...new Set(real.salesreps.map(r => r.n.trim()))].find(n => n.split(' ').length === 2);
  assert.ok(ask(`${rep.split(' ')[0]} revenue`).includes(rep) || /Which one do you mean/.test(ask(`${rep.split(' ')[0]} revenue`)));
});
test('follow-ups inherit the previous subject', () => {
  const first = resolve('top 5 customers this year', TODAY, real);
  const next = resolve('show me the top 3', { ...TODAY, prev: first.subject }, real);
  assert.match(next.answer, /Top 3 customers/);
});

test('plain revenue forecasts are projected locally with the method shown', () => {
  const complete = real.monthly.slice(0, -1);
  const total = id => complete.filter(m => m.m.endsWith(id)).reduce((s, m) => s + m.rev, 0);
  for (const q of ['Predict 2027 revenue', 'forecast next year', 'what will revenue be next month?', 'expected revenue this year', 'revenue 2027', 'voorspel de omzet voor volgend jaar']) {
    const reply = answerFromData(q, { ...TODAY, lang: /voorspel/.test(q) ? 'nl' : 'en' }, real);
    assert.match(reply || '', /estimate: about €|Schatting omzet/, q);
    assert.match(reply, /Method|Methode/, q);
  }
  const next = Number(/about €([\d.]+)/.exec(ask('Predict 2027 revenue'))[1].replace(/\./g, ''));
  assert.ok(next > total('25') * 0.5 && next < total('25') * 2.5, `implausible forecast ${next}`);
  assert.equal(ask('predict next year for Melkpoeder'), null);            // per-entity forecasts go to AI
  assert.doesNotMatch(ask('revenue 2025'), /estimate/);                   // the past is never "forecast"
  assert.doesNotMatch(ask('revenue this year'), /estimate/);
});

/* ── Supabase row shapes (knitworks-dashboard-1) ── */
test('Supabase snapshot shapes work and missing finance data never crashes', () => {
  const live = {
    monthly: [{ m: 'Oct 26', rev: 1000.4, orders: 10 }, { m: 'Nov 26', rev: 200.6, orders: 2 }],
    weekly: [{ w: 'W44 26', rev: 400, orders: 4, week_start_s: '26/10/26', week_end_s: '01/11/26' }, { w: 'W45 26', rev: 200.6, orders: 2, week_start_s: '02/11/26', week_end_s: '08/11/26' }],
    daily: [{ rev: 200.6, orders: 2, day_iso: '2026-11-04', day_label: '04/11/26' }],
    customers: [{ m: 'Nov 26', n: 'Alpha Farm', qty: 0, rev: 200.6, orders: 2 }], customersDaily: [{ n: 'Alpha Farm', rev: 200.6, orders: 2, day_iso: '2026-11-04', day_label: '04/11/26' }],
    products: [], salesreps: [], categories: [], lastUpdated: '09/11/2026', maxFactuurDatum: '04/11/2026',
  };
  assert.match(answerFromData('revenue this week', TODAY, live), /02\/11\/26 – 08\/11\/26/);
  assert.match(answerFromData('revenue last week', TODAY, live), /€400/);
  assert.match(answerFromData('sales on 04/11/2026', TODAY, live), /€201/);
  assert.match(answerFromData('top customers on 2026-11-04', TODAY, live), /Alpha Farm/);
  assert.match(answerFromData('finance totals', TODAY, live), /not available/);
  assert.doesNotThrow(() => buildSystemPrompt('en', 'why did revenue drop?', live));
  assert.doesNotThrow(() => buildSystemPrompt('en', 'what are our costs?', live));
  assert.doesNotThrow(() => buildSystemPrompt('en', 'anything', {}));
  assert.ok(buildFallbackAnswer('why did revenue drop?', { lang: 'en' }, live).includes('€'));
});

/* ── AI prompt stays small ── */
test('AI prompt is a slim slice of the data, not the whole dataset', () => {
  const questions = ['why did revenue drop in may?', 'why are customers buying less this year?', 'what should we do about overdue invoices?', 'explain the EBITDA result', 'predict next month for Melkpoeder', 'why did products decline?', 'recommend which sales reps need help'];
  for (const q of questions) {
    const prompt = buildSystemPrompt('en', q, real, { context: { pageName: 'Overview Dashboard' } });
    assert.ok(prompt.length < 32000, `${q}: ${prompt.length} chars`);      // ≈ 8k tokens hard ceiling
  }
  assert.ok(buildSystemPrompt('en', 'why did revenue drop in may?', real).length < 16000);
  assert.match(buildDataContext('why is overdue so high?', real), /Accounts receivable/);
  assert.doesNotMatch(buildDataContext('why did revenue drop?', real), /Accounts receivable|Ledger lines/);
  assert.equal(compactHistory(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'x'.repeat(2000) }))).length, 6);
});

/* ── request deadline ── */
test('AI timeout is 12 seconds', () => assert.equal(AI_TIMEOUT_MS, 12000));
test('successful AI response wins', async () => assert.equal(await requestWithDeadline(async () => 'AI answer'), 'AI answer'));
test('API failure propagates immediately to the fallback handler', async () => {
  await assert.rejects(requestWithDeadline(async () => { throw new Error('HTTP 429'); }), /429/);
});
test('timeout aborts work even when the request ignores cancellation', async () => {
  let signal;
  await assert.rejects(requestWithDeadline(s => { signal = s; return new Promise(() => {}); }, { timeoutMs: 10 }), /deadline/);
  assert.equal(signal.aborted, true);
});

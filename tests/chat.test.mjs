import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerFromData } from '../src/utils/chatFallback.js';
import { requestWithDeadline, AI_TIMEOUT_MS } from '../src/utils/chatRequest.js';
import * as real from '../src/utils/data.js';
const d = {
 monthly:[{m:'Dec 25', rev:100, orders:1},{m:'Jan 26',rev:80,orders:2},{m:'Feb 26',rev:20,orders:1}],
 customers:[{n:'Alpha Farm',m:'Dec 25',rev:100,orders:1},{n:'Alpha Farm',m:'Jan 26',rev:30,orders:1},{n:'Beta Farm',m:'Jan 26',rev:50,orders:1},{n:'Beta Farm',m:'Feb 26',rev:20,orders:1}],
 products:[{n:'Milk',m:'Jan 26',rev:80,orders:2,qty:4}], salesreps:[], categories:[], lastUpdated:'04/02/2026',
};
const answer = q => answerFromData(q, {}, d);
test('ranks aggregated customers, not individual monthly rows', () => {
 assert.match(answer('top 1 customers'), /Alpha Farm\*\*: €130/);
 assert.doesNotMatch(answer('top 1 customers'), /Beta Farm/);
});
test('explicit year and month restrict rows', () => {
 assert.match(answer('top 1 customers in 2026'), /Beta Farm\*\*: €70/);
 assert.match(answer('top 1 customers January 2026'), /Beta Farm\*\*: €50/);
 assert.match(answer('revenue last month'), /€80/);
 assert.match(answer('revenue last year'), /€100/);
 assert.match(answer('revenue Q1 2026'), /€100/);
});
test('out of coverage and ambiguous ranges do not silently use totals', () => {
 assert.match(answer('revenue 2024'), /No sales data/);
 assert.match(answer('revenue January to February 2026'), /Please specify/);
 assert.match(answer('revenue yesterday'), /monthly data/);
});
test('no fabricated joins, quantities, entities or forecasts', () => {
 assert.match(answer('top 10 customers and their products'), /cannot link/);
 assert.match(answer('customer quantity'), /not available/);
 assert.match(answer('revenue for Unknown Farm customers'), /could not safely interpret/);
 assert.match(answer('forecast revenue'), /beyond the local rules/);
});
test('explicit named entity, Dutch and negative revenue', () => {
 assert.match(answer('revenue Alpha Farm January 2026'), /€30/);
 assert.match(answerFromData('top 1 klanten in 2026', {lang:'nl'}, d), /klanten — omzet/);
 assert.match(answerFromData('bottom 1 customers', {}, {...d, customers:[{n:'Refund',m:'Jan 26',rev:-5}]}), /€-5/);
});
test('real data rankings agree with an independent aggregation', () => {
 const totals = new Map();
 for (const r of real.customers) totals.set(r.n, (totals.get(r.n)||0)+r.rev);
 const [name,value] = [...totals].sort((a,b)=>b[1]-a[1])[0];
 const reply = answerFromData('top 1 customers');
 assert.ok(reply.includes(name));
 assert.ok(reply.includes(value.toLocaleString('de-DE', { maximumFractionDigits:2 })));
 assert.match(answerFromData('accounts receivable'), new RegExp(real.debtorAsOf));
 assert.match(answerFromData('finance totals'), /different lengths/);
});
test('production timeout is exactly 15 seconds', () => assert.equal(AI_TIMEOUT_MS,15000));
test('successful AI response wins', async () => assert.equal(await requestWithDeadline(async()=> 'AI answer'), 'AI answer'));
test('API failure propagates immediately to fallback handler', async () => {
 await assert.rejects(requestWithDeadline(async()=> {throw new Error('HTTP 429');}), /429/);
});
test('timeout aborts work even when the request ignores cancellation', async () => {
 let signal;
 await assert.rejects(requestWithDeadline(s => {signal=s; return new Promise(()=>{});}, {timeoutMs:10}), /deadline/);
 assert.equal(signal.aborted, true);
});
test('late AI completion cannot replace timeout result', async () => {
 let finish;
 const promise = requestWithDeadline(()=>new Promise(resolve=>{finish=resolve;}), {timeoutMs:10});
 await assert.rejects(promise, /deadline/);
 finish('late');
 await assert.rejects(promise, /deadline/);
});
test('component cancellation prevents work', async () => {
 const controller = new AbortController(); controller.abort();
 let called=false;
 await assert.rejects(requestWithDeadline(()=> {called=true;}, {signal:controller.signal}), {name:'AbortError'});
 assert.equal(called,false);
});

test('unknown qualifiers and names never silently return global totals', () => {
 assert.match(answer('top customers in Germany'), /could not safely interpret/);
 assert.match(answer('revenue Unknown Farm'), /could not safely interpret/);
 assert.match(answer('top five customers'), /Alpha Farm/);
 assert.match(answer('total customer revenue 2026'), /€100/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { answerFromData } from '../src/utils/chatFallback.js';
import { parseQuestion, vocabularyRows, editDistance } from '../src/utils/chatLanguage.js';
import * as data from '../src/utils/data.js';

const coverage = new URL('../coverage/sentence-examples.json', import.meta.url);
const cases = fs.existsSync(coverage) ? JSON.parse(fs.readFileSync(coverage)) : [];
const fixture = {
  monthly: [{ m: 'Jan 26', rev: 100, orders: 10 }, { m: 'Feb 26', rev: 40, orders: 4 }], lastUpdated: '03/02/2026',
  customers: [{ n: 'Alpha Farm', m: 'Jan 26', rev: 70, orders: 7 }, { n: 'Beta Farm', m: 'Jan 26', rev: 30, orders: 3 }, { n: 'Alpha Farm', m: 'Feb 26', rev: 40, orders: 4 }],
  products: [{ n: 'Powder A', m: 'Jan 26', rev: 70, orders: 7, qty: 10 }, { n: 'Powder B', m: 'Jan 26', rev: 30, orders: 3, qty: 5 }],
  salesreps: [{ n: 'Rep A', m: 'Jan 26', rev: 70, orders: 7 }, { n: 'Webshop', m: 'Jan 26', rev: 30, orders: 3 }],
  categories: [{ n: 'Group A', m: 'Jan 26', rev: 70, orders: 7 }, { n: 'Group B', m: 'Jan 26', rev: 30, orders: 3 }],
  debtorAsOf: '2026-06-03', debtorKPI: { totalDebtorValue: 40, over30: 20, over90: 10, openInvoiceCount: 2 }, debtorAgeing: [{ bucket: '0-30', value: 20, count: 1 }], debtorCustomers: [{ name: 'Alpha Farm', openValue: 40, ageOfOldest: 10 }],
  finPeriodLabel: '2026 Jan-Mar vs 2025 Jan-Jun', finSummary: { revenue: { cy: 100, py: 200 }, cogs: { cy: 60, py: 100 }, opex: { cy: 20, py: 30 } },
};
const T = { today: '2026-02-03' };
const figures = s => (String(s).match(/€[\d.]+|\*\*[\d.]+\*\*|— [\d.]+/g) || []).join(' ');

test('every generated sentence is answered locally with the same figures as its canonical form', { skip: !cases.length }, () => {
  assert.ok(cases.length > 1000);
  for (const d of [fixture, data]) for (const c of cases) {
    const expected = answerFromData(c.canonical, { lang: c.lang, ...T }, d);
    const actual = answerFromData(c.question, { lang: c.lang, ...T }, d);
    assert.ok(expected && /\d/.test(expected), `Canonical query did not calculate: ${c.canonical}`);
    assert.ok(actual, `${c.id}: not answered locally: ${c.question}`);
    assert.equal(figures(actual), figures(expected), `${c.id}: ${c.question}`);
  }
});
test('at least 2000 distinct words, from the lexicon and from real names', () => {
  const words = vocabularyRows(data);
  assert.ok(words.length > 2000);
  assert.equal(new Set(words.map(r => r.word)).size, words.length);
});
test('synonyms keep explicit numeric results', () => {
  assert.match(answerFromData('Could you please show me the highest five buyers by sales turnover in January 2026?', T, fixture), /Alpha Farm\*\* — €70/);
  assert.match(answerFromData('Toon mij laagste vijf kopers op aantal bestellingen in januari 2026', { lang: 'nl', ...T }, fixture), /Beta Farm\*\* — 3/);
});
test('names containing keywords or month words stay protected', () => {
  const d = { ...fixture, customers: [{ n: 'May Sales Buyers', m: 'Jan 26', rev: 44, orders: 1 }] };
  assert.match(answerFromData('revenue for May Sales Buyers in January 2026', T, d), /€44/);
});
test('unique partial names resolve; ambiguous ones ask which one', () => {
  assert.match(answerFromData('revenue for Alpha in January 2026', T, fixture), /Alpha Farm[\s\S]*€70/);
  assert.match(answerFromData('revenue for Farm in January 2026', T, fixture), /Which one do you mean/);
});
test('near-duplicate names are shown separately and combined, never silently merged', () => {
  const d = { ...fixture, products: [{ n: 'Powder A', m: 'Jan 26', rev: 7 }, { n: 'Powder A*', m: 'Jan 26', rev: 3 }] };
  const reply = answerFromData('revenue for Powder A', T, d);
  assert.match(reply, /€10/);
  assert.match(reply, /Powder A €7 · Powder A\* €3/);
});
test('qualifiers the bot does not understand are never swallowed', () => {
  for (const q of ['top buyers in Germany', 'top buyers excluding Alpha Farm', 'top products without Powder A']) assert.equal(answerFromData(q, T, fixture), null, q);
  for (const q of ['buyers that purchased products', 'finance for Alpha Farm']) assert.ok(!String(answerFromData(q, T, { ...fixture, finSummary: { revenue: { cy: 1, py: 1 }, cogs: { cy: 1, py: 1 }, opex: { cy: 0, py: 0 } } })).includes('**Alpha'), q);
});
test('number words, quarters and typo repair', () => {
  const tags = q => parseQuestion(q, fixture).tags;
  assert.ok(tags('highest twenty five buyers in first quarter 2026').some(t => t.k === 'num' && t.v === 25));
  assert.ok(tags('laagste vijftig afnemers in tweede kwartaal 2026').some(t => t.k === 'q' && t.v === 2));
  assert.ok(tags('top custmers').some(t => t.k === 'dim' && t.v === 'customers'));
  assert.equal(parseQuestion('product prices', fixture).unknown.join(), 'prices');   // a real word, not a typo of "pieces"
  assert.equal(editDistance('costumers', 'customers'), 2);
});

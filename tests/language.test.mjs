import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {answerFromData} from '../src/utils/chatFallback.js';
import {prepareQuestion, vocabularyRows} from '../src/utils/chatLanguage.js';
import * as data from '../src/utils/data.js';
const cases=JSON.parse(fs.readFileSync(new URL('../coverage/sentence-examples.json',import.meta.url)));
const fixture={monthly:[{m:'Jan 26',rev:100,orders:10},{m:'Feb 26',rev:40,orders:4}],lastUpdated:'03/02/2026',
 customers:[{n:'Alpha Farm',m:'Jan 26',rev:70,orders:7},{n:'Beta Farm',m:'Jan 26',rev:30,orders:3},{n:'Alpha Farm',m:'Feb 26',rev:40,orders:4}],
 products:[{n:'Powder A',m:'Jan 26',rev:70,orders:7,qty:10},{n:'Powder B',m:'Jan 26',rev:30,orders:3,qty:5}],
 salesreps:[{n:'Rep A',m:'Jan 26',rev:70,orders:7},{n:'Webshop',m:'Jan 26',rev:30,orders:3}],
 categories:[{n:'Group A',m:'Jan 26',rev:70,orders:7},{n:'Group B',m:'Jan 26',rev:30,orders:3}],
 debtorAsOf:'2026-06-03',debtorKPI:{totalDebtorValue:40,over30:20,over90:10,openInvoiceCount:2},debtorAgeing:[{bucket:'0-30',value:20}],debtorCustomers:[{name:'Alpha Farm',openValue:40}],
 finPeriodLabel:'2026 Jan-Mar vs 2025 Jan-Jun',finSummary:{revenue:{cy:100,py:200},cogs:{cy:60,py:100},opex:{cy:20,py:30}}};
test('every generated sentence returns its canonical answer, not a rejection',()=>{
 assert.ok(cases.length>1000);
 assert.equal(new Set(cases.map(r=>r.question.toLowerCase())).size,cases.length);
 for(const c of cases){
  const expected=answerFromData(c.canonical,{lang:c.lang},fixture);
  const actual=answerFromData(c.question,{lang:c.lang},fixture);
  assert.ok(/€|opgetelde|summed/.test(expected),`Canonical query did not calculate: ${c.canonical}: ${expected}`);
  assert.equal(actual,expected,`${c.id}: ${c.question}`);
 }
});
test('at least 2000 distinct alphabetic words, derived from actual language and data',()=>{
 const words=vocabularyRows(data);
 assert.ok(words.length>2000);
 assert.equal(new Set(words.map(r=>r.word)).size,words.length);
 assert.ok(words.every(r=>/^[a-z]+$/.test(r.word)&&r.scopes.length));
});
test('sales synonyms preserve explicit numeric results',()=>{
 assert.match(answerFromData('Could you please show me the highest five buyers by sales turnover in January 2026?',{},fixture),/Alpha Farm\*\*: €70/);
 assert.match(answerFromData('Toon mij laagste vijf kopers op aantal bestellingen in januari 2026',{lang:'nl'},fixture),/Beta Farm\*\*: 3/);
});
test('entity keywords and month words remain protected',()=>{
 const d={...fixture,customers:[{n:'May Sales Buyers',m:'Jan 26',rev:44,orders:1}]};
 assert.match(answerFromData('revenue for May Sales Buyers in January 2026',{},d),/€44/);
});
test('unique partial names resolve, ambiguous ones ask for clarification',()=>{
 assert.match(answerFromData('revenue for Alpha in January 2026',{},fixture),/€70/);
 assert.match(answerFromData('revenue for Farm in January 2026',{},fixture),/matches several/);
});
test('normalization collisions never silently merge distinct entities',()=>{
 const d={...fixture,products:[{n:'Powder A',m:'Jan 26',rev:7},{n:'Powder A*',m:'Jan 26',rev:3}]};
 assert.match(answerFromData('revenue for Powder A',{},d),/matches several/);
});
test('large vocabulary does not swallow qualifiers, negation or invented relationships',()=>{
 for(const q of ['top buyers in Germany','top buyers excluding Alpha Farm','top products without Powder A','buyers by profit','buyers that purchased products']){
  const response=answerFromData(q,{},fixture);
  assert.ok(!response.includes('**'), `${q}: ${response}`);
 }
 assert.match(answerFromData('finance for Alpha Farm',{},fixture),/overall totals only/);
});
test('word numbers up to fifty and quarter aliases',()=>{
 assert.equal(prepareQuestion('highest twenty five buyers in first quarter 2026',fixture).query,'top 25 customers in q1 2026');
 assert.equal(prepareQuestion('laagste vijftig afnemers in tweede kwartaal 2026',fixture).query,'bottom 50 customers in q2 2026');
});
test('all example sentences also match canonical results against the real data snapshot',()=>{
 for(const c of cases){
  const expected=answerFromData(c.canonical,{lang:c.lang},data);
  assert.ok(/€|opgetelde|summed/.test(expected),`Unsupported real-data canonical query: ${c.canonical}`);
  assert.equal(answerFromData(c.question,{lang:c.lang},data),expected,`${c.id}: ${c.question}`);
 }
});

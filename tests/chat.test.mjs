import { test } from 'node:test';
import assert from 'node:assert/strict';

const { app, chat, sug } = globalThis.__DT;
const D = app.DASH, X = D.X;

test('dash.json is schema 5.0.0 and loads', () => {
  assert.equal(X.meta.schemaVersion, '5.0.0');
  assert.ok(X.n > 1000);
});

test('every prefilled question has a local answer with a figure', () => {
  for (const q of chat.KNOWN_QUESTIONS) {
    const r = chat.resolve(q, { lang: 'en' }, D);
    assert.ok(r.answer, `no answer for: ${q}`);
    assert.match(r.answer, /\d/, `no number in answer for: ${q}`);
  }
});

test('Dutch chip prompts resolve to the same answers', () => {
  for (const [en, nl] of Object.entries(sug.QUESTION_NL)) {
    assert.equal(chat.resolve(nl, { lang: 'nl' }, D).answer, chat.resolve(en, { lang: 'en' }, D).answer, nl);
  }
});

test('every page chip and context chip is answerable', () => {
  const chips = Object.values(sug.CONTEXT_SUGGESTIONS).flat().map(c => c.prompt.en);
  for (const q of chips) assert.ok(chat.resolve(q, {}, D).answer, q);
});

test('names of customers, verkopers, products and markets are recognised', () => {
  const samples = [X.customers[0][0], X.verkopers[0], 'Germany', 'Milk powder'];
  for (const n of samples) {
    const r = chat.resolve(`How is ${n} doing?`, {}, D);
    assert.ok(r.answer && r.answer.includes('€'), `no entity answer for ${n}`);
  }
});

test('month and year questions', () => {
  assert.match(chat.resolve('What was revenue in March 2026?', {}, D).answer, /March 2026|Mar 2026/);
  assert.match(chat.resolve('turnover 2025', {}, D).answer, /2025/);
});

test('YTD revenue matches the facts exactly', () => {
  const f = D.applyPreset({ ...D.defaultFilter() }, 'ytdNow');
  const K = D.sales(f);
  let s = 0; for (let i = 0; i < X.n; i++) if (X.months[X.facts.m[i]].startsWith(X.months[X.nM - 1].slice(0, 4))) s += X.facts.r[i];
  assert.equal(Math.round(K.rev * 100), s);
});

test('receivables tie out to the debtors account', () => {
  assert.ok(D.X.recon.controlCents > 0);
  const app2 = globalThis.__DT.app;
  assert.ok(app2.DASH.arKPI({ reps: [], mkts: [] }).open > 0);
});

test('unknown questions go to the AI with a dash.json context', () => {
  assert.equal(chat.resolve('Write me a poem', {}, D).answer, null);
  const p = chat.buildSystemPrompt('en', 'why did sales drop', D, { context: { pageName: 'Revenue Trends' } });
  assert.match(p, /MONTHLY REVENUE/);
  assert.match(p, /RECEIVABLES/);
  assert.match(p, /Revenue Trends/);
});

test('follow-ups never repeat the question just asked', () => {
  const q = 'Who is the top verkoper?';
  assert.ok(!sug.followupsFor('salesreps', 'en', q).includes(q));
});

test('history is trimmed for the AI', () => {
  const h = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'x'.repeat(900) }));
  const c = chat.compactHistory(h);
  assert.equal(c.length, 6);
  assert.ok(c.every(m => m.text.length <= 500));
});

test('new overview figures: projected turnover, Kalverhuisvesting open orders, average days open', () => {
  const eom = X.months[X.nM - 1] + '-31';
  const OL = D.openOrderLines(), due = OL.filter(r => (r.l[8] || '') <= eom);
  const kvh = due.filter(r => D.groupOfProduct(r.l[3]) === 2).reduce((s, r) => s + r.v, 0);
  assert.ok(kvh > 0, 'Kalverhuisvesting open orders must not be 0');
  const proj = D.liveMonth().rev + due.reduce((s, r) => s + r.v, 0);
  const a = chat.resolve('What is the projected turnover this month?', {}, D).answer;
  assert.ok(a.includes(D.fmtFull(proj)), a);
  assert.ok(chat.resolve('What are the open orders for Kalverhuisvesting?', {}, D).answer.includes(D.fmtFull(kvh)));
  assert.match(chat.resolve('What is the average days open?', {}, D).answer, /\d+ days/);
  assert.equal(chat.resolve('Wat is de verwachte omzet deze maand?', { lang: 'nl' }, D).answer, a);
});
